'use strict';

const fmt = require('../formatter');

/**
 * Show trending content and artifacts.
 * @param {import('../../sdk/js/src/client').Marketplace} client
 * @param {object} opts
 */
async function run(client, opts = {}) {
  const period = opts.period || '7d';

  const data = await client.trending(period);

  console.log();
  fmt.info(`Trending (${period})`);
  console.log();

  // Trending content
  const content = data.trending_content || data.content || [];
  if (content.length > 0) {
    console.log(fmt.c.bold + '  Content' + fmt.c.reset);
    const headers = ['#', 'URL/Title', 'Fetches', 'Price'];
    const rows = content.map((r, i) => [
      String(i + 1),
      (r.title || r.url || '-').slice(0, 40),
      String(r.fetch_count_24h || r.fetch_count || r.downloads || 0),
      fmt.price(r.price || r.price_tokens || 0),
    ]);
    fmt.table(headers, rows);
    console.log();
  }

  // Trending artifacts
  const artifacts = data.trending_artifacts || data.artifacts || [];
  if (artifacts.length > 0) {
    console.log(fmt.c.bold + '  Artifacts' + fmt.c.reset);
    const headers = ['#', 'Name', 'Downloads', 'Trend'];
    const rows = artifacts.map((r, i) => [
      String(i + 1),
      (r.name || r.slug || '-').slice(0, 35),
      String(r.download_count_24h || r.downloads || 0),
      r.trend_direction || '-',
    ]);
    fmt.table(headers, rows);
    console.log();
  }

  if (content.length === 0 && artifacts.length === 0) {
    fmt.info('No trending data yet. The marketplace needs more activity.');
  }
}

module.exports = { run };
