'use strict';

class Dashboard {
  constructor(config) {
    this.config = config;
    this.width = 72;
  }

  render(round, agents, providers, verifiers, malicious, marketStats) {
    const lines = [];
    const w = this.width;
    const hr = '\u2550'.repeat(w);
    const pad = (s, len) => {
      s = String(s);
      return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length);
    };
    const rpad = (s, len) => {
      s = String(s);
      return s.length >= len ? s.slice(0, len) : ' '.repeat(len - s.length) + s;
    };
    const line = (text) => {
      lines.push('\u2551 ' + pad(text, w - 2) + '\u2551');
    };
    const blank = () => line('');

    lines.push('\u2554' + hr + '\u2557');
    line(`AGENT MARKETPLACE SIM (ITERATION 1: DEFENSES) \u2014 Round ${round}/${this.config.rounds}`);
    lines.push('\u2560' + hr + '\u2563');

    // Marketplace overview
    line('MARKETPLACE');
    line(`  Content records: ${rpad(String(marketStats.contentCount), 5)}  |  Artifacts: ${rpad(String(marketStats.artifactCount), 4)}`);
    line(`  Total transactions: ${rpad(String(marketStats.totalFetches), 4)}  |  Revenue: $${marketStats.totalRevenue.toFixed(4)}`);
    blank();

    // Agents
    const avgSat = agents.length > 0
      ? agents.reduce((s, a) => s + a.getStats().satisfaction, 0) / agents.length
      : 0;
    const totalQualFail = agents.reduce((s, a) => s + a.getStats().qualityFailures, 0);
    const satFace = avgSat > 0.7 ? ':)' : avgSat > 0.4 ? ':|' : ':(';
    line(`AGENTS (${agents.length})                     Avg satisfaction: ${(avgSat * 100).toFixed(0)}% ${satFace}`);
    for (const a of agents.slice(0, 5)) {
      const s = a.getStats();
      const face = s.satisfaction > 0.7 ? ':)' : s.satisfaction > 0.4 ? ':|' : ':(';
      const badProv = s.badProviders.length > 0 ? ` [${s.badProviders.length} blacklisted]` : '';
      line(`  ${pad(s.name, 10)}: $${s.spent.toFixed(4)} | ${rpad(String(s.fetchCount), 3)} ok | ${rpad(String(s.qualityFailures), 2)} bad  ${face}${badProv}`);
    }
    if (agents.length > 5) {
      line(`  ... and ${agents.length - 5} more agents`);
    }
    line(`  Quality failures across all agents: ${totalQualFail}`);
    blank();

    // Providers with P&L
    line(`PROVIDERS (${providers.length})`);
    for (const p of providers) {
      const s = p.getStats();
      const status = s.active ? '' : ' [EXITED]';
      const plSign = s.profitLoss >= 0 ? '+' : '';
      line(`  ${pad(s.name, 12)} (${pad(s.specialty, 6)}): ${rpad(String(s.published), 3)} items | P&L: ${plSign}$${s.profitLoss.toFixed(4)}${status}`);
    }
    blank();

    // Verifiers
    line(`VERIFIERS (${verifiers.length})`);
    for (const v of verifiers) {
      const s = v.getStats();
      line(`  ${pad(s.name, 12)}: ${rpad(String(s.verifications), 3)} jobs | earned $${s.earned.toFixed(4)}`);
    }
    blank();

    // Red Team — show all attackers
    line(`RED TEAM (${malicious.length} attackers)`);
    for (const m of malicious) {
      const s = m.getStats();
      const rate = s.attacksAttempted > 0 ? ((s.attacksSucceeded / s.attacksAttempted) * 100).toFixed(0) : '0';
      line(`  ${pad(s.name, 14)} [${pad(s.personality, 7)}]: ${rpad(rate, 3)}% success (${s.attacksSucceeded}/${s.attacksAttempted})`);
      if (s.sybilIdentities > 0) {
        line(`    Sybil identities: ${s.sybilIdentities}`);
      }
      if (s.poisonedUrls.length > 0) {
        line(`    !! Cache poisoning: ${s.poisonedUrls.length} URLs compromised`);
      }
    }
    blank();

    // Economics
    line('ECONOMICS');
    line(`  Avg content price: $${marketStats.avgPrice.toFixed(6)}  |  Ceiling: $${this.config.tokenCostCeiling}`);
    const totalNeeds = agents.reduce((s, a) => {
      const st = a.getStats();
      return s + st.cacheHits + st.cacheMisses;
    }, 0);
    const hitRate = totalNeeds > 0
      ? agents.reduce((s, a) => s + a.getStats().cacheHits, 0) / totalNeeds
      : 0;
    const activeProviders = providers.filter(p => p.getStats().active).length;
    line(`  Cache hit rate: ${(hitRate * 100).toFixed(0)}%  |  Active providers: ${activeProviders}/${providers.length}`);

    lines.push('\u255a' + hr + '\u255d');

    // Clear screen and print
    process.stdout.write('\x1B[2J\x1B[H');
    process.stdout.write(lines.join('\n') + '\n');
  }
}

module.exports = Dashboard;
