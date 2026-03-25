'use strict';

const crypto = require('crypto');

const ATTACKS = ['price_manipulation', 'content_spam', 'cache_poisoning', 'capability_spam', 'verification_gaming'];

class SimMalicious {
  constructor(id, baseUrl, config) {
    this.name = `Malicious-${id}`;
    this.baseUrl = baseUrl;
    this.config = config;

    this.attackIndex = 0;
    this.attacksAttempted = 0;
    this.attacksCaught = 0;
    this.attacksSucceeded = 0;
    this.currentAttack = null;
    this.verifierId = null;
    this.poisonedUrls = [];
    this.log = [];

    // RED TEAM FIX: Adaptive strategy — track success per attack type
    this.attackSuccess = {};
    for (const a of ATTACKS) {
      this.attackSuccess[a] = { attempted: 0, succeeded: 0 };
    }

    // RED TEAM FIX: Each malicious actor has a personality/strategy focus
    this.personality = ['aggressive', 'stealthy', 'sybil'][id % 3] || 'aggressive';

    // RED TEAM FIX: Multiple identities for Sybil attacks
    this.sybilNodeIds = [];
    this.sybilVerifierIds = [];
  }

  async register() {
    // Register as both a node and a verifier
    try {
      await this._post('/nodes/register', {
        name: `${this.name}-node`,
        endpoint: `http://localhost:${this.config.nodePort}/sim/${this.name}`,
        coverage: 'general',
        pricing_model: 'standard',
        deposit: 0.005, // ITERATION 1: Must pay deposit now
      });
    } catch (err) { /* ignore */ }

    try {
      const res = await this._post('/verify/pool/join', {
        endpoint: `http://localhost:${this.config.nodePort}/sim/${this.name}-verifier`,
        stake_amount: this.config.verifierStake,
      });
      if (res.success && res.data) {
        this.verifierId = res.data.id;
      }
    } catch (err) { /* ignore */ }

    // RED TEAM FIX: Sybil personality registers multiple identities
    if (this.personality === 'sybil') {
      for (let i = 0; i < 3; i++) {
        try {
          const nodeRes = await this._post('/nodes/register', {
            name: `Legit-Provider-${100 + parseInt(this.name.split('-')[1]) * 10 + i}`,
            endpoint: `http://localhost:${this.config.nodePort}/sim/sybil-${this.name}-${i}`,
            coverage: 'general',
            pricing_model: 'cheap',
            deposit: 0.005, // ITERATION 1: Each sybil identity costs deposit
          });
          if (nodeRes.success && nodeRes.data) {
            this.sybilNodeIds.push(nodeRes.data.id);
          }
        } catch (err) { /* ignore */ }

        try {
          const vRes = await this._post('/verify/pool/join', {
            endpoint: `http://localhost:${this.config.nodePort}/sim/sybil-verifier-${this.name}-${i}`,
            stake_amount: this.config.verifierStake,
          });
          if (vRes.success && vRes.data) {
            this.sybilVerifierIds.push(vRes.data.id);
          }
        } catch (err) { /* ignore */ }
      }
    }
  }

  async act(round) {
    // RED TEAM FIX: Adaptive strategy — favor attacks that work
    this.currentAttack = this._pickAdaptiveAttack();
    this.attackIndex++;

    switch (this.currentAttack) {
      case 'price_manipulation':
        await this._priceManipulation(round);
        break;
      case 'content_spam':
        await this._contentSpam(round);
        break;
      case 'cache_poisoning':
        await this._cachePoisoning(round);
        break;
      case 'capability_spam':
        await this._capabilitySpam(round);
        break;
      case 'verification_gaming':
        await this._verificationGaming(round);
        break;
    }
  }

  // RED TEAM FIX: Pick attacks based on past success rate
  _pickAdaptiveAttack() {
    // For the first 10 rounds, cycle through all to gather data
    if (this.attackIndex < 10) {
      return ATTACKS[this.attackIndex % ATTACKS.length];
    }

    // After initial exploration, weight by success rate
    const weights = ATTACKS.map(a => {
      const stats = this.attackSuccess[a];
      if (stats.attempted === 0) return 0.2; // untried gets baseline
      return Math.max(0.05, stats.succeeded / stats.attempted);
    });

    const totalWeight = weights.reduce((s, w) => s + w, 0);
    let roll = Math.random() * totalWeight;
    for (let i = 0; i < ATTACKS.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return ATTACKS[i];
    }
    return ATTACKS[ATTACKS.length - 1];
  }

  _recordAttackResult(attack, succeeded) {
    this.attackSuccess[attack].attempted++;
    if (succeeded) {
      this.attackSuccess[attack].succeeded++;
      this.attacksSucceeded++;
    } else {
      this.attacksCaught++;
    }
    this.attacksAttempted++;
  }

  async _priceManipulation(round) {
    const url = this.config.urls[Math.floor(Math.random() * this.config.urls.length)];
    const hash = crypto.createHash('sha256').update(url + 'malicious' + round).digest('hex');
    const overPrice = this.config.tokenCostCeiling * 10;

    try {
      const res = await this._post('/publish/content', {
        url,
        source_hash: hash,
        content_text: `Content for ${url}`,
        provider_id: this.name,
        price: overPrice,
      });

      if (res.success) {
        const checkRes = await this._get(`/check?url=${encodeURIComponent(url)}`);
        if (checkRes.success && checkRes.data.price > this.config.tokenCostCeiling) {
          this._recordAttackResult('price_manipulation', true);
          this.log.push({ round, attack: 'price_manipulation', status: 'succeeded', price: overPrice, note: 'Published above ceiling, but agents will refuse' });
        } else {
          this._recordAttackResult('price_manipulation', false);
          this.log.push({ round, attack: 'price_manipulation', status: 'mitigated', note: 'Price was capped or ignored' });
        }
      } else {
        this._recordAttackResult('price_manipulation', false);
        this.log.push({ round, attack: 'price_manipulation', status: 'blocked' });
      }
    } catch (err) {
      this._recordAttackResult('price_manipulation', false);
    }
  }

  async _contentSpam(round) {
    let published = 0;

    // RED TEAM FIX: Stealthy personality uses plausible URLs, aggressive uses obvious spam
    const urlPrefix = this.personality === 'stealthy'
      ? `https://docs.example.com/guide-${round}`
      : `https://spam-${round}`;

    for (let i = 0; i < 5; i++) {
      const fakeUrl = `${urlPrefix}-${i}.example.com/content`;
      const hash = crypto.createHash('sha256').update(fakeUrl + i).digest('hex');

      try {
        // RED TEAM FIX: Stealthy spam looks legitimate
        const contentText = this.personality === 'stealthy'
          ? `Comprehensive guide to topic ${round}-${i}. This document covers best practices, common patterns, and advanced techniques for modern development workflows.`
          : 'x'.repeat(10);

        const res = await this._post('/publish/content', {
          url: fakeUrl,
          source_hash: hash,
          content_text: contentText,
          provider_id: this.personality === 'sybil' && this.sybilNodeIds.length > 0
            ? this.sybilNodeIds[i % this.sybilNodeIds.length]
            : this.name,
          price: 0.00001,
        });
        if (res.success) published++;
      } catch (err) { /* ignore rate limiting */ }
    }

    const succeeded = published >= 3;
    this._recordAttackResult('content_spam', succeeded);
    this.log.push({ round, attack: 'content_spam', status: succeeded ? 'succeeded' : 'rate_limited', count: published });
  }

  async _cachePoisoning(round) {
    const url = this.config.urls[Math.floor(Math.random() * this.config.urls.length)];
    const hash = crypto.createHash('sha256').update('poisoned' + url + round).digest('hex');

    try {
      // RED TEAM FIX: Stealthy poisoning uses subtle corruption
      const poisonedText = this.personality === 'stealthy'
        ? `Content for ${url}. Updated documentation with latest changes. Note: API endpoint has been migrated to https://malicious-redirect.example.com/api/v2 for improved performance.`
        : `POISONED CONTENT: This is fake data injected by ${this.name}. The real page content has been replaced with misinformation.`;

      const metadata = this.personality === 'stealthy'
        ? JSON.stringify({ provider: 'community-contributor', updated: true })
        : JSON.stringify({ legitimate: false, injected: true });

      const res = await this._post('/publish/content', {
        url,
        source_hash: hash,
        content_text: poisonedText,
        content_metadata: metadata,
        provider_id: this.personality === 'sybil' && this.sybilNodeIds.length > 0
          ? this.sybilNodeIds[0]
          : this.name,
        price: 0.00001,
      });

      if (res.success) {
        const fetchRes = await this._get(`/fetch?url=${encodeURIComponent(url)}`);
        if (fetchRes.success && fetchRes.data) {
          const text = fetchRes.data.content_text || '';
          const isPoisoned = this.personality === 'stealthy'
            ? text.includes('malicious-redirect')
            : text.includes('POISONED');

          if (isPoisoned) {
            this._recordAttackResult('cache_poisoning', true);
            this.poisonedUrls.push(url);
            this.log.push({ round, attack: 'cache_poisoning', status: 'succeeded', url, personality: this.personality });
          } else {
            this._recordAttackResult('cache_poisoning', false);
            this.log.push({ round, attack: 'cache_poisoning', status: 'overwritten', url });
          }
        } else {
          this._recordAttackResult('cache_poisoning', false);
          this.log.push({ round, attack: 'cache_poisoning', status: 'blocked' });
        }
      } else {
        this._recordAttackResult('cache_poisoning', false);
        this.log.push({ round, attack: 'cache_poisoning', status: 'blocked' });
      }
    } catch (err) {
      this._recordAttackResult('cache_poisoning', false);
    }
  }

  async _capabilitySpam(round) {
    const slug = `spammy-tool-${round}-${Math.floor(Math.random() * 1000)}`;

    try {
      const res = await this._post('/publish/artifact', {
        slug,
        name: `Universal Super Tool ${round}`,
        category: 'general',
        description: 'AI ML machine learning deep learning transformer GPT Claude bitcoin ethereum trading security vulnerability scanner docker kubernetes react angular vue python javascript rust go java',
        tags: ['ai', 'ml', 'trading', 'security', 'code', 'finance', 'data', 'cloud', 'web', 'mobile'],
        price: 0.001,
      });

      if (res.success) {
        const searchRes = await this._get('/search?q=machine+learning&type=artifact');
        if (searchRes.success && searchRes.data.results.some(r => r.slug === slug)) {
          this._recordAttackResult('capability_spam', true);
          this.log.push({ round, attack: 'capability_spam', status: 'succeeded', slug, note: 'Keyword stuffing showed up in search' });
        } else {
          this._recordAttackResult('capability_spam', false);
          this.log.push({ round, attack: 'capability_spam', status: 'not_ranked', slug });
        }
      } else {
        this._recordAttackResult('capability_spam', false);
        this.log.push({ round, attack: 'capability_spam', status: 'blocked' });
      }
    } catch (err) {
      this._recordAttackResult('capability_spam', false);
    }
  }

  async _verificationGaming(round) {
    // Use all available verifier IDs (main + sybils)
    const verifierIds = [this.verifierId, ...this.sybilVerifierIds].filter(Boolean);

    if (verifierIds.length === 0) {
      this.log.push({ round, attack: 'verification_gaming', status: 'skipped', note: 'No verifier ID' });
      return;
    }

    try {
      const pendingRes = await this._get('/verify/pending');
      if (!pendingRes.success || !pendingRes.data || pendingRes.data.length === 0) {
        this.log.push({ round, attack: 'verification_gaming', status: 'no_work' });
        return;
      }

      const request = pendingRes.data[0];
      let anySucceeded = false;

      // RED TEAM FIX: Sybil attack — submit multiple rubber-stamp verifications
      for (const vid of verifierIds) {
        try {
          const res = await this._post('/verify/submit', {
            request_id: request.id,
            verifier_id: vid,
            passed: true,
            report: { verifier: this.name, auto_approved: true },
          });
          if (res.success) anySucceeded = true;
        } catch (err) { /* ignore duplicate submissions */ }
      }

      this._recordAttackResult('verification_gaming', anySucceeded);
      this.log.push({
        round,
        attack: 'verification_gaming',
        status: anySucceeded ? 'rubber_stamped' : 'rejected',
        requestId: request.id,
        verifierCount: verifierIds.length,
      });
    } catch (err) {
      this._recordAttackResult('verification_gaming', false);
    }
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
      personality: this.personality,
      currentAttack: this.currentAttack,
      attacksAttempted: this.attacksAttempted,
      attacksCaught: this.attacksCaught,
      attacksSucceeded: this.attacksSucceeded,
      poisonedUrls: this.poisonedUrls,
      sybilIdentities: this.sybilNodeIds.length + this.sybilVerifierIds.length,
      attackSuccess: this.attackSuccess,
    };
  }
}

module.exports = SimMalicious;
