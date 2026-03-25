'use strict';

const crypto = require('crypto');

/**
 * Cartel coordinator: coordinates price-fixing among colluding providers.
 * All members maintain the cartel price; monitors for defectors.
 */
class CartelCoordinator {
  constructor(config = {}) {
    this.targetPrice = config.targetPrice || 0.0009; // 90% of ceiling
    this.members = []; // { nodeId, apiKey, name, defected }
    this.defectors = [];
    this.totalRevenue = 0;
    this.totalPublished = 0;
    this.salesCount = 0;
    this.crawlCost = config.crawlCost || 0.001;
    this.registrationDeposit = config.registrationDeposit || 0.01;
    this.urls = config.urls || [];
  }

  /**
   * Register N cartel members as providers.
   */
  async initialize(baseUrl, count) {
    for (let i = 0; i < count; i++) {
      const name = `cartel-member-${i}`;
      try {
        const resp = await fetch(`${baseUrl}/nodes/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            endpoint: `https://${name}.cartel.sim`,
            coverage: 'general',
            deposit: this.registrationDeposit,
          }),
        });
        const data = await resp.json();
        if (data.success && data.data) {
          this.members.push({
            nodeId: data.data.id,
            apiKey: data.data.api_key,
            name,
            defected: false,
          });
        }
      } catch (e) { /* failed */ }
    }
    return this.members.length;
  }

  /**
   * Publish content at the cartel price for all members.
   */
  async publishRound(baseUrl, round, rng) {
    let published = 0;
    for (const member of this.members) {
      if (member.defected) continue;

      // Each member publishes 1-2 items per round at cartel price
      const numItems = 1 + Math.floor(rng() * 2);
      for (let i = 0; i < numItems; i++) {
        const url = this.urls[Math.floor(rng() * this.urls.length)] || `https://cartel-content.sim/page-${round}-${i}`;
        try {
          const resp = await fetch(`${baseUrl}/publish/content`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url,
              source_hash: crypto.createHash('md5').update(url + round).digest('hex'),
              content_text: `Legitimate content for ${url} from cartel provider ${member.name}`,
              provider_id: member.nodeId,
              price: this.targetPrice,
              token_cost_saved: this.crawlCost,
            }),
          });
          const data = await resp.json();
          if (data.success) {
            published++;
            this.totalPublished++;
          }
        } catch (e) { /* failed */ }
      }
    }
    return published;
  }

  /**
   * Check if any member has undercut the cartel price.
   */
  checkForDefectors(baseUrl) {
    // In a real system, we'd check each member's published prices
    // For simulation, defection is tracked externally
    return this.defectors;
  }

  /**
   * Record a sale attributed to cartel.
   */
  recordSale(price) {
    this.salesCount++;
    this.totalRevenue += price;
  }

  /**
   * Get cartel market share: what fraction of content at cartel-URLs is from cartel members.
   */
  async getMarketShare(baseUrl) {
    // Check a sample of URLs for provider distribution
    const cartelNodeIds = new Set(this.members.filter(m => !m.defected).map(m => m.nodeId));
    let cartelCount = 0;
    let totalCount = 0;

    const sampleUrls = this.urls.slice(0, Math.min(10, this.urls.length));
    for (const url of sampleUrls) {
      try {
        const resp = await fetch(`${baseUrl}/fetch/providers?url=${encodeURIComponent(url)}`);
        const data = await resp.json();
        if (data.success && data.data) {
          for (const entry of data.data) {
            totalCount++;
            if (cartelNodeIds.has(entry.provider_id)) {
              cartelCount++;
            }
          }
        }
      } catch (e) { /* skip */ }
    }

    return totalCount > 0 ? cartelCount / totalCount : 0;
  }

  getReport() {
    return {
      memberCount: this.members.length,
      activeMembers: this.members.filter(m => !m.defected).length,
      defectors: this.defectors.length,
      targetPrice: this.targetPrice,
      totalRevenue: +this.totalRevenue.toFixed(6),
      totalPublished: this.totalPublished,
      salesCount: this.salesCount,
    };
  }
}

module.exports = CartelCoordinator;
