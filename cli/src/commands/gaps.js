'use strict';

const fmt = require('../formatter');

/**
 * Show unmet demand — searches with no results.
 * @param {import('../../sdk/js/src/client').Marketplace} client
 * @param {object} opts
 */
async function run(client, opts = {}) {
  const category = opts.category || undefined;

  const gaps = await client.gaps(category);

  console.log();
  fmt.info(`Market gaps${category ? ` (category: ${category})` : ''}`);
  console.log();

  if (!gaps || gaps.length === 0) {
    // gaps may be returned as { content_gaps, artifact_gaps } from the API
    fmt.info('No unmet demand detected. The marketplace is well-supplied.');
    return;
  }

  // If the API returns the nested format
  if (!Array.isArray(gaps) && (gaps.content_gaps || gaps.artifact_gaps)) {
    const cGaps = gaps.content_gaps || [];
    const aGaps = gaps.artifact_gaps || [];

    if (cGaps.length > 0) {
      console.log(fmt.c.bold + '  Content Gaps' + fmt.c.reset);
      const headers = ['#', 'URL', 'Requests', 'Value'];
      const rows = cGaps.map((g, i) => [
        String(i + 1),
        (g.url || g.query || '-').slice(0, 40),
        String(g.request_count || 0),
        g.estimated_value || '-',
      ]);
      fmt.table(headers, rows);
      console.log();
    }

    if (aGaps.length > 0) {
      console.log(fmt.c.bold + '  Artifact Gaps' + fmt.c.reset);
      const headers = ['#', 'Query', 'Searches', 'Closest Match'];
      const rows = aGaps.map((g, i) => [
        String(i + 1),
        (g.query || '-').slice(0, 30),
        String(g.search_count || 0),
        g.closest_match || 'none',
      ]);
      fmt.table(headers, rows);
      console.log();
    }
    return;
  }

  // Simple array of gaps
  const headers = ['#', 'Query', 'Count', 'Category'];
  const rows = gaps.map((g, i) => [
    String(i + 1),
    (g.query || g.url || '-').slice(0, 40),
    String(g.request_count || g.search_count || 0),
    g.category || '-',
  ]);
  fmt.table(headers, rows);
  console.log();
}

module.exports = { run };
