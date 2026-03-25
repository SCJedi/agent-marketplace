'use strict';

const fmt = require('../formatter');

/**
 * Fetch content for a URL from the marketplace.
 * @param {import('../../sdk/js/src/client').Marketplace} client
 * @param {string} url
 * @param {object} opts
 */
async function run(client, url, opts = {}) {
  if (!url) {
    fmt.error('Usage: agent-marketplace fetch <url> [--max-price <price>]');
    process.exitCode = 1;
    return;
  }

  const maxPrice = opts['max-price'] !== undefined ? parseFloat(opts['max-price']) : undefined;

  let record;
  if (maxPrice !== undefined) {
    record = await client.smartFetch(url, { maxPrice });
  } else {
    record = await client.fetch(url);
  }

  if (!record) {
    fmt.error(`Content not available for ${url}`);
    if (maxPrice !== undefined) {
      fmt.info('The content may exceed your max-price threshold.');
    }
    process.exitCode = 1;
    return;
  }

  console.log();
  fmt.success(`Fetched: ${url}`);
  console.log();

  const title = (record.metadata && record.metadata.title) || '-';
  const wordCount = record.text ? record.text.split(/\s+/).length : 0;

  fmt.kvBlock([
    ['Title', title],
    ['Words', String(wordCount)],
    ['Price', fmt.price(record.price)],
    ['Saved', fmt.price(record.tokenCostSaved)],
  ]);
  console.log();

  // Output content to stdout
  if (record.text) {
    console.log(record.text);
  }
}

module.exports = { run };
