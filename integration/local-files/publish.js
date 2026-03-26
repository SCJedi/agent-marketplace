#!/usr/bin/env node
'use strict';

// integration/local-files/publish.js
//
// Publish local files to the marketplace node.
//
// Usage:
//   node publish.js /path/to/file.md
//   node publish.js file1.md file2.js file3.py
//   node publish.js /path/to/folder/
//   node publish.js /path/to/folder/ --depth 3
//   node publish.js --visibility private /path/to/file.md

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HOOK_CONFIG_PATH = path.join(__dirname, '..', 'claude-code', 'config.json');

// Supported text file extensions
const SUPPORTED_EXTENSIONS = new Set([
  '.md', '.txt', '.js', '.ts', '.py', '.json', '.yaml', '.yml',
  '.html', '.css', '.sh', '.bat', '.ps1', '.gitignore', '.cfg',
  '.ini', '.toml', '.xml', '.csv', '.sql', '.go', '.rs', '.java',
  '.c', '.cpp', '.h', '.rb', '.php', '.jsx', '.tsx', '.vue',
  '.svelte', '.scss', '.less', '.lock', '.env.example',
]);

// Directories to always skip
const SKIP_DIRS = new Set([
  'node_modules', '.git', '__pycache__', '.venv', 'venv',
  '.next', '.nuxt', 'dist', 'build', '.cache', '.pytest_cache',
  '.mypy_cache', 'coverage', '.nyc_output', '.idea', '.vscode',
  'vendor', 'target', 'bin', 'obj',
]);

const MAX_FILE_SIZE = 1024 * 1024; // 1MB

function loadConfig() {
  try {
    if (fs.existsSync(HOOK_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(HOOK_CONFIG_PATH, 'utf8'));
    }
  } catch (e) { /* ignore */ }
  return {
    marketplaceUrl: process.env.MARKETPLACE_URL || 'http://localhost:3001',
    apiKey: process.env.MARKETPLACE_API_KEY || '',
    defaultVisibility: 'private',
    defaultPrice: 0,
  };
}

function isSupported(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath);

  // Special filenames without extensions
  if (['Makefile', 'Dockerfile', 'Procfile', '.gitignore', '.dockerignore', '.editorconfig'].includes(basename)) {
    return true;
  }

  return SUPPORTED_EXTENSIONS.has(ext);
}

function walkDir(dirPath, maxDepth = Infinity, currentDepth = 0) {
  const results = [];

  if (currentDepth > maxDepth) return results;

  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (e) {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      results.push(...walkDir(fullPath, maxDepth, currentDepth + 1));
    } else if (entry.isFile()) {
      if (!isSupported(fullPath)) continue;
      try {
        const stats = fs.statSync(fullPath);
        if (stats.size > MAX_FILE_SIZE) continue;
        if (stats.size === 0) continue;
        results.push(fullPath);
      } catch (e) {
        continue;
      }
    }
  }

  return results;
}

async function publishFile(config, filePath, visibility) {
  const content = fs.readFileSync(filePath, 'utf8');
  const absPath = path.resolve(filePath).replace(/\\/g, '/');
  const url = `file:///${absPath}`;
  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath);
  const stats = fs.statSync(filePath);
  const sourceHash = crypto.createHash('sha256').update(content).digest('hex');

  const metadata = {
    title: basename,
    type: ext.replace('.', '') || 'text',
    size: stats.size,
    lastModified: stats.mtime.toISOString(),
  };

  const payload = {
    url,
    source_hash: sourceHash,
    content_text: content.slice(0, 50000),
    content_metadata: JSON.stringify(metadata),
    price: config.defaultPrice || 0,
    token_cost_saved: parseFloat(((content.length / 4 / 1000) * 0.003).toFixed(6)),
    visibility: visibility || config.defaultVisibility || 'private',
  };

  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers['x-api-key'] = config.apiKey;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const resp = await fetch(`${config.marketplaceUrl}/publish/content`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const body = await resp.json();
    return { success: resp.ok, data: body.data, status: resp.status, path: filePath };
  } catch (e) {
    clearTimeout(timer);
    return { success: false, error: e.message, path: filePath };
  }
}

function printProgress(current, total, filePath) {
  const pct = Math.round((current / total) * 100);
  const bar = '#'.repeat(Math.round(pct / 5)).padEnd(20, '-');
  const basename = path.basename(filePath);
  const display = basename.length > 30 ? basename.slice(0, 27) + '...' : basename;
  process.stderr.write(`\r  [${bar}] ${pct}% (${current}/${total}) ${display.padEnd(32)}`);
}

async function run(args) {
  const config = loadConfig();

  // Parse arguments
  let visibility = config.defaultVisibility || 'private';
  let maxDepth = Infinity;
  let confirmDrive = false;
  const paths = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--visibility' && args[i + 1]) {
      visibility = args[++i];
    } else if (args[i] === '--depth' && args[i + 1]) {
      maxDepth = parseInt(args[++i], 10);
    } else if (args[i] === '--confirm-full-drive') {
      confirmDrive = true;
    } else if (!args[i].startsWith('--')) {
      paths.push(args[i]);
    }
  }

  if (paths.length === 0) {
    console.log('Usage: node publish.js <path> [path2 ...] [--visibility private|public] [--depth N]');
    console.log();
    console.log('Examples:');
    console.log('  node publish.js README.md');
    console.log('  node publish.js ./src/ --depth 3');
    console.log('  node publish.js file1.md file2.js --visibility public');
    process.exit(1);
  }

  // Collect all files
  const files = [];

  for (const p of paths) {
    const resolved = path.resolve(p);

    if (!fs.existsSync(resolved)) {
      console.error(`  Not found: ${resolved}`);
      continue;
    }

    const stats = fs.statSync(resolved);

    if (stats.isFile()) {
      if (!isSupported(resolved)) {
        console.error(`  Skipped (unsupported type): ${resolved}`);
        continue;
      }
      if (stats.size > MAX_FILE_SIZE) {
        console.error(`  Skipped (>1MB): ${resolved}`);
        continue;
      }
      files.push(resolved);
    } else if (stats.isDirectory()) {
      // Check for drive root without confirmation
      if (resolved.length <= 3 && !confirmDrive) {
        console.error(`  Drive root requires --confirm-full-drive flag: ${resolved}`);
        continue;
      }
      files.push(...walkDir(resolved, maxDepth));
    }
  }

  if (files.length === 0) {
    console.log('  No supported files found.');
    process.exit(0);
  }

  console.log(`  Found ${files.length} files to publish (visibility: ${visibility})`);
  console.log();

  // Publish all files
  let published = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < files.length; i++) {
    printProgress(i + 1, files.length, files[i]);

    const result = await publishFile(config, files[i], visibility);

    if (result.success) {
      published++;
    } else if (result.status === 429) {
      // Rate limited — wait and retry
      skipped++;
      await new Promise(r => setTimeout(r, 2000));
      const retry = await publishFile(config, files[i], visibility);
      if (retry.success) { published++; skipped--; }
      else { failed++; skipped--; }
    } else {
      failed++;
    }
  }

  process.stderr.write('\r' + ' '.repeat(80) + '\r'); // Clear progress bar
  console.log();
  console.log(`  Published: ${published}`);
  if (failed > 0) console.log(`  Failed:    ${failed}`);
  if (skipped > 0) console.log(`  Skipped:   ${skipped}`);
  console.log(`  Source:    ${paths.join(', ')}`);
  console.log();
}

module.exports = { run, walkDir, isSupported, publishFile, loadConfig, SUPPORTED_EXTENSIONS, SKIP_DIRS };

if (require.main === module) {
  const args = process.argv.slice(2);
  run(args).catch(e => {
    console.error('Publish failed:', e.message);
    process.exit(1);
  });
}
