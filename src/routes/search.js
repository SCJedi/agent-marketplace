'use strict';

const db = require('../db');

async function searchRoutes(fastify, options) {
  // GET /search?q=&type=&category=&language=&license=&max_age=&budget=&sort=
  fastify.get('/search', async (request, reply) => {
    try {
      const { q, type, category, language, license, max_age, budget, sort } = request.query;
      if (!q) {
        return reply.code(400).send({ success: false, data: null, error: 'q query parameter is required' });
      }

      let results = [];

      // Search content (Layer 1) unless type filter excludes it
      if (!type || type === 'content') {
        const maxAgeDays = max_age ? parseInt(max_age, 10) : null;
        const contentResults = db.searchContent(q, maxAgeDays);
        results = results.concat(contentResults);
      }

      // Search artifacts (Layer 2) unless type filter excludes it
      if (!type || type === 'artifact') {
        const artifactResults = db.searchArtifacts(q, category, language, license);
        results = results.concat(artifactResults);
      }

      // Filter by budget
      if (budget) {
        const maxBudget = parseFloat(budget);
        results = results.filter(r => (r.price || 0) <= maxBudget);
      }

      // DEFENSE: Demote results from flagged/new providers
      for (const r of results) {
        r._rankScore = 1.0;

        if (r.provider_id) {
          // Check if provider is flagged
          if (db.nodeIsFlagged(r.provider_id)) {
            r._rankScore *= 0.3; // Heavily demote flagged providers
          }

          // Check provider age/volume
          const nodeAge = db.nodeGetAge(r.provider_id);
          if (nodeAge) {
            if (nodeAge.probation_remaining > 0) {
              r._rankScore *= 0.5; // Demote new providers still on probation
            }
            // Boost established providers with volume
            if (nodeAge.publish_count > 20) {
              r._rankScore *= 1.2;
            }
          }

          // Penalize providers with content flags
          const flagCount = db.getProviderFlagCount(r.provider_id);
          if (flagCount > 0) {
            r._rankScore *= Math.max(0.1, 1 - (flagCount * 0.1));
          }
        }
      }

      // Sort results
      if (sort === 'price') {
        results.sort((a, b) => (a.price || 0) - (b.price || 0));
      } else if (sort === 'freshness') {
        results.sort((a, b) => {
          const dateA = a.fetched_at || a.updated_at || a.created_at || '';
          const dateB = b.fetched_at || b.updated_at || b.created_at || '';
          return dateB.localeCompare(dateA);
        });
      } else if (sort === 'popularity') {
        results.sort((a, b) => (b.download_count || 0) - (a.download_count || 0));
      } else {
        // Default: relevance with rank score adjustment
        results.sort((a, b) => (b._rankScore || 1) - (a._rankScore || 1));
      }

      // Log search query (Layer 3 data) — include agent identifier for trending dedup
      const agentId = request.headers['x-api-key']
        || request.headers['x-agent-id']
        || request.ip
        || null;
      db.logSearch(q, type || null, category || null, results.length, agentId);

      return { success: true, data: { results, total: results.length }, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });
}

module.exports = searchRoutes;
