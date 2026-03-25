'use strict';

const fmt = require('../formatter');

/**
 * Check if a URL is available on the marketplace.
 * @param {import('../../sdk/js/src/client').Marketplace} client
 * @param {string} url
 */
async function run(client, url) {
  if (!url) {
    fmt.error('Usage: agent-marketplace check <url>');
    process.exitCode = 1;
    return;
  }

  const result = await client.check(url);

  console.log();
  fmt.info(`Check: ${url}`);
  console.log();

  const available = result.available ? `${fmt.c.green}Yes${fmt.c.reset}` : `${fmt.c.red}No${fmt.c.reset}`;
  const marketPrice = parseFloat(result.price || result.price_tokens || 0);
  const selfCrawlCost = 0.001; // Estimated self-crawl cost

  const pairs = [
    ['Available', available],
    ['Price', fmt.price(marketPrice)],
    ['Freshness', result.freshness || '-'],
    ['Providers', String(result.providers || 0)],
  ];

  fmt.kvBlock(pairs);

  if (result.available && marketPrice > 0) {
    const savings = ((1 - marketPrice / selfCrawlCost) * 100).toFixed(0);
    console.log();
    fmt.info(`Marketplace: ${fmt.price(marketPrice)} vs Self-crawl: ~${fmt.price(selfCrawlCost)} (save ${savings}%)`);
  }
  console.log();
}

module.exports = { run };
