'use strict';

/**
 * Market dynamics engine — tracks macro metrics, detects phases,
 * manages new participant entry/exit.
 */
class Market {
  constructor(config) {
    this.config = config;
    this.round = 0;

    // Macro metrics per round
    this.history = [];

    // Cumulative trackers
    this.totalCacheSize = 0;
    this.totalTokensSaved = 0;
    this.totalTransactions = 0;

    // Phase tracking
    this.currentPhase = 'early_market';
    this.phaseHistory = [{ round: 0, phase: 'early_market' }];

    // Events log
    this.events = [];
  }

  /**
   * Record snapshot of the entire market state for this round.
   */
  recordRound(round, participants) {
    this.round = round;

    const agents = participants.filter(p => p.type === 'agent');
    const providers = participants.filter(p => p.type === 'provider');
    const attackers = participants.filter(p => p.type === 'attacker');
    const verifiers = participants.filter(p => p.type === 'verifier');

    const activeAgents = agents.filter(p => p.active);
    const activeProviders = providers.filter(p => p.active);
    const activeAttackers = attackers.filter(p => p.active);
    const activeVerifiers = verifiers.filter(p => p.active);

    // Calculate cache size (total inventory across all providers)
    let cacheSize = 0;
    const allUrls = new Set();
    for (const p of activeProviders) {
      if (p.inventory) {
        cacheSize += p.inventory.size;
        for (const url of p.inventory.keys()) allUrls.add(url);
      }
    }
    this.totalCacheSize = allUrls.size;

    // Cache hit rate — what % of URLs are available in marketplace
    const cacheHitRate = this.config.urls.length > 0
      ? allUrls.size / this.config.urls.length
      : 0;

    // Average content price
    let totalPrice = 0;
    let priceCount = 0;
    for (const p of activeProviders) {
      if (p.inventory) {
        for (const [, item] of p.inventory) {
          totalPrice += item.price;
          priceCount++;
        }
      }
    }
    const avgPrice = priceCount > 0 ? totalPrice / priceCount : 0;

    // Attack rate
    const totalAttacks = activeAttackers.reduce((s, a) => s + a.totalAttacks, 0);
    const attackRate = totalAttacks > 0 && this.totalTransactions > 0
      ? totalAttacks / (this.totalTransactions + totalAttacks)
      : 0;

    // Consumer surplus (agents' savings vs self-crawling)
    let consumerSurplus = 0;
    for (const a of activeAgents) {
      const saved = a.totalPurchases * this.config.crawlCostPerPage - a.totalExpense * 0.3;
      consumerSurplus += Math.max(0, saved);
    }

    // Provider profit margins — ratio of (income - expense) / expense
    // This gives "return on cost" which is more meaningful than "return on revenue"
    let providerMargins = 0;
    let marginCount = 0;
    for (const p of activeProviders) {
      if (p.totalExpense > 0) {
        const margin = (p.totalIncome - p.totalExpense) / p.totalExpense;
        providerMargins += margin;
        marginCount++;
      }
    }
    const avgProviderMargin = marginCount > 0 ? providerMargins / marginCount : 0;

    // Verification demand
    const verificationDemand = activeVerifiers.reduce((s, v) => s + v.totalVerifications, 0);

    // Agent satisfaction
    const avgSatisfaction = activeAgents.length > 0
      ? activeAgents.reduce((s, a) => s + a.getAvgSatisfaction(20), 0) / activeAgents.length
      : 0;

    // Defense spending (spot-check rate * agent count)
    const avgDefenseSpend = activeAgents.length > 0
      ? activeAgents.reduce((s, a) => s + a.spotCheckRate, 0) / activeAgents.length
      : 0;

    const snapshot = {
      round,
      activeAgents: activeAgents.length,
      activeProviders: activeProviders.length,
      activeAttackers: activeAttackers.length,
      activeVerifiers: activeVerifiers.length,
      cacheSize: allUrls.size,
      cacheHitRate: +cacheHitRate.toFixed(3),
      avgPrice: +avgPrice.toFixed(6),
      avgProviderMargin: +avgProviderMargin.toFixed(3),
      attackRate: +attackRate.toFixed(3),
      consumerSurplus: +consumerSurplus.toFixed(4),
      verificationDemand,
      avgSatisfaction: +avgSatisfaction.toFixed(3),
      avgDefenseSpend: +avgDefenseSpend.toFixed(3),
      totalTokensSaved: +this.totalTokensSaved.toFixed(4),
    };

    this.history.push(snapshot);

    // Detect phase
    this._detectPhase(snapshot);

    return snapshot;
  }

  _detectPhase(snapshot) {
    const prev = this.currentPhase;
    let newPhase = prev;

    if (snapshot.round < 30) {
      newPhase = 'early_market';
    } else if (snapshot.attackRate > 0.15) {
      newPhase = 'disruption';
    } else if (snapshot.activeProviders < 3) {
      newPhase = 'correction';
    } else if (snapshot.cacheHitRate > 0.5 && snapshot.avgProviderMargin > -0.3 && snapshot.attackRate < 0.05) {
      newPhase = 'maturity';
    } else if (snapshot.avgProviderMargin < -0.5) {
      newPhase = 'competition';
    } else if (snapshot.activeProviders >= 4) {
      // Check for stability — if we've been in maturity-like conditions for a while
      const recentHistory = this.history.slice(-20);
      const stablePrice = recentHistory.length >= 10 &&
        Math.abs(recentHistory[recentHistory.length - 1].avgPrice - recentHistory[0].avgPrice) < 0.0002;
      if (stablePrice && snapshot.cacheHitRate > 0.4) {
        newPhase = 'maturity';
      } else {
        newPhase = 'competition';
      }
    }

    if (newPhase !== prev) {
      this.currentPhase = newPhase;
      this.phaseHistory.push({ round: snapshot.round, phase: newPhase });
      this.events.push({
        round: snapshot.round,
        type: 'phase_change',
        detail: `${prev} -> ${newPhase}`,
      });
    }
  }

  /**
   * Check if new participants should enter the market.
   */
  getEntrySignals() {
    if (this.history.length < 5) return { newProviders: 0, newAttackers: 0, newVerifiers: 0 };

    const recent = this.history.slice(-5);
    const avgMargin = recent.reduce((s, h) => s + h.avgProviderMargin, 0) / recent.length;
    const avgAttackRate = recent.reduce((s, h) => s + h.attackRate, 0) / recent.length;
    const avgVerDemand = recent.reduce((s, h) => s + h.verificationDemand, 0) / recent.length;
    const activeProviders = recent[recent.length - 1].activeProviders;
    const activeAttackers = recent[recent.length - 1].activeAttackers;
    const activeVerifiers = recent[recent.length - 1].activeVerifiers;

    let newProviders = 0;
    let newAttackers = 0;
    let newVerifiers = 0;

    // KEY SIGNAL: If there are few/no providers but agents still need content,
    // that's the #1 entrepreneurial signal — unmet demand
    const avgAgents = recent.reduce((s, h) => s + h.activeAgents, 0) / recent.length;
    const avgCacheHit = recent.reduce((s, h) => s + h.cacheHitRate, 0) / recent.length;

    // Providers enter when:
    // 1. Margins are good and there's room, OR
    // 2. Supply is low but demand exists (entrepreneurial entry)
    if (avgMargin > this.config.profitGapThreshold && activeProviders < 12) {
      newProviders = 1;
      this.events.push({ round: this.round, type: 'new_entrant', detail: 'Provider sees profitable gap' });
    } else if (activeProviders < 3 && avgAgents >= 5) {
      // Few providers + many agents = huge opportunity
      newProviders = 2;
      this.events.push({ round: this.round, type: 'new_entrant', detail: 'Entrepreneurs enter underserved market' });
    } else if (avgCacheHit < 0.4 && activeProviders < 6 && avgAgents >= 3) {
      // Low cache coverage = content gaps = opportunity
      newProviders = 1;
      this.events.push({ round: this.round, type: 'new_entrant', detail: 'Provider fills content gap' });
    }

    // Attackers enter when defenses seem low and there's something to attack
    if (avgAttackRate < 0.02 && activeAttackers < 4 && activeProviders > 0) {
      newAttackers = Math.random() < 0.2 ? 1 : 0;
      if (newAttackers) {
        this.events.push({ round: this.round, type: 'new_entrant', detail: 'Attacker sees opportunity' });
      }
    }

    // Verifiers enter when attack rates are high (demand for verification)
    if (avgAttackRate > 0.05 && activeVerifiers < 6) {
      newVerifiers = 1;
      this.events.push({ round: this.round, type: 'new_entrant', detail: 'Verifier sees demand' });
    }

    return { newProviders, newAttackers, newVerifiers };
  }

  getState() {
    const latest = this.history.length > 0 ? this.history[this.history.length - 1] : {};
    return {
      round: this.round,
      phase: this.currentPhase,
      attackRate: latest.attackRate || 0,
      avgPrice: latest.avgPrice || 0,
      cacheHitRate: latest.cacheHitRate || 0,
      activeProviders: latest.activeProviders || 0,
      avgProviderMargin: latest.avgProviderMargin || 0,
      ...latest,
    };
  }

  getPhaseTimeline() {
    return this.phaseHistory;
  }

  getEvents() {
    return this.events;
  }

  printSnapshot(round) {
    const s = this.history.find(h => h.round === round) || this.history[this.history.length - 1];
    if (!s) return '';

    const lines = [
      ``,
      `╔══════════════════════════════════════════════════════════════╗`,
      `║  MARKET SNAPSHOT — Round ${String(s.round).padStart(3)} / ${this.config.rounds}${' '.repeat(26)}║`,
      `║  Phase: ${s.round < 30 ? 'EARLY MARKET' : this.currentPhase.toUpperCase().replace('_', ' ')}${' '.repeat(Math.max(0, 48 - (s.round < 30 ? 12 : this.currentPhase.length)))}║`,
      `╠══════════════════════════════════════════════════════════════╣`,
      `║  Agents: ${String(s.activeAgents).padStart(2)}    Providers: ${String(s.activeProviders).padStart(2)}    Attackers: ${String(s.activeAttackers).padStart(2)}    Verifiers: ${String(s.activeVerifiers).padStart(2)} ║`,
      `║  Cache size: ${String(s.cacheSize).padStart(3)} URLs    Hit rate: ${(s.cacheHitRate * 100).toFixed(1)}%${' '.repeat(22)}║`,
      `║  Avg price: $${s.avgPrice.toFixed(6)}    Provider margin: ${(s.avgProviderMargin * 100).toFixed(1)}%${' '.repeat(13)}║`,
      `║  Attack rate: ${(s.attackRate * 100).toFixed(1)}%    Defense spend: ${(s.avgDefenseSpend * 100).toFixed(1)}%${' '.repeat(18)}║`,
      `║  Consumer surplus: $${s.consumerSurplus.toFixed(4)}    Satisfaction: ${s.avgSatisfaction.toFixed(2)}${' '.repeat(11)}║`,
      `║  Tokens saved: $${s.totalTokensSaved.toFixed(4)}${' '.repeat(40)}║`,
      `╚══════════════════════════════════════════════════════════════╝`,
    ];
    return lines.join('\n');
  }
}

module.exports = Market;
