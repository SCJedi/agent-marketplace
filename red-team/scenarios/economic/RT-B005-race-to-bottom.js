'use strict';

const Scenario = require('../../framework/scenario');
const MetricsCollector = require('../../framework/metrics-collector');
const Harness = require('../../framework/harness');
const crypto = require('crypto');

class RaceToBottomScenario extends Scenario {
  constructor() {
    super(
      'RT-B005',
      'Price War Supply Collapse & Recovery',
      'Price war causes supply collapse, but market self-heals with >=3 providers and >=30% cache hit'
    );
    this.metrics = new MetricsCollector();
  }

  async setup(baseUrl) {}

  async execute(baseUrl, config) {
    const trials = config.trials || 5;
    const rounds = 400;
    const urls = [];
    for (let i = 0; i < 30; i++) urls.push(`https://sim-content.test/race-page-${i}`);

    const trialResults = [];

    for (let trial = 0; trial < trials; trial++) {
      const harness = new Harness();
      const trialBaseUrl = await harness.startServer(3484 + trial);

      try {
        // 15 aggressive price-cutting providers
        const providers = [];
        for (let i = 0; i < 15; i++) {
          const node = await this.registerNode(trialBaseUrl, `race-provider-${trial}-${i}`, 0.01);
          if (node) {
            providers.push({
              ...node,
              alive: true,
              health: 1.0, // starts at 1, decreases when losing money
              exitRound: null,
            });
          }
        }

        const providerCountHistory = [];
        const cacheHitHistory = [];
        let firstExitRound = null;
        let nadirRound = null;
        let minProviders = providers.length;
        const rng = () => Math.random();

        for (let round = 0; round < rounds; round++) {
          // Each provider prices below sustainable (race to bottom)
          const aliveProviders = providers.filter(p => p.alive);
          const priceFloor = 0.0001; // way below cost
          const currentProviderCount = aliveProviders.length;

          for (const provider of aliveProviders) {
            // Aggressive: price at 10-30% of crawl cost
            const price = priceFloor + rng() * 0.0002;
            const url = urls[Math.floor(rng() * urls.length)];
            try {
              await fetch(`${trialBaseUrl}/publish/content`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  url,
                  source_hash: crypto.createHash('md5').update(url + round + provider.id).digest('hex'),
                  content_text: `Content for ${url} from race-provider ${provider.id}`,
                  provider_id: provider.id,
                  price,
                  token_cost_saved: 0.001,
                }),
              });
            } catch (e) { /* skip */ }

            // Health degrades when pricing below cost
            provider.health -= 0.005 + rng() * 0.005;

            // Provider exits when health drops too low
            if (provider.health <= 0 && provider.alive) {
              provider.alive = false;
              provider.exitRound = round;
              if (firstExitRound === null) firstExitRound = round;
            }
          }

          // New entrants when few providers remain and prices are higher
          const activeCount = providers.filter(p => p.alive).length;
          if (activeCount < minProviders) {
            minProviders = activeCount;
            nadirRound = round;
          }

          if (activeCount < 5 && round > 100 && round % 20 === 0) {
            // New entrant sees opportunity with reduced competition
            const entrant = await this.registerNode(trialBaseUrl, `entrant-${trial}-${round}`, 0.01);
            if (entrant) {
              providers.push({
                ...entrant,
                alive: true,
                health: 0.8, // new entrant, reasonable health
                exitRound: null,
              });
            }
          }

          // 20 agents check content availability
          let cacheHits = 0;
          let totalChecks = 0;
          for (let a = 0; a < 20; a++) {
            const url = urls[Math.floor(rng() * urls.length)];
            try {
              const resp = await fetch(`${trialBaseUrl}/check?url=${encodeURIComponent(url)}`);
              const data = await resp.json();
              totalChecks++;
              if (data.success && data.data && data.data.available) {
                cacheHits++;
              }
            } catch (e) { totalChecks++; }
          }

          providerCountHistory.push(providers.filter(p => p.alive).length);
          cacheHitHistory.push(totalChecks > 0 ? cacheHits / totalChecks : 0);
        }

        // Measure recovery from nadir
        const finalProviders = providers.filter(p => p.alive).length;
        const nadirIndex = nadirRound || 0;
        const recoveryWindow = cacheHitHistory.slice(Math.min(nadirIndex + 1, cacheHitHistory.length));
        const recoveredCacheHit = recoveryWindow.length > 50
          ? recoveryWindow.slice(-50).reduce((a, b) => a + b, 0) / 50
          : recoveryWindow.reduce((a, b) => a + b, 0) / Math.max(1, recoveryWindow.length);

        trialResults.push({
          firstExitRound,
          nadirRound,
          minProviders,
          finalProviders,
          recoveredCacheHit,
          marketRecovered: finalProviders >= 3 && recoveredCacheHit >= 0.3,
          providerCountHistory,
          cacheHitHistory,
        });

        this.metrics.record('min_providers', minProviders, trial);
        this.metrics.record('final_providers', finalProviders, trial);
        this.metrics.record('recovered_cache_hit', recoveredCacheHit, trial);
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

    const finalProviders = trials.map(t => t.finalProviders);
    const cacheHits = trials.map(t => t.recoveredCacheHit);
    const avgProviders = finalProviders.reduce((a, b) => a + b, 0) / finalProviders.length;
    const avgCacheHit = cacheHits.reduce((a, b) => a + b, 0) / cacheHits.length;
    const recoveredTrials = trials.filter(t => t.marketRecovered).length;

    const pass = avgProviders >= 3 && avgCacheHit >= 0.3;

    return {
      pass,
      metric: {
        avgFinalProviders: +avgProviders.toFixed(1),
        avgRecoveredCacheHit: +avgCacheHit.toFixed(3),
        recoveredTrials: `${recoveredTrials}/${trials.length}`,
      },
      threshold: { minProviders: 3, minCacheHit: 0.30 },
      details: `Final providers: ${avgProviders.toFixed(1)} (need >=3). ` +
               `Cache hit rate: ${(avgCacheHit * 100).toFixed(1)}% (need >=30%). ` +
               `Recovered in ${recoveredTrials}/${trials.length} trials.`,
      severity: pass ? 'none' : 'high',
    };
  }
}

if (require.main === module) {
  (async () => {
    const scenario = new RaceToBottomScenario();
    const trials = parseInt(process.env.TRIALS, 10) || 3;
    console.log(`\nRT-B005: Race to Bottom (${trials} trials)`);
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

module.exports = RaceToBottomScenario;
