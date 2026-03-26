#!/usr/bin/env node
'use strict';

const path = require('path');

// Add SDK to the require path
const sdkPath = path.resolve(__dirname, '..', '..', 'sdk', 'js', 'src');
const { Marketplace } = require(path.join(sdkPath, 'client'));
const { loadConfig } = require('../src/config');

// ── Argument parsing ──────────────────────────────────────────────
const args = process.argv.slice(2);

function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(argv[i]);
    }
  }
  return { flags, positional };
}

const { flags, positional } = parseFlags(args);
const command = positional[0];
const commandArg = positional[1];

// ── Help ──────────────────────────────────────────────────────────
function showHelp() {
  console.log(`
  ${'\x1b[1m'}agent-marketplace${'\x1b[0m'} — CLI for the Agent Marketplace

  ${'\x1b[1m'}Usage:${'\x1b[0m'}
    agent-marketplace <command> [args] [options]

  ${'\x1b[1m'}Commands:${'\x1b[0m'}
    search <query>         Search for content and artifacts
      --type <type>          Filter: content | artifact
      --lang <language>      Filter by language
      --sort <sort>          Sort: relevance | price | recent

    check <url>            Check if a URL is available on the marketplace

    fetch <url>            Fetch content for a URL
      --max-price <price>    Maximum price to pay

    publish <url>          Crawl, parse, and publish a URL
      --price <price>        Set price (default: free)
      --visibility <vis>     Access: public | private | whitelist
      --whitelist <keys>     Comma-separated API keys (with --visibility whitelist)

    publish-artifact       Publish a build artifact
      --name <name>          Artifact name (required)
      --category <cat>       Category (required)
      --description <desc>   Description (required)
      --price <price>        Price (required)
      --files <f1,f2>        Comma-separated file list (required)

    publish-file <path>    Publish a local file
      --visibility <vis>     Access: public | private (default: private)

    publish-folder <path>  Publish all files in a folder
      --depth <n>            Max directory depth
      --visibility <vis>     Access: public | private (default: private)
      --watch                Watch for changes and auto-publish

    trending               Show trending content and artifacts
      --period <period>      Time period: 7d | 30d

    gaps                   Show unmet demand
      --category <cat>       Filter by category

    init                   Create agent-marketplace.json config
    status                 Check node connection status
    help                   Show this help message
`);
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  if (!command || command === 'help' || flags.help) {
    showHelp();
    return;
  }

  // init doesn't need a client
  if (command === 'init') {
    const init = require('../src/commands/init');
    await init.run();
    return;
  }

  // Load config and create client
  const config = loadConfig();
  const client = new Marketplace(config.node, {
    apiKey: config.apiKey || undefined,
    timeout: 10000,
  });

  try {
    switch (command) {
      case 'search': {
        const search = require('../src/commands/search');
        await search.run(client, commandArg, flags);
        break;
      }
      case 'check': {
        const check = require('../src/commands/check');
        await check.run(client, commandArg);
        break;
      }
      case 'fetch': {
        const fetchCmd = require('../src/commands/fetch');
        await fetchCmd.run(client, commandArg, flags);
        break;
      }
      case 'publish': {
        const publish = require('../src/commands/publish');
        await publish.run(client, commandArg, flags, config);
        break;
      }
      case 'publish-artifact': {
        const publishArtifact = require('../src/commands/publish-artifact');
        await publishArtifact.run(client, flags);
        break;
      }
      case 'publish-file': {
        const publishFile = require('../src/commands/publish-file');
        await publishFile.run(client, commandArg, flags);
        break;
      }
      case 'publish-folder': {
        const publishFolder = require('../src/commands/publish-folder');
        await publishFolder.run(client, commandArg, flags);
        break;
      }
      case 'trending': {
        const trending = require('../src/commands/trending');
        await trending.run(client, flags);
        break;
      }
      case 'gaps': {
        const gaps = require('../src/commands/gaps');
        await gaps.run(client, flags);
        break;
      }
      case 'status': {
        const status = require('../src/commands/status');
        await status.run(client, config);
        break;
      }
      default:
        console.error(`  Unknown command: ${command}`);
        console.error('  Run "agent-marketplace help" for usage.');
        process.exitCode = 1;
    }
  } catch (err) {
    const fmt = require('../src/formatter');
    if (err.name === 'NetworkError' || err.code === 'ECONNREFUSED') {
      fmt.error(`Cannot reach marketplace node at ${config.node}`);
      fmt.info('Is the server running? Start it with: node src/server.js');
    } else {
      fmt.error(err.message || String(err));
    }
    process.exitCode = 1;
  }
}

main();
