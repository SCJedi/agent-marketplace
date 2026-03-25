'use strict';

const Scenario = require('../../framework/scenario');

/**
 * RT-A001: Identity Spoofing
 *
 * Hypothesis: An unauthenticated caller can publish content claiming any provider_id.
 *
 * Attack: Register node N1 with deposit, get its ID.
 * Then publish content with provider_id = N1's ID but WITHOUT N1's API key.
 * Check if content is accepted.
 *
 * Pass: 0% of spoofed publications succeed
 * Fail: >0% succeed
 */
class IdentitySpoofing extends Scenario {
  constructor() {
    super(
      'RT-A001',
      'Identity Spoofing',
      'An unauthenticated caller can publish content claiming any provider_id'
    );
    this.node = null;
  }

  async setup(baseUrl) {
    // Register a legitimate node with deposit
    this.node = await this.registerNode(baseUrl, 'legitimate-node', 0.01);
    if (!this.node) {
      throw new Error('Failed to register legitimate node');
    }
  }

  async execute(baseUrl, config) {
    const attempts = 100;
    let spoofedSuccessCount = 0;
    let spoofedAttempts = 0;
    const details = [];

    for (let i = 0; i < attempts; i++) {
      // Attempt to publish content claiming to be the legitimate node
      // WITHOUT providing the node's API key
      const res = await this.fetch(baseUrl, '/publish/content', {
        method: 'POST',
        body: {
          url: `https://example.com/spoofed-content-${i}`,
          source_hash: `spoofhash${i}`,
          content_text: `Spoofed content attempt ${i}`,
          provider_id: this.node.id,  // Claiming to be the legitimate node
          price: 0.001,
          // NOTE: No API key provided — this is the attack
        },
      });

      spoofedAttempts++;

      if (res.status === 201) {
        // Content was accepted despite no authentication
        spoofedSuccessCount++;
        if (details.length < 5) {
          details.push({ attempt: i, status: res.status, accepted: true });
        }
      }
    }

    return {
      spoofedAttempts,
      spoofedSuccessCount,
      spoofedSuccessRate: spoofedSuccessCount / spoofedAttempts,
      sampleDetails: details,
    };
  }

  assert(results) {
    const { spoofedSuccessRate, spoofedSuccessCount, spoofedAttempts } = results;

    if (spoofedSuccessCount === 0) {
      return {
        pass: true,
        metric: spoofedSuccessRate,
        threshold: 0,
        details: `0/${spoofedAttempts} spoofed publications succeeded. Identity spoofing is blocked.`,
        severity: 'none',
      };
    }

    return {
      pass: false,
      metric: spoofedSuccessRate,
      threshold: 0,
      details: `VULNERABILITY: ${spoofedSuccessCount}/${spoofedAttempts} (${(spoofedSuccessRate * 100).toFixed(1)}%) spoofed publications succeeded. The /publish/content endpoint does NOT verify that the caller owns the claimed provider_id. Any caller can publish content impersonating any registered node.`,
      severity: 'critical',
    };
  }
}

module.exports = IdentitySpoofing;
