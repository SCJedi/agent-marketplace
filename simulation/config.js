'use strict';

module.exports = {
  nodePort: 3456,
  agents: 10,
  providers: 5,
  verifiers: 3,
  malicious: 3, // RED TEAM FIX: Multiple attackers — fraud is pervasive, not rare
  rounds: 50,
  delayBetweenRounds: 500,

  // Token cost ceiling — max price any content can be listed at
  tokenCostCeiling: 0.001,

  // Verifier stake requirement
  verifierStake: 0.01,

  // Verifier fee per job
  verifierFee: 0.0005,

  urls: [
    // Tech / Documentation
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

    // Finance / Crypto
    'https://www.investopedia.com/terms/b/bitcoin.asp',
    'https://ethereum.org/en/developers/docs/',
    'https://docs.solana.com/introduction',
    'https://www.coindesk.com/markets/',
    'https://defillama.com/docs/api',

    // AI / ML
    'https://huggingface.co/docs/transformers',
    'https://pytorch.org/tutorials/',
    'https://www.tensorflow.org/tutorials',
    'https://platform.openai.com/docs/guides',
    'https://docs.anthropic.com/claude/docs',

    // General Reference
    'https://en.wikipedia.org/wiki/Machine_learning',
    'https://en.wikipedia.org/wiki/Blockchain',
    'https://en.wikipedia.org/wiki/Quantum_computing',
    'https://arxiv.org/abs/2301.00234',
    'https://arxiv.org/abs/2310.06825',

    // APIs / Tools
    'https://stripe.com/docs/api',
    'https://docs.github.com/en/rest',
    'https://developers.google.com/maps/documentation',
    'https://docs.aws.amazon.com/sdk-for-javascript/',
    'https://cloud.google.com/docs/overview',

    // News / Blog
    'https://techcrunch.com/2026/03/25/latest',
    'https://arstechnica.com/science/2026/latest',
    'https://news.ycombinator.com/best',
    'https://www.theverge.com/tech',
    'https://blog.cloudflare.com/latest',

    // Data / Research
    'https://data.worldbank.org/indicator/NY.GDP.MKTP.CD',
    'https://www.kaggle.com/datasets',
    'https://datasetsearch.research.google.com/',
    'https://registry.opendata.aws/',
    'https://paperswithcode.com/sota',

    // Security
    'https://owasp.org/www-project-top-ten/',
    'https://cve.mitre.org/cgi-bin/cvekey.cgi?keyword=2026',
    'https://nvd.nist.gov/vuln/search',
    'https://www.exploit-db.com/',
    'https://portswigger.net/web-security',
  ],

  // Interest categories for agents
  categories: ['tech', 'finance', 'ai', 'security', 'data', 'general'],

  // Provider specialties
  specialties: ['general', 'code', 'finance', 'ai', 'security'],

  // Pricing strategies
  pricingStrategies: ['cheap', 'standard', 'premium'],
};
