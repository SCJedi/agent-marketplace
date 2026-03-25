'use strict';

const path = require('path');
const fs = require('fs');

// Seeded RNG for reproducibility
function createRng(seed) {
  let s = seed;
  return function() {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

async function main() {
  const config = require('./config');
  const Agent = require('./agents');
  const Provider = require('./providers');
  const Attacker = require('./attackers');
  const Verifier = require('./verifiers');
  const Market = require('./market');
  const { writeReport } = require('./report');

  // Use unique DB path
  const dbPath = path.join(__dirname, '..', '..', 'data', 'free-market-sim.db');
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  // Also clean WAL/SHM if present
  if (fs.existsSync(dbPath + '-wal')) fs.unlinkSync(dbPath + '-wal');
  if (fs.existsSync(dbPath + '-shm')) fs.unlinkSync(dbPath + '-shm');

  process.env.DB_PATH = dbPath;
  process.env.LOG_LEVEL = 'error'; // quiet server logs
  process.env.RATE_LIMIT = '99999'; // disable rate limiting for simulation speed

  // Clear module cache for db.js so it picks up new DB_PATH
  const dbModulePath = require.resolve('../../src/db');
  delete require.cache[dbModulePath];

  const { build } = require('../../src/server');
  const app = await build();

  const PORT = config.port;
  await app.listen({ port: PORT, host: '127.0.0.1' });
  const baseUrl = `http://127.0.0.1:${PORT}`;
  console.log(`Server started on ${baseUrl}`);

  const rng = createRng(config.seed);

  // ── Create initial participants ──
  const participants = [];
  let nextId = 1;

  console.log('Creating initial participants...');

  // Agents
  for (let i = 0; i < config.initialAgents; i++) {
    participants.push(new Agent(`agent-${nextId++}`, config, rng));
  }

  // Providers
  for (let i = 0; i < config.initialProviders; i++) {
    const p = new Provider(`provider-${nextId++}`, config, rng);
    await p.register(baseUrl);
    participants.push(p);
  }

  // Attackers
  for (let i = 0; i < config.initialAttackers; i++) {
    const a = new Attacker(`attacker-${nextId++}`, config, rng);
    await a.register(baseUrl, rng);
    participants.push(a);
  }

  // Verifiers
  for (let i = 0; i < config.initialVerifiers; i++) {
    const v = new Verifier(`verifier-${nextId++}`, config, rng);
    await v.register(baseUrl);
    participants.push(v);
  }

  console.log(`Participants: ${config.initialAgents} agents, ${config.initialProviders} providers, ${config.initialAttackers} attackers, ${config.initialVerifiers} verifiers`);

  // ── Market engine ──
  const market = new Market(config);

  // ── Run simulation ──
  console.log(`\nStarting ${config.rounds}-round simulation...\n`);

  for (let round = 1; round <= config.rounds; round++) {
    // Reset round P&L for all participants
    for (const p of participants) {
      p.resetRoundPnL();
    }

    // ── Phase 1: Providers act (crawl, publish) ──
    const activeProviders = participants.filter(p => p.type === 'provider' && p.active);
    for (const p of activeProviders) {
      await p.act(round, baseUrl, market.getState(), rng);
    }

    // ── Phase 2: Attackers act ──
    const activeAttackers = participants.filter(p => p.type === 'attacker' && p.active);
    for (const a of activeAttackers) {
      await a.act(round, baseUrl, market.getState(), rng);
    }

    // ── Phase 3: Agents act (buy content) ──
    const activeAgents = participants.filter(p => p.type === 'agent' && p.active);
    for (const a of activeAgents) {
      await a.act(round, baseUrl, market.getState(), rng);
    }

    // ── Phase 3b: Pay providers for sales ──
    // Track purchases and pay the providers who served the content
    for (const a of activeAgents) {
      const roundPurchases = a.ledger.filter(
        e => e.round === round && e.type === 'expense' && e.description.startsWith('buy:')
      );
      for (const purchase of roundPurchases) {
        const purchasedUrl = purchase.description.slice(4);
        // Find the provider whose inventory contains this URL
        let paid = false;
        for (const p of activeProviders) {
          if (!p.active) continue;
          if (p.inventory.has(purchasedUrl)) {
            p.recordSale(round, purchasedUrl, purchase.amount);
            paid = true;
            break;
          }
        }
        // If no specific provider found, pay a random active one (marketplace routing)
        if (!paid && activeProviders.length > 0) {
          const randP = activeProviders[Math.floor(rng() * activeProviders.length)];
          if (randP.active) randP.recordSale(round, purchasedUrl, purchase.amount);
        }
      }
    }

    // ── Phase 4: Verifiers act ──
    const activeVerifiers = participants.filter(p => p.type === 'verifier' && p.active);
    for (const v of activeVerifiers) {
      await v.act(round, baseUrl, market.getState(), rng);
    }

    // ── Phase 5: Record market state ──
    // Track token savings — only from actual purchases this round
    let roundPurchases = 0;
    for (const a of activeAgents) {
      const buys = a.ledger.filter(e => e.round === round && e.type === 'expense' && e.description.startsWith('buy:'));
      roundPurchases += buys.length;
      // Savings = crawl cost avoided minus what they paid
      for (const buy of buys) {
        const saved = config.crawlCostPerPage - buy.amount;
        if (saved > 0) market.totalTokensSaved += saved;
      }
    }
    market.totalTransactions += roundPurchases;

    const snapshot = market.recordRound(round, participants);

    // ── Phase 6: Bankruptcy check ──
    for (const p of participants) {
      if (p.active) {
        p.checkBankruptcy(round, config.bankruptcyRounds);
        if (!p.active) {
          market.events.push({
            round, type: 'exit',
            detail: `${p.id} (${p.type}) bankrupt — balance $${p.balance.toFixed(4)}`,
          });
        }
      }
    }

    // ── Phase 7: Adaptation (every adaptEvery rounds) ──
    if (round % config.adaptEvery === 0) {
      for (const p of participants) {
        if (p.active) {
          p.adapt(round, market.getState());
          if (!p.active) {
            market.events.push({
              round, type: 'exit',
              detail: `${p.id} (${p.type}) voluntary exit — ${p.exitReason}`,
            });
          }
        }
      }
    }

    // ── Phase 8: New entrants (every entrantCheckEvery rounds) ──
    if (round % config.entrantCheckEvery === 0) {
      const signals = market.getEntrySignals();

      for (let i = 0; i < signals.newProviders; i++) {
        const p = new Provider(`provider-${nextId++}`, config, rng, round);
        await p.register(baseUrl);
        participants.push(p);
      }

      for (let i = 0; i < signals.newAttackers; i++) {
        const a = new Attacker(`attacker-${nextId++}`, config, rng, round);
        await a.register(baseUrl, rng);
        participants.push(a);
      }

      for (let i = 0; i < signals.newVerifiers; i++) {
        const v = new Verifier(`verifier-${nextId++}`, config, rng, round);
        await v.register(baseUrl);
        participants.push(v);
      }
    }

    // ── Snapshots ──
    if (round % config.snapshotEvery === 0) {
      console.log(market.printSnapshot(round));
    }

    if (round % config.phaseReportEvery === 0) {
      const s = snapshot;
      console.log(`\n── PHASE REPORT (Round ${round}) ──`);
      console.log(`Phase: ${market.currentPhase}`);
      console.log(`Total participants: ${participants.length} (${participants.filter(p => p.active).length} active)`);
      console.log(`Exits this period: ${market.events.filter(e => e.type === 'exit' && e.round > round - 100).length}`);
      console.log(`New entrants this period: ${market.events.filter(e => e.type === 'new_entrant' && e.round > round - 100).length}`);
      console.log(`Cache coverage: ${s.cacheSize}/${config.urls.length} URLs (${(s.cacheHitRate * 100).toFixed(1)}%)`);
      console.log('');
    }
  }

  // ── Final report ──
  console.log('\n════════════════════════════════════════');
  console.log('  SIMULATION COMPLETE');
  console.log('════════════════════════════════════════\n');

  const reportPath = writeReport(market, participants, config);
  console.log(`Report written to: ${reportPath}`);

  // Print summary
  const finalState = market.getState();
  console.log(`\nFinal state:`);
  console.log(`  Phase: ${finalState.phase}`);
  console.log(`  Active providers: ${finalState.activeProviders}`);
  console.log(`  Active attackers: ${finalState.activeAttackers}`);
  console.log(`  Cache hit rate: ${(finalState.cacheHitRate * 100).toFixed(1)}%`);
  console.log(`  Avg price: $${finalState.avgPrice.toFixed(6)}`);
  console.log(`  Consumer satisfaction: ${finalState.avgSatisfaction.toFixed(3)}`);
  console.log(`  Total tokens saved: $${market.totalTokensSaved.toFixed(4)}`);

  // Shutdown
  await app.close();
  const db = require('../../src/db');
  db.closeDb();
  console.log('\nServer shut down cleanly.');
}

main().catch(err => {
  console.error('Simulation failed:', err);
  process.exit(1);
});
