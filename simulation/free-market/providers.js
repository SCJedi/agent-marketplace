'use strict';

const Participant = require('./participant');
const crypto = require('crypto');

/**
 * Content provider — crawls pages, stores content, sells to agents.
 * Has real costs, adaptive pricing, market-responsive behavior.
 */
class Provider extends Participant {
  constructor(id, config, rng, entryRound = 0) {
    const capital = config.providerCapitalMin + rng() * (config.providerCapitalMax - config.providerCapitalMin);
    super(id, 'provider', capital);
    this.enteredRound = entryRound;
    this.config = config;
    this.nodeId = null;   // set after registering with server
    this.apiKey = null;

    // Costs
    this.serverCost = config.serverCostPerRound * (0.8 + rng() * 0.4);
    this.crawlCost = config.crawlCostPerPage;
    this.storageCost = config.storageCostPerItem;

    // Specialty — pick 1-2 categories to focus on
    const cats = [...config.categories];
    this.specialties = [];
    const numSpec = 1 + Math.floor(rng() * 2);
    for (let i = 0; i < numSpec && cats.length > 0; i++) {
      const idx = Math.floor(rng() * cats.length);
      this.specialties.push(cats.splice(idx, 1)[0]);
    }

    // Content inventory
    this.inventory = new Map(); // url -> { content, lastCrawl, price }
    this.itemsPublished = 0;
    this.itemsSold = 0;

    // Pricing strategy — start near crawl cost so we're profitable immediately
    this.priceMultiplier = 0.6 + rng() * 0.35; // start at 60-95% of crawl cost
    this.minPrice = config.crawlCostPerPage * 0.3; // floor at 30% of crawl cost — must cover storage+server

    // Refresh strategy
    this.refreshInterval = 30 + Math.floor(rng() * 50); // re-crawl every 30-80 rounds
    this.maxInventorySize = 12 + Math.floor(rng() * 18); // 12-30 items

    // Track sales per URL for demand-based pricing
    this.salesPerUrl = {};
    this.roundsSinceProfit = 0;
    this.profitableRounds = 0;
    this.unprofitableRounds = 0;

    // Quality — honest providers produce real content
    this.quality = 0.8 + rng() * 0.2; // 0.8–1.0
  }

  async register(baseUrl) {
    try {
      const resp = await fetch(`${baseUrl}/nodes/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `provider-${this.id}`,
          endpoint: `http://provider-${this.id}.sim`,
          coverage: this.specialties.join(','),
          deposit: this.config.registrationDeposit,
        }),
      });
      const data = await resp.json();
      if (data.success && data.data) {
        this.nodeId = data.data.id;
        this.apiKey = data.data.api_key;
        this.recordExpense(this.enteredRound, this.config.registrationDeposit, 'registration_deposit');
      }
    } catch (e) {
      // registration failed — will retry
    }
  }

  /**
   * Each round:
   * 1. Pay server costs
   * 2. Pay storage costs
   * 3. Crawl new content or refresh stale content
   * 4. Publish to marketplace
   * 5. Earn from sales (tracked by market engine)
   */
  async act(round, baseUrl, marketState, rng) {
    if (!this.active || !this.nodeId) return;

    // Fixed server cost
    this.recordExpense(round, this.serverCost, 'server_cost');

    // Storage cost for inventory
    const storageBill = this.inventory.size * this.storageCost;
    if (storageBill > 0) {
      this.recordExpense(round, storageBill, `storage:${this.inventory.size}items`);
    }

    // Decide what to crawl
    const urlsToCrawl = this._selectCrawlTargets(round, marketState, rng);
    for (const url of urlsToCrawl) {
      this.recordExpense(round, this.crawlCost, `crawl:${url.slice(0, 30)}`);

      // Generate content
      const content = this._generateContent(url, rng);
      this.inventory.set(url, {
        content,
        lastCrawl: round,
        price: this._calculatePrice(url),
      });
    }

    // Publish only newly crawled content (not entire inventory every round)
    for (const url of urlsToCrawl) {
      const item = this.inventory.get(url);
      if (!item) continue;
      try {
        await fetch(`${baseUrl}/publish/content`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url,
            source_hash: crypto.createHash('md5').update(url).digest('hex'),
            content_text: item.content,
            provider_id: this.nodeId,
            price: item.price,
            token_cost_saved: this.config.crawlCostPerPage,
          }),
        });
        this.itemsPublished++;
      } catch (e) {
        // publish failed — ok
      }
    }
  }

  _selectCrawlTargets(round, marketState, rng) {
    const targets = [];
    const catSize = 10;
    const catMap = {};
    this.config.categories.forEach((cat, i) => {
      catMap[cat] = this.config.urls.slice(i * catSize, (i + 1) * catSize);
    });

    // Focus on specialty URLs
    const specialtyUrls = [];
    for (const spec of this.specialties) {
      if (catMap[spec]) specialtyUrls.push(...catMap[spec]);
    }

    // Initial stocking — crawl a batch
    if (this.inventory.size < 3) {
      const numInitial = 3 + Math.floor(rng() * 3);
      const available = specialtyUrls.filter(u => !this.inventory.has(u));
      for (let i = 0; i < numInitial && available.length > 0; i++) {
        const idx = Math.floor(rng() * available.length);
        targets.push(available.splice(idx, 1)[0]);
      }
      return targets;
    }

    // Refresh stale content
    for (const [url, item] of this.inventory) {
      if (round - item.lastCrawl >= this.refreshInterval) {
        targets.push(url);
        if (targets.length >= 2) break; // max 2 refreshes per round
      }
    }

    // Maybe crawl new content if we have capacity and it's profitable
    if (this.inventory.size < this.maxInventorySize && rng() < 0.25) {
      const available = specialtyUrls.filter(u => !this.inventory.has(u));
      if (available.length > 0) {
        targets.push(available[Math.floor(rng() * available.length)]);
      }
    }

    return targets;
  }

  _generateContent(url, rng) {
    // Honest providers generate legitimate content
    const words = [];
    const wordList = ['The', 'documentation', 'covers', 'essential', 'concepts',
      'including', 'setup', 'configuration', 'deployment', 'testing',
      'API', 'reference', 'guide', 'tutorial', 'overview', 'introduction',
      'advanced', 'features', 'security', 'performance', 'optimization'];
    const len = 50 + Math.floor(rng() * 100);
    for (let i = 0; i < len; i++) {
      words.push(wordList[Math.floor(rng() * wordList.length)]);
    }
    return `Content for ${url}: ${words.join(' ')}`;
  }

  _calculatePrice(url) {
    const baseCost = this.crawlCost;
    const demand = this.salesPerUrl[url] || 0;
    // Price = base * multiplier, with demand premium
    let price = baseCost * this.priceMultiplier;
    if (demand > 3) price *= 1.15;
    if (demand > 8) price *= 1.25;
    if (demand > 15) price *= 1.3;
    // Never exceed ceiling
    price = Math.min(price, this.config.tokenCostCeiling);
    // Floor: must at least cover amortized costs
    // A provider with N items and server cost S needs at least S/N + storage per item per sale
    const minCostPerSale = this.inventory.size > 0
      ? (this.serverCost / Math.max(1, this.inventory.size) / 3) + this.storageCost
      : this.minPrice;
    price = Math.max(price, Math.max(this.minPrice, minCostPerSale));
    return +price.toFixed(6);
  }

  recordSale(round, url, price) {
    this.recordIncome(round, price, `sale:${url.slice(0, 30)}`);
    this.itemsSold++;
    this.salesPerUrl[url] = (this.salesPerUrl[url] || 0) + 1;
  }

  adapt(round, marketState) {
    super.adapt(round, marketState);

    const recentPnL = this.getRecentPnL(10);

    if (recentPnL > 0) {
      this.profitableRounds++;
      this.roundsSinceProfit = 0;
      // Profitable — maintain or slightly raise prices
      if (recentPnL > this.serverCost * 5) {
        this.priceMultiplier = Math.min(0.9, this.priceMultiplier + 0.02);
      }
    } else {
      this.unprofitableRounds++;
      this.roundsSinceProfit++;

      // Losing money — adapt
      if (this.roundsSinceProfit >= 20) {
        // Losing for a long time — exit if balance is low or margins are terrible
        const margin = this.totalExpense > 0 ? (this.totalIncome - this.totalExpense) / this.totalExpense : -1;
        if (this.balance < this.startingBalance * 0.2 || margin < -0.5) {
          this.active = false;
          this.exitedRound = round;
          this.exitReason = 'unprofitable_exit';
          return;
        }
      }

      // Try cutting costs first — reduce inventory
      if (this.inventory.size > 5 && this.roundsSinceProfit >= 10) {
        // Drop least-sold items
        let leastSold = null;
        let minSales = Infinity;
        for (const [url] of this.inventory) {
          const sales = this.salesPerUrl[url] || 0;
          if (sales < minSales) {
            minSales = sales;
            leastSold = url;
          }
        }
        if (leastSold) this.inventory.delete(leastSold);
      }

      // Lower prices to compete — but not below cost floor
      // Calculate minimum viable multiplier based on costs
      const minViable = (this.serverCost + this.inventory.size * this.storageCost) /
        (Math.max(1, this.itemsSold / Math.max(1, round - this.enteredRound)) * this.crawlCost * 10 + 0.001);
      this.priceMultiplier = Math.max(Math.max(0.3, minViable), this.priceMultiplier - 0.02);
    }

    // Update all inventory prices
    for (const [url, item] of this.inventory) {
      item.price = this._calculatePrice(url);
    }
  }

  getSummary() {
    return {
      ...super.getSummary(),
      specialties: this.specialties,
      inventorySize: this.inventory.size,
      itemsPublished: this.itemsPublished,
      itemsSold: this.itemsSold,
      priceMultiplier: +this.priceMultiplier.toFixed(3),
      profitableRounds: this.profitableRounds,
      unprofitableRounds: this.unprofitableRounds,
    };
  }
}

module.exports = Provider;
