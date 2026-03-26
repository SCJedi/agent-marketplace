'use strict';

const db = require('../db');

async function marketRoutes(fastify, options) {
  // GET /trending?period=7d|30d
  fastify.get('/trending', async (request, reply) => {
    try {
      const period = request.query.period || '7d';
      const dayMatch = period.match(/^(\d+)d$/);
      const hourMatch = period.match(/^(\d+)h$/);
      if (!dayMatch && !hourMatch) {
        return reply.code(400).send({ success: false, data: null, error: 'period must be in format Nd or Nh (e.g. 1h, 24h, 7d, 30d)' });
      }
      // Convert hours to fractional days for the DB query
      const days = dayMatch ? parseInt(dayMatch[1], 10) : parseInt(hourMatch[1], 10) / 24;
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
