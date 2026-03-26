#!/usr/bin/env node
'use strict';

// integration/claude-code/setup.js
//
// One-click setup for Claude Code auto-caching integration.
// Connects to your marketplace node, sets up API key, and configures hooks.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');

const CONFIG_PATH = path.join(__dirname, 'config.json');

const BANNER = `
\x1b[36m\x1b[1m===================================================
  Agent Marketplace — Claude Code Integration
===================================================\x1b[0m
`;

function ask(rl, question, defaultVal) {
  return new Promise(resolve => {
    const prompt = defaultVal ? `${question} (${defaultVal}): ` : `${question}: `;
    rl.question(prompt, answer => {
      resolve(answer.trim() || defaultVal || '');
    });
  });
}

async function testConnection(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const resp = await fetch(`${url}/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    const body = await resp.json();
    return { ok: true, data: body.data || body };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, error: e.message };
  }
}

async function getNodeName(url) {
  try {
    const resp = await fetch(`${url}/dashboard/api/config`, {
      signal: AbortSignal.timeout(3000),
    });
    if (resp.ok) {
      const body = await resp.json();
      return (body.data && body.data.nodeName) || null;
    }
  } catch (e) { /* ignore */ }
  return null;
}

async function createApiKey(url, label) {
  try {
    const resp = await fetch(`${url}/dashboard/api/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: label || 'claude-code-hook' }),
      signal: AbortSignal.timeout(5000),
    });
    if (resp.ok) {
      const body = await resp.json();
      return body.data ? body.data.key : null;
    }
  } catch (e) { /* ignore */ }
  return null;
}

async function run() {
  console.log(BANNER);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    // Step 1: Connect to marketplace node
    console.log('\x1b[1mStep 1: Checking marketplace node...\x1b[0m');
    const marketplaceUrl = await ask(rl, '  Where is your marketplace node?', 'http://localhost:3001');

    const conn = await testConnection(marketplaceUrl);
    if (!conn.ok) {
      console.log(`\x1b[31m  Cannot connect to ${marketplaceUrl}: ${conn.error}\x1b[0m`);
      console.log('  Make sure your marketplace node is running: node src/server.js');
      rl.close();
      process.exit(1);
    }

    const nodeName = await getNodeName(marketplaceUrl);
    console.log(`\x1b[32m  Connected to "${nodeName || 'marketplace node'}" at ${marketplaceUrl}\x1b[0m`);
    console.log();

    // Step 2: API key
    console.log('\x1b[1mStep 2: Setting up API key...\x1b[0m');
    let apiKey = await ask(rl, '  Enter existing API key (or press Enter to generate new)', '');

    if (!apiKey) {
      apiKey = await createApiKey(marketplaceUrl, 'claude-code-hook');
      if (apiKey) {
        console.log(`\x1b[32m  Generated API key: ${apiKey.slice(0, 12)}...${apiKey.slice(-4)}\x1b[0m`);
      } else {
        console.log('\x1b[33m  Could not auto-generate key. Continuing without one.\x1b[0m');
        apiKey = '';
      }
    } else {
      console.log(`\x1b[32m  API key: ${apiKey.slice(0, 8)}...${apiKey.slice(-4)}\x1b[0m`);
    }
    console.log();

    // Step 3: Configure
    console.log('\x1b[1mStep 3: Configuring Claude Code hooks...\x1b[0m');

    const config = {
      marketplaceUrl,
      apiKey,
      autoPublish: true,
      defaultVisibility: 'private',
      defaultPrice: 0,
      logFile: path.join(__dirname, 'cache.log'),
    };

    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
    console.log(`\x1b[32m  Config saved to ${CONFIG_PATH}\x1b[0m`);
    console.log();

    // Show hook configuration
    const autoCachePath = path.resolve(__dirname, 'auto-cache.js').replace(/\\/g, '/');
    const preFetchPath = path.resolve(__dirname, 'pre-fetch.js').replace(/\\/g, '/');

    const hookConfig = {
      hooks: {
        PostToolUse: [
          {
            matcher: 'WebFetch',
            hooks: [{
              type: 'command',
              command: `node "${autoCachePath}"`,
              timeout: 5000,
            }],
          },
        ],
        PreToolUse: [
          {
            matcher: 'WebFetch',
            hooks: [{
              type: 'command',
              command: `node "${preFetchPath}"`,
              timeout: 3000,
            }],
          },
        ],
      },
    };

    console.log('  Add this to your .claude/settings.json (merge with existing hooks):');
    console.log();
    console.log('\x1b[36m' + JSON.stringify(hookConfig, null, 2) + '\x1b[0m');
    console.log();

    // Offer to auto-configure
    const autoConfig = await ask(rl, '  Auto-configure? [Y/n]', 'Y');
    if (autoConfig.toLowerCase() !== 'n') {
      // Try to find and update .claude/settings.json
      const settingsLocations = [
        path.join(process.cwd(), '.claude', 'settings.local.json'),
        path.join(process.cwd(), '.claude', 'settings.json'),
      ];

      let settingsPath = null;
      let settings = {};
      for (const loc of settingsLocations) {
        if (fs.existsSync(loc)) {
          try {
            settings = JSON.parse(fs.readFileSync(loc, 'utf8'));
            settingsPath = loc;
            break;
          } catch (e) { /* skip */ }
        }
      }

      if (!settingsPath) {
        // Create settings.local.json
        const claudeDir = path.join(process.cwd(), '.claude');
        if (!fs.existsSync(claudeDir)) fs.mkdirSync(claudeDir, { recursive: true });
        settingsPath = path.join(claudeDir, 'settings.local.json');
        settings = {};
      }

      // Merge hooks
      if (!settings.hooks) settings.hooks = {};
      if (!settings.hooks.PostToolUse) settings.hooks.PostToolUse = [];
      if (!settings.hooks.PreToolUse) settings.hooks.PreToolUse = [];

      // Check if already installed
      const hasPostHook = settings.hooks.PostToolUse.some(h =>
        h.matcher === 'WebFetch' && h.hooks && h.hooks.some(hk => hk.command && hk.command.includes('auto-cache'))
      );
      const hasPreHook = settings.hooks.PreToolUse.some(h =>
        h.matcher === 'WebFetch' && h.hooks && h.hooks.some(hk => hk.command && hk.command.includes('pre-fetch'))
      );

      if (!hasPostHook) {
        settings.hooks.PostToolUse.push({
          matcher: 'WebFetch',
          hooks: [{
            type: 'command',
            command: `node "${autoCachePath}"`,
            timeout: 5000,
          }],
        });
      }

      if (!hasPreHook) {
        settings.hooks.PreToolUse.push({
          matcher: 'WebFetch',
          hooks: [{
            type: 'command',
            command: `node "${preFetchPath}"`,
            timeout: 3000,
          }],
        });
      }

      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
      console.log(`\x1b[32m  Hooks written to ${settingsPath}\x1b[0m`);
    }

    console.log();
    console.log('\x1b[1mStep 4: Done!\x1b[0m');
    console.log('  Every WebFetch will now auto-cache to your node.');
    console.log('  Your agents share this cache across all sessions.');
    console.log();
    console.log('\x1b[36m===================================================\x1b[0m');
  } finally {
    rl.close();
  }
}

module.exports = { run, testConnection, getNodeName, createApiKey };

if (require.main === module) {
  run().catch(e => {
    console.error('Setup failed:', e.message);
    process.exit(1);
  });
}
