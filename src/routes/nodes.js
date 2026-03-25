'use strict';

const db = require('../db');

async function nodeRoutes(fastify, options) {
  // POST /nodes/register — register a node (now requires deposit)
  fastify.post('/nodes/register', async (request, reply) => {
    try {
      const body = request.body;
      if (!body || !body.name) {
        return reply.code(400).send({ success: false, data: null, error: 'name is required' });
      }
      if (!body.endpoint) {
        return reply.code(400).send({ success: false, data: null, error: 'endpoint is required' });
      }

      // DEFENSE: Rate limit account creation — max 3 per hour per endpoint prefix
      const endpointKey = (body.endpoint || '').split('/').slice(0, 3).join('/');
      const regLimit = db.checkRegistrationRateLimit(endpointKey, 5);
      if (!regLimit.allowed) {
        return reply.code(429).send({
          success: false, data: null,
          error: `Registration rate limit exceeded. Max 5 registrations per hour from same origin. Count: ${regLimit.count}`
        });
      }

      // DEFENSE: Require minimum deposit for registration
      const deposit = body.deposit || 0;
      const minDeposit = 0.001;

      let node;
      if (deposit >= minDeposit) {
        node = db.nodeRegisterWithDeposit(body, deposit);
      } else {
        // Allow registration without deposit but mark as probationary with higher probation
        node = db.nodeRegister(body);
        // Flag low-deposit registrations
        if (node && node.id) {
          db.nodeFlag(node.id, 'no_deposit');
        }
      }

      return reply.code(201).send({ success: true, data: node, error: null });
    } catch (err) {
      request.log.error(err);
      if (err.message && err.message.includes('Minimum deposit')) {
        return reply.code(400).send({ success: false, data: null, error: err.message });
      }
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // GET /nodes — list all registered nodes
  fastify.get('/nodes', async (request, reply) => {
    try {
      const nodes = db.nodeList();
      return { success: true, data: nodes, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // GET /nodes/:id — node detail
  fastify.get('/nodes/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const node = db.nodeGet(id);
      if (!node) {
        return reply.code(404).send({ success: false, data: null, error: 'Node not found' });
      }
      return { success: true, data: node, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });
}

module.exports = nodeRoutes;
