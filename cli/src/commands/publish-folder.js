'use strict';

const path = require('path');
const fs = require('fs');
const fmt = require('../formatter');

/**
 * Publish all supported files in a folder to the marketplace.
 * @param {import('../../sdk/js/src/client').Marketplace} client
 * @param {string} folderPath
 * @param {object} opts
 */
async function run(client, folderPath, opts = {}) {
  if (!folderPath) {
    fmt.error('Usage: agent-marketplace publish-folder <path> [--depth N] [--visibility private|public] [--watch]');
    process.exitCode = 1;
    return;
  }

  const resolved = path.resolve(folderPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    fmt.error(`Not a directory: ${resolved}`);
    process.exitCode = 1;
    return;
  }

  // Check for watch mode
  if (opts.watch) {
    fmt.info(`Starting file watcher on ${resolved}...`);
    const { run: watchRun } = require('../../../integration/local-files/watch');
    const args = [resolved];
    if (opts.visibility) args.push('--visibility', opts.visibility);
    await watchRun(args);
    return;
  }

  // Use the local-files publisher
  const { run: publishRun } = require('../../../integration/local-files/publish');
  const args = [resolved];
  if (opts.depth) args.push('--depth', String(opts.depth));
  if (opts.visibility) args.push('--visibility', opts.visibility);

  await publishRun(args);
}

module.exports = { run };
