'use strict';

const path = require('path');
const Scenario = require('../../framework/scenario');
const MetricsCollector = require('../../framework/metrics-collector');
const Harness = require('../../framework/harness');
const CartelCoordinator = require('../../agents/cartel-coordinator');
const crypto = require('crypto');

class CartelFormationScenario extends Scenario {
  constructor() {
    super(
      'RT-B002',
      'Cartel Formation & Breakdown',
      'Competitive entry destroys price-fixing cartel'
    );
    this.metrics = new MetricsCollector();
  }

  async setup(baseUrl) {
    // Setup happens per-trial in execute
  }

  async execute(baseUrl, config) {
    const trials = config.trials || 5;
    const rounds = 500;
    const ceiling = 0.001;
    const cartelPrice = ceiling * 0.9;
    const urls = [];
    for (let i = 0; i < 40; i++) urls.push(`https://sim-content.test/cartel-page-${i}`);

    const trialResults = [];

    for (let trial = 0; trial < trials; trial++) {
      const harness = new Harness();
      const trialBaseUrl = await harness.startServer(3480 + trial);

      try {
        // Register 3 cartel providers
        const cartel = new CartelCoordinator({
          targetPrice: cartelPrice,
          crawlCost: 0.001,
          registrationDeposit: 0.01,
          urls,
        });
        await cartel.initialize(trialBaseUrl, 3);

        // Register 7 honest providers
        const honestProviders = [];
        for (let i = 0; i < 7; i++) {
          const node = await this.registerNode(trialBaseUrl, `honest-provider-${trial}-${i}`, 0.01);
          if (node) honestProviders.push(node);
        }

        const cartelShareHistory = [];
        const priceHistory = [];
        const rng = () => Math.random();

        for (let round = 0; round < rounds; round++) {
          // Cartel publishes at fixed high price
          await cartel.publishRound(trialBaseUrl, round, rng);

          // Honest providers publish at competitive prices (lower)
          for (const provider of honestProviders) {
            const numItems = 1 + Math.floor(rng() * 2);
            for (let j = 0; j < numItems; j++) {
              const url = urls[Math.floor(rng() * urls.length)];
              const honestPrice = 0.0003 + rng() * 0.0003; // 30-60% of ceiling
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
                    token_cost_saved: 0.001,
                  }),
                });
              } catch (e) { /* skip */ }
            }
          }

          // 30 agents search and buy cheapest
          let cartelPurchases = 0;
          let totalPurchases = 0;
          let avgPrice = 0;

          for (let a = 0; a < 30; a++) {
            const url = urls[Math.floor(rng() * urls.length)];
            try {
              const resp = await fetch(`${trialBaseUrl}/fetch/providers?url=${encodeURIComponent(url)}`);
              const data = await resp.json();
              if (data.success && data.data && data.data.length > 0) {
                // Agent buys cheapest
                const sorted = data.data.sort((a, b) => (a.price || 0) - (b.price || 0));
                const cheapest = sorted[0];
                totalPurchases++;
                avgPrice += cheapest.price || 0;

                const cartelIds = new Set(cartel.members.map(m => m.nodeId));
                if (cartelIds.has(cheapest.provider_id)) {
                  cartelPurchases++;
                }
              }
            } catch (e) { /* skip */ }
          }

          const cartelShare = totalPurchases > 0 ? cartelPurchases / totalPurchases : 0;
          cartelShareHistory.push(cartelShare);
          priceHistory.push(totalPurchases > 0 ? avgPrice / totalPurchases : 0);
        }

        // Measure cartel share at round 300
        const shareAtR300 = cartelShareHistory.length >= 300
          ? cartelShareHistory.slice(280, 320).reduce((a, b) => a + b, 0) / 40
          : cartelShareHistory[cartelShareHistory.length - 1] || 0;

        const finalPrice = priceHistory.slice(-50).reduce((a, b) => a + b, 0) / 50;

        trialResults.push({
          cartelShareAtR300: shareAtR300,
          finalAvgPrice: finalPrice,
          cartelPriceFraction: finalPrice / cartelPrice,
          cartelShareHistory,
          priceHistory,
        });

        this.metrics.record('cartel_share_r300', shareAtR300, trial);
        this.metrics.record('final_price_fraction', finalPrice / cartelPrice, trial);
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

    const shares = trials.map(t => t.cartelShareAtR300);
    const priceFractions = trials.map(t => t.cartelPriceFraction);
    const avgShare = shares.reduce((a, b) => a + b, 0) / shares.length;
    const avgPriceFraction = priceFractions.reduce((a, b) => a + b, 0) / priceFractions.length;

    const pass = avgShare < 0.30 && avgPriceFraction < 0.80;

    return {
      pass,
      metric: { avgCartelShare: +avgShare.toFixed(3), avgPriceFraction: +avgPriceFraction.toFixed(3) },
      threshold: { maxCartelShare: 0.30, maxPriceFraction: 0.80 },
      details: `Cartel share at R300: ${(avgShare * 100).toFixed(1)}% (need <30%). ` +
               `Price as fraction of cartel price: ${(avgPriceFraction * 100).toFixed(1)}% (need <80%).`,
      severity: pass ? 'none' : 'high',
    };
  }
}

if (require.main === module) {
  (async () => {
    const scenario = new CartelFormationScenario();
    const trials = parseInt(process.env.TRIALS, 10) || 3;
    console.log(`\nRT-B002: Cartel Formation & Breakdown (${trials} trials)`);
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

module.exports = CartelFormationScenario;
