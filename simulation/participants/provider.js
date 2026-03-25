'use strict';

const crypto = require('crypto');

class SimProvider {
  constructor(id, baseUrl, config) {
    this.name = `Provider-${id}`;
    this.baseUrl = baseUrl;
    this.config = config;

    // Assign specialty and pricing strategy
    this.specialty = config.specialties[id % config.specialties.length];
    this.pricingStrategy = config.pricingStrategies[id % config.pricingStrategies.length];

    this.earned = 0;
    this.published = 0;
    this.fetchedByOthers = 0;
    this.nodeId = null;
    this.apiKey = null;
    this.log = [];

    this.publishedUrls = new Set();

    // ITERATION 1: Realistic economics — process a page for $0.0003, sell for $0.0003 each
    // Break even on 1 sale, profit on 2+ sales per page
    this.operatingCosts = 0;
    this.baseCostPerRound = 0.000005; // $0.000005 per round overhead (minimal)
    this.costPerPublish = 0.0003;     // $0.0003 per page processed (crawl + clean + store)
    this.costPerStore = 0.0000005;    // $0.0000005 per item stored per round (trivial)

    // Revenue tracking
    this.revenue = 0;
    this.profitLoss = 0;
    this.roundsUnprofitable = 0;
    this.active = true;

    // ITERATION 1: Per-content ROI tracking
    this.contentROI = {}; // url -> { cost: N, revenue: N, sales: N, category: str }
    this.categoryROI = {}; // category -> { cost: N, revenue: N, items: N }
    this.unprofitableCategories = new Set();

    // Market-responsive pricing
    this.currentPrice = this._basePrice();
    this.lastDemandSignal = 0;

    // ITERATION 1: Track rate limit rejections
    this.rateLimitHits = 0;
  }

  async register() {
    try {
      const res = await this._post('/nodes/register', {
        name: this.name,
        endpoint: `http://localhost:${this.config.nodePort}/sim/${this.name}`,
        coverage: this.specialty,
        pricing_model: this.pricingStrategy,
        avg_price: this._basePrice(),
        deposit: 0.005, // ITERATION 1: Providers put up a deposit
      });
      if (res.success && res.data) {
        this.nodeId = res.data.id;
        this.apiKey = res.data.api_key;
      }
    } catch (err) {
      // ignore
    }
  }

  async act(round) {
    if (!this.active) return;

    // Deduct operating costs each round
    const storageCost = this.publishedUrls.size * this.costPerStore;
    this.operatingCosts += this.baseCostPerRound + storageCost;

    // Calculate P&L
    this.profitLoss = this.revenue - this.operatingCosts;
    if (this.profitLoss < -0.01) {
      this.roundsUnprofitable++;
    } else if (this.profitLoss > 0) {
      this.roundsUnprofitable = Math.max(0, this.roundsUnprofitable - 2);
    } else {
      this.roundsUnprofitable = Math.max(0, this.roundsUnprofitable - 1);
    }

    // Provider exits market after sustained losses (but gives it a fair shot)
    if (this.roundsUnprofitable > 30 && round > 40) {
      this.active = false;
      this.log.push({ round, action: 'exit_market', reason: 'sustained_losses', profitLoss: this.profitLoss });
      return;
    }

    // Adjust price based on market conditions
    this._adjustPricing(round);

    // ITERATION 1: Learn which categories are unprofitable and stop publishing them
    this._evaluateCategoryROI(round);

    const action = Math.random();

    if (action < 0.55) {
      await this._crawlAndPublish(round);
    } else if (action < 0.80) {
      await this._updateContent(round);
    } else if (action < 0.95) {
      await this._publishArtifact(round);
    } else {
      // idle
    }
  }

  // Market-driven price adjustment
  _adjustPricing(round) {
    if (round % 5 !== 0) return;

    if (this.lastDemandSignal > 3) {
      // High demand — raise prices slightly
      this.currentPrice = Math.min(this.config.tokenCostCeiling * 0.9, this.currentPrice * 1.1);
    } else if (this.lastDemandSignal < 1) {
      // Low demand — lower prices to attract buyers
      this.currentPrice = Math.max(this.costPerPublish * 0.3, this.currentPrice * 0.85);
    }

    this.lastDemandSignal = 0;
  }

  // ITERATION 1: Evaluate per-category ROI and stop publishing unprofitable ones
  _evaluateCategoryROI(round) {
    if (round % 10 !== 0 || round < 15) return;

    for (const [category, roi] of Object.entries(this.categoryROI)) {
      if (roi.items >= 3) {
        const categoryPL = roi.revenue - roi.cost;
        if (categoryPL < -0.002 && roi.revenue / Math.max(0.0001, roi.cost) < 0.3) {
          this.unprofitableCategories.add(category);
          this.log.push({ round, action: 'drop_category', category, pl: categoryPL });
        } else if (categoryPL > 0) {
          // Category became profitable again — keep publishing
          this.unprofitableCategories.delete(category);
        }
      }
    }
  }

  // Called externally when content is purchased from this provider
  recordSale(price, url) {
    this.revenue += price;
    this.earned += price;
    this.fetchedByOthers++;
    this.lastDemandSignal++;

    // ITERATION 1: Track per-content ROI
    if (url && this.contentROI[url]) {
      this.contentROI[url].revenue += price;
      this.contentROI[url].sales++;
    }
  }

  async _crawlAndPublish(round) {
    const url = this._pickSpecialtyUrl();

    // ITERATION 1: Determine category and skip if unprofitable
    const category = this._urlCategory(url);
    if (this.unprofitableCategories.has(category)) {
      this.log.push({ round, action: 'skip_unprofitable', url, category });
      return;
    }

    const hash = crypto.createHash('sha256').update(url + round + this.name).digest('hex');

    // Deduct crawl cost
    this.operatingCosts += this.costPerPublish;

    // ITERATION 1: Track per-content investment
    if (!this.contentROI[url]) {
      this.contentROI[url] = { cost: 0, revenue: 0, sales: 0, category };
    }
    this.contentROI[url].cost += this.costPerPublish;

    // Track category-level ROI
    if (!this.categoryROI[category]) {
      this.categoryROI[category] = { cost: 0, revenue: 0, items: 0 };
    }
    this.categoryROI[category].cost += this.costPerPublish;
    this.categoryROI[category].items++;

    try {
      // Check if already exists — undercut if so
      const checkRes = await this._get(`/check?url=${encodeURIComponent(url)}`);
      let finalPrice = this.currentPrice;

      if (checkRes.success && checkRes.data.available) {
        const existingPrice = checkRes.data.price;
        if (existingPrice > 0 && existingPrice < finalPrice) {
          finalPrice = Math.max(this.costPerPublish * 0.3, existingPrice * 0.9);
        } else if (this.pricingStrategy === 'premium') {
          finalPrice = Math.min(this.currentPrice * 1.1, this.config.tokenCostCeiling);
        }
      }

      const quality = this._contentQuality();
      const res = await this._post('/publish/content', {
        url,
        source_hash: hash,
        content_text: `${quality.prefix} content for ${url}. Provider: ${this.name}. Specialty: ${this.specialty}. Round: ${round}.`,
        content_structured: { quality: quality.score, specialty: this.specialty, provider: this.name },
        content_metadata: JSON.stringify({
          provider: this.name,
          specialty: this.specialty,
          quality: quality.score,
          crawled_at: new Date().toISOString(),
        }),
        provider_id: this.nodeId || this.name,
        price: finalPrice,
        token_cost_saved: 0.0005,
      });

      if (res.success) {
        this.published++;
        this.publishedUrls.add(url);
        this.log.push({ round, action: 'publish', url, price: finalPrice });
      } else if (res.error && res.error.includes('rate limit')) {
        this.rateLimitHits++;
        this.log.push({ round, action: 'rate_limited', url });
      }
    } catch (err) {
      // ignore
    }
  }

  async _updateContent(round) {
    if (this.publishedUrls.size === 0) return;

    // ITERATION 1: Only update content that has generated revenue (profitable items)
    const profitableUrls = Array.from(this.publishedUrls).filter(url => {
      const roi = this.contentROI[url];
      return roi && (roi.sales > 0 || roi.revenue > roi.cost * 0.5);
    });

    const urls = profitableUrls.length > 0 ? profitableUrls : Array.from(this.publishedUrls);
    const url = urls[Math.floor(Math.random() * urls.length)];

    // Deduct update cost (cheaper than initial crawl)
    const updateCost = this.costPerPublish * 0.3;
    this.operatingCosts += updateCost;

    if (this.contentROI[url]) {
      this.contentROI[url].cost += updateCost;
    }

    const hash = crypto.createHash('sha256').update(url + round + 'update' + this.name).digest('hex');

    try {
      const res = await this._post('/publish/content', {
        url,
        source_hash: hash,
        content_text: `Updated content for ${url}. Provider: ${this.name}. Freshness update round ${round}.`,
        content_structured: { quality: this._contentQuality().score, specialty: this.specialty, freshness: 'updated' },
        content_metadata: JSON.stringify({
          provider: this.name,
          updated: true,
          round,
        }),
        provider_id: this.nodeId || this.name,
        price: this.currentPrice,
        token_cost_saved: 0.0003,
      });

      if (res.success) {
        this.published++;
        this.log.push({ round, action: 'update', url, price: this.currentPrice });
      }
    } catch (err) {
      // ignore
    }
  }

  async _publishArtifact(round) {
    const artifactTypes = {
      code: ['cli-tool', 'api-client', 'parser', 'linter', 'formatter'],
      ai: ['model-wrapper', 'prompt-template', 'eval-suite', 'data-pipeline', 'fine-tune-script'],
      finance: ['price-tracker', 'portfolio-analyzer', 'tax-calculator', 'market-scanner', 'alert-system'],
      security: ['vuln-scanner', 'auth-middleware', 'rate-limiter', 'input-validator', 'encryption-util'],
      general: ['config-manager', 'logger', 'cache-layer', 'task-runner', 'file-watcher'],
    };

    const pool = artifactTypes[this.specialty] || artifactTypes.general;
    const base = pool[Math.floor(Math.random() * pool.length)];
    const slug = `${base}-${this.name.toLowerCase()}-r${round}`;

    // Artifact publishing has higher cost
    const artifactCost = this.costPerPublish * 2;
    this.operatingCosts += artifactCost;

    try {
      const res = await this._post('/publish/artifact', {
        slug,
        name: `${base} by ${this.name}`,
        category: this.specialty,
        description: `A ${this.specialty} artifact: ${base}. Published by ${this.name} in round ${round}.`,
        tags: [this.specialty, base, 'simulation'],
        price: this.currentPrice * 5,
        build_cost: 0.001,
        license: 'MIT',
      });

      if (res.success) {
        this.log.push({ round, action: 'artifact', slug });
      }
    } catch (err) {
      // ignore — slug conflict expected
    }
  }

  // ITERATION 1: Determine URL category for ROI tracking
  _urlCategory(url) {
    if (url.includes('python') || url.includes('javascript') || url.includes('docker') || url.includes('react') ||
        url.includes('nodejs') || url.includes('rust') || url.includes('go.dev') || url.includes('github') ||
        url.includes('tailwind') || url.includes('kubernetes')) return 'code';
    if (url.includes('bitcoin') || url.includes('ethereum') || url.includes('solana') || url.includes('coindesk') ||
        url.includes('defi') || url.includes('investopedia')) return 'finance';
    if (url.includes('huggingface') || url.includes('pytorch') || url.includes('tensorflow') ||
        url.includes('openai') || url.includes('anthropic') || url.includes('machine_learning')) return 'ai';
    if (url.includes('owasp') || url.includes('cve') || url.includes('nvd') || url.includes('exploit') ||
        url.includes('portswigger')) return 'security';
    return 'general';
  }

  _pickSpecialtyUrl() {
    const urls = this.config.urls;
    const specialtyRanges = {
      code: [0, 10],
      finance: [10, 15],
      ai: [15, 20],
      security: [40, 45],
      general: [0, urls.length],
    };
    const range = specialtyRanges[this.specialty] || specialtyRanges.general;
    if (Math.random() < 0.7) {
      const idx = range[0] + Math.floor(Math.random() * (range[1] - range[0]));
      return urls[Math.min(idx, urls.length - 1)];
    }
    return urls[Math.floor(Math.random() * urls.length)];
  }

  _basePrice() {
    // ITERATION 1: Prices adjusted so multiple sales can cover processing cost
    // Process cost: $0.001. Sell to 10 agents at $0.0003 each = $0.003 revenue
    const prices = { cheap: 0.0002, standard: 0.0003, premium: 0.0005 };
    return prices[this.pricingStrategy] || 0.0003;
  }

  _contentQuality() {
    if (this.pricingStrategy === 'premium') {
      return { score: 0.9, prefix: 'High-quality detailed' };
    } else if (this.pricingStrategy === 'standard') {
      return { score: 0.7, prefix: 'Standard' };
    }
    return { score: 0.5, prefix: 'Basic' };
  }

  async _get(path) {
    const res = await fetch(`${this.baseUrl}${path}`);
    return res.json();
  }

  async _post(path, body) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  getStats() {
    // ITERATION 1: Calculate category ROI summary
    const categoryPL = {};
    for (const [cat, roi] of Object.entries(this.categoryROI)) {
      categoryPL[cat] = { pl: roi.revenue - roi.cost, items: roi.items, revenue: roi.revenue };
    }

    return {
      name: this.name,
      specialty: this.specialty,
      strategy: this.pricingStrategy,
      earned: this.earned,
      revenue: this.revenue,
      operatingCosts: this.operatingCosts,
      profitLoss: this.profitLoss,
      published: this.published,
      uniqueUrls: this.publishedUrls.size,
      active: this.active,
      currentPrice: this.currentPrice,
      rateLimitHits: this.rateLimitHits,
      categoryPL,
      unprofitableCategories: Array.from(this.unprofitableCategories),
    };
  }
}

module.exports = SimProvider;
