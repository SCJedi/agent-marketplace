'use strict';

const fmt = require('../formatter');

/**
 * Search the marketplace for content and artifacts.
 * @param {import('../../sdk/js/src/client').Marketplace} client
 * @param {string} query
 * @param {object} opts
 */
async function run(client, query, opts = {}) {
  if (!query) {
    fmt.error('Usage: agent-marketplace search <query> [--type content|artifact] [--lang <lang>] [--sort relevance|price|recent]');
    process.exitCode = 1;
    return;
  }

  const searchOpts = {};
  if (opts.type) searchOpts.type = opts.type;
  if (opts.lang) searchOpts.language = opts.lang;
  if (opts.sort) searchOpts.sort = opts.sort;

  const results = await client.search(query, searchOpts);

  console.log();
  fmt.info(`Search results for "${query}" (${results.length} found)`);
  console.log();

  if (results.length === 0) {
    fmt.info('No results found. Try a broader query.');
    return;
  }

  const headers = ['#', 'Type', 'Name', 'Price', 'Score', 'Source'];
  const rows = results.map((r, i) => {
    const name = r.type === 'content'
      ? (r.url || r.name || '-')
      : (r.name || r.slug || '-');
    const source = r.type === 'content'
      ? (r.provider || 'WebClean')
      : ('@' + (r.author || r.slug || 'unknown'));
    return [
      String(i + 1),
      r.type || 'content',
      name.length > 30 ? name.slice(0, 27) + '...' : name,
      fmt.price(r.price || r.price_tokens || 0),
      r.score !== undefined ? r.score.toFixed(2) : '-',
      source,
    ];
  });

  fmt.table(headers, rows);
  console.log();
}

module.exports = { run };
