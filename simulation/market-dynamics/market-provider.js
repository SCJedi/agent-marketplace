'use strict';

const crypto = require('crypto');

class MarketProvider {
  constructor(profile, baseUrl, config) {
    this.name = profile.name;
    this.baseUrl = baseUrl;
    this.config = config;

    // Cost structure
    this.fixedCostPerRound = profile.fixedCost;
    this.variableCostPerCrawl = profile.varCost;
    this.storageCostPerItem = 0.000005;
    this.strategy = profile.strategy;
    this.specialty = profile.specialty;

    // Financials
    this.revenue = 0;
    this.totalCosts = 0;
    this.balance = 0.005; // Starting capital
    this.balanceHistory = []; // { round, balance }
    this.revenueHistory = []; // { round, revenue }
    this.priceHistory = []; // { round, avgPrice }
    this.roundsNegative = 0;
    this.active = true;
    this.exitedAtRound = null;
    this.enteredAtRound = 1;

    // Content tracking
    this.published = 0;
    this.publishedUrls = new Set();
    this.fetchedByOthers = 0;
    this.lastDemandSignal = 0;

    // Pricing
    this.currentPrice = this._initialPrice();
    this.competitorPrices = {}; // url -> lowestCompetitorPrice

    // Registration
    this.nodeId = null;
    this.apiKey = null;

    this.log = [];
  }

  _initialPrice() {
    const base = {
      cheap: 0.00008,
      standard: 0.00025,
      premium: 0.00055,
    };
    // Cost-plus pricing: cost * 1.5
    const costPlus = this.variableCostPerCrawl * 1.5;
    return Math.max(costPlus, base[this.strategy] || 0.00025);
  }

  async register() {
    try {
      const res = await this._post('/nodes/register', {
        name: this.name,
        endpoint: `http://localhost:${this.config.nodePort}/sim/${this.name}`,
        coverage: this.specialty,
        pricing_model: this.strategy,
        avg_price: this.currentPrice,
      });
      if (res.success && res.data) {
        this.nodeId = res.data.id;
        this.apiKey = res.data.api_key;
      }
    } catch (err) {
      // ignore
    }
  }

  async act(round) {
    if (!this.active) return;

    // Deduct fixed costs
    const storageCost = this.publishedUrls.size * this.storageCostPerItem;
    const roundCost = this.fixedCostPerRound + storageCost;
    this.totalCosts += roundCost;
    this.balance -= roundCost;

    // Track balance
    if (round % 5 === 0) {
      this.balanceHistory.push({ round, balance: this.balance });
      this.priceHistory.push({ round, price: this.currentPrice });
    }

    // Check for market exit — 10 consecutive rounds negative
    if (this.balance < 0) {
      this.roundsNegative++;
    } else {
      this.roundsNegative = 0;
    }

    if (this.roundsNegative >= 10 && round > 15) {
      this.active = false;
      this.exitedAtRound = round;
      this.log.push({ round, action: 'exit_market', reason: 'negative_balance_10_rounds', balance: this.balance });
      return;
    }

    // Dynamic pricing adjustment every 3 rounds
    if (round % 3 === 0) {
      await this._adjustPricing(round);
    }

    // Respond to demand — check gaps and trending
    if (round % 7 === 0) {
      await this._respondToDemand(round);
    }

    // Main actions: publish, update, or refresh
    const action = Math.random();
    if (action < 0.50) {
      await this._crawlAndPublish(round);
    } else if (action < 0.75) {
      await this._updateContent(round);
    } else if (action < 0.90) {
      await this._refreshHighDemand(round);
    } else {
      // idle
    }
  }

  async _adjustPricing(round) {
    // Observe competitor prices for URLs we publish
    const sample = Array.from(this.publishedUrls).slice(0, 3);
    let competitorPriceSum = 0;
    let competitorCount = 0;

    for (const url of sample) {
      try {
        const res = await this._get(`/search?q=${encodeURIComponent(url)}&type=content&sort=price`);
        if (res.success && res.data.results) {
          const others = res.data.results.filter(r => r.url === url && r.provider_id !== this.nodeId);
          for (const other of others) {
            if (other.price > 0) {
              competitorPriceSum += other.price;
              competitorCount++;
              this.competitorPrices[url] = Math.min(
                this.competitorPrices[url] || Infinity,
                other.price
              );
            }
          }
        }
      } catch (e) { /* ignore */ }
    }

    const avgCompetitorPrice = competitorCount > 0 ? competitorPriceSum / competitorCount : null;
    const costFloor = this.variableCostPerCrawl * 1.2; // Never price below 120% of cost

    if (avgCompetitorPrice !== null) {
      if (this.strategy === 'cheap') {
        // Undercut competitors but stay above cost
        this.currentPrice = Math.max(costFloor, avgCompetitorPrice * 0.85);
      } else if (this.strategy === 'premium') {
        // Price above average if sole provider of specialty content, else match
        if (competitorCount < 2) {
          this.currentPrice = Math.min(this.config.tokenCostCeiling * 0.9, avgCompetitorPrice * 1.3);
        } else {
          this.currentPrice = Math.max(costFloor, avgCompetitorPrice * 1.05);
        }
      } else {
        // Standard — track market price
        this.currentPrice = Math.max(costFloor, avgCompetitorPrice * 0.95);
      }
    }

    // Demand-based adjustment
    if (this.lastDemandSignal > 5) {
      // High demand — can raise prices
      this.currentPrice = Math.min(this.config.tokenCostCeiling * 0.9, this.currentPrice * 1.08);
    } else if (this.lastDemandSignal === 0) {
      // No demand — cut prices
      this.currentPrice = Math.max(costFloor, this.currentPrice * 0.90);
    }

    this.lastDemandSignal = 0;

    this.log.push({ round, action: 'price_adjust', price: this.currentPrice, competitors: competitorCount });
  }

  async _respondToDemand(round) {
    try {
      // Check for market gaps
      const gapsRes = await this._get(`/gaps?category=${this.specialty}`);
      if (gapsRes.success && gapsRes.data && Array.isArray(gapsRes.data)) {
        // Publish content for gap categories
        for (const gap of gapsRes.data.slice(0, 2)) {
          if (gap.url && !this.publishedUrls.has(gap.url)) {
            await this._publishUrl(gap.url, round, 'gap_fill');
          }
        }
      }
    } catch (e) { /* ignore */ }

    try {
      // Check trending
      const trendRes = await this._get('/trending?period=30d');
      if (trendRes.success && trendRes.data && trendRes.data.topContent) {
        // If trending content is in our specialty, ensure we have it
        for (const item of (trendRes.data.topContent || []).slice(0, 2)) {
          if (item.url && !this.publishedUrls.has(item.url)) {
            await this._publishUrl(item.url, round, 'trending_response');
          }
        }
      }
    } catch (e) { /* ignore */ }
  }

  async _crawlAndPublish(round) {
    const url = this._pickSpecialtyUrl();
    await this._publishUrl(url, round, 'crawl');
  }

  async _publishUrl(url, round, reason) {
    // Deduct crawl cost
    this.totalCosts += this.variableCostPerCrawl;
    this.balance -= this.variableCostPerCrawl;

    const hash = crypto.createHash('sha256').update(url + round + this.name).digest('hex');
    const quality = this._contentQuality();

    try {
      // Check competitor pricing
      let publishPrice = this.currentPrice;
      const checkRes = await this._get(`/check?url=${encodeURIComponent(url)}`);
      if (checkRes.success && checkRes.data && checkRes.data.available) {
        const existingPrice = checkRes.data.price;
        if (existingPrice > 0) {
          // Sole provider premium or undercut
          if (this.strategy === 'premium') {
            publishPrice = Math.min(this.config.tokenCostCeiling, existingPrice * 1.1);
          } else {
            const costFloor = this.variableCostPerCrawl * 1.2;
            publishPrice = Math.max(costFloor, existingPrice * 0.9);
          }
        }
      }

      const res = await this._post('/publish/content', {
        url,
        source_hash: hash,
        content_text: `${quality.prefix} content for ${url}. Provider: ${this.name}. Specialty: ${this.specialty}. Round: ${round}. ${quality.detail}`,
        content_structured: { quality: quality.score, specialty: this.specialty, provider: this.name },
        content_metadata: JSON.stringify({
          provider: this.name,
          specialty: this.specialty,
          quality: quality.score,
          crawled_at: new Date().toISOString(),
        }),
        provider_id: this.nodeId || this.name,
        price: publishPrice,
        token_cost_saved: 0.0005,
      });

      if (res.success) {
        this.published++;
        this.publishedUrls.add(url);
        this.log.push({ round, action: 'publish', url, price: publishPrice, reason });
      }
    } catch (err) {
      // ignore
    }
  }

  async _updateContent(round) {
    if (this.publishedUrls.size === 0) return;

    // Deduct update cost (cheaper than fresh crawl)
    const updateCost = this.variableCostPerCrawl * 0.5;
    this.totalCosts += updateCost;
    this.balance -= updateCost;

    const urls = Array.from(this.publishedUrls);
    const url = urls[Math.floor(Math.random() * urls.length)];
    const hash = crypto.createHash('sha256').update(url + round + 'update' + this.name).digest('hex');

    try {
      const res = await this._post('/publish/content', {
        url,
        source_hash: hash,
        content_text: `Updated content for ${url}. Provider: ${this.name}. Freshness round ${round}.`,
        content_structured: { quality: this._contentQuality().score, specialty: this.specialty, freshness: 'updated' },
        content_metadata: JSON.stringify({ provider: this.name, updated: true, round }),
        provider_id: this.nodeId || this.name,
        price: this.currentPrice,
        token_cost_saved: 0.0003,
      });

      if (res.success) {
        this.published++;
        this.log.push({ round, action: 'update', url, price: this.currentPrice });
      }
    } catch (err) {
      // ignore
    }
  }

  async _refreshHighDemand(round) {
    // Re-crawl content that's been fetched frequently
    if (this.publishedUrls.size === 0) return;
    // Just pick a random published URL as proxy for "high demand"
    const urls = Array.from(this.publishedUrls);
    const url = urls[Math.floor(Math.random() * urls.length)];
    await this._publishUrl(url, round, 'refresh');
  }

  recordSale(price) {
    this.revenue += price;
    this.balance += price;
    this.fetchedByOthers++;
    this.lastDemandSignal++;
  }

  _pickSpecialtyUrl() {
    const urls = this.config.urls;
    const ranges = this.config.categoryRanges;
    const range = ranges[this.specialty] || ranges.tech;
    // 70% specialty, 30% random
    if (Math.random() < 0.7 && range) {
      const idx = range[0] + Math.floor(Math.random() * (range[1] - range[0]));
      return urls[Math.min(idx, urls.length - 1)];
    }
    return urls[Math.floor(Math.random() * urls.length)];
  }

  _contentQuality() {
    if (this.strategy === 'premium') {
      return { score: 0.9, prefix: 'High-quality detailed', detail: 'Comprehensive analysis with citations and structured data.' };
    } else if (this.strategy === 'standard') {
      return { score: 0.7, prefix: 'Standard', detail: 'Good coverage of the topic with useful summary.' };
    }
    return { score: 0.5, prefix: 'Basic', detail: 'Brief summary of key points.' };
  }

  async _get(path) {
    const res = await fetch(`${this.baseUrl}${path}`);
    return res.json();
  }

  async _post(path, body) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  getStats() {
    return {
      name: this.name,
      specialty: this.specialty,
      strategy: this.strategy,
      revenue: this.revenue,
      totalCosts: this.totalCosts,
      balance: this.balance,
      profitLoss: this.revenue - this.totalCosts,
      published: this.published,
      uniqueUrls: this.publishedUrls.size,
      fetchedByOthers: this.fetchedByOthers,
      active: this.active,
      exitedAtRound: this.exitedAtRound,
      enteredAtRound: this.enteredAtRound,
      currentPrice: this.currentPrice,
      balanceHistory: this.balanceHistory,
      revenueHistory: this.revenueHistory,
      priceHistory: this.priceHistory,
    };
  }
}

module.exports = MarketProvider;
