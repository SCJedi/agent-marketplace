'use strict';

/**
 * MultiNodeClient — queries across multiple marketplace nodes.
 * Uses the directory service to discover nodes, then fans out requests.
 */
class MultiNodeClient {
  constructor(directoryUrl = 'http://localhost:3000') {
    this._directoryUrl = directoryUrl;
    this._nodes = [];
    this._discovered = false;
  }

  /**
   * Discover nodes from the directory service.
   */
  async discoverNodes() {
    const resp = await fetch(`${this._directoryUrl}/nodes`);
    const body = await resp.json();
    this._nodes = body.data || [];
    this._discovered = true;
    return this._nodes;
  }

  /**
   * Ensure nodes are discovered before making requests.
   */
  async _ensureDiscovered() {
    if (!this._discovered) await this.discoverNodes();
  }

  /**
   * Search across all nodes, merge and rank results.
   */
  async search(query, opts = {}) {
    await this._ensureDiscovered();

    const results = [];
    const nodeResults = {};

    await Promise.all(this._nodes.map(async (node) => {
      try {
        const params = new URLSearchParams({ q: query });
        if (opts.type) params.append('type', opts.type);
        if (opts.sort) params.append('sort', opts.sort);

        const resp = await fetch(`${node.endpoint}/search?${params}`, {
          signal: AbortSignal.timeout(5000)
        });
        const body = await resp.json();
        const items = (body.data && body.data.results) || [];

        nodeResults[node.name] = items.length;

        for (const item of items) {
          results.push({ ...item, _node: node.name, _nodeEndpoint: node.endpoint });
        }
      } catch (err) {
        nodeResults[node.name] = 0;
      }
    }));

    // Simple relevance: items matching more of the query terms rank higher
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
   * Check a URL across all nodes, return availability info.
   */
  async check(url) {
    await this._ensureDiscovered();

    const checks = [];

    await Promise.all(this._nodes.map(async (node) => {
      try {
        const params = new URLSearchParams({ url });
        const resp = await fetch(`${node.endpoint}/check?${params}`, {
          signal: AbortSignal.timeout(5000)
        });
        const body = await resp.json();
        const data = body.data || {};
        checks.push({
          node: node.name,
          endpoint: node.endpoint,
          available: data.available || false,
          price: data.price || 0,
          freshness: data.freshness || null,
          providers: data.providers || 0
        });
      } catch (err) {
        checks.push({
          node: node.name,
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
   * Smart fetch — find cheapest provider, buy from them.
   * Optionally compare content hashes across providers for consensus.
   */
  async smartFetch(url, { maxPrice } = {}) {
    const checks = await this.check(url);
    const available = checks.filter(c => c.available);

    if (available.length === 0) return null;

    // Sort by price (cheapest first), then freshness
    available.sort((a, b) => {
      if (a.price !== b.price) return a.price - b.price;
      // More recent = better
      return (b.freshness || '').localeCompare(a.freshness || '');
    });

    const cheapest = available[0];

    // Price check
    if (maxPrice !== undefined && cheapest.price > maxPrice) return null;

    // Fetch from cheapest
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
    } catch (err) {
      return null;
    }
  }

  /**
   * Compare providers for a URL — show prices, freshness, and content hashes.
   */
  async compareProviders(url) {
    const checks = await this.check(url);
    const details = [];

    for (const c of checks) {
      if (!c.available) {
        details.push({ ...c, contentHash: null });
        continue;
      }
      // Fetch content to get hash
      try {
        const params = new URLSearchParams({ url });
        const resp = await fetch(`${c.endpoint}/fetch?${params}`, {
          signal: AbortSignal.timeout(5000)
        });
        const body = await resp.json();
        const content = body.data || {};
        details.push({
          ...c,
          contentHash: content.content_hash || null,
          wordCount: content.content_text ? content.content_text.split(/\s+/).length : 0
        });
      } catch {
        details.push({ ...c, contentHash: null });
      }
    }

    // Check consensus
    const hashes = details.filter(d => d.contentHash).map(d => d.contentHash);
    const uniqueHashes = [...new Set(hashes)];
    const consensus = uniqueHashes.length <= 1 && hashes.length >= 2;

    return { providers: details, consensus, hashCount: hashes.length, uniqueHashes: uniqueHashes.length };
  }
}

module.exports = { MultiNodeClient };
