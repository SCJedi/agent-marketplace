'use strict';

module.exports = {
  // Use a different port than the red-team simulation
  nodePort: 3457,

  // 20 agents across budget tiers
  agents: 20,
  // 8 providers with varied cost structures
  providers: 8,
  // 100 rounds to observe equilibrium
  rounds: 100,
  // Faster rounds since no malicious actors
  delayBetweenRounds: 200,

  // Token cost ceiling
  tokenCostCeiling: 0.001,

  // Budget tiers — agents are assigned one
  budgetTiers: {
    cheap:    { budget: 0.01,  priceCeiling: 0.0002, count: 8 },
    standard: { budget: 0.03,  priceCeiling: 0.0005, count: 8 },
    premium:  { budget: 0.08,  priceCeiling: 0.001,  count: 4 },
  },

  // Provider cost structures
  providerProfiles: [
    { name: 'LowCost-1',   fixedCost: 0.00003, varCost: 0.00001, strategy: 'cheap',    specialty: 'general' },
    { name: 'LowCost-2',   fixedCost: 0.00004, varCost: 0.00001, strategy: 'cheap',    specialty: 'tech' },
    { name: 'MidTier-1',   fixedCost: 0.00006, varCost: 0.00002, strategy: 'standard', specialty: 'finance' },
    { name: 'MidTier-2',   fixedCost: 0.00005, varCost: 0.00002, strategy: 'standard', specialty: 'ai' },
    { name: 'MidTier-3',   fixedCost: 0.00007, varCost: 0.00003, strategy: 'standard', specialty: 'security' },
    { name: 'Premium-1',   fixedCost: 0.00010, varCost: 0.00004, strategy: 'premium',  specialty: 'ai' },
    { name: 'Premium-2',   fixedCost: 0.00012, varCost: 0.00005, strategy: 'premium',  specialty: 'finance' },
    { name: 'Generalist-1',fixedCost: 0.00008, varCost: 0.00003, strategy: 'standard', specialty: 'general' },
  ],

  // New entrants at round 50
  newEntrants: [
    { name: 'Entrant-1', fixedCost: 0.00004, varCost: 0.00001, strategy: 'cheap',    specialty: 'tech' },
    { name: 'Entrant-2', fixedCost: 0.00006, varCost: 0.00002, strategy: 'standard', specialty: 'general' },
    { name: 'Entrant-3', fixedCost: 0.00005, varCost: 0.00002, strategy: 'cheap',    specialty: 'finance' },
  ],

  // Demand shock at round 70: remove these URLs from the pool
  demandShockRemoveCount: 30,

  // 100 URLs in the pool
  urls: [
    // Tech (20)
    'https://docs.python.org/3/tutorial/index.html',
    'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide',
    'https://react.dev/learn',
    'https://nodejs.org/en/docs/guides',
    'https://docs.docker.com/get-started/',
    'https://kubernetes.io/docs/tutorials/',
    'https://www.rust-lang.org/learn',
    'https://go.dev/doc/tutorial/getting-started',
    'https://docs.github.com/en/actions',
    'https://tailwindcss.com/docs/installation',
    'https://svelte.dev/docs/introduction',
    'https://vuejs.org/guide/introduction.html',
    'https://angular.io/docs',
    'https://nextjs.org/docs/getting-started',
    'https://fastapi.tiangolo.com/tutorial/',
    'https://flask.palletsprojects.com/en/latest/',
    'https://spring.io/guides',
    'https://laravel.com/docs',
    'https://www.typescriptlang.org/docs/',
    'https://graphql.org/learn/',

    // Finance (15)
    'https://www.investopedia.com/terms/b/bitcoin.asp',
    'https://ethereum.org/en/developers/docs/',
    'https://docs.solana.com/introduction',
    'https://www.coindesk.com/markets/',
    'https://defillama.com/docs/api',
    'https://www.nasdaq.com/market-activity',
    'https://finance.yahoo.com/markets/',
    'https://www.bloomberg.com/markets',
    'https://www.federalreserve.gov/data.htm',
    'https://fred.stlouisfed.org/',
    'https://www.sec.gov/edgar/searchedgar',
    'https://www.cmegroup.com/markets/interest-rates.html',
    'https://www.tradingview.com/markets/',
    'https://messari.io/research',
    'https://dune.com/browse/dashboards',

    // AI/ML (15)
    'https://huggingface.co/docs/transformers',
    'https://pytorch.org/tutorials/',
    'https://www.tensorflow.org/tutorials',
    'https://platform.openai.com/docs/guides',
    'https://docs.anthropic.com/claude/docs',
    'https://arxiv.org/abs/2301.00234',
    'https://arxiv.org/abs/2310.06825',
    'https://arxiv.org/abs/2303.08774',
    'https://scikit-learn.org/stable/tutorial/',
    'https://jax.readthedocs.io/en/latest/',
    'https://mlflow.org/docs/latest/',
    'https://wandb.ai/site/docs',
    'https://docs.ray.io/en/latest/',
    'https://langchain.com/docs',
    'https://llamaindex.ai/docs',

    // Security (10)
    'https://owasp.org/www-project-top-ten/',
    'https://cve.mitre.org/cgi-bin/cvekey.cgi?keyword=2026',
    'https://nvd.nist.gov/vuln/search',
    'https://www.exploit-db.com/',
    'https://portswigger.net/web-security',
    'https://www.sans.org/blog/',
    'https://attack.mitre.org/',
    'https://cheatsheetseries.owasp.org/',
    'https://snyk.io/learn/',
    'https://www.hackerone.com/vulnerability-database',

    // Data/Research (15)
    'https://data.worldbank.org/indicator/NY.GDP.MKTP.CD',
    'https://www.kaggle.com/datasets',
    'https://datasetsearch.research.google.com/',
    'https://registry.opendata.aws/',
    'https://paperswithcode.com/sota',
    'https://scholar.google.com/',
    'https://www.nature.com/articles',
    'https://www.science.org/journals',
    'https://pubmed.ncbi.nlm.nih.gov/',
    'https://www.biorxiv.org/',
    'https://www.ssrn.com/index.cfm/en/',
    'https://www.jstor.org/',
    'https://www.census.gov/data.html',
    'https://data.gov/',
    'https://www.statista.com/',

    // News/Blog (10)
    'https://techcrunch.com/2026/03/25/latest',
    'https://arstechnica.com/science/2026/latest',
    'https://news.ycombinator.com/best',
    'https://www.theverge.com/tech',
    'https://blog.cloudflare.com/latest',
    'https://www.wired.com/tag/artificial-intelligence/',
    'https://www.technologyreview.com/',
    'https://spectrum.ieee.org/',
    'https://www.infoworld.com/',
    'https://stackoverflow.blog/',

    // API/Tools (15)
    'https://stripe.com/docs/api',
    'https://docs.github.com/en/rest',
    'https://developers.google.com/maps/documentation',
    'https://docs.aws.amazon.com/sdk-for-javascript/',
    'https://cloud.google.com/docs/overview',
    'https://learn.microsoft.com/en-us/azure/',
    'https://developer.twitter.com/en/docs',
    'https://www.twilio.com/docs',
    'https://docs.sendgrid.com/',
    'https://www.postman.com/api-documentation-tool/',
    'https://swagger.io/docs/',
    'https://www.heroku.com/elements/addons',
    'https://vercel.com/docs',
    'https://docs.netlify.com/',
    'https://docs.railway.app/',
  ],

  // Categories for demand distribution
  categories: ['tech', 'finance', 'ai', 'security', 'data', 'news', 'api'],

  // URL-to-category mapping ranges (by index in urls array)
  categoryRanges: {
    tech:     [0, 20],
    finance:  [20, 35],
    ai:       [35, 50],
    security: [50, 60],
    data:     [60, 75],
    news:     [75, 85],
    api:      [85, 100],
  },
};
