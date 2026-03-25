'use strict';

/**
 * Hardcoded seed nodes for bootstrap peer discovery.
 * Only needed for initial discovery — once a node knows other peers,
 * it doesn't need seeds anymore. Like Bitcoin's dns-seed list.
 */
module.exports = [
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3003',
  // In production, these would be public endpoints:
  // 'https://seed1.agentmarketplace.io',
  // 'https://seed2.agentmarketplace.io',
  // 'https://seed3.agentmarketplace.io',
];
