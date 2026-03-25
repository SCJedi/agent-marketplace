'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_FILENAME = 'agent-marketplace.json';

const DEFAULTS = {
  node: 'http://localhost:3000',
  apiKey: '',
  defaultPrice: 0.0003,
  publishOnCrawl: true,
};

/**
 * Load config from current directory, then home directory, then defaults.
 * @returns {object} Merged configuration
 */
function loadConfig() {
  const locations = [
    path.join(process.cwd(), CONFIG_FILENAME),
    path.join(os.homedir(), CONFIG_FILENAME),
  ];

  for (const loc of locations) {
    try {
      const raw = fs.readFileSync(loc, 'utf8');
      const parsed = JSON.parse(raw);
      return { ...DEFAULTS, ...parsed, _source: loc };
    } catch {
      // File not found or invalid JSON — try next
    }
  }

  return { ...DEFAULTS, _source: null };
}

/**
 * Write default config template to the current directory.
 * @returns {string} Path to the created file
 */
function writeDefaultConfig() {
  const dest = path.join(process.cwd(), CONFIG_FILENAME);
  const template = {
    node: DEFAULTS.node,
    apiKey: '',
    defaultPrice: DEFAULTS.defaultPrice,
    publishOnCrawl: DEFAULTS.publishOnCrawl,
  };
  fs.writeFileSync(dest, JSON.stringify(template, null, 2) + '\n', 'utf8');
  return dest;
}

module.exports = { loadConfig, writeDefaultConfig, CONFIG_FILENAME, DEFAULTS };
