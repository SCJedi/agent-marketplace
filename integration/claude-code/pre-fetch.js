#!/usr/bin/env node
'use strict';

// integration/claude-code/pre-fetch.js
//
// Claude Code PreToolUse hook for WebFetch
// Checks if the marketplace has a cached version BEFORE Claude Code fetches.
//
// Note: PreToolUse hooks can block/allow but can't substitute content.
// This hook is informational — it logs that a cached version exists.
// The real value is the PostToolUse auto-publish (auto-cache.js).

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (e) { /* ignore */ }
  return {
    marketplaceUrl: process.env.MARKETPLACE_URL || 'http://localhost:3001',
    apiKey: process.env.MARKETPLACE_API_KEY || '',
  };
}

function log(msg) {
  const timestamp = new Date().toISOString();
  process.stderr.write(`[${timestamp}] [pre-fetch] ${msg}\n`);
}

async function checkMarketplace(config, url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000); // Fast timeout for pre-fetch
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

async function main() {
  const config = loadConfig();

  // Read hook context from stdin
  let inputData = '';
  try {
    inputData = fs.readFileSync(0, 'utf8');
  } catch (e) {
    process.exit(0);
  }

  if (!inputData.trim()) {
    process.exit(0);
  }

  let context;
  try {
    context = JSON.parse(inputData);
  } catch (e) {
    process.exit(0);
  }

  const toolInput = context.tool_input || {};
  const url = toolInput.url || toolInput.URL || '';

  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    process.exit(0);
  }

  // Check marketplace for cached version
  const cacheStatus = await checkMarketplace(config, url);

  if (cacheStatus.available) {
    const price = cacheStatus.price || 0;
    log(`Marketplace has cached version of ${url} ($${price.toFixed(4)})`);
  }

  // Always allow — this hook is informational only
  process.exit(0);
}

module.exports = { loadConfig, checkMarketplace, main };

if (require.main === module) {
  main().catch(() => process.exit(0));
}
