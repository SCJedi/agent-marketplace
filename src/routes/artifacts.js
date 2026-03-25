'use strict';

const db = require('../db');

async function artifactRoutes(fastify, options) {
  // POST /publish/artifact — create artifact listing (with visibility support)
  fastify.post('/publish/artifact', async (request, reply) => {
    try {
      const body = request.body;
      if (!body || !body.name) {
        return reply.code(400).send({ success: false, data: null, error: 'name is required' });
      }
      if (!body.slug) {
        return reply.code(400).send({ success: false, data: null, error: 'slug is required' });
      }

      // Validate visibility value
      const visibility = body.visibility || 'public';
      if (!['public', 'private', 'whitelist'].includes(visibility)) {
        return reply.code(400).send({ success: false, data: null, error: 'visibility must be public, private, or whitelist' });
      }

      // Check slug uniqueness (without access filter — slugs must be globally unique)
      const d = db.getDb();
      const existing = d.prepare(`SELECT id FROM artifacts WHERE slug = ?`).get(body.slug);
      if (existing) {
        return reply.code(409).send({ success: false, data: null, error: `Artifact with slug '${body.slug}' already exists` });
      }

      const apiKey = request.headers['x-api-key'] || null;
      const artifact = db.artifactCreate({
        ...body,
        visibility,
        owner_key: apiKey
      });

      // If visibility is whitelist and authorized_keys provided, add them
      if (visibility === 'whitelist' && Array.isArray(body.authorized_keys) && artifact) {
        for (const key of body.authorized_keys) {
          db.addArtifactWhitelist(artifact.id, key);
        }
      }

      return reply.code(201).send({ success: true, data: artifact, error: null });
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // GET /artifacts/:slug — get artifact detail (access-checked)
  fastify.get('/artifacts/:slug', async (request, reply) => {
    try {
      const { slug } = request.params;
      const callerKey = request.headers['x-api-key'] || null;
      const artifact = db.artifactGetBySlug(slug, callerKey);
      if (!artifact) {
        return reply.code(404).send({ success: false, data: null, error: 'Artifact not found' });
      }
      return { success: true, data: artifact, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // GET /artifacts/:slug/download — serve artifact data (access-checked)
  fastify.get('/artifacts/:slug/download', async (request, reply) => {
    try {
      const { slug } = request.params;
      const callerKey = request.headers['x-api-key'] || null;
      const artifact = db.artifactGetBySlug(slug, callerKey);
      if (!artifact) {
        return reply.code(404).send({ success: false, data: null, error: 'Artifact not found' });
      }
      db.artifactIncrementDownload(slug);
      return { success: true, data: artifact, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // PATCH /artifacts/:slug — update artifact
  fastify.patch('/artifacts/:slug', async (request, reply) => {
    try {
      const { slug } = request.params;
      const body = request.body;
      if (!body || Object.keys(body).length === 0) {
        return reply.code(400).send({ success: false, data: null, error: 'Request body is required' });
      }
      const updated = db.artifactUpdate(slug, body);
      if (!updated) {
        return reply.code(404).send({ success: false, data: null, error: 'Artifact not found' });
      }
      return { success: true, data: updated, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // --- Whitelist management for artifacts ---

  // POST /artifacts/:id/whitelist — add an API key to whitelist
  fastify.post('/artifacts/:id/whitelist', async (request, reply) => {
    try {
      const { id } = request.params;
      const apiKey = request.headers['x-api-key'];
      const artifact = db.getArtifactById(id);
      if (!artifact) {
        return reply.code(404).send({ success: false, data: null, error: 'Artifact not found' });
      }
      if (!apiKey || artifact.owner_key !== apiKey) {
        return reply.code(403).send({ success: false, data: null, error: 'Only the owner can manage the whitelist' });
      }
      const body = request.body;
      if (!body || !body.key) {
        return reply.code(400).send({ success: false, data: null, error: 'key is required' });
      }
      db.addArtifactWhitelist(id, body.key);
      return { success: true, data: { artifact_id: id, authorized_key: body.key }, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // DELETE /artifacts/:id/whitelist/:key — remove from whitelist
  fastify.delete('/artifacts/:id/whitelist/:key', async (request, reply) => {
    try {
      const { id, key } = request.params;
      const apiKey = request.headers['x-api-key'];
      const artifact = db.getArtifactById(id);
      if (!artifact) {
        return reply.code(404).send({ success: false, data: null, error: 'Artifact not found' });
      }
      if (!apiKey || artifact.owner_key !== apiKey) {
        return reply.code(403).send({ success: false, data: null, error: 'Only the owner can manage the whitelist' });
      }
      const removed = db.removeArtifactWhitelist(id, key);
      if (!removed) {
        return reply.code(404).send({ success: false, data: null, error: 'Key not found in whitelist' });
      }
      return { success: true, data: { removed: true }, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // GET /artifacts/:id/whitelist — list authorized keys (owner only)
  fastify.get('/artifacts/:id/whitelist', async (request, reply) => {
    try {
      const { id } = request.params;
      const apiKey = request.headers['x-api-key'];
      const artifact = db.getArtifactById(id);
      if (!artifact) {
        return reply.code(404).send({ success: false, data: null, error: 'Artifact not found' });
      }
      if (!apiKey || artifact.owner_key !== apiKey) {
        return reply.code(403).send({ success: false, data: null, error: 'Only the owner can view the whitelist' });
      }
      const keys = db.getArtifactWhitelist(id);
      return { success: true, data: keys, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });
}

module.exports = artifactRoutes;
