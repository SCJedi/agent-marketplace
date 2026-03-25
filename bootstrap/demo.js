'use strict';

const { MultiNodeClient } = require('./multi-client');

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function divider() {
  console.log(`${DIM}${'─'.repeat(60)}${RESET}`);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('');
  console.log(`${CYAN}${BOLD}=== AGENT MARKETPLACE — MULTI-NODE DEMO ===${RESET}`);
  console.log('');

  const client = new MultiNodeClient('http://localhost:3000');

  // ── Step 1: Discover nodes ───────────────────────────────────────
  console.log(`${BOLD}Step 1: Discovering nodes...${RESET}`);
  const nodes = await client.discoverNodes();
  for (const n of nodes) {
    console.log(`  Found: ${GREEN}${n.name}${RESET} (${n.specialty}) — ${n.contentCount} items, ${n.artifactCount} artifacts`);
  }
  console.log('');
  await sleep(500);

  // ── Step 2: Cross-node search ────────────────────────────────────
  divider();
  console.log(`${BOLD}Step 2: Searching across all nodes for "FastAPI"${RESET}`);

  const { results: searchResults, nodeResults } = await client.search('FastAPI');

  for (const [nodeName, count] of Object.entries(nodeResults)) {
    console.log(`  Results from ${nodeName}: ${count} items`);
  }
  console.log('');

  const top3 = searchResults.slice(0, 3);
  if (top3.length > 0) {
    console.log(`  ${BOLD}Top ${top3.length} combined results:${RESET}`);
    console.log(`  ${'#'.padEnd(3)} ${'Node'.padEnd(12)} ${'Title'.padEnd(38)} ${'Price'.padEnd(10)} Relevance`);
    for (let i = 0; i < top3.length; i++) {
      const r = top3[i];
      let title = r.name || '';
      if (!title && r.content_text) title = r.content_text.split('\n')[0].substring(0, 35);
      if (!title) title = (r.url || '').split('/').pop().replace(/-/g, ' ');
      title = title.substring(0, 35);
      const price = `$${(r.price || 0).toFixed(4)}`;
      const rel = r._relevance.toFixed(2);
      console.log(`  ${String(i + 1).padEnd(3)} ${(r._node || '').padEnd(12)} ${title.padEnd(38)} ${price.padEnd(10)} ${rel}`);
    }
  }
  console.log('');
  await sleep(500);

  // ── Step 3: Check URL across nodes ───────────────────────────────
  divider();
  const checkUrl = 'https://example.com/api/docs';
  console.log(`${BOLD}Step 3: Checking URL across nodes: "${checkUrl}"${RESET}`);

  const checks = await client.check(checkUrl);
  for (const c of checks) {
    if (c.available) {
      const fresh = c.freshness ? `fetched ${timeSince(c.freshness)}` : '';
      const cheapest = checks.filter(x => x.available).sort((a, b) => a.price - b.price)[0];
      const tag = (c.node === cheapest.node) ? ` ${YELLOW}<- cheapest${RESET}` : '';
      console.log(`  ${c.node}:  Available at $${c.price.toFixed(4)} (${fresh})${tag}`);
    } else {
      console.log(`  ${c.node}:  ${DIM}Not available${RESET}`);
    }
  }
  console.log('');
  await sleep(500);

  // ── Step 4: Smart fetch ──────────────────────────────────────────
  divider();
  console.log(`${BOLD}Step 4: Smart fetch — buying from cheapest provider${RESET}`);

  const fetched = await client.smartFetch(checkUrl);
  if (fetched) {
    const wordCount = fetched.content && fetched.content.content_text
      ? fetched.content.content_text.split(/\s+/).length
      : 0;
    console.log(`  ${GREEN}Bought from ${fetched.provider} for $${fetched.price.toFixed(4)}${RESET}`);
    const title = fetched.content && fetched.content.content_text
      ? fetched.content.content_text.split('\n')[0].substring(0, 50)
      : 'Unknown';
    console.log(`  Content: "${title}" (${wordCount} words)`);
    if (fetched.alternativeProviders > 0) {
      console.log(`  ${fetched.alternativeProviders} alternative provider(s) available`);
    }
  } else {
    console.log(`  ${YELLOW}Not available on any node${RESET}`);
  }
  console.log('');
  await sleep(500);

  // ── Step 5: Multi-provider consensus ─────────────────────────────
  divider();
  console.log(`${BOLD}Step 5: Multi-provider consensus check${RESET}`);
  console.log(`  Checking "${checkUrl}" across nodes...`);

  const comparison = await client.compareProviders(checkUrl);
  for (const p of comparison.providers) {
    if (p.available && p.contentHash) {
      console.log(`  ${p.node} hash:  ${p.contentHash.substring(0, 10)}...`);
    } else if (p.available) {
      console.log(`  ${p.node}:  Available (no hash)`);
    } else {
      console.log(`  ${p.node}:  ${DIM}Not available${RESET}`);
    }
  }
  if (comparison.consensus) {
    console.log(`  ${GREEN}\u2713 Content consensus — ${comparison.hashCount} providers agree${RESET}`);
  } else if (comparison.hashCount > 0) {
    console.log(`  ${YELLOW}\u2717 No consensus — ${comparison.uniqueHashes} different hashes from ${comparison.hashCount} providers${RESET}`);
  }
  console.log('');
  await sleep(500);

  // ── Step 6: Market gaps ──────────────────────────────────────────
  divider();
  console.log(`${BOLD}Step 6: Finding market gaps${RESET}`);

  // Query gaps from one of the nodes
  try {
    const resp = await fetch('http://localhost:3001/gaps', { signal: AbortSignal.timeout(5000) });
    const body = await resp.json();
    const gaps = (body.data && Array.isArray(body.data)) ? body.data : (Array.isArray(body.data) ? body.data : []);

    if (gaps.length > 0) {
      console.log('  Trending searches with no results:');
      for (const g of gaps.slice(0, 4)) {
        console.log(`  - "${g.query}" (${g.count} searches, 0 results)`);
      }
      console.log(`  ${YELLOW}-> Opportunity for providers!${RESET}`);
    } else {
      console.log('  No significant gaps detected yet.');
    }
  } catch {
    console.log('  Could not fetch gap data.');
  }

  console.log('');
  console.log(`${CYAN}${BOLD}=== DEMO COMPLETE ===${RESET}`);
  console.log('');
}

function timeSince(dateStr) {
  // SQLite datetime('now') returns "YYYY-MM-DD HH:MM:SS" without timezone — it's UTC
  let d;
  if (dateStr && !dateStr.includes('T')) {
    d = new Date(dateStr + 'Z');
  } else {
    d = new Date(dateStr);
  }
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 0) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

main().catch(err => {
  console.error('Demo failed:', err.message);
  process.exit(1);
});
