'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { Marketplace, ContentRecord, ArtifactRecord, LocalCache } = require('../src/index');
const { MarketplaceError, NetworkError, NotFoundError, ServerError, AuthError } = require('../src/errors');

// ---------------------------------------------------------------------------
// Mock fetch helper
// ---------------------------------------------------------------------------
const originalFetch = global.fetch;

function mockFetch(handler) {
  global.fetch = async (url, opts) => {
    const result = await handler(url, opts);
    return {
      status: result.status || 200,
      json: async () => result.body,
    };
  };
}

function mockFetchReject(error) {
  global.fetch = async () => { throw error; };
}

// ---------------------------------------------------------------------------
// Construction tests
// ---------------------------------------------------------------------------
describe('Marketplace construction', () => {
  afterEach(() => { global.fetch = originalFetch; });

  it('uses default URL', () => {
    const mp = new Marketplace();
    assert.equal(mp._baseUrl, 'http://localhost:3000');
  });

  it('accepts custom URL', () => {
    const mp = new Marketplace('http://example.com:8080');
    assert.equal(mp._baseUrl, 'http://example.com:8080');
  });

  it('strips trailing slashes from URL', () => {
    const mp = new Marketplace('http://example.com/');
    assert.equal(mp._baseUrl, 'http://example.com');
  });

  it('stores API key', () => {
    const mp = new Marketplace('http://localhost:3000', { apiKey: 'test-key' });
    assert.equal(mp._apiKey, 'test-key');
  });

  it('defaults API key to null', () => {
    const mp = new Marketplace();
    assert.equal(mp._apiKey, null);
  });
});

// ---------------------------------------------------------------------------
// check() tests
// ---------------------------------------------------------------------------
describe('check()', () => {
  afterEach(() => { global.fetch = originalFetch; });

  it('returns availability info for available content', async () => {
    mockFetch((url) => {
      assert.ok(url.includes('/check'));
      assert.ok(url.includes('url='));
      return {
        body: { success: true, data: { available: true, price: 0.5, freshness: '2h', providers: 3 }, error: null },
      };
    });
    const mp = new Marketplace();
    const result = await mp.check('https://example.com');
    assert.equal(result.available, true);
    assert.equal(result.price, 0.5);
    assert.equal(result.providers, 3);
  });

  it('returns unavailable status', async () => {
    mockFetch(() => ({
      body: { success: true, data: { available: false, price: 0, freshness: null, providers: 0 }, error: null },
    }));
    const mp = new Marketplace();
    const result = await mp.check('https://missing.com');
    assert.equal(result.available, false);
  });
});

// ---------------------------------------------------------------------------
// fetch() tests
// ---------------------------------------------------------------------------
describe('fetch()', () => {
  afterEach(() => { global.fetch = originalFetch; });

  it('returns ContentRecord from server response', async () => {
    mockFetch(() => ({
      body: {
        success: true,
        data: {
          url: 'https://example.com',
          source_hash: 'abc123',
          fetched_at: '2026-01-01T00:00:00Z',
          content_text: 'Hello world',
          content_structured: '{"headings":[]}',
          content_links: '["https://link.com"]',
          content_metadata: '{"title":"Test"}',
          price: 0.5,
          token_cost_saved: 100,
        },
        error: null,
      },
    }));
    const mp = new Marketplace();
    const record = await mp.fetch('https://example.com');
    assert.ok(record instanceof ContentRecord);
    assert.equal(record.text, 'Hello world');
    assert.equal(record.url, 'https://example.com');
    assert.equal(record.price, 0.5);
  });

  it('returns cached content on second call', async () => {
    let fetchCount = 0;
    mockFetch(() => {
      fetchCount++;
      return {
        body: {
          success: true,
          data: { url: 'https://example.com', content_text: 'Cached content', price: 0.5 },
          error: null,
        },
      };
    });
    const mp = new Marketplace();
    await mp.fetch('https://example.com');
    await mp.fetch('https://example.com');
    assert.equal(fetchCount, 1); // Only one network call
  });
});

// ---------------------------------------------------------------------------
// publishContent() tests
// ---------------------------------------------------------------------------
describe('publishContent()', () => {
  afterEach(() => { global.fetch = originalFetch; });

  it('sends correct request body and headers', async () => {
    let capturedBody, capturedHeaders;
    mockFetch((url, opts) => {
      capturedBody = JSON.parse(opts.body);
      capturedHeaders = opts.headers;
      return {
        status: 201,
        body: { success: true, data: { id: 1, status: 'published' }, error: null },
      };
    });
    const mp = new Marketplace('http://localhost:3000', { apiKey: 'my-key' });
    await mp.publishContent(
      'https://example.com',
      { text: 'Clean text', structured: { h: 1 }, links: ['a'], metadata: { title: 'T' } },
      0.5,
      100
    );
    assert.equal(capturedBody.url, 'https://example.com');
    assert.equal(capturedBody.content_text, 'Clean text');
    assert.equal(capturedBody.price, 0.5);
    assert.equal(capturedBody.token_cost_saved, 100);
    assert.ok(capturedBody.source_hash); // Should have a hash
    assert.equal(capturedHeaders['x-api-key'], 'my-key');
    assert.equal(capturedHeaders['Content-Type'], 'application/json');
  });
});

// ---------------------------------------------------------------------------
// search() tests
// ---------------------------------------------------------------------------
describe('search()', () => {
  afterEach(() => { global.fetch = originalFetch; });

  it('sends query with filters', async () => {
    let capturedUrl;
    mockFetch((url) => {
      capturedUrl = url;
      return {
        body: { success: true, data: { results: [{ name: 'result1' }], total: 1 }, error: null },
      };
    });
    const mp = new Marketplace();
    const results = await mp.search('test query', { type: 'artifact', category: 'tool', sort: 'price' });
    assert.ok(capturedUrl.includes('q=test+query'));
    assert.ok(capturedUrl.includes('type=artifact'));
    assert.ok(capturedUrl.includes('category=tool'));
    assert.ok(capturedUrl.includes('sort=price'));
    assert.equal(results.length, 1);
    assert.equal(results[0].name, 'result1');
  });

  it('handles empty results', async () => {
    mockFetch(() => ({
      body: { success: true, data: { results: [], total: 0 }, error: null },
    }));
    const mp = new Marketplace();
    const results = await mp.search('nonexistent');
    assert.deepEqual(results, []);
  });

  it('passes budget and maxAge filters', async () => {
    let capturedUrl;
    mockFetch((url) => {
      capturedUrl = url;
      return { body: { success: true, data: { results: [] }, error: null } };
    });
    const mp = new Marketplace();
    await mp.search('test', { budget: 1.5, maxAge: '7d' });
    assert.ok(capturedUrl.includes('budget=1.5'));
    assert.ok(capturedUrl.includes('max_age=7d'));
  });
});

// ---------------------------------------------------------------------------
// searchBest() tests
// ---------------------------------------------------------------------------
describe('searchBest()', () => {
  afterEach(() => { global.fetch = originalFetch; });

  it('returns first result', async () => {
    mockFetch(() => ({
      body: { success: true, data: { results: [{ name: 'best' }, { name: 'second' }] }, error: null },
    }));
    const mp = new Marketplace();
    const best = await mp.searchBest('query');
    assert.equal(best.name, 'best');
  });

  it('returns null when no results', async () => {
    mockFetch(() => ({
      body: { success: true, data: { results: [] }, error: null },
    }));
    const mp = new Marketplace();
    const best = await mp.searchBest('nothing');
    assert.equal(best, null);
  });
});

// ---------------------------------------------------------------------------
// smartFetch() tests
// ---------------------------------------------------------------------------
describe('smartFetch()', () => {
  afterEach(() => { global.fetch = originalFetch; });

  it('returns cached content without network call', async () => {
    const mp = new Marketplace();
    const record = new ContentRecord({ url: 'https://cached.com', text: 'from cache' });
    mp._cache.put('https://cached.com', record);

    let fetchCalled = false;
    mockFetch(() => { fetchCalled = true; return { body: {} }; });

    const result = await mp.smartFetch('https://cached.com');
    assert.equal(result.text, 'from cache');
    assert.equal(fetchCalled, false);
  });

  it('fetches from marketplace when not cached and available', async () => {
    let callIndex = 0;
    mockFetch((url) => {
      callIndex++;
      if (url.includes('/check')) {
        return { body: { success: true, data: { available: true, price: 0.5 }, error: null } };
      }
      if (url.includes('/fetch')) {
        return { body: { success: true, data: { url: 'https://example.com', content_text: 'fetched' }, error: null } };
      }
      return { body: {} };
    });
    const mp = new Marketplace();
    const result = await mp.smartFetch('https://example.com');
    assert.ok(result);
    assert.equal(result.text, 'fetched');
  });

  it('returns null when not available', async () => {
    mockFetch(() => ({
      body: { success: true, data: { available: false }, error: null },
    }));
    const mp = new Marketplace();
    const result = await mp.smartFetch('https://missing.com');
    assert.equal(result, null);
  });

  it('returns null when price exceeds maxPrice', async () => {
    mockFetch(() => ({
      body: { success: true, data: { available: true, price: 10 }, error: null },
    }));
    const mp = new Marketplace();
    const result = await mp.smartFetch('https://expensive.com', { maxPrice: 1 });
    assert.equal(result, null);
  });

  it('serves stale cache on network error', async () => {
    const mp = new Marketplace();
    const record = new ContentRecord({ url: 'https://stale.com', text: 'stale content' });
    // Put in cache then expire it by manipulating the internal store
    mp._cache.put('https://stale.com', record);
    mp._cache._store.get('https://stale.com').cachedAt = 0; // Force expiry

    mockFetchReject(new TypeError('fetch failed'));

    const result = await mp.smartFetch('https://stale.com');
    assert.ok(result);
    assert.equal(result.text, 'stale content');
  });
});

// ---------------------------------------------------------------------------
// Artifact operations tests
// ---------------------------------------------------------------------------
describe('publishArtifact()', () => {
  afterEach(() => { global.fetch = originalFetch; });

  it('sends correct payload with auto-generated slug', async () => {
    let capturedBody;
    mockFetch((url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return {
        status: 201,
        body: { success: true, data: { slug: 'my-tool', status: 'created' }, error: null },
      };
    });
    const mp = new Marketplace();
    await mp.publishArtifact('My Tool', 'A useful tool', 'tool', ['index.js'], 1.0, { tags: ['js'] });
    assert.equal(capturedBody.name, 'My Tool');
    assert.equal(capturedBody.slug, 'my-tool');
    assert.equal(capturedBody.category, 'tool');
    assert.deepEqual(capturedBody.files, ['index.js']);
    assert.deepEqual(capturedBody.tags, ['js']);
  });

  it('uses custom slug when provided', async () => {
    let capturedBody;
    mockFetch((url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { status: 201, body: { success: true, data: {}, error: null } };
    });
    const mp = new Marketplace();
    await mp.publishArtifact('My Tool', 'desc', 'tool', [], 1.0, { slug: 'custom-slug' });
    assert.equal(capturedBody.slug, 'custom-slug');
  });
});

describe('getArtifact()', () => {
  afterEach(() => { global.fetch = originalFetch; });

  it('returns ArtifactRecord', async () => {
    mockFetch(() => ({
      body: {
        success: true,
        data: { slug: 'my-tool', name: 'My Tool', category: 'tool', price: 1.0, files: '["a.js"]' },
        error: null,
      },
    }));
    const mp = new Marketplace();
    const artifact = await mp.getArtifact('my-tool');
    assert.ok(artifact instanceof ArtifactRecord);
    assert.equal(artifact.slug, 'my-tool');
    assert.equal(artifact.name, 'My Tool');
    assert.deepEqual(artifact.files, ['a.js']);
  });
});

describe('downloadArtifact()', () => {
  afterEach(() => { global.fetch = originalFetch; });

  it('returns download info', async () => {
    mockFetch(() => ({
      body: {
        success: true,
        data: { download_url: '/files/my-tool.zip', files: ['a.js'], price_charged: 1.0 },
        error: null,
      },
    }));
    const mp = new Marketplace();
    const result = await mp.downloadArtifact('my-tool');
    assert.equal(result.price_charged, 1.0);
  });
});

// ---------------------------------------------------------------------------
// Market Intelligence tests
// ---------------------------------------------------------------------------
describe('trending()', () => {
  afterEach(() => { global.fetch = originalFetch; });

  it('sends correct period parameter', async () => {
    let capturedUrl;
    mockFetch((url) => {
      capturedUrl = url;
      return { body: { success: true, data: { trending_searches: [] }, error: null } };
    });
    const mp = new Marketplace();
    await mp.trending('30d');
    assert.ok(capturedUrl.includes('period=30d'));
  });

  it('defaults to 7d period', async () => {
    let capturedUrl;
    mockFetch((url) => {
      capturedUrl = url;
      return { body: { success: true, data: {}, error: null } };
    });
    const mp = new Marketplace();
    await mp.trending();
    assert.ok(capturedUrl.includes('period=7d'));
  });
});

describe('gaps()', () => {
  afterEach(() => { global.fetch = originalFetch; });

  it('returns gap data', async () => {
    mockFetch(() => ({
      body: { success: true, data: { gaps: [{ query: 'missing data', search_count: 10 }] }, error: null },
    }));
    const mp = new Marketplace();
    const gaps = await mp.gaps();
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].query, 'missing data');
  });

  it('passes category filter', async () => {
    let capturedUrl;
    mockFetch((url) => {
      capturedUrl = url;
      return { body: { success: true, data: { gaps: [] }, error: null } };
    });
    const mp = new Marketplace();
    await mp.gaps('tool');
    assert.ok(capturedUrl.includes('category=tool'));
  });
});

// ---------------------------------------------------------------------------
// Cache tests
// ---------------------------------------------------------------------------
describe('LocalCache', () => {
  it('stores and retrieves entries', () => {
    const cache = new LocalCache();
    const record = new ContentRecord({ url: 'https://test.com', text: 'hello' });
    cache.put('https://test.com', record);
    const result = cache.get('https://test.com');
    assert.equal(result.text, 'hello');
  });

  it('returns null for missing entries', () => {
    const cache = new LocalCache();
    assert.equal(cache.get('https://missing.com'), null);
  });

  it('expires entries after TTL', () => {
    const cache = new LocalCache(100); // 100ms TTL
    const record = new ContentRecord({ url: 'https://test.com', text: 'hello' });
    cache.put('https://test.com', record);
    // Force expiry
    cache._store.get('https://test.com').cachedAt = Date.now() - 200;
    assert.equal(cache.get('https://test.com'), null);
  });

  it('getStale returns expired entries', () => {
    const cache = new LocalCache(100);
    const record = new ContentRecord({ url: 'https://test.com', text: 'stale' });
    cache.put('https://test.com', record);
    cache._store.get('https://test.com').cachedAt = 0; // Force expiry
    assert.equal(cache.get('https://test.com'), null);
    const stale = cache.getStale('https://test.com');
    assert.equal(stale.text, 'stale');
  });

  it('getStale returns null for never-cached entries', () => {
    const cache = new LocalCache();
    assert.equal(cache.getStale('https://never.com'), null);
  });

  it('isFresh works correctly', () => {
    const cache = new LocalCache(1000);
    assert.equal(cache.isFresh('https://test.com'), false);
    cache.put('https://test.com', new ContentRecord({ url: 'https://test.com' }));
    assert.equal(cache.isFresh('https://test.com'), true);
    cache._store.get('https://test.com').cachedAt = 0;
    assert.equal(cache.isFresh('https://test.com'), false);
  });

  it('invalidate removes entry', () => {
    const cache = new LocalCache();
    cache.put('https://test.com', new ContentRecord({ url: 'https://test.com' }));
    assert.equal(cache.size, 1);
    cache.invalidate('https://test.com');
    assert.equal(cache.size, 0);
    assert.equal(cache.get('https://test.com'), null);
  });

  it('clear removes all entries', () => {
    const cache = new LocalCache();
    cache.put('https://a.com', new ContentRecord({ url: 'a' }));
    cache.put('https://b.com', new ContentRecord({ url: 'b' }));
    assert.equal(cache.size, 2);
    cache.clear();
    assert.equal(cache.size, 0);
  });
});

// ---------------------------------------------------------------------------
// Model tests
// ---------------------------------------------------------------------------
describe('ContentRecord', () => {
  it('fromResponse handles server-style keys', () => {
    const r = ContentRecord.fromResponse({
      url: 'https://test.com',
      content_text: 'hello',
      content_structured: '{"h":1}',
      content_links: '["a"]',
      content_metadata: '{"title":"T"}',
      price: '0.5',
    });
    assert.equal(r.text, 'hello');
    assert.deepEqual(r.structured, { h: 1 });
    assert.deepEqual(r.links, ['a']);
    assert.deepEqual(r.metadata, { title: 'T' });
    assert.equal(r.price, 0.5);
  });

  it('toJSON returns snake_case keys', () => {
    const r = new ContentRecord({ url: 'u', text: 't', sourceHash: 'h', tokenCostSaved: 5 });
    const json = r.toJSON();
    assert.equal(json.source_hash, 'h');
    assert.equal(json.token_cost_saved, 5);
  });
});

describe('ArtifactRecord', () => {
  it('fromResponse handles JSON-encoded lists', () => {
    const r = ArtifactRecord.fromResponse({
      slug: 's',
      name: 'n',
      tags: '["a","b"]',
      files: '["x.js"]',
    });
    assert.deepEqual(r.tags, ['a', 'b']);
    assert.deepEqual(r.files, ['x.js']);
  });

  it('toJSON serializes correctly', () => {
    const r = new ArtifactRecord({ slug: 's', name: 'n', price: 1 });
    const json = r.toJSON();
    assert.equal(json.slug, 's');
    assert.equal(json.price, 1);
  });
});

// ---------------------------------------------------------------------------
// Error handling tests
// ---------------------------------------------------------------------------
describe('Error handling', () => {
  afterEach(() => { global.fetch = originalFetch; });

  it('throws NetworkError when server unreachable', async () => {
    mockFetchReject(new TypeError('fetch failed'));
    const mp = new Marketplace();
    await assert.rejects(() => mp.check('https://test.com'), (err) => {
      assert.ok(err instanceof NetworkError);
      return true;
    });
  });

  it('throws NotFoundError on 404', async () => {
    mockFetch(() => ({
      status: 404,
      body: { success: false, data: null, error: 'Not found' },
    }));
    const mp = new Marketplace();
    await assert.rejects(() => mp.fetch('https://missing.com'), (err) => {
      assert.ok(err instanceof NotFoundError);
      assert.equal(err.statusCode, 404);
      return true;
    });
  });

  it('throws ServerError on 500', async () => {
    mockFetch(() => ({
      status: 500,
      body: { success: false, data: null, error: 'Internal error' },
    }));
    const mp = new Marketplace();
    await assert.rejects(() => mp.check('https://test.com'), (err) => {
      assert.ok(err instanceof ServerError);
      assert.equal(err.statusCode, 500);
      return true;
    });
  });

  it('throws AuthError on 401', async () => {
    mockFetch(() => ({
      status: 401,
      body: { success: false, data: null, error: 'Unauthorized' },
    }));
    const mp = new Marketplace();
    await assert.rejects(() => mp.publishContent('u', {}, 1, 1), (err) => {
      assert.ok(err instanceof AuthError);
      assert.equal(err.statusCode, 401);
      return true;
    });
  });

  it('throws AuthError on 403', async () => {
    mockFetch(() => ({
      status: 403,
      body: { success: false, data: null, error: 'Forbidden' },
    }));
    const mp = new Marketplace();
    await assert.rejects(() => mp.check('https://test.com'), (err) => {
      assert.ok(err instanceof AuthError);
      assert.equal(err.statusCode, 403);
      return true;
    });
  });

  it('throws MarketplaceError on other 4xx', async () => {
    mockFetch(() => ({
      status: 429,
      body: { success: false, data: null, error: 'Rate limited' },
    }));
    const mp = new Marketplace();
    await assert.rejects(() => mp.check('https://test.com'), (err) => {
      assert.ok(err instanceof MarketplaceError);
      assert.equal(err.statusCode, 429);
      return true;
    });
  });
});

// ---------------------------------------------------------------------------
// Verification tests
// ---------------------------------------------------------------------------
describe('requestVerification()', () => {
  afterEach(() => { global.fetch = originalFetch; });

  it('sends correct payload', async () => {
    let capturedBody;
    mockFetch((url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { status: 201, body: { success: true, data: { request: { id: 1 } }, error: null } };
    });
    const mp = new Marketplace('http://localhost:3000', { apiKey: 'pub-123' });
    await mp.requestVerification('art-1', 5);
    assert.equal(capturedBody.artifact_id, 'art-1');
    assert.equal(capturedBody.fee, 5);
  });
});

describe('joinVerifierPool()', () => {
  afterEach(() => { global.fetch = originalFetch; });

  it('sends correct payload', async () => {
    let capturedBody;
    mockFetch((url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { status: 201, body: { success: true, data: { id: 'v1' }, error: null } };
    });
    const mp = new Marketplace();
    await mp.joinVerifierPool('http://verifier.com', 10);
    assert.equal(capturedBody.endpoint, 'http://verifier.com');
    assert.equal(capturedBody.stake_amount, 10);
  });
});

// ---------------------------------------------------------------------------
// API key header tests
// ---------------------------------------------------------------------------
describe('API key in headers', () => {
  afterEach(() => { global.fetch = originalFetch; });

  it('includes x-api-key when provided', async () => {
    let capturedHeaders;
    mockFetch((url, opts) => {
      capturedHeaders = opts.headers;
      return { body: { success: true, data: { available: true }, error: null } };
    });
    const mp = new Marketplace('http://localhost:3000', { apiKey: 'secret' });
    await mp.check('https://test.com');
    assert.equal(capturedHeaders['x-api-key'], 'secret');
  });

  it('omits x-api-key when not provided', async () => {
    let capturedHeaders;
    mockFetch((url, opts) => {
      capturedHeaders = opts.headers;
      return { body: { success: true, data: { available: true }, error: null } };
    });
    const mp = new Marketplace();
    await mp.check('https://test.com');
    assert.equal(capturedHeaders['x-api-key'], undefined);
  });
});
