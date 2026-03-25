'use strict';

const { fork } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const seedData = require('./seed-data');
const crypto = require('crypto');

const PROJECT_ROOT = path.resolve(__dirname, '..');

// Ensure data directory exists
const dataDir = path.join(PROJECT_ROOT, 'bootstrap', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Clean old databases
for (const f of fs.readdirSync(dataDir)) {
  if (f.endsWith('.db') || f.endsWith('.db-wal') || f.endsWith('.db-shm')) {
    fs.unlinkSync(path.join(dataDir, f));
  }
}

const children = [];

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

async function seedNode(endpoint, contentItems, artifacts, searchEntries) {
  // Publish content
  let contentCount = 0;
  for (const item of contentItems) {
    try {
      const sourceHash = crypto.createHash('sha256').update(item.url).digest('hex');
      const resp = await fetch(`${endpoint}/publish/content`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: item.url,
          source_hash: sourceHash,
          content_text: item.content_text,
          content_metadata: item.content_metadata,
          price: item.price || 0.0003
        }),
        signal: AbortSignal.timeout(5000)
      });
      if (resp.ok) contentCount++;
    } catch (err) {
      // Silently continue — rate limiting may block some
    }
  }

  // Publish artifacts
  let artifactCount = 0;
  for (const art of artifacts) {
    try {
      const resp = await fetch(`${endpoint}/publish/artifact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(art),
        signal: AbortSignal.timeout(5000)
      });
      if (resp.ok) artifactCount++;
    } catch {}
  }

  // Seed search log entries (for trending/gaps)
  for (const entry of searchEntries) {
    try {
      const params = new URLSearchParams({ q: entry.query });
      await fetch(`${endpoint}/search?${params}`, { signal: AbortSignal.timeout(3000) });
    } catch {}
  }

  return { contentCount, artifactCount };
}

async function main() {
  console.log('\n  Starting Agent Marketplace P2P bootstrap network...\n');

  // Build seed list — each node knows about the others
  const allEndpoints = config.nodes.map(n => `http://localhost:${n.port}`);

  // ── Step 1: Start marketplace nodes (no central directory needed!) ──
  const nodeStats = [];

  for (const node of config.nodes) {
    const dbPath = path.resolve(PROJECT_ROOT, node.dbPath);
    const otherSeeds = allEndpoints.filter(ep => ep !== `http://localhost:${node.port}`);

    const child = fork(path.join(PROJECT_ROOT, 'src', 'server.js'), [], {
      env: {
        ...process.env,
        PORT: String(node.port),
        DB_PATH: dbPath,
        LOG_LEVEL: 'warn',
        HOST: '0.0.0.0',
        PUBLIC_URL: `http://localhost:${node.port}`,
        NODE_NAME: node.name,
        NODE_SPECIALTY: node.specialty,
        SEED_NODES: otherSeeds.join(',')
      },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc']
    });

    child.stdout.on('data', () => {}); // consume output
    child.stderr.on('data', () => {}); // consume errors

    children.push(child);
  }

  // Wait for all nodes to come up
  for (const node of config.nodes) {
    const endpoint = `http://localhost:${node.port}`;
    const up = await waitForServer(endpoint);
    if (!up) {
      console.error(`  FAILED: ${node.name} on port ${node.port} did not start`);
      await shutdown();
      process.exit(1);
    }
    console.log(`  ${node.name} started on port ${node.port}`);
  }

  // ── Step 2: Seed data ───────────────────────────────────────────
  console.log('\n  Seeding data...');

  // Seed WebClean (node1)
  const wc = await seedNode(
    `http://localhost:${config.nodes[0].port}`,
    [...seedData.webCleanContent, seedData.sharedContent],
    seedData.webCleanArtifacts,
    seedData.searchQueries
  );
  nodeStats.push(wc);

  // Seed CodeVault (node2)
  const cv = await seedNode(
    `http://localhost:${config.nodes[1].port}`,
    [...seedData.codeVaultContent, seedData.sharedContent],
    seedData.codeVaultArtifacts,
    seedData.searchQueries
  );
  nodeStats.push(cv);

  // Seed DataStream (node3)
  const ds = await seedNode(
    `http://localhost:${config.nodes[2].port}`,
    [...seedData.dataStreamContent, seedData.sharedContent],
    seedData.dataStreamArtifacts,
    seedData.searchQueries
  );
  nodeStats.push(ds);

  // ── Step 3: Wait for peer discovery to form the mesh ────────────
  console.log('\n  Waiting for P2P mesh to form...');
  await sleep(3000); // Give peer discovery time to bootstrap

  // Verify peer discovery worked
  let meshFormed = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    let allConnected = true;
    for (const node of config.nodes) {
      try {
        const resp = await fetch(`http://localhost:${node.port}/peers`, {
          signal: AbortSignal.timeout(2000)
        });
        const body = await resp.json();
        const peers = body.data || [];
        if (peers.length < config.nodes.length - 1) {
          allConnected = false;
          break;
        }
      } catch {
        allConnected = false;
        break;
      }
    }
    if (allConnected) {
      meshFormed = true;
      break;
    }
    await sleep(1000);
  }

  // ── Step 4: Print status dashboard ──────────────────────────────
  const totalContent = nodeStats.reduce((s, n) => s + n.contentCount, 0);
  const totalArtifacts = nodeStats.reduce((s, n) => s + n.artifactCount, 0);

  const pad = (s, n) => s.padEnd(n);

  console.log('');
  console.log('  \x1b[36m\x1b[1m' + '='.repeat(54) + '\x1b[0m');
  console.log('  \x1b[36m\x1b[1m  AGENT MARKETPLACE \u2014 P2P BOOTSTRAP NETWORK\x1b[0m');
  console.log('  \x1b[36m\x1b[1m' + '='.repeat(54) + '\x1b[0m');
  console.log('');
  console.log(`  \x1b[1mTopology:\x1b[0m  Fully decentralized (no directory service)`);
  console.log(`  \x1b[1mDiscovery:\x1b[0m Bitcoin-style peer exchange`);
  console.log(`  \x1b[1mMesh:\x1b[0m      ${meshFormed ? '\x1b[32mFORMED\x1b[0m' : '\x1b[33mFORMING...\x1b[0m'}`);
  console.log('');
  console.log('  \x1b[1mNodes:\x1b[0m');
  for (let i = 0; i < config.nodes.length; i++) {
    const n = config.nodes[i];
    const s = nodeStats[i];
    console.log(
      `  ${i + 1}. ${pad(n.name, 12)} :${n.port}  ${pad(n.specialty, 15)} ${s.contentCount} items, ${s.artifactCount} artifacts  \x1b[32m\u2713\x1b[0m`
    );
  }
  console.log('');
  console.log(`  \x1b[1mTotal:\x1b[0m ${totalContent} content items, ${totalArtifacts} artifacts`);
  console.log('');
  console.log('  \x1b[1mTry:\x1b[0m');
  console.log('    node bootstrap/demo.js');
  console.log('    node cli/bin/cli.js search "python auth" --node http://localhost:3002');
  console.log('');
  console.log('  Press Ctrl+C to stop all nodes');
  console.log('  \x1b[36m\x1b[1m' + '='.repeat(54) + '\x1b[0m');
  console.log('');
}

async function shutdown() {
  console.log('\n  Shutting down...');
  for (const child of children) {
    try { child.kill('SIGTERM'); } catch {}
  }
  console.log('  All nodes stopped.\n');
}

// Handle Ctrl+C
process.on('SIGINT', async () => {
  await shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await shutdown();
  process.exit(0);
});

main().catch(err => {
  console.error('  Bootstrap failed:', err.message);
  shutdown().then(() => process.exit(1));
});
