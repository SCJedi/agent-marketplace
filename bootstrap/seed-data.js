'use strict';

const crypto = require('crypto');

function hash(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

// Helper to generate a date string N hours ago
function hoursAgo(n) {
  return new Date(Date.now() - n * 3600000).toISOString();
}

// ─── WebClean: general-web content ──────────────────────────────

const webCleanContent = [
  {
    url: 'https://techcrunch.com/2026/03/eu-ai-regulation-update',
    content_text: `The European Union has finalized its AI Act implementation guidelines, setting strict requirements for high-risk AI systems deployed in healthcare, finance, and critical infrastructure. Companies must complete compliance audits by Q3 2026.\n\nThe new rules mandate transparency reports for foundation models exceeding 10^25 FLOPs, require watermarking of AI-generated content, and establish a centralized incident reporting system. Penalties for non-compliance range from 1.5% to 7% of global revenue.\n\nIndustry groups have responded with mixed reactions. The European AI Association welcomed the clarity while warning that compliance costs could disadvantage European startups against US and Chinese competitors.`,
    content_metadata: { author: 'Sarah Chen', date: '2026-03-20', type: 'news', category: 'regulation' },
    price: 0.0004
  },
  {
    url: 'https://arstechnica.com/ai/2026/03/openai-gpt5-launch',
    content_text: `OpenAI has officially launched GPT-5, its most capable language model to date, featuring a 2-million token context window and native multimodal reasoning across text, images, audio, and video.\n\nBenchmark results show GPT-5 achieves 94.2% on MMLU-Pro, 89.1% on HumanEval+, and 76.3% on the new ARC-AGI-2 benchmark. The model demonstrates significant improvements in mathematical reasoning, code generation, and factual accuracy.\n\nPricing starts at $15 per million input tokens and $60 per million output tokens for the full model, with a smaller "GPT-5 mini" variant available at $3/$12. API access is rolling out to enterprise customers first.`,
    content_metadata: { author: 'Kyle Orland', date: '2026-03-18', type: 'news', category: 'ai' },
    price: 0.0005
  },
  {
    url: 'https://blog.vercel.com/next-js-15-deep-dive',
    content_text: `Next.js 15 introduces Server Actions 2.0, a complete rethinking of how server-side mutations work in React applications. The new API eliminates the need for separate API routes in most cases.\n\nKey features include: automatic optimistic updates with rollback, built-in rate limiting per action, streaming responses from server actions, and TypeScript-first validation using Zod schemas embedded in the action definition.\n\nPerformance benchmarks show 40% faster Time to First Byte compared to Next.js 14, primarily due to the new incremental static regeneration engine that pre-computes partial page segments.`,
    content_metadata: { author: 'Lee Robinson', date: '2026-03-15', type: 'blog', category: 'web-dev' },
    price: 0.0003
  },
  {
    url: 'https://docs.python.org/3.13/whatsnew/3.13.html',
    content_text: `Python 3.13 brings the long-awaited free-threaded mode (PEP 703), allowing true multi-threaded parallelism by disabling the Global Interpreter Lock. This experimental feature can be enabled with the --disable-gil flag.\n\nOther highlights include: a new interactive interpreter based on PyPy's, improved error messages with color support, the new typing.TypeForm for runtime type checking, and dead battery removal (several deprecated stdlib modules removed).\n\nPerformance improvements include a 10-15% speedup in the default (GIL-enabled) mode from continued Faster CPython work, and the new JIT compiler foundation that will be expanded in 3.14.`,
    content_metadata: { author: 'Python Core Team', date: '2026-02-01', type: 'documentation', category: 'python' },
    price: 0.0003
  },
  {
    url: 'https://www.nytimes.com/2026/03/ai-agents-enterprise',
    content_text: `Fortune 500 companies are rapidly adopting AI agent systems for internal operations, with adoption rates jumping from 12% to 47% in the past six months. The most common use cases include customer service automation, code review, and document processing.\n\nMcKinsey estimates that AI agents will automate 30% of knowledge work tasks by 2028, creating an estimated $4.4 trillion in annual productivity gains. However, the consulting firm warns that poorly implemented agent systems can actually decrease productivity due to error correction overhead.\n\nThe emerging best practice is "human-in-the-loop" deployment, where agents handle routine tasks autonomously but escalate edge cases to human operators.`,
    content_metadata: { author: 'Cade Metz', date: '2026-03-22', type: 'news', category: 'business' },
    price: 0.0005
  },
  {
    url: 'https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API',
    content_text: `The WebGPU API provides a modern, low-level graphics and compute interface for the web, replacing WebGL with a more capable and performant API inspired by Vulkan, Metal, and Direct3D 12.\n\nKey concepts include: GPUAdapter (physical GPU abstraction), GPUDevice (logical connection), GPUBuffer (GPU memory), GPUTexture (image data), and GPURenderPipeline (shader configuration). The compute shader support enables general-purpose GPU computing directly in the browser.\n\nWebGPU is now supported in Chrome 113+, Edge 113+, and Firefox 126+ (behind a flag). Safari support is expected in version 18. The API enables ML inference, physics simulations, and advanced rendering directly in web applications.`,
    content_metadata: { author: 'MDN Contributors', date: '2026-01-15', type: 'documentation', category: 'web-dev' },
    price: 0.0003
  },
  {
    url: 'https://www.wired.com/story/quantum-computing-2026-progress',
    content_text: `IBM has achieved a quantum computing milestone with its 1,121-qubit Condor processor, demonstrating quantum advantage on a practical optimization problem for the first time. The system solved a logistics routing problem 100x faster than the best classical algorithm.\n\nGoogle's Willow processor, meanwhile, has achieved below-threshold error rates, meaning errors decrease as more qubits are added — a critical requirement for fault-tolerant quantum computing. The company projects a commercially useful quantum computer by 2029.\n\nThe quantum computing market is projected to reach $8.5 billion by 2028, driven primarily by pharmaceutical and materials science applications where quantum simulation offers clear advantages.`,
    content_metadata: { author: 'Will Knight', date: '2026-03-10', type: 'news', category: 'technology' },
    price: 0.0004
  },
  {
    url: 'https://react.dev/blog/2026/03/react-20-announcement',
    content_text: `The React team has announced React 20, featuring a revolutionary new compiler called React Forge that eliminates the need for useMemo, useCallback, and React.memo in virtually all cases. The compiler automatically determines optimal re-render boundaries.\n\nReact 20 also introduces Signals-compatible reactivity for fine-grained updates without re-renders, a new <Suspense> streaming protocol that works with any data fetching library, and built-in animation primitives.\n\nMigration from React 19 is expected to be straightforward, with a codemod handling 95% of breaking changes. The React team emphasizes backward compatibility and will support React 19 with security patches through 2028.`,
    content_metadata: { author: 'Dan Abramov', date: '2026-03-19', type: 'blog', category: 'web-dev' },
    price: 0.0004
  },
  {
    url: 'https://blog.cloudflare.com/workers-ai-inference-at-edge',
    content_text: `Cloudflare has expanded its Workers AI platform to support custom model deployment at the edge, allowing developers to run fine-tuned LLMs on Cloudflare's global network of 300+ data centers.\n\nThe platform now supports models up to 70B parameters using a novel model sharding technique that distributes weights across multiple edge nodes. Inference latency averages 50ms for 7B models and 200ms for 70B models, compared to 500ms+ for centralized cloud inference.\n\nPricing is usage-based at $0.01 per 1,000 inference tokens, with a free tier of 10,000 tokens per day. The service includes automatic model caching, request batching, and built-in observability.`,
    content_metadata: { author: 'Rita Kozlov', date: '2026-03-12', type: 'blog', category: 'cloud' },
    price: 0.0003
  },
  {
    url: 'https://security.googleblog.com/2026/03/supply-chain-attacks-npm',
    content_text: `Google's security team has published a comprehensive analysis of supply chain attacks targeting the npm ecosystem in 2025, identifying 847 malicious packages that collectively received over 12 million downloads before detection.\n\nThe most common attack vectors include: typosquatting (43%), dependency confusion (28%), maintainer account compromise (18%), and build script injection (11%). The report recommends lockfile pinning, automated dependency auditing, and the use of verified publishers.\n\nGoogle is proposing a new "Package Provenance" standard that would cryptographically link published packages to their source repositories and build systems, making it impossible to inject code between source and publication.`,
    content_metadata: { author: 'Google Security Team', date: '2026-03-08', type: 'blog', category: 'security' },
    price: 0.0004
  },
  {
    url: 'https://www.theverge.com/2026/3/apple-vision-pro-2',
    content_text: `Apple has announced Vision Pro 2, featuring a 40% lighter design at 380 grams, an M4 chip with dedicated neural engine, and a new "transparency mode" that makes the headset nearly invisible to others in the room.\n\nThe updated headset includes prescription lens integration, 8 hours of battery life (up from 2.5), and a breakthrough hand tracking system that works with gloves. Enterprise pricing starts at $2,499, down from $3,499 for the original.\n\nDevelopers can now build "spatial widgets" — persistent AR interfaces that float in the user's environment and survive across sessions. Apple reports 15,000 spatial apps on the App Store, with productivity and design tools seeing the strongest adoption.`,
    content_metadata: { author: 'Nilay Patel', date: '2026-03-21', type: 'news', category: 'hardware' },
    price: 0.0005
  },
  {
    url: 'https://www.python-security.com/best-practices-2026',
    content_text: `Python Security Best Practices for 2026 — a comprehensive guide to securing Python applications in the age of AI-assisted development.\n\nKey recommendations: 1) Use pyproject.toml with pinned dependencies and hash verification. 2) Enable Python 3.13's new sandboxed execution mode for untrusted code. 3) Implement Content Security Policy headers for all web applications. 4) Use the new secrets.compare_digest for all authentication comparisons.\n\nFor AI applications specifically: validate all LLM outputs before execution, implement output sanitization pipelines, use structured generation (JSON mode) to prevent injection attacks, and maintain audit logs of all AI-generated code that gets executed.`,
    content_metadata: { author: 'Anthony Shaw', date: '2026-03-05', type: 'blog', category: 'security' },
    price: 0.0004
  },
  {
    url: 'https://tailwindcss.com/blog/tailwind-v4',
    content_text: `Tailwind CSS v4 has been released with a completely rewritten engine built in Rust, delivering 10x faster build times and a 50% smaller runtime. The new engine processes a 10,000-file project in under 100ms.\n\nMajor changes include: CSS-first configuration (no more tailwind.config.js), native cascade layers support, container queries as first-class utilities, automatic dark mode without the dark: prefix, and built-in animations.\n\nThe migration from v3 is automated with the official upgrade tool. Tailwind v4 drops support for IE11 and older Safari versions, embracing modern CSS features like :has(), color-mix(), and subgrid natively.`,
    content_metadata: { author: 'Adam Wathan', date: '2026-02-28', type: 'blog', category: 'web-dev' },
    price: 0.0003
  },
  {
    url: 'https://blog.rust-lang.org/2026/03/15/Rust-2024-edition',
    content_text: `The Rust 2024 Edition is now stable, bringing the largest set of ergonomic improvements since the 2021 edition. The headline feature is "implicit async" — async functions no longer need the async keyword when the return type is impl Future.\n\nOther highlights: pattern matching on references is now automatic, the borrow checker handles more complex lifetime patterns without annotations, and the new editions keyword allows gradual migration. The standard library adds built-in JSON support via serde integration.\n\nCompiler performance has improved by 25% for incremental builds, and the new parallel frontend (enabled by default) reduces clean build times by 40% on machines with 4+ cores.`,
    content_metadata: { author: 'Rust Blog Team', date: '2026-03-15', type: 'blog', category: 'programming' },
    price: 0.0003
  },
  {
    url: 'https://hbr.org/2026/03/the-ai-productivity-paradox',
    content_text: `Harvard Business Review's latest research reveals an AI productivity paradox: companies that deploy AI tools across all departments simultaneously see only 5-8% productivity gains, while those that focus on 2-3 high-impact areas see 25-40% improvements.\n\nThe study, covering 500 companies over 18 months, found that the key differentiator is "AI depth over breadth." Organizations that deeply integrate AI into specific workflows — with custom training data, human feedback loops, and workflow redesign — dramatically outperform those doing shallow, wide deployments.\n\nThe research suggests a three-phase approach: 1) Identify the 20% of workflows that consume 80% of time, 2) Deploy AI deeply in those areas with dedicated teams, 3) Expand only after measurable ROI is achieved.`,
    content_metadata: { author: 'Marco Iansiti', date: '2026-03-17', type: 'article', category: 'business' },
    price: 0.0005
  },
  {
    url: 'https://docs.deno.com/runtime/guide/node-compat',
    content_text: `Deno 2.0's Node.js compatibility layer now supports 98% of the npm ecosystem out of the box, including native modules compiled with node-gyp. The remaining 2% consists primarily of packages that rely on Node.js-specific internal APIs.\n\nKey compatibility features: full node_modules support, package.json scripts, CommonJS and ESM interop, and transparent npm package installation. Deno can now serve as a drop-in replacement for Node.js in most production environments.\n\nPerformance comparison shows Deno 2.0 outperforming Node.js 22 in HTTP throughput (15% faster), startup time (3x faster), and memory usage (20% lower). The built-in test runner, linter, and formatter eliminate the need for separate tooling.`,
    content_metadata: { author: 'Deno Team', date: '2026-02-20', type: 'documentation', category: 'runtime' },
    price: 0.0003
  },
  {
    url: 'https://www.bloomberg.com/news/2026-03-crypto-institutional',
    content_text: `Institutional cryptocurrency adoption has reached an inflection point, with 67% of hedge funds now holding digital assets compared to 38% a year ago. Total institutional crypto AUM has surpassed $500 billion.\n\nThe catalysts include: Bitcoin and Ethereum ETF approval, clearer regulatory frameworks from the SEC and CFTC, and the launch of regulated tokenized securities on major exchanges. Goldman Sachs and JPMorgan now offer crypto custody services to institutional clients.\n\nHowever, concerns remain about market manipulation in smaller tokens, DeFi protocol security, and the environmental impact of proof-of-work mining. The SEC has signaled potential regulation of DeFi protocols as securities exchanges.`,
    content_metadata: { author: 'Olga Kharif', date: '2026-03-14', type: 'news', category: 'finance' },
    price: 0.0005
  },
  {
    url: 'https://www.infoq.com/articles/microservices-2026-lessons',
    content_text: `After a decade of microservices adoption, the industry is converging on a pragmatic middle ground. A survey of 1,200 engineering leaders reveals that 62% are moving toward "modular monoliths" — single deployable units with clear internal module boundaries.\n\nThe main drivers: microservices operational overhead (cited by 78%), distributed transaction complexity (65%), and debugging difficulty (71%). Companies like Amazon, Uber, and Shopify have publicly discussed consolidating some microservices back into larger services.\n\nThe emerging best practice is "start monolith, extract when proven" — begin with a modular monolith and only extract services when you have clear evidence that independent scaling or deployment is needed.`,
    content_metadata: { author: 'Sam Newman', date: '2026-03-11', type: 'article', category: 'architecture' },
    price: 0.0004
  },
  {
    url: 'https://htmx.org/essays/hypermedia-2026',
    content_text: `The HTMX project has published a retrospective on the hypermedia renaissance, reporting 2.3 million weekly npm downloads and adoption by major companies including GitHub, Basecamp, and the US Digital Service.\n\nThe essay argues that the "JavaScript fatigue" backlash has evolved into a productive equilibrium: SPAs for complex interactive applications (dashboards, editors, collaborative tools) and hypermedia for everything else (content sites, admin panels, CRUD applications).\n\nHTMX 2.0 introduces WebSocket integration for real-time updates, a plugin system for custom swap strategies, and improved accessibility defaults. The project also announces a formal W3C proposal for standardizing htmx-style attributes in HTML.`,
    content_metadata: { author: 'Carson Gross', date: '2026-03-09', type: 'essay', category: 'web-dev' },
    price: 0.0003
  },
  {
    url: 'https://github.blog/2026-03-copilot-workspace-ga',
    content_text: `GitHub has launched Copilot Workspace in general availability, an AI-powered development environment that can plan, implement, and test code changes from natural language descriptions.\n\nThe system works by: 1) analyzing the repository structure and existing code, 2) generating a step-by-step implementation plan, 3) writing the code changes across multiple files, 4) running tests and fixing failures iteratively. In beta testing, Copilot Workspace resolved 40% of GitHub Issues end-to-end without human intervention.\n\nPricing is $39/month for individual developers and $19/user/month for enterprise plans. The workspace integrates with existing CI/CD pipelines and supports all major programming languages.`,
    content_metadata: { author: 'Thomas Dohmke', date: '2026-03-16', type: 'news', category: 'dev-tools' },
    price: 0.0004
  },
  {
    url: 'https://docs.docker.com/engine/wasm/',
    content_text: `Docker now supports WebAssembly (Wasm) containers as first-class citizens alongside Linux containers. Wasm containers start in under 1ms, use 90% less memory than equivalent Linux containers, and provide hardware-level sandboxing.\n\nThe implementation uses the WasmEdge runtime and supports WASI Preview 2, enabling Wasm containers to access filesystems, networking, and HTTP services. Docker Compose supports mixed Wasm and Linux container deployments.\n\nUse cases where Wasm containers excel: serverless functions, edge computing, plugin systems, and multi-tenant SaaS applications. Languages with mature Wasm targets include Rust, Go, C/C++, and AssemblyScript. Python and JavaScript support is experimental via wasm-python and javy.`,
    content_metadata: { author: 'Docker Docs Team', date: '2026-02-25', type: 'documentation', category: 'devops' },
    price: 0.0003
  },
  {
    url: 'https://martinfowler.com/articles/ai-testing-2026.html',
    content_text: `Testing AI-integrated applications requires fundamentally new approaches. Traditional assertion-based testing breaks down when outputs are probabilistic and context-dependent.\n\nMartin Fowler proposes a three-tier testing strategy: 1) Deterministic tests for non-AI components (traditional unit/integration tests), 2) Statistical tests for AI outputs (assert that 95% of outputs meet quality criteria across 100+ runs), 3) Human evaluation benchmarks for subjective quality (monthly reviews of sampled outputs).\n\nThe article introduces "AI Test Fixtures" — curated sets of inputs with known-good outputs that serve as regression benchmarks. When an AI model is updated, these fixtures detect capability regressions before they reach production.`,
    content_metadata: { author: 'Martin Fowler', date: '2026-03-07', type: 'article', category: 'testing' },
    price: 0.0004
  },
  {
    url: 'https://www.nature.com/articles/ai-protein-folding-2026',
    content_text: `DeepMind's AlphaFold 3 has achieved a breakthrough in protein-ligand interaction prediction, accurately modeling how drug molecules bind to protein targets with 92% accuracy — up from 65% in AlphaFold 2.\n\nThe improvement enables virtual drug screening at unprecedented scale. Pharmaceutical companies can now test millions of candidate drug molecules computationally before synthesizing any in the lab, reducing early-stage drug discovery costs by an estimated 70%.\n\nThree drug candidates discovered using AlphaFold 3 have entered Phase 1 clinical trials, targeting antibiotic-resistant bacteria, a rare genetic disorder, and pancreatic cancer. If successful, they would be the first AI-discovered drugs to reach human trials.`,
    content_metadata: { author: 'Nature Editorial', date: '2026-03-13', type: 'news', category: 'science' },
    price: 0.0005
  },
  {
    url: 'https://svelte.dev/blog/svelte-6',
    content_text: `Svelte 6 introduces "reactive blocks" — a new primitive that combines the simplicity of Svelte's reactivity with the composability of React hooks. Reactive blocks are functions that automatically track their dependencies and re-run when inputs change.\n\nThe release also includes: native TypeScript support without preprocessing, a built-in state management solution replacing Svelte stores, server-side rendering improvements that reduce TTFB by 60%, and integration with the new CSS Scope proposal.\n\nSvelteKit 3, released alongside Svelte 6, adds edge deployment support for Cloudflare Workers, Deno Deploy, and Vercel Edge Functions. The framework now handles 50,000+ requests per second on a single edge node.`,
    content_metadata: { author: 'Rich Harris', date: '2026-03-04', type: 'blog', category: 'web-dev' },
    price: 0.0003
  },
  {
    url: 'https://kubernetes.io/blog/2026/03/kubernetes-1-32',
    content_text: `Kubernetes 1.32 reaches general availability with the much-anticipated "Gateway API" replacing Ingress as the standard for traffic management. The Gateway API provides a role-oriented, portable, and extensible approach to service networking.\n\nOther notable changes: sidecar containers are now GA (ordered startup/shutdown with the main container), in-place resource resize allows changing CPU/memory without pod restart, and the new "PodFailurePolicy" gives fine-grained control over retry behavior.\n\nThe release also deprecates several alpha features that never graduated, and removes support for Docker as a container runtime (containerd and CRI-O are the supported options). Cluster autoscaling improvements reduce scale-up latency by 50%.`,
    content_metadata: { author: 'Kubernetes Release Team', date: '2026-03-06', type: 'documentation', category: 'devops' },
    price: 0.0003
  }
];

// ─── CodeVault: code-focused content ────────────────────────────

const codeVaultContent = [
  {
    url: 'https://github.com/tiangolo/fastapi/blob/main/README.md',
    content_text: `FastAPI is a modern, fast (high-performance) web framework for building APIs with Python 3.8+ based on standard Python type hints.\n\nKey features: automatic API documentation (Swagger UI and ReDoc), data validation using Pydantic v2, dependency injection system, OAuth2 with JWT tokens, WebSocket support, and background tasks.\n\nInstallation:\n\`\`\`bash\npip install "fastapi[standard]"\nuvicorn main:app --reload\n\`\`\`\n\nQuick example:\n\`\`\`python\nfrom fastapi import FastAPI\n\napp = FastAPI()\n\n@app.get("/")\nasync def root():\n    return {"message": "Hello World"}\n\n@app.get("/items/{item_id}")\nasync def read_item(item_id: int, q: str | None = None):\n    return {"item_id": item_id, "q": q}\n\`\`\`\n\nFastAPI achieves performance comparable to Node.js and Go frameworks, benchmarked at 15,000+ requests/second on a single core.`,
    content_metadata: { author: 'Sebastián Ramírez', date: '2026-03-01', type: 'readme', category: 'python', language: 'python' },
    price: 0.0003
  },
  {
    url: 'https://github.com/expressjs/express/blob/main/Readme.md',
    content_text: `Express is a minimal and flexible Node.js web application framework that provides a robust set of features for web and mobile applications.\n\nExpress 5.0 is now stable, featuring: async error handling (no more try-catch in every route), built-in body parsing, improved router performance, and native ESM support.\n\n\`\`\`javascript\nimport express from 'express';\nconst app = express();\n\napp.get('/', (req, res) => {\n  res.send('Hello World');\n});\n\napp.post('/api/users', async (req, res) => {\n  const user = await User.create(req.body);\n  res.status(201).json(user);\n});\n\napp.listen(3000);\n\`\`\`\n\nExpress remains the most-used Node.js framework with 65 million weekly npm downloads, though newer alternatives like Fastify and Hono are gaining ground for performance-critical applications.`,
    content_metadata: { author: 'Express Contributors', date: '2026-02-15', type: 'readme', category: 'javascript', language: 'javascript' },
    price: 0.0003
  },
  {
    url: 'https://stackoverflow.com/questions/41030361/how-to-implement-jwt-authentication-in-python',
    content_text: `JWT Authentication in Python — Complete Implementation Guide\n\nUsing PyJWT and FastAPI:\n\n\`\`\`python\nimport jwt\nfrom datetime import datetime, timedelta\nfrom fastapi import Depends, HTTPException, status\nfrom fastapi.security import HTTPBearer\n\nSECRET_KEY = "your-secret-key"  # Use env var in production\nALGORITHM = "HS256"\n\ndef create_access_token(data: dict, expires_delta: timedelta = timedelta(hours=1)):\n    to_encode = data.copy()\n    expire = datetime.utcnow() + expires_delta\n    to_encode.update({"exp": expire})\n    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)\n\ndef verify_token(token: str):\n    try:\n        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])\n        return payload\n    except jwt.ExpiredSignatureError:\n        raise HTTPException(status_code=401, detail="Token expired")\n    except jwt.InvalidTokenError:\n        raise HTTPException(status_code=401, detail="Invalid token")\n\`\`\`\n\nBest practices: use RS256 for distributed systems, rotate keys regularly, keep tokens short-lived (15 min for access, 7 days for refresh), and store refresh tokens server-side.`,
    content_metadata: { author: 'StackOverflow Community', date: '2026-01-20', type: 'answer', category: 'authentication', language: 'python', votes: 1247 },
    price: 0.0003
  },
  {
    url: 'https://docs.python.org/3.13/library/asyncio.html',
    content_text: `asyncio — Asynchronous I/O, event loop, and concurrency tools for Python.\n\nPython 3.13 asyncio improvements:\n- TaskGroup for structured concurrency (replaces gather for error handling)\n- New asyncio.Runner for synchronous entry points\n- Improved cancellation semantics\n\n\`\`\`python\nimport asyncio\n\nasync def fetch_data(url: str) -> dict:\n    async with aiohttp.ClientSession() as session:\n        async with session.get(url) as response:\n            return await response.json()\n\nasync def main():\n    async with asyncio.TaskGroup() as tg:\n        task1 = tg.create_task(fetch_data("https://api.example.com/users"))\n        task2 = tg.create_task(fetch_data("https://api.example.com/posts"))\n    \n    users = task1.result()\n    posts = task2.result()\n    print(f"Got {len(users)} users and {len(posts)} posts")\n\nasyncio.run(main())\n\`\`\`\n\nPerformance note: asyncio with uvloop achieves 2-4x throughput compared to the default event loop. Install with pip install uvloop and set it as the event loop policy.`,
    content_metadata: { author: 'Python Docs', date: '2026-02-01', type: 'documentation', category: 'python', language: 'python' },
    price: 0.0002
  },
  {
    url: 'https://github.com/facebook/react/blob/main/README.md',
    content_text: `React — A JavaScript library for building user interfaces.\n\nReact 19 introduced Server Components, Actions, and the use() hook as stable features. React 20 (in beta) adds the React Forge compiler and signals-compatible reactivity.\n\n\`\`\`jsx\nimport { useState, useEffect } from 'react';\n\nfunction UserProfile({ userId }) {\n  const [user, setUser] = useState(null);\n  \n  useEffect(() => {\n    fetch(\`/api/users/\${userId}\`)\n      .then(res => res.json())\n      .then(setUser);\n  }, [userId]);\n  \n  if (!user) return <div>Loading...</div>;\n  \n  return (\n    <div>\n      <h1>{user.name}</h1>\n      <p>{user.email}</p>\n    </div>\n  );\n}\n\`\`\`\n\nReact maintains its position as the most-used UI framework with 23 million weekly npm downloads. The ecosystem includes React Native for mobile, React Server Components for SSR, and integration with meta-frameworks like Next.js and Remix.`,
    content_metadata: { author: 'Meta', date: '2026-03-01', type: 'readme', category: 'javascript', language: 'javascript' },
    price: 0.0003
  },
  {
    url: 'https://stackoverflow.com/questions/62001878/how-to-rate-limit-api-express',
    content_text: `Rate Limiting an Express.js API — Production Implementation\n\nUsing express-rate-limit with Redis store for distributed deployments:\n\n\`\`\`javascript\nimport rateLimit from 'express-rate-limit';\nimport RedisStore from 'rate-limit-redis';\nimport { createClient } from 'redis';\n\nconst redisClient = createClient({ url: process.env.REDIS_URL });\nawait redisClient.connect();\n\nconst limiter = rateLimit({\n  store: new RedisStore({ sendCommand: (...args) => redisClient.sendCommand(args) }),\n  windowMs: 15 * 60 * 1000,  // 15 minutes\n  max: 100,                   // 100 requests per window\n  standardHeaders: true,      // RateLimit-* headers\n  legacyHeaders: false,\n  keyGenerator: (req) => req.headers['x-api-key'] || req.ip,\n  handler: (req, res) => {\n    res.status(429).json({\n      error: 'Too many requests',\n      retryAfter: Math.ceil(req.rateLimit.resetTime / 1000)\n    });\n  }\n});\n\napp.use('/api/', limiter);\n\`\`\`\n\nFor more granular control, consider sliding window algorithms or token bucket implementations. Libraries like bottleneck and p-throttle provide client-side rate limiting for outbound requests.`,
    content_metadata: { author: 'StackOverflow Community', date: '2026-02-10', type: 'answer', category: 'api-design', language: 'javascript', votes: 892 },
    price: 0.0003
  },
  {
    url: 'https://docs.stripe.com/api/authentication',
    content_text: `Stripe API Authentication Guide\n\nThe Stripe API uses API keys to authenticate requests. Include your secret key in the Authorization header:\n\n\`\`\`bash\ncurl https://api.stripe.com/v1/charges \\\n  -u sk_test_51abc123...\n\`\`\`\n\nOr in code:\n\`\`\`javascript\nimport Stripe from 'stripe';\nconst stripe = new Stripe(process.env.STRIPE_SECRET_KEY);\n\nconst paymentIntent = await stripe.paymentIntents.create({\n  amount: 2000,      // $20.00 in cents\n  currency: 'usd',\n  payment_method_types: ['card'],\n  metadata: { order_id: '12345' }\n});\n\`\`\`\n\nKey types: sk_test_* (test mode), sk_live_* (production), pk_* (publishable, client-side only), rk_* (restricted keys with limited permissions).\n\nSecurity: never expose secret keys in client-side code, use restricted keys with minimal permissions, rotate keys quarterly, and monitor the Stripe Dashboard for unusual activity.`,
    content_metadata: { author: 'Stripe Docs', date: '2026-01-30', type: 'documentation', category: 'api', language: 'javascript' },
    price: 0.0003
  },
  {
    url: 'https://github.com/astral-sh/ruff/blob/main/README.md',
    content_text: `Ruff — An extremely fast Python linter and formatter, written in Rust.\n\nRuff is 10-100x faster than existing linters (flake8, pylint, isort) and formatters (black, autopep8). It can lint and format a large Python codebase in milliseconds.\n\n\`\`\`bash\npip install ruff\n\n# Lint\nruff check .\n\n# Format (Black-compatible)\nruff format .\n\n# Fix auto-fixable issues\nruff check --fix .\n\`\`\`\n\nConfiguration in pyproject.toml:\n\`\`\`toml\n[tool.ruff]\nline-length = 100\ntarget-version = "py312"\n\n[tool.ruff.lint]\nselect = ["E", "F", "I", "N", "UP", "B", "SIM"]\nignore = ["E501"]  # Line length handled by formatter\n\`\`\`\n\nRuff replaces flake8, isort, pyupgrade, autoflake, and Black in a single tool. Adopted by major projects including FastAPI, Pandas, NumPy, and the Linux kernel (Python scripts).`,
    content_metadata: { author: 'Charlie Marsh', date: '2026-02-20', type: 'readme', category: 'python', language: 'python' },
    price: 0.0003
  },
  {
    url: 'https://stackoverflow.com/questions/58123398/how-to-setup-oauth2-google-login-node',
    content_text: `Setting Up Google OAuth2 Login in Node.js\n\nComplete implementation using Passport.js:\n\n\`\`\`javascript\nimport passport from 'passport';\nimport { Strategy as GoogleStrategy } from 'passport-google-oauth20';\n\npassport.use(new GoogleStrategy({\n    clientID: process.env.GOOGLE_CLIENT_ID,\n    clientSecret: process.env.GOOGLE_CLIENT_SECRET,\n    callbackURL: '/auth/google/callback'\n  },\n  async (accessToken, refreshToken, profile, done) => {\n    let user = await User.findOne({ googleId: profile.id });\n    if (!user) {\n      user = await User.create({\n        googleId: profile.id,\n        name: profile.displayName,\n        email: profile.emails[0].value,\n        avatar: profile.photos[0].value\n      });\n    }\n    return done(null, user);\n  }\n));\n\n// Routes\napp.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));\napp.get('/auth/google/callback', passport.authenticate('google', {\n  successRedirect: '/dashboard',\n  failureRedirect: '/login'\n}));\n\`\`\`\n\nFor production: use PKCE flow, validate the state parameter, set secure cookie options (httpOnly, sameSite, secure), and implement CSRF protection.`,
    content_metadata: { author: 'StackOverflow Community', date: '2026-01-15', type: 'answer', category: 'authentication', language: 'javascript', votes: 2341 },
    price: 0.0003
  },
  {
    url: 'https://docs.github.com/en/rest/overview',
    content_text: `GitHub REST API v3 — Comprehensive Overview\n\nAuthentication:\n\`\`\`bash\ncurl -H "Authorization: Bearer ghp_xxxxxxxxxxxx" https://api.github.com/user\n\`\`\`\n\nCommon endpoints:\n\`\`\`\nGET    /repos/{owner}/{repo}              # Get repository info\nGET    /repos/{owner}/{repo}/pulls         # List pull requests\nPOST   /repos/{owner}/{repo}/issues        # Create an issue\nGET    /repos/{owner}/{repo}/contents/{path}  # Get file contents\nPATCH  /repos/{owner}/{repo}/pulls/{number}   # Update a PR\n\`\`\`\n\nRate limits: 5,000 requests/hour for authenticated users, 60/hour for unauthenticated. Use conditional requests (If-Modified-Since, If-None-Match) to avoid consuming rate limit on unchanged resources.\n\nWebhooks: configure at Settings > Webhooks to receive push events for commits, PRs, issues, releases, and more. Validate webhook signatures using HMAC-SHA256.`,
    content_metadata: { author: 'GitHub Docs', date: '2026-02-28', type: 'documentation', category: 'api', language: 'rest' },
    price: 0.0002
  },
  {
    url: 'https://stackoverflow.com/questions/71245823/best-way-to-handle-errors-in-async-await',
    content_text: `Error Handling in Async/Await — Patterns and Best Practices\n\nPattern 1: Go-style tuple returns\n\`\`\`typescript\nasync function to<T>(promise: Promise<T>): Promise<[Error | null, T | null]> {\n  try {\n    const result = await promise;\n    return [null, result];\n  } catch (error) {\n    return [error as Error, null];\n  }\n}\n\n// Usage\nconst [err, user] = await to(fetchUser(id));\nif (err) {\n  logger.error('Failed to fetch user', { error: err, userId: id });\n  return res.status(500).json({ error: 'Internal server error' });\n}\n\`\`\`\n\nPattern 2: Custom error classes\n\`\`\`typescript\nclass AppError extends Error {\n  constructor(public statusCode: number, message: string, public isOperational = true) {\n    super(message);\n    Error.captureStackTrace(this, this.constructor);\n  }\n}\n\nclass NotFoundError extends AppError {\n  constructor(resource: string) {\n    super(404, \`\${resource} not found\`);\n  }\n}\n\`\`\`\n\nPattern 3: Express async wrapper (eliminates try-catch in every route)\n\`\`\`typescript\nconst asyncHandler = (fn: RequestHandler) => (req, res, next) =>\n  Promise.resolve(fn(req, res, next)).catch(next);\n\`\`\``,
    content_metadata: { author: 'StackOverflow Community', date: '2026-02-05', type: 'answer', category: 'error-handling', language: 'typescript', votes: 1834 },
    price: 0.0003
  },
  {
    url: 'https://docs.anthropic.com/en/api/getting-started',
    content_text: `Anthropic API — Getting Started Guide\n\nAuthentication:\n\`\`\`bash\ncurl https://api.anthropic.com/v1/messages \\\n  -H "x-api-key: $ANTHROPIC_API_KEY" \\\n  -H "anthropic-version: 2025-01-01" \\\n  -H "content-type: application/json" \\\n  -d '{"model":"claude-sonnet-4-20250514","max_tokens":1024,"messages":[{"role":"user","content":"Hello"}]}'\n\`\`\`\n\nPython SDK:\n\`\`\`python\nimport anthropic\n\nclient = anthropic.Anthropic()  # Uses ANTHROPIC_API_KEY env var\n\nmessage = client.messages.create(\n    model="claude-sonnet-4-20250514",\n    max_tokens=1024,\n    messages=[{"role": "user", "content": "Explain quantum computing in 3 sentences."}]\n)\nprint(message.content[0].text)\n\`\`\`\n\nStreaming, tool use, vision, and multi-turn conversations are all supported. See the full API reference for details on system prompts, temperature control, and token counting.`,
    content_metadata: { author: 'Anthropic Docs', date: '2026-03-01', type: 'documentation', category: 'api', language: 'python' },
    price: 0.0003
  },
  {
    url: 'https://stackoverflow.com/questions/67234519/database-migration-best-practices',
    content_text: `Database Migration Best Practices for Production Systems\n\n1. **Never run destructive migrations directly.** Always use a two-phase approach:\n   - Phase 1: Add new column/table (backward compatible)\n   - Phase 2: Migrate data + deploy new code\n   - Phase 3: Drop old column/table (after verification)\n\n2. **Migration safety checklist:**\n\`\`\`sql\n-- SAFE: Adding a nullable column\nALTER TABLE users ADD COLUMN phone TEXT;\n\n-- SAFE: Adding an index concurrently (Postgres)\nCREATE INDEX CONCURRENTLY idx_users_email ON users(email);\n\n-- DANGEROUS: Changing column type\n-- Instead, add new column, backfill, swap\nALTER TABLE users ADD COLUMN email_new VARCHAR(320);\nUPDATE users SET email_new = email;\n-- Deploy code reading email_new\n-- Then: ALTER TABLE users DROP COLUMN email;\n\`\`\`\n\n3. **Use migration tools:** Knex.js (Node), Alembic (Python/SQLAlchemy), Flyway (Java), golang-migrate (Go). Always version migrations sequentially and never modify a deployed migration.`,
    content_metadata: { author: 'StackOverflow Community', date: '2026-01-25', type: 'answer', category: 'database', language: 'sql', votes: 967 },
    price: 0.0003
  },
  {
    url: 'https://github.com/pydantic/pydantic/blob/main/README.md',
    content_text: `Pydantic — Data validation using Python type annotations.\n\nPydantic v2 is a ground-up rewrite with a Rust core (pydantic-core), delivering 5-50x performance improvements over v1.\n\n\`\`\`python\nfrom pydantic import BaseModel, Field, validator\nfrom datetime import datetime\nfrom typing import Optional\n\nclass User(BaseModel):\n    id: int\n    name: str = Field(min_length=1, max_length=100)\n    email: str\n    created_at: datetime = Field(default_factory=datetime.now)\n    role: str = "user"\n    bio: Optional[str] = None\n    \n    @field_validator('email')\n    @classmethod\n    def validate_email(cls, v):\n        if '@' not in v:\n            raise ValueError('Invalid email')\n        return v.lower()\n\n# Validation happens automatically\nuser = User(id=1, name="Alice", email="Alice@Example.com")\nprint(user.email)  # alice@example.com\nprint(user.model_dump_json())  # Serialization\n\`\`\`\n\nUsed by FastAPI, LangChain, Instructor, and thousands of other projects. Pydantic models are the standard way to define data schemas in modern Python.`,
    content_metadata: { author: 'Samuel Colvin', date: '2026-02-10', type: 'readme', category: 'python', language: 'python' },
    price: 0.0003
  },
  {
    url: 'https://docs.openai.com/api-reference/chat-completions',
    content_text: `OpenAI Chat Completions API Reference\n\n\`\`\`bash\ncurl https://api.openai.com/v1/chat/completions \\\n  -H "Authorization: Bearer $OPENAI_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "model": "gpt-4o",\n    "messages": [\n      {"role": "system", "content": "You are a helpful assistant."},\n      {"role": "user", "content": "Write a haiku about programming."}\n    ],\n    "temperature": 0.7,\n    "max_tokens": 150\n  }'\n\`\`\`\n\nFunction calling:\n\`\`\`python\nresponse = client.chat.completions.create(\n    model="gpt-4o",\n    messages=[{"role": "user", "content": "What's the weather in SF?"}],\n    tools=[{\n        "type": "function",\n        "function": {\n            "name": "get_weather",\n            "parameters": {"type": "object", "properties": {"location": {"type": "string"}}}\n        }\n    }]\n)\n\`\`\`\n\nModels: gpt-4o (best quality), gpt-4o-mini (fast+cheap), o1 (reasoning), gpt-5 (latest). All support streaming, tool calling, vision, and structured outputs.`,
    content_metadata: { author: 'OpenAI Docs', date: '2026-03-15', type: 'documentation', category: 'api', language: 'python' },
    price: 0.0003
  },
  {
    url: 'https://stackoverflow.com/questions/78901234/websocket-vs-sse-for-real-time',
    content_text: `WebSocket vs Server-Sent Events (SSE) — When to Use Which\n\n**Use SSE when:**\n- Server pushes data to client (one-way)\n- Auto-reconnection needed (built-in)\n- Simple text/event streaming\n- Works through proxies/load balancers without special config\n\n\`\`\`javascript\n// Server (Express)\napp.get('/events', (req, res) => {\n  res.setHeader('Content-Type', 'text/event-stream');\n  res.setHeader('Cache-Control', 'no-cache');\n  res.setHeader('Connection', 'keep-alive');\n  \n  const interval = setInterval(() => {\n    res.write(\`data: \${JSON.stringify({ time: Date.now() })}\\n\\n\`);\n  }, 1000);\n  \n  req.on('close', () => clearInterval(interval));\n});\n\n// Client\nconst source = new EventSource('/events');\nsource.onmessage = (e) => console.log(JSON.parse(e.data));\n\`\`\`\n\n**Use WebSocket when:**\n- Bidirectional communication needed\n- Low-latency real-time (gaming, chat)\n- Binary data transfer\n- Custom protocol needed\n\n**Performance:** SSE uses less memory per connection. WebSocket has lower latency for bidirectional messages. For most dashboard/feed use cases, SSE is simpler and sufficient.`,
    content_metadata: { author: 'StackOverflow Community', date: '2026-02-18', type: 'answer', category: 'real-time', language: 'javascript', votes: 1156 },
    price: 0.0003
  },
  {
    url: 'https://github.com/go-chi/chi/blob/master/README.md',
    content_text: `chi — lightweight, idiomatic and composable router for building Go HTTP services.\n\nchi is built on the standard net/http package and requires no external dependencies. It focuses on composition of middleware and routing.\n\n\`\`\`go\npackage main\n\nimport (\n  "net/http"\n  "github.com/go-chi/chi/v5"\n  "github.com/go-chi/chi/v5/middleware"\n)\n\nfunc main() {\n  r := chi.NewRouter()\n  r.Use(middleware.Logger)\n  r.Use(middleware.Recoverer)\n  r.Use(middleware.RealIP)\n  \n  r.Get("/", func(w http.ResponseWriter, r *http.Request) {\n    w.Write([]byte("Hello World"))\n  })\n  \n  r.Route("/api/articles", func(r chi.Router) {\n    r.Get("/", listArticles)\n    r.Post("/", createArticle)\n    r.Route("/{articleID}", func(r chi.Router) {\n      r.Get("/", getArticle)\n      r.Put("/", updateArticle)\n      r.Delete("/", deleteArticle)\n    })\n  })\n  \n  http.ListenAndServe(":3000", r)\n}\n\`\`\`\n\nchi consistently benchmarks as one of the fastest Go routers while maintaining a clean, stdlib-compatible API.`,
    content_metadata: { author: 'Peter Kieltyka', date: '2026-01-20', type: 'readme', category: 'go', language: 'go' },
    price: 0.0003
  },
  {
    url: 'https://docs.docker.com/compose/compose-file/',
    content_text: `Docker Compose File Reference — Complete Guide\n\nDocker Compose v2 (the default since Docker Desktop 4.0) uses the compose.yaml file format:\n\n\`\`\`yaml\nservices:\n  web:\n    build: .\n    ports:\n      - "3000:3000"\n    environment:\n      - DATABASE_URL=postgres://user:pass@db:5432/myapp\n    depends_on:\n      db:\n        condition: service_healthy\n    deploy:\n      replicas: 2\n      resources:\n        limits:\n          cpus: '0.5'\n          memory: 512M\n\n  db:\n    image: postgres:16\n    volumes:\n      - pgdata:/var/lib/postgresql/data\n    environment:\n      POSTGRES_PASSWORD: secret\n    healthcheck:\n      test: ["CMD-SHELL", "pg_isready -U postgres"]\n      interval: 5s\n      timeout: 5s\n      retries: 5\n\n  redis:\n    image: redis:7-alpine\n    ports:\n      - "6379:6379"\n\nvolumes:\n  pgdata:\n\`\`\`\n\nKey concepts: services (containers), volumes (persistent storage), networks (communication), configs (non-sensitive configuration), secrets (sensitive data). Use profiles to define optional services for development vs production.`,
    content_metadata: { author: 'Docker Docs', date: '2026-02-01', type: 'documentation', category: 'devops', language: 'yaml' },
    price: 0.0002
  },
  {
    url: 'https://stackoverflow.com/questions/82345678/typescript-generics-practical-guide',
    content_text: `TypeScript Generics — Practical Patterns You'll Actually Use\n\nPattern 1: Generic API client\n\`\`\`typescript\nasync function apiGet<T>(url: string): Promise<T> {\n  const response = await fetch(url);\n  if (!response.ok) throw new Error(\`HTTP \${response.status}\`);\n  return response.json() as Promise<T>;\n}\n\ninterface User { id: number; name: string; email: string; }\nconst user = await apiGet<User>('/api/users/1');\n// user is typed as User\n\`\`\`\n\nPattern 2: Builder pattern with type accumulation\n\`\`\`typescript\nclass QueryBuilder<T extends Record<string, unknown>> {\n  private filters: Partial<T> = {};\n  \n  where<K extends keyof T>(key: K, value: T[K]): this {\n    this.filters[key] = value;\n    return this;\n  }\n  \n  build(): Partial<T> { return { ...this.filters }; }\n}\n\nconst query = new QueryBuilder<User>()\n  .where('name', 'Alice')    // Type-safe: 'name' must be keyof User\n  .where('email', 'a@b.com') // Value must match User['email'] type\n  .build();\n\`\`\`\n\nPattern 3: Discriminated union with exhaustive checking\n\`\`\`typescript\ntype Result<T> = { ok: true; value: T } | { ok: false; error: Error };\n\nfunction unwrap<T>(result: Result<T>): T {\n  if (result.ok) return result.value;\n  throw result.error;\n}\n\`\`\``,
    content_metadata: { author: 'StackOverflow Community', date: '2026-03-02', type: 'answer', category: 'typescript', language: 'typescript', votes: 2089 },
    price: 0.0003
  },
  {
    url: 'https://github.com/langchain-ai/langchain/blob/main/README.md',
    content_text: `LangChain — Building applications with LLMs through composability.\n\nLangChain provides a standard interface for chains, tools, and memory, making it easy to build complex LLM applications.\n\n\`\`\`python\nfrom langchain_openai import ChatOpenAI\nfrom langchain_core.prompts import ChatPromptTemplate\nfrom langchain_core.output_parsers import StrOutputParser\n\n# Simple chain\nmodel = ChatOpenAI(model="gpt-4o")\nprompt = ChatPromptTemplate.from_messages([\n    ("system", "You are a helpful assistant that translates {input_language} to {output_language}."),\n    ("human", "{input}")\n])\nchain = prompt | model | StrOutputParser()\n\nresult = chain.invoke({\n    "input_language": "English",\n    "output_language": "French",\n    "input": "Hello, how are you?"\n})\nprint(result)  # "Bonjour, comment allez-vous ?"\n\`\`\`\n\nKey components: Models (LLM wrappers), Prompts (template system), Chains (composition), Tools (function calling), Memory (conversation history), Retrievers (RAG), and Agents (autonomous reasoning).`,
    content_metadata: { author: 'Harrison Chase', date: '2026-03-10', type: 'readme', category: 'ai', language: 'python' },
    price: 0.0003
  },
  {
    url: 'https://docs.pytest.org/en/latest/how-to/fixtures.html',
    content_text: `pytest Fixtures — Comprehensive Guide\n\nFixtures provide a fixed baseline for tests to run reliably. They handle setup, teardown, and dependency injection.\n\n\`\`\`python\nimport pytest\nfrom myapp import create_app, db\n\n@pytest.fixture\ndef app():\n    """Create application for testing."""\n    app = create_app(testing=True)\n    with app.app_context():\n        db.create_all()\n        yield app\n        db.drop_all()\n\n@pytest.fixture\ndef client(app):\n    """Test client that uses the app fixture."""\n    return app.test_client()\n\n@pytest.fixture\ndef sample_user(client):\n    """Create and return a test user."""\n    response = client.post('/api/users', json={\n        'name': 'Test User',\n        'email': 'test@example.com'\n    })\n    return response.json\n\ndef test_get_user(client, sample_user):\n    response = client.get(f'/api/users/{sample_user["id"]}')\n    assert response.status_code == 200\n    assert response.json['name'] == 'Test User'\n\`\`\`\n\nScopes: function (default), class, module, package, session. Use conftest.py to share fixtures across test files. The tmpdir and tmp_path fixtures provide temporary directories that are cleaned up automatically.`,
    content_metadata: { author: 'pytest Docs', date: '2026-01-10', type: 'documentation', category: 'testing', language: 'python' },
    price: 0.0002
  },
  {
    url: 'https://stackoverflow.com/questions/83456789/rust-error-handling-patterns',
    content_text: `Rust Error Handling — Idiomatic Patterns\n\nPattern 1: Custom error type with thiserror\n\`\`\`rust\nuse thiserror::Error;\n\n#[derive(Error, Debug)]\nenum AppError {\n    #[error("Database error: {0}")]\n    Database(#[from] sqlx::Error),\n    #[error("Not found: {resource} with id {id}")]\n    NotFound { resource: String, id: i64 },\n    #[error("Validation failed: {0}")]\n    Validation(String),\n    #[error("Unauthorized")]\n    Unauthorized,\n}\n\nimpl AppError {\n    fn status_code(&self) -> StatusCode {\n        match self {\n            Self::NotFound { .. } => StatusCode::NOT_FOUND,\n            Self::Validation(_) => StatusCode::BAD_REQUEST,\n            Self::Unauthorized => StatusCode::UNAUTHORIZED,\n            _ => StatusCode::INTERNAL_SERVER_ERROR,\n        }\n    }\n}\n\`\`\`\n\nPattern 2: The ? operator chain\n\`\`\`rust\nasync fn get_user_posts(db: &Pool, user_id: i64) -> Result<Vec<Post>, AppError> {\n    let user = db.get_user(user_id).await?.ok_or(AppError::NotFound {\n        resource: "User".into(), id: user_id\n    })?;\n    let posts = db.get_posts_by_author(user.id).await?;\n    Ok(posts)\n}\n\`\`\`\n\nUse anyhow for applications (easy error propagation), thiserror for libraries (precise error types).`,
    content_metadata: { author: 'StackOverflow Community', date: '2026-02-22', type: 'answer', category: 'rust', language: 'rust', votes: 1423 },
    price: 0.0003
  },
  {
    url: 'https://github.com/drizzle-team/drizzle-orm/blob/main/README.md',
    content_text: `Drizzle ORM — TypeScript ORM that lets you write SQL in TypeScript with full type safety.\n\nDrizzle generates zero runtime overhead — your queries compile to plain SQL strings. No query builder abstraction layer.\n\n\`\`\`typescript\nimport { pgTable, serial, text, timestamp, integer } from 'drizzle-orm/pg-core';\nimport { drizzle } from 'drizzle-orm/node-postgres';\nimport { eq, and, gt } from 'drizzle-orm';\n\nconst users = pgTable('users', {\n  id: serial('id').primaryKey(),\n  name: text('name').notNull(),\n  email: text('email').notNull().unique(),\n  createdAt: timestamp('created_at').defaultNow()\n});\n\nconst db = drizzle(connectionString);\n\n// Type-safe queries\nconst result = await db.select()\n  .from(users)\n  .where(and(\n    eq(users.name, 'Alice'),\n    gt(users.createdAt, new Date('2026-01-01'))\n  ));\n// result is typed as { id: number; name: string; email: string; createdAt: Date }[]\n\`\`\`\n\nSupports PostgreSQL, MySQL, SQLite, and Turso. Includes drizzle-kit for schema migrations and drizzle-studio for database browsing.`,
    content_metadata: { author: 'Drizzle Team', date: '2026-02-25', type: 'readme', category: 'database', language: 'typescript' },
    price: 0.0003
  },
  {
    url: 'https://stackoverflow.com/questions/84567890/how-to-implement-retry-with-exponential-backoff',
    content_text: `Implementing Retry with Exponential Backoff — Multiple Languages\n\n**JavaScript/TypeScript:**\n\`\`\`typescript\nasync function withRetry<T>(\n  fn: () => Promise<T>,\n  maxRetries: number = 3,\n  baseDelay: number = 1000\n): Promise<T> {\n  for (let attempt = 0; attempt <= maxRetries; attempt++) {\n    try {\n      return await fn();\n    } catch (error) {\n      if (attempt === maxRetries) throw error;\n      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;\n      console.log(\`Attempt \${attempt + 1} failed, retrying in \${Math.round(delay)}ms...\`);\n      await new Promise(resolve => setTimeout(resolve, delay));\n    }\n  }\n  throw new Error('Unreachable');\n}\n\n// Usage\nconst data = await withRetry(() => fetch('https://api.example.com/data'), 3, 500);\n\`\`\`\n\n**Python:**\n\`\`\`python\nimport asyncio\nimport random\n\nasync def with_retry(fn, max_retries=3, base_delay=1.0):\n    for attempt in range(max_retries + 1):\n        try:\n            return await fn()\n        except Exception as e:\n            if attempt == max_retries:\n                raise\n            delay = base_delay * (2 ** attempt) + random.uniform(0, 1)\n            await asyncio.sleep(delay)\n\`\`\`\n\nKey: always add jitter (random component) to prevent thundering herd when multiple clients retry simultaneously.`,
    content_metadata: { author: 'StackOverflow Community', date: '2026-03-05', type: 'answer', category: 'patterns', language: 'typescript', votes: 1678 },
    price: 0.0003
  },
  {
    url: 'https://docs.aws.com/lambda/latest/dg/lambda-nodejs',
    content_text: `AWS Lambda with Node.js — Developer Guide\n\nLambda supports Node.js 20 and 22 runtimes. The handler function receives an event object and context:\n\n\`\`\`javascript\nexport const handler = async (event, context) => {\n  // event contains the trigger payload\n  const { httpMethod, path, body, queryStringParameters } = event;\n  \n  try {\n    const result = await processRequest(event);\n    return {\n      statusCode: 200,\n      headers: { 'Content-Type': 'application/json' },\n      body: JSON.stringify(result)\n    };\n  } catch (error) {\n    return {\n      statusCode: 500,\n      body: JSON.stringify({ error: error.message })\n    };\n  }\n};\n\`\`\`\n\nBest practices for production Lambda:\n- Use layers for shared dependencies (reduces deployment size)\n- Set memory to 1769 MB to get a full vCPU\n- Enable provisioned concurrency for latency-sensitive functions\n- Use environment variables for configuration, Secrets Manager for secrets\n- Keep handler functions thin — business logic in separate modules for testability`,
    content_metadata: { author: 'AWS Docs', date: '2026-02-15', type: 'documentation', category: 'serverless', language: 'javascript' },
    price: 0.0003
  },
  {
    url: 'https://github.com/honojs/hono/blob/main/README.md',
    content_text: `Hono — Ultrafast web framework for the Edges.\n\nHono is a small, simple, and ultrafast web framework built on Web Standards. It runs on Cloudflare Workers, Fastly Compute, Deno, Bun, Vercel, AWS Lambda, and Node.js.\n\n\`\`\`typescript\nimport { Hono } from 'hono';\nimport { cors } from 'hono/cors';\nimport { logger } from 'hono/logger';\nimport { jwt } from 'hono/jwt';\n\nconst app = new Hono();\n\napp.use('*', cors());\napp.use('*', logger());\napp.use('/api/*', jwt({ secret: 'your-secret' }));\n\napp.get('/', (c) => c.text('Hello Hono!'));\n\napp.get('/api/users/:id', async (c) => {\n  const id = c.req.param('id');\n  const user = await db.getUser(id);\n  return c.json(user);\n});\n\nexport default app;\n\`\`\`\n\nBenchmarks show Hono handling 150,000+ req/sec on Bun, making it the fastest JavaScript/TypeScript web framework available. The middleware ecosystem includes auth, validation, OpenAPI, GraphQL, and tRPC adapters.`,
    content_metadata: { author: 'Yusuke Wada', date: '2026-03-08', type: 'readme', category: 'javascript', language: 'typescript' },
    price: 0.0003
  },
  {
    url: 'https://docs.sqlalchemy.org/en/20/orm/quickstart.html',
    content_text: `SQLAlchemy 2.0 ORM Quick Start\n\nSQLAlchemy 2.0 uses a fully typed, modern Python API with native async support:\n\n\`\`\`python\nfrom sqlalchemy import create_engine, String, ForeignKey\nfrom sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, Session\nfrom typing import List, Optional\n\nclass Base(DeclarativeBase):\n    pass\n\nclass User(Base):\n    __tablename__ = "users"\n    \n    id: Mapped[int] = mapped_column(primary_key=True)\n    name: Mapped[str] = mapped_column(String(100))\n    email: Mapped[str] = mapped_column(String(255), unique=True)\n    posts: Mapped[List["Post"]] = relationship(back_populates="author")\n\nclass Post(Base):\n    __tablename__ = "posts"\n    \n    id: Mapped[int] = mapped_column(primary_key=True)\n    title: Mapped[str] = mapped_column(String(200))\n    content: Mapped[Optional[str]]\n    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"))\n    author: Mapped["User"] = relationship(back_populates="posts")\n\nengine = create_engine("sqlite:///app.db")\nBase.metadata.create_all(engine)\n\nwith Session(engine) as session:\n    user = User(name="Alice", email="alice@example.com")\n    session.add(user)\n    session.commit()\n\`\`\`\n\nSQLAlchemy 2.0 provides full type checker support with mypy and pyright, making database code as type-safe as application code.`,
    content_metadata: { author: 'SQLAlchemy Docs', date: '2026-01-15', type: 'documentation', category: 'database', language: 'python' },
    price: 0.0002
  }
];

// ─── DataStream: finance/data content ───────────────────────────

const dataStreamContent = [
  {
    url: 'https://coinmarketcap.com/analysis/btc-march-2026',
    content_text: `Bitcoin Market Analysis — March 2026\n\nBitcoin is trading at $127,450, up 18% month-over-month following the approval of the first Bitcoin Reserve ETF by the SEC. Trading volume has averaged $85 billion daily, with institutional participation reaching record levels.\n\nKey metrics:\n- Market Cap: $2.52 trillion\n- Dominance: 54.3%\n- Hash Rate: 850 EH/s (all-time high)\n- Active Addresses: 1.2 million daily\n- Lightning Network Capacity: 12,500 BTC ($1.59 billion)\n\nTechnical analysis indicates strong support at $115,000 (50-day MA) and resistance at $135,000 (previous ATH). The RSI at 62 suggests room for continued upside. On-chain metrics show long-term holders (>1 year) controlling 78% of supply, indicating conviction.\n\nRisk factors: regulatory uncertainty in Asia, potential Fed rate increases, and a concentration of mining in three jurisdictions (US, Kazakhstan, Russia).`,
    content_metadata: { author: 'CoinMarketCap Research', date: '2026-03-20', type: 'market-report', category: 'crypto' },
    price: 0.0008
  },
  {
    url: 'https://finance.yahoo.com/news/sp500-q1-2026-earnings',
    content_text: `S&P 500 Q1 2026 Earnings Preview\n\nAnalysts expect S&P 500 earnings growth of 14.2% year-over-year for Q1 2026, driven primarily by the technology sector (+28%) and healthcare (+18%). The energy sector is expected to decline 8% due to lower oil prices.\n\nTop performers expected:\n- NVIDIA: Revenue $45B (+35% YoY), driven by AI datacenter demand\n- Microsoft: Revenue $72B (+16% YoY), Azure growth at 32%\n- Apple: Revenue $98B (+8% YoY), Vision Pro 2 contributing $4B\n- Amazon: Revenue $175B (+12% YoY), AWS margins expanding to 38%\n\nForward guidance will be critical. Companies citing AI-driven productivity gains have seen 2-3x P/E expansion. The market is trading at 22.5x forward earnings, above the 10-year average of 18.3x.\n\nKey risks: wage inflation (labor market still tight at 3.6% unemployment), commercial real estate defaults ($350B in loans maturing in 2026), and geopolitical tensions affecting semiconductor supply chains.`,
    content_metadata: { author: 'Yahoo Finance Research', date: '2026-03-18', type: 'market-report', category: 'equities' },
    price: 0.0008
  },
  {
    url: 'https://docs.binance.com/api/v3/market-data',
    content_text: `Binance API v3 — Market Data Endpoints\n\nPublic endpoints (no authentication required):\n\n\`\`\`\nGET /api/v3/ticker/price         # Latest price for a symbol\nGET /api/v3/ticker/24hr           # 24-hour price change statistics\nGET /api/v3/klines                # Candlestick/OHLCV data\nGET /api/v3/depth                 # Order book\nGET /api/v3/trades                # Recent trades\nGET /api/v3/avgPrice              # Current average price\n\`\`\`\n\nExample — Get BTC/USDT klines:\n\`\`\`python\nimport requests\n\nparams = {\n    'symbol': 'BTCUSDT',\n    'interval': '1h',\n    'limit': 100\n}\nresponse = requests.get('https://api.binance.com/api/v3/klines', params=params)\ncandles = response.json()\n\nfor c in candles:\n    open_time, open_price, high, low, close, volume = c[0], c[1], c[2], c[3], c[4], c[5]\n    print(f"Open: {open_price}, High: {high}, Low: {low}, Close: {close}, Volume: {volume}")\n\`\`\`\n\nRate limits: 1200 requests per minute for raw endpoints, 10 orders per second for trading. Use WebSocket streams for real-time data to avoid rate limits.`,
    content_metadata: { author: 'Binance Docs', date: '2026-02-15', type: 'documentation', category: 'api', language: 'python' },
    price: 0.0005
  },
  {
    url: 'https://ethereum.org/en/staking/economics-march-2026',
    content_text: `Ethereum Staking Economics Report — March 2026\n\nETH Price: $8,240 | Staking APR: 3.8% | Total Staked: 38.2M ETH (31.5% of supply)\n\nThe Shanghai upgrade's validator exit queue has stabilized, with net positive inflows of ~2,000 validators per week. The staking ratio is approaching the theoretical equilibrium of 33%.\n\nLiquid staking breakdown:\n- Lido: 28.4% of staked ETH ($89B TVL)\n- Rocket Pool: 5.2% ($16B TVL)\n- Coinbase cbETH: 4.8% ($15B TVL)\n- Solo validators: 18.3%\n- Other protocols: 43.3%\n\nEIP-7251 (MaxEB increase to 2048 ETH) has reduced the validator set from 950K to 680K, improving network efficiency. Average block rewards are $85 per block, with MEV contributing $12-18 per block via Flashbots.\n\nGas fees have averaged 15 gwei on L1 and 0.001 gwei on L2 rollups (Arbitrum, Optimism, Base). L2 transaction volume now exceeds L1 by 12x.`,
    content_metadata: { author: 'Ethereum Foundation', date: '2026-03-15', type: 'report', category: 'crypto' },
    price: 0.0008
  },
  {
    url: 'https://research.bloomberg.com/ai-spending-forecast-2026',
    content_text: `Global AI Spending Forecast 2026-2030\n\nBloomberg Intelligence projects global AI spending to reach $420 billion in 2026, growing at 38% CAGR to $1.3 trillion by 2030. The infrastructure layer (chips, data centers, cloud) accounts for 62% of spending.\n\nSpending breakdown by category:\n- AI Infrastructure (GPUs, TPUs, data centers): $260B (62%)\n- AI Software (platforms, tools, applications): $105B (25%)\n- AI Services (consulting, implementation, training): $55B (13%)\n\nTop spenders by industry:\n1. Technology: $145B (hyperscalers dominate)\n2. Financial Services: $52B (trading, risk, fraud)\n3. Healthcare: $38B (drug discovery, diagnostics)\n4. Manufacturing: $31B (automation, quality control)\n5. Retail: $28B (personalization, supply chain)\n\nROI analysis shows AI investments generating 3.2x returns over 3 years for companies in the top quartile of AI maturity, but only 0.8x for companies in the bottom quartile — reinforcing the "AI divide" between leaders and laggards.`,
    content_metadata: { author: 'Bloomberg Intelligence', date: '2026-03-12', type: 'research', category: 'market-forecast' },
    price: 0.001
  },
  {
    url: 'https://docs.alpaca.markets/api-reference/trading',
    content_text: `Alpaca Trading API — Complete Reference\n\nAlpaca provides commission-free trading through a REST API and WebSocket streams.\n\nAuthentication:\n\`\`\`python\nimport alpaca_trade_api as tradeapi\n\napi = tradeapi.REST(\n    key_id='APCA_API_KEY_ID',\n    secret_key='APCA_API_SECRET_KEY',\n    base_url='https://paper-api.alpaca.markets'  # Use paper trading for testing\n)\n\`\`\`\n\nPlace an order:\n\`\`\`python\n# Market order\napi.submit_order(\n    symbol='AAPL',\n    qty=10,\n    side='buy',\n    type='market',\n    time_in_force='day'\n)\n\n# Limit order with stop loss\napi.submit_order(\n    symbol='MSFT',\n    qty=5,\n    side='buy',\n    type='limit',\n    limit_price=420.00,\n    time_in_force='gtc',\n    order_class='bracket',\n    take_profit={'limit_price': 450.00},\n    stop_loss={'stop_price': 400.00}\n)\n\`\`\`\n\nWebSocket streaming for real-time quotes and trade updates:\n\`\`\`python\nconn = tradeapi.StreamConn()\n\n@conn.on(r'Q.AAPL')\nasync def on_quote(conn, channel, data):\n    print(f"AAPL bid: {data.bidprice}, ask: {data.askprice}")\n\`\`\``,
    content_metadata: { author: 'Alpaca Docs', date: '2026-02-20', type: 'documentation', category: 'api', language: 'python' },
    price: 0.0005
  },
  {
    url: 'https://arxiv.org/abs/2603.12345-ml-benchmark-2026',
    content_text: `ML Model Benchmarks — Q1 2026 Comprehensive Comparison\n\nThis paper presents updated benchmarks for major language models and ML systems across standardized evaluation suites.\n\nLanguage Model Rankings (MMLU-Pro):\n1. GPT-5: 94.2%\n2. Claude Opus 4: 93.8%\n3. Gemini Ultra 2.0: 92.1%\n4. Llama 4 400B: 89.5%\n5. Mistral Large 3: 87.2%\n\nCode Generation (HumanEval+):\n1. Claude Opus 4: 91.2%\n2. GPT-5: 89.1%\n3. Gemini Ultra 2.0: 85.3%\n4. DeepSeek Coder V3: 83.7%\n5. CodeLlama 70B: 78.4%\n\nMathematical Reasoning (MATH-500):\n1. GPT-5 (with chain-of-thought): 96.1%\n2. Claude Opus 4: 94.8%\n3. Gemini Ultra 2.0: 91.3%\n\nCost efficiency (performance per dollar):\n1. Llama 4 70B (self-hosted): $0.0002/1K tokens\n2. Claude Haiku: $0.0003/1K tokens\n3. GPT-4o-mini: $0.0004/1K tokens\n\nKey finding: the gap between proprietary and open-source models has narrowed to <5% on most benchmarks, with open models winning on cost efficiency.`,
    content_metadata: { author: 'ML Research Consortium', date: '2026-03-10', type: 'research', category: 'ml-benchmarks' },
    price: 0.0008
  },
  {
    url: 'https://defi.watch/tvl-analysis-march-2026',
    content_text: `DeFi Total Value Locked Analysis — March 2026\n\nTotal DeFi TVL: $285 billion (all-time high)\n\nTop protocols by TVL:\n1. Lido: $89B (liquid staking)\n2. Aave v4: $32B (lending)\n3. MakerDAO: $28B (stablecoin/lending)\n4. Uniswap v4: $18B (DEX)\n5. Eigenlayer: $15B (restaking)\n6. Pendle: $12B (yield trading)\n7. Compound v3: $9B (lending)\n8. Curve: $8B (stablecoin DEX)\n9. Rocket Pool: $16B (liquid staking)\n10. GMX: $5B (perpetuals)\n\nTrends:\n- Real-world asset (RWA) tokenization has grown 400% YoY, reaching $15B TVL\n- Cross-chain DeFi via intent-based bridges now handles $2B daily volume\n- Account abstraction has reduced DeFi onboarding friction — first-time DeFi users up 180% YoY\n\nRisk metrics:\n- Largest single-protocol risk: Lido (31% of TVL)\n- Smart contract audits: 72% of top 50 protocols have 3+ independent audits\n- Insurance coverage: only 8% of TVL is insured (up from 3% last year)`,
    content_metadata: { author: 'DeFi Watch', date: '2026-03-19', type: 'report', category: 'defi' },
    price: 0.0008
  },
  {
    url: 'https://www.kaggle.com/competitions/trends-2026-data-science',
    content_text: `Top Data Science Trends and Tools — 2026 Survey Results\n\nKaggle's annual survey of 45,000 data scientists reveals shifting preferences in tools, frameworks, and practices.\n\nMost-used ML frameworks:\n1. PyTorch: 72% (+5% YoY)\n2. TensorFlow: 41% (-8% YoY)\n3. JAX: 28% (+12% YoY)\n4. scikit-learn: 68% (stable)\n5. XGBoost: 55% (stable)\n\nMost-used languages:\n1. Python: 94%\n2. SQL: 78%\n3. R: 23% (-5% YoY)\n4. Rust: 15% (+8% YoY) — growing fast in ML infrastructure\n5. Julia: 8% (+2% YoY)\n\nEmerging skills in highest demand:\n1. LLM fine-tuning and evaluation\n2. MLOps / ML platform engineering\n3. Retrieval-Augmented Generation (RAG)\n4. Synthetic data generation\n5. AI safety and alignment\n\nSalary data (US median):\n- ML Engineer: $185,000\n- Data Scientist: $155,000\n- AI Research Scientist: $220,000\n- MLOps Engineer: $175,000`,
    content_metadata: { author: 'Kaggle Research', date: '2026-03-01', type: 'survey', category: 'data-science' },
    price: 0.0005
  },
  {
    url: 'https://docs.snowflake.com/en/user-guide/ai-features',
    content_text: `Snowflake AI Features Guide — Cortex ML and LLM Functions\n\nSnowflake Cortex provides built-in ML and LLM capabilities directly in SQL:\n\n\`\`\`sql\n-- Sentiment analysis\nSELECT text, SNOWFLAKE.CORTEX.SENTIMENT(text) as sentiment_score\nFROM customer_reviews\nWHERE date >= '2026-01-01';\n\n-- Text summarization\nSELECT SNOWFLAKE.CORTEX.SUMMARIZE(article_body, 'max_length=200') as summary\nFROM news_articles;\n\n-- Custom LLM inference\nSELECT SNOWFLAKE.CORTEX.COMPLETE(\n    'claude-sonnet',\n    CONCAT('Classify this support ticket: ', ticket_text)\n) as classification\nFROM support_tickets;\n\n-- Vector search for RAG\nCREATE TABLE documents_embeddings AS\nSELECT id, text, SNOWFLAKE.CORTEX.EMBED_TEXT_768('e5-base-v2', text) as embedding\nFROM documents;\n\nSELECT id, text, VECTOR_COSINE_SIMILARITY(embedding, \n    SNOWFLAKE.CORTEX.EMBED_TEXT_768('e5-base-v2', 'How to reset password?')\n) as similarity\nFROM documents_embeddings\nORDER BY similarity DESC\nLIMIT 5;\n\`\`\`\n\nSnowflake Cortex supports Claude, GPT-4o, Mistral, and Llama models. Data never leaves the Snowflake secure environment, addressing data governance concerns.`,
    content_metadata: { author: 'Snowflake Docs', date: '2026-02-28', type: 'documentation', category: 'data-platform' },
    price: 0.0005
  },
  {
    url: 'https://stripe.com/reports/developer-economy-2026',
    content_text: `Stripe Developer Economy Report 2026\n\nThe global API economy has reached $5.2 trillion in transaction volume processed through APIs, up 40% year-over-year. Key findings from Stripe's analysis of 4 million businesses:\n\nPayment trends:\n- Crypto payments: 8% of online transactions (up from 2% in 2024)\n- Buy Now Pay Later: 15% of e-commerce (plateauing)\n- Mobile wallets: 45% of in-person payments (Apple Pay + Google Pay)\n- Subscription economy: $380B annual recurring revenue\n\nAPI-first businesses:\n- Average API-first company processes $12M in annual revenue through APIs\n- API monetization revenue grew 55% YoY\n- Usage-based pricing adopted by 68% of new SaaS companies (up from 40%)\n\nDeveloper metrics:\n- Average time to first API call: 4.2 minutes (down from 12 minutes in 2024)\n- API documentation quality correlates with 3.5x higher adoption\n- SDKs in 5+ languages correlate with 2.8x higher integration success rate\n\nFraud and security:\n- ML-based fraud detection prevents $12B in fraudulent transactions quarterly\n- 3D Secure 2.0 adoption reduces fraud by 80% with only 2% conversion impact`,
    content_metadata: { author: 'Stripe Research', date: '2026-03-08', type: 'report', category: 'developer-economy' },
    price: 0.001
  },
  {
    url: 'https://cloud.google.com/bigquery/docs/ml-quickstart',
    content_text: `BigQuery ML Quick Start — Train Models with SQL\n\nBigQuery ML lets you create and execute machine learning models using standard SQL queries, directly on your data warehouse.\n\n\`\`\`sql\n-- Create a logistic regression model\nCREATE OR REPLACE MODEL \`myproject.mydataset.customer_churn_model\`\nOPTIONS(\n  model_type='logistic_reg',\n  input_label_cols=['churned'],\n  max_iterations=20\n) AS\nSELECT\n  tenure_months,\n  monthly_charges,\n  total_charges,\n  contract_type,\n  payment_method,\n  churned\nFROM \`myproject.mydataset.customer_data\`\nWHERE split_col < 0.8;  -- 80% training\n\n-- Evaluate the model\nSELECT * FROM ML.EVALUATE(MODEL \`myproject.mydataset.customer_churn_model\`,\n  (SELECT * FROM \`myproject.mydataset.customer_data\` WHERE split_col >= 0.8)\n);\n\n-- Make predictions\nSELECT customer_id, predicted_churned, predicted_churned_probs\nFROM ML.PREDICT(MODEL \`myproject.mydataset.customer_churn_model\`,\n  (SELECT * FROM \`myproject.mydataset.new_customers\`)\n);\n\`\`\`\n\nSupported models: linear regression, logistic regression, k-means clustering, time-series (ARIMA_PLUS), XGBoost, deep neural networks, and now LLM-based models via Vertex AI integration.`,
    content_metadata: { author: 'Google Cloud Docs', date: '2026-02-10', type: 'documentation', category: 'ml-platform', language: 'sql' },
    price: 0.0005
  },
  {
    url: 'https://research.jpmorgan.com/q1-2026-macro-outlook',
    content_text: `J.P. Morgan Q1 2026 Global Macro Outlook\n\nGlobal GDP growth forecast: 3.2% for 2026 (revised up from 2.8%)\n\nUS Economy:\n- GDP growth: 2.5% (consumer spending resilient)\n- Unemployment: 3.6% (labor market normalizing)\n- Inflation: 2.3% (approaching Fed target)\n- Fed funds rate: 4.25% (two cuts expected in H2 2026)\n\nEurope:\n- Eurozone GDP: 1.4% (Germany recovering)\n- ECB has cut rates to 2.5%, further cuts likely\n- UK GDP: 1.8% (post-Brexit trade deals boosting exports)\n\nChina:\n- GDP growth: 4.5% (property sector stabilizing)\n- Tech sector regulation eased, driving renewed investment\n- AI infrastructure spending: $60B (closing gap with US)\n\nMarket positioning:\n- Overweight: US tech, European industrials, Japan equities\n- Underweight: US consumer staples, Chinese property, emerging market bonds\n- Neutral: US treasuries, gold, investment-grade credit\n\nKey risks: US election uncertainty, Middle East oil supply disruption, AI-driven labor market disruption in services sector.`,
    content_metadata: { author: 'J.P. Morgan Research', date: '2026-03-05', type: 'research', category: 'macro-economics' },
    price: 0.001
  },
  {
    url: 'https://polygon.io/blog/real-time-data-architecture-2026',
    content_text: `Building Real-Time Financial Data Pipelines — Architecture Guide\n\nThis guide covers the architecture patterns used at Polygon.io to serve 50 billion market data events per day with sub-millisecond latency.\n\nArchitecture stack:\n- Ingestion: Custom UDP receivers (C++) for exchange feeds\n- Message bus: Apache Kafka with Redpanda (10M events/sec/broker)\n- Processing: Apache Flink for real-time aggregation\n- Storage: TimescaleDB for time-series, Redis for hot data\n- Serving: gRPC + WebSocket gateway (Go)\n\nKey design principles:\n1. Separate hot path (real-time) from warm path (analytics)\n2. Use event sourcing — never update, only append\n3. Maintain exactly-once semantics via Kafka transactions\n4. Partition by symbol for parallelism (AAPL trades go to same partition)\n\nLatency targets:\n- Market data ingestion to WebSocket delivery: <5ms (p99)\n- REST API for historical data: <50ms (p99)\n- Aggregate candle computation: <100ms after period close\n\nCost optimization: using spot instances for non-critical processing reduces infrastructure costs by 65%.`,
    content_metadata: { author: 'Polygon.io Engineering', date: '2026-03-14', type: 'technical', category: 'data-architecture' },
    price: 0.0005
  },
  {
    url: 'https://www.federalreserve.gov/digital-dollar-progress-2026',
    content_text: `Federal Reserve Digital Dollar (CBDC) Progress Report — Q1 2026\n\nThe Federal Reserve's digital dollar pilot program has completed Phase 2, testing with 12 participating banks and 50,000 consumers across three metropolitan areas.\n\nKey findings:\n- Transaction speed: 7,500 TPS sustained (target: 10,000+)\n- Settlement finality: 2 seconds (vs. 2-3 days for traditional ACH)\n- Privacy: tiered system — transactions <$500 are anonymous, larger amounts require identity verification\n- Offline capability: NFC-based transfers work without internet for up to 7 days\n\nArchitecture: Two-tier model where the Fed issues digital dollars to commercial banks, which then distribute to consumers through existing banking apps. The system uses a permissioned blockchain (Hyperledger Besu fork) for interbank settlement.\n\nTimeline:\n- Phase 3 (2026 H2): Expand to 50 banks, 500,000 consumers\n- Phase 4 (2027): Cross-border pilot with ECB and Bank of England\n- Potential launch: 2028-2029 (pending Congressional authorization)\n\nConcerns raised: surveillance risks, impact on bank deposits, and potential for negative interest rates on digital dollars.`,
    content_metadata: { author: 'Federal Reserve', date: '2026-03-16', type: 'report', category: 'central-banking' },
    price: 0.0008
  },
  {
    url: 'https://databricks.com/blog/lakehouse-ai-2026',
    content_text: `Databricks Lakehouse AI — Unified Analytics and AI Platform\n\nDatabricks has unified its data lakehouse and AI platform, enabling organizations to build end-to-end AI applications on a single platform.\n\nKey capabilities:\n- Unity Catalog: Governed access to data, models, and AI assets\n- Model Serving: Deploy any model (open source or custom) as an API endpoint\n- Feature Store: Real-time and batch feature serving\n- MLflow 3.0: Experiment tracking, model registry, and deployment\n\n\`\`\`python\nimport mlflow\nfrom databricks import feature_engineering as fe\n\n# Train model with automatic tracking\nwith mlflow.start_run():\n    model = train_churn_model(training_data)\n    mlflow.sklearn.log_model(model, "churn_model")\n    mlflow.log_metrics({"auc": 0.94, "precision": 0.87})\n\n# Register and deploy\nmodel_uri = "models:/churn_model/production"\nendpoint = fe.create_serving_endpoint(\n    name="churn-prediction",\n    model_uri=model_uri,\n    scale_to_zero=True\n)\n\`\`\`\n\nPerformance: Databricks Photon engine processes 3x more data per dollar than Spark on Databricks, and 10x more than Spark on commodity hardware. Serverless SQL queries start in <2 seconds.`,
    content_metadata: { author: 'Databricks Engineering', date: '2026-03-11', type: 'blog', category: 'data-platform' },
    price: 0.0005
  },
  {
    url: 'https://www.sec.gov/ai-trading-guidance-2026',
    content_text: `SEC Guidance on AI-Powered Trading Systems — March 2026\n\nThe Securities and Exchange Commission has issued comprehensive guidance on the use of AI and machine learning in securities trading, addressing concerns about market stability and fairness.\n\nKey requirements:\n1. **Model Documentation**: All AI trading systems must maintain detailed documentation of model architecture, training data, and decision logic. "Black box" models are not acceptable for high-frequency trading.\n\n2. **Kill Switches**: Automated trading systems must include circuit breakers that halt trading when losses exceed 5% in any 15-minute window or when model confidence drops below a defined threshold.\n\n3. **Bias Testing**: Models must be tested quarterly for unintended biases that could systematically disadvantage certain market participants or securities.\n\n4. **Audit Trail**: Every AI-generated trade decision must be logged with: timestamp, model version, input features, confidence score, and execution details.\n\n5. **Human Oversight**: At least one licensed trader must monitor AI trading systems in real-time during market hours.\n\nCompliance deadline: September 1, 2026. Firms found in violation face penalties up to $10M per incident.`,
    content_metadata: { author: 'SEC Office of Trading', date: '2026-03-22', type: 'regulation', category: 'compliance' },
    price: 0.0008
  },
  {
    url: 'https://www.coingecko.com/research/alt-season-analysis-2026',
    content_text: `CoinGecko Alt Season Analysis — March 2026\n\nThe crypto market is experiencing a moderate alt season, with the Alt Season Index at 68/100. While Bitcoin has gained 18% this month, the average altcoin has gained 32%.\n\nTop performing sectors:\n1. AI Tokens: +85% (FET, RENDER, TAO leading)\n2. DePIN: +62% (HNT, DIMO, RNDR)\n3. Layer 2: +45% (ARB, OP, STRK)\n4. Gaming: +38% (IMX, GALA, BEAM)\n5. RWA Tokenization: +55% (ONDO, MAPLE, CENTRIFUGE)\n\nNotable performers:\n- SOL: $285 (+40%), driven by Firedancer validator and mobile adoption\n- AVAX: $95 (+55%), institutional subnet deployments\n- SUI: $12.50 (+120%), gaming ecosystem growth\n\nOn-chain metrics indicate retail participation is returning:\n- New wallet addresses: 2.1M/week (up from 800K in Q4 2025)\n- DEX volume: $45B/week\n- NFT volume: recovering to $2B/month after 2024-2025 slump\n\nWarning: leverage ratios on derivatives exchanges are elevated at 35x average, historically preceding correction events.`,
    content_metadata: { author: 'CoinGecko Research', date: '2026-03-21', type: 'report', category: 'crypto' },
    price: 0.0008
  },
  {
    url: 'https://pandas.pydata.org/docs/whatsnew/v3.0.html',
    content_text: `pandas 3.0 — What's New\n\npandas 3.0 is a major release featuring PyArrow as the default backend, delivering 5-10x performance improvements for common operations.\n\nKey changes:\n\n1. **PyArrow backend by default:**\n\`\`\`python\nimport pandas as pd\n\n# String columns now use Arrow strings (zero-copy, 80% less memory)\ndf = pd.read_csv('large_file.csv')  # Automatically uses Arrow types\nprint(df.dtypes)  # string[pyarrow], int64[pyarrow], etc.\n\`\`\`\n\n2. **Copy-on-write (CoW) is now default:**\n\`\`\`python\ndf2 = df[['col1', 'col2']]  # No copy until modification\ndf2['col1'] = 0  # Only now does it copy\n\`\`\`\n\n3. **New nullable types replace NaN-based missing data:**\n\`\`\`python\n# No more NaN converting int to float\ndf = pd.DataFrame({'a': pd.array([1, 2, None], dtype='Int64')})\nprint(df['a'].dtype)  # Int64 (nullable integer)\n\`\`\`\n\nMigration: Run pandas with warnings enabled to catch deprecation notices. The pandas-compat package helps with backward compatibility during migration.\n\nBenchmarks: read_csv is 3x faster, groupby is 5x faster, merge/join is 8x faster with the PyArrow backend.`,
    content_metadata: { author: 'pandas Development Team', date: '2026-02-15', type: 'documentation', category: 'data-science', language: 'python' },
    price: 0.0005
  },
  {
    url: 'https://www.blackrock.com/digital-assets-institutional-guide-2026',
    content_text: `BlackRock Institutional Digital Assets Guide 2026\n\nBlackRock's iShares Bitcoin Trust (IBIT) has accumulated $65 billion in AUM, making it the largest Bitcoin investment vehicle globally. This guide covers institutional considerations for digital asset allocation.\n\nRecommended allocation:\n- Conservative portfolios: 1-3% in BTC/ETH (via ETFs)\n- Balanced portfolios: 3-5% in diversified crypto basket\n- Aggressive portfolios: 5-10% including DeFi yield strategies\n\nCustody solutions:\n- Coinbase Institutional: $180B in custody, SOC 2 Type II\n- Fidelity Digital Assets: $95B in custody, integrated with TradFi\n- BitGo: $65B in custody, multi-sig cold storage\n- Fireblocks: $50B transacted, MPC technology\n\nRegulatory framework:\n- Bitcoin and Ethereum classified as commodities (CFTC jurisdiction)\n- Other tokens: case-by-case SEC review under Howey test\n- Tax reporting: Form 8949 for realized gains, new Form 1099-DA from exchanges\n- AML/KYC: required for all on-ramps and off-ramps above $1,000\n\nInsurance: Lloyd's of London now offers crypto custody insurance at 0.5-1.5% of AUM annually, compared to 0.1% for traditional asset custody.`,
    content_metadata: { author: 'BlackRock Research', date: '2026-03-17', type: 'guide', category: 'institutional-crypto' },
    price: 0.001
  },
  {
    url: 'https://www.mckinsey.com/analytics-maturity-model-2026',
    content_text: `McKinsey Analytics Maturity Model 2026 — Where Organizations Stand\n\nMcKinsey's annual survey of 3,000 organizations reveals the current state of data and analytics maturity.\n\nMaturity levels distribution:\n- Level 1 (Descriptive): 15% — Basic reporting, spreadsheets\n- Level 2 (Diagnostic): 25% — BI dashboards, root cause analysis\n- Level 3 (Predictive): 30% — ML models, forecasting\n- Level 4 (Prescriptive): 20% — Optimization, automated decisions\n- Level 5 (Autonomous): 10% — AI-driven operations, self-optimizing systems\n\nKey findings:\n1. Organizations at Level 4-5 generate 3.5x more revenue per employee\n2. Data quality remains the #1 barrier (cited by 72% of respondents)\n3. The median company spends 23% of IT budget on data/analytics (up from 15% in 2023)\n4. Companies with a Chief Data Officer outperform peers by 20% on analytics ROI\n\nAcceleration factors:\n- LLM-powered analytics tools reduce time-to-insight by 60%\n- Synthetic data addresses 40% of data privacy barriers\n- AutoML adoption has increased model deployment velocity 5x\n\nRecommendation: Focus on data quality and governance before investing in advanced AI capabilities. The ROI of clean data exceeds the ROI of sophisticated models.`,
    content_metadata: { author: 'McKinsey & Company', date: '2026-03-03', type: 'report', category: 'analytics' },
    price: 0.001
  }
];

// ─── Artifacts (spread across nodes) ────────────────────────────

const codeVaultArtifacts = [
  {
    slug: 'express-auth-middleware',
    name: 'Express Authentication Middleware',
    category: 'middleware',
    description: 'Production-ready JWT + OAuth2 authentication middleware for Express.js with role-based access control, token refresh, and session management.',
    tags: ['javascript', 'express', 'auth', 'jwt', 'oauth2'],
    files: ['auth.js', 'middleware.js', 'roles.js', 'session.js', 'README.md'],
    dependencies: ['jsonwebtoken', 'passport', 'bcrypt'],
    price: 0.005,
    license: 'MIT'
  },
  {
    slug: 'fastapi-rate-limiter',
    name: 'FastAPI Rate Limiter',
    category: 'middleware',
    description: 'Configurable rate limiting for FastAPI with Redis backend, sliding window algorithm, per-route limits, and API key-based quotas.',
    tags: ['python', 'fastapi', 'rate-limiting', 'redis'],
    files: ['rate_limiter.py', 'backends.py', 'decorators.py', 'tests/'],
    dependencies: ['redis', 'fastapi'],
    price: 0.003,
    license: 'MIT'
  },
  {
    slug: 'react-data-table',
    name: 'React Data Table Component',
    category: 'component',
    description: 'Virtualized data table with sorting, filtering, pagination, column resizing, row selection, and CSV export. Handles 100K+ rows smoothly.',
    tags: ['react', 'typescript', 'table', 'virtualization'],
    files: ['DataTable.tsx', 'useVirtualScroll.ts', 'ColumnFilter.tsx', 'export.ts'],
    dependencies: ['react', 'react-window'],
    price: 0.008,
    license: 'MIT'
  }
];

const webCleanArtifacts = [
  {
    slug: 'ai-prompt-template-library',
    name: 'AI Prompt Template Library',
    category: 'prompt-template',
    description: 'Collection of 50+ tested prompt templates for common AI tasks: summarization, extraction, classification, code generation, and analysis.',
    tags: ['ai', 'prompts', 'templates', 'llm'],
    files: ['templates/', 'loader.js', 'validator.js', 'examples/'],
    dependencies: [],
    price: 0.01,
    license: 'MIT'
  },
  {
    slug: 'web-scraping-toolkit',
    name: 'Web Scraping Toolkit',
    category: 'tool',
    description: 'Respectful web scraping toolkit with rate limiting, robots.txt compliance, content extraction using Readability, and structured output.',
    tags: ['scraping', 'crawling', 'content-extraction', 'javascript'],
    files: ['scraper.js', 'parser.js', 'robots.js', 'queue.js', 'README.md'],
    dependencies: ['cheerio', 'node-fetch', '@mozilla/readability', 'jsdom'],
    price: 0.005,
    license: 'Apache-2.0'
  }
];

const dataStreamArtifacts = [
  {
    slug: 'data-pipeline-config',
    name: 'Financial Data Pipeline Config',
    category: 'config',
    description: 'Pre-configured data pipeline for ingesting market data from multiple sources (Binance, Polygon, Yahoo Finance) into a unified schema.',
    tags: ['data-pipeline', 'finance', 'etl', 'python'],
    files: ['pipeline.yaml', 'sources/', 'transforms/', 'schema.json'],
    dependencies: ['apache-airflow', 'pandas', 'sqlalchemy'],
    price: 0.012,
    license: 'MIT'
  },
  {
    slug: 'crypto-portfolio-tracker',
    name: 'Crypto Portfolio Tracker',
    category: 'tool',
    description: 'Real-time cryptocurrency portfolio tracker with PnL calculation, tax-lot accounting, and multi-exchange aggregation via APIs.',
    tags: ['crypto', 'portfolio', 'finance', 'python'],
    files: ['tracker.py', 'exchanges/', 'reports.py', 'tax_lots.py'],
    dependencies: ['ccxt', 'pandas', 'plotly'],
    price: 0.008,
    license: 'MIT'
  },
  {
    slug: 'ml-model-evaluator',
    name: 'ML Model Evaluation Framework',
    category: 'tool',
    description: 'Standardized evaluation framework for ML models with automated benchmarking, statistical significance testing, and report generation.',
    tags: ['ml', 'evaluation', 'benchmarking', 'python'],
    files: ['evaluator.py', 'metrics.py', 'report_generator.py', 'visualizations.py'],
    dependencies: ['scikit-learn', 'scipy', 'matplotlib'],
    price: 0.006,
    license: 'MIT'
  }
];

// ─── Search log entries (for gaps/trending) ─────────────────────

const searchQueries = [
  // Queries with results (will be populated after content is seeded)
  { query: 'python authentication', results_count: 5 },
  { query: 'react tutorial', results_count: 3 },
  { query: 'bitcoin price', results_count: 4 },
  { query: 'fastapi rate limiting', results_count: 2 },
  { query: 'docker compose', results_count: 2 },
  { query: 'typescript generics', results_count: 1 },
  // Queries with no results (gaps)
  { query: 'rust async patterns', results_count: 0 },
  { query: 'rust async patterns', results_count: 0 },
  { query: 'rust async patterns', results_count: 0 },
  { query: 'rust async patterns', results_count: 0 },
  { query: 'rust async patterns', results_count: 0 },
  { query: 'rust async patterns', results_count: 0 },
  { query: 'rust async patterns', results_count: 0 },
  { query: 'rust async patterns', results_count: 0 },
  { query: 'rust async patterns', results_count: 0 },
  { query: 'rust async patterns', results_count: 0 },
  { query: 'rust async patterns', results_count: 0 },
  { query: 'rust async patterns', results_count: 0 },
  { query: 'kubernetes helm charts', results_count: 0 },
  { query: 'kubernetes helm charts', results_count: 0 },
  { query: 'kubernetes helm charts', results_count: 0 },
  { query: 'kubernetes helm charts', results_count: 0 },
  { query: 'kubernetes helm charts', results_count: 0 },
  { query: 'kubernetes helm charts', results_count: 0 },
  { query: 'kubernetes helm charts', results_count: 0 },
  { query: 'kubernetes helm charts', results_count: 0 },
  { query: 'vue 4 migration guide', results_count: 0 },
  { query: 'vue 4 migration guide', results_count: 0 },
  { query: 'vue 4 migration guide', results_count: 0 },
  { query: 'vue 4 migration guide', results_count: 0 },
  { query: 'vue 4 migration guide', results_count: 0 },
  { query: 'graphql subscriptions tutorial', results_count: 0 },
  { query: 'graphql subscriptions tutorial', results_count: 0 },
  { query: 'graphql subscriptions tutorial', results_count: 0 },
  { query: 'graphql subscriptions tutorial', results_count: 0 },
];

// Shared content (same URL on multiple nodes for consensus demo)
const sharedContent = {
  url: 'https://example.com/api/docs',
  content_text: `Example API Documentation — Quick Start Guide\n\nThis API provides RESTful endpoints for managing resources. All requests must include an Authorization header with a valid Bearer token.\n\nBase URL: https://api.example.com/v2\n\nEndpoints:\n- GET /resources — List all resources (paginated)\n- POST /resources — Create a new resource\n- GET /resources/:id — Get resource details\n- PATCH /resources/:id — Update a resource\n- DELETE /resources/:id — Delete a resource\n\nAll responses follow the envelope format: { "data": ..., "meta": { "page": 1, "total": 100 } }\n\nRate limits: 1000 requests per hour per API key. Contact support for higher limits.`,
  content_metadata: { author: 'Example Inc', date: '2026-03-01', type: 'documentation', category: 'api' },
  price: 0.0003
};

module.exports = {
  webCleanContent,
  codeVaultContent,
  dataStreamContent,
  webCleanArtifacts,
  codeVaultArtifacts,
  dataStreamArtifacts,
  searchQueries,
  sharedContent,
  hash
};
