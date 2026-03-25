'use strict';

const { fork } = require('child_process');
const { NetworkClient } = require('../src/network-client');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Test infrastructure
const PROJECT_ROOT = path.resolve(__dirname, '..');
const TEST_DATA_DIR = path.join(PROJECT_ROOT, 'data', 'test-peers');
const children = [];

function cleanTestData() {
  try {
    if (fs.existsSync(TEST_DATA_DIR)) {
      for (const f of fs.readdirSync(TEST_DATA_DIR)) {
        try { fs.unlinkSync(path.join(TEST_DATA_DIR, f)); } catch {}
      }
    }
  } catch {}
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer(url, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const resp = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
      if (resp.ok) return true;
    } catch {}
    await sleep(300);
  }
  return false;
}

/**
 * Start a node as a child process (separate DB, separate memory).
 * This is how real nodes run — isolated processes.
 */
function startNodeProcess(port, name, specialty, seedNodes) {
  if (!fs.existsSync(TEST_DATA_DIR)) fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  const dbPath = path.join(TEST_DATA_DIR, `node-${port}.db`);

  const child = fork(path.join(PROJECT_ROOT, 'src', 'server.js'), [], {
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbPath,
      LOG_LEVEL: 'error',
      HOST: '0.0.0.0',
      PUBLIC_URL: `http://localhost:${port}`,
      NODE_NAME: name,
      NODE_SPECIALTY: specialty,
      SEED_NODES: (seedNodes || []).join(',')
    },
    stdio: ['pipe', 'pipe', 'pipe', 'ipc']
  });

  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  children.push(child);
  return child;
}

function stopAllNodes() {
  for (const child of children) {
    try { child.kill('SIGTERM'); } catch {}
  }
  children.length = 0;
}

// ─── Test Runner ────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  \x1b[32mPASS\x1b[0m ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message });
    console.log(`  \x1b[31mFAIL\x1b[0m ${name}: ${err.message}`);
  }
}

// ─── Tests ──────────────────────────────────────────────────────

async function runTests() {
  console.log('\n  Peer Discovery Tests\n  ' + '='.repeat(40) + '\n');

  cleanTestData();

  const portA = 4001;
  const portB = 4002;
  const portC = 4003;

  try {
    // Start 3 nodes as separate processes
    // Each seeds from another to form a chain
    startNodeProcess(portA, 'NodeA', 'web', [`http://localhost:${portB}`]);
    startNodeProcess(portB, 'NodeB', 'code', [`http://localhost:${portC}`]);
    startNodeProcess(portC, 'NodeC', 'data', [`http://localhost:${portA}`]);

    // Wait for all to come up
    for (const port of [portA, portB, portC]) {
      const up = await waitForServer(`http://localhost:${port}`);
      assert(up, `Node on port ${port} did not start`);
    }

    // Give peer discovery a moment to bootstrap
    await sleep(2000);

    // ── Test 1: Health endpoint works ──
    await test('Health endpoint returns OK', async () => {
      const resp = await fetch(`http://localhost:${portA}/health`);
      const body = await resp.json();
      assert(body.success === true, 'health should return success');
      assert(body.data.status === 'ok', 'status should be ok');
      assert(typeof body.data.peers === 'number', 'should include peer count');
    });

    // ── Test 2: Announce self to a peer ──
    await test('Node A announces itself to Node B', async () => {
      const resp = await fetch(`http://localhost:${portB}/peers/announce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: `http://localhost:${portA}`,
          name: 'NodeA',
          specialty: 'web'
        })
      });
      const body = await resp.json();
      assert(body.success === true, 'announce should succeed');
      assert(body.data.accepted === true, 'should be accepted');
    });

    // ── Test 3: Node B now knows about Node A ──
    await test('Node B lists Node A as a peer after announce', async () => {
      const resp = await fetch(`http://localhost:${portB}/peers`);
      const body = await resp.json();
      assert(body.success === true, 'peers endpoint should succeed');
      const peerEndpoints = body.data.map(p => p.endpoint);
      assert(peerEndpoints.includes(`http://localhost:${portA}`), 'Node B should know about Node A');
    });

    // ── Test 4: Node C announces to Node A ──
    await test('Node C announces itself to Node A', async () => {
      const resp = await fetch(`http://localhost:${portA}/peers/announce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: `http://localhost:${portC}`,
          name: 'NodeC',
          specialty: 'data'
        })
      });
      const body = await resp.json();
      assert(body.success === true, 'announce should succeed');
    });

    // ── Test 5: Peer exchange works bidirectionally ──
    await test('Peer exchange returns our peers and accepts theirs', async () => {
      const resp = await fetch(`http://localhost:${portA}/peers/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          peers: [
            { endpoint: `http://localhost:${portB}`, name: 'NodeB', specialty: 'code' }
          ]
        })
      });
      const body = await resp.json();
      assert(body.success === true, 'exchange should succeed');
      assert(Array.isArray(body.data), 'should return peer list');
    });

    // ── Test 6: Form full mesh via announcements ──
    await test('Full mesh forms when all nodes announce to each other', async () => {
      // Cross-announce all pairs
      const announcements = [
        [portB, portA, 'NodeA', 'web'],
        [portC, portA, 'NodeA', 'web'],
        [portA, portB, 'NodeB', 'code'],
        [portC, portB, 'NodeB', 'code'],
        [portA, portC, 'NodeC', 'data'],
        [portB, portC, 'NodeC', 'data'],
      ];
      for (const [target, srcPort, name, specialty] of announcements) {
        await fetch(`http://localhost:${target}/peers/announce`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: `http://localhost:${srcPort}`, name, specialty })
        });
      }

      // Each node should know at least 2 others
      for (const port of [portA, portB, portC]) {
        const resp = await fetch(`http://localhost:${port}/peers`);
        const body = await resp.json();
        assert(body.data.length >= 2, `Node :${port} should know >= 2 peers, has ${body.data.length}`);
      }
    });

    // ── Test 7: Transitive discovery via peer list ──
    await test('Node discovers peers transitively via GET /peers', async () => {
      const resp = await fetch(`http://localhost:${portB}/peers`);
      const body = await resp.json();
      const endpoints = body.data.map(p => p.endpoint);
      assert(endpoints.includes(`http://localhost:${portC}`), 'Node B should list Node C');
      assert(endpoints.includes(`http://localhost:${portA}`), 'Node B should list Node A');
    });

    // ── Test 8: Peer info includes name and specialty ──
    await test('Peer info includes name and specialty', async () => {
      const resp = await fetch(`http://localhost:${portA}/peers`);
      const body = await resp.json();
      const nodeB = body.data.find(p => p.endpoint === `http://localhost:${portB}`);
      assert(nodeB, 'Node A should list Node B');
      assert(nodeB.name === 'NodeB', `expected name 'NodeB' got '${nodeB.name}'`);
      assert(nodeB.specialty === 'code', `expected specialty 'code' got '${nodeB.specialty}'`);
    });

    // ── Test 9: Announce validation ──
    await test('Announce rejects missing endpoint', async () => {
      const resp = await fetch(`http://localhost:${portA}/peers/announce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'BadNode' })
      });
      assert(resp.status === 400, `expected 400, got ${resp.status}`);
    });

    // ── Test 10: Peer exchange adds incoming peers ──
    await test('Peer exchange adds unknown peers from incoming list', async () => {
      const fakeEndpoint = 'http://localhost:9999';
      await fetch(`http://localhost:${portA}/peers/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          peers: [{ endpoint: fakeEndpoint, name: 'FakeNode', specialty: 'test' }]
        })
      });

      const peersResp = await fetch(`http://localhost:${portA}/peers`);
      const peersBody = await peersResp.json();
      const hasFake = peersBody.data.some(p => p.endpoint === fakeEndpoint);
      assert(hasFake, 'Node A should have added the fake peer from exchange');
    });

    // ── Test 11: NetworkClient discovers all nodes from 1 seed ──
    await test('NetworkClient discovers all 3 nodes from 1 seed', async () => {
      const client = new NetworkClient({ seeds: [`http://localhost:${portA}`] });
      const nodes = await client.discoverNetwork();
      const endpoints = nodes.map(n => n.endpoint);
      assert(endpoints.includes(`http://localhost:${portA}`), 'should discover Node A');
      assert(endpoints.includes(`http://localhost:${portB}`), 'should discover Node B');
      assert(endpoints.includes(`http://localhost:${portC}`), 'should discover Node C');
    });

    // ── Test 12: NetworkClient search fans out across nodes ──
    await test('NetworkClient search fans out across all nodes', async () => {
      // Seed content on Node A
      const sourceHash = crypto.createHash('sha256').update('http://test.com/p2p-article').digest('hex');
      await fetch(`http://localhost:${portA}/publish/content`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'http://test.com/p2p-article',
          source_hash: sourceHash,
          content_text: 'P2P peer discovery article about Bitcoin networking',
          price: 0.001
        })
      });

      const client = new NetworkClient({ seeds: [`http://localhost:${portA}`] });
      const result = await client.search('peer discovery');
      assert(result.results.length >= 1, `should find >= 1 result, got ${result.results.length}`);
      assert(result.nodeResults !== undefined, 'should include node results map');
    });

    // ── Test 13: NetworkClient check aggregates across nodes ──
    await test('NetworkClient check aggregates across all nodes', async () => {
      const client = new NetworkClient({ seeds: [`http://localhost:${portA}`] });
      const checks = await client.check('http://test.com/p2p-article');
      assert(checks.length >= 3, `should check >= 3 nodes, got ${checks.length}`);
      const nodeACheck = checks.find(c => c.endpoint === `http://localhost:${portA}`);
      assert(nodeACheck, 'should include Node A check');
      assert(nodeACheck.available === true, 'Node A should have the content');
    });

    // ── Test 14: NetworkClient smartFetch gets content ──
    await test('NetworkClient smartFetch finds cheapest provider', async () => {
      const client = new NetworkClient({ seeds: [`http://localhost:${portA}`] });
      const result = await client.smartFetch('http://test.com/p2p-article');
      assert(result !== null, 'should get a result');
      assert(result.content !== null, 'should have content');
      assert(typeof result.price === 'number', 'should have a price');
    });

    // ── Test 15: Duplicate announce updates info ──
    await test('Duplicate announce updates existing peer info', async () => {
      await fetch(`http://localhost:${portA}/peers/announce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: `http://localhost:${portB}`,
          name: 'NodeB-Updated',
          specialty: 'code-v2'
        })
      });

      const peersResp = await fetch(`http://localhost:${portA}/peers`);
      const peersBody = await peersResp.json();
      const nodeB = peersBody.data.find(p => p.endpoint === `http://localhost:${portB}`);
      assert(nodeB, 'Node B should still be in peers');
      assert(nodeB.name === 'NodeB-Updated', `name should be updated, got '${nodeB.name}'`);
    });

    // ── Test 16: Health shows peer count ──
    await test('Health endpoint shows peer count', async () => {
      const resp = await fetch(`http://localhost:${portA}/health`);
      const body = await resp.json();
      assert(body.data.peers >= 2, `should have >= 2 peers, got ${body.data.peers}`);
    });

    // ── Test 17: Empty exchange returns peers ──
    await test('Empty peer exchange still returns our peer list', async () => {
      const resp = await fetch(`http://localhost:${portA}/peers/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peers: [] })
      });
      const body = await resp.json();
      assert(body.success === true, 'should succeed');
      assert(body.data.length >= 2, `should return >= 2 peers, got ${body.data.length}`);
    });

    // ── Test 18: NetworkClient handles unreachable seeds ──
    await test('NetworkClient handles unreachable seeds gracefully', async () => {
      const client = new NetworkClient({
        seeds: ['http://localhost:19999', `http://localhost:${portA}`]
      });
      const nodes = await client.discoverNetwork();
      assert(nodes.length >= 3, `should still discover network, got ${nodes.length} nodes`);
    });

  } finally {
    stopAllNodes();
    await sleep(500);
    cleanTestData();
  }

  // Print summary
  console.log('\n  ' + '='.repeat(40));
  console.log(`  Results: \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m`);

  if (failures.length > 0) {
    console.log('\n  Failures:');
    for (const f of failures) {
      console.log(`    - ${f.name}: ${f.error}`);
    }
  }

  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test runner failed:', err);
  stopAllNodes();
  process.exit(1);
});
