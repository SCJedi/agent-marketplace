'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fmt = require('../formatter');

/**
 * Publish a local file to the marketplace.
 * @param {import('../../sdk/js/src/client').Marketplace} client
 * @param {string} filePath
 * @param {object} opts
 */
async function run(client, filePath, opts = {}) {
  if (!filePath) {
    fmt.error('Usage: agent-marketplace publish-file <path> [--visibility private|public]');
    process.exitCode = 1;
    return;
  }

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    fmt.error(`File not found: ${resolved}`);
    process.exitCode = 1;
    return;
  }

  const stats = fs.statSync(resolved);
  if (!stats.isFile()) {
    fmt.error(`Not a file: ${resolved}. Use publish-folder for directories.`);
    process.exitCode = 1;
    return;
  }

  if (stats.size > 1024 * 1024) {
    fmt.error(`File too large (${(stats.size / 1024).toFixed(0)}KB > 1MB limit): ${resolved}`);
    process.exitCode = 1;
    return;
  }

  fmt.info(`Reading ${resolved} ...`);

  const content = fs.readFileSync(resolved, 'utf8');
  const normalizedPath = resolved.replace(/\\/g, '/');
  const fileUrl = `file:///${normalizedPath}`;
  const basename = path.basename(resolved);
  const ext = path.extname(resolved).replace('.', '') || 'text';
  const sourceHash = crypto.createHash('sha256').update(content).digest('hex');

  const price = opts.price !== undefined ? parseFloat(opts.price) : 0;
  const visibility = opts.visibility || 'private';

  const result = await client.publishContent(
    fileUrl,
    {
      text: content.slice(0, 50000),
      metadata: { title: basename, type: ext, size: stats.size },
      source_hash: sourceHash,
    },
    price,
    parseFloat(((content.length / 4 / 1000) * 0.003).toFixed(6)),
    { visibility }
  );

  console.log();
  fmt.success('Published!');
  fmt.kvBlock([
    ['File', basename],
    ['URL', fileUrl],
    ['Price', price === 0 ? 'Free' : fmt.price(price)],
    ['Visibility', visibility],
    ['ID', result.id || result.content_id || '-'],
  ]);
  console.log();
}

module.exports = { run };
