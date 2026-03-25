'use strict';

const db = require('../db');

async function marketRoutes(fastify, options) {
  // GET /trending?period=7d|30d
  fastify.get('/trending', async (request, reply) => {
    try {
      const period = request.query.period || '7d';
      const match = period.match(/^(\d+)d$/);
      if (!match) {
        return reply.code(400).send({ success: false, data: null, error: 'period must be in format Nd (e.g. 7d, 30d)' });
      }
      const days = parseInt(match[1], 10);
      const trending = db.getTrending(days);
      return { success: true, data: trending, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // GET /gaps?category=
  fastify.get('/gaps', async (request, reply) => {
    try {
      const { category } = request.query;
      const gaps = db.getGaps(category || null);
      return { success: true, data: gaps, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });
}

module.exports = marketRoutes;
