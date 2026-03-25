'use strict';

const fmt = require('../formatter');

/**
 * Show connection status to the configured marketplace node.
 * @param {import('../../sdk/js/src/client').Marketplace} client
 * @param {object} config
 */
async function run(client, config = {}) {
  const nodeUrl = config.node || 'http://localhost:3000';

  fmt.info(`Checking connection to ${nodeUrl} ...`);
  console.log();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(`${nodeUrl.replace(/\/+$/, '')}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    const body = await resp.json();
    const data = body.data || body;

    fmt.success('Connected');
    fmt.kvBlock([
      ['Node', nodeUrl],
      ['Status', data.status || 'ok'],
      ['Config', config._source || '(defaults)'],
    ]);

    // Try to get stats from search endpoint
    try {
      const stats = await client.search('', {});
      fmt.kvBlock([
        ['Indexed items', String(stats.length || 0)],
      ]);
    } catch {
      // Stats not available — that's fine
    }
  } catch (err) {
    fmt.error(`Cannot connect to ${nodeUrl}`);
    fmt.info(err.message || 'Connection refused');
    fmt.info('Make sure the node is running: node src/server.js');
    process.exitCode = 1;
  }
  console.log();
}

module.exports = { run };
