'use strict';

const db = require('../db');

async function reputationRoutes(fastify, options) {
  // GET /reputation/:key — Public reputation for any participant
  fastify.get('/reputation/:key', async (request, reply) => {
    try {
      const { key } = request.params;
      if (!key) {
        return reply.code(400).send({ success: false, data: null, error: 'key parameter is required' });
      }
      const reputation = db.getReputationScore(key);
      return { success: true, data: reputation, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // GET /transactions — Transaction ledger (public, pseudonymous)
  fastify.get('/transactions', async (request, reply) => {
    try {
      const filters = {
        type: request.query.type || null,
        buyer: request.query.buyer || null,
        seller: request.query.seller || null,
        content_url: request.query.content_url || null,
        from_date: request.query.from_date || null,
        to_date: request.query.to_date || null,
        limit: request.query.limit || 100
      };

      const transactions = db.getTransactions(filters);
      const stats = db.getTransactionStats();

      // Map transactions for public display (pseudonymous)
      const publicTx = transactions.map(tx => ({
        id: tx.id,
        type: tx.type,
        content_url: tx.content_url,
        buyer: tx.buyer_key || 'anonymous',
        seller: tx.seller_key || 'anonymous',
        listed_price: tx.listed_price,
        paid_price: tx.paid_price,
        payment_method: tx.payment_method,
        timestamp: tx.timestamp,
        node: tx.node_id
      }));

      return {
        success: true,
        data: {
          transactions: publicTx,
          total: stats.totalTransactions,
          volume: stats.volume
        },
        error: null
      };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // GET /transactions/stats — Network-level transaction stats
  fastify.get('/transactions/stats', async (request, reply) => {
    try {
      const stats = db.getTransactionStats();
      const priceHistory = db.getTransactionVolume('day');

      return {
        success: true,
        data: {
          ...stats,
          priceHistory
        },
        error: null
      };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // GET /transactions/volume/:period — Transaction volume over time
  fastify.get('/transactions/volume/:period', async (request, reply) => {
    try {
      const { period } = request.params;
      if (!['day', 'week', 'month'].includes(period)) {
        return reply.code(400).send({ success: false, data: null, error: 'period must be day, week, or month' });
      }
      const volume = db.getTransactionVolume(period);
      return { success: true, data: volume, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // GET /price-history — Price history for a specific URL
  fastify.get('/price-history', async (request, reply) => {
    try {
      const { url } = request.query;
      if (!url) {
        return reply.code(400).send({ success: false, data: null, error: 'url query parameter is required' });
      }
      const history = db.getPriceHistory(url);
      return { success: true, data: history, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });
}

module.exports = reputationRoutes;
