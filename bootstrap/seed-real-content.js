'use strict';

const { createContentRecord } = require('../src/crawler/index');

const NODE_URL = process.env.NODE_URL || 'http://localhost:3001';
const BATCH_SIZE = 3;          // small batches to stay under rate limit
const BATCH_DELAY_MS = 2500;   // respectful delay between batches

// ─── URL List: 200 real developer doc pages ─────────────────────────

const URLS = [
  // ── Python Standard Library (~30) ──
  'https://docs.python.org/3/library/asyncio.html',
  'https://docs.python.org/3/library/json.html',
  'https://docs.python.org/3/library/os.html',
  'https://docs.python.org/3/library/pathlib.html',
  'https://docs.python.org/3/library/re.html',
  'https://docs.python.org/3/library/subprocess.html',
  'https://docs.python.org/3/library/typing.html',
  'https://docs.python.org/3/library/unittest.html',
  'https://docs.python.org/3/library/logging.html',
  'https://docs.python.org/3/library/collections.html',
  'https://docs.python.org/3/library/functools.html',
  'https://docs.python.org/3/library/itertools.html',
  'https://docs.python.org/3/library/dataclasses.html',
  'https://docs.python.org/3/library/sqlite3.html',
  'https://docs.python.org/3/library/http.html',
  'https://docs.python.org/3/library/urllib.html',
  'https://docs.python.org/3/library/socket.html',
  'https://docs.python.org/3/library/threading.html',
  'https://docs.python.org/3/library/multiprocessing.html',
  'https://docs.python.org/3/library/argparse.html',
  'https://docs.python.org/3/library/datetime.html',
  'https://docs.python.org/3/library/hashlib.html',
  'https://docs.python.org/3/library/csv.html',
  'https://docs.python.org/3/library/io.html',
  'https://docs.python.org/3/library/sys.html',
  'https://docs.python.org/3/library/os.path.html',
  'https://docs.python.org/3/library/struct.html',
  'https://docs.python.org/3/library/enum.html',
  'https://docs.python.org/3/library/abc.html',
  'https://docs.python.org/3/library/contextlib.html',

  // ── Node.js Documentation (~20) ──
  'https://nodejs.org/docs/latest/api/fs.html',
  'https://nodejs.org/docs/latest/api/path.html',
  'https://nodejs.org/docs/latest/api/http.html',
  'https://nodejs.org/docs/latest/api/https.html',
  'https://nodejs.org/docs/latest/api/events.html',
  'https://nodejs.org/docs/latest/api/stream.html',
  'https://nodejs.org/docs/latest/api/buffer.html',
  'https://nodejs.org/docs/latest/api/crypto.html',
  'https://nodejs.org/docs/latest/api/child_process.html',
  'https://nodejs.org/docs/latest/api/os.html',
  'https://nodejs.org/docs/latest/api/url.html',
  'https://nodejs.org/docs/latest/api/util.html',
  'https://nodejs.org/docs/latest/api/net.html',
  'https://nodejs.org/docs/latest/api/process.html',
  'https://nodejs.org/docs/latest/api/timers.html',
  'https://nodejs.org/docs/latest/api/worker_threads.html',
  'https://nodejs.org/docs/latest/api/cluster.html',
  'https://nodejs.org/docs/latest/api/assert.html',
  'https://nodejs.org/docs/latest/api/readline.html',
  'https://nodejs.org/docs/latest/api/querystring.html',

  // ── Popular Framework Docs (~30) ──
  'https://fastapi.tiangolo.com/',
  'https://fastapi.tiangolo.com/tutorial/first-steps/',
  'https://fastapi.tiangolo.com/tutorial/path-params/',
  'https://fastapi.tiangolo.com/tutorial/query-params/',
  'https://fastapi.tiangolo.com/tutorial/body/',
  'https://fastapi.tiangolo.com/tutorial/dependencies/',
  'https://fastapi.tiangolo.com/tutorial/security/',
  'https://fastapi.tiangolo.com/tutorial/middleware/',
  'https://fastapi.tiangolo.com/tutorial/sql-databases/',
  'https://fastapi.tiangolo.com/tutorial/testing/',
  'https://expressjs.com/en/starter/installing.html',
  'https://expressjs.com/en/starter/hello-world.html',
  'https://expressjs.com/en/guide/routing.html',
  'https://expressjs.com/en/guide/using-middleware.html',
  'https://expressjs.com/en/guide/error-handling.html',
  'https://expressjs.com/en/4x/api.html',
  'https://flask.palletsprojects.com/en/stable/quickstart/',
  'https://flask.palletsprojects.com/en/stable/api/',
  'https://flask.palletsprojects.com/en/stable/tutorial/',
  'https://docs.djangoproject.com/en/5.0/intro/tutorial01/',
  'https://docs.djangoproject.com/en/5.0/topics/http/urls/',
  'https://docs.djangoproject.com/en/5.0/ref/models/fields/',
  'https://react.dev/learn',
  'https://react.dev/reference/react/useState',
  'https://react.dev/reference/react/useEffect',
  'https://react.dev/reference/react/useContext',
  'https://react.dev/reference/react/useRef',
  'https://react.dev/reference/react/useMemo',
  'https://nextjs.org/docs/getting-started/installation',
  'https://nextjs.org/docs/app/building-your-application/routing',

  // ── AI/ML Documentation (~25) ──
  'https://docs.anthropic.com/en/docs/about-claude/models',
  'https://docs.anthropic.com/en/api/getting-started',
  'https://docs.anthropic.com/en/api/messages',
  'https://docs.anthropic.com/en/docs/build-with-claude/tool-use',
  'https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching',
  'https://platform.openai.com/docs/api-reference/chat',
  'https://platform.openai.com/docs/guides/text-generation',
  'https://platform.openai.com/docs/guides/function-calling',
  'https://platform.openai.com/docs/guides/embeddings',
  'https://huggingface.co/docs/transformers/index',
  'https://huggingface.co/docs/transformers/quicktour',
  'https://huggingface.co/docs/hub/models',
  'https://python.langchain.com/docs/get_started/introduction',
  'https://python.langchain.com/docs/modules/chains',
  'https://python.langchain.com/docs/modules/agents',
  'https://docs.pytest.org/en/stable/getting-started.html',
  'https://docs.pytest.org/en/stable/how-to/fixtures.html',
  'https://docs.pytest.org/en/stable/how-to/assert.html',
  'https://docs.pytest.org/en/stable/how-to/parametrize.html',
  'https://docs.pytest.org/en/stable/reference/reference.html',
  'https://numpy.org/doc/stable/user/absolute_beginners.html',
  'https://pandas.pydata.org/docs/getting_started/intro_tutorials/01_table_oriented.html',
  'https://requests.readthedocs.io/en/latest/user/quickstart/',
  'https://requests.readthedocs.io/en/latest/api/',
  'https://www.sqlalchemy.org/docs/',

  // ── DevOps & Tools (~25) ──
  'https://docs.docker.com/get-started/',
  'https://docs.docker.com/compose/',
  'https://docs.docker.com/engine/reference/builder/',
  'https://docs.github.com/en/rest/overview',
  'https://docs.github.com/en/actions/quickstart',
  'https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions',
  'https://git-scm.com/docs/git-rebase',
  'https://git-scm.com/docs/git-stash',
  'https://git-scm.com/docs/git-log',
  'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise',
  'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array',
  'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map',
  'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch',
  'https://developer.mozilla.org/en-US/docs/Web/HTTP/Status',
  'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers',
  'https://www.typescriptlang.org/docs/handbook/2/basic-types.html',
  'https://www.typescriptlang.org/docs/handbook/2/everyday-types.html',
  'https://www.typescriptlang.org/docs/handbook/2/functions.html',
  'https://www.typescriptlang.org/docs/handbook/2/objects.html',
  'https://www.typescriptlang.org/docs/handbook/2/generics.html',
  'https://tailwindcss.com/docs/installation',
  'https://tailwindcss.com/docs/utility-first',
  'https://tailwindcss.com/docs/responsive-design',
  'https://www.postgresql.org/docs/current/tutorial.html',
  'https://redis.io/docs/getting-started/',

  // ── Database & API (~20) ──
  'https://www.sqlite.org/lang.html',
  'https://www.sqlite.org/datatype3.html',
  'https://www.sqlite.org/json1.html',
  'https://www.mongodb.com/docs/manual/crud/',
  'https://www.mongodb.com/docs/manual/aggregation/',
  'https://graphql.org/learn/',
  'https://graphql.org/learn/queries/',
  'https://swagger.io/docs/specification/about/',
  'https://jwt.io/introduction',
  'https://oauth.net/2/',
  'https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS',
  'https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP',
  'https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html',
  'https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html',
  'https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html',
  'https://semver.org/',
  'https://keepachangelog.com/en/1.1.0/',
  'https://conventionalcommits.org/en/v1.0.0/',
  'https://12factor.net/',
  'https://restfulapi.net/',

  // ── Additional Python Standard Library ──
  'https://docs.python.org/3/library/venv.html',
  'https://docs.python.org/3/library/pdb.html',
  'https://docs.python.org/3/library/http.server.html',
  'https://docs.python.org/3/library/concurrent.futures.html',
  'https://docs.python.org/3/library/secrets.html',
  'https://docs.python.org/3/library/textwrap.html',
  'https://docs.python.org/3/library/shutil.html',
  'https://docs.python.org/3/library/tempfile.html',
  'https://docs.python.org/3/library/traceback.html',
  'https://docs.python.org/3/library/copy.html',

  // ── Additional Node.js ──
  'https://nodejs.org/docs/latest/api/dns.html',
  'https://nodejs.org/docs/latest/api/zlib.html',
  'https://nodejs.org/docs/latest/api/console.html',

  // ── Additional MDN Web Docs ──
  'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON',
  'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp',
  'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date',
  'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set',
  'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function',
  'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error',
  'https://developer.mozilla.org/en-US/docs/Web/API/WebSocket',
  'https://developer.mozilla.org/en-US/docs/Web/API/Worker',
  'https://developer.mozilla.org/en-US/docs/Web/API/URL',
  'https://developer.mozilla.org/en-US/docs/Web/API/FormData',
  'https://developer.mozilla.org/en-US/docs/Web/API/AbortController',
  'https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout',
  'https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_flexible_box_layout/Basic_concepts_of_flexbox',

  // ── Additional Framework Docs ──
  'https://fastapi.tiangolo.com/tutorial/response-model/',
  'https://fastapi.tiangolo.com/tutorial/handling-errors/',
  'https://fastapi.tiangolo.com/tutorial/cors/',
  'https://expressjs.com/en/guide/database-integration.html',

  // ── Go Documentation ──
  'https://go.dev/doc/effective_go',
  'https://go.dev/doc/tutorial/getting-started',
  'https://pkg.go.dev/fmt',
  'https://pkg.go.dev/net/http',
  'https://pkg.go.dev/encoding/json',

  // ── Rust Documentation ──
  'https://doc.rust-lang.org/book/ch01-00-getting-started.html',
  'https://doc.rust-lang.org/book/ch03-00-common-programming-concepts.html',
  'https://doc.rust-lang.org/book/ch04-00-understanding-ownership.html',
  'https://doc.rust-lang.org/std/vec/struct.Vec.html',
  'https://doc.rust-lang.org/std/option/enum.Option.html',
  'https://doc.rust-lang.org/std/result/enum.Result.html',

  // ── Testing Frameworks ──
  'https://jestjs.io/docs/getting-started',
  'https://jestjs.io/docs/mock-functions',
  'https://vitest.dev/guide/',

  // ── GitHub & Infrastructure ──
  'https://docs.github.com/en/actions/learn-github-actions/understanding-github-actions',
  'https://docs.github.com/en/rest/repos/repos',
  'https://docs.github.com/en/rest/pulls/pulls',
  'https://redis.io/docs/latest/get-started/',
];

// ─── Helpers ─────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname + u.pathname;
  } catch {
    return url;
  }
}

async function publishToNode(contentRecord) {
  const payload = {
    url: contentRecord.url,
    source_hash: contentRecord.source_hash,
    fetched_at: contentRecord.fetched_at,
    content_text: contentRecord.content.text,
    content_structured: contentRecord.content.structured,
    content_links: contentRecord.content.links,
    content_metadata: contentRecord.content.metadata,
    price: 0,
    visibility: 'public',
    provider_id: 'seed-crawler',
    token_cost_saved: contentRecord.token_cost_saved,
  };

  const response = await fetch(`${NODE_URL}/publish/content`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`${response.status}: ${body}`);
  }
  return response.json();
}

// ─── Main crawl loop ─────────────────────────────────────────────────

async function main() {
  const total = URLS.length;
  console.log(`\nCrawling ${total} real developer doc pages...\n`);

  let succeeded = 0;
  let failed = 0;
  let totalChars = 0;
  const errors = [];

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = URLS.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (url, batchIdx) => {
        const idx = i + batchIdx + 1;
        try {
          const record = await createContentRecord(url);
          const chars = record.content.text.length;

          if (chars < 100) {
            throw new Error('Content too short (likely blocked or JS-rendered)');
          }

          await publishToNode(record);
          totalChars += chars;
          succeeded++;
          console.log(`  OK [${idx}/${total}] ${shortUrl(url)} (${chars.toLocaleString()} chars)`);
        } catch (err) {
          failed++;
          const reason = err.message.length > 80 ? err.message.slice(0, 80) + '...' : err.message;
          console.log(`  FAIL [${idx}/${total}] ${shortUrl(url)} (${reason})`);
          errors.push({ url, error: reason });
        }
      })
    );

    // Respectful delay between batches
    if (i + BATCH_SIZE < total) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  // Summary
  const totalMB = (totalChars / 1024 / 1024).toFixed(1);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Crawl complete!`);
  console.log(`  Succeeded: ${succeeded}/${total}`);
  console.log(`  Failed:    ${failed}/${total}`);
  console.log(`  Total content: ${totalMB} MB`);
  if (errors.length > 0 && errors.length <= 30) {
    console.log(`\nFailed URLs:`);
    for (const e of errors) {
      console.log(`  - ${shortUrl(e.url)}: ${e.error}`);
    }
  }
  console.log(`\nYour node now has the top developer docs cached for AI agents.`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
