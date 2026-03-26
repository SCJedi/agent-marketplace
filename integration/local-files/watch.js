#!/usr/bin/env node
'use strict';

// integration/local-files/watch.js
//
// Watch a folder and auto-publish changed files to the marketplace.
//
// Usage:
//   node watch.js /path/to/folder/
//   node watch.js /path/to/folder/ --visibility private

const fs = require('fs');
const path = require('path');
const { isSupported, publishFile, loadConfig, SKIP_DIRS } = require('./publish');

const MAX_FILE_SIZE = 1024 * 1024;

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`  [${ts}] ${msg}`);
}

async function run(args) {
  const config = loadConfig();

  let visibility = config.defaultVisibility || 'private';
  let watchPath = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--visibility' && args[i + 1]) {
      visibility = args[++i];
    } else if (!args[i].startsWith('--')) {
      watchPath = args[i];
    }
  }

  if (!watchPath) {
    console.log('Usage: node watch.js <folder> [--visibility private|public]');
    process.exit(1);
  }

  const resolved = path.resolve(watchPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    console.error(`  Not a directory: ${resolved}`);
    process.exit(1);
  }

  console.log(`  Watching: ${resolved}`);
  console.log(`  Visibility: ${visibility}`);
  console.log(`  Marketplace: ${config.marketplaceUrl}`);
  console.log();

  // Debounce map to avoid double-publishes
  const pending = new Map();
  const DEBOUNCE_MS = 1000;

  function handleChange(eventType, filename) {
    if (!filename) return;

    const fullPath = path.join(resolved, filename);

    // Skip directories in SKIP_DIRS
    const parts = filename.split(path.sep);
    if (parts.some(p => SKIP_DIRS.has(p) || p.startsWith('.'))) return;

    // Check if file exists and is supported
    try {
      if (!fs.existsSync(fullPath)) return;
      const stats = fs.statSync(fullPath);
      if (!stats.isFile()) return;
      if (stats.size > MAX_FILE_SIZE || stats.size === 0) return;
      if (!isSupported(fullPath)) return;
    } catch (e) {
      return;
    }

    // Debounce
    if (pending.has(fullPath)) {
      clearTimeout(pending.get(fullPath));
    }

    pending.set(fullPath, setTimeout(async () => {
      pending.delete(fullPath);
      log(`Changed: ${filename}`);
      const result = await publishFile(config, fullPath, visibility);
      if (result.success) {
        log(`Published: ${filename}`);
      } else {
        log(`Failed: ${filename} (${result.error || `HTTP ${result.status}`})`);
      }
    }, DEBOUNCE_MS));
  }

  // Start watching (recursive)
  try {
    fs.watch(resolved, { recursive: true }, handleChange);
    log('Watching for changes... (Ctrl+C to stop)');
  } catch (e) {
    console.error(`  Watch failed: ${e.message}`);
    process.exit(1);
  }
}

module.exports = { run };

if (require.main === module) {
  const args = process.argv.slice(2);
  run(args).catch(e => {
    console.error('Watch failed:', e.message);
    process.exit(1);
  });
}
