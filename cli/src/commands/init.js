'use strict';

const fs = require('fs');
const path = require('path');
const fmt = require('../formatter');
const { writeDefaultConfig, CONFIG_FILENAME } = require('../config');

/**
 * Create an agent-marketplace.json config file in the current directory.
 */
async function run() {
  const dest = path.join(process.cwd(), CONFIG_FILENAME);

  // Check if already exists
  if (fs.existsSync(dest)) {
    fmt.info(`Config already exists: ${dest}`);
    fmt.info('Delete it first if you want to reinitialize.');
    return;
  }

  const created = writeDefaultConfig();

  console.log();
  fmt.success(`Created ${CONFIG_FILENAME}`);
  fmt.info(`Location: ${created}`);
  fmt.info('Edit the file to set your node URL and API key.');
  console.log();
}

module.exports = { run };
