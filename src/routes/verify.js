'use strict';

const db = require('../db');

async function verifyRoutes(fastify, options) {
  // POST /verify/request — publisher pays fee, creates verification request
  fastify.post('/verify/request', async (request, reply) => {
    try {
      const body = request.body;
      if (!body || !body.artifact_id) {
        return reply.code(400).send({ success: false, data: null, error: 'artifact_id is required' });
      }
      if (!body.publisher_id) {
        return reply.code(400).send({ success: false, data: null, error: 'publisher_id is required' });
      }

      // Verify artifact exists
      const artifact = db.getDb().prepare('SELECT id FROM artifacts WHERE id = ?').get(body.artifact_id);
      if (!artifact) {
        return reply.code(404).send({ success: false, data: null, error: 'Artifact not found' });
      }

      // Create verification request first to get ID for assignment tracking
      const verificationRequest = db.createVerificationRequest(body.artifact_id, body.publisher_id, body.fee || 0);

      // Select 3 verifiers from pool, EXCLUDING the publisher (prevents self-verification)
      // Also deduplicates by domain to limit Sybil control
      const verifiers = db.selectVerifiersForRequest(3, body.publisher_id, verificationRequest.id);
      if (verifiers.length === 0) {
        return reply.code(503).send({ success: false, data: null, error: 'No eligible verifiers available in the pool (publisher excluded)' });
      }

      return reply.code(201).send({
        success: true,
        data: {
          request: verificationRequest,
          assigned_verifiers: verifiers.map(v => ({ id: v.id, endpoint: v.endpoint }))
        },
        error: null
      });
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // GET /verify/pending — verifiers check for assigned work
  fastify.get('/verify/pending', async (request, reply) => {
    try {
      const pending = db.getPendingVerifications();
      return { success: true, data: pending, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // POST /verify/submit — verifier submits pass/fail + report
  fastify.post('/verify/submit', async (request, reply) => {
    try {
      const body = request.body;
      if (!body || !body.request_id) {
        return reply.code(400).send({ success: false, data: null, error: 'request_id is required' });
      }
      if (!body.verifier_id) {
        return reply.code(400).send({ success: false, data: null, error: 'verifier_id is required' });
      }
      if (body.passed === undefined) {
        return reply.code(400).send({ success: false, data: null, error: 'passed (boolean) is required' });
      }

      // Verify the request exists and is pending
      const vr = db.getDb().prepare('SELECT * FROM verification_requests WHERE id = ?').get(body.request_id);
      if (!vr) {
        return reply.code(404).send({ success: false, data: null, error: 'Verification request not found' });
      }
      if (vr.status !== 'pending') {
        return reply.code(409).send({ success: false, data: null, error: `Verification request already ${vr.status}` });
      }

      // Verify that the submitting verifier was actually assigned to this request
      if (!db.isVerifierAssigned(body.request_id, body.verifier_id)) {
        return reply.code(403).send({ success: false, data: null, error: 'Verifier was not assigned to this verification request' });
      }

      const result = db.submitVerificationResult(body.request_id, body.verifier_id, body.passed, body.report || {});
      return reply.code(201).send({ success: true, data: result, error: null });
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // POST /verify/pool/join — verifier stakes and joins pool
  fastify.post('/verify/pool/join', async (request, reply) => {
    try {
      const body = request.body;
      if (!body || !body.endpoint) {
        return reply.code(400).send({ success: false, data: null, error: 'endpoint is required' });
      }

      const verifier = db.joinVerifierPool(body.endpoint, body.stake_amount || 0);
      return reply.code(201).send({ success: true, data: verifier, error: null });
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // POST /verify/pool/leave — verifier leaves, returns stake
  fastify.post('/verify/pool/leave', async (request, reply) => {
    try {
      const body = request.body;
      if (!body || !body.verifier_id) {
        return reply.code(400).send({ success: false, data: null, error: 'verifier_id is required' });
      }

      const verifier = db.leaveVerifierPool(body.verifier_id);
      if (!verifier) {
        return reply.code(404).send({ success: false, data: null, error: 'Verifier not found' });
      }
      return {
        success: true,
        data: { verifier_id: verifier.id, stake_returned: verifier.stake_amount },
        error: null
      };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });
}

module.exports = verifyRoutes;
