'use strict';

const path = require('path');
const fs = require('fs');

// Seeded RNG for reproducibility within a trial
function createRng(seed) {
  let s = seed;
  return function () {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/**
 * Run a single trial of N rounds.
 * Each trial starts a fresh server with its own DB — no state leakage.
 *
 * @param {number} trialId   - trial index (0-based)
 * @param {object} config    - statistical config
 * @returns {object}         - results object with time series and aggregate data
 */
async function runTrial(trialId, config) {
  const port = config.basePort + trialId;
  const dbPath = path.join(__dirname, '..', '..', 'data', `stat-trial-${trialId}.db`);

  // Clean up any prior DB files
  for (const ext of ['', '-wal', '-shm']) {
    const f = dbPath + ext;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  // Set environment BEFORE requiring server/db modules
  process.env.DB_PATH = dbPath;
  process.env.LOG_LEVEL = 'error';
  process.env.RATE_LIMIT = '99999';

  // Clear module caches to force fresh DB
  const dbModulePath = require.resolve('../../src/db');
  delete require.cache[dbModulePath];

  // Also clear server module cache and all route modules so they pick up fresh db
  const serverModulePath = require.resolve('../../src/server');
  const routeDir = path.join(__dirname, '..', '..', 'src', 'routes');
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(routeDir) || key === serverModulePath) {
      delete require.cache[key];
    }
  }

  // Also clear middleware cache
  const mwDir = path.join(__dirname, '..', '..', 'src', 'middleware');
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(mwDir)) {
      delete require.cache[key];
    }
  }

  const { build } = require('../../src/server');
  const Agent = require('../free-market/agents');
  const Provider = require('../free-market/providers');
  const Attacker = require('../free-market/attackers');
  const Verifier = require('../free-market/verifiers');
  const Market = require('../free-market/market');

  let app;
  try {
    app = await build();
    await app.listen({ port, host: '127.0.0.1' });
  } catch (err) {
    throw new Error(`Trial ${trialId}: server start failed on port ${port}: ${err.message}`);
  }

  const baseUrl = `http://127.0.0.1:${port}`;

  // Each trial gets a unique seed for randomized initial conditions
  const rng = createRng(trialId * 7919 + 31337);

  // Build config overlay for the free-market classes
  // Generate URLs for the configured pool size
  const trialConfig = {
    ...config,
    port,
    rounds: config.roundsPerTrial,
    initialAgents: config.agents,
    entrantCheckEvery: config.entryCheckInterval,
    agentBudgetMin: config.agentBudgetMin,
    agentBudgetMax: config.agentBudgetMax,
    urls: generateUrls(config.urlCount, config.categories),
    seed: trialId * 7919 + 31337,
  };

  // ── Create participants with RANDOMIZED initial conditions ──
  const participants = [];
  let nextId = 1;

  for (let i = 0; i < trialConfig.initialAgents; i++) {
    participants.push(new Agent(`agent-${nextId++}`, trialConfig, rng));
  }

  for (let i = 0; i < trialConfig.initialProviders; i++) {
    const p = new Provider(`provider-${nextId++}`, trialConfig, rng);
    await p.register(baseUrl);
    participants.push(p);
  }

  for (let i = 0; i < trialConfig.initialAttackers; i++) {
    const a = new Attacker(`attacker-${nextId++}`, trialConfig, rng);
    await a.register(baseUrl, rng);
    participants.push(a);
  }

  for (let i = 0; i < trialConfig.initialVerifiers; i++) {
    const v = new Verifier(`verifier-${nextId++}`, trialConfig, rng);
    await v.register(baseUrl);
    participants.push(v);
  }

  const market = new Market(trialConfig);

  // ── Time series collectors ──
  const priceHistory = [];
  const cacheHitHistory = [];
  const providerCountHistory = [];
  const attackerCountHistory = [];
  const attackSuccessHistory = [];
  const verifierCountHistory = [];
  const agentSatisfactionHistory = [];
  const providerMarginHistory = [];
  const consumerSurplusHistory = [];

  // ── Run rounds ──
  const rounds = trialConfig.rounds;

  for (let round = 1; round <= rounds; round++) {
    // Reset round P&L
    for (const p of participants) p.resetRoundPnL();

    // Phase 1: Providers act
    const activeProviders = participants.filter(p => p.type === 'provider' && p.active);
    for (const p of activeProviders) {
      await p.act(round, baseUrl, market.getState(), rng);
    }

    // Phase 2: Attackers act
    const activeAttackers = participants.filter(p => p.type === 'attacker' && p.active);
    for (const a of activeAttackers) {
      await a.act(round, baseUrl, market.getState(), rng);
    }

    // Phase 3: Agents act
    const activeAgents = participants.filter(p => p.type === 'agent' && p.active);
    for (const a of activeAgents) {
      await a.act(round, baseUrl, market.getState(), rng);
    }

    // Phase 3b: Pay providers for agent purchases
    for (const a of activeAgents) {
      const roundPurchases = a.ledger.filter(
        e => e.round === round && e.type === 'expense' && e.description.startsWith('buy:')
      );
      for (const purchase of roundPurchases) {
        const purchasedUrl = purchase.description.slice(4);
        let paid = false;
        for (const p of activeProviders) {
          if (!p.active) continue;
          if (p.inventory.has(purchasedUrl)) {
            p.recordSale(round, purchasedUrl, purchase.amount);
            paid = true;
            break;
          }
        }
        if (!paid && activeProviders.length > 0) {
          const randP = activeProviders[Math.floor(rng() * activeProviders.length)];
          if (randP.active) randP.recordSale(round, purchasedUrl, purchase.amount);
        }
      }
    }

    // Phase 4: Verifiers act
    const activeVerifiers = participants.filter(p => p.type === 'verifier' && p.active);
    for (const v of activeVerifiers) {
      await v.act(round, baseUrl, market.getState(), rng);
    }

    // Phase 5: Record market state
    let roundPurchases = 0;
    for (const a of activeAgents) {
      const buys = a.ledger.filter(e => e.round === round && e.type === 'expense' && e.description.startsWith('buy:'));
      roundPurchases += buys.length;
      for (const buy of buys) {
        const saved = trialConfig.crawlCostPerPage - buy.amount;
        if (saved > 0) market.totalTokensSaved += saved;
      }
    }
    market.totalTransactions += roundPurchases;

    const snapshot = market.recordRound(round, participants);

    // Collect time series
    priceHistory.push(snapshot.avgPrice);
    cacheHitHistory.push(snapshot.cacheHitRate);
    providerCountHistory.push(snapshot.activeProviders);
    attackerCountHistory.push(snapshot.activeAttackers);
    verifierCountHistory.push(snapshot.activeVerifiers);
    agentSatisfactionHistory.push(snapshot.avgSatisfaction);
    providerMarginHistory.push(snapshot.avgProviderMargin);
    consumerSurplusHistory.push(snapshot.consumerSurplus);

    // Attack success rate this round
    const totalAttacks = activeAttackers.reduce((s, a) => s + a.totalAttacks, 0);
    const successfulAttacks = activeAttackers.reduce((s, a) => s + a.successfulAttacks, 0);
    attackSuccessHistory.push(totalAttacks > 0 ? successfulAttacks / totalAttacks : 0);

    // Phase 6: Bankruptcy check
    for (const p of participants) {
      if (p.active) p.checkBankruptcy(round, trialConfig.bankruptcyRounds);
    }

    // Phase 7: Adaptation
    if (round % trialConfig.adaptEvery === 0) {
      for (const p of participants) {
        if (p.active) p.adapt(round, market.getState());
      }
    }

    // Phase 8: New entrants
    if (round % trialConfig.entrantCheckEvery === 0) {
      const signals = market.getEntrySignals();
      for (let i = 0; i < signals.newProviders; i++) {
        const p = new Provider(`provider-${nextId++}`, trialConfig, rng, round);
        await p.register(baseUrl);
        participants.push(p);
      }
      for (let i = 0; i < signals.newAttackers; i++) {
        const a = new Attacker(`attacker-${nextId++}`, trialConfig, rng, round);
        await a.register(baseUrl, rng);
        participants.push(a);
      }
      for (let i = 0; i < signals.newVerifiers; i++) {
        const v = new Verifier(`verifier-${nextId++}`, trialConfig, rng, round);
        await v.register(baseUrl);
        participants.push(v);
      }
    }
  }

  // ── Collect final results ──
  const providers = participants.filter(p => p.type === 'provider');
  const attackers = participants.filter(p => p.type === 'attacker');
  const agents = participants.filter(p => p.type === 'agent');
  const verifiers = participants.filter(p => p.type === 'verifier');

  const activeProvidersFinal = providers.filter(p => p.active);
  const activeAttackersFinal = attackers.filter(p => p.active);

  // Detect phases
  const phases = market.getPhaseTimeline().map(ph => ({ name: ph.phase, round: ph.round }));

  // Rounds to maturity
  const maturityPhase = phases.find(p => p.name === 'maturity');
  const roundsToMaturity = maturityPhase ? maturityPhase.round : null;

  // Rounds to attacker exit
  const lastAttackerExitRound = attackers
    .filter(a => !a.active && a.exitedRound)
    .map(a => a.exitedRound);
  const roundsToAttackerExit = lastAttackerExitRound.length === attackers.length && lastAttackerExitRound.length > 0
    ? Math.max(...lastAttackerExitRound)
    : null;

  // Price equilibrium detection — check last 100 rounds
  let priceEquilibrium = null;
  if (priceHistory.length >= 100) {
    const last100 = priceHistory.slice(-100);
    const priceStd = require('./stats').stddev(last100);
    const priceMean = require('./stats').mean(last100);
    if (priceStd < priceMean * 0.15 || priceStd < 0.00005) {
      priceEquilibrium = priceMean;
    }
  }

  // HHI — market concentration from provider sales
  const providerSales = activeProvidersFinal.map(p => p.itemsSold);

  const results = {
    trialId,
    // Time series
    priceHistory,
    cacheHitHistory,
    providerCountHistory,
    attackerCountHistory,
    attackSuccessHistory,
    verifierCountHistory,
    agentSatisfactionHistory,
    providerMarginHistory,
    consumerSurplusHistory,

    // Final state
    finalProviderCount: activeProvidersFinal.length,
    finalAttackerCount: activeAttackersFinal.length,
    finalCacheHitRate: cacheHitHistory.length > 0 ? cacheHitHistory[cacheHitHistory.length - 1] : 0,
    finalAvgPrice: priceHistory.length > 0 ? priceHistory[priceHistory.length - 1] : 0,
    survivingProviders: activeProvidersFinal.length,
    exitedProviders: providers.filter(p => !p.active).length,
    newEntrants: providers.filter(p => p.enteredRound > 0).length,

    // Aggregate
    totalTransactions: market.totalTransactions,
    totalRevenue: providers.reduce((s, p) => s + p.totalIncome, 0),
    totalWasteReduction: market.totalTokensSaved,
    providerProfitability: providers.map(p => p.getTotalPnL()),
    attackerProfitability: attackers.map(p => p.getTotalPnL()),
    providerSales,

    // Agent metrics
    agentSatisfactions: agents.map(a => a.getAvgSatisfaction(50)),
    agentBadExperiences: agents.map(a => a.badExperiences),
    totalPurchases: agents.reduce((s, a) => s + a.totalPurchases, 0),

    // Phase detection
    phases,
    roundsToMaturity,
    roundsToAttackerExit,
    priceEquilibrium,
  };

  // ── Cleanup ──
  await app.close();

  // Close the DB
  delete require.cache[dbModulePath];
  try {
    const dbMod = require('../../src/db');
    dbMod.closeDb();
    delete require.cache[require.resolve('../../src/db')];
  } catch (e) {
    // ok — may already be closed
  }

  // Remove DB files
  for (const ext of ['', '-wal', '-shm']) {
    const f = dbPath + ext;
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) { /* ok */ }
  }

  return results;
}

/**
 * Generate a URL pool of the specified size across categories.
 */
function generateUrls(count, categories) {
  const domains = [
    'docs.python.org/3/tutorial', 'developer.mozilla.org/js-guide',
    'react.dev/learn', 'nodejs.org/docs', 'docs.docker.com/start',
    'kubernetes.io/tutorials', 'rust-lang.org/learn', 'go.dev/tutorial',
    'docs.github.com/actions', 'tailwindcss.com/docs',
    'investopedia.com/bitcoin', 'ethereum.org/developers',
    'docs.solana.com/intro', 'coindesk.com/markets', 'defillama.com/api',
    'bloomberg.com/crypto', 'yahoo.finance/btc', 'tradingview.com/chart',
    'binance.com/api-docs', 'coingecko.com/api',
    'huggingface.co/transformers', 'pytorch.org/tutorials',
    'tensorflow.org/tutorials', 'openai.com/docs', 'anthropic.com/docs',
    'deepmind.com/research', 'arxiv.org/2301.00234', 'arxiv.org/2310.06825',
    'paperswithcode.com/sota', 'mlflow.org/docs',
    'owasp.org/top-ten', 'cve.mitre.org/2026', 'nvd.nist.gov/vuln',
    'exploit-db.com', 'portswigger.net/security', 'hackerone.com/reports',
    'snyk.io/vuln', 'cisa.gov/advisories', 'nmap.org/docs', 'wireshark.org/docs',
    'data.worldbank.org/gdp', 'kaggle.com/datasets', 'datasetsearch.google.com',
    'registry.opendata.aws', 'data.gov/datasets', 'eurostat.ec.europa.eu',
    'census.gov/data', 'who.int/data', 'imf.org/data', 'un.org/statistics',
    'wikipedia.org/machine-learning', 'wikipedia.org/blockchain',
    'wikipedia.org/quantum-computing', 'wikipedia.org/artificial-intelligence',
    'stackoverflow.com/questions', 'medium.com/tech', 'dev.to/latest',
    'hackernews.com/best', 'reddit.com/r/programming', 'lobste.rs/newest',
    'techcrunch.com/latest', 'arstechnica.com/science', 'theverge.com/tech',
    'wired.com/latest', 'zdnet.com/news', 'engadget.com/tech',
    'venturebeat.com/ai', 'thenextweb.com/latest', 'protocol.com/fintech',
    'restofworld.org/tech',
    'stripe.com/docs/api', 'docs.github.com/rest', 'maps.google.com/docs',
    'aws.amazon.com/sdk-js', 'cloud.google.com/docs', 'azure.microsoft.com/docs',
    'twilio.com/docs/api', 'sendgrid.com/docs', 'cloudflare.com/api', 'vercel.com/docs',
  ];

  const urls = [];
  for (let i = 0; i < count; i++) {
    const base = domains[i % domains.length];
    const suffix = Math.floor(i / domains.length);
    urls.push(`https://${base}/page-${i}-v${suffix}`);
  }
  return urls;
}

module.exports = { runTrial };
