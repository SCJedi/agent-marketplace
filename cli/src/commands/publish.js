'use strict';

const fmt = require('../formatter');

/**
 * Publish a URL to the marketplace by crawling and parsing it.
 * Falls back to a simple fetch if the crawler (jsdom/readability) is unavailable.
 * @param {import('../../sdk/js/src/client').Marketplace} client
 * @param {string} url
 * @param {object} opts
 * @param {object} config
 */
async function run(client, url, opts = {}, config = {}) {
  if (!url) {
    fmt.error('Usage: agent-marketplace publish <url> [--price <price>]');
    process.exitCode = 1;
    return;
  }

  const price = opts.price !== undefined ? parseFloat(opts.price) : (config.defaultPrice || 0.0003);

  fmt.info(`Crawling ${url} ...`);

  let contentRecord;
  try {
    // Try using the full crawler with jsdom + readability
    const crawler = require('../../../src/crawler/index');
    contentRecord = await crawler.createContentRecord(url);
  } catch {
    // Fallback: fetch raw HTML and publish with minimal parsing
    fmt.info('Full crawler unavailable, using simple fetch...');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'AgentMarketplace-CLI/0.1.0' },
        signal: controller.signal,
        redirect: 'follow',
      });
      const html = await resp.text();
      clearTimeout(timer);

      // Simple metadata extraction
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : '';

      // Estimate token cost
      const estimatedTokens = Math.ceil(html.length / 4);
      const tokenCostSaved = parseFloat(((estimatedTokens / 1000) * 0.003).toFixed(6));

      contentRecord = {
        type: 'content',
        url,
        source_hash: '',
        fetched_at: new Date().toISOString(),
        content: {
          text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 5000),
          structured: null,
          links: null,
          metadata: { title },
        },
        token_cost_saved: tokenCostSaved,
      };
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  const tokenCostSaved = contentRecord.token_cost_saved || 0;
  const content = contentRecord.content || {};

  const result = await client.publishContent(
    url,
    {
      text: content.text || '',
      structured: content.structured || null,
      links: content.links || null,
      metadata: content.metadata || null,
      source_hash: contentRecord.source_hash || '',
    },
    price,
    tokenCostSaved
  );

  console.log();
  fmt.success(`Published!`);
  fmt.kvBlock([
    ['URL', url],
    ['Price', fmt.price(price)],
    ['Token cost saved', fmt.price(tokenCostSaved)],
    ['ID', result.id || result.content_id || '-'],
  ]);
  console.log();
}

module.exports = { run };
