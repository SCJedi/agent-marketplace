'use strict';

const path = require('path');
const fs = require('fs');
const Harness = require('./harness');
const { generateReport } = require('./report-generator');
const config = require('../config/default');

// Suite registry — maps suite name to array of scenario classes
const SUITES = {
  'api-security': () => [
    require('../scenarios/api-security/RT-A001-identity-spoofing'),
    require('../scenarios/api-security/RT-A002-sql-injection'),
    require('../scenarios/api-security/RT-A003-rate-limit-bypass'),
    require('../scenarios/api-security/RT-A004-self-verification'),
    require('../scenarios/api-security/RT-A005-hash-collision'),
  ],
  // Future suites:
  // 'economic': () => [...],
  // 'sybil': () => [...],
  // 'content-integrity': () => [...],
  // 'verification': () => [...],
  // 'market-manipulation': () => [...],
};

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let suiteName = null;
  let runAll = false;
  let profileName = 'ci';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--suite' && args[i + 1]) {
      suiteName = args[++i];
    } else if (args[i] === '--all') {
      runAll = true;
    } else if (args[i] === '--profile' && args[i + 1]) {
      profileName = args[++i];
    }
  }

  if (!suiteName && !runAll) {
    console.error('Usage: node ci-runner.js --suite <name> [--profile ci|full]');
    console.error('       node ci-runner.js --all [--profile ci|full]');
    console.error(`Available suites: ${Object.keys(SUITES).join(', ')}`);
    process.exit(2);
  }

  const profile = config[profileName] || config.ci;
  console.log(`\nRed Team CI Runner`);
  console.log(`Profile: ${profileName} (trials=${profile.trials}, rounds=${profile.rounds})`);
  console.log(`${'='.repeat(60)}\n`);

  const suitesToRun = runAll ? Object.keys(SUITES) : [suiteName];
  let allPassed = true;
  let anyInconclusive = false;

  for (const suite of suitesToRun) {
    if (!SUITES[suite]) {
      console.error(`Unknown suite: ${suite}`);
      process.exit(2);
    }

    console.log(`\nSuite: ${suite}`);
    console.log(`${'-'.repeat(40)}`);

    const harness = new Harness();
    const scenarios = SUITES[suite]();
    const suiteResults = await harness.runSuite(scenarios, {
      ...profile,
      portStart: profile.portStart,
    });

    // Generate report
    const resultsDir = path.join(__dirname, '..', 'results');
    if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

    const reportPath = path.join(resultsDir, `suite-${suite}-results.md`);
    generateReport(suiteResults, suite, reportPath);

    // Also save raw JSON
    const jsonPath = path.join(resultsDir, `suite-${suite}-results.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(suiteResults, null, 2), 'utf-8');

    console.log(`\n  Report saved: ${reportPath}`);

    // Track overall status
    if (suiteResults.summary.failed > 0) allPassed = false;
    if (suiteResults.summary.errors > 0) anyInconclusive = true;

    console.log(`  Summary: ${suiteResults.summary.passed}/${suiteResults.summary.total} passed, ${suiteResults.summary.failed} failed, ${suiteResults.summary.errors} errors`);
  }

  console.log(`\n${'='.repeat(60)}`);
  if (!allPassed) {
    console.log('RESULT: FAIL — vulnerabilities detected');
    process.exit(1);
  } else if (anyInconclusive) {
    console.log('RESULT: INCONCLUSIVE — some tests had infrastructure errors');
    process.exit(2);
  } else {
    console.log('RESULT: PASS — all defenses held');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(2);
});
