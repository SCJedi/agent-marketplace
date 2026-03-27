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

// Dashboard password — set via env var or auto-generated on first run
const DASH_PASSWORD_FILE = path.join(path.dirname(CONFIG_PATH), 'dashboard-password.json');

function getDashboardPassword() {
  // 1. Check env var
  if (process.env.DASHBOARD_PASSWORD) return process.env.DASHBOARD_PASSWORD;
  // 2. Check saved password file
  try {
    const saved = JSON.parse(fs.readFileSync(DASH_PASSWORD_FILE, 'utf8'));
    if (saved.password) return saved.password;
  } catch (e) { /* no saved password */ }
  // 3. Auto-generate and save
  const password = crypto.randomBytes(12).toString('base64url');
  try {
    const dir = path.dirname(DASH_PASSWORD_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DASH_PASSWORD_FILE, JSON.stringify({ password, createdAt: new Date().toISOString() }));
  } catch (e) { /* best effort */ }
  console.log(`\n  Dashboard password (auto-generated): ${password}\n`);
  return password;
}

const dashboardPassword = getDashboardPassword();

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
  // Auth check for dashboard — token-based via query param or header
  // The dashboard HTML is served with a login page if not authenticated
  function checkDashAuth(request, reply) {
    // Allow unauthenticated access to the login endpoint
    if (request.url === '/dashboard/api/login') return;
    // Check for auth token in header or query
    const token = request.headers['x-dashboard-token'] || request.query._token;
    if (token === dashboardPassword) return;
    // No token or wrong token — reject API calls
    if (request.url.startsWith('/dashboard/api/')) {
      reply.code(401).send({ success: false, data: null, error: 'Dashboard password required' });
      return reply;
    }
  }

  // Add auth check to all dashboard API routes
  fastify.addHook('preHandler', async (request, reply) => {
    if (request.url.startsWith('/dashboard/api/') && request.url !== '/dashboard/api/login') {
      const token = request.headers['x-dashboard-token'] || request.query._token;
      if (token !== dashboardPassword) {
        return reply.code(401).send({ success: false, data: null, error: 'Dashboard password required' });
      }
    }
  });

  // Login endpoint — validates password, returns token
  fastify.post('/dashboard/api/login', async (request, reply) => {
    const { password } = request.body || {};
    if (password === dashboardPassword) {
      return { success: true, data: { token: dashboardPassword }, error: null };
    }
    return reply.code(401).send({ success: false, data: null, error: 'Wrong password' });
  });

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
        price: parseFloat(price) || 0,
        visibility: visibility || 'public'
      });

      logActivity('publish', `Published: ${parsedUrl.href}`);

      // Record publish transaction
      try {
        db.recordTransaction({
          type: 'content_publish',
          content_id: record ? record.id : null,
          content_url: parsedUrl.href,
          seller_key: db.hashKey(null),
          listed_price: parseFloat(price) || 0,
          paid_price: 0,
          payment_method: 'free',
          node_id: process.env.NODE_NAME || 'local'
        });
      } catch (txErr) {
        // Non-critical — don't fail the publish
      }

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

  // PATCH /dashboard/api/content/:id — update price or visibility
  fastify.patch('/dashboard/api/content/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const { price, visibility } = request.body || {};
      const updates = {};
      if (price !== undefined) updates.price = parseFloat(price);
      if (visibility !== undefined) updates.visibility = visibility;

      const result = db.contentUpdate(id, updates, null);
      if (!result) {
        return reply.code(404).send({ success: false, data: null, error: 'Content not found' });
      }

      logActivity('update', `Updated content: price=${updates.price}, visibility=${updates.visibility}`);
      return { success: true, data: result, error: null };
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
        price: 0,
        visibility: visibility || 'private',
        owner_key: ownerKey,
      });

      logActivity('publish-file', `Published file: ${basename}`);

      try {
        db.recordTransaction({
          type: 'content_publish',
          content_id: record ? record.id : null,
          content_url: fileUrl,
          seller_key: db.hashKey(ownerKey),
          listed_price: 0,
          paid_price: 0,
          payment_method: 'free',
          node_id: process.env.NODE_NAME || 'local'
        });
      } catch (txErr) { /* non-critical */ }

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
        price: 0,
        visibility: visibility || 'private',
      });

      logActivity('publish-text', `Published text: ${cleanTitle}`);

      try {
        db.recordTransaction({
          type: 'content_publish',
          content_id: record ? record.id : null,
          content_url: fileUrl,
          seller_key: db.hashKey(null),
          listed_price: 0,
          paid_price: 0,
          payment_method: 'free',
          node_id: process.env.NODE_NAME || 'local'
        });
      } catch (txErr) { /* non-critical */ }

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
            price: 0,
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

  // GET /dashboard/api/market-price — average price of recent items by type/category
  fastify.get('/dashboard/api/market-price', async (request, reply) => {
    try {
      const { type, category } = request.query;
      const d = db.getDb();
      let avg = 0;
      let count = 0;

      if (type === 'artifact' && category) {
        const row = d.prepare(`
          SELECT AVG(price) as avg_price, COUNT(*) as cnt
          FROM artifacts WHERE category = ? AND price > 0
        `).get(category);
        if (row) { avg = row.avg_price || 0; count = row.cnt || 0; }
      } else if (type === 'artifact') {
        const row = d.prepare(`
          SELECT AVG(price) as avg_price, COUNT(*) as cnt
          FROM artifacts WHERE price > 0
        `).get();
        if (row) { avg = row.avg_price || 0; count = row.cnt || 0; }
      } else {
        // Default: content
        const row = d.prepare(`
          SELECT AVG(price) as avg_price, COUNT(*) as cnt
          FROM content WHERE price > 0
        `).get();
        if (row) { avg = row.avg_price || 0; count = row.cnt || 0; }
      }

      return {
        success: true,
        data: {
          averagePrice: parseFloat(avg.toFixed(6)),
          sampleSize: count,
          type: type || 'content',
          category: category || null
        },
        error: null
      };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // ══════════════════════════════════════════
  //  ANALYTICS API (Layer 3)
  // ══════════════════════════════════════════

  // GET /dashboard/api/analytics/overview — high-level node stats
  fastify.get('/dashboard/api/analytics/overview', async (request, reply) => {
    try {
      const d = db.getDb();

      const totalContent = d.prepare('SELECT COUNT(*) as cnt FROM content').get().cnt;
      const totalArtifacts = d.prepare('SELECT COUNT(*) as cnt FROM artifacts').get().cnt;
      const totalSearches = d.prepare('SELECT COUNT(*) as cnt FROM search_log').get().cnt;

      // Unique URLs in content table
      const uniqueUrls = d.prepare('SELECT COUNT(DISTINCT url) as cnt FROM content').get().cnt;

      // Unique search terms
      const uniqueSearchTerms = d.prepare('SELECT COUNT(DISTINCT query) as cnt FROM search_log').get().cnt;

      // Peers connected
      const peersConnected = db.getPeerCount();

      // Content growth rate: items per day over last 7 days
      const contentLast7 = d.prepare(`
        SELECT COUNT(*) as cnt FROM content
        WHERE fetched_at >= datetime('now', '-7 days')
      `).get().cnt;
      const contentGrowthRate = parseFloat((contentLast7 / 7).toFixed(1));

      // Search growth rate: searches per day over last 7 days
      const searchLast7 = d.prepare(`
        SELECT COUNT(*) as cnt FROM search_log
        WHERE timestamp >= datetime('now', '-7 days')
      `).get().cnt;
      const searchGrowthRate = parseFloat((searchLast7 / 7).toFixed(1));

      // Data Value Score (0-100)
      // Content volume: 0-20 (log scale, cap at 1000)
      const volScore = Math.min(20, Math.round((Math.log10(Math.max(totalContent, 1)) / 3) * 20));
      // Search diversity: 0-20 (unique terms, log scale)
      const divScore = Math.min(20, Math.round((Math.log10(Math.max(uniqueSearchTerms, 1)) / 3) * 20));
      // Demand data: 0-20 (total searches, log scale)
      const demandScore = Math.min(20, Math.round((Math.log10(Math.max(totalSearches, 1)) / 3) * 20));
      // Network connections: 0-15 (cap at 10 peers)
      const netScore = Math.min(15, Math.round((peersConnected / 10) * 15));
      // Content freshness: 0-15 (% < 24h old)
      const freshCount = d.prepare(`SELECT COUNT(*) as cnt FROM content WHERE fetched_at >= datetime('now', '-1 day')`).get().cnt;
      const freshPct = totalContent > 0 ? freshCount / totalContent : 0;
      const freshScore = Math.round(freshPct * 15);
      // Opportunity capture: 0-10 (% of top gaps filled)
      const topGaps = d.prepare(`
        SELECT query, COUNT(*) as cnt FROM search_log
        WHERE results_count = 0
        GROUP BY query ORDER BY cnt DESC LIMIT 5
      `).all();
      let gapsFilled = 0;
      for (const gap of topGaps) {
        const has = d.prepare(`SELECT COUNT(*) as cnt FROM content WHERE url LIKE ? OR content_text LIKE ?`).get(`%${gap.query}%`, `%${gap.query}%`);
        if (has.cnt > 0) gapsFilled++;
      }
      const oppScore = topGaps.length > 0 ? Math.round((gapsFilled / topGaps.length) * 10) : 0;

      const dataValueScore = volScore + divScore + demandScore + netScore + freshScore + oppScore;

      return {
        success: true,
        data: {
          totalContent,
          totalArtifacts,
          totalSearches,
          uniqueUrls,
          uniqueSearchTerms,
          peersConnected,
          contentGrowthRate,
          searchGrowthRate,
          dataValueScore: Math.min(100, dataValueScore),
          scoreBreakdown: {
            volume: volScore,
            diversity: divScore,
            demand: demandScore,
            network: netScore,
            freshness: freshScore,
            opportunity: oppScore
          }
        },
        error: null
      };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // GET /dashboard/api/analytics/demand — what agents are looking for
  fastify.get('/dashboard/api/analytics/demand', async (request, reply) => {
    try {
      const d = db.getDb();

      // Top searches with result status
      const topSearches = d.prepare(`
        SELECT query, COUNT(*) as count,
               SUM(CASE WHEN results_count > 0 THEN 1 ELSE 0 END) as with_results
        FROM search_log
        GROUP BY query ORDER BY count DESC LIMIT 20
      `).all().map(r => ({
        query: r.query,
        count: r.count,
        hasResults: r.with_results > 0
      }));

      // Unmet demand — searches with 0 results
      const unmetDemand = d.prepare(`
        SELECT query, COUNT(*) as searchCount, MAX(timestamp) as lastSearched
        FROM search_log WHERE results_count = 0
        GROUP BY query ORDER BY searchCount DESC LIMIT 10
      `).all().map(r => ({
        query: r.query,
        searchCount: r.searchCount,
        lastSearched: timeAgo(r.lastSearched)
      }));

      // Demand by category
      const catRows = d.prepare(`
        SELECT COALESCE(category_filter, 'other') as cat, COUNT(*) as cnt
        FROM search_log GROUP BY cat ORDER BY cnt DESC
      `).all();
      const demandByCategory = {};
      for (const r of catRows) demandByCategory[r.cat || 'other'] = r.cnt;

      // Demand trend (last 7 days)
      const demandTrend = d.prepare(`
        SELECT DATE(timestamp) as date, COUNT(*) as searches
        FROM search_log
        WHERE timestamp >= datetime('now', '-7 days')
        GROUP BY DATE(timestamp) ORDER BY date ASC
      `).all();

      return {
        success: true,
        data: { topSearches, unmetDemand, demandByCategory, demandTrend },
        error: null
      };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // GET /dashboard/api/analytics/supply — what the node has and what's consumed
  fastify.get('/dashboard/api/analytics/supply', async (request, reply) => {
    try {
      const d = db.getDb();

      // Top content by URL (most entries = most fetched/published)
      const topContent = d.prepare(`
        SELECT url, COUNT(*) as fetches, MAX(fetched_at) as lastFetched
        FROM content GROUP BY url ORDER BY fetches DESC LIMIT 10
      `).all().map(r => ({
        url: r.url,
        fetches: r.fetches,
        lastFetched: timeAgo(r.lastFetched)
      }));

      // Content by visibility
      let contentByVisibility = { public: 0, private: 0, whitelist: 0 };
      try {
        const visRows = d.prepare(`
          SELECT COALESCE(visibility, 'public') as vis, COUNT(*) as cnt
          FROM content GROUP BY vis
        `).all();
        for (const r of visRows) contentByVisibility[r.vis] = r.cnt;
      } catch (e) { /* old db without visibility */ }

      // Content by type (file://, http://, text://)
      const typeRows = d.prepare(`
        SELECT
          CASE
            WHEN url LIKE 'file://%' THEN 'file'
            WHEN url LIKE 'text://%' THEN 'text'
            ELSE 'web'
          END as type,
          COUNT(*) as cnt
        FROM content GROUP BY type
      `).all();
      const contentByType = {};
      for (const r of typeRows) contentByType[r.type] = r.cnt;

      // Freshness breakdown
      const freshCount = d.prepare(`SELECT COUNT(*) as cnt FROM content WHERE fetched_at >= datetime('now', '-1 day')`).get().cnt;
      const recentCount = d.prepare(`SELECT COUNT(*) as cnt FROM content WHERE fetched_at >= datetime('now', '-7 days') AND fetched_at < datetime('now', '-1 day')`).get().cnt;
      const totalContent = d.prepare(`SELECT COUNT(*) as cnt FROM content`).get().cnt;
      const staleCount = totalContent - freshCount - recentCount;

      // Supply growth (last 7 days)
      const supplyGrowth = d.prepare(`
        SELECT DATE(fetched_at) as date, COUNT(*) as items
        FROM content
        WHERE fetched_at >= datetime('now', '-7 days')
        GROUP BY DATE(fetched_at) ORDER BY date ASC
      `).all();

      return {
        success: true,
        data: {
          topContent,
          contentByVisibility,
          contentByType,
          freshness: { fresh: freshCount, recent: recentCount, stale: Math.max(0, staleCount) },
          supplyGrowth
        },
        error: null
      };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // GET /dashboard/api/analytics/opportunities — gaps where demand > supply
  fastify.get('/dashboard/api/analytics/opportunities', async (request, reply) => {
    try {
      const d = db.getDb();

      // Top unmet searches with suggestions
      const gaps = d.prepare(`
        SELECT query, COUNT(*) as searchCount, MAX(timestamp) as lastSearched
        FROM search_log WHERE results_count = 0
        GROUP BY query ORDER BY searchCount DESC LIMIT 10
      `).all();

      const opportunities = gaps.map(g => {
        // Check how many competitors serve this
        const competitors = d.prepare(`
          SELECT COUNT(DISTINCT provider_id) as cnt FROM content
          WHERE content_text LIKE ? OR url LIKE ?
        `).get(`%${g.query}%`, `%${g.query}%`);

        const value = g.searchCount >= 10 ? 'high' : g.searchCount >= 5 ? 'medium' : 'low';
        let suggestion = 'Crawl related docs and publish to capture this demand.';
        if (competitors.cnt === 0) {
          suggestion = 'No one serves this. First provider takes all the demand.';
        } else {
          suggestion = `${competitors.cnt} provider(s) have related content. Specialize to compete.`;
        }

        return {
          query: g.query,
          searchCount: g.searchCount,
          competitorCount: competitors.cnt,
          estimatedValue: value,
          suggestion,
          lastSearched: timeAgo(g.lastSearched)
        };
      });

      // Rising demand: queries growing fast (compare last 3 days vs prior 4 days)
      const risingDemand = [];
      const decliningDemand = [];
      const recentQueries = d.prepare(`
        SELECT query, COUNT(*) as cnt FROM search_log
        WHERE timestamp >= datetime('now', '-3 days')
        GROUP BY query HAVING cnt >= 2
      `).all();

      for (const q of recentQueries) {
        const prior = d.prepare(`
          SELECT COUNT(*) as cnt FROM search_log
          WHERE query = ? AND timestamp >= datetime('now', '-7 days') AND timestamp < datetime('now', '-3 days')
        `).get(q.query);

        if (prior.cnt === 0 && q.cnt >= 3) {
          risingDemand.push({ query: q.query, growth: '+new', period: '3d' });
        } else if (prior.cnt > 0) {
          const growthPct = Math.round(((q.cnt - prior.cnt) / prior.cnt) * 100);
          if (growthPct >= 50) {
            risingDemand.push({ query: q.query, growth: `+${growthPct}%`, period: '7d' });
          } else if (growthPct <= -30) {
            decliningDemand.push({ query: q.query, growth: `${growthPct}%`, period: '7d' });
          }
        }
      }

      return {
        success: true,
        data: { opportunities, risingDemand, decliningDemand },
        error: null
      };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // GET /dashboard/api/analytics/network — network-level intelligence
  fastify.get('/dashboard/api/analytics/network', async (request, reply) => {
    try {
      const d = db.getDb();
      const peers = db.getAllPeers();

      const peerActivity = peers.map(p => ({
        peer: p.name || p.endpoint,
        endpoint: p.endpoint,
        lastActive: p.last_seen ? timeAgo(p.last_seen) : 'never',
        failures: p.failures,
        status: p.failures < 3 ? 'healthy' : p.failures < 5 ? 'degraded' : 'down'
      }));

      // Network growth this week
      const contentThisWeek = d.prepare(`
        SELECT COUNT(*) as cnt FROM content WHERE fetched_at >= datetime('now', '-7 days')
      `).get().cnt;
      const searchesThisWeek = d.prepare(`
        SELECT COUNT(*) as cnt FROM search_log WHERE timestamp >= datetime('now', '-7 days')
      `).get().cnt;
      const peersThisWeek = d.prepare(`
        SELECT COUNT(*) as cnt FROM peers WHERE added_at >= datetime('now', '-7 days')
      `).get().cnt;

      return {
        success: true,
        data: {
          peerActivity,
          networkGrowth: {
            nodesThisWeek: peersThisWeek,
            contentThisWeek,
            searchesThisWeek
          }
        },
        error: null
      };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // Helper: relative time ago
  function timeAgo(dateStr) {
    if (!dateStr) return 'never';
    const now = Date.now();
    const then = new Date(dateStr + (dateStr.includes('Z') ? '' : 'Z')).getTime();
    const diffMs = now - then;
    if (diffMs < 0) return 'just now';
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

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

  // ── Ledger Dashboard API ──

  // GET /dashboard/api/ledger — recent transactions for dashboard
  fastify.get('/dashboard/api/ledger', async (request, reply) => {
    try {
      const limit = parseInt(request.query.limit, 10) || 50;
      const transactions = db.getRecentTransactions(limit);
      const stats = db.getTransactionStats();

      const publicTx = transactions.map(tx => ({
        id: tx.id,
        type: tx.type,
        content_url: tx.content_url,
        buyer: tx.buyer_key || 'anonymous',
        seller: tx.seller_key || 'anonymous',
        listed_price: tx.listed_price,
        paid_price: tx.paid_price,
        payment_method: tx.payment_method,
        timestamp: tx.timestamp,
        node: tx.node_id
      }));

      return {
        success: true,
        data: { transactions: publicTx, stats },
        error: null
      };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // GET /dashboard/api/reputation — this node's reputation
  fastify.get('/dashboard/api/reputation', async (request, reply) => {
    try {
      const d = db.getDb();
      // Get the first API key as this node's identity
      const keys = d.prepare('SELECT * FROM api_keys LIMIT 1').all();
      if (keys.length === 0) {
        return {
          success: true,
          data: {
            key: 'not-configured',
            role: 'unknown',
            totalTransactions: 0,
            trustScore: 0,
            asProvider: { totalSales: 0, totalRevenue: 0, uniqueBuyers: 0, contentPublished: 0, firstSeen: null },
            asBuyer: { totalPurchases: 0, totalSpent: 0, uniqueProviders: 0, firstSeen: null },
            history: 'new'
          },
          error: null
        };
      }
      const hashedKey = db.hashKey(keys[0].key);
      const reputation = db.getReputationScore(hashedKey);
      return { success: true, data: reputation, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // ═══════════════════════════════════════════
  //  VERIFICATION SYSTEM
  // ═══════════════════════════════════════════

  const { runChecks } = require('../verification/checks');

  // GET /dashboard/api/verify/status — am I a verifier? what are my stats?
  fastify.get('/dashboard/api/verify/status', async (request, reply) => {
    try {
      const d = db.getDb();
      const keys = d.prepare('SELECT * FROM api_keys LIMIT 1').all();
      const nodeId = keys.length > 0 ? keys[0].owner_id : null;

      // Check if this node is in the verifier pool
      let verifier = null;
      if (nodeId) {
        verifier = d.prepare('SELECT * FROM verifier_pool WHERE endpoint LIKE ? AND active = 1').get(`%${nodeId}%`);
      }
      // Also check by any active entry (single-node dashboard context)
      if (!verifier) {
        const allActive = d.prepare('SELECT * FROM verifier_pool WHERE active = 1').all();
        verifier = allActive.length > 0 ? allActive[0] : null;
      }

      // Count pending verification requests
      const pendingCount = d.prepare("SELECT COUNT(*) as cnt FROM verification_requests WHERE status = 'pending'").get().cnt;

      // Get verification stats for content on this node
      const verifiedCount = d.prepare('SELECT COUNT(*) as cnt FROM artifacts WHERE verified = 1').get().cnt;
      const totalArtifacts = d.prepare('SELECT COUNT(*) as cnt FROM artifacts').get().cnt;

      // Get content verification status summary
      const contentWithVerification = d.prepare(`
        SELECT c.id, c.url, vr.status as verification_status
        FROM content c
        LEFT JOIN verification_requests vr ON vr.artifact_id = c.id
      `).all();

      return {
        success: true,
        data: {
          isVerifier: !!verifier,
          verifier: verifier ? {
            id: verifier.id,
            totalVerifications: verifier.total_verifications,
            agreementRate: verifier.agreement_rate,
            stakeAmount: verifier.stake_amount
          } : null,
          pendingCount,
          verifiedArtifacts: verifiedCount,
          totalArtifacts,
          nodeId
        },
        error: null
      };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // POST /dashboard/api/verify/join — join the verifier pool from dashboard
  fastify.post('/dashboard/api/verify/join', async (request, reply) => {
    try {
      const d = db.getDb();
      const keys = d.prepare('SELECT * FROM api_keys LIMIT 1').all();
      const nodeId = keys.length > 0 ? keys[0].owner_id : 'dashboard-user';

      // Build endpoint from node context
      const config = loadConfig();
      const nodeName = config ? config.nodeName : 'local';
      const endpoint = `http://localhost:${process.env.PORT || 3001}/verify`;

      // Check if already in pool
      const existing = d.prepare('SELECT * FROM verifier_pool WHERE endpoint = ? AND active = 1').get(endpoint);
      if (existing) {
        return { success: true, data: { verifier: existing, message: 'Already in verifier pool' }, error: null };
      }

      const verifier = db.joinVerifierPool(endpoint, 0);
      logActivity('verify', `Joined verifier pool as ${nodeName}`);

      return reply.code(201).send({ success: true, data: { verifier }, error: null });
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // POST /dashboard/api/verify/leave — leave the verifier pool
  fastify.post('/dashboard/api/verify/leave', async (request, reply) => {
    try {
      const body = request.body || {};
      if (!body.verifier_id) {
        return reply.code(400).send({ success: false, data: null, error: 'verifier_id is required' });
      }
      const result = db.leaveVerifierPool(body.verifier_id);
      if (!result) {
        return reply.code(404).send({ success: false, data: null, error: 'Verifier not found' });
      }
      logActivity('verify', 'Left verifier pool');
      return { success: true, data: { message: 'Left verifier pool' }, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // GET /dashboard/api/verify/pending — pending verification jobs
  fastify.get('/dashboard/api/verify/pending', async (request, reply) => {
    try {
      const d = db.getDb();
      const pending = d.prepare(`
        SELECT vr.*, c.url, c.content_metadata
        FROM verification_requests vr
        LEFT JOIN content c ON c.id = vr.artifact_id
        WHERE vr.status = 'pending'
        ORDER BY vr.created_at ASC
      `).all();

      // Enrich with content preview
      const enriched = pending.map(p => {
        let title = p.url || p.artifact_id;
        try {
          const meta = typeof p.content_metadata === 'string' ? JSON.parse(p.content_metadata) : p.content_metadata;
          if (meta && (meta.title || meta.name || meta.filename)) {
            title = meta.title || meta.name || meta.filename;
          }
        } catch (e) { /* ignore */ }
        return {
          ...p,
          title,
          publisher_short: (p.publisher_id || '').substring(0, 8) + '...'
        };
      });

      return { success: true, data: enriched, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // POST /dashboard/api/verify/request/:id — request verification for content
  fastify.post('/dashboard/api/verify/request/:id', async (request, reply) => {
    try {
      const contentId = request.params.id;
      const d = db.getDb();

      // Check content exists
      const content = d.prepare('SELECT * FROM content WHERE id = ?').get(contentId);
      if (!content) {
        return reply.code(404).send({ success: false, data: null, error: 'Content not found' });
      }

      // Check if verification already requested
      const existing = d.prepare("SELECT * FROM verification_requests WHERE artifact_id = ? AND status IN ('pending', 'passed')").get(contentId);
      if (existing) {
        return reply.code(409).send({
          success: false, data: null,
          error: existing.status === 'passed' ? 'Content already verified' : 'Verification already pending'
        });
      }

      // Ensure an artifact record exists for this content (FK constraint requires it)
      const artifactExists = d.prepare('SELECT id FROM artifacts WHERE id = ?').get(contentId);
      if (!artifactExists) {
        let contentName = content.url || contentId;
        let contentMeta = {};
        try {
          contentMeta = typeof content.content_metadata === 'string' ? JSON.parse(content.content_metadata) : (content.content_metadata || {});
        } catch (e) { /* ignore */ }
        const name = contentMeta.title || contentMeta.name || contentMeta.filename || contentName;
        const slug = contentId; // use content ID as slug for auto-created artifacts
        try {
          d.prepare(`INSERT INTO artifacts (id, slug, name, category, description, verified) VALUES (?, ?, ?, ?, ?, 0)`)
            .run(contentId, slug, name, 'content', 'Auto-created for verification of: ' + (content.url || contentId));
        } catch (e) {
          // Slug collision — try with random suffix
          d.prepare(`INSERT INTO artifacts (id, slug, name, category, description, verified) VALUES (?, ?, ?, ?, ?, 0)`)
            .run(contentId, slug + '-' + Date.now(), name, 'content', 'Auto-created for verification of: ' + (content.url || contentId));
        }
      }

      // Get publisher identity
      const keys = d.prepare('SELECT * FROM api_keys LIMIT 1').all();
      const publisherId = keys.length > 0 ? keys[0].owner_id : (content.provider_id || 'dashboard-user');

      // Create verification request
      const verificationRequest = db.createVerificationRequest(contentId, publisherId, 0);

      // Try to assign verifiers (may not have enough in pool)
      let assignedVerifiers = [];
      try {
        assignedVerifiers = db.selectVerifiersForRequest(3, publisherId, verificationRequest.id);
      } catch (e) {
        // Pool may be empty — that's OK, request is still created as pending
      }

      logActivity('verify', `Requested verification for ${content.url || contentId}`);

      return reply.code(201).send({
        success: true,
        data: {
          request: verificationRequest,
          assignedVerifiers: assignedVerifiers.length,
          message: assignedVerifiers.length > 0
            ? `${assignedVerifiers.length} verifiers assigned`
            : 'Request created. Waiting for verifiers to join the pool.'
        },
        error: null
      });
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // GET /dashboard/api/verify/check/:id — run automated checks on content
  fastify.get('/dashboard/api/verify/check/:id', async (request, reply) => {
    try {
      const contentId = request.params.id;
      const content = db.getContentById(contentId);
      if (!content) {
        return reply.code(404).send({ success: false, data: null, error: 'Content not found' });
      }

      const checkResults = runChecks(content);
      return { success: true, data: checkResults, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // POST /dashboard/api/verify/submit/:id — submit verification verdict from dashboard
  fastify.post('/dashboard/api/verify/submit/:id', async (request, reply) => {
    try {
      const requestId = request.params.id;
      const body = request.body || {};
      const d = db.getDb();

      // Validate the request exists and is pending
      const vr = d.prepare('SELECT * FROM verification_requests WHERE id = ?').get(requestId);
      if (!vr) {
        return reply.code(404).send({ success: false, data: null, error: 'Verification request not found' });
      }
      if (vr.status !== 'pending') {
        return reply.code(409).send({ success: false, data: null, error: `Verification already ${vr.status}` });
      }

      if (body.passed === undefined) {
        return reply.code(400).send({ success: false, data: null, error: 'passed (boolean) is required' });
      }

      // Get or create verifier identity for this dashboard user
      const keys = d.prepare('SELECT * FROM api_keys LIMIT 1').all();
      const nodeId = keys.length > 0 ? keys[0].owner_id : 'dashboard-user';
      const endpoint = `http://localhost:${process.env.PORT || 3001}/verify`;

      // Find or create verifier in pool
      let verifier = d.prepare('SELECT * FROM verifier_pool WHERE endpoint = ? AND active = 1').get(endpoint);
      if (!verifier) {
        verifier = db.joinVerifierPool(endpoint, 0);
      }

      // Run automated checks for the report
      const content = db.getContentById(vr.artifact_id);
      let autoChecks = null;
      if (content) {
        autoChecks = runChecks(content);
      }

      const report = {
        notes: body.notes || '',
        automated_checks: autoChecks,
        verdict: body.passed ? 'approve' : 'reject',
        submitted_from: 'dashboard'
      };

      const result = db.submitVerificationResult(requestId, verifier.id, body.passed, report);

      // Record as transaction
      try {
        const publisherKey = vr.publisher_id || 'unknown';
        db.recordTransaction({
          type: 'verification',
          content_id: vr.artifact_id,
          buyer_key: db.hashKey(publisherKey),
          seller_key: db.hashKey(verifier.id),
          paid_price: 0,
          payment_method: 'free',
          metadata: JSON.stringify({
            result: body.passed ? 'pass' : 'fail',
            request_id: requestId,
            checks: autoChecks
          })
        });
      } catch (e) {
        // Transaction recording is non-critical
        request.log.warn('Failed to record verification transaction:', e.message);
      }

      logActivity('verify', `Submitted verification for request ${requestId}: ${body.passed ? 'APPROVED' : 'REJECTED'}`);

      // Check if verification is now finalized
      const updatedRequest = d.prepare('SELECT * FROM verification_requests WHERE id = ?').get(requestId);

      return reply.code(201).send({
        success: true,
        data: {
          result,
          requestStatus: updatedRequest.status,
          message: updatedRequest.status === 'pending'
            ? 'Verdict submitted. Waiting for more verifiers.'
            : `Verification ${updatedRequest.status}. Content is now ${updatedRequest.status === 'passed' ? 'verified' : 'rejected'}.`
        },
        error: null
      });
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });

  // GET /dashboard/api/verify/content-status — verification status for all content
  fastify.get('/dashboard/api/verify/content-status', async (request, reply) => {
    try {
      const d = db.getDb();
      // Get the latest verification request status for each content item
      const statuses = d.prepare(`
        SELECT c.id, c.url,
          vr.status as verification_status,
          vr.id as request_id,
          vr.created_at as requested_at
        FROM content c
        LEFT JOIN verification_requests vr ON vr.artifact_id = c.id
          AND vr.created_at = (
            SELECT MAX(vr2.created_at) FROM verification_requests vr2 WHERE vr2.artifact_id = c.id
          )
        ORDER BY c.fetched_at DESC
      `).all();

      // Build a map: content_id -> { status, request_id }
      const statusMap = {};
      for (const row of statuses) {
        statusMap[row.id] = {
          status: row.verification_status || 'unverified',
          requestId: row.request_id || null,
          requestedAt: row.requested_at || null
        };
      }

      return { success: true, data: statusMap, error: null };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ success: false, data: null, error: err.message });
    }
  });
}

module.exports = dashboardRoutes;
