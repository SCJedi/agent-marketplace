'use strict';

const path = require('path');
const fs = require('fs');
const config = require('./config');
const SimAgent = require('./participants/agent');
const SimProvider = require('./participants/provider');
const SimVerifier = require('./participants/verifier');
const SimMalicious = require('./participants/malicious');
const Dashboard = require('./dashboard');

// Use a separate database for simulation so we don't pollute production data
process.env.DB_PATH = path.join(__dirname, '..', 'data', 'simulation.db');
// Suppress fastify request logs — the dashboard replaces them
process.env.LOG_LEVEL = 'error';
// High rate limit for simulation
process.env.RATE_LIMIT = '10000';

const { build } = require('../src/server');

async function getMarketStats(baseUrl) {
  try {
    const [searchRes, trendRes] = await Promise.all([
      fetch(`${baseUrl}/search?q=.&type=content`).then(r => r.json()).catch(() => ({ success: false, data: { results: [], total: 0 } })),
      fetch(`${baseUrl}/trending?period=30d`).then(r => r.json()).catch(() => ({ success: false, data: { topContent: [], topArtifacts: [] } })),
    ]);

    const contentCount = searchRes.success ? searchRes.data.total : 0;

    const artRes = await fetch(`${baseUrl}/search?q=.&type=artifact`).then(r => r.json()).catch(() => ({ success: false, data: { total: 0 } }));
    const artifactCount = artRes.success ? artRes.data.total : 0;

    let totalPrice = 0;
    let priceCount = 0;
    if (searchRes.success && searchRes.data.results) {
      for (const r of searchRes.data.results) {
        if (r.price > 0) {
          totalPrice += r.price;
          priceCount++;
        }
      }
    }

    return {
      contentCount,
      artifactCount,
      totalFetches: 0,
      totalRevenue: 0,
      avgPrice: priceCount > 0 ? totalPrice / priceCount : 0,
    };
  } catch (err) {
    return { contentCount: 0, artifactCount: 0, totalFetches: 0, totalRevenue: 0, avgPrice: 0 };
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// RED TEAM FIX: Build provider lookup by nodeId and name for revenue attribution
function buildProviderIndex(providers) {
  const index = {};
  for (const p of providers) {
    const s = p.getStats();
    index[s.name] = p;
    if (p.nodeId) index[p.nodeId] = p;
  }
  return index;
}

async function main() {
  console.log('Starting Agent Marketplace Simulation (ITERATION 1 — Defenses)...');
  console.log(`Config: ${config.agents} agents, ${config.providers} providers, ${config.verifiers} verifiers, ${config.malicious} malicious`);
  console.log(`Rounds: ${config.rounds}, Delay: ${config.delayBetweenRounds}ms\n`);

  // Delete old simulation database
  const dbPath = path.join(__dirname, '..', 'data', 'simulation.db');
  try { fs.unlinkSync(dbPath); } catch (e) { /* doesn't exist yet */ }
  try { fs.unlinkSync(dbPath + '-wal'); } catch (e) { /* ignore */ }
  try { fs.unlinkSync(dbPath + '-shm'); } catch (e) { /* ignore */ }

  // Start the real marketplace server
  const app = await build();
  await app.listen({ port: config.nodePort, host: '127.0.0.1' });
  const baseUrl = `http://127.0.0.1:${config.nodePort}`;
  console.log(`Marketplace server started on ${baseUrl}`);

  // Verify server is up
  try {
    const health = await fetch(`${baseUrl}/health`).then(r => r.json());
    if (!health.success) throw new Error('Health check failed');
    console.log('Health check passed');
  } catch (err) {
    console.error('Server failed to start:', err.message);
    process.exit(1);
  }

  // Create participants
  const agents = [];
  for (let i = 1; i <= config.agents; i++) {
    agents.push(new SimAgent(i, baseUrl, config));
  }

  const providers = [];
  for (let i = 1; i <= config.providers; i++) {
    providers.push(new SimProvider(i, baseUrl, config));
  }

  const verifiers = [];
  for (let i = 1; i <= config.verifiers; i++) {
    verifiers.push(new SimVerifier(i, baseUrl, config));
  }

  const malicious = [];
  for (let i = 1; i <= config.malicious; i++) {
    malicious.push(new SimMalicious(i, baseUrl, config));
  }

  // Register providers, verifiers, and malicious actors
  console.log('Registering participants...');
  await Promise.all([
    ...providers.map(p => p.register()),
    ...verifiers.map(v => v.register()),
    ...malicious.map(m => m.register()),
  ]);
  console.log('All participants registered. Starting simulation...\n');
  await delay(500);

  const dashboard = new Dashboard(config);
  const eventLog = [];

  // RED TEAM FIX: Build provider index for revenue attribution
  const providerIndex = buildProviderIndex(providers);

  // Run simulation rounds
  for (let round = 1; round <= config.rounds; round++) {
    // Providers act first (so content is available for agents)
    await Promise.all(providers.map(p => p.act(round).catch(() => {})));

    // Then agents and verifiers act
    await Promise.all([
      ...agents.map(a => a.act(round).catch(() => {})),
      ...verifiers.map(v => v.act(round).catch(() => {})),
      ...malicious.map(m => m.act(round).catch(() => {})),
    ]);

    // RED TEAM FIX: Attribute revenue to providers from agent purchase logs
    for (const a of agents) {
      const recentLogs = a.log.filter(l => l.round === round && l.action === 'fetch' && l.provider);
      for (const entry of recentLogs) {
        const provider = providerIndex[entry.provider];
        if (provider && typeof provider.recordSale === 'function') {
          provider.recordSale(entry.price || 0, entry.url || null);
        }
      }
    }

    // Gather market stats
    const marketStats = await getMarketStats(baseUrl);
    marketStats.totalFetches = agents.reduce((s, a) => s + a.getStats().fetchCount, 0);
    marketStats.totalRevenue = agents.reduce((s, a) => s + a.getStats().spent, 0);

    // Log notable events
    for (const m of malicious) {
      const recent = m.log.filter(l => l.round === round);
      for (const entry of recent) {
        eventLog.push({ round, ...entry });
      }
    }

    // Update dashboard
    dashboard.render(round, agents, providers, verifiers, malicious, marketStats);

    if (round < config.rounds) {
      await delay(config.delayBetweenRounds);
    }
  }

  // Final summary
  console.log('\n');
  console.log('='.repeat(72));
  console.log('  SIMULATION COMPLETE — FINAL REPORT (ITERATION 1: DEFENSES)');
  console.log('='.repeat(72));

  // Economics
  const totalSpent = agents.reduce((s, a) => s + a.getStats().spent, 0);
  const totalFetches = agents.reduce((s, a) => s + a.getStats().fetchCount, 0);
  const totalSearches = agents.reduce((s, a) => s + a.getStats().searchCount, 0);
  const totalHits = agents.reduce((s, a) => s + a.getStats().cacheHits, 0);
  const totalMisses = agents.reduce((s, a) => s + a.getStats().cacheMisses, 0);
  const totalPublished = providers.reduce((s, p) => s + p.getStats().published, 0);
  const totalVerifications = verifiers.reduce((s, v) => s + v.getStats().verifications, 0);

  console.log('\nECONOMICS:');
  console.log(`  Total money spent by agents: $${totalSpent.toFixed(6)}`);
  console.log(`  Total content fetches: ${totalFetches}`);
  console.log(`  Total searches: ${totalSearches}`);
  console.log(`  Total content published by providers: ${totalPublished}`);
  console.log(`  Total verifications: ${totalVerifications}`);

  // RED TEAM FIX: Provider P&L
  console.log('\nPROVIDER ECONOMICS:');
  const providerStats = providers.map(p => p.getStats()).sort((a, b) => b.profitLoss - a.profitLoss);
  for (const s of providerStats) {
    const status = s.active ? 'ACTIVE' : 'EXITED';
    const plSign = s.profitLoss >= 0 ? '+' : '';
    console.log(`  ${s.name} (${s.specialty}/${s.strategy}): ${s.published} items | Revenue: $${s.revenue.toFixed(6)} | Costs: $${s.operatingCosts.toFixed(6)} | P&L: ${plSign}$${s.profitLoss.toFixed(6)} [${status}]`);
  }
  const activeProviders = providerStats.filter(s => s.active).length;
  const exitedProviders = providerStats.filter(s => !s.active).length;
  console.log(`  Active: ${activeProviders} | Exited: ${exitedProviders}`);

  // Cache efficiency
  const totalChecks = totalHits + totalMisses;
  const hitRate = totalChecks > 0 ? totalHits / totalChecks : 0;
  console.log('\nCACHE EFFICIENCY:');
  console.log(`  Cache hit rate: ${(hitRate * 100).toFixed(1)}%`);
  console.log(`  Cache hits: ${totalHits}  |  Misses: ${totalMisses}`);
  console.log(`  Waste reduction: ~${(hitRate * 100).toFixed(1)}% of duplicate crawls avoided`);

  // RED TEAM FIX: Agent quality metrics
  const totalQualityChecks = agents.reduce((s, a) => s + a.getStats().qualityChecks, 0);
  const totalQualityFailures = agents.reduce((s, a) => s + a.getStats().qualityFailures, 0);
  const qualityRate = totalQualityChecks > 0 ? ((totalQualityChecks - totalQualityFailures) / totalQualityChecks * 100).toFixed(1) : 'N/A';
  console.log('\nCONTENT QUALITY (as experienced by agents):');
  console.log(`  Quality checks: ${totalQualityChecks} | Failures: ${totalQualityFailures} | Quality rate: ${qualityRate}%`);

  const allBadProviders = new Set();
  for (const a of agents) {
    for (const bp of a.getStats().badProviders) {
      allBadProviders.add(bp);
    }
  }
  if (allBadProviders.size > 0) {
    console.log(`  Providers blacklisted by agents: ${Array.from(allBadProviders).join(', ')}`);
  }

  // Agent satisfaction
  const avgSatisfaction = agents.reduce((s, a) => s + a.getStats().satisfaction, 0) / agents.length;
  console.log('\nAGENT SATISFACTION:');
  console.log(`  Average satisfaction: ${(avgSatisfaction * 100).toFixed(1)}%`);

  // Red team results
  console.log('\nRED TEAM RESULTS:');
  let totalAttacksAttempted = 0;
  let totalAttacksSucceeded = 0;
  for (const m of malicious) {
    const s = m.getStats();
    totalAttacksAttempted += s.attacksAttempted;
    totalAttacksSucceeded += s.attacksSucceeded;
    console.log(`  ${s.name} [${s.personality}]:`);
    console.log(`    Attacks attempted: ${s.attacksAttempted}`);
    console.log(`    Caught/blocked: ${s.attacksCaught}`);
    console.log(`    Succeeded: ${s.attacksSucceeded}`);
    console.log(`    Success rate: ${s.attacksAttempted > 0 ? ((s.attacksSucceeded / s.attacksAttempted) * 100).toFixed(1) : 0}%`);
    if (s.sybilIdentities > 0) {
      console.log(`    Sybil identities created: ${s.sybilIdentities}`);
    }
    if (s.poisonedUrls.length > 0) {
      console.log(`    !! Cache poisoning succeeded for: ${s.poisonedUrls.join(', ')}`);
    }

    // Breakdown by attack type
    console.log('    Attack breakdown:');
    for (const [attack, stats] of Object.entries(s.attackSuccess)) {
      if (stats.attempted > 0) {
        console.log(`      ${attack}: ${stats.succeeded}/${stats.attempted} succeeded (${((stats.succeeded / stats.attempted) * 100).toFixed(0)}%)`);
      }
    }
  }
  console.log(`\n  TOTAL RED TEAM: ${totalAttacksSucceeded}/${totalAttacksAttempted} succeeded (${totalAttacksAttempted > 0 ? ((totalAttacksSucceeded / totalAttacksAttempted) * 100).toFixed(1) : 0}%)`);

  // ITERATION 1: Defense metrics
  console.log('\nITERATION 1 DEFENSES:');
  const totalConsensusChecks = agents.reduce((s, a) => s + a.getStats().consensusChecks, 0);
  const totalConsensusFailures = agents.reduce((s, a) => s + a.getStats().consensusFailures, 0);
  const allBlacklisted = new Set();
  for (const a of agents) {
    for (const bp of a.getStats().blacklistedProviders) {
      allBlacklisted.add(bp);
    }
  }
  console.log(`  Content consensus checks: ${totalConsensusChecks}`);
  console.log(`  Consensus failures (outlier detected): ${totalConsensusFailures}`);
  console.log(`  Providers blacklisted by agents: ${allBlacklisted.size} — ${Array.from(allBlacklisted).join(', ') || 'none'}`);

  const totalRateLimitHits = providers.reduce((s, p) => s + (p.rateLimitHits || 0), 0);
  console.log(`  Rate limit hits (providers): ${totalRateLimitHits}`);

  // Provider category ROI
  console.log('\nPROVIDER CATEGORY ROI:');
  for (const p of providers) {
    const s = p.getStats();
    if (Object.keys(s.categoryPL).length > 0) {
      const catSummary = Object.entries(s.categoryPL)
        .map(([cat, data]) => `${cat}:${data.pl >= 0 ? '+' : ''}$${data.pl.toFixed(4)}(${data.items}items)`)
        .join(' | ');
      console.log(`  ${s.name}: ${catSummary}`);
      if (s.unprofitableCategories.length > 0) {
        console.log(`    Dropped categories: ${s.unprofitableCategories.join(', ')}`);
      }
    }
  }

  // Save logs
  const logsDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(logsDir, `sim-redteam-${timestamp}.json`);
  const fullLog = {
    config: { ...config, urls: `${config.urls.length} URLs` },
    agents: agents.map(a => ({ ...a.getStats(), log: a.log })),
    providers: providers.map(p => ({ ...p.getStats(), log: p.log })),
    verifiers: verifiers.map(v => ({ ...v.getStats(), log: v.log })),
    malicious: malicious.map(m => ({ ...m.getStats(), log: m.log })),
    events: eventLog,
    summary: {
      totalSpent,
      totalFetches,
      totalSearches,
      totalPublished,
      totalVerifications,
      hitRate,
      avgSatisfaction,
      totalQualityChecks,
      totalQualityFailures,
      activeProviders,
      exitedProviders,
      totalAttacksAttempted,
      totalAttacksSucceeded,
      attackSuccessRate: totalAttacksAttempted > 0 ? totalAttacksSucceeded / totalAttacksAttempted : 0,
      totalConsensusChecks,
      totalConsensusFailures,
      totalBlacklistedProviders: allBlacklisted.size,
      totalRateLimitHits,
    },
  };

  fs.writeFileSync(logFile, JSON.stringify(fullLog, null, 2));
  console.log(`\nDetailed logs saved to: ${logFile}`);

  // Shutdown
  await app.close();
  console.log('\nSimulation server stopped. Done.');
  process.exit(0);
}

main().catch(err => {
  console.error('Simulation failed:', err);
  process.exit(1);
});
