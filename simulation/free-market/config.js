'use strict';

module.exports = {
  port: 3458,
  dbPath: null, // set at runtime to temp path

  rounds: 500,
  snapshotEvery: 50,
  phaseReportEvery: 100,
  adaptEvery: 10,
  entrantCheckEvery: 25,

  // Initial participants
  initialAgents: 15,
  initialProviders: 6,
  initialAttackers: 2,
  initialVerifiers: 3,

  // Content pool
  urlCount: 80,

  // Economics
  crawlCostPerPage: 0.0010,    // what it costs anyone to crawl a page themselves
  storageCostPerItem: 0.000005, // per item per round storage cost for providers
  serverCostPerRound: 0.002,   // fixed server cost per round for providers
  verifierStake: 0.05,         // stake to become a verifier
  verifierFeePerJob: 0.001,    // fee per verification job
  registrationDeposit: 0.01,   // deposit to register as provider
  publishFee: 0.0001,          // small fee per publish to prevent spam

  // Agent budgets (per round)
  agentBudgetMin: 0.01,
  agentBudgetMax: 0.08,

  // Provider starting capital
  providerCapitalMin: 0.50,
  providerCapitalMax: 2.00,

  // Attacker starting capital
  attackerCapitalMin: 0.30,
  attackerCapitalMax: 1.00,

  // Verifier starting capital
  verifierCapitalMin: 0.20,
  verifierCapitalMax: 0.50,

  // Bankruptcy threshold
  bankruptcyRounds: 20,  // negative balance for this many rounds = exit

  // New entrant conditions
  profitGapThreshold: 0.3, // if avg provider margin > this, new entrants arrive
  attackProfitThreshold: 0.1, // if attack ROI > this, new attackers arrive

  // Token cost ceiling (natural max — no one pays more than crawling themselves)
  tokenCostCeiling: 0.001,

  // URLs — 80 URLs across categories
  urls: generateUrls(),

  categories: ['tech', 'finance', 'ai', 'security', 'data', 'general', 'news', 'api'],

  // Seed for reproducibility
  seed: 42,
};

function generateUrls() {
  const domains = [
    // Tech (10)
    'docs.python.org/3/tutorial', 'developer.mozilla.org/js-guide',
    'react.dev/learn', 'nodejs.org/docs', 'docs.docker.com/start',
    'kubernetes.io/tutorials', 'rust-lang.org/learn', 'go.dev/tutorial',
    'docs.github.com/actions', 'tailwindcss.com/docs',
    // Finance (10)
    'investopedia.com/bitcoin', 'ethereum.org/developers',
    'docs.solana.com/intro', 'coindesk.com/markets', 'defillama.com/api',
    'bloomberg.com/crypto', 'yahoo.finance/btc', 'tradingview.com/chart',
    'binance.com/api-docs', 'coingecko.com/api',
    // AI (10)
    'huggingface.co/transformers', 'pytorch.org/tutorials',
    'tensorflow.org/tutorials', 'openai.com/docs', 'anthropic.com/docs',
    'deepmind.com/research', 'arxiv.org/2301.00234', 'arxiv.org/2310.06825',
    'paperswithcode.com/sota', 'mlflow.org/docs',
    // Security (10)
    'owasp.org/top-ten', 'cve.mitre.org/2026', 'nvd.nist.gov/vuln',
    'exploit-db.com', 'portswigger.net/security', 'hackerone.com/reports',
    'snyk.io/vuln', 'cisa.gov/advisories', 'nmap.org/docs', 'wireshark.org/docs',
    // Data (10)
    'data.worldbank.org/gdp', 'kaggle.com/datasets', 'datasetsearch.google.com',
    'registry.opendata.aws', 'data.gov/datasets', 'eurostat.ec.europa.eu',
    'census.gov/data', 'who.int/data', 'imf.org/data', 'un.org/statistics',
    // General (10)
    'wikipedia.org/machine-learning', 'wikipedia.org/blockchain',
    'wikipedia.org/quantum-computing', 'wikipedia.org/artificial-intelligence',
    'stackoverflow.com/questions', 'medium.com/tech', 'dev.to/latest',
    'hackernews.com/best', 'reddit.com/r/programming', 'lobste.rs/newest',
    // News (10)
    'techcrunch.com/latest', 'arstechnica.com/science', 'theverge.com/tech',
    'wired.com/latest', 'zdnet.com/news', 'engadget.com/tech',
    'venturebeat.com/ai', 'thenextweb.com/latest', 'protocol.com/fintech',
    'restofworld.org/tech',
    // APIs (10)
    'stripe.com/docs/api', 'docs.github.com/rest', 'maps.google.com/docs',
    'aws.amazon.com/sdk-js', 'cloud.google.com/docs', 'azure.microsoft.com/docs',
    'twilio.com/docs/api', 'sendgrid.com/docs', 'cloudflare.com/api', 'vercel.com/docs',
  ];
  return domains.map((d, i) => `https://${d}/page-${i}`);
}
