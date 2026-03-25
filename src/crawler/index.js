'use strict';

const crypto = require('crypto');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');

const USER_AGENT = 'AgentMarketplace/1.0 (content-crawler; +https://github.com/SCJedi/agent-marketplace)';
const FETCH_TIMEOUT_MS = 10000;

/**
 * Fetch a URL and return raw HTML with metadata.
 * @param {string} url
 * @returns {Promise<{html: string, statusCode: number, headers: object, fetchedAt: string}>}
 */
async function crawlUrl(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
      redirect: 'follow',
    });

    const html = await response.text();
    const headers = Object.fromEntries(response.headers.entries());

    return {
      html,
      statusCode: response.status,
      headers,
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Fetch timed out after ${FETCH_TIMEOUT_MS}ms: ${url}`);
    }
    throw new Error(`Fetch failed for ${url}: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parse raw HTML and extract clean, structured content.
 * @param {string} html - Raw HTML string
 * @param {string} url  - Original URL (used by Readability for relative link resolution)
 * @returns {object} Structured content object
 */
function parseHtml(html, url) {
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;

  // Extract metadata before Readability modifies the DOM
  const metadata = extractMetadata(doc);

  // Use Readability to extract main content
  const reader = new Readability(doc.cloneNode(true));
  const article = reader.parse();

  // Build structured content from a fresh parse of the article HTML
  const structured = extractStructured(article ? article.content : '');

  // Extract links from the article content
  const links = extractLinks(article ? article.content : '', url);

  return {
    text: article ? article.textContent.trim() : '',
    structured,
    links,
    metadata: {
      title: (article && article.title) || metadata.title || '',
      author: (article && article.byline) || metadata.author || '',
      date: metadata.date || '',
      description: metadata.description || '',
      type: metadata.type || 'article',
    },
  };
}

/**
 * Extract metadata from document head (og tags, meta tags, etc.)
 */
function extractMetadata(doc) {
  const meta = {};

  // Title
  const ogTitle = doc.querySelector('meta[property="og:title"]');
  meta.title = ogTitle ? ogTitle.getAttribute('content') : (doc.title || '');

  // Author
  const authorMeta = doc.querySelector('meta[name="author"]') || doc.querySelector('meta[property="article:author"]');
  meta.author = authorMeta ? authorMeta.getAttribute('content') : '';

  // Date
  const dateMeta = doc.querySelector('meta[property="article:published_time"]')
    || doc.querySelector('meta[name="date"]')
    || doc.querySelector('time[datetime]');
  if (dateMeta) {
    meta.date = dateMeta.getAttribute('content') || dateMeta.getAttribute('datetime') || '';
  } else {
    meta.date = '';
  }

  // Description
  const descMeta = doc.querySelector('meta[property="og:description"]') || doc.querySelector('meta[name="description"]');
  meta.description = descMeta ? descMeta.getAttribute('content') : '';

  // Type
  const typeMeta = doc.querySelector('meta[property="og:type"]');
  meta.type = typeMeta ? typeMeta.getAttribute('content') : 'article';

  return meta;
}

/**
 * Extract structured elements (headings, code blocks, lists, tables) from article HTML.
 */
function extractStructured(contentHtml) {
  if (!contentHtml) {
    return { headings: [], code_blocks: [], lists: [], tables: [] };
  }

  const dom = new JSDOM(contentHtml);
  const doc = dom.window.document;

  // Headings
  const headings = [];
  doc.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((el) => {
    headings.push({
      level: parseInt(el.tagName[1], 10),
      text: el.textContent.trim(),
    });
  });

  // Code blocks — prefer <pre><code>, fall back to bare <pre>
  const code_blocks = [];
  const seenPres = new Set();
  doc.querySelectorAll('pre code').forEach((el) => {
    const pre = el.closest('pre');
    seenPres.add(pre);
    const text = el.textContent.trim();
    if (text) {
      const cls = el.getAttribute('class') || pre.getAttribute('class') || '';
      const langMatch = cls.match(/language-(\w+)/);
      code_blocks.push({ language: langMatch ? langMatch[1] : '', code: text });
    }
  });
  doc.querySelectorAll('pre').forEach((el) => {
    if (seenPres.has(el)) return;
    const text = el.textContent.trim();
    if (text) {
      code_blocks.push({ language: '', code: text });
    }
  });

  // Lists
  const lists = [];
  doc.querySelectorAll('ul, ol').forEach((el) => {
    const items = [];
    el.querySelectorAll(':scope > li').forEach((li) => {
      items.push(li.textContent.trim());
    });
    if (items.length > 0) {
      lists.push({
        type: el.tagName.toLowerCase() === 'ol' ? 'ordered' : 'unordered',
        items,
      });
    }
  });

  // Tables
  const tables = [];
  doc.querySelectorAll('table').forEach((table) => {
    const rows = [];
    table.querySelectorAll('tr').forEach((tr) => {
      const cells = [];
      tr.querySelectorAll('th, td').forEach((cell) => {
        cells.push(cell.textContent.trim());
      });
      if (cells.length > 0) {
        rows.push(cells);
      }
    });
    if (rows.length > 0) {
      tables.push({ rows });
    }
  });

  return { headings, code_blocks, lists, tables };
}

/**
 * Extract links from article HTML content.
 */
function extractLinks(contentHtml, baseUrl) {
  if (!contentHtml) return [];

  const dom = new JSDOM(contentHtml, { url: baseUrl });
  const doc = dom.window.document;
  const links = [];

  doc.querySelectorAll('a[href]').forEach((a) => {
    const href = a.href;
    const text = a.textContent.trim();
    if (href && text && !href.startsWith('javascript:')) {
      links.push({ text, href });
    }
  });

  return links;
}

/**
 * SHA256 hash of raw HTML content.
 * @param {string} html
 * @returns {string} Hex-encoded SHA256 hash
 */
function hashContent(html) {
  return crypto.createHash('sha256').update(html, 'utf8').digest('hex');
}

/**
 * Estimate the token cost for an LLM to process the raw HTML.
 * Rough heuristic: ~4 chars per token, typical cost ~$0.003 per 1K input tokens (GPT-4 class).
 * @param {string} html
 * @returns {{estimatedTokens: number, estimatedCostUsd: number}}
 */
function estimateTokenCost(html) {
  const estimatedTokens = Math.ceil(html.length / 4);
  const costPer1kTokens = 0.003;
  const estimatedCostUsd = parseFloat(((estimatedTokens / 1000) * costPer1kTokens).toFixed(6));
  return { estimatedTokens, estimatedCostUsd };
}

/**
 * Full pipeline: crawl URL -> parse HTML -> hash -> return complete content record.
 * @param {string} url
 * @returns {Promise<object>} Complete content record matching protocol schema
 */
async function createContentRecord(url) {
  const crawlResult = await crawlUrl(url);

  if (crawlResult.statusCode < 200 || crawlResult.statusCode >= 300) {
    throw new Error(`Non-success status ${crawlResult.statusCode} for ${url}`);
  }

  const content = parseHtml(crawlResult.html, url);
  const sourceHash = hashContent(crawlResult.html);
  const tokenEstimate = estimateTokenCost(crawlResult.html);

  return {
    type: 'content',
    url,
    source_hash: sourceHash,
    fetched_at: crawlResult.fetchedAt,
    content,
    price: null,
    token_cost_saved: tokenEstimate.estimatedCostUsd,
  };
}

module.exports = {
  crawlUrl,
  parseHtml,
  hashContent,
  estimateTokenCost,
  createContentRecord,
};
