#!/usr/bin/env node
'use strict';

// integration/claude-code/auto-cache.js
//
// Claude Code PostToolUse hook for WebFetch
// Automatically publishes fetched web content to your marketplace node.
//
// Claude Code pipes hook context as JSON to stdin:
// { "tool_name": "WebFetch", "tool_input": { "url": "..." }, "tool_output": "...", "session_id": "..." }
//
// This hook:
// 1. Parses stdin for the tool context
// 2. Extracts the URL and fetched content
// 3. Checks marketplace: is this URL already cached?
// 4. If not cached: cleans/structures content and publishes it
// 5. Logs to stderr (doesn't interfere with Claude Code's stdout)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const LOG_PATH = path.join(__dirname, 'cache.log');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (e) { /* ignore */ }
  return {
    marketplaceUrl: process.env.MARKETPLACE_URL || 'http://localhost:3001',
    apiKey: process.env.MARKETPLACE_API_KEY || '',
    autoPublish: true,
    defaultVisibility: 'private',
    defaultPrice: 0,
    logFile: LOG_PATH,
  };
}

function log(msg) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}`;
  process.stderr.write(line + '\n');
  try {
    const config = loadConfig();
    const logFile = config.logFile || LOG_PATH;
    fs.appendFileSync(logFile, line + '\n');
  } catch (e) { /* ignore log write failures */ }
}

function extractContent(rawOutput) {
  // rawOutput is the WebFetch tool_output — typically HTML or cleaned text
  // Do basic extraction: title, text, word count
  if (!rawOutput || typeof rawOutput !== 'string') {
    return { title: '', text: '', metadata: {} };
  }

  let title = '';
  let text = rawOutput;

  // Try to extract title from HTML
  const titleMatch = rawOutput.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) {
    title = titleMatch[1].trim();
  }

  // If it looks like HTML, strip tags for text
  if (rawOutput.includes('<') && rawOutput.includes('>')) {
    text = rawOutput
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Cap at 50k chars
  if (text.length > 50000) {
    text = text.slice(0, 50000);
  }

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const estimatedTokens = Math.ceil(text.length / 4);

  return {
    title,
    text,
    metadata: {
      title,
      wordCount,
      estimatedTokens,
      extractedAt: new Date().toISOString(),
    },
  };
}

async function checkMarketplace(config, url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (config.apiKey) headers['x-api-key'] = config.apiKey;

    const resp = await fetch(
      `${config.marketplaceUrl}/check?url=${encodeURIComponent(url)}`,
      { headers, signal: controller.signal }
    );
    clearTimeout(timer);
    if (!resp.ok) return { available: false };
    const body = await resp.json();
    return body.data || { available: false };
  } catch (e) {
    clearTimeout(timer);
    return { available: false, error: e.message };
  }
}

async function publishToMarketplace(config, url, content) {
  const sourceHash = crypto.createHash('sha256').update(url).digest('hex');
  const estimatedTokens = Math.ceil((content.text || '').length / 4);
  const tokenCostSaved = parseFloat(((estimatedTokens / 1000) * 0.003).toFixed(6));

  const payload = {
    url,
    source_hash: sourceHash,
    content_text: content.text || '',
    content_metadata: JSON.stringify(content.metadata || {}),
    price: config.defaultPrice || 0,
    token_cost_saved: tokenCostSaved,
    visibility: config.defaultVisibility || 'private',
  };

  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers['x-api-key'] = config.apiKey;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const resp = await fetch(`${config.marketplaceUrl}/publish/content`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const body = await resp.json();
    return { success: resp.ok, data: body.data, status: resp.status };
  } catch (e) {
    clearTimeout(timer);
    return { success: false, error: e.message };
  }
}

async function main() {
  const config = loadConfig();

  if (!config.autoPublish) {
    return; // Auto-publish disabled
  }

  // Read hook context from stdin
  let inputData = '';
  try {
    inputData = fs.readFileSync(0, 'utf8'); // fd 0 = stdin
  } catch (e) {
    log('ERROR: Could not read stdin: ' + e.message);
    process.exit(0); // Exit cleanly — don't block Claude Code
  }

  if (!inputData.trim()) {
    log('No input received on stdin');
    process.exit(0);
  }

  let context;
  try {
    context = JSON.parse(inputData);
  } catch (e) {
    log('ERROR: Invalid JSON on stdin: ' + e.message);
    process.exit(0);
  }

  // Extract URL and output from hook context
  // Claude Code hook context may use different field names
  const toolInput = context.tool_input || context.input || {};
  const url = toolInput.url || toolInput.URL || context.url || '';
  // tool_response is an object: { bytes, code, codeText, result, durationMs, url }
  const rawResponse = context.tool_response || context.tool_output || {};
  const toolOutput = typeof rawResponse === 'string' ? rawResponse : (rawResponse.result || rawResponse.output || JSON.stringify(rawResponse));

  // Debug: log what fields we received
  log(`DEBUG: Context keys: ${Object.keys(context).join(', ')}`);
  log(`DEBUG: URL: ${url}, tool_response type: ${typeof toolOutput}`);
  if (typeof toolOutput === 'object' && toolOutput !== null) {
    log(`DEBUG: tool_response keys: ${Object.keys(toolOutput).join(', ')}`);
    log(`DEBUG: tool_response preview: ${JSON.stringify(toolOutput).slice(0, 300)}`);
  }

  if (!url) {
    log('No URL found in hook context');
    process.exit(0);
  }

  // Skip non-HTTP URLs
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    process.exit(0);
  }

  // Check if already cached
  const cacheStatus = await checkMarketplace(config, url);
  if (cacheStatus.available) {
    log(`SKIP: Already cached: ${url}`);
    process.exit(0);
  }

  if (cacheStatus.error) {
    log(`WARN: Marketplace check failed (${cacheStatus.error}), publishing anyway`);
  }

  // Extract and clean content
  const content = extractContent(toolOutput);

  if (!content.text || content.text.length < 10) {
    log(`SKIP: Content too short for ${url}`);
    process.exit(0);
  }

  // Publish to marketplace
  const result = await publishToMarketplace(config, url, content);

  if (result.success) {
    const savings = ((content.metadata.estimatedTokens || 0) / 1000 * 0.003).toFixed(4);
    log(`CACHED: ${url} (saves future agents $${savings})`);
  } else {
    log(`ERROR: Failed to publish ${url}: ${result.error || `HTTP ${result.status}`}`);
  }

  process.exit(0);
}

// Export for testing
module.exports = { loadConfig, extractContent, checkMarketplace, publishToMarketplace, main };

// Run if called directly
if (require.main === module) {
  main().catch(e => {
    log('ERROR: ' + e.message);
    process.exit(0); // Always exit cleanly
  });
}
