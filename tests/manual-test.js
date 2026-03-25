'use strict';

const BASE = 'http://127.0.0.1:3333';

async function req(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const data = await res.json();
  return { status: res.status, data };
}

async function run() {
  let passed = 0;
  let failed = 0;
  const results = [];

  function check(name, ok, detail) {
    if (ok) { passed++; results.push(`PASS: ${name}`); }
    else { failed++; results.push(`FAIL: ${name} — ${detail}`); }
  }

  // 1. GET /health
  {
    const r = await req('GET', '/health');
    check('GET /health', r.status === 200 && r.data.success === true && r.data.data.status === 'ok',
      JSON.stringify(r));
  }

  // 2. POST /nodes/register
  let nodeId;
  {
    const r = await req('POST', '/nodes/register', { name: 'test-node', endpoint: 'http://localhost:4000' });
    check('POST /nodes/register', r.status === 201 && r.data.success === true && r.data.data.id,
      JSON.stringify(r));
    nodeId = r.data.data?.id;
  }

  // 3. POST /publish/content
  {
    const r = await req('POST', '/publish/content', {
      url: 'https://example.com/test-page',
      source_hash: 'abc123hash',
      content_text: 'Hello world test content',
      content_metadata: JSON.stringify({ title: 'Test Page' }),
      price: 0.01,
      token_cost_saved: 0.05,
    });
    check('POST /publish/content', r.status === 201 && r.data.success === true,
      JSON.stringify(r));
  }

  // 4. GET /check?url=
  {
    const r = await req('GET', '/check?url=https://example.com/test-page');
    check('GET /check (exists)', r.status === 200 && r.data.data?.available === true,
      JSON.stringify(r));
  }

  // 5. GET /check for non-existent
  {
    const r = await req('GET', '/check?url=https://example.com/nonexistent');
    check('GET /check (not exists)', r.status === 200 && r.data.data?.available === false,
      JSON.stringify(r));
  }

  // 6. GET /fetch?url=
  {
    const r = await req('GET', '/fetch?url=https://example.com/test-page');
    check('GET /fetch (exists)', r.status === 200 && r.data.data?.content_text === 'Hello world test content',
      JSON.stringify(r));
  }

  // 7. GET /fetch non-existent
  {
    const r = await req('GET', '/fetch?url=https://example.com/nonexistent');
    check('GET /fetch (404)', r.status === 404,
      JSON.stringify(r));
  }

  // 8. POST /publish/artifact
  let artifactId;
  {
    const r = await req('POST', '/publish/artifact', {
      name: 'Test Tool',
      slug: 'test-tool',
      category: 'tool',
      description: 'A test artifact for integration testing',
      tags: ['test', 'integration'],
      files: ['tool.py', 'README.md'],
      price: 0.50,
    });
    check('POST /publish/artifact', r.status === 201 && r.data.success === true,
      JSON.stringify(r));
    artifactId = r.data.data?.id;
  }

  // 9. GET /artifacts/:slug
  {
    const r = await req('GET', '/artifacts/test-tool');
    check('GET /artifacts/:slug', r.status === 200 && r.data.data?.name === 'Test Tool',
      JSON.stringify(r));
  }

  // 10. GET /artifacts/:slug/download
  {
    const r = await req('GET', '/artifacts/test-tool/download');
    check('GET /artifacts/:slug/download', r.status === 200 && r.data.success === true,
      JSON.stringify(r));
  }

  // 11. PATCH /artifacts/:slug
  {
    const r = await req('PATCH', '/artifacts/test-tool', { description: 'Updated description' });
    check('PATCH /artifacts/:slug', r.status === 200 && r.data.data?.description === 'Updated description',
      JSON.stringify(r));
  }

  // 12. GET /search?q=test
  {
    const r = await req('GET', '/search?q=test');
    check('GET /search', r.status === 200 && r.data.data?.total > 0,
      JSON.stringify(r));
  }

  // 13. GET /trending
  {
    const r = await req('GET', '/trending');
    check('GET /trending', r.status === 200 && r.data.success === true,
      JSON.stringify(r));
  }

  // 14. GET /gaps
  {
    const r = await req('GET', '/gaps');
    check('GET /gaps', r.status === 200 && r.data.success === true,
      JSON.stringify(r));
  }

  // 15. POST /verify/pool/join
  let verifierId;
  {
    const r = await req('POST', '/verify/pool/join', { endpoint: 'http://verifier1:5000', stake_amount: 10 });
    check('POST /verify/pool/join', r.status === 201 && r.data.success === true,
      JSON.stringify(r));
    verifierId = r.data.data?.id;
  }

  // 16. POST /verify/request
  let verReqId;
  {
    const r = await req('POST', '/verify/request', {
      artifact_id: artifactId,
      publisher_id: 'pub-1',
      fee: 1.0,
    });
    check('POST /verify/request', r.status === 201 && r.data.success === true,
      JSON.stringify(r));
    verReqId = r.data.data?.request?.id;
  }

  // 17. POST /verify/submit
  {
    const r = await req('POST', '/verify/submit', {
      request_id: verReqId,
      verifier_id: verifierId,
      passed: true,
      report: { notes: 'Looks good' },
    });
    check('POST /verify/submit', r.status === 201 && r.data.success === true,
      JSON.stringify(r));
  }

  // 18. GET /verify/pending
  {
    const r = await req('GET', '/verify/pending');
    check('GET /verify/pending', r.status === 200 && r.data.success === true,
      JSON.stringify(r));
  }

  // Print results
  console.log('\n=== ENDPOINT TEST RESULTS ===');
  for (const line of results) console.log(line);
  console.log(`\nTotal: ${passed} passed, ${failed} failed out of ${passed + failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error('FATAL:', err); process.exit(1); });
