'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'marketplace.db');

let db;

function getDb() {
  if (!db) {
    const fs = require('fs');
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initTables();
  }
  return db;
}

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS content (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      content_text TEXT,
      content_structured TEXT,
      content_links TEXT,
      content_metadata TEXT,
      provider_id TEXT,
      price REAL DEFAULT 0,
      token_cost_saved REAL DEFAULT 0,
      content_hash TEXT,
      visibility TEXT DEFAULT 'public',
      owner_key TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_content_url ON content(url);
    CREATE INDEX IF NOT EXISTS idx_content_source_hash ON content(source_hash);
    CREATE INDEX IF NOT EXISTS idx_content_provider ON content(provider_id);

    CREATE TABLE IF NOT EXISTS rate_limits (
      provider_id TEXT NOT NULL,
      window_start TEXT NOT NULL,
      publish_count INTEGER DEFAULT 0,
      PRIMARY KEY (provider_id, window_start)
    );

    CREATE TABLE IF NOT EXISTS registration_log (
      ip_or_key TEXT NOT NULL,
      registered_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS content_flags (
      id TEXT PRIMARY KEY,
      content_id TEXT NOT NULL,
      url TEXT NOT NULL,
      provider_id TEXT,
      flag_type TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      category TEXT,
      name TEXT NOT NULL,
      version TEXT DEFAULT '1.0.0',
      description TEXT,
      tags TEXT DEFAULT '[]',
      files TEXT DEFAULT '[]',
      dependencies TEXT DEFAULT '[]',
      license TEXT DEFAULT 'MIT',
      price REAL DEFAULT 0,
      build_cost REAL DEFAULT 0,
      preview_url TEXT,
      provenance_url TEXT,
      verified INTEGER DEFAULT 0,
      download_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      visibility TEXT DEFAULT 'public',
      owner_key TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_artifacts_slug ON artifacts(slug);
    CREATE INDEX IF NOT EXISTS idx_artifacts_category ON artifacts(category);

    CREATE TABLE IF NOT EXISTS content_whitelist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_id TEXT NOT NULL,
      authorized_key TEXT NOT NULL,
      UNIQUE(content_id, authorized_key)
    );

    CREATE TABLE IF NOT EXISTS artifact_whitelist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artifact_id TEXT NOT NULL,
      authorized_key TEXT NOT NULL,
      UNIQUE(artifact_id, authorized_key)
    );

    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      coverage TEXT,
      index_size INTEGER DEFAULT 0,
      freshness_policy TEXT,
      pricing_model TEXT,
      avg_price REAL DEFAULT 0,
      api_key TEXT,
      registered_at TEXT NOT NULL DEFAULT (datetime('now')),
      deposit REAL DEFAULT 0,
      probation_remaining INTEGER DEFAULT 10,
      publish_count INTEGER DEFAULT 0,
      flagged INTEGER DEFAULT 0,
      flag_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS search_log (
      id TEXT PRIMARY KEY,
      query TEXT,
      type_filter TEXT,
      category_filter TEXT,
      results_count INTEGER DEFAULT 0,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS verification_requests (
      id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL,
      publisher_id TEXT NOT NULL,
      fee REAL DEFAULT 0,
      status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (artifact_id) REFERENCES artifacts(id)
    );

    CREATE TABLE IF NOT EXISTS verification_results (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      verifier_id TEXT NOT NULL,
      passed INTEGER DEFAULT 0,
      report TEXT DEFAULT '{}',
      submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (request_id) REFERENCES verification_requests(id)
    );

    CREATE TABLE IF NOT EXISTS verifier_pool (
      id TEXT PRIMARY KEY,
      endpoint TEXT NOT NULL,
      stake_amount REAL DEFAULT 0,
      total_verifications INTEGER DEFAULT 0,
      agreement_rate REAL DEFAULT 1.0,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      key TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      owner_type TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS peers (
      id TEXT PRIMARY KEY,
      endpoint TEXT UNIQUE NOT NULL,
      name TEXT,
      specialty TEXT,
      last_seen TEXT,
      last_announced TEXT,
      failures INTEGER DEFAULT 0,
      discovered_from TEXT,
      added_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // ── Migrations for older databases ──
  const migrations = [
    `ALTER TABLE content ADD COLUMN content_hash TEXT`,
    `ALTER TABLE content ADD COLUMN visibility TEXT DEFAULT 'public'`,
    `ALTER TABLE content ADD COLUMN owner_key TEXT`,
    `ALTER TABLE content ADD COLUMN token_cost_saved REAL DEFAULT 0`,
    `ALTER TABLE artifacts ADD COLUMN visibility TEXT DEFAULT 'public'`,
    `ALTER TABLE artifacts ADD COLUMN owner_key TEXT`,
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch (e) { /* column already exists */ }
  }
}

// --- Content CRUD ---

function contentCheck(url, callerKey) {
  const d = getDb();
  let sql = `SELECT id, price, fetched_at, provider_id FROM content WHERE url = ?`;
  const params = [url];
  if (callerKey) {
    sql += ` AND (visibility = 'public' OR (visibility = 'private' AND owner_key = ?) OR (visibility = 'whitelist' AND (owner_key = ? OR id IN (SELECT content_id FROM content_whitelist WHERE authorized_key = ?))))`;
    params.push(callerKey, callerKey, callerKey);
  } else {
    sql += ` AND visibility = 'public'`;
  }
  const rows = d.prepare(sql).all(...params);
  if (rows.length === 0) return { available: false, price: 0, freshness: null, providers: 0 };
  const newest = rows.reduce((a, b) => (a.fetched_at > b.fetched_at ? a : b));
  return {
    available: true,
    price: newest.price,
    freshness: newest.fetched_at,
    providers: new Set(rows.map(r => r.provider_id).filter(Boolean)).size || rows.length
  };
}

function contentFetch(url, callerKey) {
  const d = getDb();
  let sql = `SELECT * FROM content WHERE url = ?`;
  const params = [url];
  if (callerKey) {
    sql += ` AND (visibility = 'public' OR (visibility = 'private' AND owner_key = ?) OR (visibility = 'whitelist' AND (owner_key = ? OR id IN (SELECT content_id FROM content_whitelist WHERE authorized_key = ?))))`;
    params.push(callerKey, callerKey, callerKey);
  } else {
    sql += ` AND visibility = 'public'`;
  }
  sql += ` ORDER BY fetched_at DESC LIMIT 1`;
  return d.prepare(sql).all(...params)[0] || null;
}

function contentPublish(record) {
  const d = getDb();
  const { v4: uuidv4 } = require('uuid');
  const id = record.id || uuidv4();
  d.prepare(`
    INSERT INTO content (id, url, source_hash, fetched_at, content_text, content_structured, content_links, content_metadata, provider_id, price, token_cost_saved, visibility, owner_key)
    VALUES (?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    record.url,
    record.source_hash,
    record.content_text || null,
    typeof record.content_structured === 'object' ? JSON.stringify(record.content_structured) : (record.content_structured || null),
    typeof record.content_links === 'object' ? JSON.stringify(record.content_links) : (record.content_links || null),
    typeof record.content_metadata === 'object' ? JSON.stringify(record.content_metadata) : (record.content_metadata || null),
    record.provider_id || null,
    record.price || 0,
    record.token_cost_saved || 0,
    record.visibility || 'public',
    record.owner_key || null
  );
  return d.prepare(`SELECT * FROM content WHERE id = ?`).get(id);
}

// --- Artifact CRUD ---

function artifactCreate(record) {
  const d = getDb();
  const { v4: uuidv4 } = require('uuid');
  const id = record.id || uuidv4();
  const slug = record.slug;
  d.prepare(`
    INSERT INTO artifacts (id, slug, category, name, version, description, tags, files, dependencies, license, price, build_cost, preview_url, provenance_url, visibility, owner_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, slug, record.category || null, record.name,
    record.version || '1.0.0', record.description || null,
    JSON.stringify(record.tags || []),
    JSON.stringify(record.files || []),
    JSON.stringify(record.dependencies || []),
    record.license || 'MIT',
    record.price || 0, record.build_cost || 0,
    record.preview_url || null, record.provenance_url || null,
    record.visibility || 'public',
    record.owner_key || null
  );
  return d.prepare(`SELECT * FROM artifacts WHERE id = ?`).get(id);
}

function artifactGetBySlug(slug, callerKey) {
  const d = getDb();
  let sql = `SELECT * FROM artifacts WHERE slug = ?`;
  const params = [slug];
  if (callerKey) {
    sql += ` AND (visibility = 'public' OR (visibility = 'private' AND owner_key = ?) OR (visibility = 'whitelist' AND (owner_key = ? OR id IN (SELECT artifact_id FROM artifact_whitelist WHERE authorized_key = ?))))`;
    params.push(callerKey, callerKey, callerKey);
  } else {
    sql += ` AND visibility = 'public'`;
  }
  return d.prepare(sql).all(...params)[0] || null;
}

function artifactUpdate(slug, updates) {
  const d = getDb();
  const existing = d.prepare(`SELECT * FROM artifacts WHERE slug = ?`).get(slug);
  if (!existing) return null;

  const allowed = ['category', 'name', 'version', 'description', 'tags', 'files', 'dependencies', 'license', 'price', 'build_cost', 'preview_url', 'provenance_url'];
  const sets = [];
  const vals = [];
  for (const key of allowed) {
    if (updates[key] !== undefined) {
      sets.push(`${key} = ?`);
      const val = (key === 'tags' || key === 'files' || key === 'dependencies')
        ? JSON.stringify(updates[key]) : updates[key];
      vals.push(val);
    }
  }
  if (sets.length === 0) return existing;

  sets.push(`updated_at = datetime('now')`);
  vals.push(slug);
  d.prepare(`UPDATE artifacts SET ${sets.join(', ')} WHERE slug = ?`).run(...vals);
  return d.prepare(`SELECT * FROM artifacts WHERE slug = ?`).get(slug);
}

function artifactIncrementDownload(slug) {
  getDb().prepare(`UPDATE artifacts SET download_count = download_count + 1 WHERE slug = ?`).run(slug);
}

// --- Search ---

function searchContent(query, maxAge, callerKey) {
  const d = getDb();
  let sql = `SELECT *, 'content' as type FROM content WHERE (url LIKE ? OR content_text LIKE ? OR content_metadata LIKE ?)`;
  const params = [`%${query}%`, `%${query}%`, `%${query}%`];
  if (callerKey) {
    sql += ` AND (visibility = 'public' OR (visibility = 'private' AND owner_key = ?) OR (visibility = 'whitelist' AND (owner_key = ? OR id IN (SELECT content_id FROM content_whitelist WHERE authorized_key = ?))))`;
    params.push(callerKey, callerKey, callerKey);
  } else {
    sql += ` AND visibility = 'public'`;
  }
  if (maxAge) {
    sql += ` AND fetched_at >= datetime('now', ?)`;
    params.push(`-${maxAge} days`);
  }
  return d.prepare(sql).all(...params);
}

function searchArtifacts(query, category, language, license, callerKey) {
  const d = getDb();
  let sql = `SELECT *, 'artifact' as type FROM artifacts WHERE (name LIKE ? OR description LIKE ? OR tags LIKE ?)`;
  const params = [`%${query}%`, `%${query}%`, `%${query}%`];
  if (callerKey) {
    sql += ` AND (visibility = 'public' OR (visibility = 'private' AND owner_key = ?) OR (visibility = 'whitelist' AND (owner_key = ? OR id IN (SELECT artifact_id FROM artifact_whitelist WHERE authorized_key = ?))))`;
    params.push(callerKey, callerKey, callerKey);
  } else {
    sql += ` AND visibility = 'public'`;
  }
  if (category) { sql += ` AND category = ?`; params.push(category); }
  if (language) { sql += ` AND tags LIKE ?`; params.push(`%${language}%`); }
  if (license) { sql += ` AND license = ?`; params.push(license); }
  return d.prepare(sql).all(...params);
}

function logSearch(query, typeFilter, categoryFilter, resultsCount, agentIdentifier) {
  const d = getDb();
  const { v4: uuidv4 } = require('uuid');
  // Ensure agent_identifier column exists (migration-safe)
  try {
    d.exec(`ALTER TABLE search_log ADD COLUMN agent_identifier TEXT`);
  } catch (e) { /* column already exists */ }
  d.prepare(`INSERT INTO search_log (id, query, type_filter, category_filter, results_count, agent_identifier) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(uuidv4(), query, typeFilter || null, categoryFilter || null, resultsCount, agentIdentifier || null);
}

// --- Trending / Gaps (Layer 3) ---

function getTrending(periodDays) {
  const d = getDb();
  // Ensure agent_identifier column exists for dedup (migration-safe)
  try {
    d.exec(`ALTER TABLE search_log ADD COLUMN agent_identifier TEXT`);
  } catch (e) { /* column already exists */ }
  // Count DISTINCT agents per query to prevent whale manipulation
  // If agent_identifier is NULL, each NULL counts as unique (conservative approach uses COALESCE with id)
  const topSearches = d.prepare(`
    SELECT query, COUNT(DISTINCT COALESCE(agent_identifier, id)) as count FROM search_log
    WHERE timestamp >= datetime('now', ?)
    GROUP BY query ORDER BY count DESC, RANDOM() LIMIT 20
  `).all(`-${periodDays} days`);

  const topContent = d.prepare(`
    SELECT url, COUNT(*) as fetch_count FROM content
    WHERE fetched_at >= datetime('now', ?)
    GROUP BY url ORDER BY fetch_count DESC LIMIT 20
  `).all(`-${periodDays} days`);

  const topArtifacts = d.prepare(`
    SELECT slug, name, download_count FROM artifacts
    WHERE updated_at >= datetime('now', ?)
    ORDER BY download_count DESC LIMIT 20
  `).all(`-${periodDays} days`);

  return { topSearches, topContent, topArtifacts };
}

function getGaps(category) {
  const d = getDb();
  let sql = `SELECT query, COUNT(*) as count FROM search_log WHERE results_count = 0`;
  const params = [];
  if (category) { sql += ` AND category_filter = ?`; params.push(category); }
  sql += ` GROUP BY query ORDER BY count DESC LIMIT 50`;
  return d.prepare(sql).all(...params);
}

// --- Verification ---

function createVerificationRequest(artifactId, publisherId, fee) {
  const d = getDb();
  const { v4: uuidv4 } = require('uuid');
  const id = uuidv4();
  d.prepare(`INSERT INTO verification_requests (id, artifact_id, publisher_id, fee) VALUES (?, ?, ?, ?)`)
    .run(id, artifactId, publisherId, fee || 0);
  return d.prepare(`SELECT * FROM verification_requests WHERE id = ?`).get(id);
}

function getPendingVerifications() {
  return getDb().prepare(`SELECT * FROM verification_requests WHERE status = 'pending' ORDER BY created_at ASC`).all();
}

function submitVerificationResult(requestId, verifierId, passed, report) {
  const d = getDb();
  const { v4: uuidv4 } = require('uuid');
  const id = uuidv4();
  d.prepare(`INSERT INTO verification_results (id, request_id, verifier_id, passed, report) VALUES (?, ?, ?, ?, ?)`)
    .run(id, requestId, verifierId, passed ? 1 : 0, JSON.stringify(report || {}));

  // Update verifier stats
  d.prepare(`UPDATE verifier_pool SET total_verifications = total_verifications + 1 WHERE id = ?`).run(verifierId);

  // Check if we have 3 results — if so, finalize
  const results = d.prepare(`SELECT * FROM verification_results WHERE request_id = ?`).all(requestId);
  if (results.length >= 3) {
    const passCount = results.filter(r => r.passed).length;
    const finalPassed = passCount >= 2;
    d.prepare(`UPDATE verification_requests SET status = ? WHERE id = ?`).run(finalPassed ? 'passed' : 'failed', requestId);

    // Update artifact verified status
    const req = d.prepare(`SELECT artifact_id FROM verification_requests WHERE id = ?`).get(requestId);
    if (req && finalPassed) {
      d.prepare(`UPDATE artifacts SET verified = 1 WHERE id = ?`).run(req.artifact_id);
    }

    // Update agreement rates for verifiers
    for (const r of results) {
      const agreedWithMajority = (r.passed && finalPassed) || (!r.passed && !finalPassed);
      if (!agreedWithMajority) {
        // Lower agreement rate
        const v = d.prepare(`SELECT * FROM verifier_pool WHERE id = ?`).get(r.verifier_id);
        if (v && v.total_verifications > 0) {
          const newRate = ((v.agreement_rate * (v.total_verifications - 1)) + 0) / v.total_verifications;
          d.prepare(`UPDATE verifier_pool SET agreement_rate = ? WHERE id = ?`).run(newRate, r.verifier_id);
        }
      }
    }
  }

  return d.prepare(`SELECT * FROM verification_results WHERE id = ?`).get(id);
}

function joinVerifierPool(endpoint, stakeAmount) {
  const d = getDb();
  const { v4: uuidv4 } = require('uuid');
  const id = uuidv4();
  d.prepare(`INSERT INTO verifier_pool (id, endpoint, stake_amount) VALUES (?, ?, ?)`)
    .run(id, endpoint, stakeAmount || 0);
  return d.prepare(`SELECT * FROM verifier_pool WHERE id = ?`).get(id);
}

function leaveVerifierPool(id) {
  const d = getDb();
  const verifier = d.prepare(`SELECT * FROM verifier_pool WHERE id = ?`).get(id);
  if (!verifier) return null;
  d.prepare(`UPDATE verifier_pool SET active = 0 WHERE id = ?`).run(id);
  return verifier;
}

function selectVerifiers(count, excludePublisherId) {
  const d = getDb();
  // Select random active verifiers with good agreement rates
  let candidates = d.prepare(`
    SELECT * FROM verifier_pool WHERE active = 1 AND agreement_rate >= 0.5
    ORDER BY RANDOM()
  `).all();

  // Exclude verifiers that share identity with the publisher
  if (excludePublisherId) {
    candidates = candidates.filter(v => v.id !== excludePublisherId);
  }

  // Deduplicate by domain prefix — only one verifier per IP/domain group
  const domainMap = new Map();
  const deduplicated = [];
  for (const v of candidates) {
    // Extract domain from endpoint (e.g., "https://example.com/verify" -> "example.com")
    let domain;
    try {
      const urlObj = new URL(v.endpoint);
      domain = urlObj.hostname;
    } catch (e) {
      domain = v.endpoint; // fallback
    }
    // Group by base domain (last 2 parts): "sybil-1.evil.com" -> "evil.com"
    const parts = domain.split('.');
    const baseDomain = parts.length >= 2 ? parts.slice(-2).join('.') : domain;

    if (!domainMap.has(baseDomain)) {
      domainMap.set(baseDomain, true);
      deduplicated.push(v);
    }
  }

  return deduplicated.slice(0, count);
}

function selectVerifiersForRequest(count, excludePublisherId, requestId) {
  const selected = selectVerifiers(count, excludePublisherId);
  // Store assignment so we can validate submissions later
  const d = getDb();
  // Ensure the assignment table exists
  d.exec(`CREATE TABLE IF NOT EXISTS verification_assignments (
    request_id TEXT NOT NULL,
    verifier_id TEXT NOT NULL,
    PRIMARY KEY (request_id, verifier_id)
  )`);
  for (const v of selected) {
    d.prepare(`INSERT OR IGNORE INTO verification_assignments (request_id, verifier_id) VALUES (?, ?)`)
      .run(requestId, v.id);
  }
  return selected;
}

function isVerifierAssigned(requestId, verifierId) {
  const d = getDb();
  // If the assignment table doesn't exist yet, allow (backwards compat)
  try {
    const row = d.prepare(`SELECT 1 FROM verification_assignments WHERE request_id = ? AND verifier_id = ?`)
      .get(requestId, verifierId);
    return !!row;
  } catch (e) {
    return true; // table doesn't exist, skip check
  }
}

// --- Nodes ---

function nodeRegister(record) {
  const d = getDb();
  const { v4: uuidv4 } = require('uuid');
  const id = record.id || uuidv4();
  const apiKey = crypto.randomBytes(32).toString('hex');
  d.prepare(`
    INSERT INTO nodes (id, name, endpoint, coverage, index_size, freshness_policy, pricing_model, avg_price, api_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, record.name, record.endpoint,
    record.coverage || null, record.index_size || 0,
    record.freshness_policy || null, record.pricing_model || null,
    record.avg_price || 0, apiKey
  );

  // Store API key
  d.prepare(`INSERT INTO api_keys (key, owner_id, owner_type) VALUES (?, ?, 'node')`)
    .run(apiKey, id);

  return { ...d.prepare(`SELECT * FROM nodes WHERE id = ?`).get(id), api_key: apiKey };
}

function nodeList() {
  return getDb().prepare(`SELECT id, name, endpoint, coverage, index_size, freshness_policy, pricing_model, avg_price, registered_at FROM nodes`).all();
}

function nodeGet(id) {
  return getDb().prepare(`SELECT id, name, endpoint, coverage, index_size, freshness_policy, pricing_model, avg_price, registered_at FROM nodes WHERE id = ?`).get(id) || null;
}

// --- API Keys ---

function validateApiKey(key) {
  return getDb().prepare(`SELECT * FROM api_keys WHERE key = ?`).get(key) || null;
}

// --- Anti-Sybil: Registration deposit and probation ---

function nodeRegisterWithDeposit(record, deposit) {
  const d = getDb();
  const { v4: uuidv4 } = require('uuid');
  const id = record.id || uuidv4();
  const apiKey = crypto.randomBytes(32).toString('hex');
  const minDeposit = 0.001; // minimum deposit to register

  if (deposit < minDeposit) {
    throw new Error(`Minimum deposit of $${minDeposit} required to register. Got $${deposit}`);
  }

  d.prepare(`
    INSERT INTO nodes (id, name, endpoint, coverage, index_size, freshness_policy, pricing_model, avg_price, api_key, deposit, probation_remaining, publish_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 10, 0)
  `).run(
    id, record.name, record.endpoint,
    record.coverage || null, record.index_size || 0,
    record.freshness_policy || null, record.pricing_model || null,
    record.avg_price || 0, apiKey, deposit
  );

  d.prepare(`INSERT INTO api_keys (key, owner_id, owner_type) VALUES (?, ?, 'node')`)
    .run(apiKey, id);

  return { ...d.prepare(`SELECT * FROM nodes WHERE id = ?`).get(id), api_key: apiKey };
}

function nodeGetAge(nodeId) {
  const d = getDb();
  const node = d.prepare(`SELECT registered_at, publish_count, probation_remaining, flagged FROM nodes WHERE id = ?`).get(nodeId);
  if (!node) return null;
  return node;
}

function nodeIncrementPublishCount(nodeId) {
  const d = getDb();
  d.prepare(`UPDATE nodes SET publish_count = publish_count + 1 WHERE id = ?`).run(nodeId);
  // Decrement probation if still in it
  d.prepare(`UPDATE nodes SET probation_remaining = MAX(0, probation_remaining - 1) WHERE id = ? AND probation_remaining > 0`).run(nodeId);
}

function nodeFlag(nodeId, reason) {
  const d = getDb();
  d.prepare(`UPDATE nodes SET flagged = 1, flag_reason = ? WHERE id = ?`).run(reason, nodeId);
}

function nodeIsFlagged(nodeId) {
  const d = getDb();
  const node = d.prepare(`SELECT flagged FROM nodes WHERE id = ?`).get(nodeId);
  return node ? node.flagged === 1 : false;
}

// --- Rate limiting ---

function checkPublishRateLimit(providerId, maxPerMinute) {
  const d = getDb();
  const windowStart = new Date(Math.floor(Date.now() / 60000) * 60000).toISOString();

  const row = d.prepare(`SELECT publish_count FROM rate_limits WHERE provider_id = ? AND window_start = ?`)
    .get(providerId, windowStart);

  if (row && row.publish_count >= maxPerMinute) {
    return { allowed: false, count: row.publish_count };
  }

  // Upsert
  d.prepare(`
    INSERT INTO rate_limits (provider_id, window_start, publish_count)
    VALUES (?, ?, 1)
    ON CONFLICT(provider_id, window_start)
    DO UPDATE SET publish_count = publish_count + 1
  `).run(providerId, windowStart);

  return { allowed: true, count: (row ? row.publish_count : 0) + 1 };
}

function checkRegistrationRateLimit(identifier, maxPerHour) {
  const d = getDb();
  // Use SQLite's datetime('now') for consistent format comparison (avoids ISO 'T' vs SQLite space mismatch)
  const count = d.prepare(`SELECT COUNT(*) as cnt FROM registration_log WHERE ip_or_key = ? AND registered_at > datetime('now', '-1 hour')`)
    .get(identifier);

  if (count && count.cnt >= maxPerHour) {
    return { allowed: false, count: count.cnt };
  }

  d.prepare(`INSERT INTO registration_log (ip_or_key) VALUES (?)`).run(identifier);
  return { allowed: true, count: (count ? count.cnt : 0) + 1 };
}

function getProviderFirstHourPublishCount(providerId) {
  const d = getDb();
  const node = d.prepare(`SELECT registered_at FROM nodes WHERE id = ?`).get(providerId);
  if (!node) return 0;
  const oneHourAfterReg = new Date(new Date(node.registered_at).getTime() + 3600000).toISOString();
  const result = d.prepare(`SELECT COUNT(*) as cnt FROM content WHERE provider_id = ? AND fetched_at <= ?`)
    .get(providerId, oneHourAfterReg);
  return result ? result.cnt : 0;
}

// --- Content signing / hash verification ---

/**
 * Normalize text before hashing to prevent unicode-based hash collision attacks.
 * Strips zero-width characters, RTL/LTR overrides, soft hyphens, and applies NFKD normalization.
 */
function normalizeForHash(text) {
  if (!text) return text;
  // NFKD normalize — decomposes and normalizes compatibility characters (fullwidth → ASCII, etc.)
  let normalized = text.normalize('NFKD');
  // Strip zero-width characters: ZWSP, ZWNJ, ZWJ, BOM/ZWNBSP, word joiner, zero-width no-break space
  normalized = normalized.replace(/[\u200B\u200C\u200D\uFEFF\u2060]/g, '');
  // Strip RTL/LTR override and embedding characters
  normalized = normalized.replace(/[\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069]/g, '');
  // Strip soft hyphens
  normalized = normalized.replace(/\u00AD/g, '');
  // Strip combining diacritical marks (U+0300-U+036F)
  normalized = normalized.replace(/[\u0300-\u036F]/g, '');
  // Normalize various unicode spaces to regular space (figure space, thin space, etc.)
  normalized = normalized.replace(/[\u2000-\u200A\u2007\u2008\u2009\u200A\u205F\u3000]/g, ' ');
  // Trim whitespace
  normalized = normalized.trim();
  return normalized;
}

function contentPublishWithHash(record) {
  const d = getDb();
  const { v4: uuidv4 } = require('uuid');
  const id = record.id || uuidv4();

  // Generate content hash from raw text — any content difference produces a different hash
  // This catches all manipulation attempts: zero-width chars, homoglyphs, RTL overrides, whitespace tricks
  const contentHash = record.content_text
    ? crypto.createHash('sha256').update(record.content_text).digest('hex')
    : null;

  d.prepare(`
    INSERT INTO content (id, url, source_hash, fetched_at, content_text, content_structured, content_links, content_metadata, provider_id, price, token_cost_saved, content_hash, visibility, owner_key)
    VALUES (?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    record.url,
    record.source_hash,
    record.content_text || null,
    typeof record.content_structured === 'object' ? JSON.stringify(record.content_structured) : (record.content_structured || null),
    typeof record.content_links === 'object' ? JSON.stringify(record.content_links) : (record.content_links || null),
    typeof record.content_metadata === 'object' ? JSON.stringify(record.content_metadata) : (record.content_metadata || null),
    record.provider_id || null,
    record.price || 0,
    record.token_cost_saved || 0,
    contentHash,
    record.visibility || 'public',
    record.owner_key || null
  );
  return d.prepare(`SELECT * FROM content WHERE id = ?`).get(id);
}

function getContentHashesForUrl(url) {
  const d = getDb();
  return d.prepare(`SELECT id, provider_id, content_hash, fetched_at FROM content WHERE url = ? AND content_hash IS NOT NULL ORDER BY fetched_at DESC`).all(url);
}

function checkContentHashDivergence(url, newHash) {
  const existing = getContentHashesForUrl(url);
  if (existing.length === 0) return { divergent: false, existingCount: 0 };

  // Count how many existing entries have the same hash vs different
  const matching = existing.filter(e => e.content_hash === newHash).length;
  const different = existing.filter(e => e.content_hash !== newHash).length;

  // If most existing hashes agree and this one disagrees, it's divergent
  if (different === 0) return { divergent: false, existingCount: existing.length };
  if (matching === 0 && different > 0) {
    // All existing are different from new — new hash diverges from consensus
    // But also check if existing ones agree with each other
    const hashCounts = {};
    for (const e of existing) {
      hashCounts[e.content_hash] = (hashCounts[e.content_hash] || 0) + 1;
    }
    const maxCount = Math.max(...Object.values(hashCounts));
    if (maxCount >= 2) {
      // There's a consensus among existing entries
      return { divergent: true, existingCount: existing.length, consensusSize: maxCount };
    }
  }

  return { divergent: false, existingCount: existing.length };
}

function flagContent(contentId, url, providerId, flagType, details) {
  const d = getDb();
  const { v4: uuidv4 } = require('uuid');
  d.prepare(`INSERT INTO content_flags (id, content_id, url, provider_id, flag_type, details) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(uuidv4(), contentId, url, providerId || null, flagType, details || null);
}

function getProviderFlagCount(providerId) {
  const d = getDb();
  const result = d.prepare(`SELECT COUNT(*) as cnt FROM content_flags WHERE provider_id = ?`).get(providerId);
  return result ? result.cnt : 0;
}

function getAllProvidersForUrl(url) {
  const d = getDb();
  return d.prepare(`SELECT id, provider_id, content_text, content_hash, price, fetched_at FROM content WHERE url = ? ORDER BY fetched_at DESC`).all(url);
}

// --- Whitelist management ---

function addContentWhitelist(contentId, authorizedKey) {
  const d = getDb();
  d.prepare(`INSERT OR IGNORE INTO content_whitelist (content_id, authorized_key) VALUES (?, ?)`).run(contentId, authorizedKey);
}

function removeContentWhitelist(contentId, authorizedKey) {
  const d = getDb();
  const result = d.prepare(`DELETE FROM content_whitelist WHERE content_id = ? AND authorized_key = ?`).run(contentId, authorizedKey);
  return result.changes > 0;
}

function getContentWhitelist(contentId) {
  const d = getDb();
  return d.prepare(`SELECT authorized_key FROM content_whitelist WHERE content_id = ?`).all(contentId).map(r => r.authorized_key);
}

function getContentById(id) {
  return getDb().prepare(`SELECT * FROM content WHERE id = ?`).get(id) || null;
}

function addArtifactWhitelist(artifactId, authorizedKey) {
  const d = getDb();
  d.prepare(`INSERT OR IGNORE INTO artifact_whitelist (artifact_id, authorized_key) VALUES (?, ?)`).run(artifactId, authorizedKey);
}

function removeArtifactWhitelist(artifactId, authorizedKey) {
  const d = getDb();
  const result = d.prepare(`DELETE FROM artifact_whitelist WHERE artifact_id = ? AND authorized_key = ?`).run(artifactId, authorizedKey);
  return result.changes > 0;
}

function getArtifactWhitelist(artifactId) {
  const d = getDb();
  return d.prepare(`SELECT authorized_key FROM artifact_whitelist WHERE artifact_id = ?`).all(artifactId).map(r => r.authorized_key);
}

function getArtifactById(id) {
  return getDb().prepare(`SELECT * FROM artifacts WHERE id = ?`).get(id) || null;
}

// --- Peers (P2P Discovery) ---

function addPeer(endpoint, name, specialty, discoveredFrom) {
  const d = getDb();
  const { v4: uuidv4 } = require('uuid');
  const id = uuidv4();
  try {
    d.prepare(`
      INSERT INTO peers (id, endpoint, name, specialty, discovered_from, last_seen)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(id, endpoint, name || null, specialty || null, discoveredFrom || null);
    return d.prepare(`SELECT * FROM peers WHERE id = ?`).get(id);
  } catch (e) {
    // UNIQUE constraint — peer already exists, update info if provided
    if (name || specialty) {
      const sets = [];
      const vals = [];
      if (name) { sets.push('name = ?'); vals.push(name); }
      if (specialty) { sets.push('specialty = ?'); vals.push(specialty); }
      if (sets.length > 0) {
        vals.push(endpoint);
        d.prepare(`UPDATE peers SET ${sets.join(', ')} WHERE endpoint = ?`).run(...vals);
      }
    }
    return d.prepare(`SELECT * FROM peers WHERE endpoint = ?`).get(endpoint);
  }
}

function removePeer(endpoint) {
  const d = getDb();
  const result = d.prepare(`DELETE FROM peers WHERE endpoint = ?`).run(endpoint);
  return result.changes > 0;
}

function getPeers(activeOnly = true) {
  const d = getDb();
  if (activeOnly) {
    return d.prepare(`SELECT * FROM peers WHERE failures < 5 ORDER BY last_seen DESC`).all();
  }
  return d.prepare(`SELECT * FROM peers ORDER BY last_seen DESC`).all();
}

function getAllPeers() {
  return getDb().prepare(`SELECT * FROM peers ORDER BY last_seen DESC`).all();
}

function getPeerByEndpoint(endpoint) {
  return getDb().prepare(`SELECT * FROM peers WHERE endpoint = ?`).get(endpoint) || null;
}

function updatePeerSeen(endpoint) {
  getDb().prepare(`UPDATE peers SET last_seen = datetime('now'), failures = 0 WHERE endpoint = ?`).run(endpoint);
}

function updatePeerAnnounced(endpoint) {
  getDb().prepare(`UPDATE peers SET last_announced = datetime('now') WHERE endpoint = ?`).run(endpoint);
}

function incrementPeerFailure(endpoint) {
  getDb().prepare(`UPDATE peers SET failures = failures + 1 WHERE endpoint = ?`).run(endpoint);
}

function getPeerCount() {
  const result = getDb().prepare(`SELECT COUNT(*) as cnt FROM peers WHERE failures < 5`).get();
  return result ? result.cnt : 0;
}

function contentUpdate(id, updates, callerKey) {
  const d = getDb();
  // Only owner can update
  const row = d.prepare('SELECT * FROM content WHERE id = ?').get(id);
  if (!row) return null;
  if (callerKey && row.owner_key && row.owner_key !== callerKey) return null;

  const fields = [];
  const params = [];
  if (updates.price !== undefined) { fields.push('price = ?'); params.push(updates.price); }
  if (updates.visibility !== undefined) { fields.push('visibility = ?'); params.push(updates.visibility); }
  if (fields.length === 0) return row;

  params.push(id);
  d.prepare(`UPDATE content SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return d.prepare('SELECT * FROM content WHERE id = ?').get(id);
}

function getContentById(id) {
  return getDb().prepare('SELECT * FROM content WHERE id = ?').get(id) || null;
}

function closeDb() {
  if (db) { db.close(); db = null; }
}

module.exports = {
  getDb, closeDb,
  // Content
  contentCheck, contentFetch, contentPublish, contentPublishWithHash, contentUpdate, getContentById,
  // Content verification
  getContentHashesForUrl, checkContentHashDivergence, flagContent, getProviderFlagCount, getAllProvidersForUrl,
  // Artifacts
  artifactCreate, artifactGetBySlug, artifactUpdate, artifactIncrementDownload,
  // Search
  searchContent, searchArtifacts, logSearch,
  // Market intelligence
  getTrending, getGaps,
  // Verification
  createVerificationRequest, getPendingVerifications, submitVerificationResult,
  joinVerifierPool, leaveVerifierPool, selectVerifiers, selectVerifiersForRequest, isVerifierAssigned,
  // Nodes
  nodeRegister, nodeRegisterWithDeposit, nodeList, nodeGet,
  nodeGetAge, nodeIncrementPublishCount, nodeFlag, nodeIsFlagged,
  // Rate limiting
  checkPublishRateLimit, checkRegistrationRateLimit, getProviderFirstHourPublishCount,
  // Auth
  validateApiKey,
  // Utilities
  normalizeForHash,
  // Whitelist / Access control
  addContentWhitelist, removeContentWhitelist, getContentWhitelist, getContentById,
  addArtifactWhitelist, removeArtifactWhitelist, getArtifactWhitelist, getArtifactById,
  // Peers (P2P Discovery)
  addPeer, removePeer, getPeers, getAllPeers, getPeerByEndpoint,
  updatePeerSeen, updatePeerAnnounced, incrementPeerFailure, getPeerCount
};
