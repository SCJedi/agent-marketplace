#!/usr/bin/env node
'use strict';

// integration/claude-code/status.js
//
// Quick check of the Claude Code auto-cache integration status.

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (e) { /* ignore */ }
  return null;
}

function countLogEntries(logFile) {
  try {
    if (!fs.existsSync(logFile)) return { total: 0, cached: 0 };
    const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
    const cached = lines.filter(l => l.includes('CACHED:')).length;
    return { total: lines.length, cached };
  } catch (e) {
    return { total: 0, cached: 0 };
  }
}

async function checkConnection(config) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const resp = await fetch(`${config.marketplaceUrl}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    return resp.ok;
  } catch (e) {
    clearTimeout(timer);
    return false;
  }
}

async function checkApiKey(config) {
  if (!config.apiKey) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    // Use a test check call with the API key
    const resp = await fetch(
      `${config.marketplaceUrl}/check?url=__status_test__`,
      {
        headers: { 'x-api-key': config.apiKey },
        signal: controller.signal,
      }
    );
    clearTimeout(timer);
    return resp.ok; // 200 means key is valid (or no auth required)
  } catch (e) {
    clearTimeout(timer);
    return false;
  }
}

function checkHookInstalled() {
  // Look for .claude/settings*.json in cwd and parent directories
  const searchDirs = [process.cwd()];
  let current = process.cwd();
  for (let i = 0; i < 5; i++) {
    const parent = path.dirname(current);
    if (parent === current) break;
    searchDirs.push(parent);
    current = parent;
  }

  for (const dir of searchDirs) {
    for (const fname of ['settings.local.json', 'settings.json']) {
      const fpath = path.join(dir, '.claude', fname);
      try {
        if (fs.existsSync(fpath)) {
          const settings = JSON.parse(fs.readFileSync(fpath, 'utf8'));
          const hooks = settings.hooks || {};
          const postHooks = hooks.PostToolUse || [];
          const hasIt = postHooks.some(h =>
            h.matcher === 'WebFetch' && h.hooks && h.hooks.some(hk =>
              hk.command && hk.command.includes('auto-cache')
            )
          );
          if (hasIt) return { installed: true, path: fpath };
        }
      } catch (e) { /* skip */ }
    }
  }

  return { installed: false, path: null };
}

async function getContentStats(config) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const headers = {};
    if (config.apiKey) headers['x-api-key'] = config.apiKey;
    const resp = await fetch(`${config.marketplaceUrl}/dashboard/api/status`, {
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (resp.ok) {
      const body = await resp.json();
      return body.data || {};
    }
  } catch (e) {
    clearTimeout(timer);
  }
  return {};
}

async function run() {
  const config = loadConfig();

  console.log();

  if (!config) {
    console.log('  \x1b[31mNot configured\x1b[0m — run: node integration/claude-code/setup.js');
    console.log();
    process.exit(1);
  }

  // Connection
  const connected = await checkConnection(config);
  const connStatus = connected ? '\x1b[32mconnected\x1b[0m' : '\x1b[31mdisconnected\x1b[0m';
  console.log(`  Marketplace:  ${config.marketplaceUrl} ${connStatus}`);

  // API Key
  if (config.apiKey) {
    const keyValid = connected ? await checkApiKey(config) : false;
    const masked = config.apiKey.slice(0, 8) + '...' + config.apiKey.slice(-4);
    const keyStatus = keyValid ? '\x1b[32mvalid\x1b[0m' : (connected ? '\x1b[33munknown\x1b[0m' : '\x1b[90m(offline)\x1b[0m');
    console.log(`  API Key:      ${masked} ${keyStatus}`);
  } else {
    console.log(`  API Key:      \x1b[33mnone configured\x1b[0m`);
  }

  // Hook installed
  const hook = checkHookInstalled();
  const hookStatus = hook.installed ? '\x1b[32myes\x1b[0m (PostToolUse -> WebFetch)' : '\x1b[31mno\x1b[0m';
  console.log(`  Hook:         ${hookStatus}`);
  if (hook.path) {
    console.log(`  Settings:     ${hook.path}`);
  }

  // Log stats
  const logFile = config.logFile || path.join(__dirname, 'cache.log');
  const logStats = countLogEntries(logFile);
  console.log(`  URLs cached:  ${logStats.cached}`);

  // Node stats
  if (connected) {
    const stats = await getContentStats(config);
    if (stats.contentCount !== undefined) {
      console.log(`  Total content: ${stats.contentCount} items (${stats.privateCount || 0} private)`);
    }
  }

  // Savings estimate
  if (logStats.cached > 0) {
    const estimatedSavings = (logStats.cached * 0.001).toFixed(4);
    console.log(`  Est. savings: $${estimatedSavings}`);
  }

  console.log();
}

module.exports = { run, loadConfig, checkConnection, checkApiKey, checkHookInstalled, countLogEntries };

if (require.main === module) {
  run().catch(e => {
    console.error('Status check failed:', e.message);
    process.exit(1);
  });
}
