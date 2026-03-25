# Agent Marketplace Layer 1: Content Caching Cost-Savings Model

**Date**: 2026-03-25
**Version**: 1.0
**Scope**: Economic model for AI web-crawling deduplication savings, from current levels to 10% AI adoption

---

## 1. Assumptions Table

All inputs are labeled **MEASURED** (from published data with citation), **DERIVED** (calculated from measured inputs), or **ESTIMATED** (reasonable estimate, labeled with rationale).

| Parameter | Symbol | Value | Label | Source / Rationale | Sensitivity |
|-----------|--------|-------|-------|--------------------|-------------|
| Cloudflare avg HTTP req/sec | — | 81M req/s | MEASURED | Cloudflare 2025 Year in Review | Low (well-documented) |
| Total global HTTP requests/day | R_total | ~7.0T req/day | DERIVED | 81M req/s x 86,400s = 7.0T | Low |
| AI bot share of HTML requests | — | 4.2% (excl. Googlebot) | MEASURED | Cloudflare 2025 Year in Review | Medium |
| Googlebot share of HTML requests | — | 4.5% | MEASURED | Cloudflare 2025 Year in Review | Low |
| Combined AI+Googlebot HTML share | — | 8.7% | DERIVED | 4.2% + 4.5% | Low |
| AI crawler requests/day (Cloudflare) | — | 50B req/day | MEASURED | Cloudflare / Thunderbit 2026 report | Medium |
| AI crawler share of all requests | — | ~1% of total | DERIVED | 50B / 7.0T ≈ 0.7% | Medium |
| Cloudflare market share of web traffic | — | ~20% | ESTIMATED | Cloudflare proxies ~20% of websites; conservative | High |
| Estimated global AI crawl req/day | C_ai | 250B req/day | DERIVED | 50B / 0.20 = 250B | High (depends on CF share) |
| HTML page size (raw) | S_html | 22 KB | MEASURED | HTTP Archive 2025 (HTML component only) |  Low |
| Usable content after extraction | S_content | 8 KB (~2,000 tokens) | ESTIMATED | HTML→Markdown typically 28-36% of raw; 22KB × 0.36 ≈ 8KB | Medium |
| Full page download size (HTML+CSS+JS) | S_page | 800 KB | DERIVED | 22 + 82 + 697 KB (HTML+CSS+JS, no images) | Low |
| Tokens per extracted page | T_page | 2,000 tokens | ESTIMATED | 8 KB / 4 bytes per token | Medium |
| LLM input token cost (mid-tier) | C_token | $3.00 / 1M input tokens | MEASURED | Claude Sonnet 4.6 pricing; GPT-4o at $2.50 | Medium (prices falling) |
| LLM output token cost (mid-tier) | — | $10-15 / 1M output tokens | MEASURED | Claude/GPT pricing | Medium |
| Output tokens per extraction | T_out | 500 tokens | ESTIMATED | Typical structured extraction output | Low |
| Bandwidth cost per GB | C_bw | $0.01/GB | ESTIMATED | Blended CDN rate (ranges $0.003-$0.12) | Medium |
| Compute cost per extraction | C_compute | $0.0001 | ESTIMATED | Amortized server cost for parsing/extraction | Low |
| Number of distinct AI crawler systems | N | 30 | MEASURED | Cloudflare tracks ~30 named AI crawlers | Medium |
| Top crawlers (by share) | — | GPTBot 30%, Googlebot 50%, ClaudeBot 5.4%, Bingbot 8.7% | MEASURED | Thunderbit 2026 | Low |
| Indexed web pages | P_total | 50B pages | MEASURED | Google indexes 40-70B pages | Medium |
| Active/fresh pages crawled daily | P_daily | 500M unique pages/day | ESTIMATED | ~1% of index refreshed daily | High |
| Marketplace price ceiling | α | 0.30 (30% of token cost) | DESIGN | Protocol constraint: marketplace price < token cost | Design parameter |

### Notes on Cloudflare Extrapolation

Cloudflare reports 50B AI crawler requests/day on their network. Cloudflare proxies roughly 20% of the web's top sites. However, AI crawlers disproportionately target popular sites (which Cloudflare over-represents), so the multiplier may be lower than 5x. We use 5x as an upper bound and provide sensitivity analysis. A conservative 3x multiplier would give 150B requests/day.

---

## 2. Current State Analysis

### 2.1 The Duplication Problem

**Key insight**: Multiple AI systems crawl the same pages independently. Every time GPTBot, ClaudeBot, PerplexityBot, GoogleBot, and others all fetch the same news article or product page, the content is downloaded, parsed, and tokenized redundantly.

**Observed crawler-to-referral ratios confirm massive waste:**
- OpenAI: 402 crawls per 1 referral (tech sector)
- Some ratios reach 50,000:1 across industries
- This means AI systems crawl vastly more than they use

#### Duplication Factor Estimation

Not all pages have equal duplication. We model with a power-law distribution:

| Page Tier | % of Pages | Pages/Day | Avg Duplication (D) | Total Crawls | Source |
|-----------|-----------|-----------|---------------------|-------------|--------|
| Head (top 1%) | 1% | 5M | 25 | 125M | ESTIMATED: major news, Wikipedia, popular products |
| Torso (top 10%) | 9% | 45M | 8 | 360M | ESTIMATED: mid-popularity content |
| Long tail (90%) | 90% | 450M | 1.5 | 675M | ESTIMATED: niche/low-traffic pages |
| **Weighted total** | 100% | 500M | — | **1.16B** | — |

**Weighted average duplication factor:**

```
D_avg = Total_crawls / Unique_pages = 1.16B / 500M = 2.32
```

**Cross-check against Cloudflare data:**
- 250B global AI requests/day across all content types (not just unique page fetches)
- Many requests are for assets (JS, CSS, images), API calls, robots.txt checks, sitemaps
- Estimate ~20% are actual HTML content fetches: 250B × 0.20 = 50B content fetches/day
- If 500M unique pages: D = 50B / 500M = 100

This suggests our D_avg = 2.32 is **very conservative**. The Cloudflare data implies much higher duplication, likely because:
1. Popular pages are hit far more than 25x
2. Many crawls are recrawls of the same page within the same day
3. User-triggered AI fetches (ChatGPT browsing, Perplexity) add enormous volume

**We use two scenarios:**
- **Conservative**: D_avg = 2.32 (power-law model above)
- **Moderate**: D_avg = 10 (implied by Cloudflare volume data)
- **Aggressive**: D_avg = 50 (consistent with crawler-to-referral ratios)

### 2.2 Cost Per Crawl

For each AI crawl of a web page, the agent pays:

```
Cost_per_crawl = C_bandwidth + C_tokens_in + C_tokens_out + C_compute

Where:
  C_bandwidth  = S_page × C_bw = 800 KB × ($0.01/GB) = $0.000008
  C_tokens_in  = T_page × C_token = 2,000 × ($3.00/1M) = $0.006
  C_tokens_out = T_out × C_token_out = 500 × ($12.50/1M) = $0.00625
  C_compute    = $0.0001

Cost_per_crawl = $0.000008 + $0.006 + $0.00625 + $0.0001
               = $0.01236 per crawl
```

**Token costs dominate** — bandwidth and compute are negligible. This is critical: the marketplace's value proposition is avoiding redundant LLM processing, not bandwidth savings.

Simplified: **Cost per crawl ≈ $0.012**

### 2.3 Current Waste Calculation

Using the moderate scenario (D_avg = 10):

```
Unique pages crawled/day:       P = 500M
Total crawls/day:               P × D = 500M × 10 = 5B
Wasted crawls/day:              P × (D-1) = 500M × 9 = 4.5B
Waste ratio:                    (D-1)/D = 9/10 = 90%

Daily cost without marketplace: 5B × $0.012 = $60M/day
Daily wasted spend:             4.5B × $0.012 = $54M/day

Annual waste:                   $54M × 365 = $19.7B/year
```

| Scenario | D_avg | Waste Ratio | Daily Waste | Annual Waste |
|----------|-------|-------------|-------------|--------------|
| Conservative | 2.32 | 56.9% | $3.4M | $1.25B |
| Moderate | 10 | 90.0% | $54M | $19.7B |
| Aggressive | 50 | 98.0% | $294M | $107B |

**Sanity check**: The AI web scraping market is $886M in 2025 (MEASURED). Our conservative estimate of $1.25B annual waste is in the right order of magnitude — the waste exceeds the market size because waste includes the token processing cost that scraping market revenue doesn't capture. The moderate estimate ($19.7B) reflects the total cost including LLM processing across all AI systems, which is plausible given that the major AI labs collectively spend tens of billions on compute.

---

## 3. Growth Projection: Current → 10% AI Adoption

### 3.1 Defining "AI Adoption"

We define AI adoption rate as the percentage of total web traffic that is AI-agent-originated:
- **Current (2025-2026)**: ~1% of total requests (MEASURED: Cloudflare)
- **10% adoption**: AI agents generate 10% of all web traffic

### 3.2 Scaling Dynamics

As AI adoption grows, three key variables change:

1. **N (number of AI agent systems)** — grows linearly with adoption
2. **D (duplication factor)** — grows superlinearly: more agents = more overlap on popular pages
3. **P (unique pages accessed)** — grows sublinearly: popular pages get saturated first, then long tail

We model these relationships:

```
N(a)  = N_0 × (a / a_0)                           — linear in adoption rate a
P(a)  = P_0 × (a / a_0)^0.4                       — sublinear (diminishing returns)
D(a)  = D_0 × (a / a_0)^0.7                       — superlinear relative to P (more overlap)
```

Where a_0 = 0.01 (current 1%), N_0 = 30, P_0 = 500M, D_0 = 10 (moderate scenario).

### 3.3 Savings Formula

```
Without marketplace:
  Total_cost = P × D × C_crawl

With marketplace (first agent crawls, subsequent agents buy from cache):
  Total_cost = P × C_crawl + P × (D-1) × α × C_crawl
             = P × C_crawl × [1 + (D-1) × α]

Savings    = P × C_crawl × (D-1) × (1 - α)
Savings_rate = (D-1) × (1-α) / D
```

Where α = marketplace price as a fraction of crawl cost (our price ceiling, set at 0.30).

#### Calculation Detail (10% adoption example)

```
a = 0.10, a_0 = 0.01
N = 30 × (10) = 300 agents
P = 500M × (10)^0.4 = 500M × 2.512 = 1.256B unique pages/day
D = 10 × (10)^0.7 = 10 × 5.012 = 50.1 avg duplication

Total crawls = 1.256B × 50.1 = 63.0B/day
Cost_without = 63.0B × $0.012 × 365 = $275.9B/yr
Savings_rate = (50.1 - 1) × (1 - 0.30) / 50.1 = 68.6%
Savings      = $275.9B × 68.6% = $189.3B/yr
```

### 3.4 Milestone Projections (Full Cost, $0.012/crawl)

| Adoption | N | P (pages/day) | D | Total crawls/day | Cost w/o mkt (annual) | Savings rate | Annual Savings |
|----------|---|--------------|---|-----------------|----------------------|--------------|----------------|
| **1% (now)** | 30 | 500M | 10.0 | 5.0B | $21.9B | 63.0% | **$13.8B** |
| **2%** | 60 | 660M | 16.2 | 10.7B | $46.9B | 65.7% | **$30.8B** |
| **5%** | 150 | 951M | 31.5 | 30.0B | $131.4B | 67.8% | **$89.1B** |
| **10%** | 300 | 1.256B | 50.1 | 63.0B | $275.9B | 68.6% | **$189.3B** |

**Sanity check**: At 10% adoption with full LLM cost, total crawl spend is $276B/year. This is comparable to 2025 global cloud infrastructure spend (~$270B). This is the ceiling — it assumes every crawl goes through mid-tier LLM processing at $0.012/crawl.

In practice, these numbers are too high because:
- Many crawls use cheaper models (Haiku at $1/1M tokens, not $3/1M)
- Some crawls don't need LLM extraction (just raw HTML storage)
- Token costs are falling ~50% per year

**Adjusted with blended cost**: Using $0.005/crawl (blended across cheap and expensive models):

| Adoption | Cost without | Savings (α=0.30) | Savings (α=0.10) |
|----------|-------------|-------------------|-------------------|
| **1% (now)** | $9.1B/yr | **$5.7B/yr** | **$7.3B/yr** |
| **2%** | $19.5B/yr | **$12.8B/yr** | **$16.4B/yr** |
| **5%** | $54.8B/yr | **$37.1B/yr** | **$47.5B/yr** |
| **10%** | $115.0B/yr | **$78.9B/yr** | **$101.0B/yr** |

---

## 4. Revenue Model for Node Operators

### 4.1 Marketplace Economics

Each marketplace transaction:
- **Buyer pays**: α × C_crawl = 0.30 × $0.005 = $0.0015 per cached content retrieval
- **Node operator receives**: (1 - platform_fee) × buyer_payment
- **Platform fee**: 10% (DESIGN PARAMETER)
- **Node revenue per transaction**: 0.90 × $0.0015 = $0.00135

### 4.2 Transaction Volume

Total marketplace transactions = P × (D - 1) for all cached hits.

Marketplace adoption rate (what % of AI agents use the marketplace): We assume this ramps from 5% at launch to 30% at maturity.

| AI Adoption | Marketplace Penetration | Transactions/day | Annual Transaction Volume |
|-------------|------------------------|------------------|--------------------------|
| 1% (now) | 5% | 225M | $123M/yr |
| 2% | 10% | 1.07B | $584M/yr |
| 5% | 20% | 5.80B | $3.17B/yr |
| 10% | 30% | 14.7B | $8.04B/yr |

### 4.3 Revenue Per Node

| AI Adoption | Mkt Penetration | Txns/day | Node Count | Revenue/Node/Month | Revenue/Node/Year |
|-------------|----------------|----------|-----------|--------------------|--------------------|
| 1% | 5% | 225M | 1,000 | $25,200 | $302K |
| 2% | 10% | 1.07B | 5,000 | $9,600 | $115K |
| 5% | 20% | 5.80B | 20,000 | $13,000 | $156K |
| 10% | 30% | 14.7B | 50,000 | $13,200 | $158K |

### 4.4 Node Operator Economics

**Cost to operate a node** (ESTIMATED):
- Storage: 10 TB SSD = $100/month (cached content)
- Bandwidth: 50 TB egress = $500/month (serving cached content)
- Compute: 8-core server = $200/month
- **Total node cost**: ~$800/month

**Profit margin by phase:**

| Phase | Revenue/Node/Month | Cost/Month | Profit/Month | Margin |
|-------|-------------------|-----------|-------------|--------|
| Early (1%, 1K nodes) | $25,200 | $800 | $24,400 | 96.8% |
| Growth (2%, 5K nodes) | $9,600 | $800 | $8,800 | 91.7% |
| Scale (5%, 20K nodes) | $13,000 | $800 | $12,200 | 93.8% |
| Mature (10%, 50K nodes) | $13,200 | $800 | $12,400 | 93.9% |

Early nodes are extraordinarily profitable because demand (transactions) is concentrated across few providers.

### 4.5 Total Addressable Market (TAM)

| AI Adoption | Annual Marketplace Volume | Platform Revenue (10%) | Node Operator Revenue (90%) |
|-------------|--------------------------|------------------------|-----------------------------|
| 1% | $123M | $12.3M | $111M |
| 2% | $584M | $58.4M | $526M |
| 5% | $3.17B | $317M | $2.85B |
| 10% | $8.04B | $804M | $7.24B |

---

## 5. The Key Chart: Annual Savings vs. AI Adoption

```
Annual Savings ($B) — Moderate Scenario, α = 0.30, blended $0.005/crawl

$110B |                                                          *
      |                                                       *
$100B |                                                     *
      |                                                   *
 $90B |                                                 *
      |                                              *
 $80B |                                            *
      |                                          *
 $70B |                                       *
      |                                     *
 $60B |                                  *
      |                                *
 $50B |                             *
      |                           *
 $40B |                        *
      |                      *
 $30B |                   *
      |                *
 $20B |            *
      |         *
 $10B |      *
      |   *
  $0B +*----+----+----+----+----+----+----+----+----+----→
      0%   1%   2%   3%   4%   5%   6%   7%   8%   9%  10%
                         AI Adoption Rate

Key inflection: savings curve is superlinear because duplication factor
increases with adoption (more agents = more overlap on popular content).

Growth driver breakdown:
  - 40% of growth from more unique pages being crawled
  - 60% of growth from increasing duplication per page
```

### Marketplace Revenue at Each Point

```
Marketplace TAM ($B) — Platform + Node Revenue

$9B |                                                          *
    |                                                       *
$8B |                                                    *
    |                                                 *
$7B |                                              *
    |                                           *
$6B |                                        *
    |                                     *
$5B |                                  *
    |                               *
$4B |                            *
    |                         *
$3B |                      *
    |                   *
$2B |                *
    |             *
$1B |         *
    |      *
$0B +*--+----+----+----+----+----+----+----+----+----→
    0%  1%   2%   3%   4%   5%   6%   7%   8%   9%  10%
                       AI Adoption Rate
```

---

## 6. Sensitivity Analysis

### 6.1 Token Cost Reduction (50% drop)

Token costs have been falling ~50%/year historically. If costs halve:

| Parameter | Current | After 50% drop |
|-----------|---------|----------------|
| C_crawl (blended) | $0.005 | $0.0025 |
| Annual savings at 10% | $78.9B | $39.5B |
| Marketplace TAM at 10% | $8.04B | $4.02B |

**Impact**: Savings halve proportionally, but the marketplace remains viable because α is defined relative to token cost. As token costs fall, marketplace prices fall too, maintaining the value proposition. The absolute dollar savings decrease, but the **percentage savings remain constant** at 68.6%.

### 6.2 Duplication 2x Higher Than Estimated

If D_0 = 20 instead of 10:

| Adoption | D (2x scenario) | Savings rate | Annual savings |
|----------|-----------------|-------------|----------------|
| 1% | 20.0 | 66.5% | $11.6B |
| 5% | 63.0 | 69.4% | $77.4B |
| 10% | 100.2 | 69.8% | $164.8B |

**Impact**: Higher duplication increases savings superlinearly. The savings rate asymptotically approaches (1-α) = 70% as D → ∞.

### 6.3 Marketplace Take Rate (α) Sensitivity

At 10% AI adoption, moderate scenario:

| α (price/cost ratio) | Savings rate | Annual savings | Marketplace TAM |
|----------------------|-------------|----------------|-----------------|
| 0.10 (aggressive) | 63.3% | $101.0B | $2.68B |
| 0.20 | 56.0% | $89.5B | $5.36B |
| **0.30 (baseline)** | **48.6%** | **$78.9B** | **$8.04B** |
| 0.40 | 42.0% | $67.0B | $10.7B |
| 0.50 | 35.0% | $55.8B | $13.4B |

**Key tradeoff**: Lower α means more savings for buyers but less marketplace revenue. At α = 0.10, the marketplace saves agents 90% of crawl cost on cached content; at α = 0.50, it saves 50%. Even at α = 0.50, the marketplace is valuable because it's still cheaper than re-crawling.

### 6.4 Conservative vs. Moderate vs. Aggressive Scenarios

At 10% AI adoption:

| Scenario | D_avg | C_crawl | Savings rate | Annual Savings | Marketplace TAM |
|----------|-------|---------|-------------|----------------|-----------------|
| **Conservative** | 5.0 | $0.003 | 56.0% | $7.1B | $1.02B |
| **Moderate** | 50.1 | $0.005 | 68.6% | $78.9B | $8.04B |
| **Aggressive** | 100 | $0.012 | 69.3% | $383B | $39.1B |

### 6.5 What If Cloudflare's 50B/day Is the Entire AI Crawl Volume?

If we don't extrapolate (assume Cloudflare sees ALL AI traffic, not 20%):

```
C_ai = 50B req/day (not 250B)
Content fetches = 50B × 0.20 = 10B/day
D = 10B / 500M = 20

Annual cost without marketplace: 10B × $0.005 × 365 = $18.3B/yr
Annual savings (α=0.30): $18.3B × 0.665 = $12.2B/yr
```

Even in this most conservative reading, annual savings exceed **$12B/year** at current adoption levels.

---

## 7. Key Takeaways

### 7.1 Total Addressable Waste

| Adoption Level | Annual AI Crawl Spend | Wasted Spend (duplication) | Marketplace-Capturable Savings |
|----------------|----------------------|---------------------------|-------------------------------|
| Current (1%) | $9.1B | $5.7B - $7.3B | $5.7B - $7.3B |
| 10% adoption | $115B | $79B - $101B | $79B - $101B |

### 7.2 Marketplace Capture Rate

The marketplace can theoretically eliminate 100% of redundant crawls. Realistic capture depends on:
- **Freshness requirements**: Some agents need real-time data (cache miss)
- **Content specificity**: Some extractions are custom (can't use generic cache)
- **Adoption lag**: Not all agents will integrate immediately

**Realistic capture rate**: 20-40% of addressable waste in the first 3 years, growing to 60-80% at maturity.

| Capture Rate | Annual Savings at 10% adoption |
|-------------|-------------------------------|
| 20% | $15.8B |
| 40% | $31.6B |
| 60% | $47.3B |
| 80% | $63.1B |

### 7.3 Break-Even Analysis for Node Operators

**When does running a node become profitable?**

```
Monthly node cost: $800
Revenue per transaction: $0.00135
Break-even transactions/month: $800 / $0.00135 = 593,000 txns/month
                                                = ~20,000 txns/day
```

At current adoption (1%) with 1,000 nodes:
```
Total daily transactions: 225M
Per-node transactions: 225,000/day
Break-even: 20,000/day
Margin: 91x above break-even
```

**Nodes are profitable from day one** if there are fewer than ~11,000 nodes at current volume. The economics strongly favor early node operators.

### 7.4 Summary of Key Numbers

| Metric | Conservative | Moderate | Aggressive |
|--------|-------------|----------|------------|
| Current annual waste | $1.3B | $5.7B | $19.7B |
| Waste at 10% adoption | $7.1B | $78.9B | $383B |
| Marketplace TAM at 10% | $1.0B | $8.0B | $39.1B |
| Savings rate | 56% | 69% | 69% |
| Node break-even | Day 1 | Day 1 | Day 1 |
| Node annual profit (early) | $50K | $302K | $1.2M |

### 7.5 The Fundamental Insight

**The cost of AI web crawling is dominated by LLM token processing (97%), not bandwidth (3%).** This means:

1. Every redundant crawl wastes ~$0.005-$0.012 in token costs
2. A marketplace that serves pre-extracted content at 30% of crawl cost saves 70% on every duplicate
3. As AI adoption grows, duplication increases superlinearly (more agents overlap on popular content)
4. **The savings curve is convex** — every additional percentage point of AI adoption generates more savings than the last

This is not a linear market. It's a network-effects market where the value of the marketplace grows faster than the number of participants.

---

## Appendix A: Formulas Reference

```
Variables:
  a    = AI adoption rate (fraction of total web traffic)
  P(a) = unique pages crawled per day
  D(a) = average duplication factor
  C    = cost per crawl
  α    = marketplace price / crawl cost ratio

Scaling:
  P(a) = P_0 × (a / a_0)^0.4
  D(a) = D_0 × (a / a_0)^0.7
  N(a) = N_0 × (a / a_0)

Costs:
  Cost_without = P × D × C × 365                    (annual)
  Cost_with    = P × C × [1 + (D-1) × α] × 365     (annual)
  Savings      = P × C × (D-1) × (1-α) × 365       (annual)
  Savings_rate = (D-1) × (1-α) / D

Node economics:
  Revenue_per_txn = (1 - platform_fee) × α × C
  Txns_per_node   = (P × (D-1) × mkt_penetration) / N_nodes
  Node_profit     = Txns_per_node × Revenue_per_txn - Node_cost
```

## Appendix B: Data Sources

1. Cloudflare 2025 Year in Review — AI bot traffic share, 81M req/s average
   https://blog.cloudflare.com/radar-2025-year-in-review/
2. Thunderbit 2026 — Web crawling statistics, 50B AI requests/day, crawler market share
   https://thunderbit.com/blog/web-crawling-stats-and-industry-benchmarks
3. HTTP Archive 2025 Web Almanac — Page weight breakdown (HTML 22KB, CSS 82KB, JS 697KB)
   https://almanac.httparchive.org/en/2025/page-weight
4. Anthropic Claude API Pricing — Sonnet $3/$15 per 1M tokens
   https://platform.claude.com/docs/en/about-claude/pricing
5. OpenAI GPT-4o Pricing — $2.50/$10 per 1M tokens
   https://openai.com/api/pricing/
6. Akamai 2025 AI Bot Report — 300% YoY growth in AI bot traffic
   https://www.akamai.com/resources/infographic/fraud-and-abuse-report-2025
7. Medianama/Cloudflare — User-driven AI bots grew 15x in 2025
   https://www.medianama.com/2025/12/223-user-driven-ai-bots-crawling-grows-15x-in-2025-cloudflare-report/
8. Cloud egress pricing comparison 2026
   https://gpuperhour.com/reference/data-egress
9. WorldWideWebSize — Google indexes 40-70B pages
   https://www.worldwidewebsize.com/
10. AI web scraping market size — $886M in 2025, 17.3% CAGR to $4.37B by 2035
    https://thunderbit.com/blog/web-crawling-stats-and-industry-benchmarks

## Appendix C: Confidence Ranges

| Metric | Low (10th pct) | Central | High (90th pct) |
|--------|----------------|---------|-----------------|
| Current AI crawl requests/day (global) | 50B | 150B | 300B |
| Average duplication factor (current) | 3 | 10 | 50 |
| Cost per crawl (blended) | $0.002 | $0.005 | $0.012 |
| Unique pages crawled/day | 200M | 500M | 2B |
| Annual savings at current adoption | $0.4B | $5.7B | $26B |
| Annual savings at 10% adoption | $3B | $79B | $200B+ |
| Marketplace TAM at 10% | $0.5B | $8B | $40B |
