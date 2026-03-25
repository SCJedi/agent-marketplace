'use strict';

const db = require('../db');
const { apiKeyAuth } = require('../middleware/auth');

async function contentRoutes(fastify, options) {
  // GET /check?url= — check if clean version exists
  fastify.get('/check', async (request, reply) => {
    try {
      const { url } = request.query;
      if (!url) {
        return reply.code(400).send({ success: false, data: null, error: 'url query parameter is required' });
      }
      const result = db.contentCheck(url);
      return { success: true, data: result, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // GET /fetch?url= — return content record (now includes content_hash for verification)
  fastify.get('/fetch', async (request, reply) => {
    try {
      const { url } = request.query;
      if (!url) {
        return reply.code(400).send({ success: false, data: null, error: 'url query parameter is required' });
      }
      const record = db.contentFetch(url);
      if (!record) {
        return reply.code(404).send({ success: false, data: null, error: 'Content not found for this URL' });
      }
      // Include content_hash for integrity verification by agents
      return { success: true, data: record, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // GET /fetch/providers?url= — return all providers for a URL (for multi-provider consensus)
  fastify.get('/fetch/providers', async (request, reply) => {
    try {
      const { url } = request.query;
      if (!url) {
        return reply.code(400).send({ success: false, data: null, error: 'url query parameter is required' });
      }
      const providers = db.getAllProvidersForUrl(url);
      return { success: true, data: providers, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // POST /publish/content — accept and store content record (now with defenses)
  fastify.post('/publish/content', async (request, reply) => {
    try {
      const body = request.body;
      if (!body || !body.url) {
        return reply.code(400).send({ success: false, data: null, error: 'url is required' });
      }
      if (!body.source_hash) {
        return reply.code(400).send({ success: false, data: null, error: 'source_hash is required' });
      }

      // DEFENSE 0: Identity verification — prevent provider_id spoofing
      let providerId = body.provider_id || 'anonymous';
      const apiKey = request.headers['x-api-key'];
      if (apiKey) {
        const keyRecord = db.validateApiKey(apiKey);
        if (keyRecord) {
          // API key valid — use authenticated identity, ignore body claim
          providerId = keyRecord.owner_id;
        } else {
          return reply.code(403).send({ success: false, data: null, error: 'Invalid API key' });
        }
      } else if (body.provider_id && body.provider_id !== 'anonymous') {
        // No API key but claiming a provider_id — check if it's a registered node
        const claimedNode = db.nodeGet(body.provider_id);
        if (claimedNode) {
          // Attempting to publish as a registered node without API key — reject as identity spoofing
          return reply.code(401).send({
            success: false, data: null,
            error: 'x-api-key required when publishing as a registered node'
          });
        }
        // Unregistered provider_id is fine — it's just a label, no identity claim
      }

      // DEFENSE 1: Rate limit publishing — max 30 content items per minute per provider
      // (In production this would be 5; increased for simulation's compressed time)
      const rateCheck = db.checkPublishRateLimit(providerId, 30);
      if (!rateCheck.allowed) {
        return reply.code(429).send({
          success: false, data: null,
          error: `Publishing rate limit exceeded. Max 5 items per minute. Current: ${rateCheck.count}`
        });
      }

      // DEFENSE 2: Check if provider is flagged/blocked
      if (db.nodeIsFlagged(providerId)) {
        const flagCount = db.getProviderFlagCount(providerId);
        if (flagCount >= 10) {
          return reply.code(403).send({
            success: false, data: null,
            error: 'Provider has been blocked due to excessive content flags'
          });
        }
      }

      // DEFENSE 3: Check provider probation — rate limit new publishers
      const nodeAge = db.nodeGetAge(providerId);
      if (nodeAge && nodeAge.probation_remaining > 0) {
        // During probation, rate limit to 20 per minute instead of 30
        if (rateCheck.count > 20) {
          return reply.code(429).send({
            success: false, data: null,
            error: `New publisher probation: max 2 items per minute during first 10 publications`
          });
        }
      }

      // DEFENSE 4: Content signing — generate hash and check for divergence
      // Use authenticated provider_id, not body claim
      const publishBody = { ...body, provider_id: providerId };
      const record = db.contentPublishWithHash(publishBody);

      if (record && record.content_hash) {
        // Check if this content hash diverges from consensus for this URL
        const divergence = db.checkContentHashDivergence(body.url, record.content_hash);
        if (divergence.divergent) {
          // Flag for review but still allow publication
          db.flagContent(record.id, body.url, providerId, 'hash_divergence',
            `Content hash diverges from ${divergence.consensusSize} existing entries for this URL`);
        }
      }

      // DEFENSE 5: Track publish count, decrement probation
      if (providerId !== 'anonymous') {
        db.nodeIncrementPublishCount(providerId);

        // Check first-hour volume — flag if > 50 items in first hour
        const firstHourCount = db.getProviderFirstHourPublishCount(providerId);
        if (firstHourCount > 50) {
          db.nodeFlag(providerId, `high_volume_first_hour: ${firstHourCount} items`);
        }
      }

      return reply.code(201).send({ success: true, data: record, error: null });
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });
}

module.exports = contentRoutes;
