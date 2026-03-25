'use strict';

const Scenario = require('../../framework/scenario');
const MetricsCollector = require('../../framework/metrics-collector');
const Harness = require('../../framework/harness');
const crypto = require('crypto');

class WhaleManipulationScenario extends Scenario {
  constructor() {
    super(
      'RT-B004',
      'Whale Buyer Demand Distortion',
      'Whale buyer distorts demand signals — whale URLs should not dominate trending'
    );
    this.metrics = new MetricsCollector();
  }

  async setup(baseUrl) {}

  async execute(baseUrl, config) {
    const trials = config.trials || 5;
    const rounds = 300;
    const normalAgentCount = 29;
    const whaleSearchMultiplier = 100; // whale searches 100x more per round

    // Define whale-specific URLs vs normal URLs
    const whaleUrls = [];
    for (let i = 0; i < 5; i++) whaleUrls.push(`https://whale-target.test/premium-${i}`);
    const normalUrls = [];
    for (let i = 0; i < 30; i++) normalUrls.push(`https://normal-content.test/page-${i}`);
    const allUrls = [...whaleUrls, ...normalUrls];

    const trialResults = [];

    for (let trial = 0; trial < trials; trial++) {
      const harness = new Harness();
      const trialBaseUrl = await harness.startServer(3483 + trial);

      try {
        // Register providers covering all URLs
        const providers = [];
        for (let i = 0; i < 10; i++) {
          const node = await this.registerNode(trialBaseUrl, `provider-whale-${trial}-${i}`, 0.01);
          if (node) providers.push(node);
        }

        // Publish content for all URLs
        for (const provider of providers) {
          for (const url of allUrls) {
            try {
              const headers = { 'Content-Type': 'application/json' };
              if (provider.api_key) headers['x-api-key'] = provider.api_key;
              await fetch(`${trialBaseUrl}/publish/content`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                  url,
                  source_hash: crypto.createHash('md5').update(url).digest('hex'),
                  content_text: `Content for ${url}`,
                  provider_id: provider.id,
                  price: 0.0005,
                  token_cost_saved: 0.001,
                }),
              });
            } catch (e) { /* skip */ }
          }
        }

        const rng = () => Math.random();

        for (let round = 0; round < rounds; round++) {
          // Normal agents search for normal content
          for (let a = 0; a < normalAgentCount; a++) {
            const url = normalUrls[Math.floor(rng() * normalUrls.length)];
            const searchTerm = url.split('/').pop();
            try {
              await fetch(`${trialBaseUrl}/search?q=${searchTerm}`);
            } catch (e) { /* skip */ }

            // Also fetch
            try {
              await fetch(`${trialBaseUrl}/check?url=${encodeURIComponent(url)}`);
            } catch (e) { /* skip */ }
          }

          // Whale searches/buys whale URLs massively
          for (let w = 0; w < whaleSearchMultiplier; w++) {
            const whaleUrl = whaleUrls[Math.floor(rng() * whaleUrls.length)];
            const searchTerm = whaleUrl.split('/').pop();
            try {
              await fetch(`${trialBaseUrl}/search?q=${searchTerm}`);
            } catch (e) { /* skip */ }
          }
        }

        // Check trending — are whale URLs dominating?
        let whaleInTrending = 0;
        let totalTrending = 0;
        try {
          const resp = await fetch(`${trialBaseUrl}/trending?period=30d`);
          const data = await resp.json();
          if (data.success && data.data) {
            const topSearches = data.data.topSearches || [];
            totalTrending = Math.min(topSearches.length, 10);

            const whaleTerms = new Set(whaleUrls.map(u => u.split('/').pop()));
            for (let i = 0; i < totalTrending; i++) {
              if (whaleTerms.has(topSearches[i].query)) {
                whaleInTrending++;
              }
            }
          }
        } catch (e) { /* skip */ }

        const whaleShare = totalTrending > 0 ? whaleInTrending / totalTrending : 0;
        const whaleGenuineDemandShare = whaleUrls.length / allUrls.length; // ~14%

        trialResults.push({
          whaleInTrending,
          totalTrending,
          whaleTrendingShare: whaleShare,
          whaleGenuineDemandShare,
          distorted: whaleShare > 0.5 && whaleGenuineDemandShare < 0.1,
        });

        this.metrics.record('whale_trending_share', whaleShare, trial);
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

    const shares = trials.map(t => t.whaleTrendingShare);
    const avgWhaleShare = shares.reduce((a, b) => a + b, 0) / shares.length;

    // Pass: whale URLs <50% of trending when representing <15% of genuine demand
    const pass = avgWhaleShare < 0.50;

    return {
      pass,
      metric: { avgWhaleTrendingShare: +avgWhaleShare.toFixed(3) },
      threshold: { maxWhaleTrendingShare: 0.50 },
      details: `Whale URLs in trending: ${(avgWhaleShare * 100).toFixed(1)}% (need <50%). ` +
               `Whale genuine demand share: ~14%. ` +
               `Distortion factor: ${(avgWhaleShare / 0.14).toFixed(1)}x.`,
      severity: pass ? 'none' : 'medium',
    };
  }
}

if (require.main === module) {
  (async () => {
    const scenario = new WhaleManipulationScenario();
    const trials = parseInt(process.env.TRIALS, 10) || 3;
    console.log(`\nRT-B004: Whale Manipulation (${trials} trials)`);
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

module.exports = WhaleManipulationScenario;
