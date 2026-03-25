'use strict';

const path = require('path');
const fs = require('fs');

// Use a separate test database
const TEST_DB_PATH = path.join(__dirname, '..', 'data', 'test-access-control.db');
process.env.DB_PATH = TEST_DB_PATH;
process.env.LOG_LEVEL = 'error';

const { build } = require('../src/server');

const BASE_URL = 'http://127.0.0.1';
let app;
let port;

// ---- Helpers ----

async function req(method, urlPath, body, apiKey) {
  const opts = {
    method,
    headers: {},
  };
  if (apiKey) opts.headers['x-api-key'] = apiKey;
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}:${port}${urlPath}`, opts);
  const data = await res.json();
  return { status: res.status, body: data };
}

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL: ${name} — ${err.message}`);
    failed++;
  }
}

// ---- Register nodes to get API keys ----

async function registerNode(name) {
  const r = await req('POST', '/nodes/register', {
    name,
    endpoint: `http://${name}.example.com:3000`,
  });
  return r.body.data;
}

// ---- Tests ----

async function main() {
  // Clean up old test DB
  try { fs.unlinkSync(TEST_DB_PATH); } catch (e) { /* fine */ }

  console.log('Building server...');
  app = await build();

  await new Promise((resolve, reject) => {
    app.listen({ port: 0, host: '127.0.0.1' }, (err, address) => {
      if (err) return reject(err);
      port = parseInt(new URL(address).port, 10);
      console.log(`Server listening on port ${port}\n`);
      resolve();
    });
  });

  // Register nodes to get real API keys
  const nodeA = await registerNode('node-a');
  const nodeB = await registerNode('node-b');
  const nodeC = await registerNode('node-c');
  const keyA = nodeA.api_key;
  const keyB = nodeB.api_key;
  const keyC = nodeC.api_key;

  console.log('\n--- Public Content (default) ---');

  await test('Public content is accessible by everyone', async () => {
    const pub = await req('POST', '/publish/content', {
      url: 'https://public.example.com/page1',
      source_hash: 'hash_public_1',
      content_text: 'Public content body',
    }, keyA);
    assertEqual(pub.status, 201, 'publish status');

    // Fetch without any key
    const fetchNoKey = await req('GET', '/fetch?url=https://public.example.com/page1');
    assertEqual(fetchNoKey.status, 200, 'fetch no key status');
    assertEqual(fetchNoKey.body.data.content_text, 'Public content body', 'content matches');

    // Fetch with key B
    const fetchKeyB = await req('GET', '/fetch?url=https://public.example.com/page1', null, keyB);
    assertEqual(fetchKeyB.status, 200, 'fetch key B status');

    // Check without key
    const checkNoKey = await req('GET', '/check?url=https://public.example.com/page1');
    assertEqual(checkNoKey.body.data.available, true, 'check available');
  });

  console.log('\n--- Private Content ---');

  let privateContentId;
  await test('Publish private content with key A', async () => {
    const pub = await req('POST', '/publish/content', {
      url: 'https://private.example.com/secret',
      source_hash: 'hash_private_1',
      content_text: 'Private content body',
      visibility: 'private',
    }, keyA);
    assertEqual(pub.status, 201, 'publish status');
    assertEqual(pub.body.data.visibility, 'private', 'visibility set');
    privateContentId = pub.body.data.id;
  });

  await test('Fetch private content with owner key A succeeds', async () => {
    const r = await req('GET', '/fetch?url=https://private.example.com/secret', null, keyA);
    assertEqual(r.status, 200, 'fetch status');
    assertEqual(r.body.data.content_text, 'Private content body', 'content matches');
  });

  await test('Fetch private content with key B fails (404)', async () => {
    const r = await req('GET', '/fetch?url=https://private.example.com/secret', null, keyB);
    assertEqual(r.status, 404, 'fetch status');
  });

  await test('Fetch private content without any key fails (404)', async () => {
    const r = await req('GET', '/fetch?url=https://private.example.com/secret');
    assertEqual(r.status, 404, 'fetch status');
  });

  await test('Check private content with key B shows not available', async () => {
    const r = await req('GET', '/check?url=https://private.example.com/secret', null, keyB);
    assertEqual(r.body.data.available, false, 'not available');
  });

  await test('Check private content with owner key A shows available', async () => {
    const r = await req('GET', '/check?url=https://private.example.com/secret', null, keyA);
    assertEqual(r.body.data.available, true, 'available');
  });

  console.log('\n--- Whitelist Content ---');

  let whitelistContentId;
  await test('Publish whitelist content with key A, whitelist key B', async () => {
    const pub = await req('POST', '/publish/content', {
      url: 'https://whitelist.example.com/shared',
      source_hash: 'hash_whitelist_1',
      content_text: 'Whitelist content body',
      visibility: 'whitelist',
      authorized_keys: [keyB],
    }, keyA);
    assertEqual(pub.status, 201, 'publish status');
    assertEqual(pub.body.data.visibility, 'whitelist', 'visibility set');
    whitelistContentId = pub.body.data.id;
  });

  await test('Fetch whitelist content with owner key A succeeds', async () => {
    const r = await req('GET', '/fetch?url=https://whitelist.example.com/shared', null, keyA);
    assertEqual(r.status, 200, 'fetch status');
  });

  await test('Fetch whitelist content with whitelisted key B succeeds', async () => {
    const r = await req('GET', '/fetch?url=https://whitelist.example.com/shared', null, keyB);
    assertEqual(r.status, 200, 'fetch status');
    assertEqual(r.body.data.content_text, 'Whitelist content body', 'content matches');
  });

  await test('Fetch whitelist content with key C fails (404)', async () => {
    const r = await req('GET', '/fetch?url=https://whitelist.example.com/shared', null, keyC);
    assertEqual(r.status, 404, 'fetch status');
  });

  await test('Fetch whitelist content without any key fails (404)', async () => {
    const r = await req('GET', '/fetch?url=https://whitelist.example.com/shared');
    assertEqual(r.status, 404, 'fetch status');
  });

  console.log('\n--- Search Access Control ---');

  await test('Search returns only accessible content', async () => {
    // Key C should only see public content, not private or whitelist
    const r = await req('GET', '/search?q=content+body', null, keyC);
    assertEqual(r.status, 200, 'search status');
    const urls = r.body.data.results.map(r => r.url);
    assert(urls.includes('https://public.example.com/page1'), 'public visible');
    assert(!urls.includes('https://private.example.com/secret'), 'private not visible');
    assert(!urls.includes('https://whitelist.example.com/shared'), 'whitelist not visible to C');
  });

  await test('Search with key B sees public and whitelisted content', async () => {
    const r = await req('GET', '/search?q=content+body', null, keyB);
    assertEqual(r.status, 200, 'search status');
    const urls = r.body.data.results.map(r => r.url);
    assert(urls.includes('https://public.example.com/page1'), 'public visible');
    assert(urls.includes('https://whitelist.example.com/shared'), 'whitelist visible to B');
    assert(!urls.includes('https://private.example.com/secret'), 'private not visible to B');
  });

  await test('Search with key A sees all own content', async () => {
    const r = await req('GET', '/search?q=content+body', null, keyA);
    assertEqual(r.status, 200, 'search status');
    const urls = r.body.data.results.map(r => r.url);
    assert(urls.includes('https://public.example.com/page1'), 'public visible');
    assert(urls.includes('https://private.example.com/secret'), 'private visible to owner');
    assert(urls.includes('https://whitelist.example.com/shared'), 'whitelist visible to owner');
  });

  console.log('\n--- Whitelist Management ---');

  await test('Owner can list whitelist', async () => {
    const r = await req('GET', `/content/${whitelistContentId}/whitelist`, null, keyA);
    assertEqual(r.status, 200, 'list status');
    assert(Array.isArray(r.body.data), 'data is array');
    assert(r.body.data.includes(keyB), 'key B in whitelist');
  });

  await test('Non-owner cannot list whitelist', async () => {
    const r = await req('GET', `/content/${whitelistContentId}/whitelist`, null, keyB);
    assertEqual(r.status, 403, 'forbidden');
  });

  await test('Owner can add key C to whitelist', async () => {
    const r = await req('POST', `/content/${whitelistContentId}/whitelist`, { key: keyC }, keyA);
    assertEqual(r.status, 200, 'add status');

    // Now key C can fetch
    const fetch = await req('GET', '/fetch?url=https://whitelist.example.com/shared', null, keyC);
    assertEqual(fetch.status, 200, 'fetch with newly added key');
  });

  await test('Owner can remove key C from whitelist', async () => {
    const r = await req('DELETE', `/content/${whitelistContentId}/whitelist/${keyC}`, null, keyA);
    assertEqual(r.status, 200, 'remove status');

    // Now key C cannot fetch again
    const fetch = await req('GET', '/fetch?url=https://whitelist.example.com/shared', null, keyC);
    assertEqual(fetch.status, 404, 'fetch fails after removal');
  });

  await test('Non-owner cannot add to whitelist', async () => {
    const r = await req('POST', `/content/${whitelistContentId}/whitelist`, { key: keyC }, keyB);
    assertEqual(r.status, 403, 'forbidden');
  });

  console.log('\n--- Artifact Access Control ---');

  await test('Publish private artifact with key A', async () => {
    const pub = await req('POST', '/publish/artifact', {
      name: 'Private Tool',
      slug: 'private-tool',
      category: 'tool',
      description: 'A private tool',
      visibility: 'private',
    }, keyA);
    assertEqual(pub.status, 201, 'publish status');
    assertEqual(pub.body.data.visibility, 'private', 'visibility set');
  });

  await test('Owner can get private artifact', async () => {
    const r = await req('GET', '/artifacts/private-tool', null, keyA);
    assertEqual(r.status, 200, 'get status');
  });

  await test('Non-owner cannot get private artifact', async () => {
    const r = await req('GET', '/artifacts/private-tool', null, keyB);
    assertEqual(r.status, 404, 'not found');
  });

  await test('Non-owner cannot download private artifact', async () => {
    const r = await req('GET', '/artifacts/private-tool/download', null, keyB);
    assertEqual(r.status, 404, 'not found');
  });

  let whitelistArtifactId;
  await test('Publish whitelist artifact with key A, whitelist key B', async () => {
    const pub = await req('POST', '/publish/artifact', {
      name: 'Shared Tool',
      slug: 'shared-tool',
      category: 'tool',
      description: 'A shared tool',
      visibility: 'whitelist',
      authorized_keys: [keyB],
    }, keyA);
    assertEqual(pub.status, 201, 'publish status');
    whitelistArtifactId = pub.body.data.id;
  });

  await test('Whitelisted key B can get artifact', async () => {
    const r = await req('GET', '/artifacts/shared-tool', null, keyB);
    assertEqual(r.status, 200, 'get status');
  });

  await test('Non-whitelisted key C cannot get artifact', async () => {
    const r = await req('GET', '/artifacts/shared-tool', null, keyC);
    assertEqual(r.status, 404, 'not found');
  });

  console.log('\n--- Artifact Whitelist Management ---');

  await test('Owner can manage artifact whitelist', async () => {
    // Add key C
    const add = await req('POST', `/artifacts/${whitelistArtifactId}/whitelist`, { key: keyC }, keyA);
    assertEqual(add.status, 200, 'add status');

    // Key C can now get it
    const get = await req('GET', '/artifacts/shared-tool', null, keyC);
    assertEqual(get.status, 200, 'get with added key');

    // List whitelist
    const list = await req('GET', `/artifacts/${whitelistArtifactId}/whitelist`, null, keyA);
    assertEqual(list.status, 200, 'list status');
    assert(list.body.data.includes(keyB), 'key B in list');
    assert(list.body.data.includes(keyC), 'key C in list');

    // Remove key C
    const remove = await req('DELETE', `/artifacts/${whitelistArtifactId}/whitelist/${keyC}`, null, keyA);
    assertEqual(remove.status, 200, 'remove status');

    // Key C can no longer get it
    const getFail = await req('GET', '/artifacts/shared-tool', null, keyC);
    assertEqual(getFail.status, 404, 'get fails after removal');
  });

  console.log('\n--- Visibility Validation ---');

  await test('Invalid visibility value is rejected', async () => {
    const r = await req('POST', '/publish/content', {
      url: 'https://invalid.example.com/bad',
      source_hash: 'hash_bad',
      content_text: 'Bad visibility',
      visibility: 'invalid',
    }, keyA);
    assertEqual(r.status, 400, 'bad request');
  });

  await test('Default visibility is public', async () => {
    const r = await req('POST', '/publish/content', {
      url: 'https://default.example.com/page',
      source_hash: 'hash_default',
      content_text: 'Default visibility',
    }, keyA);
    assertEqual(r.status, 201, 'publish status');
    assertEqual(r.body.data.visibility, 'public', 'default is public');
  });

  // Cleanup
  await app.close();
  try { fs.unlinkSync(TEST_DB_PATH); } catch (e) { /* fine */ }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  if (failed === 0) {
    console.log('ALL ACCESS CONTROL TESTS PASSED');
  } else {
    console.log(`${failed} TEST(S) FAILED`);
  }
  console.log(`========================================\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
