'use strict';

const path = require('path');
const fs = require('fs');
const MetricsCollector = require('./metrics-collector');

let nextPort = 3470;

/**
 * Test lifecycle manager for red team scenarios.
 * Starts a fresh Fastify server with an isolated DB per scenario run.
 */
class Harness {
  constructor() {
    this.app = null;
    this.port = null;
    this.dbPath = null;
    this.baseUrl = null;
  }

  /**
   * Start a fresh server with isolated DB.
   */
  async startServer(port, dbPath) {
    this.port = port || nextPort++;
    this.dbPath = dbPath || path.join(__dirname, '..', '..', 'data', `red-team-${this.port}.db`);

    // Clean up prior DB files
    for (const ext of ['', '-wal', '-shm']) {
      const f = this.dbPath + ext;
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }

    // Set environment BEFORE requiring server/db modules
    process.env.DB_PATH = this.dbPath;
    process.env.LOG_LEVEL = 'error';
    process.env.RATE_LIMIT = '99999';  // Disable global rate limit for targeted testing

    // Clear module caches to force fresh DB
    this._clearModuleCache();

    const { build } = require('../../src/server');
    this.app = await build();
    await this.app.listen({ port: this.port, host: '127.0.0.1' });
    this.baseUrl = `http://127.0.0.1:${this.port}`;

    return this.baseUrl;
  }

  /**
   * Gracefully stop the server and clean up.
   */
  async stopServer() {
    if (this.app) {
      await this.app.close();
      this.app = null;
    }

    // Close DB
    this._clearModuleCache();
    try {
      const dbMod = require('../../src/db');
      dbMod.closeDb();
    } catch (e) { /* ok */ }
    this._clearModuleCache();

    // Remove DB files
    if (this.dbPath) {
      for (const ext of ['', '-wal', '-shm']) {
        const f = this.dbPath + ext;
        try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) { /* ok */ }
      }
    }
  }

  /**
   * Reset the database (wipe and reinitialize).
   */
  async resetDB() {
    await this.stopServer();
    await this.startServer(this.port, this.dbPath);
  }

  /**
   * Run a single scenario with setup/execute/teardown lifecycle.
   */
  async runScenario(scenario, config = {}) {
    const baseUrl = await this.startServer(config.port, config.dbPath);
    const startTime = Date.now();

    try {
      scenario.startTime = startTime;

      // Setup
      await scenario.setup(baseUrl);

      // Execute
      const rawResults = await scenario.execute(baseUrl, config);

      // Assert
      const assertion = scenario.assert(rawResults);

      scenario.endTime = Date.now();

      // Teardown
      await scenario.teardown();

      return {
        id: scenario.id,
        name: scenario.name,
        hypothesis: scenario.hypothesis,
        ...assertion,
        rawResults,
        errors: scenario.errors,
        durationMs: scenario.endTime - scenario.startTime,
      };
    } catch (err) {
      scenario.endTime = Date.now();
      return {
        id: scenario.id,
        name: scenario.name,
        hypothesis: scenario.hypothesis,
        pass: null,
        metric: null,
        threshold: null,
        details: `INFRASTRUCTURE ERROR: ${err.message}`,
        severity: 'infrastructure',
        errors: [...scenario.errors, { error: err.message, stack: err.stack }],
        durationMs: Date.now() - startTime,
      };
    } finally {
      await this.stopServer();
    }
  }

  /**
   * Run multiple scenarios sequentially, collecting all results.
   */
  async runSuite(scenarios, config = {}) {
    const results = [];
    const suiteStart = Date.now();

    for (const ScenarioClass of scenarios) {
      // Allocate a fresh port per scenario
      const port = (config.portStart || 3470) + results.length;
      const dbPath = path.join(__dirname, '..', '..', 'data', `red-team-${port}.db`);

      const scenario = typeof ScenarioClass === 'function' ? new ScenarioClass() : ScenarioClass;
      const result = await this.runScenario(scenario, { ...config, port, dbPath });
      results.push(result);

      // Print progress
      const status = result.pass === true ? 'PASS' : result.pass === false ? 'FAIL' : 'ERROR';
      console.log(`  [${status}] ${result.id}: ${result.name} (${result.durationMs}ms)`);
    }

    return {
      results,
      summary: {
        total: results.length,
        passed: results.filter(r => r.pass === true).length,
        failed: results.filter(r => r.pass === false).length,
        errors: results.filter(r => r.pass === null).length,
      },
      durationMs: Date.now() - suiteStart,
    };
  }

  /**
   * Clear Node module caches for server, db, routes, middleware.
   */
  _clearModuleCache() {
    const srcDir = path.join(__dirname, '..', '..', 'src');
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(srcDir)) {
        delete require.cache[key];
      }
    }
  }
}

module.exports = Harness;
