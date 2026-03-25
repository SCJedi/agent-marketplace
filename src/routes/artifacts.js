'use strict';

const db = require('../db');

async function artifactRoutes(fastify, options) {
  // POST /publish/artifact — create artifact listing
  fastify.post('/publish/artifact', async (request, reply) => {
    try {
      const body = request.body;
      if (!body || !body.name) {
        return reply.code(400).send({ success: false, data: null, error: 'name is required' });
      }
      if (!body.slug) {
        return reply.code(400).send({ success: false, data: null, error: 'slug is required' });
      }

      // Check slug uniqueness
      const existing = db.artifactGetBySlug(body.slug);
      if (existing) {
        return reply.code(409).send({ success: false, data: null, error: `Artifact with slug '${body.slug}' already exists` });
      }

      const artifact = db.artifactCreate(body);
      return reply.code(201).send({ success: true, data: artifact, error: null });
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // GET /artifacts/:slug — get artifact detail
  fastify.get('/artifacts/:slug', async (request, reply) => {
    try {
      const { slug } = request.params;
      const artifact = db.artifactGetBySlug(slug);
      if (!artifact) {
        return reply.code(404).send({ success: false, data: null, error: 'Artifact not found' });
      }
      return { success: true, data: artifact, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // GET /artifacts/:slug/download — serve artifact data
  fastify.get('/artifacts/:slug/download', async (request, reply) => {
    try {
      const { slug } = request.params;
      const artifact = db.artifactGetBySlug(slug);
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
}

module.exports = artifactRoutes;
