'use strict';

const Participant = require('./participant');

/**
 * Consumer agent — buys content from the marketplace or crawls it themselves.
 * Makes rational economic decisions: buy vs crawl, verified vs unverified.
 */
class Agent extends Participant {
  constructor(id, config, rng) {
    const budget = config.agentBudgetMin + rng() * (config.agentBudgetMax - config.agentBudgetMin);
    super(id, 'agent', budget * 100); // start with ~100 rounds worth of budget

    this.budgetPerRound = budget;
    this.config = config;

    // Interests — pick 2-4 categories
    const numInterests = 2 + Math.floor(rng() * 3);
    this.interests = [];
    const cats = [...config.categories];
    for (let i = 0; i < numInterests && cats.length > 0; i++) {
      const idx = Math.floor(rng() * cats.length);
      this.interests.push(cats.splice(idx, 1)[0]);
    }

    // URLs this agent cares about (based on interests)
    this.relevantUrls = this._pickRelevantUrls(config, rng);

    // Buying behavior
    this.spotCheckRate = 0.05;   // start with 5% spot-checking
    this.verifiedOnlyRate = 0.0; // start willing to buy unverified
    this.maxPriceMultiplier = 1.5; // willing to pay up to 1.5x crawl cost

    // Experience tracking
    this.providerTrust = {};    // providerId -> trust score (0-1)
    this.badExperiences = 0;
    this.goodExperiences = 0;
    this.totalPurchases = 0;
    this.spotChecks = 0;
    this.spotCheckCatches = 0;  // bad content caught by spot-checking

    // Satisfaction tracking
    this.satisfactionHistory = []; // per-round satisfaction score
    this.roundsSinceTopup = 0;
  }

  _pickRelevantUrls(config, rng) {
    const urls = config.urls;
    const catSize = 10; // 10 URLs per category
    const catMap = {};
    config.categories.forEach((cat, i) => {
      catMap[cat] = urls.slice(i * catSize, (i + 1) * catSize);
    });

    const relevant = [];
    for (const interest of this.interests) {
      if (catMap[interest]) {
        // Pick 3-6 URLs from each interest category
        const catUrls = [...catMap[interest]];
        const pick = 3 + Math.floor(rng() * 4);
        for (let i = 0; i < pick && catUrls.length > 0; i++) {
          const idx = Math.floor(rng() * catUrls.length);
          relevant.push(catUrls.splice(idx, 1)[0]);
        }
      }
    }
    return relevant;
  }

  /**
   * Each round: pick 1-3 URLs to fetch, decide buy vs crawl for each.
   */
  async act(round, baseUrl, marketState, rng) {
    if (!this.active) return;

    // Budget top-up each round (represents ongoing revenue/funding)
    this.recordIncome(round, this.budgetPerRound, 'round_budget');

    // Pick URLs to fetch this round
    const numFetches = 1 + Math.floor(rng() * 3);
    const urlsToFetch = [];
    for (let i = 0; i < numFetches; i++) {
      const url = this.relevantUrls[Math.floor(rng() * this.relevantUrls.length)];
      if (!urlsToFetch.includes(url)) urlsToFetch.push(url);
    }

    let roundSatisfaction = 0;
    let roundActions = 0;

    for (const url of urlsToFetch) {
      // Check marketplace price
      try {
        const checkResp = await fetch(`${baseUrl}/check?url=${encodeURIComponent(url)}`);
        const check = await checkResp.json();

        if (check.success && check.data && check.data.available) {
          const marketPrice = check.data.price || 0;
          const ownCrawlCost = this.config.crawlCostPerPage;
          const maxWilling = ownCrawlCost * this.maxPriceMultiplier;

          // Decision: buy from market or crawl ourselves?
          if (marketPrice <= maxWilling && marketPrice < ownCrawlCost * 0.95) {
            // Buy from marketplace — it's cheaper than crawling
            const fetchResp = await fetch(`${baseUrl}/fetch?url=${encodeURIComponent(url)}`);
            const fetchData = await fetchResp.json();

            if (fetchData.success && fetchData.data) {
              this.recordExpense(round, marketPrice, `buy:${url}`);
              this.totalPurchases++;

              const providerId = fetchData.data.provider_id;

              // Spot-check? (costs crawl cost to verify)
              const doSpotCheck = rng() < this.spotCheckRate;
              if (doSpotCheck) {
                this.spotChecks++;
                this.recordExpense(round, ownCrawlCost * 0.5, 'spot_check');

                // Simulate spot-check result — check if content is legitimate
                const isGarbage = fetchData.data.content_text &&
                  (fetchData.data.content_text.includes('POISONED') ||
                   fetchData.data.content_text.includes('FAKE') ||
                   fetchData.data.content_text.includes('SPAM'));

                if (isGarbage) {
                  this.spotCheckCatches++;
                  this.badExperiences++;
                  this._updateProviderTrust(providerId, 0);
                  roundSatisfaction -= 1;
                } else {
                  this.goodExperiences++;
                  this._updateProviderTrust(providerId, 1);
                  roundSatisfaction += 0.8; // slight cost for spot-checking
                }
              } else {
                // No spot-check — assume content is good
                // (bad content slips through sometimes)
                const isGarbage = fetchData.data.content_text &&
                  (fetchData.data.content_text.includes('POISONED') ||
                   fetchData.data.content_text.includes('FAKE') ||
                   fetchData.data.content_text.includes('SPAM'));

                if (isGarbage) {
                  // Will discover later (some bad content goes undetected)
                  if (rng() < 0.3) {
                    this.badExperiences++;
                    this._updateProviderTrust(providerId, 0);
                    roundSatisfaction -= 0.5;
                  } else {
                    roundSatisfaction += 0.5; // didn't notice it was bad
                  }
                } else {
                  this.goodExperiences++;
                  this._updateProviderTrust(providerId, 1);
                  roundSatisfaction += 1;
                }
              }
            }
          } else {
            // Too expensive — crawl ourselves
            this.recordExpense(round, ownCrawlCost, `self_crawl:${url.slice(0, 30)}`);
            roundSatisfaction += 0.6; // works but costs more effort
          }
        } else {
          // Not in marketplace — crawl ourselves
          this.recordExpense(round, this.config.crawlCostPerPage, `self_crawl:${url.slice(0, 30)}`);
          roundSatisfaction += 0.4; // no marketplace value
        }
        roundActions++;
      } catch (e) {
        // Network error — crawl ourselves
        this.recordExpense(round, this.config.crawlCostPerPage, 'self_crawl_fallback');
        roundActions++;
      }
    }

    // Record satisfaction
    if (roundActions > 0) {
      this.satisfactionHistory.push(roundSatisfaction / roundActions);
    }
  }

  _updateProviderTrust(providerId, outcome) {
    if (!providerId) return;
    const current = this.providerTrust[providerId] || 0.5;
    // Exponential moving average
    this.providerTrust[providerId] = current * 0.7 + outcome * 0.3;
  }

  adapt(round, marketState) {
    super.adapt(round, marketState);

    // Increase spot-checking if we've had bad experiences
    if (this.badExperiences > 0) {
      const badRate = this.badExperiences / Math.max(1, this.totalPurchases);
      // More bad experiences = more spot-checking, capped at 40%
      this.spotCheckRate = Math.min(0.4, 0.05 + badRate * 2);
    }

    // If losses are high, become more cautious about price
    const recentPnL = this.getRecentPnL(10);
    if (recentPnL < 0) {
      this.maxPriceMultiplier = Math.max(0.8, this.maxPriceMultiplier - 0.1);
    } else {
      this.maxPriceMultiplier = Math.min(2.0, this.maxPriceMultiplier + 0.05);
    }

    // If spot-checking catches nothing for a while, reduce it (saves money)
    if (this.spotChecks > 20 && this.spotCheckCatches === 0) {
      this.spotCheckRate = Math.max(0.02, this.spotCheckRate * 0.8);
    }
  }

  getAvgSatisfaction(lastN = 50) {
    const slice = this.satisfactionHistory.slice(-lastN);
    if (slice.length === 0) return 0;
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  }

  getSummary() {
    return {
      ...super.getSummary(),
      interests: this.interests,
      totalPurchases: this.totalPurchases,
      badExperiences: this.badExperiences,
      goodExperiences: this.goodExperiences,
      spotCheckRate: +this.spotCheckRate.toFixed(3),
      spotCheckCatches: this.spotCheckCatches,
      avgSatisfaction: +this.getAvgSatisfaction().toFixed(3),
    };
  }
}

module.exports = Agent;
