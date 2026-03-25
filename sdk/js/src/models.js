'use strict';

/**
 * Parse a value that may be a JSON string into its native type.
 * Returns the parsed object/array, or the original value if not a string,
 * or the fallback if null/undefined.
 */
function parseJsonField(val, fallback = {}) {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'string') {
    try {
      return JSON.parse(val);
    } catch {
      return val;
    }
  }
  return val;
}

/**
 * Parse a value that should be a list, handling JSON-encoded strings.
 */
function parseListField(val) {
  if (val === null || val === undefined) return [];
  if (typeof val === 'string') {
    try {
      return JSON.parse(val);
    } catch {
      return [];
    }
  }
  return Array.isArray(val) ? val : [];
}

/**
 * Represents a clean, AI-ready version of a web page.
 */
class ContentRecord {
  constructor({ url, sourceHash, fetchedAt, text, structured, links, metadata, price, tokenCostSaved } = {}) {
    this.url = url || '';
    this.sourceHash = sourceHash || '';
    this.fetchedAt = fetchedAt || '';
    this.text = text || '';
    this.structured = structured || {};
    this.links = links || [];
    this.metadata = metadata || {};
    this.price = typeof price === 'number' ? price : parseFloat(price) || 0;
    this.tokenCostSaved = typeof tokenCostSaved === 'number' ? tokenCostSaved : parseFloat(tokenCostSaved) || 0;
  }

  /**
   * Create a ContentRecord from a server response object.
   * Handles both SDK-style keys (text, structured) and server-style keys (content_text, content_structured).
   */
  static fromResponse(data) {
    if (!data) return new ContentRecord();
    return new ContentRecord({
      url: data.url || '',
      sourceHash: data.source_hash || '',
      fetchedAt: data.fetched_at || '',
      text: data.text || data.content_text || '',
      structured: parseJsonField(data.structured || data.content_structured, {}),
      links: parseJsonField(data.links || data.content_links, []),
      metadata: parseJsonField(data.metadata || data.content_metadata, {}),
      price: parseFloat(data.price) || 0,
      tokenCostSaved: parseFloat(data.token_cost_saved) || 0,
    });
  }

  toJSON() {
    return {
      url: this.url,
      source_hash: this.sourceHash,
      fetched_at: this.fetchedAt,
      text: this.text,
      structured: this.structured,
      links: this.links,
      metadata: this.metadata,
      price: this.price,
      token_cost_saved: this.tokenCostSaved,
    };
  }
}

/**
 * Represents a build artifact in the marketplace.
 */
class ArtifactRecord {
  constructor({ slug, name, category, version, description, tags, files, price, verified } = {}) {
    this.slug = slug || '';
    this.name = name || '';
    this.category = category || '';
    this.version = version || '0.1.0';
    this.description = description || '';
    this.tags = tags || [];
    this.files = files || [];
    this.price = typeof price === 'number' ? price : parseFloat(price) || 0;
    this.verified = Boolean(verified);
  }

  /**
   * Create an ArtifactRecord from a server response object.
   * Handles JSON-encoded strings for list fields.
   */
  static fromResponse(data) {
    if (!data) return new ArtifactRecord();
    return new ArtifactRecord({
      slug: data.slug || '',
      name: data.name || '',
      category: data.category || '',
      version: data.version || '0.1.0',
      description: data.description || '',
      tags: parseListField(data.tags),
      files: parseListField(data.files),
      price: parseFloat(data.price) || 0,
      verified: Boolean(data.verified),
    });
  }

  toJSON() {
    return {
      slug: this.slug,
      name: this.name,
      category: this.category,
      version: this.version,
      description: this.description,
      tags: this.tags,
      files: this.files,
      price: this.price,
      verified: this.verified,
    };
  }
}

module.exports = { ContentRecord, ArtifactRecord };
