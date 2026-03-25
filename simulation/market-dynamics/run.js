'use strict';

const path = require('path');
const fs = require('fs');
const config = require('./config');
const MarketAgent = require('./market-agent');
const MarketProvider = require('./market-provider');
const Economics = require('./economics');
const Report = require('./report');

// Use separate database and port for this simulation
process.env.DB_PATH = path.join(__dirname, '..', '..', 'data', 'market-dynamics.db');
process.env.LOG_LEVEL = 'error';
process.env.RATE_LIMIT = '10000';

const { build } = require('../../src/server');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildProviderIndex(providers) {
  const index = {};
  for (const p of providers) {
    index[p.name] = p;
    if (p.nodeId) index[p.nodeId] = p;
  }
  return index;
}

async function main() {
  console.log('='.repeat(72));
  console.log('  MARKET DYNAMICS SIMULATION');
  console.log('  Testing free market economics — no malicious actors');
  console.log('='.repeat(72));
  console.log(`Config: ${config.agents} agents, ${config.providers} providers, ${config.rounds} rounds`);
  console.log(`Budget tiers: cheap(${config.budgetTiers.cheap.count}), standard(${config.budgetTiers.standard.count}), premium(${config.budgetTiers.premium.count})`);
  console.log(`New entrants at round 50: ${config.newEntrants.length}`);
  console.log(`Demand shock at round 70: remove ${config.demandShockRemoveCount} URLs\n`);

  // Clean old database
  const dbPath = path.join(__dirname, '..', '..', 'data', 'market-dynamics.db');
  try { fs.unlinkSync(dbPath); } catch (e) { /* doesn't exist */ }
  try { fs.unlinkSync(dbPath + '-wal'); } catch (e) { /* ignore */ }
  try { fs.unlinkSync(dbPath + '-shm'); } catch (e) { /* ignore */ }

  // Start server
  const app = await build();
  await app.listen({ port: config.nodePort, host: '127.0.0.1' });
  const baseUrl = `http://127.0.0.1:${config.nodePort}`;
  console.log(`Marketplace server started on ${baseUrl}`);

  // Health check
  try {
    const health = await fetch(`${baseUrl}/health`).then(r => r.json());
    if (!health.success) throw new Error('Health check failed');
    console.log('Health check passed');
  } catch (err) {
    console.error('Server failed to start:', err.message);
    process.exit(1);
  }

  // Create agents across budget tiers
  const agents = [];
  let agentId = 1;
  for (const [tier, tierConfig] of Object.entries(config.budgetTiers)) {
    for (let i = 0; i < tierConfig.count; i++) {
      agents.push(new MarketAgent(agentId++, baseUrl, config, tier));
    }
  }
  console.log(`Created ${agents.length} agents`);

  // Create initial providers
  const providers = [];
  for (const profile of config.providerProfiles) {
    providers.push(new MarketProvider(profile, baseUrl, config));
  }
  console.log(`Created ${providers.length} providers`);

  // Register providers
  console.log('Registering providers...');
  await Promise.all(providers.map(p => p.register()));
  console.log('All providers registered. Starting simulation...\n');
  await delay(500);

  const economics = new Economics(config);

  // Keep a mutable copy of URLs for demand shock
  let activeUrls = [...config.urls];

  // ---- SIMULATION LOOP ----
  for (let round = 1; round <= config.rounds; round++) {
    // ---- Round 50: New market entrants ----
    if (round === 50) {
      console.log('\n>>> ROUND 50: 3 new providers entering the market <<<\n');
      for (const profile of config.newEntrants) {
        const newProvider = new MarketProvider(profile, baseUrl, config);
        newProvider.enteredAtRound = 50;
        await newProvider.register();
        providers.push(newProvider);
      }
    }

    // ---- Round 70: Demand shock ----
    if (round === 70) {
      console.log('\n>>> ROUND 70: DEMAND SHOCK — removing 30 URLs from pool <<<\n');
      // Remove last 30 URLs
      activeUrls = activeUrls.slice(0, activeUrls.length - config.demandShockRemoveCount);
      // Update config so agents and providers use the reduced pool
      config.urls = activeUrls;
    }

    // Providers act first
    await Promise.all(providers.map(p => p.act(round).catch(() => {})));

    // Then agents act
    await Promise.all(agents.map(a => a.act(round).catch(() => {})));

    // Attribute revenue to providers
    const providerIndex = buildProviderIndex(providers);
    for (const a of agents) {
      const recentFetches = a.log.filter(l => l.round === round && l.action === 'fetch' && l.provider);
      for (const entry of recentFetches) {
        const provider = providerIndex[entry.provider];
        if (provider && typeof provider.recordSale === 'function') {
          provider.recordSale(entry.price || 0);
        }
      }
    }

    // Take economics snapshot every 5 rounds
    if (round % 5 === 0) {
      economics.snapshot(round, agents, providers);
    }

    // Print market snapshot every 10 rounds
    if (round % 10 === 0) {
      const snap = economics.snapshots[economics.snapshots.length - 1];
      const activeCount = providers.filter(p => p.active).length;
      const totalSpent = agents.reduce((s, a) => s + a.getStats().spent, 0);
      const avgSat = agents.reduce((s, a) => s + a.getStats().satisfaction, 0) / agents.length;

      console.log(`--- Round ${round}/${config.rounds} ---`);
      console.log(`  Active providers: ${activeCount}/${providers.length}`);
      console.log(`  Avg price: $${snap.avgPrice.toFixed(6)} | Price range: $${snap.minPrice.toFixed(6)} - $${snap.maxPrice.toFixed(6)}`);
      console.log(`  Total spent: $${totalSpent.toFixed(6)} | Cache hit rate: ${(snap.cacheHitRate * 100).toFixed(1)}%`);
      console.log(`  HHI: ${snap.hhi} | Gini: ${snap.gini.toFixed(3)} | Avg satisfaction: ${(avgSat * 100).toFixed(1)}%`);
      console.log('');
    }

    if (round < config.rounds) {
      await delay(config.delayBetweenRounds);
    }
  }

  // ---- FINAL REPORT ----
  // Take final snapshot
  economics.snapshot(config.rounds, agents, providers);

  const marketFailures = economics.detectMarketFailures(agents);
  const reportGen = new Report(config);
  const reportContent = reportGen.generate(economics, agents, providers, marketFailures);

  // Print to console
  console.log('\n');
  console.log(reportContent);

  // Save report
  const reportPath = reportGen.save(reportContent);
  console.log(`\nReport saved to: ${reportPath}`);

  // Save detailed JSON log
  const logsDir = path.join(__dirname, '..', 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(logsDir, `market-dynamics-${timestamp}.json`);
  const fullLog = {
    config: { ...config, urls: `${config.urls.length} URLs` },
    agents: agents.map(a => ({ ...a.getStats(), log: a.log })),
    providers: providers.map(p => ({ ...p.getStats(), log: p.log })),
    economics: economics.getFullReport(),
    marketFailures,
  };
  fs.writeFileSync(jsonPath, JSON.stringify(fullLog, null, 2));
  console.log(`Detailed JSON log: ${jsonPath}`);

  // Shutdown
  await app.close();
  console.log('\nSimulation complete.');
  process.exit(0);
}

main().catch(err => {
  console.error('Simulation failed:', err);
  process.exit(1);
});
