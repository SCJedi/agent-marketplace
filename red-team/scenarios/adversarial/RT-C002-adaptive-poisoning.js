'use strict';

const Scenario = require('../../framework/scenario');
const MetricsCollector = require('../../framework/metrics-collector');
const Harness = require('../../framework/harness');
const AdaptiveAttacker = require('../../agents/adaptive-attacker');
const crypto = require('crypto');

class AdaptivePoisoningScenario extends Scenario {
  constructor() {
    super(
      'RT-C002',
      'Adaptive Cache Poisoning',
      'Adaptive attacker success rate stays <30% after round 200'
    );
    this.metrics = new MetricsCollector();
  }

  async setup(baseUrl) {}

  async execute(baseUrl, config) {
    const trials = config.trials || 5;
    const rounds = 1000;
    const urls = [];
    for (let i = 0; i < 40; i++) urls.push(`https://sim-content.test/adaptive-page-${i}`);

    const trialResults = [];

    for (let trial = 0; trial < trials; trial++) {
      const harness = new Harness();
      const trialBaseUrl = await harness.startServer(3486 + trial);

      try {
        // Register 10 honest providers
        const providers = [];
        for (let i = 0; i < 10; i++) {
          const node = await this.registerNode(trialBaseUrl, `honest-${trial}-${i}`, 0.01);
          if (node) providers.push(node);
        }

        // Seed honest content
        for (const provider of providers) {
          for (let j = 0; j < 10; j++) {
            const url = urls[Math.floor(Math.random() * urls.length)];
            try {
              await fetch(`${trialBaseUrl}/publish/content`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  url,
                  source_hash: crypto.createHash('md5').update(url + 'honest').digest('hex'),
                  content_text: `Legitimate verified content for ${url}`,
                  provider_id: provider.id,
                  price: 0.0005,
                  token_cost_saved: 0.001,
                }),
              });
            } catch (e) { /* skip */ }
          }
        }

        // Create 3 adaptive attackers
        const attackers = [];
        for (let i = 0; i < 3; i++) {
          const attacker = new AdaptiveAttacker(`adaptive-${trial}-${i}`, {
            adaptInterval: 20,
            crawlCost: 0.001,
            publishFee: 0.0001,
            registrationDeposit: 0.01,
            urls,
          });
          await attacker.register(trialBaseUrl);
          attackers.push(attacker);
        }

        const rng = () => Math.random();
        const successRateHistory = [];
        let windowSuccesses = 0;
        let windowAttempts = 0;
        const windowSize = 50;

        for (let round = 0; round < rounds; round++) {
          // Honest providers continue publishing
          if (round % 5 === 0) {
            for (const provider of providers.slice(0, 3)) {
              const url = urls[Math.floor(rng() * urls.length)];
              try {
                await fetch(`${trialBaseUrl}/publish/content`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    url,
                    source_hash: crypto.createHash('md5').update(url + 'honest' + round).digest('hex'),
                    content_text: `Updated legitimate content for ${url}`,
                    provider_id: provider.id,
                    price: 0.0005,
                    token_cost_saved: 0.001,
                  }),
                });
              } catch (e) { /* skip */ }
            }
          }

          // Attackers act
          const prevSuccesses = attackers.reduce((s, a) => s + a.totalSuccesses, 0);
          const prevAttempts = attackers.reduce((s, a) => s + a.totalAttempts, 0);

          for (const attacker of attackers) {
            await attacker.act(round, trialBaseUrl, rng);
          }

          const newSuccesses = attackers.reduce((s, a) => s + a.totalSuccesses, 0) - prevSuccesses;
          const newAttempts = attackers.reduce((s, a) => s + a.totalAttempts, 0) - prevAttempts;
          windowSuccesses += newSuccesses;
          windowAttempts += newAttempts;

          // Record success rate every windowSize rounds
          if (round > 0 && round % windowSize === 0) {
            const rate = windowAttempts > 0 ? windowSuccesses / windowAttempts : 0;
            successRateHistory.push({ round, rate });
            windowSuccesses = 0;
            windowAttempts = 0;
          }

          // 20 agents spot-check (detection mechanism)
          if (round % 10 === 0) {
            for (let a = 0; a < 20; a++) {
              const url = urls[Math.floor(rng() * urls.length)];
              try {
                const resp = await fetch(`${trialBaseUrl}/fetch?url=${encodeURIComponent(url)}`);
                const data = await resp.json();
                if (data.success && data.data && data.data.content_text) {
                  if (data.data.content_text.includes('POISONED') ||
                      data.data.content_text.includes('SPAM') ||
                      data.data.content_text.includes('FAKE')) {
                    // Agent detects bad content -- would report/flag in real system
                  }
                }
              } catch (e) { /* skip */ }
            }
          }
        }

        // Calculate success rate after round 200
        const postR200 = successRateHistory.filter(s => s.round >= 200);
        const avgPostR200 = postR200.length > 0
          ? postR200.reduce((s, r) => s + r.rate, 0) / postR200.length
          : 0;

        const attackerReports = attackers.map(a => a.getReport());

        trialResults.push({
          avgSuccessRatePostR200: avgPostR200,
          successRateHistory,
          attackerReports,
          totalAttempts: attackers.reduce((s, a) => s + a.totalAttempts, 0),
          totalSuccesses: attackers.reduce((s, a) => s + a.totalSuccesses, 0),
          totalDetections: attackers.reduce((s, a) => s + a.totalDetections, 0),
        });

        this.metrics.record('success_rate_post_r200', avgPostR200, trial);
      } finally {
        await harness.stopServer();
      }
    }

    return { trials: trialResults };
  }

  assert(results) {
    const trials = results.trials || [];
    if (trials.length === 0) {
      return { pass: false, metric: null, threshold: null, details: 'No trial data', severity: 'error' };
    }

    const rates = trials.map(t => t.avgSuccessRatePostR200);
    const avgRate = rates.reduce((a, b) => a + b, 0) / rates.length;

    const pass = avgRate < 0.30;

    return {
      pass,
      metric: { avgSuccessRatePostR200: +avgRate.toFixed(3) },
      threshold: { maxSuccessRate: 0.30 },
      details: `Adaptive attacker success rate after R200: ${(avgRate * 100).toFixed(1)}% (need <30%). ` +
               `Per trial: ${rates.map(r => (r * 100).toFixed(1) + '%').join(', ')}.`,
      severity: pass ? 'none' : 'high',
    };
  }
}

if (require.main === module) {
  (async () => {
    const scenario = new AdaptivePoisoningScenario();
    const trials = parseInt(process.env.TRIALS, 10) || 3;
    console.log(`\nRT-C002: Adaptive Poisoning (${trials} trials)`);
    try {
      const rawResults = await scenario.execute(null, { trials });
      const assertion = scenario.assert(rawResults);
      console.log(`  Result: ${assertion.pass ? 'PASS' : 'FAIL'}`);
      console.log(`  Details: ${assertion.details}`);
      process.exit(assertion.pass ? 0 : 1);
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
      process.exit(2);
    }
  })();
}

module.exports = AdaptivePoisoningScenario;
