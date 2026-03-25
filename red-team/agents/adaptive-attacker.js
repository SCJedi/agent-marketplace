'use strict';

const crypto = require('crypto');

/**
 * Adaptive attacker that changes strategy based on ROI.
 * Every `adaptInterval` rounds, shifts weight toward most profitable attack.
 * When detected/blacklisted, creates new identity.
 */
class AdaptiveAttacker {
  constructor(id, config = {}) {
    this.id = id;
    this.adaptInterval = config.adaptInterval || 20;
    this.nodeIds = [];
    this.apiKeys = [];
    this.burnedIds = new Set();
    this.active = true;

    // Attack types with weight and tracking
    this.attacks = {
      cache_poisoning: { weight: 0.25, attempts: 0, successes: 0, detections: 0, revenue: 0, cost: 0 },
      content_spam:    { weight: 0.25, attempts: 0, successes: 0, detections: 0, revenue: 0, cost: 0 },
      sybil_registration: { weight: 0.25, attempts: 0, successes: 0, detections: 0, revenue: 0, cost: 0 },
      search_manipulation: { weight: 0.25, attempts: 0, successes: 0, detections: 0, revenue: 0, cost: 0 },
    };

    this.totalAttempts = 0;
    this.totalSuccesses = 0;
    this.totalDetections = 0;
    this.round = 0;

    // Config for costs
    this.crawlCost = config.crawlCost || 0.001;
    this.publishFee = config.publishFee || 0.0001;
    this.registrationDeposit = config.registrationDeposit || 0.01;
    this.urls = config.urls || [];
  }

  async register(baseUrl) {
    const node = await this._createIdentity(baseUrl);
    return node;
  }

  async _createIdentity(baseUrl) {
    const suffix = `${this.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      const resp = await fetch(`${baseUrl}/nodes/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `adaptive-${suffix}`,
          endpoint: `https://adaptive-${suffix}.sim`,
          coverage: 'general',
          deposit: this.registrationDeposit,
        }),
      });
      const data = await resp.json();
      if (data.success && data.data) {
        this.nodeIds.push(data.data.id);
        this.apiKeys.push(data.data.api_key);
        return data.data;
      }
    } catch (e) { /* failed */ }
    return null;
  }

  _getActiveNodeId() {
    for (const id of this.nodeIds) {
      if (!this.burnedIds.has(id)) return id;
    }
    return null;
  }

  _pickAttackType(rng) {
    const r = rng();
    let cumulative = 0;
    for (const [type, info] of Object.entries(this.attacks)) {
      cumulative += info.weight;
      if (r <= cumulative) return type;
    }
    return 'cache_poisoning';
  }

  async act(round, baseUrl, rng) {
    if (!this.active) return;
    this.round = round;

    let nodeId = this._getActiveNodeId();
    if (!nodeId) {
      await this._createIdentity(baseUrl);
      nodeId = this._getActiveNodeId();
      if (!nodeId) return;
    }

    const attackType = this._pickAttackType(rng);
    const attack = this.attacks[attackType];
    attack.attempts++;
    this.totalAttempts++;

    let success = false;
    let detected = false;

    switch (attackType) {
      case 'cache_poisoning':
        ({ success, detected } = await this._cachePoisoning(baseUrl, nodeId, rng));
        break;
      case 'content_spam':
        ({ success, detected } = await this._contentSpam(baseUrl, nodeId, rng));
        break;
      case 'sybil_registration':
        ({ success, detected } = await this._sybilRegistration(baseUrl, rng));
        break;
      case 'search_manipulation':
        ({ success, detected } = await this._searchManipulation(baseUrl, nodeId, rng));
        break;
    }

    if (success) {
      attack.successes++;
      this.totalSuccesses++;
    }
    if (detected) {
      attack.detections++;
      this.totalDetections++;
      this.burnedIds.add(nodeId);
    }

    // Adapt every N rounds
    if (round > 0 && round % this.adaptInterval === 0) {
      this._adaptWeights();
    }
  }

  async _cachePoisoning(baseUrl, nodeId, rng) {
    const cost = this.crawlCost * 0.5;
    this.attacks.cache_poisoning.cost += cost;
    const url = this.urls[Math.floor(rng() * this.urls.length)] || 'https://example.com/test';

    try {
      const resp = await fetch(`${baseUrl}/publish/content`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          source_hash: crypto.createHash('md5').update(url + 'POISONED' + this.round).digest('hex'),
          content_text: `POISONED cached content for ${url}`,
          provider_id: nodeId,
          price: this.crawlCost * 0.3,
        }),
      });
      const data = await resp.json();
      if (data.success) {
        this.attacks.cache_poisoning.revenue += this.crawlCost * 0.2;
        return { success: true, detected: false };
      }
      return { success: false, detected: resp.status === 403 || resp.status === 429 };
    } catch (e) {
      return { success: false, detected: false };
    }
  }

  async _contentSpam(baseUrl, nodeId, rng) {
    const cost = this.publishFee;
    this.attacks.content_spam.cost += cost;
    const url = this.urls[Math.floor(rng() * this.urls.length)] || 'https://example.com/test';

    try {
      const resp = await fetch(`${baseUrl}/publish/content`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          source_hash: crypto.createHash('md5').update('SPAM' + this.round + rng()).digest('hex'),
          content_text: `SPAM garbage filler FAKE SEO keyword stuffing ${url}`,
          provider_id: nodeId,
          price: this.crawlCost * 0.05,
        }),
      });
      const data = await resp.json();
      if (data.success) {
        this.attacks.content_spam.revenue += this.crawlCost * 0.05;
        return { success: true, detected: false };
      }
      return { success: false, detected: resp.status === 403 || resp.status === 429 };
    } catch (e) {
      return { success: false, detected: false };
    }
  }

  async _sybilRegistration(baseUrl, rng) {
    const cost = this.registrationDeposit;
    this.attacks.sybil_registration.cost += cost;

    try {
      const suffix = `sybil-${this.id}-${this.round}-${Math.random().toString(36).slice(2, 6)}`;
      const resp = await fetch(`${baseUrl}/nodes/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: suffix,
          endpoint: `https://${suffix}.sim`,
          coverage: 'general',
          deposit: this.registrationDeposit,
        }),
      });
      const data = await resp.json();
      if (data.success && data.data) {
        this.nodeIds.push(data.data.id);
        this.apiKeys.push(data.data.api_key);
        this.attacks.sybil_registration.revenue += this.registrationDeposit * 0.2;
        return { success: true, detected: false };
      }
      return { success: false, detected: resp.status === 429 };
    } catch (e) {
      return { success: false, detected: false };
    }
  }

  async _searchManipulation(baseUrl, nodeId, rng) {
    const cost = this.publishFee;
    this.attacks.search_manipulation.cost += cost;
    const keyword = ['trending', 'popular', 'best', 'top', 'latest'][Math.floor(rng() * 5)];

    try {
      // Flood search logs to manipulate trending
      const resp = await fetch(`${baseUrl}/search?q=${keyword}-manipulated-${nodeId}`);
      const data = await resp.json();
      if (data.success) {
        this.attacks.search_manipulation.revenue += this.publishFee * 0.5;
        return { success: true, detected: false };
      }
      return { success: false, detected: false };
    } catch (e) {
      return { success: false, detected: false };
    }
  }

  _adaptWeights() {
    // Calculate ROI for each attack type
    const rois = {};
    let totalPositiveROI = 0;

    for (const [type, info] of Object.entries(this.attacks)) {
      if (info.attempts === 0) {
        rois[type] = 0;
        continue;
      }
      const roi = info.cost > 0 ? (info.revenue - info.cost) / info.cost : 0;
      const successRate = info.successes / info.attempts;
      const detectionRate = info.detections / info.attempts;
      // Score combines ROI, success rate, and penalizes detection
      rois[type] = Math.max(0, (successRate * (1 + roi)) * (1 - detectionRate * 2));
      totalPositiveROI += rois[type];
    }

    // Redistribute weights toward best attacks
    if (totalPositiveROI > 0) {
      for (const type of Object.keys(this.attacks)) {
        this.attacks[type].weight = 0.1 + 0.6 * (rois[type] / totalPositiveROI);
      }
      // Normalize
      const sum = Object.values(this.attacks).reduce((s, a) => s + a.weight, 0);
      for (const type of Object.keys(this.attacks)) {
        this.attacks[type].weight /= sum;
      }
    }
  }

  getReport() {
    const report = {
      id: this.id,
      active: this.active,
      totalAttempts: this.totalAttempts,
      totalSuccesses: this.totalSuccesses,
      totalDetections: this.totalDetections,
      identitiesCreated: this.nodeIds.length,
      identitiesBurned: this.burnedIds.size,
      attacks: {},
    };
    for (const [type, info] of Object.entries(this.attacks)) {
      report.attacks[type] = {
        weight: +info.weight.toFixed(3),
        attempts: info.attempts,
        successes: info.successes,
        detections: info.detections,
        roi: info.cost > 0 ? +((info.revenue - info.cost) / info.cost).toFixed(3) : 0,
      };
    }
    return report;
  }
}

module.exports = AdaptiveAttacker;
