'use strict';

class Economics {
  constructor(config) {
    this.config = config;
    this.snapshots = []; // { round, metrics }
  }

  // Take a snapshot of the market state at a given round
  snapshot(round, agents, providers) {
    const agentStats = agents.map(a => a.getStats());
    const providerStats = providers.filter(p => p.active).map(p => p.getStats());
    const allProviderStats = providers.map(p => p.getStats());

    const metrics = {
      round,
      // Price metrics
      avgPrice: this._avgPrice(providerStats),
      minPrice: this._minPrice(providerStats),
      maxPrice: this._maxPrice(providerStats),
      priceStdDev: this._priceStdDev(providerStats),

      // Market concentration (HHI)
      hhi: this._hhi(allProviderStats),

      // Surplus
      consumerSurplus: this._consumerSurplus(agentStats),
      producerSurplus: this._producerSurplus(allProviderStats),
      deadWeightLoss: this._deadWeightLoss(agentStats, providerStats),

      // Cache efficiency
      cacheHitRate: this._cacheHitRate(agentStats),
      totalCacheHits: agentStats.reduce((s, a) => s + a.cacheHits, 0),
      totalCacheMisses: agentStats.reduce((s, a) => s + a.cacheMisses, 0),

      // Waste reduction
      wasteReduction: this._wasteReduction(agentStats),

      // Market structure
      activeProviders: providerStats.length,
      totalProviders: allProviderStats.length,
      exitedProviders: allProviderStats.filter(p => !p.active).length,

      // Agent satisfaction
      avgSatisfaction: agentStats.reduce((s, a) => s + a.satisfaction, 0) / Math.max(1, agentStats.length),
      satisfactionByTier: this._satisfactionByTier(agentStats),

      // Gini coefficient for provider income
      gini: this._gini(allProviderStats.map(p => Math.max(0, p.revenue))),

      // Total economic activity
      totalSpent: agentStats.reduce((s, a) => s + a.spent, 0),
      totalRevenue: allProviderStats.reduce((s, p) => s + p.revenue, 0),
      totalCosts: allProviderStats.reduce((s, p) => s + p.totalCosts, 0),
      totalFetches: agentStats.reduce((s, a) => s + a.fetchCount, 0),
      totalRefused: agentStats.reduce((s, a) => s + a.refusedOverpriced, 0),
    };

    this.snapshots.push(metrics);
    return metrics;
  }

  _avgPrice(providerStats) {
    if (providerStats.length === 0) return 0;
    return providerStats.reduce((s, p) => s + p.currentPrice, 0) / providerStats.length;
  }

  _minPrice(providerStats) {
    if (providerStats.length === 0) return 0;
    return Math.min(...providerStats.map(p => p.currentPrice));
  }

  _maxPrice(providerStats) {
    if (providerStats.length === 0) return 0;
    return Math.max(...providerStats.map(p => p.currentPrice));
  }

  _priceStdDev(providerStats) {
    if (providerStats.length < 2) return 0;
    const avg = this._avgPrice(providerStats);
    const variance = providerStats.reduce((s, p) => s + Math.pow(p.currentPrice - avg, 2), 0) / providerStats.length;
    return Math.sqrt(variance);
  }

  // Herfindahl-Hirschman Index: sum of squared market shares
  // 0 = perfect competition, 10000 = monopoly
  _hhi(providerStats) {
    const totalRevenue = providerStats.reduce((s, p) => s + Math.max(0, p.revenue), 0);
    if (totalRevenue === 0) return 0;

    let hhi = 0;
    for (const p of providerStats) {
      const share = (Math.max(0, p.revenue) / totalRevenue) * 100;
      hhi += share * share;
    }
    return Math.round(hhi);
  }

  // Consumer surplus: sum of (willingness to pay - actual price paid) for each purchase
  _consumerSurplus(agentStats) {
    let surplus = 0;
    for (const a of agentStats) {
      // Each fetch: surplus = ceiling - avgPricePaid
      if (a.fetchCount > 0) {
        const avgPaid = a.spent / a.fetchCount;
        surplus += a.fetchCount * Math.max(0, a.priceCeiling - avgPaid);
      }
    }
    return surplus;
  }

  // Producer surplus: revenue - variable costs
  _producerSurplus(providerStats) {
    let surplus = 0;
    for (const p of providerStats) {
      surplus += Math.max(0, p.revenue - p.totalCosts);
    }
    return surplus;
  }

  // Dead weight loss: estimated transactions that didn't happen because price > willingness
  _deadWeightLoss(agentStats, providerStats) {
    // Use refusedOverpriced as proxy for dead weight loss
    const totalRefused = agentStats.reduce((s, a) => s + a.refusedOverpriced, 0);
    // Each refused transaction represents lost value
    const avgPrice = this._avgPrice(providerStats);
    return totalRefused * avgPrice * 0.5; // Triangle approximation
  }

  _cacheHitRate(agentStats) {
    const total = agentStats.reduce((s, a) => s + a.cacheHits + a.cacheMisses, 0);
    if (total === 0) return 0;
    return agentStats.reduce((s, a) => s + a.cacheHits, 0) / total;
  }

  // Waste reduction: proportion of needs met from cache vs fresh crawl
  _wasteReduction(agentStats) {
    const totalHits = agentStats.reduce((s, a) => s + a.cacheHits, 0);
    const totalMisses = agentStats.reduce((s, a) => s + a.cacheMisses, 0);
    const total = totalHits + totalMisses;
    if (total === 0) return 0;
    return totalHits / total;
  }

  _satisfactionByTier(agentStats) {
    const tiers = {};
    for (const a of agentStats) {
      if (!tiers[a.tier]) tiers[a.tier] = [];
      tiers[a.tier].push(a.satisfaction);
    }
    const result = {};
    for (const [tier, sats] of Object.entries(tiers)) {
      result[tier] = sats.reduce((s, v) => s + v, 0) / sats.length;
    }
    return result;
  }

  // Gini coefficient: 0 = perfect equality, 1 = perfect inequality
  _gini(values) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    const total = sorted.reduce((s, v) => s + v, 0);
    if (total === 0) return 0;

    let numerator = 0;
    for (let i = 0; i < n; i++) {
      numerator += (2 * (i + 1) - n - 1) * sorted[i];
    }
    return numerator / (n * total);
  }

  // Check whether prices have converged (low std dev relative to mean)
  hasConverged() {
    if (this.snapshots.length < 5) return false;
    const recent = this.snapshots.slice(-5);
    const avgStdDev = recent.reduce((s, m) => s + m.priceStdDev, 0) / recent.length;
    const avgPrice = recent.reduce((s, m) => s + m.avgPrice, 0) / recent.length;
    if (avgPrice === 0) return false;
    // Converged if coefficient of variation < 30%
    return (avgStdDev / avgPrice) < 0.30;
  }

  // Detect market failures: categories where cache miss rate is very high
  detectMarketFailures(agents) {
    // Track which URLs consistently have cache misses
    const missByUrl = {};
    for (const agent of agents) {
      for (const entry of agent.log) {
        if (entry.action === 'cache_miss' && entry.url) {
          missByUrl[entry.url] = (missByUrl[entry.url] || 0) + 1;
        }
      }
    }
    // URLs with 3+ misses are market failures
    return Object.entries(missByUrl)
      .filter(([, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1])
      .map(([url, count]) => ({ url, misses: count }));
  }

  getFullReport() {
    return {
      snapshots: this.snapshots,
      converged: this.hasConverged(),
      finalMetrics: this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1] : null,
    };
  }
}

module.exports = Economics;
