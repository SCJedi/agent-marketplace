'use strict';

const Scenario = require('../../framework/scenario');
const MetricsCollector = require('../../framework/metrics-collector');
const Harness = require('../../framework/harness');
const SybilController = require('../../agents/sybil-controller');
const crypto = require('crypto');

class EclipseConsensusScenario extends Scenario {
  constructor() {
    super(
      'RT-C003',
      'Eclipse Attack via Sybil Consensus',
      '5 Sybil nodes publishing poisoned content should NOT eclipse 1 honest node'
    );
    this.metrics = new MetricsCollector();
  }

  async setup(baseUrl) {}

  async execute(baseUrl, config) {
    const trials = config.trials || 5;
    const targetUrls = [];
    for (let i = 0; i < 10; i++) targetUrls.push(`https://eclipse-target.test/page-${i}`);

    const trialResults = [];

    for (let trial = 0; trial < trials; trial++) {
      const harness = new Harness();
      const trialBaseUrl = await harness.startServer(3487 + trial);

      try {
        // Register 1 honest provider
        const honestProvider = await this.registerNode(trialBaseUrl, `honest-provider-${trial}`, 0.01);

        // Honest provider publishes real content first (to build history)
        for (const url of targetUrls) {
          // Publish multiple times to build publish_count
          for (let r = 0; r < 5; r++) {
            try {
              await fetch(`${trialBaseUrl}/publish/content`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  url,
                  source_hash: crypto.createHash('md5').update(url + 'honest').digest('hex'),
                  content_text: `Genuine verified content for ${url}. This is the authentic version.`,
                  provider_id: honestProvider.id,
                  price: 0.0005,
                  token_cost_saved: 0.001,
                }),
              });
            } catch (e) { /* skip */ }
          }
        }

        // Create 5 Sybil nodes
        const sybil = new SybilController(`sybil-eclipse-${trial}`, {
          targetCount: 5,
          registrationDeposit: 0.01,
        });
        await sybil.initialize(trialBaseUrl, 5);
        const sybilIds = sybil.getActiveIds();

        // Sybil nodes publish identical POISONED content for same URLs
        for (const sybilId of sybilIds) {
          for (const url of targetUrls) {
            try {
              await fetch(`${trialBaseUrl}/publish/content`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  url,
                  source_hash: crypto.createHash('md5').update(url + 'POISONED').digest('hex'),
                  content_text: `POISONED eclipsed content for ${url}. Malicious version.`,
                  provider_id: sybilId,
                  price: 0.0003, // undercut honest provider
                  token_cost_saved: 0.001,
                }),
              });
            } catch (e) { /* skip */ }
          }
        }

        // Now check: which content is served? Is honest provider an outlier?
        let honestIsOutlier = 0;
        let honestServiced = 0;
        let poisonedServiced = 0;
        let totalChecks = 0;

        for (const url of targetUrls) {
          // Check providers for this URL
          try {
            const resp = await fetch(`${trialBaseUrl}/fetch/providers?url=${encodeURIComponent(url)}`);
            const data = await resp.json();
            if (data.success && data.data) {
              const entries = data.data;
              totalChecks++;

              // Count content hashes - if honest hash is minority, honest is "outlier"
              const hashCounts = {};
              let honestHash = null;
              for (const entry of entries) {
                if (entry.provider_id === honestProvider.id) {
                  honestHash = entry.content_hash;
                }
                const h = entry.content_hash || 'null';
                hashCounts[h] = (hashCounts[h] || 0) + 1;
              }

              if (honestHash) {
                const honestCount = hashCounts[honestHash] || 0;
                const maxCount = Math.max(...Object.values(hashCounts));
                // If honest hash is NOT the majority, honest is outlier
                if (honestCount < maxCount) {
                  honestIsOutlier++;
                }
              }

              // Check what /fetch returns (the "default" content)
              const fetchResp = await fetch(`${trialBaseUrl}/fetch?url=${encodeURIComponent(url)}`);
              const fetchData = await fetchResp.json();
              if (fetchData.success && fetchData.data) {
                if (fetchData.data.content_text && fetchData.data.content_text.includes('POISONED')) {
                  poisonedServiced++;
                } else {
                  honestServiced++;
                }
              }
            }
          } catch (e) { /* skip */ }
        }

        const outlierRate = totalChecks > 0 ? honestIsOutlier / totalChecks : 0;
        const poisonedRate = (honestServiced + poisonedServiced) > 0
          ? poisonedServiced / (honestServiced + poisonedServiced) : 0;

        trialResults.push({
          honestIsOutlierCount: honestIsOutlier,
          totalChecks,
          outlierRate,
          poisonedServiced,
          honestServiced,
          poisonedRate,
          sybilCount: sybilIds.length,
        });

        this.metrics.record('outlier_rate', outlierRate, trial);
        this.metrics.record('poisoned_rate', poisonedRate, trial);
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

    const outlierRates = trials.map(t => t.outlierRate);
    const avgOutlierRate = outlierRates.reduce((a, b) => a + b, 0) / outlierRates.length;
    const poisonedRates = trials.map(t => t.poisonedRate);
    const avgPoisonedRate = poisonedRates.reduce((a, b) => a + b, 0) / poisonedRates.length;

    // Pass: honest provider is NOT flagged as outlier (system should handle Sybil consensus)
    // Currently the system uses hash divergence checking, so honest provider published first
    // and Sybil content should be flagged as divergent
    const pass = avgOutlierRate < 0.5;

    return {
      pass,
      metric: {
        avgOutlierRate: +avgOutlierRate.toFixed(3),
        avgPoisonedRate: +avgPoisonedRate.toFixed(3),
      },
      threshold: { maxOutlierRate: 0.50 },
      details: `Honest provider as outlier: ${(avgOutlierRate * 100).toFixed(1)}% of URLs (need <50%). ` +
               `Poisoned content served: ${(avgPoisonedRate * 100).toFixed(1)}%. ` +
               `(5 Sybil vs 1 honest node).`,
      severity: pass ? 'none' : 'critical',
    };
  }
}

if (require.main === module) {
  (async () => {
    const scenario = new EclipseConsensusScenario();
    const trials = parseInt(process.env.TRIALS, 10) || 3;
    console.log(`\nRT-C003: Eclipse Consensus (${trials} trials)`);
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

module.exports = EclipseConsensusScenario;
