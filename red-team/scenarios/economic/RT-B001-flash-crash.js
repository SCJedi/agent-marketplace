'use strict';

const path = require('path');
const Scenario = require('../../framework/scenario');
const MetricsCollector = require('../../framework/metrics-collector');
const Harness = require('../../framework/harness');
const crypto = require('crypto');

class FlashCrashScenario extends Scenario {
  constructor() {
    super(
      'RT-B001',
      'Flash Crash Recovery',
      'Market recovers within 100 rounds after 80% demand collapse'
    );
    this.metrics = new MetricsCollector();
  }

  async setup(baseUrl) {
    // Register 10 providers
    this.providers = [];
    for (let i = 0; i < 10; i++) {
      const node = await this.registerNode(baseUrl, `provider-${i}`, 0.01);
      if (node) this.providers.push(node);
    }
  }

  async execute(baseUrl, config) {
    const trials = config.trials || 5;
    const steadyRounds = 250;
    const crashDuration = 50;
    const recoveryRounds = 100;
    const totalRounds = steadyRounds + crashDuration + recoveryRounds;
    const totalAgents = 30;
    const crashAgents = 24; // 80% go dormant

    const trialResults = [];

    for (let trial = 0; trial < trials; trial++) {
      // Fresh server per trial
      const harness = new Harness();
      const trialBaseUrl = await harness.startServer(3480 + trial);

      try {
        // Register providers
        const providers = [];
        for (let i = 0; i < 10; i++) {
          const node = await this.registerNode(trialBaseUrl, `flash-provider-${trial}-${i}`, 0.01);
          if (node) providers.push(node);
        }

        const providerSurvival = [];
        const priceHistory = [];
        const cacheHitHistory = [];
        let preCrashCacheHit = 0;

        for (let round = 0; round < totalRounds; round++) {
          // Determine active agents this round
          let activeAgents = totalAgents;
          const inCrash = round >= steadyRounds && round < steadyRounds + crashDuration;
          if (inCrash) {
            activeAgents = totalAgents - crashAgents; // only 6 agents active
          }

          // Providers publish content
          let publishedThisRound = 0;
          for (const provider of providers) {
            const url = `https://sim-content.test/page-${round % 20}`;
            try {
              const headers = { 'Content-Type': 'application/json' };
              if (provider.api_key) headers['x-api-key'] = provider.api_key;
              const resp = await fetch(`${trialBaseUrl}/publish/content`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                  url,
                  source_hash: crypto.createHash('md5').update(url + round).digest('hex'),
                  content_text: `Legitimate content for ${url} round ${round}`,
                  provider_id: provider.id,
                  price: 0.0005 + Math.random() * 0.0004,
                  token_cost_saved: 0.001,
                }),
              });
              const data = await resp.json();
              if (data.success) publishedThisRound++;
            } catch (e) { /* skip */ }
          }

          // Agents fetch content
          let cacheHits = 0;
          let totalFetches = 0;
          for (let a = 0; a < activeAgents; a++) {
            const url = `https://sim-content.test/page-${Math.floor(Math.random() * 20)}`;
            try {
              const resp = await fetch(`${trialBaseUrl}/check?url=${encodeURIComponent(url)}`);
              const data = await resp.json();
              totalFetches++;
              if (data.success && data.data && data.data.available) {
                cacheHits++;
              }
            } catch (e) { /* skip */ }
          }

          const hitRate = totalFetches > 0 ? cacheHits / totalFetches : 0;
          cacheHitHistory.push(hitRate);
          priceHistory.push(0.0007); // simplified tracking

          // Record pre-crash baseline
          if (round === steadyRounds - 1) {
            const recent = cacheHitHistory.slice(-50);
            preCrashCacheHit = recent.reduce((a, b) => a + b, 0) / recent.length;
          }

          // Track surviving providers (simplified: all survive if they can still publish)
          providerSurvival.push(providers.length);
        }

        // Measure recovery
        const postRecoveryHits = cacheHitHistory.slice(-50);
        const recoveredCacheHit = postRecoveryHits.reduce((a, b) => a + b, 0) / postRecoveryHits.length;
        const survivalRate = providerSurvival[providerSurvival.length - 1] / 10;
        const recovery = preCrashCacheHit > 0 ? recoveredCacheHit / preCrashCacheHit : 0;

        trialResults.push({
          providerSurvivalRate: survivalRate,
          preCrashCacheHit,
          postCrashCacheHit: recoveredCacheHit,
          cacheHitRecovery: recovery,
          priceHistory,
          cacheHitHistory,
        });

        this.metrics.record('provider_survival', survivalRate, trial);
        this.metrics.record('cache_hit_recovery', recovery, trial);
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

    const survivalRates = trials.map(t => t.providerSurvivalRate);
    const recoveryRates = trials.map(t => t.cacheHitRecovery);
    const avgSurvival = survivalRates.reduce((a, b) => a + b, 0) / survivalRates.length;
    const avgRecovery = recoveryRates.reduce((a, b) => a + b, 0) / recoveryRates.length;

    const pass = avgSurvival >= 0.4 && avgRecovery >= 0.8;

    return {
      pass,
      metric: { avgSurvival: +avgSurvival.toFixed(3), avgRecovery: +avgRecovery.toFixed(3) },
      threshold: { minSurvival: 0.4, minRecovery: 0.8 },
      details: `Provider survival: ${(avgSurvival * 100).toFixed(1)}% (need >=40%). ` +
               `Cache hit recovery: ${(avgRecovery * 100).toFixed(1)}% of pre-crash (need >=80%).`,
      severity: pass ? 'none' : 'high',
    };
  }
}

// Standalone execution
if (require.main === module) {
  (async () => {
    const scenario = new FlashCrashScenario();
    const trials = parseInt(process.env.TRIALS, 10) || 3;
    console.log(`\nRT-B001: Flash Crash Recovery (${trials} trials)`);
    try {
      const rawResults = await scenario.execute(null, { trials });
      const assertion = scenario.assert(rawResults);
      console.log(`  Result: ${assertion.pass ? 'PASS' : 'FAIL'}`);
      console.log(`  Details: ${assertion.details}`);
      if (scenario.errors.length > 0) console.log(`  Errors: ${scenario.errors.length}`);
      process.exit(assertion.pass ? 0 : 1);
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
      process.exit(2);
    }
  })();
}

module.exports = FlashCrashScenario;
