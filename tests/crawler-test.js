'use strict';

const { parseHtml, hashContent, estimateTokenCost } = require('../src/crawler/index.js');

// Test with a sample HTML page
const sampleHtml = `<!DOCTYPE html>
<html>
<head>
  <title>Test Page</title>
  <meta property="og:title" content="OG Test Title" />
  <meta name="description" content="A test page description" />
  <meta name="author" content="Test Author" />
</head>
<body>
  <article>
    <h1>Main Heading</h1>
    <p>This is paragraph text for testing the crawler.</p>
    <h2>Sub Heading</h2>
    <pre><code class="language-python">print("hello world")</code></pre>
    <ul>
      <li>Item one</li>
      <li>Item two</li>
    </ul>
    <a href="https://example.com/linked">A link</a>
  </article>
</body>
</html>`;

let passed = 0;
let failed = 0;

function check(name, ok, detail) {
  if (ok) { passed++; console.log(`PASS: ${name}`); }
  else { failed++; console.log(`FAIL: ${name} — ${detail || 'assertion failed'}`); }
}

// Test parseHtml
const result = parseHtml(sampleHtml, 'https://example.com/test');
check('parseHtml returns text', result.text && result.text.length > 0, `text=${result.text}`);
check('parseHtml extracts metadata title', result.metadata.title.length > 0, `title=${result.metadata.title}`);
check('parseHtml extracts metadata author', result.metadata.author === 'Test Author', `author=${result.metadata.author}`);
check('parseHtml extracts structured headings', result.structured.headings && result.structured.headings.length > 0, JSON.stringify(result.structured.headings));
check('parseHtml extracts code blocks', result.structured.code_blocks && result.structured.code_blocks.length > 0, JSON.stringify(result.structured.code_blocks));
check('parseHtml extracts links', result.links && result.links.length > 0, JSON.stringify(result.links));
check('parseHtml extracts lists', result.structured.lists && result.structured.lists.length > 0, JSON.stringify(result.structured.lists));

// Test hashContent
const hash = hashContent(sampleHtml);
check('hashContent returns hex string', /^[a-f0-9]{64}$/.test(hash), `hash=${hash}`);
check('hashContent is deterministic', hash === hashContent(sampleHtml));

// Test estimateTokenCost
const cost = estimateTokenCost(sampleHtml);
check('estimateTokenCost returns tokens', cost.estimatedTokens > 0, `tokens=${cost.estimatedTokens}`);
check('estimateTokenCost returns cost', cost.estimatedCostUsd >= 0, `cost=${cost.estimatedCostUsd}`);

console.log(`\n=== CRAWLER TEST RESULTS ===`);
console.log(`Total: ${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
