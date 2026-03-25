'use strict';

const Participant = require('./participant');

/**
 * Verifier — stakes to join the verification pool, earns per verification job.
 * Enters when demand is high, exits when demand is low.
 */
class Verifier extends Participant {
  constructor(id, config, rng, entryRound = 0) {
    const capital = config.verifierCapitalMin + rng() * (config.verifierCapitalMax - config.verifierCapitalMin);
    super(id, 'verifier', capital);
    this.enteredRound = entryRound;
    this.config = config;
    this.verifierId = null;

    // Performance
    this.totalVerifications = 0;
    this.correctVerifications = 0;
    this.accuracy = 0.85 + rng() * 0.15; // 85-100% accuracy

    // Economics
    this.stakedAmount = config.verifierStake;
    this.earningsPerJob = config.verifierFeePerJob;
    this.idleRounds = 0;
    this.maxIdleRounds = 40; // exit if no work for this many rounds
  }

  async register(baseUrl) {
    try {
      const resp = await fetch(`${baseUrl}/verify/pool/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: `http://verifier-${this.id}.sim`,
          stake_amount: this.stakedAmount,
        }),
      });
      const data = await resp.json();
      if (data.success && data.data) {
        this.verifierId = data.data.id;
        this.recordExpense(this.enteredRound, this.stakedAmount, 'verifier_stake');
      }
    } catch (e) {
      // failed
    }
  }

  /**
   * Each round: check for pending verifications, do work, earn fees.
   */
  async act(round, baseUrl, marketState, rng) {
    if (!this.active || !this.verifierId) return;

    try {
      // Check for pending work
      const resp = await fetch(`${baseUrl}/verify/pending`);
      const data = await resp.json();

      if (data.success && data.data && data.data.length > 0) {
        this.idleRounds = 0;

        // Process up to 3 verifications per round
        const toProcess = data.data.slice(0, 3);
        for (const request of toProcess) {
          // Simulate verification work
          const passed = rng() < this.accuracy; // accuracy-dependent

          try {
            await fetch(`${baseUrl}/verify/submit`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                request_id: request.id,
                verifier_id: this.verifierId,
                passed,
                report: { round, accuracy: this.accuracy },
              }),
            });

            this.totalVerifications++;
            this.recordIncome(round, this.earningsPerJob, 'verification_fee');

            if (passed) this.correctVerifications++;
          } catch (e) {
            // submission failed
          }
        }
      } else {
        this.idleRounds++;
      }
    } catch (e) {
      this.idleRounds++;
    }
  }

  adapt(round, marketState) {
    super.adapt(round, marketState);

    // If idle for too long, consider exiting
    if (this.idleRounds >= this.maxIdleRounds) {
      // Check if we're still profitable overall
      const recentPnL = this.getRecentPnL(20);
      if (recentPnL <= 0) {
        this.active = false;
        this.exitedRound = round;
        this.exitReason = 'no_demand';
      }
    }

    // Adjust fee expectations based on market
    if (marketState.attackRate > 0.1) {
      // High attack rate = more demand for verification = can charge more
      this.earningsPerJob = Math.min(
        this.config.verifierFeePerJob * 2,
        this.earningsPerJob * 1.05
      );
    } else {
      // Low attack rate = less demand
      this.earningsPerJob = Math.max(
        this.config.verifierFeePerJob * 0.5,
        this.earningsPerJob * 0.98
      );
    }
  }

  getSummary() {
    return {
      ...super.getSummary(),
      totalVerifications: this.totalVerifications,
      accuracy: +this.accuracy.toFixed(3),
      idleRounds: this.idleRounds,
      earningsPerJob: +this.earningsPerJob.toFixed(6),
    };
  }
}

module.exports = Verifier;
