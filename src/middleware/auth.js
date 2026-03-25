'use strict';

const db = require('../db');

async function apiKeyAuth(request, reply) {
  const apiKey = request.headers['x-api-key'];
  if (!apiKey) {
    reply.code(401).send({ success: false, data: null, error: 'Missing x-api-key header' });
    return;
  }

  const keyRecord = db.validateApiKey(apiKey);
  if (!keyRecord) {
    reply.code(403).send({ success: false, data: null, error: 'Invalid API key' });
    return;
  }

  request.apiKeyOwner = keyRecord;
}

module.exports = { apiKeyAuth };
