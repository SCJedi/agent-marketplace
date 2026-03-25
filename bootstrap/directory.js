'use strict';

const fastify = require('fastify');
const cors = require('@fastify/cors');

/**
 * Directory service — lightweight node registry on port 3000.
 * Agents hit this first to discover which marketplace nodes exist.
 */
async function buildDirectory() {
  const app = fastify({ logger: { level: 'warn' } });
  await app.register(cors, { origin: true });

  // In-memory node registry
  const nodes = [];

  // POST /directory/register — a node announces itself
  app.post('/directory/register', async (request, reply) => {
    const { name, endpoint, specialty, description, contentCount, artifactCount } = request.body || {};
    if (!name || !endpoint) {
      return reply.code(400).send({ success: false, error: 'name and endpoint required' });
    }
    // Upsert by endpoint
    const existing = nodes.findIndex(n => n.endpoint === endpoint);
    const entry = {
      name,
      endpoint,
      specialty: specialty || 'general',
      description: description || '',
      contentCount: contentCount || 0,
      artifactCount: artifactCount || 0,
      registeredAt: new Date().toISOString()
    };
    if (existing >= 0) {
      nodes[existing] = entry;
    } else {
      nodes.push(entry);
    }
    return { success: true, data: entry };
  });

  // GET /nodes — list all registered nodes
  app.get('/nodes', async (request, reply) => {
    const { specialty } = request.query;
    let result = nodes;
    if (specialty) {
      result = nodes.filter(n => n.specialty === specialty);
    }
    return { success: true, data: result };
  });

  // GET /nodes/search?specialty= — alias for filtered /nodes
  app.get('/nodes/search', async (request, reply) => {
    const { specialty } = request.query;
    let result = nodes;
    if (specialty) {
      result = nodes.filter(n => n.specialty === specialty);
    }
    return { success: true, data: result };
  });

  // GET /health
  app.get('/health', async () => {
    return { success: true, data: { status: 'ok', nodeCount: nodes.length, timestamp: new Date().toISOString() } };
  });

  return app;
}

module.exports = { buildDirectory };
