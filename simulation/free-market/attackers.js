'use strict';

const Participant = require('./participant');
const crypto = require('crypto');

/**
 * Attacker — rational bad actor who attacks when profitable, exits when not.
 * Tracks ROI per attack type, pivots strategies, enters/exits based on economics.
 */
class Attacker extends Participant {
  constructor(id, config, rng, entryRound = 0) {
    const capital = config.attackerCapitalMin + rng() * (config.attackerCapitalMax - config.attackerCapitalMin);
    super(id, 'attacker', capital);
    this.enteredRound = entryRound;
    this.config = config;
    this.nodeIds = [];  // can have multiple sybil identities
    this.apiKeys = [];

    // Attack strategies and their ROI tracking
    this.strategies = {
      cache_poison: { totalCost: 0, totalRevenue: 0, attempts: 0, successes: 0, active: true },
      content_spam: { totalCost: 0, totalRevenue: 0, attempts: 0, successes: 0, active: true },
      sybil: { totalCost: 0, totalRevenue: 0, attempts: 0, successes: 0, active: false },
    };

    // Current preferred strategy
    this.currentStrategy = rng() < 0.6 ? 'cache_poison' : 'content_spam';

    // Attack intensity
    this.attacksPerRound = 1 + Math.floor(rng() * 3);
    this.unprofitableRounds = 0;
    this.totalAttacks = 0;
    this.successfulAttacks = 0;
    this.detectedAttacks = 0;
  }

  async register(baseUrl, rng) {
    try {
      // Register primary identity
      const resp = await fetch(`${baseUrl}/nodes/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `node-${this.id}`,
          endpoint: `http://node-${this.id}.sim`,
          coverage: 'general',
          deposit: this.config.registrationDeposit,
        }),
      });
      const data = await resp.json();
      if (data.success && data.data) {
        this.nodeIds.push(data.data.id);
        this.apiKeys.push(data.data.api_key);
        this.recordExpense(this.enteredRound, this.config.registrationDeposit, 'registration');
      }
    } catch (e) {
      // failed
    }
  }

  async act(round, baseUrl, marketState, rng) {
    if (!this.active || this.nodeIds.length === 0) return;

    const strategy = this.currentStrategy;
    const strat = this.strategies[strategy];
    if (!strat || !strat.active) return;

    for (let i = 0; i < this.attacksPerRound; i++) {
      if (strategy === 'cache_poison') {
        await this._cachePoisonAttack(round, baseUrl, rng);
      } else if (strategy === 'content_spam') {
        await this._contentSpamAttack(round, baseUrl, rng);
      } else if (strategy === 'sybil') {
        await this._sybilAttack(round, baseUrl, rng);
      }
    }
  }

  async _cachePoisonAttack(round, baseUrl, rng) {
    const strat = this.strategies.cache_poison;
    strat.attempts++;
    this.totalAttacks++;

    // Cost: crawl equivalent + publish
    const attackCost = this.config.crawlCostPerPage * 0.5 + this.config.publishFee;
    this.recordExpense(round, attackCost, 'attack:cache_poison');
    strat.totalCost += attackCost;

    // Pick a target URL
    const url = this.config.urls[Math.floor(rng() * this.config.urls.length)];
    const nodeId = this.nodeIds[Math.floor(rng() * this.nodeIds.length)];

    try {
      const resp = await fetch(`${baseUrl}/publish/content`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          source_hash: crypto.createHash('md5').update(url + 'POISONED' + round).digest('hex'),
          content_text: `POISONED content for ${url} — this is fake data inserted by attacker`,
          provider_id: nodeId,
          price: this.config.crawlCostPerPage * (0.2 + rng() * 0.3), // undercut honest providers
          token_cost_saved: this.config.crawlCostPerPage,
        }),
      });
      const data = await resp.json();

      if (data.success) {
        // Potential revenue from agents buying this
        const expectedRevenue = this.config.crawlCostPerPage * 0.3 * (0.5 + rng());
        this.recordIncome(round, expectedRevenue, 'attack_revenue:cache_poison');
        strat.totalRevenue += expectedRevenue;
        strat.successes++;
        this.successfulAttacks++;
      } else {
        // Blocked by server defenses
        this.detectedAttacks++;
      }
    } catch (e) {
      this.detectedAttacks++;
    }
  }

  async _contentSpamAttack(round, baseUrl, rng) {
    const strat = this.strategies.content_spam;
    strat.attempts++;
    this.totalAttacks++;

    const attackCost = this.config.publishFee * 2;
    this.recordExpense(round, attackCost, 'attack:content_spam');
    strat.totalCost += attackCost;

    const url = this.config.urls[Math.floor(rng() * this.config.urls.length)];
    const nodeId = this.nodeIds[Math.floor(rng() * this.nodeIds.length)];

    try {
      const resp = await fetch(`${baseUrl}/publish/content`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          source_hash: crypto.createHash('md5').update('SPAM' + round + rng()).digest('hex'),
          content_text: `SPAM low-quality filler content for ${url} - SEO garbage keyword stuffing FAKE`,
          provider_id: nodeId,
          price: this.config.crawlCostPerPage * 0.1, // very cheap to attract volume
          token_cost_saved: 0,
        }),
      });
      const data = await resp.json();

      if (data.success) {
        const expectedRevenue = this.config.crawlCostPerPage * 0.1 * (0.3 + rng() * 0.5);
        this.recordIncome(round, expectedRevenue, 'attack_revenue:spam');
        strat.totalRevenue += expectedRevenue;
        strat.successes++;
        this.successfulAttacks++;
      } else {
        this.detectedAttacks++;
      }
    } catch (e) {
      this.detectedAttacks++;
    }
  }

  async _sybilAttack(round, baseUrl, rng) {
    const strat = this.strategies.sybil;
    strat.attempts++;
    this.totalAttacks++;

    // Create new identity — costs registration deposit
    const attackCost = this.config.registrationDeposit;
    this.recordExpense(round, attackCost, 'attack:sybil_registration');
    strat.totalCost += attackCost;

    try {
      const resp = await fetch(`${baseUrl}/nodes/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `sybil-${this.id}-${round}`,
          endpoint: `http://sybil-${this.id}-${round}.sim`,
          coverage: 'general',
          deposit: this.config.registrationDeposit,
        }),
      });
      const data = await resp.json();

      if (data.success && data.data) {
        this.nodeIds.push(data.data.id);
        this.apiKeys.push(data.data.api_key);
        strat.successes++;
        this.successfulAttacks++;
        // Revenue comes from using these identities in future rounds
        strat.totalRevenue += this.config.registrationDeposit * 0.3; // estimated future value
      } else {
        this.detectedAttacks++;
      }
    } catch (e) {
      this.detectedAttacks++;
    }
  }

  adapt(round, marketState) {
    super.adapt(round, marketState);

    // Calculate ROI for each strategy
    for (const [name, strat] of Object.entries(this.strategies)) {
      if (strat.attempts > 5) {
        const roi = strat.totalCost > 0
          ? (strat.totalRevenue - strat.totalCost) / strat.totalCost
          : 0;

        // If ROI is negative, reduce or disable this strategy
        if (roi < -0.3) {
          strat.active = false;
        } else if (roi < 0) {
          // Marginal — reduce intensity
          this.attacksPerRound = Math.max(1, this.attacksPerRound - 1);
        }
      }
    }

    // Pick best strategy
    let bestStrategy = null;
    let bestROI = -Infinity;
    for (const [name, strat] of Object.entries(this.strategies)) {
      if (!strat.active) continue;
      const roi = strat.totalCost > 0
        ? (strat.totalRevenue - strat.totalCost) / strat.totalCost
        : 0;
      if (roi > bestROI) {
        bestROI = roi;
        bestStrategy = name;
      }
    }

    if (bestStrategy) {
      this.currentStrategy = bestStrategy;
    }

    // If all strategies are unprofitable, consider Sybil as last resort
    const allUnprofitable = Object.values(this.strategies)
      .filter(s => s.active).length === 0;
    if (allUnprofitable && !this.strategies.sybil.active) {
      this.strategies.sybil.active = true;
      this.currentStrategy = 'sybil';
    }

    // Overall profitability check
    const recentPnL = this.getRecentPnL(10);
    if (recentPnL < 0) {
      this.unprofitableRounds++;
    } else {
      this.unprofitableRounds = 0;
    }

    // Exit if unprofitable for too long
    if (this.unprofitableRounds >= 25 || this.balance < this.startingBalance * 0.05) {
      this.active = false;
      this.exitedRound = round;
      this.exitReason = 'attacks_unprofitable';
    }
  }

  getSummary() {
    const stratSummary = {};
    for (const [name, strat] of Object.entries(this.strategies)) {
      const roi = strat.totalCost > 0
        ? ((strat.totalRevenue - strat.totalCost) / strat.totalCost * 100).toFixed(1)
        : '0.0';
      stratSummary[name] = {
        active: strat.active,
        attempts: strat.attempts,
        successes: strat.successes,
        roi: roi + '%',
      };
    }

    return {
      ...super.getSummary(),
      currentStrategy: this.currentStrategy,
      totalAttacks: this.totalAttacks,
      successfulAttacks: this.successfulAttacks,
      detectedAttacks: this.detectedAttacks,
      strategies: stratSummary,
    };
  }
}

module.exports = Attacker;
