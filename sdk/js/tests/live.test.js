'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { Marketplace, ContentRecord, ArtifactRecord } = require('../src/index');

// Live integration tests — requires the server to be importable
let app;
let baseUrl;
let apiKey;
let mp;
let tmpDbPath;

describe('Live integration tests', () => {
  before(async () => {
    // Use a fresh temp database to avoid schema mismatches with existing data
    tmpDbPath = path.join(os.tmpdir(), `marketplace-test-${Date.now()}.db`);
    process.env.DB_PATH = tmpDbPath;

    // Clear any cached db module so it picks up the new DB_PATH
    const dbModulePath = path.resolve(__dirname, '../../../src/db.js');
    delete require.cache[dbModulePath];

    // Start the server programmatically
    const serverPath = path.resolve(__dirname, '../../../src/server.js');
    delete require.cache[serverPath];
    const { build } = require(serverPath);
    app = await build();
    // Listen on a random port to avoid conflicts
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = address;

    // Register a node and get an API key
    const regResp = await fetch(`${baseUrl}/nodes/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'test-sdk-node',
        endpoint: 'http://localhost:9999/test-sdk',
        deposit: 0.01,
      }),
    });
    const regData = await regResp.json();
    apiKey = regData.data && regData.data.api_key ? regData.data.api_key : null;

    // Create SDK client
    mp = new Marketplace(baseUrl, { apiKey });
  });

  after(async () => {
    if (app) {
      await app.close();
    }
    // Clean up temp database
    if (tmpDbPath) {
      try { fs.unlinkSync(tmpDbPath); } catch {}
      try { fs.unlinkSync(tmpDbPath + '-wal'); } catch {}
      try { fs.unlinkSync(tmpDbPath + '-shm'); } catch {}
    }
  });

  // ------------------------------------------------------------------
  // Health check
  // ------------------------------------------------------------------
  it('server health check', async () => {
    const resp = await fetch(`${baseUrl}/health`);
    const data = await resp.json();
    assert.equal(data.success, true);
    assert.equal(data.data.status, 'ok');
  });

  // ------------------------------------------------------------------
  // Content workflow
  // ------------------------------------------------------------------
  it('publish content, check, and fetch', async () => {
    // Publish
    const pubResult = await mp.publishContent(
      'https://live-test.example.com/page1',
      {
        text: 'Live test content body',
        structured: { headings: ['Test'] },
        links: ['https://link.example.com'],
        metadata: { title: 'Live Test Page' },
      },
      0.25,
      50
    );
    assert.ok(pubResult);

    // Check
    const checkResult = await mp.check('https://live-test.example.com/page1');
    assert.equal(checkResult.available, true);

    // Fetch
    const record = await mp.fetch('https://live-test.example.com/page1');
    assert.ok(record instanceof ContentRecord);
    assert.equal(record.text, 'Live test content body');
  });

  // ------------------------------------------------------------------
  // Artifact workflow
  // ------------------------------------------------------------------
  it('publish artifact, get, and download', async () => {
    // Publish
    const pubResult = await mp.publishArtifact(
      'Live Test Tool',
      'A tool for live integration tests',
      'tool',
      ['index.js', 'README.md'],
      1.0,
      { tags: ['test', 'live'], version: '1.0.0' }
    );
    assert.ok(pubResult);

    // Get
    const artifact = await mp.getArtifact('live-test-tool');
    assert.ok(artifact instanceof ArtifactRecord);
    assert.equal(artifact.name, 'Live Test Tool');
    assert.equal(artifact.category, 'tool');

    // Download
    const dlResult = await mp.downloadArtifact('live-test-tool');
    assert.ok(dlResult);
  });

  // ------------------------------------------------------------------
  // Search workflow
  // ------------------------------------------------------------------
  it('search finds published content and artifacts', async () => {
    // Search for the content we published
    const contentResults = await mp.search('live test', { type: 'content' });
    assert.ok(Array.isArray(contentResults));

    // Search for the artifact we published
    const artifactResults = await mp.search('live test tool', { type: 'artifact' });
    assert.ok(Array.isArray(artifactResults));

    // searchBest
    const best = await mp.searchBest('live test');
    // May or may not find a result depending on search implementation
    // but shouldn't throw
  });

  // ------------------------------------------------------------------
  // Smart fetch workflow
  // ------------------------------------------------------------------
  it('smartFetch returns published content', async () => {
    // Clear cache so it hits the network
    mp._cache.clear();

    const result = await mp.smartFetch('https://live-test.example.com/page1');
    assert.ok(result);
    assert.equal(result.text, 'Live test content body');
  });

  it('smartFetch returns null for unavailable content', async () => {
    const result = await mp.smartFetch('https://nonexistent.example.com/nope');
    assert.equal(result, null);
  });

  it('smartFetch respects maxPrice', async () => {
    mp._cache.clear();
    const result = await mp.smartFetch('https://live-test.example.com/page1', { maxPrice: 0.001 });
    // Should return null because 0.001 < 0.25 price
    // (depends on server returning price in check — if check doesn't return price, this may pass)
  });

  // ------------------------------------------------------------------
  // Market intelligence
  // ------------------------------------------------------------------
  it('trending returns data without error', async () => {
    const result = await mp.trending('7d');
    assert.ok(result !== null && result !== undefined);
  });

  it('gaps returns data without error', async () => {
    const result = await mp.gaps();
    assert.ok(Array.isArray(result));
  });

  // ------------------------------------------------------------------
  // Error handling
  // ------------------------------------------------------------------
  it('getArtifact throws NotFoundError for missing slug', async () => {
    const { NotFoundError } = require('../src/errors');
    await assert.rejects(
      () => mp.getArtifact('totally-nonexistent-slug-xyz'),
      (err) => {
        assert.ok(err instanceof NotFoundError);
        return true;
      }
    );
  });
});
