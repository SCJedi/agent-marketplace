# Suite C: Adversarial Robustness — Red Team Results

**Run date**: 2026-03-25
**Trials per test**: 3
**Framework**: Custom harness with per-trial isolated servers

---

## RT-C001: Sybil Verifier Attack
- **Hypothesis**: Sybil verifiers controlling 6/9 of pool should NOT approve >20% of malicious artifacts
- **Result**: FAIL (CRITICAL)
- **Evidence**: Malicious artifacts verified: 100% (threshold <=20%). All 10 malicious artifacts verified in every trial (10/10, 10/10, 10/10).
- **Severity**: Critical

### Vulnerability Found
The verification system (`selectVerifiers()` in db.js) selects 3 random active verifiers from the pool with `agreement_rate >= 0.5`. It has NO defense against Sybil verifiers:

1. **No identity verification**: Anyone can join the verifier pool by calling `/verify/pool/join` with an endpoint and optional stake
2. **No stake minimum enforcement**: The `stake_amount` field accepts 0
3. **Random selection without diversity**: `ORDER BY RANDOM() LIMIT 3` may select all 3 verifiers from the same Sybil operator
4. **Majority rules with 3 verifiers**: 2/3 pass = verified. With 6/9 Sybil nodes, probability of getting >=2 Sybil is very high
5. **No cooldown or assignment deduplication**: Same verifier can be selected repeatedly

### Recommended Mitigations
1. **Require minimum stake** that makes Sybil economically costly (e.g., 0.1 per verifier)
2. **Diversity sampling**: Ensure selected verifiers come from different endpoint domains/IP ranges
3. **Increase quorum**: Require 5 verifiers with 4/5 consensus instead of 3 with 2/3
4. **Verifier identity proofs**: Require deposit lock period or proof-of-work for verifier registration
5. **Slash Sybil stakes**: If verifiers always agree with each other, flag as potential Sybil cluster

## RT-C002: Adaptive Cache Poisoning
- **Hypothesis**: Adaptive attacker success rate drops below 30% after round 200
- **Result**: FAIL (HIGH)
- **Evidence**: Attacker success rate after R200: 92.9% (threshold <30%). Consistent across trials: 92.9%, 92.7%, 93.0%.
- **Severity**: High

### Vulnerability Found
The publish endpoint (`/publish/content`) has rate limiting and hash divergence checks, but:

1. **Rate limits are per-minute, not per-identity lifetime**: An attacker within limits publishes freely
2. **Hash divergence requires existing consensus**: For new URLs, first publisher sets the hash — no divergence detected
3. **Probation is limited to 10 publications**: After 10 publishes, probation ends
4. **No content quality verification**: Published content text is never validated
5. **Adaptive attackers rotate identities**: When one identity hits limits, they create a new one

The fundamental issue: the system has no mechanism to verify content quality at publish time. The "POISONED" marker in content text is only caught by agent spot-checking, not by the server.

### Recommended Mitigations
1. **Content hash verification**: Cross-reference published content against known-good hashes
2. **Publisher reputation scoring**: Track flag rate per publisher, demote content from high-flag publishers
3. **Mandatory spot-check on new content**: Random sample of new content verified before serving
4. **Identity linking**: Detect Sybil patterns (same endpoint prefix, rapid registration)
5. **Economic deterrent**: Higher deposits with slashing for flagged content

## RT-C003: Eclipse Attack via Sybil Consensus
- **Hypothesis**: 5 Sybil nodes publishing poisoned content should NOT eclipse 1 honest node
- **Result**: PASS (with caveats)
- **Evidence**: Honest provider as outlier: 0.0% of URLs (threshold <50%).
- **Caveat**: Poisoned content was served 80% of the time because `/fetch` returns the most recently published content, and Sybil nodes published after the honest node. The honest provider is not flagged as an outlier because it published first and established the content hash consensus.
- **Notes**: The hash divergence defense (`checkContentHashDivergence`) works correctly: the Sybil-published content with different hashes gets flagged as divergent. However, the `/fetch` endpoint returns the latest content (which is poisoned). The pass/fail criteria test whether the honest provider is flagged as an outlier, which it is not — the system correctly identifies the Sybil content as divergent from the established consensus.

### Partial Vulnerability
While the honest provider isn't flagged, the default fetch still returns Sybil content. A consuming agent would receive poisoned data unless it specifically checks the content_hash or uses `/fetch/providers` to compare.

### Recommended Mitigations
1. **Serve consensus content by default**: `/fetch` should return content matching the majority hash, not the most recent
2. **Warn agents**: Include a `divergence_warning` flag in fetch responses when hash divergence exists
3. **Provider reputation in fetch ordering**: Established providers with more publish history should be preferred

## RT-C004: Search Result Manipulation via Keyword Stuffing
- **Hypothesis**: Keyword-stuffed content should appear in top-3 for <30% of queries
- **Result**: PASS
- **Evidence**: Attacker in top-3 results: 0.0% of queries (threshold <30%).
- **Notes**: The search ranking system effectively demotes content from flagged/new providers. The attacker's node, registered without deposit, gets flagged as `no_deposit`, receiving a 0.3x rank score multiplier. Combined with probation demotion (0.5x), the attacker's content is ranked at ~0.15x of honest provider content. The `_rankScore` system works as designed.

---

## Summary of Adversarial Vulnerabilities Found

| Vulnerability | Severity | Test | Status |
|---------------|----------|------|--------|
| Sybil verifiers can approve all malicious artifacts | Critical | RT-C001 | VULNERABLE |
| Adaptive attackers achieve 93% publish success rate | High | RT-C002 | VULNERABLE |
| Poisoned content served by default `/fetch` | Medium | RT-C003 | PARTIALLY MITIGATED |
| Search keyword stuffing | Low | RT-C004 | DEFENDED |

### System Defenses That Work
1. **Search ranking demotion**: Flagged/new providers effectively demoted (C004 PASS)
2. **Content hash divergence detection**: Correctly flags Sybil-divergent content (C003 PASS)
3. **Registration flagging**: No-deposit registrations flagged (C004 defense)

### System Defenses That Fail
1. **Verification pool**: No Sybil resistance — majority of pool can be controlled (C001 FAIL)
2. **Content quality at publish time**: No validation, only post-hoc detection (C002 FAIL)
3. **Identity lifecycle**: Trivial to create new identities after burning old ones (C002 contributor)
