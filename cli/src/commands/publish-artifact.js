'use strict';

const fs = require('fs');
const path = require('path');
const fmt = require('../formatter');

/**
 * Publish an artifact to the marketplace.
 * @param {import('../../sdk/js/src/client').Marketplace} client
 * @param {object} opts
 */
async function run(client, opts = {}) {
  const { name, category, description, price: priceStr, files: filesStr } = opts;

  if (!name || !category || !description || !priceStr || !filesStr) {
    fmt.error('Usage: agent-marketplace publish-artifact --name <name> --category <cat> --description <desc> --price <price> --files <file1,file2>');
    process.exitCode = 1;
    return;
  }

  const price = parseFloat(priceStr);
  const filePaths = filesStr.split(',').map(f => f.trim());

  // Read file contents
  const fileContents = [];
  for (const fp of filePaths) {
    const resolved = path.resolve(fp);
    try {
      fs.accessSync(resolved, fs.constants.R_OK);
      fileContents.push(path.basename(fp));
    } catch {
      fmt.error(`Cannot read file: ${fp}`);
      process.exitCode = 1;
      return;
    }
  }

  fmt.info(`Publishing artifact "${name}" ...`);

  const result = await client.publishArtifact(
    name,
    description,
    category,
    fileContents,
    price,
    { version: '1.0.0' }
  );

  const slug = result.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  console.log();
  fmt.success(`Artifact published!`);
  fmt.kvBlock([
    ['Slug', slug],
    ['Version', result.version || '1.0.0'],
    ['Price', fmt.price(price)],
    ['Files', fileContents.join(', ')],
  ]);
  console.log();
}

module.exports = { run };
