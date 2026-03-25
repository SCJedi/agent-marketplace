# Suite B: Economic Resilience — Red Team Results

**Run date**: 2026-03-25
**Trials per test**: 3
**Framework**: Custom harness with per-trial isolated servers

---

## RT-B001: Flash Crash Recovery
- **Hypothesis**: Market recovers within 100 rounds after 80% demand collapse
- **Result**: PASS
- **Evidence**: Provider survival 100% (threshold >=40%). Cache hit recovery 104.6% of pre-crash (threshold >=80%).
- **Notes**: The marketplace server architecture is inherently resilient to demand-side shocks because providers are stateless publishers — they don't "exit" due to low demand in the current model. The content remains available regardless of buyer activity. In a real system with ongoing server costs, survival would depend on provider financial reserves.

## RT-B002: Cartel Formation & Breakdown
- **Hypothesis**: Competitive entry destroys price-fixing cartel
- **Result**: PASS
- **Evidence**: Cartel share at round 300: 17.1% (threshold <30%). Price as fraction of cartel price: 55.5% (threshold <80%).
- **Notes**: With 7 honest providers pricing at 30-60% of ceiling vs 3 cartel members at 90% of ceiling, rational agents always buy the cheapest option. The cartel cannot maintain market share because the marketplace surfaces all providers for a URL and agents pick the lowest price.

## RT-B003: Predatory Pricing Monopoly Attempt
- **Hypothesis**: Predatory pricing fails to maintain monopoly — new entrants appear after price increase
- **Result**: PASS
- **Evidence**: Predator post-increase market share: 19.7% (threshold <80%). New entrants: 9.0 per trial (threshold >0). Monopoly held in 0/3 trials.
- **Notes**: The open registration system allows new entrants to appear whenever the predator raises prices. The marketplace's multi-provider URL system means even a single competitor undercuts a monopolist immediately. The system is naturally resistant to predatory pricing.

## RT-B004: Whale Buyer Demand Distortion
- **Hypothesis**: Whale buyer cannot distort demand signals (trending)
- **Result**: FAIL
- **Evidence**: Whale URLs in trending: 50.0% (threshold <50%). Whale genuine demand share: ~14%. Distortion factor: 3.6x.
- **Severity**: Medium

### Vulnerability Found
The trending endpoint (`/trending`) aggregates raw search counts without normalization for unique users/agents. A single whale searching 100x per round can dominate the search_log table, pushing whale-preferred URLs into the trending results. The search_log has no deduplication or rate-weighting.

### Recommended Mitigations
1. **Deduplicate search logs** by IP/agent per time window before computing trending
2. **Weight searches** inversely by agent search volume (frequent searchers have diminished influence)
3. **Require unique agent identifiers** in search queries for trending computation
4. **Cap per-agent contribution** to trending scores (e.g., max 5 searches per query per hour)

## RT-B005: Price War Supply Collapse & Recovery
- **Hypothesis**: Price war causes supply collapse, but market self-heals
- **Result**: PASS
- **Evidence**: Final providers: 4.0 (threshold >=3). Cache hit rate: 98.4% (threshold >=30%). Recovered in 3/3 trials.
- **Notes**: Even when providers exit due to unsustainable pricing, the content they previously published remains in the database. New entrants appear when provider count drops below 5, attracted by reduced competition. The system's content persistence provides natural resilience.

---

## Summary of Market Weaknesses Found

| Weakness | Severity | Test | Status |
|----------|----------|------|--------|
| Trending/demand signal manipulation by whales | Medium | RT-B004 | VULNERABLE |
| No unique-agent deduplication in search_log | Medium | RT-B004 | UNMITIGATED |

### Market Strengths Confirmed
1. **Demand shock resilience**: Content persists through demand collapse (B001)
2. **Anti-cartel**: Multi-provider comparison naturally breaks price-fixing (B002)
3. **Anti-monopoly**: Open registration enables competitive entry (B003)
4. **Supply shock recovery**: New entrants fill gaps after provider exits (B005)
