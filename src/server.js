'use strict';

const fastify = require('fastify');
const cors = require('@fastify/cors');
const rateLimit = require('@fastify/rate-limit');
const db = require('./db');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

async function build() {
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

  // Health endpoint
  app.get('/health', async () => {
    return { success: true, data: { status: 'ok', timestamp: new Date().toISOString() }, error: null };
  });

  // Register route modules
  await app.register(require('./routes/content'));
  await app.register(require('./routes/artifacts'));
  await app.register(require('./routes/search'));
  await app.register(require('./routes/market'));
  await app.register(require('./routes/verify'));
  await app.register(require('./routes/nodes'));

  // Graceful shutdown
  const shutdown = () => {
    db.closeDb();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return app;
}

// Start server if run directly
if (require.main === module) {
  build().then(app => {
    app.listen({ port: PORT, host: HOST }, (err, address) => {
      if (err) {
        app.log.error(err);
        process.exit(1);
      }
      app.log.info(`Agent Marketplace server listening on ${address}`);
    });
  });
}

module.exports = { build };
