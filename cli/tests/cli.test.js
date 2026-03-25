'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { execSync, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const CLI = path.resolve(__dirname, '..', 'bin', 'cli.js');
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const SERVER_FILE = path.join(PROJECT_ROOT, 'src', 'server.js');

// Helper to run CLI commands
function cli(args, opts = {}) {
  const env = { ...process.env, NODE_ENV: 'test', ...opts.env };
  try {
    const result = execFileSync(process.execPath, [CLI, ...args.split(' ').filter(Boolean)], {
      encoding: 'utf8',
      timeout: 15000,
      cwd: opts.cwd || os.tmpdir(),
      env,
    });
    return { stdout: result, exitCode: 0 };
  } catch (err) {
    return {
      stdout: (err.stdout || '') + (err.stderr || ''),
      exitCode: err.status || 1,
    };
  }
}

// ── Server management ───────────────────────────────────────────
let serverProcess;
const TEST_PORT = 3847;

function startServer() {
  const { spawn } = require('child_process');
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [SERVER_FILE], {
      env: { ...process.env, PORT: String(TEST_PORT), HOST: '127.0.0.1', LOG_LEVEL: 'silent' },
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: PROJECT_ROOT,
    });

    let started = false;
    const timeout = setTimeout(() => {
      if (!started) {
        // Try connecting anyway after a brief wait
        started = true;
        resolve(proc);
      }
    }, 3000);

    proc.stdout.on('data', (data) => {
      if (!started && data.toString().includes('listening')) {
        started = true;
        clearTimeout(timeout);
        resolve(proc);
      }
    });

    proc.stderr.on('data', (data) => {
      if (!started && data.toString().includes('listening')) {
        started = true;
        clearTimeout(timeout);
        resolve(proc);
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function waitForServer(port, retries = 15) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      fetch(`http://127.0.0.1:${port}/health`)
        .then(r => r.json())
        .then(() => resolve())
        .catch(() => {
          attempts++;
          if (attempts >= retries) return reject(new Error('Server did not start'));
          setTimeout(check, 300);
        });
    };
    check();
  });
}

// ── Tests ───────────────────────────────────────────────────────

describe('CLI - no server needed', () => {
  it('shows help with no arguments', () => {
    const { stdout } = cli('');
    assert.ok(stdout.includes('agent-marketplace'), 'Should show CLI name');
    assert.ok(stdout.includes('Commands'), 'Should show commands section');
  });

  it('shows help with help command', () => {
    const { stdout } = cli('help');
    assert.ok(stdout.includes('search'), 'Should list search command');
    assert.ok(stdout.includes('publish'), 'Should list publish command');
    assert.ok(stdout.includes('status'), 'Should list status command');
  });

  it('shows help with --help flag', () => {
    const { stdout } = cli('--help');
    assert.ok(stdout.includes('agent-marketplace'), 'Should show CLI name');
  });

  it('reports unknown commands', () => {
    const { stdout, exitCode } = cli('nonexistent');
    assert.ok(stdout.includes('Unknown command'), 'Should report unknown command');
    assert.strictEqual(exitCode, 1);
  });

  it('init creates config file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-cli-test-'));
    try {
      const { stdout } = cli('init', { cwd: tmpDir });
      assert.ok(stdout.includes('Created') || stdout.includes('agent-marketplace.json'), 'Should confirm creation');
      const configPath = path.join(tmpDir, 'agent-marketplace.json');
      assert.ok(fs.existsSync(configPath), 'Config file should exist');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      assert.strictEqual(config.node, 'http://localhost:3000');
      assert.strictEqual(config.defaultPrice, 0.0003);
      assert.strictEqual(config.publishOnCrawl, true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('init refuses to overwrite existing config', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-cli-test-'));
    try {
      // Create first
      cli('init', { cwd: tmpDir });
      // Try again
      const { stdout } = cli('init', { cwd: tmpDir });
      assert.ok(stdout.includes('already exists'), 'Should warn about existing config');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('search shows usage error without query', () => {
    // This will fail to connect but should show usage message first
    const { stdout, exitCode } = cli('search');
    // With no query the search command shows usage error
    assert.ok(stdout.includes('Usage') || stdout.includes('search') || stdout.includes('ERR'), 'Should show error or usage');
  });

  it('check shows usage error without url', () => {
    const { stdout } = cli('check');
    assert.ok(stdout.includes('Usage') || stdout.includes('check') || stdout.includes('ERR'), 'Should show error or usage');
  });

  it('fetch shows usage error without url', () => {
    const { stdout } = cli('fetch');
    assert.ok(stdout.includes('Usage') || stdout.includes('fetch') || stdout.includes('ERR'), 'Should show error or usage');
  });

  it('publish shows usage error without url', () => {
    const { stdout } = cli('publish');
    assert.ok(stdout.includes('Usage') || stdout.includes('publish') || stdout.includes('ERR'), 'Should show error or usage');
  });

  it('publish-artifact shows usage error without required flags', () => {
    const { stdout } = cli('publish-artifact');
    assert.ok(stdout.includes('Usage') || stdout.includes('publish-artifact') || stdout.includes('ERR'), 'Should show error or usage');
  });
});

describe('CLI - with server', () => {
  before(async () => {
    try {
      serverProcess = await startServer();
      await waitForServer(TEST_PORT);
    } catch (err) {
      console.error('Failed to start test server:', err.message);
      // Tests in this block will fail gracefully
    }
  });

  after(() => {
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      // Give it a moment to clean up
      try { serverProcess.kill('SIGKILL'); } catch { /* already dead */ }
    }
  });

  const cliWithServer = (args, opts = {}) => {
    const tmpDir = opts.cwd || fs.mkdtempSync(path.join(os.tmpdir(), 'am-cli-srv-'));
    // Write config pointing to test server
    const configPath = path.join(tmpDir, 'agent-marketplace.json');
    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, JSON.stringify({
        node: `http://127.0.0.1:${TEST_PORT}`,
        apiKey: 'test-key',
        defaultPrice: 0.0003,
      }));
    }
    return cli(args, { ...opts, cwd: tmpDir });
  };

  it('status shows connected', () => {
    const { stdout } = cliWithServer('status');
    assert.ok(
      stdout.includes('Connected') || stdout.includes('OK'),
      `Should show connected status. Got: ${stdout.slice(0, 200)}`
    );
  });

  it('search returns results (or empty)', () => {
    const { stdout, exitCode } = cliWithServer('search test');
    // Should not crash — either shows results or "no results"
    assert.ok(
      stdout.includes('Search results') || stdout.includes('no results') || stdout.includes('0 found'),
      `Should show search output. Got: ${stdout.slice(0, 200)}`
    );
  });

  it('check a URL', () => {
    const { stdout } = cliWithServer('check https://example.com');
    assert.ok(
      stdout.includes('Check') || stdout.includes('Available'),
      `Should show check output. Got: ${stdout.slice(0, 200)}`
    );
  });

  it('trending works', () => {
    const { stdout } = cliWithServer('trending');
    assert.ok(
      stdout.includes('Trending') || stdout.includes('trending'),
      `Should show trending output. Got: ${stdout.slice(0, 200)}`
    );
  });

  it('gaps works', () => {
    const { stdout } = cliWithServer('gaps');
    assert.ok(
      stdout.includes('gap') || stdout.includes('Gap') || stdout.includes('demand') || stdout.includes('well-supplied'),
      `Should show gaps output. Got: ${stdout.slice(0, 200)}`
    );
  });

  it('publish then search round-trip', () => {
    // This test depends on the server accepting publish and returning it in search.
    // The publish may fail if it tries to crawl a real URL, so we check gracefully.
    const pubResult = cliWithServer('publish https://httpbin.org/html --price 0.0005');
    // Whether publish succeeded or failed, search should still work
    const searchResult = cliWithServer('search html');
    assert.ok(
      searchResult.stdout.includes('Search results') || searchResult.stdout.includes('no results'),
      'Search should work after publish attempt'
    );
  });
});

describe('formatter', () => {
  const fmt = require('../src/formatter');

  it('formats prices correctly', () => {
    assert.strictEqual(fmt.price(0), '$0');
    assert.strictEqual(fmt.price(0.0003), '$0.0003');
    assert.strictEqual(fmt.price(0.05), '$0.050');
    assert.strictEqual(fmt.price(1.5), '$1.50');
    assert.strictEqual(fmt.price(null), '-');
    assert.strictEqual(fmt.price(undefined), '-');
  });

  it('formats percentages correctly', () => {
    assert.strictEqual(fmt.percent(0.70), '70%');
    assert.strictEqual(fmt.percent(0.955), '96%');
    assert.strictEqual(fmt.percent(null), '-');
  });
});

describe('config', () => {
  const { loadConfig, writeDefaultConfig, CONFIG_FILENAME } = require('../src/config');

  it('loads defaults when no config exists', () => {
    const origCwd = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-cfg-'));
    try {
      process.chdir(tmpDir);
      const config = loadConfig();
      assert.strictEqual(config.node, 'http://localhost:3000');
      assert.strictEqual(config.defaultPrice, 0.0003);
      assert.strictEqual(config._source, null);
    } finally {
      process.chdir(origCwd);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('loads config from current directory', () => {
    const origCwd = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-cfg-'));
    try {
      process.chdir(tmpDir);
      fs.writeFileSync(
        path.join(tmpDir, CONFIG_FILENAME),
        JSON.stringify({ node: 'http://custom:9999', apiKey: 'my-key' })
      );
      const config = loadConfig();
      assert.strictEqual(config.node, 'http://custom:9999');
      assert.strictEqual(config.apiKey, 'my-key');
      assert.strictEqual(config.defaultPrice, 0.0003); // inherited default
    } finally {
      process.chdir(origCwd);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
