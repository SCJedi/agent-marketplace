'use strict';

const fs = require('fs');
const path = require('path');

class Report {
  constructor(config) {
    this.config = config;
  }

  generate(economics, agents, providers, marketFailures) {
    const report = economics.getFullReport();
    const snapshots = report.snapshots;
    const final = report.finalMetrics;

    if (!final) return 'No data to report.';

    const lines = [];
    const hr = '='.repeat(72);
    const hr2 = '-'.repeat(72);

    lines.push('# Market Dynamics Simulation Report');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`Rounds: ${this.config.rounds} | Agents: ${agents.length} | Initial Providers: ${this.config.providers}`);
    lines.push('');

    // ---- Price Over Time (ASCII chart) ----
    lines.push('## Price Over Time');
    lines.push('');
    lines.push(this._priceChart(snapshots));
    lines.push('');

    // ---- Price Convergence ----
    lines.push('## Price Convergence');
    if (snapshots.length >= 2) {
      const first = snapshots[0];
      const last = snapshots[snapshots.length - 1];
      lines.push(`  Starting avg price: $${first.avgPrice.toFixed(6)}`);
      lines.push(`  Final avg price:    $${last.avgPrice.toFixed(6)}`);
      lines.push(`  Price std dev:      $${last.priceStdDev.toFixed(6)}`);
      lines.push(`  Converged:          ${report.converged ? 'YES' : 'NO'}`);
      const priceDelta = ((last.avgPrice - first.avgPrice) / Math.max(0.000001, first.avgPrice) * 100).toFixed(1);
      lines.push(`  Price change:       ${priceDelta}%`);
    }
    lines.push('');

    // ---- Provider Profitability ----
    lines.push('## Provider Profitability Ranking');
    lines.push('');
    const providerStats = providers.map(p => p.getStats()).sort((a, b) => (b.revenue - b.totalCosts) - (a.revenue - a.totalCosts));
    lines.push('| Rank | Provider | Strategy | Specialty | Revenue | Costs | P&L | Status |');
    lines.push('|------|----------|----------|-----------|---------|-------|-----|--------|');
    providerStats.forEach((p, i) => {
      const pl = p.revenue - p.totalCosts;
      const plStr = pl >= 0 ? `+$${pl.toFixed(5)}` : `-$${Math.abs(pl).toFixed(5)}`;
      const status = p.active ? 'Active' : `Exited R${p.exitedAtRound}`;
      lines.push(`| ${i + 1} | ${p.name} | ${p.strategy} | ${p.specialty} | $${p.revenue.toFixed(5)} | $${p.totalCosts.toFixed(5)} | ${plStr} | ${status} |`);
    });
    lines.push('');

    // ---- Market Concentration ----
    lines.push('## Market Concentration (HHI)');
    lines.push('');
    lines.push(this._hhiChart(snapshots));
    lines.push('');
    lines.push(`  Final HHI: ${final.hhi}`);
    lines.push(`  Interpretation: ${this._hhiInterpretation(final.hhi)}`);
    lines.push('');

    // ---- Consumer & Producer Surplus ----
    lines.push('## Economic Surplus');
    lines.push(`  Consumer surplus: $${final.consumerSurplus.toFixed(6)}`);
    lines.push(`  Producer surplus: $${final.producerSurplus.toFixed(6)}`);
    lines.push(`  Dead weight loss: $${final.deadWeightLoss.toFixed(6)}`);
    lines.push(`  Total refused (overpriced): ${final.totalRefused}`);
    lines.push('');

    // ---- Cache Efficiency ----
    lines.push('## Cache Efficiency Over Time');
    lines.push('');
    lines.push(this._cacheChart(snapshots));
    lines.push('');
    lines.push(`  Final cache hit rate: ${(final.cacheHitRate * 100).toFixed(1)}%`);
    lines.push(`  Waste reduction: ${(final.wasteReduction * 100).toFixed(1)}%`);
    lines.push(`  Total cache hits: ${final.totalCacheHits}`);
    lines.push(`  Total cache misses: ${final.totalCacheMisses}`);
    lines.push('');

    // ---- Provider Survival ----
    lines.push('## Provider Lifecycle');
    const survived = providerStats.filter(p => p.active);
    const exited = providerStats.filter(p => !p.active);
    const entered = providerStats.filter(p => p.enteredAtRound > 1);
    lines.push(`  Started:  ${this.config.providers}`);
    lines.push(`  Entered:  ${entered.length} (at round 50)`);
    lines.push(`  Exited:   ${exited.length}`);
    lines.push(`  Survived: ${survived.length}`);
    if (exited.length > 0) {
      lines.push('  Exited providers:');
      for (const p of exited) {
        lines.push(`    - ${p.name} (${p.strategy}/${p.specialty}) at round ${p.exitedAtRound}, P&L: $${(p.revenue - p.totalCosts).toFixed(5)}`);
      }
    }
    lines.push('');

    // ---- Gini Coefficient ----
    lines.push('## Income Inequality (Gini)');
    lines.push(`  Provider Gini coefficient: ${final.gini.toFixed(3)}`);
    lines.push(`  Interpretation: ${this._giniInterpretation(final.gini)}`);
    lines.push('');

    // ---- Agent Satisfaction by Tier ----
    lines.push('## Agent Satisfaction by Tier');
    for (const [tier, sat] of Object.entries(final.satisfactionByTier)) {
      const bar = '#'.repeat(Math.round(sat * 40));
      lines.push(`  ${tier.padEnd(10)} ${bar} ${(sat * 100).toFixed(1)}%`);
    }
    lines.push(`  Overall: ${(final.avgSatisfaction * 100).toFixed(1)}%`);
    lines.push('');

    // ---- Market Failures ----
    lines.push('## Market Failures (Unserved Demand)');
    if (marketFailures.length > 0) {
      lines.push(`  ${marketFailures.length} URLs with persistent cache misses:`);
      for (const f of marketFailures.slice(0, 15)) {
        lines.push(`    - ${f.url} (${f.misses} misses)`);
      }
      if (marketFailures.length > 15) {
        lines.push(`    ... and ${marketFailures.length - 15} more`);
      }
    } else {
      lines.push('  No persistent market failures detected.');
    }
    lines.push('');

    // ---- Key Questions Answered ----
    lines.push(hr);
    lines.push('## Key Questions');
    lines.push(hr2);
    lines.push('');

    // 1. Price convergence
    lines.push(`1. **Do prices converge?** ${report.converged ? 'YES' : 'NO'}`);
    if (snapshots.length >= 2) {
      const firstPrice = snapshots[0].avgPrice;
      const lastPrice = snapshots[snapshots.length - 1].avgPrice;
      lines.push(`   Prices moved from $${firstPrice.toFixed(6)} to $${lastPrice.toFixed(6)}`);
    }
    lines.push('');

    // 2. Sustainability
    const profitable = providerStats.filter(p => (p.revenue - p.totalCosts) > 0).length;
    lines.push(`2. **Is the market sustainable?** ${profitable}/${providerStats.length} providers profitable`);
    lines.push('');

    // 3. Cache effectiveness
    lines.push(`3. **Does the cache work?** ${final.cacheHitRate > 0.5 ? 'YES' : final.cacheHitRate > 0.2 ? 'PARTIALLY' : 'NO'} — ${(final.cacheHitRate * 100).toFixed(1)}% hit rate`);
    lines.push('');

    // 4. Competition
    const earlyRefused = snapshots.length > 2 ? snapshots[2].totalRefused : 0;
    const lateRefused = final.totalRefused;
    lines.push(`4. **Does competition help?** Refused transactions: early=${earlyRefused}, final=${lateRefused}`);
    lines.push(`   HHI: ${final.hhi} (${this._hhiInterpretation(final.hhi)})`);
    lines.push('');

    // 5. Self-healing
    lines.push(`5. **Does the market self-heal?** ${entered.length > 0 ? 'New entrants joined at R50.' : 'No new entrants.'} ${exited.length > 0 ? `${exited.length} providers exited.` : 'No exits.'}`);
    lines.push('');

    // 6. Market failure
    lines.push(`6. **Is there market failure?** ${marketFailures.length > 0 ? `YES — ${marketFailures.length} underserved URLs` : 'NO — all demand met'}`);
    lines.push('');

    // 7. Who wins
    const winner = providerStats[0];
    lines.push(`7. **Who wins?** ${winner.name} (${winner.strategy}/${winner.specialty}) with P&L $${(winner.revenue - winner.totalCosts).toFixed(5)}`);
    lines.push('');

    // ---- Overall Assessment ----
    lines.push(hr);
    lines.push('## Overall Market Health Score');
    const healthScore = this._healthScore(final, report.converged, profitable, providerStats.length, marketFailures.length);
    lines.push(`  Score: ${healthScore}/100`);
    lines.push(`  Rating: ${this._healthRating(healthScore)}`);
    lines.push(hr);

    return lines.join('\n');
  }

  _priceChart(snapshots) {
    if (snapshots.length === 0) return '  (no data)';
    const width = 60;
    const height = 12;
    const prices = snapshots.map(s => s.avgPrice);
    const min = Math.min(...prices) * 0.9;
    const max = Math.max(...prices) * 1.1 || 0.001;
    const range = max - min || 0.0001;

    const grid = Array.from({ length: height }, () => Array(width).fill(' '));

    // Plot prices
    for (let i = 0; i < snapshots.length && i < width; i++) {
      const idx = Math.floor(i * (snapshots.length / width));
      if (idx >= snapshots.length) break;
      const y = Math.round((prices[idx] - min) / range * (height - 1));
      const row = height - 1 - y;
      if (row >= 0 && row < height) grid[row][i] = '*';
    }

    const lines = [];
    lines.push(`  $${max.toFixed(6)} |`);
    for (let r = 0; r < height; r++) {
      const label = r === Math.floor(height / 2) ? `$${((min + max) / 2).toFixed(6)}` : '          ';
      lines.push(`  ${label} |${grid[r].join('')}|`);
    }
    lines.push(`  $${min.toFixed(6)} |${'_'.repeat(width)}|`);
    lines.push(`               R1${' '.repeat(width - 8)}R${snapshots[snapshots.length - 1].round}`);
    return lines.join('\n');
  }

  _hhiChart(snapshots) {
    if (snapshots.length === 0) return '  (no data)';
    const points = snapshots.filter((_, i) => i % 2 === 0);
    const lines = ['  HHI over time:'];
    for (const s of points) {
      const bar = '#'.repeat(Math.min(50, Math.round(s.hhi / 200)));
      lines.push(`  R${String(s.round).padStart(3)}: ${bar} ${s.hhi}`);
    }
    return lines.join('\n');
  }

  _cacheChart(snapshots) {
    if (snapshots.length === 0) return '  (no data)';
    const points = snapshots.filter((_, i) => i % 2 === 0);
    const lines = ['  Cache hit rate over time:'];
    for (const s of points) {
      const pct = Math.round(s.cacheHitRate * 100);
      const bar = '#'.repeat(Math.min(50, pct));
      lines.push(`  R${String(s.round).padStart(3)}: ${bar} ${pct}%`);
    }
    return lines.join('\n');
  }

  _hhiInterpretation(hhi) {
    if (hhi < 1500) return 'Competitive market';
    if (hhi < 2500) return 'Moderately concentrated';
    return 'Highly concentrated';
  }

  _giniInterpretation(gini) {
    if (gini < 0.2) return 'Very equal';
    if (gini < 0.4) return 'Moderate inequality';
    if (gini < 0.6) return 'High inequality';
    return 'Extreme inequality';
  }

  _healthScore(final, converged, profitable, totalProviders, failures) {
    let score = 0;
    // Price convergence (20 pts)
    score += converged ? 20 : 10;
    // Provider sustainability (20 pts)
    score += Math.round((profitable / Math.max(1, totalProviders)) * 20);
    // Cache efficiency (20 pts)
    score += Math.round(final.cacheHitRate * 20);
    // Consumer satisfaction (20 pts)
    score += Math.round(final.avgSatisfaction * 20);
    // Low market failure (10 pts)
    score += failures === 0 ? 10 : Math.max(0, 10 - failures);
    // Low concentration (10 pts)
    score += final.hhi < 2500 ? 10 : final.hhi < 4000 ? 5 : 0;
    return Math.min(100, score);
  }

  _healthRating(score) {
    if (score >= 80) return 'HEALTHY — Market functioning well';
    if (score >= 60) return 'FAIR — Some issues but operational';
    if (score >= 40) return 'STRUGGLING — Significant market dysfunction';
    return 'FAILING — Market not viable';
  }

  save(content) {
    const logsDir = path.join(__dirname, '..', 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    const outPath = path.join(logsDir, 'market-dynamics-results.md');
    fs.writeFileSync(outPath, content, 'utf-8');
    return outPath;
  }
}

module.exports = Report;
