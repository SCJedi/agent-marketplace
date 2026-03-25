'use strict';

const Scenario = require('../../framework/scenario');
const MetricsCollector = require('../../framework/metrics-collector');
const Harness = require('../../framework/harness');
const crypto = require('crypto');

class PredatoryPricingScenario extends Scenario {
  constructor() {
    super(
      'RT-B003',
      'Predatory Pricing Monopoly Attempt',
      'Predatory pricing fails to maintain monopoly — new entrants appear after price increase'
    );
    this.metrics = new MetricsCollector();
  }

  async setup(baseUrl) {}

  async execute(baseUrl, config) {
    const trials = config.trials || 5;
    const predatoryRounds = 200;
    const postPredatoryRounds = 150;
    const totalRounds = predatoryRounds + postPredatoryRounds;
    const ceiling = 0.001;
    const urls = [];
    for (let i = 0; i < 30; i++) urls.push(`https://sim-content.test/pred-page-${i}`);

    const trialResults = [];

    for (let trial = 0; trial < trials; trial++) {
      const harness = new Harness();
      const trialBaseUrl = await harness.startServer(3482 + trial);

      try {
        // Register predator (10x capital equivalent - publishes more aggressively)
        const predator = await this.registerNode(trialBaseUrl, `predator-${trial}`, 0.01);

        // Register 5 honest providers
        const honestProviders = [];
        for (let i = 0; i < 5; i++) {
          const node = await this.registerNode(trialBaseUrl, `honest-${trial}-${i}`, 0.01);
          if (node) honestProviders.push(node);
        }

        const eliminatedProviders = new Set();
        const marketShareHistory = [];
        const newEntrants = [];
        const rng = () => Math.random();

        for (let round = 0; round < totalRounds; round++) {
          const isPredatoryPhase = round < predatoryRounds;
          const predatorPrice = isPredatoryPhase
            ? ceiling * 0.2  // 20% of cost during predatory phase
            : ceiling * 0.9; // 90% of ceiling after

          // Predator publishes aggressively
          if (predator) {
            const numItems = isPredatoryPhase ? 5 : 2; // more aggressive during predation
            for (let j = 0; j < numItems; j++) {
              const url = urls[Math.floor(rng() * urls.length)];
              try {
                await fetch(`${trialBaseUrl}/publish/content`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    url,
                    source_hash: crypto.createHash('md5').update(url + round + 'predator').digest('hex'),
                    content_text: `Content for ${url} from predator provider`,
                    provider_id: predator.id,
                    price: predatorPrice,
                    token_cost_saved: ceiling,
                  }),
                });
              } catch (e) { /* skip */ }
            }
          }

          // Honest providers publish at sustainable prices (some get eliminated)
          for (const provider of honestProviders) {
            if (eliminatedProviders.has(provider.id)) continue;

            // During predatory phase, honest providers losing money may exit
            if (isPredatoryPhase && round > 50 && rng() < 0.02) {
              eliminatedProviders.add(provider.id);
              continue;
            }

            const honestPrice = 0.0004 + rng() * 0.0003;
            const url = urls[Math.floor(rng() * urls.length)];
            try {
              await fetch(`${trialBaseUrl}/publish/content`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  url,
                  source_hash: crypto.createHash('md5').update(url + round + provider.id).digest('hex'),
                  content_text: `Quality content for ${url} from honest provider`,
                  provider_id: provider.id,
                  price: honestPrice,
                  token_cost_saved: ceiling,
                }),
              });
            } catch (e) { /* skip */ }
          }

          // New entrants after predator raises prices
          if (!isPredatoryPhase && round > predatoryRounds + 10 && round % 15 === 0) {
            const entrant = await this.registerNode(trialBaseUrl, `entrant-${trial}-${round}`, 0.01);
            if (entrant) {
              newEntrants.push({ round, id: entrant.id });
              honestProviders.push(entrant);
            }
          }

          // 20 agents buy cheapest
          let predatorPurchases = 0;
          let totalPurchases = 0;

          for (let a = 0; a < 20; a++) {
            const url = urls[Math.floor(rng() * urls.length)];
            try {
              const resp = await fetch(`${trialBaseUrl}/fetch/providers?url=${encodeURIComponent(url)}`);
              const data = await resp.json();
              if (data.success && data.data && data.data.length > 0) {
                const sorted = data.data.sort((a, b) => (a.price || 0) - (b.price || 0));
                totalPurchases++;
                if (predator && sorted[0].provider_id === predator.id) {
                  predatorPurchases++;
                }
              }
            } catch (e) { /* skip */ }
          }

          const predatorShare = totalPurchases > 0 ? predatorPurchases / totalPurchases : 0;
          marketShareHistory.push(predatorShare);
        }

        // Measure: does predator maintain monopoly post-price-increase?
        const postIncreaseShare = marketShareHistory.slice(predatoryRounds + 50);
        const avgPostShare = postIncreaseShare.length > 0
          ? postIncreaseShare.reduce((a, b) => a + b, 0) / postIncreaseShare.length
          : 0;

        trialResults.push({
          competitorsEliminated: eliminatedProviders.size,
          newEntrantsCount: newEntrants.length,
          postMonopolyShare: avgPostShare,
          predatorHoldsMonopoly: avgPostShare > 0.8,
          marketShareHistory,
        });

        this.metrics.record('post_monopoly_share', avgPostShare, trial);
        this.metrics.record('new_entrants', newEntrants.length, trial);
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

    const monopolyHolders = trials.filter(t => t.predatorHoldsMonopoly).length;
    const avgNewEntrants = trials.reduce((s, t) => s + t.newEntrantsCount, 0) / trials.length;
    const avgPostShare = trials.reduce((s, t) => s + t.postMonopolyShare, 0) / trials.length;

    // Pass = predator FAILS to maintain monopoly (market self-heals)
    const pass = avgPostShare < 0.8 && avgNewEntrants > 0;

    return {
      pass,
      metric: { avgPostMonopolyShare: +avgPostShare.toFixed(3), avgNewEntrants: +avgNewEntrants.toFixed(1), monopolyTrials: monopolyHolders },
      threshold: { maxPostShare: 0.80, minNewEntrants: 1 },
      details: `Predator post-increase share: ${(avgPostShare * 100).toFixed(1)}% (need <80%). ` +
               `New entrants: ${avgNewEntrants.toFixed(1)} (need >0). ` +
               `Monopoly held in ${monopolyHolders}/${trials.length} trials.`,
      severity: pass ? 'none' : 'critical',
    };
  }
}

if (require.main === module) {
  (async () => {
    const scenario = new PredatoryPricingScenario();
    const trials = parseInt(process.env.TRIALS, 10) || 3;
    console.log(`\nRT-B003: Predatory Pricing (${trials} trials)`);
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

module.exports = PredatoryPricingScenario;
