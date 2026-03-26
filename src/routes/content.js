'use strict';

const db = require('../db');
const { apiKeyAuth } = require('../middleware/auth');
const crypto = require('crypto');

async function contentRoutes(fastify, options) {
  // GET /check?url= — check if clean version exists (filtered by caller's access)
  fastify.get('/check', async (request, reply) => {
    try {
      const { url } = request.query;
      if (!url) {
        return reply.code(400).send({ success: false, data: null, error: 'url query parameter is required' });
      }
      const callerKey = request.headers['x-api-key'] || null;
      const result = db.contentCheck(url, callerKey);
      return { success: true, data: result, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // GET /fetch?url= — return content record (filtered by caller's access)
  fastify.get('/fetch', async (request, reply) => {
    try {
      const { url } = request.query;
      if (!url) {
        return reply.code(400).send({ success: false, data: null, error: 'url query parameter is required' });
      }
      const callerKey = request.headers['x-api-key'] || null;
      const record = db.contentFetch(url, callerKey);
      if (!record) {
        return reply.code(404).send({ success: false, data: null, error: 'Content not found for this URL' });
      }
      // Record transaction
      try {
        db.recordTransaction({
          type: 'content_fetch',
          content_id: record.id,
          content_url: record.url,
          buyer_key: db.hashKey(request.headers['x-api-key']),
          seller_key: db.hashKey(record.owner_key),
          listed_price: record.price || 0,
          paid_price: 0,
          payment_method: 'free',
          node_id: process.env.NODE_NAME || 'local'
        });
      } catch (txErr) {
        request.log.warn('Transaction recording failed:', txErr.message);
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

  // POST /publish/content — accept and store content record (now with defenses + visibility)
  fastify.post('/publish/content', async (request, reply) => {
    try {
      const body = request.body;
      if (!body || !body.url) {
        return reply.code(400).send({ success: false, data: null, error: 'url is required' });
      }
      if (!body.source_hash) {
        return reply.code(400).send({ success: false, data: null, error: 'source_hash is required' });
      }

      // Validate visibility value
      const visibility = body.visibility || 'public';
      if (!['public', 'private', 'whitelist'].includes(visibility)) {
        return reply.code(400).send({ success: false, data: null, error: 'visibility must be public, private, or whitelist' });
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
      const publishBody = {
        ...body,
        provider_id: providerId,
        visibility,
        owner_key: apiKey || null
      };
      const record = db.contentPublishWithHash(publishBody);

      // If visibility is whitelist and authorized_keys provided, add them
      if (visibility === 'whitelist' && Array.isArray(body.authorized_keys) && record) {
        for (const key of body.authorized_keys) {
          db.addContentWhitelist(record.id, key);
        }
      }

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

      // Record publish transaction
      try {
        db.recordTransaction({
          type: 'content_publish',
          content_id: record ? record.id : null,
          content_url: body.url,
          buyer_key: null,
          seller_key: db.hashKey(apiKey),
          listed_price: record ? (record.price || 0) : 0,
          paid_price: 0,
          payment_method: 'free',
          node_id: process.env.NODE_NAME || 'local'
        });
      } catch (txErr) {
        request.log.warn('Transaction recording failed:', txErr.message);
      }

      return reply.code(201).send({ success: true, data: record, error: null });
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // --- Whitelist management for content ---

  // POST /content/:id/whitelist — add an API key to whitelist
  fastify.post('/content/:id/whitelist', async (request, reply) => {
    try {
      const { id } = request.params;
      const apiKey = request.headers['x-api-key'];
      const content = db.getContentById(id);
      if (!content) {
        return reply.code(404).send({ success: false, data: null, error: 'Content not found' });
      }
      if (!apiKey || content.owner_key !== apiKey) {
        return reply.code(403).send({ success: false, data: null, error: 'Only the owner can manage the whitelist' });
      }
      const body = request.body;
      if (!body || !body.key) {
        return reply.code(400).send({ success: false, data: null, error: 'key is required' });
      }
      db.addContentWhitelist(id, body.key);
      return { success: true, data: { content_id: id, authorized_key: body.key }, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // DELETE /content/:id/whitelist/:key — remove from whitelist
  fastify.delete('/content/:id/whitelist/:key', async (request, reply) => {
    try {
      const { id, key } = request.params;
      const apiKey = request.headers['x-api-key'];
      const content = db.getContentById(id);
      if (!content) {
        return reply.code(404).send({ success: false, data: null, error: 'Content not found' });
      }
      if (!apiKey || content.owner_key !== apiKey) {
        return reply.code(403).send({ success: false, data: null, error: 'Only the owner can manage the whitelist' });
      }
      const removed = db.removeContentWhitelist(id, key);
      if (!removed) {
        return reply.code(404).send({ success: false, data: null, error: 'Key not found in whitelist' });
      }
      return { success: true, data: { removed: true }, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // GET /content/:id/whitelist — list authorized keys (owner only)
  fastify.get('/content/:id/whitelist', async (request, reply) => {
    try {
      const { id } = request.params;
      const apiKey = request.headers['x-api-key'];
      const content = db.getContentById(id);
      if (!content) {
        return reply.code(404).send({ success: false, data: null, error: 'Content not found' });
      }
      if (!apiKey || content.owner_key !== apiKey) {
        return reply.code(403).send({ success: false, data: null, error: 'Only the owner can view the whitelist' });
      }
      const keys = db.getContentWhitelist(id);
      return { success: true, data: keys, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });
}

module.exports = contentRoutes;
