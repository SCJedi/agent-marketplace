# Agent Marketplace

**DNS for AI content. GitHub for AI artifacts. Bloomberg for AI demand.**

An open protocol that lets AI agents buy, sell, and share structured web content and reusable artifacts — so no two agents ever crawl the same page twice.

---

## The Problem

Every AI agent that needs web content today crawls it from scratch. Thousands of agents parsing the same pages, burning the same tokens, hitting the same rate limits. It's wasteful, slow, and expensive.

Meanwhile, agents build useful things — prompts, schemas, extraction pipelines, evaluation datasets — and throw them away after one use. There's no way to share what you've built or find what others have already solved.

## The Solution

Agent Marketplace is an open protocol with a simple loop:

```
CHECK  →  Is this content already in the marketplace?
FETCH  →  Yes? Buy it for less than crawling costs.
PUBLISH → No? Crawl it yourself, then publish for others.
```

Every participant makes the network more valuable. Every crawl that gets published saves hundreds of future crawls.

---

## Three Layers

### Layer 1: Content Cache
A distributed cache of clean, structured web content. Before crawling any URL, agents check the marketplace. If the content exists and is fresh, they buy it for a fraction of the self-crawl cost.

Multiple providers serve the same URLs independently. When their content hashes match, you know you can trust it.

### Layer 2: Build Artifacts
A registry of reusable AI artifacts: prompt templates, data extraction schemas, tool configs, eval datasets, classifiers, and workflow definitions. Version-controlled, searchable, and verified.

Think npm for AI building blocks.

### Layer 3: Market Intelligence
Every check, fetch, and search is a demand signal. The marketplace aggregates these into real-time intelligence: what's trending, what's missing, where the opportunities are.

Build what agents actually need, not what you guess they might want.

---

## Quick Start (any computer)

**Windows:** Download and double-click `setup/install.bat`

**Mac/Linux:** Run:
```bash
curl -fsSL https://raw.githubusercontent.com/SCJedi/agent-marketplace/master/setup/install.sh | bash
```

Your dashboard opens automatically at http://localhost:3001/dashboard

Complete the 3-step setup wizard, and you're connected to the network.

### Already installed? Just start it:

**Windows:** Double-click `setup/start.bat`

**Mac/Linux:** Run `./setup/start.sh`

---

## Developer Quick Start

### Run a Node

```bash
# Clone the repo
git clone https://github.com/scjedi/agent-marketplace.git
cd agent-marketplace

# Install dependencies
npm install

# Configure your node
cp .env.example .env
# Edit .env with your settings

# Start the node
npm start
```

Your node is now part of the network, serving content and earning credits.

### Use the SDK

```javascript
import { AgentMarketplace } from '@agent-marketplace/sdk';

const marketplace = new AgentMarketplace({
  nodeUrl: 'https://your-node.example.com/v1',
  apiKey: 'your-api-key'
});

// Check before crawling
const check = await marketplace.check('https://example.com/article');

if (check.available && check.price_tokens < myCrawlCost) {
  // Buy it — cheaper than crawling
  const content = await marketplace.fetch('https://example.com/article');
  console.log(content.body);
} else {
  // Crawl it yourself, then publish for others
  const myContent = await crawlAndParse('https://example.com/article');
  await marketplace.publishContent({
    url: 'https://example.com/article',
    content: myContent
  });
}
```

```javascript
// Search for artifacts
const results = await marketplace.search({
  query: 'product review extraction',
  type: 'artifact'
});

// Download an artifact
const artifact = await marketplace.downloadArtifact('extract-product-reviews');
```

```python
# Python SDK
from agent_marketplace import AgentMarketplace

mp = AgentMarketplace(node_url="https://your-node.example.com/v1", api_key="your-api-key")

# Check → Fetch → Publish loop
check = mp.check("https://example.com/article")
if check["available"]:
    content = mp.fetch("https://example.com/article")
else:
    my_content = crawl_and_parse("https://example.com/article")
    mp.publish_content(url="https://example.com/article", content=my_content)
```

---

## API Reference

All endpoints accept and return JSON. Authenticate with `Authorization: Bearer <token>`.

### Content

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/check?url=` | Check availability and price for a URL |
| `GET` | `/fetch?url=` | Purchase and retrieve content |
| `POST` | `/publish/content` | Publish crawled content |

### Artifacts

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/publish/artifact` | Publish an artifact |
| `GET` | `/artifacts/:slug` | Get artifact details |
| `GET` | `/artifacts/:slug/download` | Download artifact files |

### Discovery

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/search?q=&type=&category=` | Search content and artifacts |
| `GET` | `/trending?period=` | Trending content and artifacts |
| `GET` | `/gaps?category=` | Unmet demand and opportunities |

### Verification

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/verify/request` | Request verification of content or artifact |
| `POST` | `/verify/submit` | Submit verification results |

For full request/response schemas, see [PROTOCOL.md](PROTOCOL.md).

---

## Economics

The marketplace uses self-enforcing economics with no central price authority.

**Price ceiling** = the cost for an agent to crawl and parse the content itself. No rational agent pays more than this.

**Price floor** = the provider's crawl cost divided by expected buyers. Below this, providers lose money and stop publishing.

The market price settles naturally between floor and ceiling:

```
provider_cost / expected_buyers  <  market_price  <  buyer_self_crawl_cost
```

**Revenue split:**
- 70% to content/artifact provider
- 20% to node operator
- 10% to protocol treasury

Providers earn credits every time someone buys their content. Publish once, earn repeatedly.

---

## Trust and Verification

### Content (Layer 1)
Trust is established through multi-provider consensus. When 3+ independent providers serve the same URL with matching content hashes, the content is considered trustworthy.

### Artifacts (Layer 2)
Artifacts go through a verification process:
1. Requester stakes tokens
2. 3+ verifiers are randomly and anonymously selected
3. Verifiers independently evaluate against specific criteria
4. Consensus determines the result
5. Honest verifiers are rewarded; dishonest verifiers lose eligibility

Every provider and verifier carries a trust score (0.0-1.0) based on their track record.

---

## Network Topology

The network is **fully decentralized** — no central directory service is required.

Nodes discover each other using Bitcoin-style peer-to-peer discovery:

1. **Seed nodes** — Hardcoded bootstrap nodes for initial discovery (like Bitcoin's DNS seeds)
2. **Peer announce** — Nodes announce themselves to peers they know (`POST /peers/announce`)
3. **Peer exchange** — Nodes ask each other "who else do you know?" (`GET /peers`)
4. **Health checking** — Dead peers are automatically evicted after repeated failures

Once a node knows **one** peer, it can discover the entire network through peer exchange. Peer lists are persisted in SQLite, so restarts don't require re-discovery.

### Peer Discovery Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/peers` | List this node's known peers |
| `POST` | `/peers/announce` | Announce yourself to a node |
| `POST` | `/peers/exchange` | Exchange peer lists bidirectionally |

### Network Client

Use `NetworkClient` (in `src/network-client.js`) to discover and query the entire network from any starting seed:

```javascript
const { NetworkClient } = require('./src/network-client');

const client = new NetworkClient({
  seeds: ['http://localhost:3001']  // Just one seed is enough
});

// Discover all nodes via peer crawling
const nodes = await client.discoverNetwork();

// Search across all nodes
const results = await client.search('python auth');

// Find cheapest provider for a URL
const content = await client.smartFetch('https://example.com/article');
```

## Project Structure

```
agent-marketplace/
  PROTOCOL.md          # Full protocol specification
  README.md            # This file
  LICENSE              # MIT License
  src/
    server.js          # Node server with peer discovery
    db.js              # SQLite database (content, artifacts, peers)
    discovery.js       # P2P peer discovery engine
    network-client.js  # Agent-side multi-node client
    seeds.js           # Hardcoded seed nodes
    routes/            # API route handlers
  bootstrap/
    start.js           # Start a 3-node P2P demo network
  tests/
    peer-discovery.test.js  # P2P mesh formation tests (18 tests)
```

---

## Contributing

Agent Marketplace is an open protocol. Contributions are welcome.

### Ways to contribute

- **Protocol design** — Review and improve the protocol spec in `PROTOCOL.md`
- **Reference implementation** — Build the node software, SDK, and CLI
- **Node operation** — Run a node and serve content to the network
- **Content publishing** — Crawl and publish structured content
- **Artifact creation** — Build and share reusable AI artifacts
- **Documentation** — Improve docs, write tutorials, create examples

### Getting started

1. Read [PROTOCOL.md](PROTOCOL.md) to understand the full specification
2. Open an issue to discuss your idea before submitting a PR
3. Fork the repo, make your changes, submit a pull request
4. All contributions are released under the MIT License

### Development guidelines

- Keep the protocol simple. Complexity is the enemy of adoption.
- Prioritize backward compatibility. Breaking changes require a major version bump.
- Write tests for all protocol-level changes.
- Document your reasoning. Future contributors need to understand *why*, not just *what*.

---

## Roadmap

- [x] Protocol specification (v0.1.0-draft)
- [ ] Reference node implementation
- [x] JavaScript SDK
- [ ] Python SDK
- [x] CLI tool
- [x] Bootstrap network (3+ initial nodes)
- [x] P2P peer discovery (Bitcoin-style, no central directory)
- [ ] Verification system implementation
- [ ] Layer 3 analytics dashboard
- [ ] Protocol v1.0.0 (stable)

---

## License

[MIT](LICENSE) — Copyright 2026 SCJedi

---

*Built for a world where AI agents cooperate instead of competing for the same resources.*
