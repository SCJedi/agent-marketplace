'use strict';

const crypto = require('crypto');

class SimAgent {
  constructor(id, baseUrl, config) {
    this.name = `Agent-${id}`;
    this.baseUrl = baseUrl;
    this.budget = 0.05; // $0.05 starting budget
    this.spent = 0;
    this.interests = this._pickInterests(config.categories);
    this.fetchCount = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.searchCount = 0;
    this.publishCount = 0;
    this.satisfaction = 1.0; // 0-1 scale
    this.config = config;
    this.log = [];

    // Provider quality tracking
    this.providerMemory = {}; // provider_id -> { good: N, bad: N, poisoned: N }
    this.qualityChecks = 0;
    this.qualityFailures = 0;

    // ITERATION 1: Content consensus tracking
    this.consensusChecks = 0;
    this.consensusFailures = 0;
    this.blacklistedProviders = new Set();

    // Willingness-to-pay varies by agent
    this.priceThreshold = config.tokenCostCeiling * (0.3 + Math.random() * 0.7);
  }

  _pickInterests(categories) {
    const count = 1 + Math.floor(Math.random() * 3);
    const shuffled = [...categories].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  async act(round) {
    const action = Math.random();

    if (action < 0.45) {
      await this._fetchContent(round);
    } else if (action < 0.75) {
      await this._search(round);
    } else if (action < 0.90) {
      await this._publishContent(round);
    } else {
      // idle
    }
  }

  async _fetchContent(round) {
    const url = this._pickUrl();
    try {
      // Search for all providers offering this URL, compare prices
      const searchRes = await this._get(`/search?q=${encodeURIComponent(url)}&type=content&sort=price`);
      if (!searchRes.success) return;

      const results = searchRes.data.results.filter(r => r.url === url);

      if (results.length > 0) {
        this.cacheHits++;

        // Filter out blacklisted and bad-memory providers
        const viableResults = results.filter(r => {
          const providerId = r.provider_id;
          if (!providerId) return true;

          // ITERATION 1: Skip blacklisted providers entirely
          if (this.blacklistedProviders.has(providerId)) return false;

          const mem = this.providerMemory[providerId];
          if (!mem) return true;
          const total = mem.good + mem.bad + mem.poisoned;
          if (total < 2) return true;
          // Avoid providers with >40% bad record
          return (mem.bad + mem.poisoned) / total < 0.4;
        });

        const pool = viableResults.length > 0 ? viableResults : results;

        // Pick cheapest option within budget and threshold
        const affordable = pool.filter(r => {
          const price = r.price || 0;
          return price <= this.budget - this.spent && price <= this.priceThreshold;
        });

        if (affordable.length > 0) {
          affordable.sort((a, b) => (a.price || 0) - (b.price || 0));
          const chosen = affordable[0];
          const price = chosen.price || 0;

          // ITERATION 1: Multi-provider consensus check
          // If multiple providers offer this URL, compare content hashes
          if (results.length >= 2) {
            const consensusResult = await this._checkConsensus(url, chosen.provider_id);
            if (consensusResult === 'outlier') {
              // This provider disagrees with consensus — skip and try next
              this.consensusFailures++;
              this.satisfaction = Math.max(0, this.satisfaction - 0.1);

              // Record as bad in memory
              const providerId = chosen.provider_id || 'unknown';
              if (!this.providerMemory[providerId]) {
                this.providerMemory[providerId] = { good: 0, bad: 0, poisoned: 0 };
              }
              this.providerMemory[providerId].bad++;

              // If provider consistently fails consensus, blacklist
              const mem = this.providerMemory[providerId];
              const total = mem.good + mem.bad + mem.poisoned;
              if (total >= 3 && (mem.bad + mem.poisoned) / total > 0.5) {
                this.blacklistedProviders.add(providerId);
              }

              this.log.push({ round, action: 'consensus_reject', url, provider: providerId });
              return;
            }
            this.consensusChecks++;
          }

          // Fetch the actual content
          const fetchRes = await this._get(`/fetch?url=${encodeURIComponent(url)}`);
          if (fetchRes.success && fetchRes.data) {
            this.fetchCount++;
            this.spent += price;

            // Quality check after purchase
            let quality = this._assessQuality(fetchRes.data);
            const providerId = fetchRes.data.provider_id || 'unknown';
            if (!this.providerMemory[providerId]) {
              this.providerMemory[providerId] = { good: 0, bad: 0, poisoned: 0 };
            }
            this.qualityChecks++;

            // ITERATION 1: Also verify content hash integrity
            if (fetchRes.data.content_hash && fetchRes.data.content_text) {
              const expectedHash = crypto.createHash('sha256')
                .update(fetchRes.data.content_text.trim()).digest('hex');
              if (expectedHash !== fetchRes.data.content_hash) {
                quality = 'poisoned'; // Hash mismatch = tampered content
              }
            }

            if (quality === 'poisoned') {
              this.providerMemory[providerId].poisoned++;
              this.qualityFailures++;
              this.satisfaction = Math.max(0, this.satisfaction - 0.15);
              this.log.push({ round, action: 'fetch_poisoned', url, price, provider: providerId });

              // ITERATION 1: Blacklist after poisoning
              const mem = this.providerMemory[providerId];
              if (mem.poisoned >= 2) {
                this.blacklistedProviders.add(providerId);
              }
            } else if (quality === 'bad') {
              this.providerMemory[providerId].bad++;
              this.qualityFailures++;
              this.satisfaction = Math.max(0, this.satisfaction - 0.05);
              this.log.push({ round, action: 'fetch_lowquality', url, price, provider: providerId });
            } else {
              this.providerMemory[providerId].good++;
              this.satisfaction = Math.min(1.0, this.satisfaction + 0.02);
              this.log.push({ round, action: 'fetch', url, price, cached: true, provider: providerId, url });
            }
          }
        } else {
          // Content exists but too expensive or bad providers
          const cheapest = results.reduce((a, b) => (a.price || 0) < (b.price || 0) ? a : b);
          if ((cheapest.price || 0) > this.priceThreshold) {
            this.satisfaction = Math.max(0, this.satisfaction - 0.05);
            this.log.push({ round, action: 'refused_overpriced', url, price: cheapest.price });
          }
        }
      } else {
        this.cacheMisses++;
        this.satisfaction = Math.max(0, this.satisfaction - 0.01);
        this.log.push({ round, action: 'cache_miss', url });
      }
    } catch (err) {
      // Server error
    }
  }

  // ITERATION 1: Multi-provider consensus — compare content from different providers
  async _checkConsensus(url, chosenProviderId) {
    try {
      const providersRes = await this._get(`/fetch/providers?url=${encodeURIComponent(url)}`);
      if (!providersRes.success || !providersRes.data || providersRes.data.length < 2) {
        return 'ok'; // Not enough providers to check consensus
      }

      const entries = providersRes.data;

      // Group content hashes — find the majority hash
      const hashCounts = {};
      for (const entry of entries) {
        if (entry.content_hash) {
          hashCounts[entry.content_hash] = hashCounts[entry.content_hash] || { count: 0, providers: [] };
          hashCounts[entry.content_hash].count++;
          hashCounts[entry.content_hash].providers.push(entry.provider_id);
        }
      }

      if (Object.keys(hashCounts).length <= 1) {
        return 'ok'; // All agree or only one hash
      }

      // Find majority hash
      const sorted = Object.entries(hashCounts).sort((a, b) => b[1].count - a[1].count);
      const majorityHash = sorted[0][0];
      const majorityCount = sorted[0][1].count;

      // Check if chosen provider's content matches majority
      const chosenEntry = entries.find(e => e.provider_id === chosenProviderId);
      if (!chosenEntry || !chosenEntry.content_hash) return 'ok';

      if (chosenEntry.content_hash !== majorityHash && majorityCount >= 2) {
        // Chosen provider disagrees with consensus of 2+ providers
        return 'outlier';
      }

      return 'ok';
    } catch (err) {
      return 'ok'; // On error, allow the fetch
    }
  }

  // Assess content quality after purchase
  _assessQuality(content) {
    if (!content || !content.content_text) return 'bad';

    const text = content.content_text;

    // Detect obvious poisoning
    if (text.includes('POISONED') || text.includes('fake data') || text.includes('misinformation')) {
      return 'poisoned';
    }

    // Detect subtle poisoning — malicious redirects
    if (text.includes('malicious-redirect') || text.includes('phishing')) {
      return 'poisoned';
    }

    // Detect spam / low quality (very short content, repetitive)
    if (text.length < 20) return 'bad';
    if (/^(.)\1{9,}$/.test(text.trim())) return 'bad'; // repeated character

    // Check metadata for signs of injection
    if (content.content_metadata) {
      try {
        const meta = typeof content.content_metadata === 'string'
          ? JSON.parse(content.content_metadata)
          : content.content_metadata;
        if (meta.legitimate === false || meta.injected === true) return 'poisoned';
      } catch (e) { /* ignore parse errors */ }
    }

    return 'good';
  }

  async _search(round) {
    const interest = this.interests[Math.floor(Math.random() * this.interests.length)];
    const queries = {
      tech: ['javascript', 'python', 'docker', 'kubernetes', 'react'],
      finance: ['bitcoin', 'ethereum', 'trading', 'defi', 'markets'],
      ai: ['transformer', 'pytorch', 'openai', 'claude', 'machine learning'],
      security: ['owasp', 'vulnerability', 'exploit', 'cve', 'security'],
      data: ['dataset', 'kaggle', 'research', 'api', 'worldbank'],
      general: ['tutorial', 'guide', 'documentation', 'overview', 'introduction'],
    };
    const queryPool = queries[interest] || queries.general;
    const q = queryPool[Math.floor(Math.random() * queryPool.length)];

    try {
      const res = await this._get(`/search?q=${encodeURIComponent(q)}&type=content`);
      if (res.success) {
        this.searchCount++;
        if (res.data.total > 0) {
          this.satisfaction = Math.min(1.0, this.satisfaction + 0.01);
        }
        this.log.push({ round, action: 'search', query: q, results: res.data.total });
      }
    } catch (err) {
      // ignore
    }
  }

  async _publishContent(round) {
    const url = this._pickUrl();
    const hash = crypto.createHash('sha256').update(url + Date.now()).digest('hex');
    try {
      const res = await this._post('/publish/content', {
        url,
        source_hash: hash,
        content_text: `Simulated content for ${url} by ${this.name}`,
        content_metadata: JSON.stringify({ source: this.name, round }),
        price: 0,
      });
      if (res.success) {
        this.publishCount++;
        this.log.push({ round, action: 'publish', url });
      }
    } catch (err) {
      // ignore
    }
  }

  _pickUrl() {
    return this.config.urls[Math.floor(Math.random() * this.config.urls.length)];
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
      spent: this.spent,
      fetchCount: this.fetchCount,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      searchCount: this.searchCount,
      publishCount: this.publishCount,
      satisfaction: this.satisfaction,
      qualityChecks: this.qualityChecks,
      qualityFailures: this.qualityFailures,
      consensusChecks: this.consensusChecks,
      consensusFailures: this.consensusFailures,
      blacklistedProviders: Array.from(this.blacklistedProviders),
      badProviders: Object.entries(this.providerMemory)
        .filter(([, m]) => (m.bad + m.poisoned) / Math.max(1, m.good + m.bad + m.poisoned) > 0.4)
        .map(([id]) => id),
    };
  }
}

module.exports = SimAgent;
