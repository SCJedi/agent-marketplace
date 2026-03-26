'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../db');

// Simple config file for first-run state
const CONFIG_PATH = process.env.DASHBOARD_CONFIG || path.join(__dirname, '..', '..', 'data', 'dashboard-config.json');

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
          SELECT id, url, visibility, price, provider_id, fetched_at, content_hash
          FROM content ORDER BY fetched_at DESC LIMIT ? OFFSET ?
        `).all(limit, offset);
      } catch (e) {
        // Fallback for databases without visibility column
        items = d.prepare(`
          SELECT id, url, 'public' as visibility, price, provider_id, fetched_at, content_hash
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
      });

      logActivity('publish-file', `Published file: ${basename}`);
      return reply.code(201).send({ success: true, data: record, error: null });
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
