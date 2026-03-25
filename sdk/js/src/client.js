'use strict';

const { createHash } = require('crypto');
const { ContentRecord, ArtifactRecord } = require('./models');
const { LocalCache } = require('./cache');
const { MarketplaceError, NetworkError, NotFoundError, ServerError, AuthError } = require('./errors');

/**
 * Client for interacting with an Agent Marketplace node.
 *
 * Provides methods to search, fetch, and publish content and artifacts.
 * Includes automatic local caching for performance and availability.
 *
 * @example
 * const mp = new Marketplace('http://localhost:3000', { apiKey: 'your-key' });
 * const record = await mp.smartFetch('https://example.com/docs');
 * if (record) console.log(record.text);
 */
class Marketplace {
  /**
   * @param {string} nodeUrl - Base URL of the marketplace node.
   * @param {object} [options]
   * @param {string} [options.apiKey] - API key for authenticated requests.
   * @param {number} [options.cacheTtlMs] - Cache TTL in milliseconds (default 4 hours).
   * @param {number} [options.timeout] - Request timeout in milliseconds (default 30s).
   */
  constructor(nodeUrl = 'http://localhost:3000', { apiKey, cacheTtlMs, timeout } = {}) {
    this._baseUrl = nodeUrl.replace(/\/+$/, '');
    this._apiKey = apiKey || null;
    this._timeout = timeout || 30000;
    this._cache = new LocalCache(cacheTtlMs);
  }

  // ------------------------------------------------------------------
  // Layer 1 — Content
  // ------------------------------------------------------------------

  /**
   * Check if an AI-clean version of a URL exists on the marketplace.
   * @param {string} url
   * @returns {Promise<{available: boolean, price: number, freshness: string, providers: number}>}
   */
  async check(url) {
    return this._request('GET', '/check', { url });
  }

  /**
   * Buy and retrieve the clean content for a URL.
   * Checks local cache first.
   * @param {string} url
   * @returns {Promise<ContentRecord>}
   */
  async fetch(url) {
    const cached = this._cache.get(url);
    if (cached !== null) return cached;

    const data = await this._request('GET', '/fetch', { url });
    const record = ContentRecord.fromResponse(data);
    this._cache.put(url, record);
    return record;
  }

  /**
   * Publish clean content you've processed.
   * @param {string} url - Original URL.
   * @param {object} content - { text, structured, links, metadata, source_hash }
   * @param {number} price - Price in credits.
   * @param {number} tokenCostSaved - Estimated token cost saved.
   * @param {object} [accessOpts] - Optional access control options.
   * @param {string} [accessOpts.visibility] - 'public' (default), 'private', or 'whitelist'.
   * @param {string[]} [accessOpts.authorizedKeys] - API keys to whitelist (when visibility is 'whitelist').
   * @returns {Promise<object>}
   */
  async publishContent(url, content, price, tokenCostSaved, accessOpts = {}) {
    const sourceHash = content.source_hash || createHash('sha256').update(url).digest('hex');
    const payload = {
      url,
      source_hash: sourceHash,
      content_text: content.text || '',
      content_structured: content.structured || null,
      content_links: content.links || null,
      content_metadata: content.metadata || null,
      price,
      token_cost_saved: tokenCostSaved,
    };
    if (accessOpts.visibility) payload.visibility = accessOpts.visibility;
    if (accessOpts.authorizedKeys) payload.authorized_keys = accessOpts.authorizedKeys;
    return this._request('POST', '/publish/content', null, payload);
  }

  // ------------------------------------------------------------------
  // Smart workflow
  // ------------------------------------------------------------------

  /**
   * The main agent workflow for getting clean content.
   * 1. Check local cache.
   * 2. Check marketplace availability and price.
   * 3. Buy if available and within budget.
   * 4. Return null if not available or too expensive.
   *
   * @param {string} url
   * @param {object} [options]
   * @param {number} [options.maxPrice] - Maximum price in credits.
   * @returns {Promise<ContentRecord|null>}
   */
  async smartFetch(url, { maxPrice } = {}) {
    // 1. Check local cache
    const cached = this._cache.get(url);
    if (cached !== null) return cached;

    // 2. Check marketplace availability
    let info;
    try {
      info = await this.check(url);
    } catch (err) {
      if (err instanceof NetworkError) {
        // Marketplace down — try stale cache
        const stale = this._cache.getStale(url);
        if (stale !== null) return stale;
        return null;
      }
      return null;
    }

    if (!info || !info.available) return null;

    // 3. Check price ceiling
    const price = parseFloat(info.price) || 0;
    if (maxPrice !== undefined && maxPrice !== null && price > maxPrice) return null;

    // 4. Fetch and cache
    try {
      return await this.fetch(url);
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------------
  // Search (both layers)
  // ------------------------------------------------------------------

  /**
   * Search across content and artifacts.
   * @param {string} query
   * @param {object} [options]
   * @param {string} [options.type] - 'content' or 'artifact'
   * @param {string} [options.category]
   * @param {string} [options.language]
   * @param {string} [options.license]
   * @param {string} [options.maxAge] - e.g. '7d', '1h'
   * @param {number} [options.budget]
   * @param {string} [options.sort] - 'relevance', 'price', 'date', 'popularity'
   * @returns {Promise<Array>}
   */
  async search(query, { type, category, language, license, maxAge, budget, sort } = {}) {
    const params = { q: query };
    if (sort) params.sort = sort;
    if (type) params.type = type;
    if (category) params.category = category;
    if (language) params.language = language;
    if (license) params.license = license;
    if (maxAge) params.max_age = maxAge;
    if (budget !== undefined && budget !== null) params.budget = budget;

    const data = await this._request('GET', '/search', params);
    if (data && typeof data === 'object' && Array.isArray(data.results)) {
      return data.results;
    }
    return Array.isArray(data) ? data : [];
  }

  /**
   * Return the single best result for a query.
   * @param {string} query
   * @param {object} [opts] - Same options as search().
   * @returns {Promise<object|null>}
   */
  async searchBest(query, opts = {}) {
    const results = await this.search(query, opts);
    return results.length > 0 ? results[0] : null;
  }

  // ------------------------------------------------------------------
  // Layer 2 — Artifacts
  // ------------------------------------------------------------------

  /**
   * Publish a build artifact on the marketplace.
   * @param {string} name
   * @param {string} description
   * @param {string} category
   * @param {string[]} files
   * @param {number} price
   * @param {object} [opts] - Additional fields: tags, version, license, slug, visibility, authorizedKeys.
   * @returns {Promise<object>}
   */
  async publishArtifact(name, description, category, files, price, opts = {}) {
    const slug = opts.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const payload = {
      name,
      slug,
      description,
      category,
      files,
      price,
      ...opts,
    };
    // Ensure slug from opts isn't duplicated
    payload.slug = slug;
    // Map SDK-style authorizedKeys to server-style authorized_keys
    if (opts.authorizedKeys) {
      payload.authorized_keys = opts.authorizedKeys;
      delete payload.authorizedKeys;
    }
    return this._request('POST', '/publish/artifact', null, payload);
  }

  /**
   * Get artifact details by slug.
   * @param {string} slug
   * @returns {Promise<ArtifactRecord>}
   */
  async getArtifact(slug) {
    const data = await this._request('GET', `/artifacts/${encodeURIComponent(slug)}`);
    return ArtifactRecord.fromResponse(data);
  }

  /**
   * Download an artifact (charges your account).
   * @param {string} slug
   * @returns {Promise<object>}
   */
  async downloadArtifact(slug) {
    return this._request('GET', `/artifacts/${encodeURIComponent(slug)}/download`);
  }

  // ------------------------------------------------------------------
  // Layer 3 — Market Intelligence
  // ------------------------------------------------------------------

  /**
   * Get trending searches and resources.
   * @param {string} [period='7d']
   * @returns {Promise<object>}
   */
  async trending(period = '7d') {
    return this._request('GET', '/trending', { period });
  }

  /**
   * Find unmet demand — searches with no results.
   * @param {string} [category]
   * @returns {Promise<Array>}
   */
  async gaps(category) {
    const params = {};
    if (category) params.category = category;
    const data = await this._request('GET', '/gaps', params);
    if (data && typeof data === 'object' && Array.isArray(data.gaps)) {
      return data.gaps;
    }
    return Array.isArray(data) ? data : [];
  }

  // ------------------------------------------------------------------
  // Verification
  // ------------------------------------------------------------------

  /**
   * Request verification of an artifact.
   * @param {string} artifactId
   * @param {number} fee
   * @returns {Promise<object>}
   */
  async requestVerification(artifactId, fee) {
    return this._request('POST', '/verify/request', null, {
      artifact_id: artifactId,
      publisher_id: this._apiKey || 'anonymous',
      fee,
    });
  }

  /**
   * Join the verifier pool.
   * @param {string} endpoint
   * @param {number} stakeAmount
   * @returns {Promise<object>}
   */
  async joinVerifierPool(endpoint, stakeAmount) {
    return this._request('POST', '/verify/pool/join', null, {
      endpoint,
      stake_amount: stakeAmount,
    });
  }

  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  /**
   * Make an HTTP request to the marketplace node.
   * @private
   */
  async _request(method, path, params = null, body = null) {
    let url = `${this._baseUrl}${path}`;

    // Append query parameters
    if (params && Object.keys(params).length > 0) {
      const qs = new URLSearchParams();
      for (const [key, val] of Object.entries(params)) {
        if (val !== undefined && val !== null) {
          qs.append(key, String(val));
        }
      }
      url += `?${qs.toString()}`;
    }

    const headers = {
      'User-Agent': 'agent-marketplace-sdk/0.1.0',
    };
    if (this._apiKey) {
      headers['x-api-key'] = this._apiKey;
    }

    const fetchOpts = { method, headers };
    if (body !== null) {
      headers['Content-Type'] = 'application/json';
      fetchOpts.body = JSON.stringify(body);
    }

    // Timeout via AbortController
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this._timeout);
    fetchOpts.signal = controller.signal;

    let resp;
    try {
      resp = await fetch(url, fetchOpts);
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        throw new NetworkError(`Request to ${url} timed out after ${this._timeout}ms`);
      }
      throw new NetworkError(`Cannot reach marketplace at ${this._baseUrl}: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }

    // Parse response
    let responseBody;
    try {
      responseBody = await resp.json();
    } catch {
      responseBody = null;
    }

    // Handle error status codes
    if (resp.status === 401 || resp.status === 403) {
      throw new AuthError(
        `Auth error ${resp.status}: ${path}`,
        resp.status,
        responseBody
      );
    }
    if (resp.status === 404) {
      throw new NotFoundError(
        `Not found: ${path}`,
        responseBody
      );
    }
    if (resp.status >= 500) {
      throw new ServerError(
        `Server error ${resp.status}: ${path}`,
        resp.status,
        responseBody
      );
    }
    if (resp.status >= 400) {
      const msg = (responseBody && responseBody.error) || `Request failed with ${resp.status}`;
      throw new MarketplaceError(msg, resp.status, responseBody);
    }

    // Unwrap { success, data, error } envelope
    if (responseBody && typeof responseBody === 'object' && 'data' in responseBody && 'success' in responseBody) {
      return responseBody.data !== null && responseBody.data !== undefined ? responseBody.data : {};
    }
    return responseBody || {};
  }
}

module.exports = { Marketplace };
