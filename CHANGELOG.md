# Changelog

## 1.0.0 (2026-03-26)

### Protocol
- Three-layer architecture: Content Cache, Build Artifacts, Market Intelligence
- Self-enforcing price ceiling (token cost) and price floor (amortized provider cost)
- Transaction ledger with pseudonymous reputation (0-100 score)
- P2P peer discovery (Bitcoin-style, no central authority)
- Access control: public, private, whitelist visibility levels

### Features
- Reference node implementation (Node.js + Fastify + SQLite)
- JavaScript SDK (zero external dependencies)
- Python SDK (requests-based)
- CLI tool (10 commands: search, publish, publish-file, publish-folder, status, etc.)
- Web dashboard with setup wizard and 7 tabs (Content, Artifacts, Analytics, Ledger, Verify, Share, Nodes)
- P2P peer discovery and mesh networking
- Access control (private/whitelist/public) for both content and artifacts
- Content verification system (multi-provider consensus + staked verifier pool)
- Layer 3 analytics with trending, gaps, and demand signals
- Transaction ledger and reputation API
- Claude Code auto-cache integration (PostToolUse + PreToolUse hooks)
- Local file/folder publishing with watch mode
- Network sharing (port forwarding detection, DuckDNS integration)
- Content crawler with Readability-based extraction

### Security
- Provider identity verification via API keys
- Unicode normalization on content hashing (NFKD + zero-width/RTL stripping)
- Publisher excluded from own verification
- Sybil resistance: domain deduplication in verifier selection, registration deposits
- Rate limiting on publishing (per-provider) and registration (per-endpoint)
- Parameterized SQL queries throughout (no SQL injection vectors)
- Content hash divergence detection and flagging
- Provider probation system for new publishers
- Secret detection in published content

### Red Team Validated
- RT-A001: Identity spoofing prevention
- RT-A002: SQL injection resistance
- RT-A003: Rate limit bypass via Sybil registration
- RT-A004: Self-verification attack prevention
- RT-A005: Hash collision / content integrity bypass (unicode normalization)
- 9 additional economic and adversarial scenarios (flash crash, cartel formation, predatory pricing, whale manipulation, race to bottom, Sybil verification, adaptive poisoning, eclipse consensus, search manipulation)

### Test Coverage
- 47 integration tests (core API)
- 30 access control tests
- 18 peer discovery tests
- 22 integration hooks tests
- 35 JS SDK unit tests
- 41 Python SDK unit tests
- 5 red team CI scenarios (automated)
