'use strict';

const fastify = require('fastify');
const cors = require('@fastify/cors');
const rateLimit = require('@fastify/rate-limit');
const db = require('./db');
const { PeerDiscovery } = require('./discovery');

const PORT = parseInt(process.env.PORT, 10) || 3001;
const HOST = process.env.HOST || '0.0.0.0';

let discovery = null;

async function build(options = {}) {
  const app = fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info'
    }
  });

  // CORS
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS']
  });

  // Rate limiting
  await app.register(rateLimit, {
    max: parseInt(process.env.RATE_LIMIT, 10) || 100,
    timeWindow: '1 minute'
  });

  // Health endpoint — includes peer count for network visibility
  app.get('/health', async () => {
    const peerCount = db.getPeerCount();
    return {
      success: true,
      data: {
        status: 'ok',
        timestamp: new Date().toISOString(),
        peers: peerCount
      },
      error: null
    };
  });

  // Root redirect to dashboard
  app.get('/', async (request, reply) => {
    return reply.redirect('/dashboard');
  });

  // Register route modules
  await app.register(require('./routes/content'));
  await app.register(require('./routes/artifacts'));
  await app.register(require('./routes/search'));
  await app.register(require('./routes/market'));
  await app.register(require('./routes/verify'));
  await app.register(require('./routes/nodes'));
  await app.register(require('./routes/dashboard'));
  await app.register(require('./routes/reputation'));

  // Peer discovery — start after server is listening
  const selfEndpoint = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
  const seedNodes = options.seedNodes || (process.env.SEED_NODES ? process.env.SEED_NODES.split(',') : undefined);

  discovery = new PeerDiscovery(db, selfEndpoint, {
    name: options.name || process.env.NODE_NAME || 'node',
    specialty: options.specialty || process.env.NODE_SPECIALTY || 'general',
    seedNodes,
    announceInterval: options.announceInterval,
    discoveryInterval: options.discoveryInterval,
    healthCheckInterval: options.healthCheckInterval,
  });

  // Expose discovery instance on app for testing
  app.discovery = discovery;

  // Graceful shutdown
  const shutdown = () => {
    if (discovery) discovery.stop();
    db.closeDb();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return app;
}

// Auto-open browser with the dashboard
function openBrowser(url) {
  if (process.env.OPEN_BROWSER === 'false') return;
  const { exec } = require('child_process');
  const platform = process.platform;
  if (platform === 'win32') exec(`start "" "${url}"`);
  else if (platform === 'darwin') exec(`open "${url}"`);
  else exec(`xdg-open "${url}" 2>/dev/null || true`);
}

// Start server if run directly
if (require.main === module) {
  build().then(app => {
    app.listen({ port: PORT, host: HOST }, (err, address) => {
      if (err) {
        app.log.error(err);
        process.exit(1);
      }
      const dashboardUrl = `http://localhost:${PORT}/dashboard`;
      app.log.info(`Agent Marketplace server listening on ${address}`);
      app.log.info(`Dashboard: ${dashboardUrl}`);
      console.log(`\n  Your node is running! Dashboard: ${dashboardUrl}\n`);
      // Start peer discovery after server is listening
      if (discovery) discovery.start();
      // Open dashboard in default browser
      openBrowser(dashboardUrl);
    });
  });
}

module.exports = { build };
