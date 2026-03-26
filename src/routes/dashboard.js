'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { execSync } = require('child_process');
const db = require('../db');

// Simple config file for first-run state
const CONFIG_PATH = process.env.DASHBOARD_CONFIG || path.join(__dirname, '..', '..', 'data', 'dashboard-config.json');
const DUCKDNS_CONFIG_PATH = path.join(path.dirname(CONFIG_PATH), 'duckdns-config.json');

// ── Network info cache ──
let cachedPublicIp = null;
let publicIpFetchedAt = 0;
const PUBLIC_IP_CACHE_MS = 5 * 60 * 1000; // 5 minutes

let cachedPortForwarding = null;
let portForwardingCheckedAt = 0;
const PORT_FWD_CACHE_MS = 60 * 1000; // 1 minute

// DuckDNS updater interval
let duckDnsInterval = null;

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        candidates.push({ address: iface.address, name });
      }
    }
  }
  if (candidates.length === 0) return '127.0.0.1';
  // Prefer typical LAN addresses (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
  const lan = candidates.find(c =>
    c.address.startsWith('192.168.') ||
    c.address.startsWith('10.') ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(c.address)
  );
  return lan ? lan.address : candidates[0].address;
}

async function getPublicIp() {
  const now = Date.now();
  if (cachedPublicIp && (now - publicIpFetchedAt) < PUBLIC_IP_CACHE_MS) {
    return cachedPublicIp;
  }
  try {
    const resp = await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(5000) });
    if (resp.ok) {
      cachedPublicIp = (await resp.text()).trim();
      publicIpFetchedAt = now;
    }
  } catch (e) {
    // keep stale cache if available
  }
  return cachedPublicIp || null;
}

async function checkPortForwarding(publicIp, port) {
  const now = Date.now();
  if (cachedPortForwarding !== null && (now - portForwardingCheckedAt) < PORT_FWD_CACHE_MS) {
    return cachedPortForwarding;
  }
  if (!publicIp) {
    cachedPortForwarding = false;
    portForwardingCheckedAt = now;
    return false;
  }
  try {
    const resp = await fetch(`http://${publicIp}:${port}/health`, { signal: AbortSignal.timeout(5000) });
    cachedPortForwarding = resp.ok;
  } catch (e) {
    cachedPortForwarding = false;
  }
  portForwardingCheckedAt = now;
  return cachedPortForwarding;
}

function getGatewayIp() {
  const localIp = getLocalIp();
  // Common gateway: replace last octet with 1
  const parts = localIp.split('.');
  if (parts.length === 4) {
    return parts[0] + '.' + parts[1] + '.' + parts[2] + '.1';
  }
  return '192.168.1.1';
}

function loadDuckDnsConfig() {
  try {
    if (fs.existsSync(DUCKDNS_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(DUCKDNS_CONFIG_PATH, 'utf8'));
    }
  } catch (e) { /* ignore */ }
  return null;
}

function saveDuckDnsConfig(config) {
  const dir = path.dirname(DUCKDNS_CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DUCKDNS_CONFIG_PATH, JSON.stringify(config, null, 2));
}

async function updateDuckDns(domain, token) {
  try {
    const resp = await fetch(
      `https://www.duckdns.org/update?domains=${encodeURIComponent(domain)}&token=${encodeURIComponent(token)}&ip=`,
      { signal: AbortSignal.timeout(10000) }
    );
    const text = await resp.text();
    return text.trim() === 'OK';
  } catch (e) {
    return false;
  }
}

function startDuckDnsUpdater() {
  if (duckDnsInterval) clearInterval(duckDnsInterval);
  const config = loadDuckDnsConfig();
  if (!config || !config.domain || !config.token || !config.active) return;
  // Update immediately, then every 5 min
  updateDuckDns(config.domain, config.token);
  duckDnsInterval = setInterval(() => {
    updateDuckDns(config.domain, config.token);
  }, 5 * 60 * 1000);
}

// Start DuckDNS updater on module load if configured
startDuckDnsUpdater();

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (e) { /* ignore */ }
  return null;
}

function saveConfig(config) {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// In-memory activity log (recent requests)
const activityLog = [];
const MAX_ACTIVITY = 200;

function logActivity(type, detail) {
  activityLog.unshift({
    type,
    detail,
    timestamp: new Date().toISOString()
  });
  if (activityLog.length > MAX_ACTIVITY) activityLog.length = MAX_ACTIVITY;
}

async function dashboardRoutes(fastify, options) {
  // Serve the dashboard HTML
  fastify.get('/dashboard', async (request, reply) => {
    const htmlPath = path.join(__dirname, '..', '..', 'dashboard', 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    reply.type('text/html').send(html);
  });

  // --- Dashboard API ---

  // GET /dashboard/api/status — overall node status
  fastify.get('/dashboard/api/status', async (request, reply) => {
    try {
      const config = loadConfig();
      const d = db.getDb();

      const contentCount = d.prepare('SELECT COUNT(*) as cnt FROM content').get().cnt;
      let privateCount = 0;
      try { privateCount = d.prepare("SELECT COUNT(*) as cnt FROM content WHERE visibility = 'private'").get().cnt; } catch (e) { /* old db */ }
      const artifactCount = d.prepare('SELECT COUNT(*) as cnt FROM artifacts').get().cnt;
      const peerCount = db.getPeerCount();
      const peers = db.getPeers(true);

      // Today's activity count
      const todayActivity = activityLog.filter(a => {
        const today = new Date().toISOString().slice(0, 10);
        return a.timestamp.startsWith(today);
      }).length;

      return {
        success: true,
        data: {
          configured: !!config,
          nodeName: config ? config.nodeName : null,
          specialty: config ? config.specialty : null,
          contentCount,
          privateCount,
          artifactCount,
          peerCount,
          activePeers: peers.length,
          todayActivity,
          uptime: process.uptime(),
          startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString()
        },
        error: null
      };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // GET /dashboard/api/content — list content with stats
  fastify.get('/dashboard/api/content', async (request, reply) => {
    try {
      const d = db.getDb();
      const limit = parseInt(request.query.limit, 10) || 50;
      const offset = parseInt(request.query.offset, 10) || 0;
      let items;
      try {
        items = d.prepare(`
          SELECT id, url, visibility, price, provider_id, fetched_at, content_hash, content_metadata
          FROM content ORDER BY fetched_at DESC LIMIT ? OFFSET ?
        `).all(limit, offset);
      } catch (e) {
        // Fallback for databases without visibility column
        items = d.prepare(`
          SELECT id, url, 'public' as visibility, price, provider_id, fetched_at, content_hash, content_metadata
          FROM content ORDER BY fetched_at DESC LIMIT ? OFFSET ?
        `).all(limit, offset);
      }

      const total = d.prepare('SELECT COUNT(*) as cnt FROM content').get().cnt;

      return { success: true, data: { items, total }, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // GET /dashboard/api/peers — list peers with health
  fastify.get('/dashboard/api/peers', async (request, reply) => {
    try {
      const peers = db.getAllPeers();
      const peerList = peers.map(p => ({
        endpoint: p.endpoint,
        name: p.name || 'Unknown Node',
        specialty: p.specialty,
        lastSeen: p.last_seen,
        failures: p.failures,
        status: p.failures < 3 ? 'healthy' : p.failures < 5 ? 'degraded' : 'down'
      }));
      return { success: true, data: peerList, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // GET /dashboard/api/activity — recent activity log
  fastify.get('/dashboard/api/activity', async (request, reply) => {
    try {
      const limit = parseInt(request.query.limit, 10) || 50;
      return { success: true, data: activityLog.slice(0, limit), error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // POST /dashboard/api/setup — first-run wizard
  fastify.post('/dashboard/api/setup', async (request, reply) => {
    try {
      const { nodeName, specialty, seedPeer } = request.body || {};
      if (!nodeName) {
        return reply.code(400).send({ success: false, data: null, error: 'Node name is required' });
      }

      const config = {
        nodeName: nodeName.trim(),
        specialty: specialty || 'general',
        setupCompleted: true,
        setupAt: new Date().toISOString()
      };

      saveConfig(config);

      // If a seed peer was provided, try to connect
      if (seedPeer && seedPeer.trim()) {
        const endpoint = seedPeer.trim();
        try {
          const resp = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(5000) });
          if (resp.ok) {
            db.addPeer(endpoint, null, null, 'dashboard-setup');
            db.updatePeerSeen(endpoint);
            logActivity('peer_added', `Connected to seed peer: ${endpoint}`);
          } else {
            return reply.code(200).send({
              success: true,
              data: { config, peerWarning: `Seed peer at ${endpoint} responded but returned an error. Your node is running standalone.` },
              error: null
            });
          }
        } catch (e) {
          return reply.code(200).send({
            success: true,
            data: { config, peerWarning: `Could not reach seed peer at ${endpoint}. Is their node running? Your node is running standalone.` },
            error: null
          });
        }
      }

      logActivity('setup', `Node configured: ${config.nodeName}`);
      return { success: true, data: { config }, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // POST /dashboard/api/publish — publish content from GUI
  fastify.post('/dashboard/api/publish', async (request, reply) => {
    try {
      const { url, visibility, price } = request.body || {};
      if (!url) {
        return reply.code(400).send({ success: false, data: null, error: 'URL is required' });
      }

      // Validate URL
      let parsedUrl;
      try {
        parsedUrl = new URL(url);
      } catch (e) {
        return reply.code(400).send({ success: false, data: null, error: 'Invalid URL format' });
      }

      // Crawl the URL
      let contentText = '';
      let contentMetadata = {};
      try {
        const resp = await fetch(parsedUrl.href, {
          signal: AbortSignal.timeout(15000),
          headers: { 'User-Agent': 'AgentMarketplace/1.0' }
        });
        if (!resp.ok) {
          return reply.code(400).send({ success: false, data: null, error: `Failed to fetch URL: HTTP ${resp.status}` });
        }
        const html = await resp.text();

        // Extract text using JSDOM + Readability
        const { JSDOM } = require('jsdom');
        const { Readability } = require('@mozilla/readability');
        const dom = new JSDOM(html, { url: parsedUrl.href });
        const reader = new Readability(dom.window.document);
        const article = reader.parse();

        if (article) {
          contentText = article.textContent || '';
          contentMetadata = {
            title: article.title || dom.window.document.title || '',
            excerpt: article.excerpt || '',
            byline: article.byline || '',
            siteName: article.siteName || ''
          };
        } else {
          // Fallback: just get the title and body text
          contentText = dom.window.document.body ? dom.window.document.body.textContent : '';
          contentMetadata = {
            title: dom.window.document.title || ''
          };
        }
      } catch (e) {
        return reply.code(400).send({
          success: false, data: null,
          error: `Could not fetch URL: ${e.message}. Is the site accessible?`
        });
      }

      // Publish to local node
      const sourceHash = crypto.createHash('sha256').update(url).digest('hex');
      const record = db.contentPublishWithHash({
        url: parsedUrl.href,
        source_hash: sourceHash,
        content_text: contentText.slice(0, 50000), // cap at 50k chars
        content_metadata: contentMetadata,
        price: parseFloat(price) || 0.0003,
        visibility: visibility || 'public'
      });

      logActivity('publish', `Published: ${parsedUrl.href}`);

      return reply.code(201).send({ success: true, data: record, error: null });
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // POST /dashboard/api/add-peer — manually add a peer
  fastify.post('/dashboard/api/add-peer', async (request, reply) => {
    try {
      const { endpoint } = request.body || {};
      if (!endpoint) {
        return reply.code(400).send({ success: false, data: null, error: 'Peer address (endpoint) is required' });
      }

      // Validate and normalize
      let peerUrl;
      try {
        peerUrl = new URL(endpoint);
      } catch (e) {
        return reply.code(400).send({ success: false, data: null, error: 'Invalid peer address. Use format: http://address:port' });
      }

      // Health check the peer
      try {
        const resp = await fetch(`${peerUrl.origin}/health`, { signal: AbortSignal.timeout(5000) });
        if (!resp.ok) {
          return reply.code(400).send({
            success: false, data: null,
            error: `Peer responded but returned an error (HTTP ${resp.status}). Is it running Agent Marketplace?`
          });
        }
      } catch (e) {
        return reply.code(400).send({
          success: false, data: null,
          error: `Can't connect to peer at ${peerUrl.origin}. Is their node running?`
        });
      }

      const peer = db.addPeer(peerUrl.origin, null, null, 'dashboard-manual');
      db.updatePeerSeen(peerUrl.origin);
      logActivity('peer_added', `Manually added peer: ${peerUrl.origin}`);

      return { success: true, data: peer, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // GET /dashboard/api/config — current config
  fastify.get('/dashboard/api/config', async (request, reply) => {
    try {
      const config = loadConfig();
      return { success: true, data: config, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // POST /dashboard/api/config — update config
  fastify.post('/dashboard/api/config', async (request, reply) => {
    try {
      const { nodeName, specialty } = request.body || {};
      const existing = loadConfig() || {};
      if (nodeName) existing.nodeName = nodeName.trim();
      if (specialty) existing.specialty = specialty;
      saveConfig(existing);
      logActivity('config', `Config updated`);
      return { success: true, data: existing, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // GET /dashboard/api/keys — list API keys
  fastify.get('/dashboard/api/keys', async (request, reply) => {
    try {
      const d = db.getDb();
      const keys = d.prepare('SELECT key, owner_id, owner_type, created_at FROM api_keys ORDER BY created_at DESC').all();
      // Mask keys for display
      const masked = keys.map(k => ({
        key: k.key.slice(0, 8) + '...' + k.key.slice(-4),
        fullKey: k.key,
        ownerId: k.owner_id,
        ownerType: k.owner_type,
        createdAt: k.created_at
      }));
      return { success: true, data: masked, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // POST /dashboard/api/keys — generate a new API key
  fastify.post('/dashboard/api/keys', async (request, reply) => {
    try {
      const { label } = request.body || {};
      const d = db.getDb();
      const key = crypto.randomBytes(32).toString('hex');
      const ownerId = label || 'dashboard-user';
      d.prepare('INSERT INTO api_keys (key, owner_id, owner_type) VALUES (?, ?, ?)').run(key, ownerId, 'user');
      logActivity('key_created', `New API key created: ${key.slice(0, 8)}...`);
      return reply.code(201).send({
        success: true,
        data: { key, ownerId, ownerType: 'user', createdAt: new Date().toISOString() },
        error: null
      });
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // GET /dashboard/api/search — search from dashboard
  fastify.get('/dashboard/api/search', async (request, reply) => {
    try {
      const { q } = request.query;
      if (!q) {
        return reply.code(400).send({ success: false, data: null, error: 'Search query (q) is required' });
      }

      const contentResults = db.searchContent(q, null, null);
      const artifactResults = db.searchArtifacts(q, null, null, null, null);
      const results = [...contentResults, ...artifactResults];

      logActivity('search', `Searched: "${q}" (${results.length} results)`);

      return { success: true, data: { results, total: results.length }, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // POST /dashboard/api/publish-file — publish local file content directly (for GUI upload)
  fastify.post('/dashboard/api/publish-file', async (request, reply) => {
    try {
      const { path: displayPath, content, visibility } = request.body || {};
      if (!displayPath) {
        return reply.code(400).send({ success: false, data: null, error: 'path is required' });
      }
      if (!content) {
        return reply.code(400).send({ success: false, data: null, error: 'content is required' });
      }

      // Normalize the path to a file:/// URL
      const normalizedPath = displayPath.replace(/\\/g, '/');
      const fileUrl = normalizedPath.startsWith('file:///') ? normalizedPath : `file:///${normalizedPath}`;
      const sourceHash = crypto.createHash('sha256').update(content).digest('hex');

      // Extract basic metadata from the path
      const basename = normalizedPath.split('/').pop() || 'untitled';
      const ext = basename.includes('.') ? basename.split('.').pop() : 'text';

      // Get the first available API key as owner
      const keys = db.getDb().prepare('SELECT * FROM api_keys LIMIT 1').all();
      const ownerKey = request.headers['x-api-key'] || (keys.length > 0 ? keys[0].key : null);

      const record = db.contentPublishWithHash({
        url: fileUrl,
        source_hash: sourceHash,
        content_text: content.slice(0, 50000),
        content_metadata: JSON.stringify({
          title: basename,
          type: ext,
          size: content.length,
          publishedAt: new Date().toISOString(),
        }),
        price: 0.0001,
        visibility: visibility || 'private',
        owner_key: ownerKey,
      });

      logActivity('publish-file', `Published file: ${basename}`);
      return reply.code(201).send({ success: true, data: record, error: null });
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // POST /dashboard/api/publish-text — publish pasted text content
  fastify.post('/dashboard/api/publish-text', async (request, reply) => {
    try {
      const { title, text, visibility } = request.body || {};
      if (!title || !title.trim()) {
        return reply.code(400).send({ success: false, data: null, error: 'Title is required' });
      }
      if (!text || !text.trim()) {
        return reply.code(400).send({ success: false, data: null, error: 'Text content is required' });
      }

      const cleanTitle = title.trim();
      const fileUrl = `text://${cleanTitle}`;
      const sourceHash = crypto.createHash('sha256').update(text).digest('hex');

      const record = db.contentPublishWithHash({
        url: fileUrl,
        source_hash: sourceHash,
        content_text: text.slice(0, 50000),
        content_metadata: JSON.stringify({
          title: cleanTitle,
          type: 'text',
          size: text.length,
          publishedAt: new Date().toISOString(),
        }),
        price: 0.0001,
        visibility: visibility || 'private',
      });

      logActivity('publish-text', `Published text: ${cleanTitle}`);
      return reply.code(201).send({ success: true, data: record, error: null });
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // POST /dashboard/api/publish-batch — publish multiple files at once
  fastify.post('/dashboard/api/publish-batch', async (request, reply) => {
    try {
      const { files, visibility } = request.body || {};
      if (!files || !Array.isArray(files) || files.length === 0) {
        return reply.code(400).send({ success: false, data: null, error: 'files array is required' });
      }

      let published = 0;
      let skipped = 0;
      const errors = [];

      for (const file of files) {
        try {
          if (!file.path || !file.content) {
            skipped++;
            continue;
          }

          const normalizedPath = file.path.replace(/\\/g, '/');
          const fileUrl = normalizedPath.startsWith('file:///') ? normalizedPath : `file:///${normalizedPath}`;
          const sourceHash = crypto.createHash('sha256').update(file.content).digest('hex');
          const basename = normalizedPath.split('/').pop() || 'untitled';
          const ext = basename.includes('.') ? basename.split('.').pop() : 'text';

          db.contentPublishWithHash({
            url: fileUrl,
            source_hash: sourceHash,
            content_text: file.content.slice(0, 50000),
            content_metadata: JSON.stringify({
              title: basename,
              type: ext,
              size: file.content.length,
              publishedAt: new Date().toISOString(),
            }),
            price: 0.0001,
            visibility: visibility || 'private',
          });

          published++;
        } catch (e) {
          errors.push({ path: file.path, error: e.message });
        }
      }

      logActivity('publish-batch', `Batch published: ${published} files`);
      return reply.code(201).send({
        success: true,
        data: { published, skipped, errors },
        error: null
      });
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // DELETE /dashboard/api/content/:id — delete a content record
  fastify.delete('/dashboard/api/content/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const d = db.getDb();
      const existing = d.prepare('SELECT id FROM content WHERE id = ?').get(id);
      if (!existing) {
        return reply.code(404).send({ success: false, data: null, error: 'Content not found' });
      }
      d.prepare('DELETE FROM content WHERE id = ?').run(id);
      logActivity('delete', `Deleted content #${id}`);
      return { success: true, data: { id }, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // ── NETWORK INFO ────────────────────────────

  // GET /dashboard/api/network — full network info for sharing
  fastify.get('/dashboard/api/network', async (request, reply) => {
    try {
      const port = parseInt(process.env.PORT, 10) || 3001;
      const localIp = getLocalIp();
      const publicIp = await getPublicIp();
      const portForwardingWorking = await checkPortForwarding(publicIp, port);
      const gatewayIp = getGatewayIp();
      const duckDns = loadDuckDnsConfig();

      const result = {
        localIp,
        publicIp,
        port,
        gatewayIp,
        localAddress: `http://${localIp}:${port}`,
        publicAddress: publicIp ? `http://${publicIp}:${port}` : null,
        portForwardingWorking,
        duckDns: duckDns && duckDns.active ? {
          domain: duckDns.domain,
          fullAddress: `http://${duckDns.domain}.duckdns.org:${port}`
        } : null,
        shareInstructions: {
          sameNetwork: `http://${localIp}:${port}`,
          remote: publicIp ? `http://${publicIp}:${port}` : null
        }
      };

      return { success: true, data: result, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // POST /dashboard/api/network/recheck — force re-check port forwarding
  fastify.post('/dashboard/api/network/recheck', async (request, reply) => {
    try {
      const port = parseInt(process.env.PORT, 10) || 3001;
      // Clear cache to force fresh check
      cachedPortForwarding = null;
      portForwardingCheckedAt = 0;
      const publicIp = await getPublicIp();
      const working = await checkPortForwarding(publicIp, port);
      return { success: true, data: { portForwardingWorking: working, publicIp }, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // GET /dashboard/api/network/firewall-check — check Windows Firewall
  fastify.get('/dashboard/api/network/firewall-check', async (request, reply) => {
    try {
      const port = parseInt(process.env.PORT, 10) || 3001;
      let firewallOpen = null;
      let command = null;

      if (process.platform === 'win32') {
        try {
          const output = execSync(
            `netsh advfirewall firewall show rule name=all dir=in | findstr /i "LocalPort.*${port}"`,
            { timeout: 5000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
          );
          firewallOpen = output.trim().length > 0;
        } catch (e) {
          // findstr returns exit code 1 when no match — means port not open
          firewallOpen = false;
        }
        command = `netsh advfirewall firewall add rule name="AgentMarketplace" dir=in action=allow protocol=TCP localport=${port}`;
      } else {
        // Linux/Mac — skip firewall check
        firewallOpen = null;
      }

      return { success: true, data: { firewallOpen, port, command, platform: process.platform }, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // GET /dashboard/api/network/duckdns-check — check DuckDNS config
  fastify.get('/dashboard/api/network/duckdns-check', async (request, reply) => {
    try {
      const config = loadDuckDnsConfig();
      return { success: true, data: config, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // POST /dashboard/api/network/duckdns — save DuckDNS config and start updater
  fastify.post('/dashboard/api/network/duckdns', async (request, reply) => {
    try {
      const { domain, token } = request.body || {};
      if (!domain || !token) {
        return reply.code(400).send({ success: false, data: null, error: 'Domain and token are required' });
      }

      // Validate domain (alphanumeric and hyphens only)
      const cleanDomain = domain.trim().toLowerCase().replace(/\.duckdns\.org$/i, '');
      if (!/^[a-z0-9-]+$/.test(cleanDomain)) {
        return reply.code(400).send({ success: false, data: null, error: 'Domain must only contain letters, numbers, and hyphens' });
      }

      // Test the credentials
      const ok = await updateDuckDns(cleanDomain, token.trim());
      if (!ok) {
        return reply.code(400).send({ success: false, data: null, error: 'DuckDNS update failed. Check your domain and token.' });
      }

      const config = {
        domain: cleanDomain,
        token: token.trim(),
        active: true,
        configuredAt: new Date().toISOString()
      };
      saveDuckDnsConfig(config);
      startDuckDnsUpdater();

      logActivity('duckdns', `DuckDNS configured: ${cleanDomain}.duckdns.org`);
      return { success: true, data: { domain: cleanDomain, fullDomain: `${cleanDomain}.duckdns.org` }, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // Hook into existing routes to log activity
  fastify.addHook('onResponse', (request, reply, done) => {
    const url = request.url;
    if (url.startsWith('/dashboard')) { done(); return; }
    if (url === '/health') { done(); return; }

    if (url.startsWith('/search')) {
      logActivity('search', `Search: ${request.query.q || '?'}`);
    } else if (url.startsWith('/fetch')) {
      logActivity('fetch', `Fetch: ${request.query.url || '?'}`);
    } else if (url.startsWith('/publish')) {
      logActivity('publish', `Publish from API`);
    } else if (url.startsWith('/peers')) {
      // Don't log peer protocol chatter
    }
    done();
  });
}

module.exports = dashboardRoutes;
