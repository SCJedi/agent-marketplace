'use strict';

const crypto = require('crypto');

class MarketAgent {
  constructor(id, baseUrl, config, tier) {
    this.id = id;
    this.name = `${tier.charAt(0).toUpperCase() + tier.slice(1)}Agent-${id}`;
    this.baseUrl = baseUrl;
    this.config = config;
    this.tier = tier;

    const tierConfig = config.budgetTiers[tier];
    this.budget = tierConfig.budget;
    this.priceCeiling = tierConfig.priceCeiling;
    this.spent = 0;

    // Demand patterns
    // 40% of agents are "repeat" buyers — they want the same URLs again and again
    // 60% want diverse content
    this.isRepeatBuyer = Math.random() < 0.4;
    this.favoriteUrls = this._pickFavorites(config.urls, 5 + Math.floor(Math.random() * 10));
    this.interests = this._pickInterests(config.categories, 1 + Math.floor(Math.random() * 3));

    // Price sensitivity — track recent prices to detect trends
    this.priceHistory = []; // { round, price }
    this.priceDelayRounds = 0; // rounds to wait if prices trending down

    // Satisfaction tracking
    this.satisfaction = 1.0;
    this.satisfactionHistory = []; // { round, satisfaction }
    this.valueReceived = 0; // aggregate quality-adjusted value

    // Activity tracking
    this.fetchCount = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.searchCount = 0;
    this.refusedOverpriced = 0;
    this.delayedPurchases = 0;
    this.log = [];
  }

  _pickFavorites(urls, count) {
    const shuffled = [...urls].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(count, urls.length));
  }

  _pickInterests(categories, count) {
    const shuffled = [...categories].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  async act(round) {
    // Check if we should delay purchases due to price trends
    if (this.priceDelayRounds > 0) {
      this.priceDelayRounds--;
      this.delayedPurchases++;
      this.log.push({ round, action: 'delayed_purchase', reason: 'price_trending_down' });
      return;
    }

    const action = Math.random();
    if (action < 0.55) {
      await this._fetchContent(round);
    } else if (action < 0.80) {
      await this._search(round);
    } else if (action < 0.92) {
      await this._checkTrending(round);
    } else {
      // idle — some rounds agents don't need anything
    }

    // Record satisfaction snapshot every 10 rounds
    if (round % 10 === 0) {
      this.satisfactionHistory.push({ round, satisfaction: this.satisfaction });
    }
  }

  async _fetchContent(round) {
    // Repeat buyers pick from favorites, diverse buyers pick randomly
    const url = this.isRepeatBuyer && Math.random() < 0.7
      ? this.favoriteUrls[Math.floor(Math.random() * this.favoriteUrls.length)]
      : this.config.urls[Math.floor(Math.random() * this.config.urls.length)];

    try {
      const searchRes = await this._get(`/search?q=${encodeURIComponent(url)}&type=content&sort=price`);
      if (!searchRes.success) return;

      const results = searchRes.data.results.filter(r => r.url === url);

      if (results.length > 0) {
        this.cacheHits++;

        // Find affordable options within budget and price ceiling
        const remaining = this.budget - this.spent;
        const affordable = results.filter(r => {
          const price = r.price || 0;
          return price <= remaining && price <= this.priceCeiling;
        });

        if (affordable.length > 0) {
          // Sort by price ascending
          affordable.sort((a, b) => (a.price || 0) - (b.price || 0));
          const chosen = affordable[0];
          const price = chosen.price || 0;

          // Track price trend
          this.priceHistory.push({ round, price });
          if (this.priceHistory.length > 10) {
            this.priceHistory = this.priceHistory.slice(-10);
          }

          // Detect downward price trend — if last 5 prices are declining, wait 1-2 rounds
          if (this.priceHistory.length >= 5 && this.tier !== 'premium') {
            const recent = this.priceHistory.slice(-5);
            let declining = 0;
            for (let i = 1; i < recent.length; i++) {
              if (recent[i].price < recent[i - 1].price) declining++;
            }
            if (declining >= 4) {
              this.priceDelayRounds = 1 + Math.floor(Math.random() * 2);
              this.log.push({ round, action: 'detected_price_drop', delayRounds: this.priceDelayRounds });
            }
          }

          // Fetch the content
          const fetchRes = await this._get(`/fetch?url=${encodeURIComponent(url)}`);
          if (fetchRes.success && fetchRes.data) {
            this.fetchCount++;
            this.spent += price;

            // Calculate value received — quality vs price paid
            const quality = this._assessContentQuality(fetchRes.data);
            const valueRatio = price > 0 ? quality / (price / this.priceCeiling) : quality;
            this.valueReceived += quality;

            // Satisfaction adjustment based on value ratio
            if (valueRatio > 1.5) {
              this.satisfaction = Math.min(1.0, this.satisfaction + 0.03);
            } else if (valueRatio > 0.8) {
              this.satisfaction = Math.min(1.0, this.satisfaction + 0.01);
            } else {
              this.satisfaction = Math.max(0, this.satisfaction - 0.02);
            }

            this.log.push({
              round, action: 'fetch', url, price,
              quality, valueRatio: Math.round(valueRatio * 100) / 100,
              provider: fetchRes.data.provider_id || 'unknown',
              cached: true,
            });
          }
        } else {
          // Content exists but too expensive
          this.refusedOverpriced++;
          const cheapest = results.reduce((a, b) => (a.price || 0) < (b.price || 0) ? a : b);
          this.satisfaction = Math.max(0, this.satisfaction - 0.03);
          this.log.push({
            round, action: 'refused_overpriced', url,
            cheapestPrice: cheapest.price,
            ceiling: this.priceCeiling,
          });
        }
      } else {
        this.cacheMisses++;
        this.satisfaction = Math.max(0, this.satisfaction - 0.01);
        this.log.push({ round, action: 'cache_miss', url });
      }
    } catch (err) {
      // server error
    }
  }

  _assessContentQuality(content) {
    if (!content || !content.content_text) return 0;
    const text = content.content_text;
    // Quality score 0-1 based on content length and structure
    let score = Math.min(1.0, text.length / 200);
    // Bonus for having structured data
    if (content.content_structured) score = Math.min(1.0, score + 0.2);
    // Bonus for metadata (freshness info)
    if (content.content_metadata) {
      try {
        const meta = typeof content.content_metadata === 'string'
          ? JSON.parse(content.content_metadata) : content.content_metadata;
        if (meta.quality) score = Math.min(1.0, score * (0.5 + meta.quality * 0.5));
      } catch (e) { /* ignore */ }
    }
    return Math.round(score * 100) / 100;
  }

  async _search(round) {
    const interest = this.interests[Math.floor(Math.random() * this.interests.length)];
    const queries = {
      tech: ['javascript', 'python', 'docker', 'kubernetes', 'react', 'typescript'],
      finance: ['bitcoin', 'ethereum', 'trading', 'defi', 'markets', 'nasdaq'],
      ai: ['transformer', 'pytorch', 'openai', 'claude', 'machine learning', 'langchain'],
      security: ['owasp', 'vulnerability', 'exploit', 'cve', 'mitre'],
      data: ['dataset', 'kaggle', 'research', 'worldbank', 'census'],
      news: ['techcrunch', 'verge', 'wired', 'arstechnica', 'hackernews'],
      api: ['stripe', 'github', 'aws', 'google', 'vercel'],
    };
    const pool = queries[interest] || queries.tech;
    const q = pool[Math.floor(Math.random() * pool.length)];

    try {
      const res = await this._get(`/search?q=${encodeURIComponent(q)}&type=content`);
      if (res.success) {
        this.searchCount++;
        if (res.data.total > 0) {
          this.satisfaction = Math.min(1.0, this.satisfaction + 0.005);
        }
        this.log.push({ round, action: 'search', query: q, results: res.data.total });
      }
    } catch (err) {
      // ignore
    }
  }

  async _checkTrending(round) {
    try {
      const res = await this._get('/trending?period=30d');
      if (res.success) {
        this.log.push({ round, action: 'check_trending' });
      }
    } catch (err) {
      // ignore
    }
  }

  async _get(path) {
    const res = await fetch(`${this.baseUrl}${path}`);
    return res.json();
  }

  getStats() {
    return {
      name: this.name,
      tier: this.tier,
      budget: this.budget,
      spent: this.spent,
      remaining: this.budget - this.spent,
      priceCeiling: this.priceCeiling,
      isRepeatBuyer: this.isRepeatBuyer,
      fetchCount: this.fetchCount,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      searchCount: this.searchCount,
      refusedOverpriced: this.refusedOverpriced,
      delayedPurchases: this.delayedPurchases,
      satisfaction: this.satisfaction,
      satisfactionHistory: this.satisfactionHistory,
      valueReceived: this.valueReceived,
    };
  }
}

module.exports = MarketAgent;
