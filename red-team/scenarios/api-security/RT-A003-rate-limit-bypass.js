'use strict';

const Scenario = require('../../framework/scenario');

/**
 * RT-A003: Rate Limit Bypass via Sybil Registrations
 *
 * Hypothesis: Attacker can bypass rate limits via Sybil registrations.
 *
 * Attack: Try to register 20 nodes from the same endpoint prefix in 5 minutes.
 * Check how many succeed.
 *
 * Pass: <= 5 succeed (rate limit holds)
 * Fail: >5 succeed
 */
class RateLimitBypass extends Scenario {
  constructor() {
    super(
      'RT-A003',
      'Rate Limit Bypass via Sybil Registration',
      'Attacker can bypass rate limits via Sybil registrations'
    );
  }

  async setup(baseUrl) {
    // No special setup needed
  }

  async execute(baseUrl, config) {
    const totalAttempts = 20;
    let successCount = 0;
    let rateLimited = 0;
    let otherFailures = 0;
    const registrationResults = [];

    // Strategy 1: Same endpoint prefix (should be caught by rate limiter)
    for (let i = 0; i < totalAttempts; i++) {
      const res = await this.fetch(baseUrl, '/nodes/register', {
        method: 'POST',
        body: {
          name: `sybil-node-${i}`,
          endpoint: `https://attacker.example.com/node-${i}`,
          deposit: 0.001,
        },
      });

      if (res.status === 201) {
        successCount++;
        registrationResults.push({ attempt: i, status: 'success', code: res.status });
      } else if (res.status === 429) {
        rateLimited++;
        registrationResults.push({ attempt: i, status: 'rate_limited', code: res.status });
      } else {
        otherFailures++;
        registrationResults.push({ attempt: i, status: 'other_failure', code: res.status });
      }
    }

    // Strategy 2: Try to bypass by varying the endpoint prefix
    let bypassAttempts = 0;
    let bypassSuccesses = 0;

    const domains = [
      'https://bypass1.evil.com/api',
      'https://bypass2.evil.com/api',
      'https://bypass3.evil.com/api',
      'https://bypass4.evil.com/api',
      'https://bypass5.evil.com/api',
      'https://bypass6.evil.com/api',
      'https://bypass7.evil.com/api',
      'https://bypass8.evil.com/api',
      'https://bypass9.evil.com/api',
      'https://bypass10.evil.com/api',
    ];

    for (const domain of domains) {
      bypassAttempts++;
      const res = await this.fetch(baseUrl, '/nodes/register', {
        method: 'POST',
        body: {
          name: `bypass-node-${bypassAttempts}`,
          endpoint: domain,
          deposit: 0.001,
        },
      });

      if (res.status === 201) {
        bypassSuccesses++;
      }
    }

    return {
      sameOrigin: {
        totalAttempts,
        successCount,
        rateLimited,
        otherFailures,
      },
      differentOrigin: {
        bypassAttempts,
        bypassSuccesses,
      },
      registrationResults: registrationResults.slice(0, 10), // sample
    };
  }

  assert(results) {
    const { sameOrigin, differentOrigin } = results;
    const sameOriginExceedsLimit = sameOrigin.successCount > 5;
    const bypassWorked = differentOrigin.bypassSuccesses > 5;

    // The test passes if same-origin rate limiting works (<=5 succeed)
    if (!sameOriginExceedsLimit) {
      let details = `Same-origin: ${sameOrigin.successCount}/${sameOrigin.totalAttempts} registrations succeeded (limit: 5). Rate limiting effective.`;
      if (bypassWorked) {
        details += ` WARNING: ${differentOrigin.bypassSuccesses}/${differentOrigin.bypassAttempts} bypass attempts with different origins succeeded. Rate limit is per-origin only.`;
      }
      return {
        pass: true,
        metric: sameOrigin.successCount,
        threshold: 5,
        details,
        severity: bypassWorked ? 'low' : 'none',
      };
    }

    return {
      pass: false,
      metric: sameOrigin.successCount,
      threshold: 5,
      details: `VULNERABILITY: ${sameOrigin.successCount}/${sameOrigin.totalAttempts} same-origin registrations succeeded (limit: 5). Rate limiting is not enforced or can be trivially bypassed. Only ${sameOrigin.rateLimited} were rate-limited.`,
      severity: 'high',
    };
  }
}

module.exports = RateLimitBypass;
