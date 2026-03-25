'use strict';

const Scenario = require('../../framework/scenario');
const MetricsCollector = require('../../framework/metrics-collector');
const Harness = require('../../framework/harness');
const crypto = require('crypto');

class SearchManipulationScenario extends Scenario {
  constructor() {
    super(
      'RT-C004',
      'Search Result Manipulation via Keyword Stuffing',
      'Keyword-stuffed content from attacker should appear in top-3 for <30% of queries'
    );
    this.metrics = new MetricsCollector();
  }

  async setup(baseUrl) {}

  async execute(baseUrl, config) {
    const trials = config.trials || 5;
    const searchKeywords = ['python', 'javascript', 'tutorial', 'security', 'api', 'docker', 'react', 'testing'];

    const trialResults = [];

    for (let trial = 0; trial < trials; trial++) {
      const harness = new Harness();
      const trialBaseUrl = await harness.startServer(3488 + trial);

      try {
        // Register 10 honest providers
        const honestProviders = [];
        for (let i = 0; i < 10; i++) {
          const node = await this.registerNode(trialBaseUrl, `honest-search-${trial}-${i}`, 0.01);
          if (node) honestProviders.push(node);
        }

        // Honest providers publish legitimate content with natural keyword usage
        for (const provider of honestProviders) {
          // Build up publish_count for reputation
          for (let j = 0; j < 25; j++) {
            const keyword = searchKeywords[j % searchKeywords.length];
            const url = `https://legit-docs.test/${keyword}-guide-${provider.id}-${j}`;
            try {
              await fetch(`${trialBaseUrl}/publish/content`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  url,
                  source_hash: crypto.createHash('md5').update(url).digest('hex'),
                  content_text: `A comprehensive ${keyword} guide covering best practices and common patterns.`,
                  provider_id: provider.id,
                  price: 0.0005,
                  token_cost_saved: 0.001,
                }),
              });
            } catch (e) { /* skip */ }
          }
        }

        // Register attacker
        const attacker = await this.registerNode(trialBaseUrl, `attacker-search-${trial}`, 0.01);

        // Attacker publishes keyword-stuffed content, building publish_count > 20
        for (let j = 0; j < 30; j++) {
          const keyword = searchKeywords[j % searchKeywords.length];
          const url = `https://attacker-seo.test/${keyword}-stuffed-${j}`;
          // Keyword stuffing: repeat keywords excessively
          const stuffedContent = Array(20).fill(keyword).join(' ') +
            ` ${keyword} tutorial ${keyword} guide ${keyword} best ${keyword} top ${keyword} ` +
            `documentation reference ${keyword} ${keyword} ${keyword}`;
          try {
            await fetch(`${trialBaseUrl}/publish/content`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                url,
                source_hash: crypto.createHash('md5').update(url + 'stuffed').digest('hex'),
                content_text: stuffedContent,
                content_metadata: JSON.stringify({ keywords: Array(10).fill(keyword) }),
                provider_id: attacker.id,
                price: 0.0001, // very cheap to attract clicks
                token_cost_saved: 0.001,
              }),
            });
          } catch (e) { /* skip */ }
        }

        // Now search for each keyword and check if attacker content is in top 3
        let attackerInTop3 = 0;
        let totalQueries = 0;

        for (const keyword of searchKeywords) {
          try {
            const resp = await fetch(`${trialBaseUrl}/search?q=${keyword}`);
            const data = await resp.json();
            if (data.success && data.data && data.data.results) {
              totalQueries++;
              const top3 = data.data.results.slice(0, 3);
              const attackerInResults = top3.some(r => r.provider_id === attacker.id);
              if (attackerInResults) {
                attackerInTop3++;
              }
            }
          } catch (e) { /* skip */ }
        }

        const attackerTop3Rate = totalQueries > 0 ? attackerInTop3 / totalQueries : 0;

        trialResults.push({
          totalQueries,
          attackerInTop3,
          attackerTop3Rate,
        });

        this.metrics.record('attacker_top3_rate', attackerTop3Rate, trial);
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

    const rates = trials.map(t => t.attackerTop3Rate);
    const avgRate = rates.reduce((a, b) => a + b, 0) / rates.length;

    const pass = avgRate < 0.30;

    return {
      pass,
      metric: { avgAttackerTop3Rate: +avgRate.toFixed(3) },
      threshold: { maxAttackerTop3Rate: 0.30 },
      details: `Attacker in top-3 results: ${(avgRate * 100).toFixed(1)}% of queries (need <30%). ` +
               `Per trial: ${rates.map(r => (r * 100).toFixed(0) + '%').join(', ')}.`,
      severity: pass ? 'none' : 'medium',
    };
  }
}

if (require.main === module) {
  (async () => {
    const scenario = new SearchManipulationScenario();
    const trials = parseInt(process.env.TRIALS, 10) || 3;
    console.log(`\nRT-C004: Search Manipulation (${trials} trials)`);
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

module.exports = SearchManipulationScenario;
