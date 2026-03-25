'use strict';

/**
 * Base class for all red team test scenarios.
 * Each scenario defines a hypothesis, setup, execution, and assertion logic.
 */
class Scenario {
  constructor(id, name, hypothesis) {
    this.id = id;
    this.name = name;
    this.hypothesis = hypothesis;
    this.results = {};
    this.errors = [];
    this.startTime = null;
    this.endTime = null;
  }

  /**
   * Setup phase: create participants, seed data, prepare state.
   * @param {string} baseUrl - server base URL
   */
  async setup(baseUrl) {
    // Override in subclass
  }

  /**
   * Execute the test scenario.
   * @param {string} baseUrl - server base URL
   * @param {object} config - run config (trials, rounds, etc.)
   * @returns {object} raw results data
   */
  async execute(baseUrl, config) {
    // Override in subclass
    return {};
  }

  /**
   * Teardown: cleanup resources.
   */
  async teardown() {
    // Override in subclass
  }

  /**
   * Assert on the collected results.
   * @param {object} results - output from execute()
   * @returns {{ pass: boolean, metric: *, threshold: *, details: string, severity: string }}
   */
  assert(results) {
    // Override in subclass
    return { pass: false, metric: null, threshold: null, details: 'Not implemented', severity: 'unknown' };
  }

  /**
   * Helper: make HTTP request to the server.
   */
  async fetch(baseUrl, path, options = {}) {
    const url = `${baseUrl}${path}`;
    const fetchOpts = {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    };
    if (options.body) {
      fetchOpts.body = JSON.stringify(options.body);
    }
    try {
      const res = await fetch(url, fetchOpts);
      const data = await res.json().catch(() => null);
      return { status: res.status, data, ok: res.ok };
    } catch (err) {
      this.errors.push({ path, error: err.message });
      return { status: 0, data: null, ok: false, error: err.message };
    }
  }

  /**
   * Helper: register a node and return its data including api_key.
   */
  async registerNode(baseUrl, name, deposit = 0.01) {
    const res = await this.fetch(baseUrl, '/nodes/register', {
      method: 'POST',
      body: {
        name,
        endpoint: `https://${name}.example.com/api`,
        deposit,
      },
    });
    return res.data?.data || null;
  }
}

module.exports = Scenario;
