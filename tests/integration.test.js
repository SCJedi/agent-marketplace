'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Use a separate test database
const TEST_DB_PATH = path.join(__dirname, '..', 'data', 'test-integration.db');
process.env.DB_PATH = TEST_DB_PATH;
process.env.LOG_LEVEL = 'error'; // Suppress logs during tests

const { build } = require('../src/server');
const { parseHtml, hashContent, estimateTokenCost } = require('../src/crawler/index');

const BASE_URL = 'http://127.0.0.1';
let app;
let port;

// ---- Helpers ----

async function req(method, urlPath, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
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

// ---- Test suites ----

async function testHealthEndpoint() {
  const r = await req('GET', '/health');
  assertEqual(r.status, 200, 'health status');
  assert(r.body.success === true, 'health success');
  assertEqual(r.body.data.status, 'ok', 'health data status');
  console.log('  PASS: GET /health');
}

async function testContentWorkflow() {
  // Publish content
  const publishRes = await req('POST', '/publish/content', {
    url: 'https://integration-test.example.com/page-1',
    source_hash: 'hash_' + Date.now(),
    content_text: 'Integration test content body',
    content_structured: JSON.stringify({ headings: [{ level: 1, text: 'Integration Test' }] }),
    content_links: JSON.stringify([{ text: 'Link', href: 'https://example.com' }]),
    content_metadata: JSON.stringify({ title: 'Integration Test Page', author: 'Tester' }),
    price: 0.01,
    token_cost_saved: 0.05,
  });
  assertEqual(publishRes.status, 201, 'publish content status');
  assert(publishRes.body.success, 'publish content success');
  assert(publishRes.body.data.id, 'publish content has id');
  console.log('  PASS: POST /publish/content');

  // Check content exists
  const checkRes = await req('GET', '/check?url=https://integration-test.example.com/page-1');
  assertEqual(checkRes.status, 200, 'check status');
  assertEqual(checkRes.body.data.available, true, 'check available');
  assert(checkRes.body.data.freshness, 'check has freshness');
  console.log('  PASS: GET /check (available)');

  // Check non-existent
  const checkMissRes = await req('GET', '/check?url=https://integration-test.example.com/nonexistent');
  assertEqual(checkMissRes.status, 200, 'check miss status');
  assertEqual(checkMissRes.body.data.available, false, 'check miss not available');
  console.log('  PASS: GET /check (not available)');

  // Fetch content
  const fetchRes = await req('GET', '/fetch?url=https://integration-test.example.com/page-1');
  assertEqual(fetchRes.status, 200, 'fetch status');
  assertEqual(fetchRes.body.data.content_text, 'Integration test content body', 'fetch content_text');
  assertEqual(fetchRes.body.data.url, 'https://integration-test.example.com/page-1', 'fetch url');
  console.log('  PASS: GET /fetch');

  // Fetch non-existent
  const fetchMissRes = await req('GET', '/fetch?url=https://integration-test.example.com/nonexistent');
  assertEqual(fetchMissRes.status, 404, 'fetch miss 404');
  console.log('  PASS: GET /fetch (404)');

  // Validation: missing url
  const badRes = await req('POST', '/publish/content', { source_hash: 'x' });
  assertEqual(badRes.status, 400, 'publish no url 400');
  console.log('  PASS: POST /publish/content validation (missing url)');

  // Validation: missing source_hash
  const badRes2 = await req('POST', '/publish/content', { url: 'https://x.com' });
  assertEqual(badRes2.status, 400, 'publish no hash 400');
  console.log('  PASS: POST /publish/content validation (missing source_hash)');
}

async function testArtifactWorkflow() {
  // Publish artifact
  const pubRes = await req('POST', '/publish/artifact', {
    name: 'Integration Test Artifact',
    slug: 'int-test-artifact',
    category: 'tool',
    description: 'An artifact for integration testing',
    tags: ['test', 'integration', 'javascript'],
    files: ['index.js', 'README.md'],
    price: 2.50,
    version: '1.0.0',
    license: 'MIT',
  });
  assertEqual(pubRes.status, 201, 'publish artifact status');
  assert(pubRes.body.data.id, 'publish artifact has id');
  assertEqual(pubRes.body.data.slug, 'int-test-artifact', 'publish artifact slug');
  const artifactId = pubRes.body.data.id;
  console.log('  PASS: POST /publish/artifact');

  // Duplicate slug should fail
  const dupRes = await req('POST', '/publish/artifact', {
    name: 'Duplicate',
    slug: 'int-test-artifact',
    category: 'tool',
  });
  assertEqual(dupRes.status, 409, 'duplicate slug 409');
  console.log('  PASS: POST /publish/artifact (duplicate slug)');

  // Get artifact by slug
  const getRes = await req('GET', '/artifacts/int-test-artifact');
  assertEqual(getRes.status, 200, 'get artifact status');
  assertEqual(getRes.body.data.name, 'Integration Test Artifact', 'get artifact name');
  assertEqual(getRes.body.data.price, 2.5, 'get artifact price');
  console.log('  PASS: GET /artifacts/:slug');

  // Get non-existent artifact
  const getMissRes = await req('GET', '/artifacts/nonexistent-slug');
  assertEqual(getMissRes.status, 404, 'get artifact miss 404');
  console.log('  PASS: GET /artifacts/:slug (404)');

  // Download artifact (increments count)
  const dlRes = await req('GET', '/artifacts/int-test-artifact/download');
  assertEqual(dlRes.status, 200, 'download status');
  console.log('  PASS: GET /artifacts/:slug/download');

  // Verify download count incremented
  const getRes2 = await req('GET', '/artifacts/int-test-artifact');
  assertEqual(getRes2.body.data.download_count, 1, 'download count incremented');
  console.log('  PASS: download count incremented');

  // Update artifact
  const patchRes = await req('PATCH', '/artifacts/int-test-artifact', {
    description: 'Updated description for testing',
    version: '1.1.0',
  });
  assertEqual(patchRes.status, 200, 'patch status');
  assertEqual(patchRes.body.data.description, 'Updated description for testing', 'patch description');
  assertEqual(patchRes.body.data.version, '1.1.0', 'patch version');
  console.log('  PASS: PATCH /artifacts/:slug');

  // Validation: missing name
  const badRes = await req('POST', '/publish/artifact', { slug: 'x' });
  assertEqual(badRes.status, 400, 'publish no name 400');
  console.log('  PASS: POST /publish/artifact validation (missing name)');

  return artifactId;
}

async function testSearchWorkflow() {
  // Search for content
  const searchRes = await req('GET', '/search?q=integration');
  assertEqual(searchRes.status, 200, 'search status');
  assert(searchRes.body.data.total > 0, 'search found results');
  console.log(`  PASS: GET /search (found ${searchRes.body.data.total} results)`);

  // Search with type filter
  const contentSearch = await req('GET', '/search?q=integration&type=content');
  assertEqual(contentSearch.status, 200, 'search content type status');
  const contentResults = contentSearch.body.data.results.filter(r => r.type === 'content');
  assert(contentResults.length > 0, 'search content type found content');
  console.log('  PASS: GET /search (type=content filter)');

  const artifactSearch = await req('GET', '/search?q=integration&type=artifact');
  assertEqual(artifactSearch.status, 200, 'search artifact type status');
  const artifactResults = artifactSearch.body.data.results.filter(r => r.type === 'artifact');
  assert(artifactResults.length > 0, 'search artifact type found artifacts');
  console.log('  PASS: GET /search (type=artifact filter)');

  // Search with no results
  const emptySearch = await req('GET', '/search?q=xyzzy_nonexistent_98765');
  assertEqual(emptySearch.status, 200, 'empty search status');
  assertEqual(emptySearch.body.data.total, 0, 'empty search no results');
  console.log('  PASS: GET /search (no results)');

  // Validation: missing q
  const badSearch = await req('GET', '/search');
  assertEqual(badSearch.status, 400, 'search no q 400');
  console.log('  PASS: GET /search validation (missing q)');
}

async function testMarketIntelligence() {
  // Trending
  const trendRes = await req('GET', '/trending');
  assertEqual(trendRes.status, 200, 'trending status');
  assert(trendRes.body.data.topSearches !== undefined, 'trending has topSearches');
  assert(trendRes.body.data.topContent !== undefined, 'trending has topContent');
  assert(trendRes.body.data.topArtifacts !== undefined, 'trending has topArtifacts');
  console.log('  PASS: GET /trending');

  // Trending with period
  const trend30Res = await req('GET', '/trending?period=30d');
  assertEqual(trend30Res.status, 200, 'trending 30d status');
  console.log('  PASS: GET /trending?period=30d');

  // Bad period format
  const badTrend = await req('GET', '/trending?period=abc');
  assertEqual(badTrend.status, 400, 'trending bad period 400');
  console.log('  PASS: GET /trending validation (bad period)');

  // Gaps
  const gapsRes = await req('GET', '/gaps');
  assertEqual(gapsRes.status, 200, 'gaps status');
  assert(Array.isArray(gapsRes.body.data), 'gaps returns array');
  console.log('  PASS: GET /gaps');

  // Search for something with no results to create a gap
  await req('GET', '/search?q=unfindable_gap_test_12345');
  const gapsRes2 = await req('GET', '/gaps');
  const hasGap = gapsRes2.body.data.some(g => g.query === 'unfindable_gap_test_12345');
  assert(hasGap, 'gap detected after empty search');
  console.log('  PASS: GET /gaps (detects unfulfilled searches)');
}

async function testVerificationWorkflow(artifactId) {
  // Join verifier pool (need at least 1 verifier)
  const joinRes1 = await req('POST', '/verify/pool/join', { endpoint: 'http://verifier-1:5000', stake_amount: 10 });
  assertEqual(joinRes1.status, 201, 'join pool 1 status');
  const v1Id = joinRes1.body.data.id;
  console.log('  PASS: POST /verify/pool/join (verifier 1)');

  const joinRes2 = await req('POST', '/verify/pool/join', { endpoint: 'http://verifier-2:5000', stake_amount: 15 });
  assertEqual(joinRes2.status, 201, 'join pool 2 status');
  const v2Id = joinRes2.body.data.id;
  console.log('  PASS: POST /verify/pool/join (verifier 2)');

  const joinRes3 = await req('POST', '/verify/pool/join', { endpoint: 'http://verifier-3:5000', stake_amount: 20 });
  assertEqual(joinRes3.status, 201, 'join pool 3 status');
  const v3Id = joinRes3.body.data.id;
  console.log('  PASS: POST /verify/pool/join (verifier 3)');

  // Validation: missing endpoint
  const badJoin = await req('POST', '/verify/pool/join', {});
  assertEqual(badJoin.status, 400, 'join no endpoint 400');
  console.log('  PASS: POST /verify/pool/join validation (missing endpoint)');

  // Request verification for the artifact
  const verReqRes = await req('POST', '/verify/request', {
    artifact_id: artifactId,
    publisher_id: 'publisher-1',
    fee: 5.0,
  });
  assertEqual(verReqRes.status, 201, 'verify request status');
  const verReqId = verReqRes.body.data.request.id;
  assert(verReqRes.body.data.assigned_verifiers.length > 0, 'verifiers assigned');
  console.log('  PASS: POST /verify/request');

  // Check pending
  const pendingRes = await req('GET', '/verify/pending');
  assertEqual(pendingRes.status, 200, 'pending status');
  assert(pendingRes.body.data.length > 0, 'has pending verifications');
  console.log('  PASS: GET /verify/pending');

  // Submit 3 verification results (need 3 to finalize)
  const submit1 = await req('POST', '/verify/submit', {
    request_id: verReqId,
    verifier_id: v1Id,
    passed: true,
    report: { notes: 'All checks passed' },
  });
  assertEqual(submit1.status, 201, 'submit 1 status');
  console.log('  PASS: POST /verify/submit (verifier 1: pass)');

  const submit2 = await req('POST', '/verify/submit', {
    request_id: verReqId,
    verifier_id: v2Id,
    passed: true,
    report: { notes: 'Verified successfully' },
  });
  assertEqual(submit2.status, 201, 'submit 2 status');
  console.log('  PASS: POST /verify/submit (verifier 2: pass)');

  const submit3 = await req('POST', '/verify/submit', {
    request_id: verReqId,
    verifier_id: v3Id,
    passed: false,
    report: { notes: 'Minor issue found' },
  });
  assertEqual(submit3.status, 201, 'submit 3 status');
  console.log('  PASS: POST /verify/submit (verifier 3: fail)');

  // After 3 results, verification should be finalized (2/3 passed => overall pass)
  const pendingAfter = await req('GET', '/verify/pending');
  const stillPending = pendingAfter.body.data.filter(v => v.id === verReqId);
  assertEqual(stillPending.length, 0, 'verification finalized — no longer pending');
  console.log('  PASS: verification finalized after 3 submissions');

  // Artifact should now be verified
  const artRes = await req('GET', '/artifacts/int-test-artifact');
  assertEqual(artRes.body.data.verified, 1, 'artifact verified flag set');
  console.log('  PASS: artifact marked as verified');

  // Validation: submit to already finalized request
  const dupSubmit = await req('POST', '/verify/submit', {
    request_id: verReqId,
    verifier_id: v1Id,
    passed: true,
    report: {},
  });
  assertEqual(dupSubmit.status, 409, 'submit to finalized 409');
  console.log('  PASS: POST /verify/submit (reject finalized)');

  // Leave pool
  const leaveRes = await req('POST', '/verify/pool/leave', { verifier_id: v1Id });
  assertEqual(leaveRes.status, 200, 'leave pool status');
  assert(leaveRes.body.data.stake_returned === 10, 'stake returned');
  console.log('  PASS: POST /verify/pool/leave');
}

async function testNodeManagement() {
  // Register node
  const regRes = await req('POST', '/nodes/register', {
    name: 'test-node-1',
    endpoint: 'http://node1.example.com:3000',
    coverage: 'docs,blogs',
    index_size: 50000,
    freshness_policy: '24h',
    pricing_model: 'per-fetch',
    avg_price: 0.01,
  });
  assertEqual(regRes.status, 201, 'register node status');
  assert(regRes.body.data.id, 'register node has id');
  assert(regRes.body.data.api_key, 'register node has api_key');
  const nodeId = regRes.body.data.id;
  console.log('  PASS: POST /nodes/register');

  // List nodes
  const listRes = await req('GET', '/nodes');
  assertEqual(listRes.status, 200, 'list nodes status');
  assert(listRes.body.data.length > 0, 'at least one node');
  console.log('  PASS: GET /nodes');

  // Get specific node
  const getRes = await req('GET', `/nodes/${nodeId}`);
  assertEqual(getRes.status, 200, 'get node status');
  assertEqual(getRes.body.data.name, 'test-node-1', 'get node name');
  console.log('  PASS: GET /nodes/:id');

  // Get non-existent node
  const missRes = await req('GET', '/nodes/nonexistent-id');
  assertEqual(missRes.status, 404, 'get node miss 404');
  console.log('  PASS: GET /nodes/:id (404)');

  // Validation: missing name
  const badReg = await req('POST', '/nodes/register', { endpoint: 'http://x.com' });
  assertEqual(badReg.status, 400, 'register no name 400');
  console.log('  PASS: POST /nodes/register validation (missing name)');

  // Validation: missing endpoint
  const badReg2 = await req('POST', '/nodes/register', { name: 'x' });
  assertEqual(badReg2.status, 400, 'register no endpoint 400');
  console.log('  PASS: POST /nodes/register validation (missing endpoint)');
}

async function testCrawlerIntegration() {
  // Test parseHtml -> publish -> fetch pipeline
  const html = `<!DOCTYPE html>
<html><head><title>Crawled Page</title><meta name="description" content="A crawled page"></head>
<body><article><h1>Crawled Content</h1><p>This is crawled content for integration testing.</p>
<pre><code class="language-js">console.log('hello')</code></pre>
<a href="https://example.com">Example</a></article></body></html>`;

  const content = parseHtml(html, 'https://crawl-test.example.com/page');
  const sourceHash = hashContent(html);
  const cost = estimateTokenCost(html);

  assert(content.text.length > 0, 'crawler extracted text');
  assert(content.metadata.title, 'crawler extracted title');
  assert(sourceHash.length === 64, 'hash is 64 chars');
  assert(cost.estimatedTokens > 0, 'token estimate > 0');
  console.log('  PASS: crawler parseHtml + hashContent + estimateTokenCost');

  // Publish the crawled content to the server
  const pubRes = await req('POST', '/publish/content', {
    url: 'https://crawl-test.example.com/page',
    source_hash: sourceHash,
    content_text: content.text,
    content_structured: JSON.stringify(content.structured),
    content_links: JSON.stringify(content.links),
    content_metadata: JSON.stringify(content.metadata),
    price: 0.005,
    token_cost_saved: cost.estimatedCostUsd,
  });
  assertEqual(pubRes.status, 201, 'publish crawled content status');
  console.log('  PASS: publish crawled content');

  // Fetch it back
  const fetchRes = await req('GET', '/fetch?url=https://crawl-test.example.com/page');
  assertEqual(fetchRes.status, 200, 'fetch crawled content status');
  assertEqual(fetchRes.body.data.source_hash, sourceHash, 'fetch source hash matches');
  assert(fetchRes.body.data.content_text.includes('crawled content'), 'fetch content_text matches');
  console.log('  PASS: fetch crawled content');

  // Search for it
  const searchRes = await req('GET', '/search?q=crawled');
  assert(searchRes.body.data.total > 0, 'search finds crawled content');
  console.log('  PASS: search finds crawled content');
}

// ---- Main ----

async function main() {
  // Clean up old test DB
  try { fs.unlinkSync(TEST_DB_PATH); } catch (e) { /* fine */ }

  console.log('Building server...');
  app = await build();

  // Find a free port
  await new Promise((resolve, reject) => {
    app.listen({ port: 0, host: '127.0.0.1' }, (err, address) => {
      if (err) return reject(err);
      port = parseInt(new URL(address).port, 10);
      console.log(`Server listening on port ${port}\n`);
      resolve();
    });
  });

  let failures = 0;
  const suites = [
    ['Health', testHealthEndpoint],
    ['Content Workflow', testContentWorkflow],
    ['Artifact Workflow', testArtifactWorkflow],
    ['Search Workflow', testSearchWorkflow],
    ['Market Intelligence', testMarketIntelligence],
    ['Verification Workflow', null], // needs artifactId, handled below
    ['Node Management', testNodeManagement],
    ['Crawler Integration', testCrawlerIntegration],
  ];

  let artifactId;
  for (const [name, fn] of suites) {
    if (name === 'Verification Workflow') continue; // run after artifact
    try {
      console.log(`\n--- ${name} ---`);
      const result = await fn();
      if (name === 'Artifact Workflow') artifactId = result;
    } catch (err) {
      console.log(`  FAIL: ${err.message}`);
      failures++;
    }
  }

  // Run verification with artifactId
  try {
    console.log('\n--- Verification Workflow ---');
    await testVerificationWorkflow(artifactId);
  } catch (err) {
    console.log(`  FAIL: ${err.message}`);
    failures++;
  }

  // Cleanup
  await app.close();
  try { fs.unlinkSync(TEST_DB_PATH); } catch (e) { /* fine */ }

  console.log(`\n========================================`);
  if (failures === 0) {
    console.log('ALL INTEGRATION TESTS PASSED');
  } else {
    console.log(`${failures} SUITE(S) HAD FAILURES`);
  }
  console.log(`========================================\n`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
