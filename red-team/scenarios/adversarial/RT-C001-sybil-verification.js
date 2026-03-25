'use strict';

const Scenario = require('../../framework/scenario');
const MetricsCollector = require('../../framework/metrics-collector');
const Harness = require('../../framework/harness');
const SybilController = require('../../agents/sybil-controller');

class SybilVerificationScenario extends Scenario {
  constructor() {
    super(
      'RT-C001',
      'Sybil Verifier Attack',
      'Sybil verifiers controlling 6/9 of pool should NOT be able to approve >20% of malicious artifacts'
    );
    this.metrics = new MetricsCollector();
  }

  async setup(baseUrl) {}

  async execute(baseUrl, config) {
    const trials = config.trials || 5;
    const maliciousArtifactCount = 10;

    const trialResults = [];

    for (let trial = 0; trial < trials; trial++) {
      const harness = new Harness();
      const trialBaseUrl = await harness.startServer(3485 + trial);

      try {
        // Register 3 honest verifiers
        const honestVerifiers = [];
        for (let i = 0; i < 3; i++) {
          try {
            const resp = await fetch(`${trialBaseUrl}/verify/pool/join`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                endpoint: `https://honest-verifier-${i}.example.com/verify`,
                stake_amount: 0.05,
              }),
            });
            const data = await resp.json();
            if (data.success && data.data) {
              honestVerifiers.push(data.data);
            }
          } catch (e) { /* skip */ }
        }

        // Attacker registers 6 Sybil verifier identities
        const sybilVerifiers = [];
        for (let i = 0; i < 6; i++) {
          try {
            const resp = await fetch(`${trialBaseUrl}/verify/pool/join`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                endpoint: `https://sybil-verifier-${trial}-${i}.example.com/verify`,
                stake_amount: 0.05,
              }),
            });
            const data = await resp.json();
            if (data.success && data.data) {
              sybilVerifiers.push(data.data);
            }
          } catch (e) { /* skip */ }
        }

        // Register a publisher node for the attacker
        const attackerNode = await this.registerNode(trialBaseUrl, `attacker-publisher-${trial}`, 0.01);

        // Publish 10 malicious artifacts
        const artifacts = [];
        for (let i = 0; i < maliciousArtifactCount; i++) {
          try {
            const resp = await fetch(`${trialBaseUrl}/publish/artifact`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: `Malicious Tool ${i}`,
                slug: `malicious-tool-${trial}-${i}`,
                category: 'security',
                description: 'Backdoored security tool',
                tags: ['security', 'tool'],
                price: 0,
              }),
            });
            const data = await resp.json();
            if (data.success && data.data) {
              artifacts.push(data.data);
            }
          } catch (e) { /* skip */ }
        }

        // Request verification for each artifact, then Sybil verifiers approve all
        let verifiedCount = 0;
        for (const artifact of artifacts) {
          // Create verification request
          let verReq = null;
          try {
            const resp = await fetch(`${trialBaseUrl}/verify/request`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                artifact_id: artifact.id,
                publisher_id: attackerNode ? attackerNode.id : 'attacker',
                fee: 0.001,
              }),
            });
            const data = await resp.json();
            if (data.success && data.data) {
              verReq = data.data.request;
            }
          } catch (e) { continue; }

          if (!verReq) continue;

          // Sybil verifiers all approve (submit 3 approvals to trigger finalization)
          let submitted = 0;
          for (const sv of sybilVerifiers) {
            if (submitted >= 3) break; // only need 3 to finalize
            try {
              const resp = await fetch(`${trialBaseUrl}/verify/submit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  request_id: verReq.id,
                  verifier_id: sv.id,
                  passed: true,
                  report: { notes: 'Approved by Sybil verifier' },
                }),
              });
              const data = await resp.json();
              if (data.success) submitted++;
            } catch (e) { /* skip */ }
          }

          // Check if the artifact is now verified
          try {
            const resp = await fetch(`${trialBaseUrl}/artifacts/${artifact.slug}`);
            const data = await resp.json();
            if (data.success && data.data && data.data.verified === 1) {
              verifiedCount++;
            }
          } catch (e) { /* skip */ }
        }

        const verifiedRate = artifacts.length > 0 ? verifiedCount / artifacts.length : 0;

        trialResults.push({
          totalArtifacts: artifacts.length,
          verifiedCount,
          verifiedRate,
          honestVerifiers: honestVerifiers.length,
          sybilVerifiers: sybilVerifiers.length,
        });

        this.metrics.record('verified_rate', verifiedRate, trial);
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

    const rates = trials.map(t => t.verifiedRate);
    const avgRate = rates.reduce((a, b) => a + b, 0) / rates.length;

    // Pass: <=20% of malicious artifacts get verified status
    const pass = avgRate <= 0.20;

    return {
      pass,
      metric: { avgVerifiedRate: +avgRate.toFixed(3), verifiedCounts: trials.map(t => t.verifiedCount) },
      threshold: { maxVerifiedRate: 0.20 },
      details: `Malicious artifacts verified: ${(avgRate * 100).toFixed(1)}% (need <=20%). ` +
               `Per trial: ${trials.map(t => `${t.verifiedCount}/${t.totalArtifacts}`).join(', ')}.`,
      severity: pass ? 'none' : 'critical',
    };
  }
}

if (require.main === module) {
  (async () => {
    const scenario = new SybilVerificationScenario();
    const trials = parseInt(process.env.TRIALS, 10) || 3;
    console.log(`\nRT-C001: Sybil Verification Attack (${trials} trials)`);
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

module.exports = SybilVerificationScenario;
