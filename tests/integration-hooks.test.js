'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Use a separate test database
const TEST_DB_PATH = path.join(__dirname, '..', 'data', 'test-hooks.db');
process.env.DB_PATH = TEST_DB_PATH;
process.env.LOG_LEVEL = 'error';

const { build } = require('../src/server');
const { extractContent } = require('../integration/claude-code/auto-cache');
const { walkDir, isSupported, SUPPORTED_EXTENSIONS, SKIP_DIRS } = require('../integration/local-files/publish');
const { countLogEntries, checkHookInstalled } = require('../integration/claude-code/status');

const BASE_URL = 'http://127.0.0.1';
let app;
let port;

// ---- Helpers ----

async function req(method, urlPath, body, headers = {}) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}:${port}${urlPath}`, opts);
  const data = await res.json();
  return { status: res.status, body: data };
}

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ---- Test Suites ----

// === Claude Code Hook Tests ===

async function testExtractContentFromHtml() {
  const html = '<html><head><title>Test Page</title></head><body><p>Hello world content here</p></body></html>';
  const result = extractContent(html);
  assertEqual(result.title, 'Test Page', 'HTML title extraction');
  assert(result.text.includes('Hello world content here'), 'HTML text extraction');
  assert(result.metadata.wordCount > 0, 'word count present');
  assert(result.metadata.estimatedTokens > 0, 'token estimate present');
  console.log('  PASS: extractContent — HTML with title');
}

async function testExtractContentFromPlainText() {
  const text = 'This is plain text content without any HTML tags.';
  const result = extractContent(text);
  assertEqual(result.title, '', 'plain text has no title');
  assertEqual(result.text, text, 'plain text unchanged');
  console.log('  PASS: extractContent — plain text');
}

async function testExtractContentStripsScripts() {
  const html = '<html><body><script>alert("xss")</script><p>Safe content</p><style>.x{}</style></body></html>';
  const result = extractContent(html);
  assert(!result.text.includes('alert'), 'scripts stripped');
  assert(!result.text.includes('.x{}'), 'styles stripped');
  assert(result.text.includes('Safe content'), 'body text preserved');
  console.log('  PASS: extractContent — strips scripts and styles');
}

async function testExtractContentEmpty() {
  const result = extractContent('');
  assertEqual(result.title, '', 'empty returns empty title');
  assertEqual(result.text, '', 'empty returns empty text');
  console.log('  PASS: extractContent — empty input');
}

async function testExtractContentNull() {
  const result = extractContent(null);
  assertEqual(result.title, '', 'null returns empty title');
  assertEqual(result.text, '', 'null returns empty text');
  console.log('  PASS: extractContent — null input');
}

async function testExtractContentLongContent() {
  const longText = 'word '.repeat(20000); // ~100k chars
  const result = extractContent(longText);
  assert(result.text.length <= 50000, 'content capped at 50k chars');
  console.log('  PASS: extractContent — caps long content at 50k');
}

// === Auto-cache Hook Simulation ===

async function testAutoPublishToMarketplace() {
  const url = 'https://hook-test.example.com/doc-1';
  const sourceHash = crypto.createHash('sha256').update(url).digest('hex');

  // Simulate what the hook does: publish content
  // Use public visibility so check works without API key
  const r = await req('POST', '/publish/content', {
    url,
    source_hash: sourceHash,
    content_text: 'This is auto-cached content from a WebFetch hook',
    content_metadata: JSON.stringify({ title: 'Hook Test Doc', extractedAt: new Date().toISOString() }),
    price: 0.0001,
    visibility: 'public',
  });
  assertEqual(r.status, 201, 'hook publish status');
  assert(r.body.success, 'hook publish success');
  assert(r.body.data.id, 'hook publish has id');
  console.log('  PASS: Auto-publish simulated hook content');
}

async function testCheckCachedUrl() {
  const url = 'https://hook-test.example.com/doc-1';

  const r = await req('GET', `/check?url=${encodeURIComponent(url)}`);
  assertEqual(r.status, 200, 'check cached status');
  assertEqual(r.body.data.available, true, 'cached URL is available');
  console.log('  PASS: Check returns cached URL as available');
}

async function testSkipAlreadyCachedUrl() {
  const url = 'https://hook-test.example.com/doc-1';

  // Check shows it's available — hook would skip
  const r = await req('GET', `/check?url=${encodeURIComponent(url)}`);
  assertEqual(r.body.data.available, true, 'already cached');
  // In the real hook, this causes an early exit (no re-publish)
  console.log('  PASS: Skip already-cached URL (check returns available=true)');
}

async function testCheckUncachedUrl() {
  const r = await req('GET', '/check?url=https://never-fetched.example.com/page');
  assertEqual(r.status, 200, 'check uncached status');
  assertEqual(r.body.data.available, false, 'uncached URL not available');
  console.log('  PASS: Check returns uncached URL as not available');
}

// === Local File Publishing ===

async function testPublishFileEndpoint() {
  const r = await req('POST', '/dashboard/api/publish-file', {
    path: 'C:/Users/test/project/README.md',
    content: '# Test Project\n\nThis is a test readme file.',
    visibility: 'private',
  });
  assertEqual(r.status, 201, 'publish-file status');
  assert(r.body.success, 'publish-file success');
  assert(r.body.data.id, 'publish-file has id');
  console.log('  PASS: POST /dashboard/api/publish-file');
}

async function testPublishFileRequiresPath() {
  const r = await req('POST', '/dashboard/api/publish-file', {
    content: 'some content',
  });
  assertEqual(r.status, 400, 'publish-file missing path returns 400');
  console.log('  PASS: Publish-file rejects missing path');
}

async function testPublishFileRequiresContent() {
  const r = await req('POST', '/dashboard/api/publish-file', {
    path: 'test.md',
  });
  assertEqual(r.status, 400, 'publish-file missing content returns 400');
  console.log('  PASS: Publish-file rejects missing content');
}

// === File Type Support ===

async function testSupportedExtensions() {
  assert(isSupported('file.md'), '.md is supported');
  assert(isSupported('file.js'), '.js is supported');
  assert(isSupported('file.py'), '.py is supported');
  assert(isSupported('file.ts'), '.ts is supported');
  assert(isSupported('file.json'), '.json is supported');
  assert(isSupported('file.yaml'), '.yaml is supported');
  assert(isSupported('file.html'), '.html is supported');
  assert(isSupported('file.css'), '.css is supported');
  assert(isSupported('file.sh'), '.sh is supported');
  assert(isSupported('file.go'), '.go is supported');
  assert(isSupported('file.rs'), '.rs is supported');
  assert(isSupported('file.sql'), '.sql is supported');
  console.log('  PASS: All expected extensions are supported');
}

async function testUnsupportedExtensions() {
  assert(!isSupported('image.png'), '.png not supported');
  assert(!isSupported('video.mp4'), '.mp4 not supported');
  assert(!isSupported('archive.zip'), '.zip not supported');
  assert(!isSupported('binary.exe'), '.exe not supported');
  assert(!isSupported('data.bin'), '.bin not supported');
  console.log('  PASS: Binary/media extensions are not supported');
}

async function testSpecialFilenames() {
  assert(isSupported('Makefile'), 'Makefile is supported');
  assert(isSupported('Dockerfile'), 'Dockerfile is supported');
  assert(isSupported('.gitignore'), '.gitignore is supported');
  console.log('  PASS: Special filenames are supported');
}

// === Directory Walking ===

async function testWalkDirSkipsNodeModules() {
  // Create a temp structure
  const tmpDir = path.join(__dirname, '..', 'data', 'test-walk');
  const nmDir = path.join(tmpDir, 'node_modules', 'pkg');
  const srcDir = path.join(tmpDir, 'src');

  fs.mkdirSync(nmDir, { recursive: true });
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(nmDir, 'index.js'), 'module.exports = {};');
  fs.writeFileSync(path.join(srcDir, 'app.js'), 'console.log("hello");');
  fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Test');

  const files = walkDir(tmpDir);

  const hasNodeModules = files.some(f => f.includes('node_modules'));
  const hasSrc = files.some(f => f.includes('app.js'));
  const hasReadme = files.some(f => f.includes('README.md'));

  assert(!hasNodeModules, 'node_modules skipped');
  assert(hasSrc, 'src/app.js found');
  assert(hasReadme, 'README.md found');

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('  PASS: walkDir skips node_modules');
}

async function testWalkDirRespectsDepth() {
  const tmpDir = path.join(__dirname, '..', 'data', 'test-depth');
  const deep = path.join(tmpDir, 'a', 'b', 'c');
  fs.mkdirSync(deep, { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'root.md'), 'root');
  fs.writeFileSync(path.join(tmpDir, 'a', 'level1.md'), 'level1');
  fs.writeFileSync(path.join(tmpDir, 'a', 'b', 'level2.md'), 'level2');
  fs.writeFileSync(path.join(deep, 'level3.md'), 'level3');

  const depth1 = walkDir(tmpDir, 1);
  const hasRoot = depth1.some(f => f.includes('root.md'));
  const hasLevel1 = depth1.some(f => f.includes('level1.md'));
  const hasLevel2 = depth1.some(f => f.includes('level2.md'));

  assert(hasRoot, 'root found at depth 1');
  assert(hasLevel1, 'level1 found at depth 1');
  assert(!hasLevel2, 'level2 NOT found at depth 1');

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('  PASS: walkDir respects depth limit');
}

async function testWalkDirSkipsHiddenDirs() {
  const tmpDir = path.join(__dirname, '..', 'data', 'test-hidden');
  const hidden = path.join(tmpDir, '.hidden');
  fs.mkdirSync(hidden, { recursive: true });
  fs.writeFileSync(path.join(hidden, 'secret.md'), 'secret');
  fs.writeFileSync(path.join(tmpDir, 'visible.md'), 'visible');

  const files = walkDir(tmpDir);
  const hasHidden = files.some(f => f.includes('.hidden'));
  const hasVisible = files.some(f => f.includes('visible.md'));

  assert(!hasHidden, 'hidden dirs skipped');
  assert(hasVisible, 'visible files found');

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('  PASS: walkDir skips hidden directories');
}

// === Status Tool Tests ===

async function testCountLogEntries() {
  const tmpLog = path.join(__dirname, '..', 'data', 'test-log.log');
  fs.writeFileSync(tmpLog, [
    '[2026-01-01T00:00:00Z] CACHED: https://example.com/page1',
    '[2026-01-01T00:00:01Z] SKIP: Already cached: https://example.com/page2',
    '[2026-01-01T00:00:02Z] CACHED: https://example.com/page3',
    '[2026-01-01T00:00:03Z] ERROR: Failed to publish',
  ].join('\n'));

  const stats = countLogEntries(tmpLog);
  assertEqual(stats.total, 4, 'total log entries');
  assertEqual(stats.cached, 2, 'cached count');

  fs.unlinkSync(tmpLog);
  console.log('  PASS: countLogEntries parses log correctly');
}

async function testCountLogEntriesMissingFile() {
  const stats = countLogEntries('/nonexistent/path/log.log');
  assertEqual(stats.total, 0, 'missing file returns 0');
  assertEqual(stats.cached, 0, 'missing file cached 0');
  console.log('  PASS: countLogEntries handles missing file');
}

// === End-to-End: Publish File then Search ===

async function testPublishFileThenSearch() {
  // Publish a file with public visibility so dashboard search can find it
  await req('POST', '/dashboard/api/publish-file', {
    path: 'C:/projects/my-app/utils.js',
    content: 'function uniqueSearchableHelper() { return "xyzzy"; }',
    visibility: 'public',
  });

  // Search for the content
  const r = await req('GET', '/dashboard/api/search?q=uniqueSearchableHelper');
  assertEqual(r.status, 200, 'search status');
  assert(r.body.data.total > 0, 'search finds published file content');
  console.log('  PASS: Published file content is searchable');
}

// ---- Runner ----

async function run() {
  // Clean up test db
  try { fs.unlinkSync(TEST_DB_PATH); } catch (e) { /* ok */ }

  // Build and start server
  app = await build({ disableDiscovery: true });
  await app.listen({ port: 0, host: '127.0.0.1' });
  port = app.server.address().port;

  console.log(`\nIntegration Hooks Tests (port ${port})\n`);

  const tests = [
    // Claude Code hook content extraction
    testExtractContentFromHtml,
    testExtractContentFromPlainText,
    testExtractContentStripsScripts,
    testExtractContentEmpty,
    testExtractContentNull,
    testExtractContentLongContent,

    // Auto-cache hook simulation
    testAutoPublishToMarketplace,
    testCheckCachedUrl,
    testSkipAlreadyCachedUrl,
    testCheckUncachedUrl,

    // Local file publishing
    testPublishFileEndpoint,
    testPublishFileRequiresPath,
    testPublishFileRequiresContent,

    // File type support
    testSupportedExtensions,
    testUnsupportedExtensions,
    testSpecialFilenames,

    // Directory walking
    testWalkDirSkipsNodeModules,
    testWalkDirRespectsDepth,
    testWalkDirSkipsHiddenDirs,

    // Status tool
    testCountLogEntries,
    testCountLogEntriesMissingFile,

    // End-to-end
    testPublishFileThenSearch,
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      await test();
      passed++;
    } catch (err) {
      console.log(`  FAIL: ${test.name}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n  Results: ${passed} passed, ${failed} failed, ${passed + failed} total\n`);

  await app.close();
  try { fs.unlinkSync(TEST_DB_PATH); } catch (e) { /* ok */ }

  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
