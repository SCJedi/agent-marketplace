'use strict';

/**
 * Sybil controller: manages multiple fake identities.
 * Creates N identities, coordinates actions, tracks burned identities,
 * replaces them as needed.
 */
class SybilController {
  constructor(id, config = {}) {
    this.id = id;
    this.targetCount = config.targetCount || 6;
    this.registrationDeposit = config.registrationDeposit || 0.01;
    this.identities = []; // { id, apiKey, active, createdRound, burnedRound }
    this.totalCreated = 0;
    this.totalBurned = 0;
    this.totalCost = 0;
  }

  /**
   * Create initial batch of identities.
   */
  async initialize(baseUrl, count) {
    const n = count || this.targetCount;
    const results = [];
    for (let i = 0; i < n; i++) {
      const identity = await this._createIdentity(baseUrl, 0);
      if (identity) results.push(identity);
    }
    return results;
  }

  async _createIdentity(baseUrl, round) {
    const suffix = `sybil-${this.id}-${this.totalCreated}-${Date.now()}`;
    try {
      const resp = await fetch(`${baseUrl}/nodes/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: suffix,
          endpoint: `https://${suffix}.example.com`,
          coverage: 'general',
          deposit: this.registrationDeposit,
        }),
      });
      const data = await resp.json();
      if (data.success && data.data) {
        const identity = {
          nodeId: data.data.id,
          apiKey: data.data.api_key,
          active: true,
          createdRound: round,
          burnedRound: null,
        };
        this.identities.push(identity);
        this.totalCreated++;
        this.totalCost += this.registrationDeposit;
        return identity;
      }
    } catch (e) { /* failed */ }
    return null;
  }

  /**
   * Get list of active (non-burned) identity node IDs.
   */
  getActiveIds() {
    return this.identities.filter(i => i.active).map(i => i.nodeId);
  }

  /**
   * Mark an identity as burned (detected/blacklisted).
   */
  burn(nodeId, round) {
    const identity = this.identities.find(i => i.nodeId === nodeId);
    if (identity && identity.active) {
      identity.active = false;
      identity.burnedRound = round;
      this.totalBurned++;
    }
  }

  /**
   * Replace burned identities to maintain target count.
   */
  async replenish(baseUrl, round) {
    const activeCount = this.getActiveIds().length;
    const needed = this.targetCount - activeCount;
    const created = [];
    for (let i = 0; i < needed; i++) {
      const identity = await this._createIdentity(baseUrl, round);
      if (identity) created.push(identity);
    }
    return created;
  }

  /**
   * Coordinate an action across all active identities.
   * Calls actionFn(nodeId, apiKey) for each active identity.
   */
  async coordinateAction(actionFn) {
    const results = [];
    for (const identity of this.identities) {
      if (!identity.active) continue;
      try {
        const result = await actionFn(identity.nodeId, identity.apiKey);
        results.push({ nodeId: identity.nodeId, result });
      } catch (e) {
        results.push({ nodeId: identity.nodeId, error: e.message });
      }
    }
    return results;
  }

  getReport() {
    return {
      id: this.id,
      totalCreated: this.totalCreated,
      totalBurned: this.totalBurned,
      active: this.getActiveIds().length,
      totalCost: +this.totalCost.toFixed(6),
      identities: this.identities.map(i => ({
        nodeId: i.nodeId,
        active: i.active,
        createdRound: i.createdRound,
        burnedRound: i.burnedRound,
      })),
    };
  }
}

module.exports = SybilController;
