'use strict';

module.exports = {
  // Statistical parameters
  trials: 30,              // 30 independent runs (standard for statistical significance)
  roundsPerTrial: 1000,    // 1000 rounds each (long enough for multiple market cycles)

  // Market size (realistic enough for emergent behavior)
  agents: 30,              // consumers
  initialProviders: 10,    // content providers
  initialAttackers: 5,     // bad actors (realistic — fraud is common)
  initialVerifiers: 3,     // verification market
  urlCount: 200,           // content universe

  // Market entry/exit checked every N rounds
  entryCheckInterval: 50,
  adaptEvery: 10,
  snapshotEvery: 50,
  bankruptcyRounds: 20,

  // Economics (same as free-market sim)
  crawlCostPerPage: 0.0010,
  storageCostPerItem: 0.000005,
  serverCostPerRound: 0.002,
  verifierStake: 0.05,
  verifierFeePerJob: 0.001,
  registrationDeposit: 0.01,
  publishFee: 0.0001,

  // Agent budgets (per round) — wider range for statistical variation
  agentBudgetMin: 0.05,
  agentBudgetMax: 0.50,

  // Provider starting capital
  providerCapitalMin: 0.50,
  providerCapitalMax: 2.00,

  // Attacker starting capital
  attackerCapitalMin: 0.30,
  attackerCapitalMax: 1.00,

  // Verifier starting capital
  verifierCapitalMin: 0.20,
  verifierCapitalMax: 0.50,

  // New entrant conditions
  profitGapThreshold: 0.3,
  attackProfitThreshold: 0.1,

  // Token cost ceiling
  tokenCostCeiling: 0.001,

  categories: ['tech', 'finance', 'ai', 'security', 'data', 'general', 'news', 'api',
               'cloud', 'devops', 'mobile', 'gaming', 'health', 'education', 'crypto',
               'iot', 'robotics', 'quantum', 'biotech', 'energy'],

  // Server port (unique per trial, base port — trial adds offset)
  basePort: 3460,

  // Don't print per-round — too noisy for 30 trials x 1000 rounds
  silent: true,
};
