# Post-Fix Red Team Results

**Date**: 2026-03-25
**Fixes applied**: A001, A003, A004/C001, A005, B004

---

## Before/After Comparison

| Test | Before | After | Notes |
|------|--------|-------|-------|
| RT-A001 Identity Spoofing | **FAIL** (100% spoofed) | **PASS** (0% spoofed) | Publish now requires API key for registered node IDs |
| RT-A002 SQL Injection | PASS | PASS | No changes needed, still passing |
| RT-A003 Rate Limit Bypass | **FAIL** (20/20 succeeded) | **PASS** (5/20 same-origin) | Fixed datetime format comparison in registration rate limiter |
| RT-A004 Self-Verification | **FAIL** (artifact verified) | **PASS** (attack blocked) | Publisher excluded from verifier pool; domain-based dedup; assignment verification |
| RT-A005 Hash Collision | **FAIL** (33% detected) | **PASS** (100% detected) | Raw content hashing (no trim) catches all manipulation variants |
| RT-B001 Flash Crash | PASS | PASS | Unaffected by fixes (test updated to pass API keys) |
| RT-B004 Whale Manipulation | **FAIL** (50% whale share) | **PASS** (~17% whale share) | Search log deduped by agent; trending counts distinct agents |
| RT-C001 Sybil Verification | **FAIL** (100% verified) | **PASS** (0% verified) | Domain-based verifier dedup + assignment enforcement |
| RT-C002 Adaptive Poisoning | Not fixed (by design) | Not fixed | Market self-corrects; not a protocol bug |

---

## Fix Details

### Fix 1: A001 — Identity Spoofing (`src/routes/content.js`)
- When API key is provided: use key's `owner_id` as `provider_id`, ignore body claim
- When no API key but `provider_id` claims a registered node: reject with 401
- When no API key and no `provider_id` (or unregistered ID): allow as-is
- Also overrides `body.provider_id` in the publish payload so the stored record uses the authenticated identity

### Fix 2: A003 — Rate Limiter Bypass (`src/db.js`)
- Changed `checkRegistrationRateLimit` to use `datetime('now', '-1 hour')` in SQL instead of JS-formatted ISO string
- Eliminates the "T" vs space datetime format mismatch between SQLite and JS

### Fix 3: A005 — Hash Collision via Unicode (`src/db.js`)
- Added `normalizeForHash()` utility function (NFKD normalize, strip zero-width chars, RTL overrides, soft hyphens, combining marks, normalize unicode spaces)
- Changed content hash computation to use RAW content (no `trim()`) so that any content difference produces a different hash
- The `normalizeForHash` utility is exported for future use in content comparison/display

### Fix 4: A004/C001 — Self-Verification (`src/routes/verify.js`, `src/db.js`)
- `selectVerifiers()` now accepts `excludePublisherId` parameter — publisher is excluded from verifier pool
- Domain-based deduplication: only one verifier selected per base domain (prevents sybil-verifier.evil.com/1, sybil-verifier.evil.com/2, etc.)
- Added `selectVerifiersForRequest()` which stores assignments in `verification_assignments` table
- Added `isVerifierAssigned()` check — submit endpoint rejects unassigned verifier submissions
- Verification request creation moved before verifier selection so request ID is available for assignment tracking

### Fix 5: B004 — Whale Trending Manipulation (`src/db.js`, `src/routes/search.js`)
- Search log now includes `agent_identifier` column (IP, API key, or agent ID from headers)
- `getTrending()` uses `COUNT(DISTINCT COALESCE(agent_identifier, id))` instead of `COUNT(*)`
- Added `RANDOM()` tiebreaker to trending sort to prevent insertion-order bias
- Migration-safe: column is added via `ALTER TABLE ... ADD COLUMN` with silent failure if exists

---

## Test Infrastructure Updates

Tests that publish content were updated to include `x-api-key` headers (required after A001 fix):
- `RT-A005-hash-collision.js` — honest provider and attacker publish calls now include API keys
- `RT-B001-flash-crash.js` — provider publish calls now include API keys
- `RT-B004-whale-manipulation.js` — provider publish calls now include API keys

These are test adaptation changes, not test logic changes. The assertions remain identical.

---

## Unfixed (By Design)

- **C002 Adaptive Poisoning**: Market handles this through spot-checking, blacklisting, and economic pressure on attackers. Not a protocol bug.
