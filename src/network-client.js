'use strict';

const DEFAULT_SEEDS = require('./seeds');

/**
 * NetworkClient — Agent-side P2P client.
 *
 * Replaces the centralized directory approach. Discovers nodes
 * by peer-crawling: start with seed nodes, ask each for their peers,
 * ask THOSE peers for THEIR peers, until no new nodes found.
 */
class NetworkClient {
  constructor(options = {}) {
    this.seeds = options.seeds || DEFAULT_SEEDS;
    this.nodeCache = new Map(); // endpoint -> { name, specialty, lastChecked }
    this._discovered = false;
  }

  /**
   * Discover all reachable nodes by breadth-first peer crawling.
   */
  async discoverNetwork() {
    const visited = new Set();
    const queue = [...this.seeds];

    while (queue.length > 0) {
      const endpoint = queue.shift();
      if (visited.has(endpoint)) continue;
      visited.add(endpoint);

      try {
        // Check if node is alive
        const healthResp = await fetch(`${endpoint}/health`, {
          signal: AbortSignal.timeout(3000)
        });
        if (!healthResp.ok) continue;

        // Get node info
        let name = endpoint;
        let specialty = 'general';

        // Get this node's peer list
        try {
          const peersResp = await fetch(`${endpoint}/peers`, {
            signal: AbortSignal.timeout(3000)
          });
          if (peersResp.ok) {
            const data = await peersResp.json();
            const peers = data.data || data.peers || [];
            for (const p of peers) {
              const peerEp = p.endpoint || p;
              if (!visited.has(peerEp)) {
                queue.push(peerEp);
              }
              // Learn name/specialty from peer info
              if (p.name) {
                this.nodeCache.set(peerEp, {
                  name: p.name,
                  specialty: p.specialty || 'general',
                  lastChecked: new Date().toISOString()
                });
              }
            }
          }
        } catch {
          // No peer endpoint — that's okay
        }

        // Cache this node
        const cached = this.nodeCache.get(endpoint);
        this.nodeCache.set(endpoint, {
          name: (cached && cached.name) || name,
          specialty: (cached && cached.specialty) || specialty,
          lastChecked: new Date().toISOString()
        });

      } catch {
        // Node unreachable — skip
      }
    }

    this._discovered = true;
    return this.getNodes();
  }

  /**
   * Ensure we have discovered the network.
   */
  async ensureNodes() {
    if (!this._discovered || this.nodeCache.size === 0) {
      await this.discoverNetwork();
    }
  }

  /**
   * Get all known nodes.
   */
  getNodes() {
    const nodes = [];
    for (const [endpoint, info] of this.nodeCache) {
      nodes.push({ endpoint, ...info });
    }
    return nodes;
  }

  /**
   * Search across all known nodes, merge and rank results.
   */
  async search(query, opts = {}) {
    await this.ensureNodes();

    const results = [];
    const nodeResults = {};

    await Promise.all(this.getNodes().map(async (node) => {
      try {
        const params = new URLSearchParams({ q: query });
        if (opts.type) params.append('type', opts.type);
        if (opts.sort) params.append('sort', opts.sort);

        const resp = await fetch(`${node.endpoint}/search?${params}`, {
          signal: AbortSignal.timeout(5000)
        });
        const body = await resp.json();
        const items = (body.data && body.data.results) || [];

        nodeResults[node.name || node.endpoint] = items.length;

        for (const item of items) {
          results.push({ ...item, _node: node.name || node.endpoint, _nodeEndpoint: node.endpoint });
        }
      } catch {
        nodeResults[node.name || node.endpoint] = 0;
      }
    }));

    // Relevance ranking
    const queryTerms = query.toLowerCase().split(/\s+/);
    for (const r of results) {
      const text = `${r.url || ''} ${r.content_text || ''} ${r.name || ''} ${r.description || ''} ${r.content_metadata || ''}`.toLowerCase();
      let score = 0;
      for (const term of queryTerms) {
        if (text.includes(term)) score++;
      }
      r._relevance = score / queryTerms.length;
    }
    results.sort((a, b) => b._relevance - a._relevance);

    return { results, nodeResults };
  }

  /**
   * Check a URL across all known nodes.
   */
  async check(url) {
    await this.ensureNodes();

    const checks = [];

    await Promise.all(this.getNodes().map(async (node) => {
      try {
        const params = new URLSearchParams({ url });
        const resp = await fetch(`${node.endpoint}/check?${params}`, {
          signal: AbortSignal.timeout(5000)
        });
        const body = await resp.json();
        const data = body.data || {};
        checks.push({
          node: node.name || node.endpoint,
          endpoint: node.endpoint,
          available: data.available || false,
          price: data.price || 0,
          freshness: data.freshness || null,
          providers: data.providers || 0
        });
      } catch (err) {
        checks.push({
          node: node.name || node.endpoint,
          endpoint: node.endpoint,
          available: false,
          price: 0,
          freshness: null,
          providers: 0,
          error: err.message
        });
      }
    }));

    return checks;
  }

  /**
   * Smart fetch — find cheapest provider across all nodes, buy from them.
   */
  async smartFetch(url, { maxPrice } = {}) {
    const checks = await this.check(url);
    const available = checks.filter(c => c.available);

    if (available.length === 0) return null;

    // Sort by price (cheapest first), then freshness
    available.sort((a, b) => {
      if (a.price !== b.price) return a.price - b.price;
      return (b.freshness || '').localeCompare(a.freshness || '');
    });

    const cheapest = available[0];

    if (maxPrice !== undefined && cheapest.price > maxPrice) return null;

    try {
      const params = new URLSearchParams({ url });
      const resp = await fetch(`${cheapest.endpoint}/fetch?${params}`, {
        signal: AbortSignal.timeout(10000)
      });
      const body = await resp.json();
      const content = body.data || null;

      return {
        content,
        provider: cheapest.node,
        price: cheapest.price,
        alternativeProviders: available.length - 1,
        savings: available.length > 1
          ? available[available.length - 1].price - cheapest.price
          : 0
      };
    } catch {
      return null;
    }
  }
}

module.exports = { NetworkClient };
