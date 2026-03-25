'use strict';

/**
 * SDK-side in-memory cache with TTL.
 *
 * Stores ContentRecord objects keyed by URL. Entries expire after
 * ttlMs (default 4 hours). Stale entries can still be retrieved
 * explicitly for graceful degradation when the marketplace is unavailable.
 */
class LocalCache {
  /**
   * @param {number} ttlMs - Time-to-live in milliseconds (default 4 hours).
   */
  constructor(ttlMs = 4 * 60 * 60 * 1000) {
    this._ttl = ttlMs;
    this._store = new Map(); // url -> { record, cachedAt }
  }

  /**
   * Get cached content if fresh enough.
   * @param {string} url
   * @returns {*} The cached record if fresh, or null.
   */
  get(url) {
    const entry = this._store.get(url);
    if (!entry) return null;
    if (!this._isFresh(entry)) return null;
    return entry.record;
  }

  /**
   * Get cached content even if expired (for graceful degradation).
   * @param {string} url
   * @returns {*} The cached record regardless of age, or null if never cached.
   */
  getStale(url) {
    const entry = this._store.get(url);
    if (!entry) return null;
    return entry.record;
  }

  /**
   * Cache content locally.
   * @param {string} url
   * @param {*} content - The record to cache.
   */
  put(url, content) {
    this._store.set(url, {
      record: content,
      cachedAt: Date.now(),
    });
  }

  /**
   * Check if cached entry is still fresh.
   * @param {string} url
   * @returns {boolean}
   */
  isFresh(url) {
    const entry = this._store.get(url);
    if (!entry) return false;
    return this._isFresh(entry);
  }

  /**
   * Remove a specific entry from the cache.
   * @param {string} url
   */
  invalidate(url) {
    this._store.delete(url);
  }

  /**
   * Remove all entries from the cache.
   */
  clear() {
    this._store.clear();
  }

  /**
   * Return the number of entries in the cache.
   * @returns {number}
   */
  get size() {
    return this._store.size;
  }

  /**
   * @private
   */
  _isFresh(entry) {
    return (Date.now() - entry.cachedAt) < this._ttl;
  }
}

module.exports = { LocalCache };
