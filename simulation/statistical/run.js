'use strict';

const config = require('./config');
const { runTrial } = require('./trial');
const { writeReport } = require('./report');

async function main() {
  const numTrials = parseInt(process.argv[2], 10) || config.trials;
  const roundsOverride = parseInt(process.argv[3], 10) || config.roundsPerTrial;

  const runConfig = { ...config, trials: numTrials, roundsPerTrial: roundsOverride };

  console.log('');
  console.log('================================================================');
  console.log('  STATISTICAL MARKET SIMULATION');
  console.log('================================================================');
  console.log(`  Trials: ${numTrials}`);
  console.log(`  Rounds per trial: ${roundsOverride}`);
  console.log(`  Total market-rounds: ${(numTrials * roundsOverride).toLocaleString()}`);
  console.log(`  Participants per trial: ${runConfig.agents} agents, ${runConfig.initialProviders} providers, ${runConfig.initialAttackers} attackers, ${runConfig.initialVerifiers} verifiers`);
  console.log('================================================================');
  console.log('');

  const trialResults = [];
  const failedTrials = [];
  const startTime = Date.now();

  for (let i = 0; i < numTrials; i++) {
    const trialStart = Date.now();
    process.stdout.write(`  Trial ${i + 1}/${numTrials}... `);

    try {
      const result = await runTrial(i, runConfig);
      trialResults.push(result);
      const elapsed = ((Date.now() - trialStart) / 1000).toFixed(1);
      console.log(`done (${elapsed}s) | Providers: ${result.finalProviderCount}, Attackers: ${result.finalAttackerCount}, Cache: ${(result.finalCacheHitRate * 100).toFixed(1)}%, Price: $${result.finalAvgPrice.toFixed(6)}`);
    } catch (err) {
      const elapsed = ((Date.now() - trialStart) / 1000).toFixed(1);
      console.log(`FAILED (${elapsed}s) — ${err.message}`);
      failedTrials.push({ trialId: i, error: err.message });
    }
  }

  const totalElapsed = Date.now() - startTime;

  console.log('');
  console.log('================================================================');
  console.log('  TRIALS COMPLETE');
  console.log(`  Successful: ${trialResults.length}/${numTrials}`);
  console.log(`  Failed: ${failedTrials.length}/${numTrials}`);
  console.log(`  Total time: ${(totalElapsed / 1000).toFixed(1)}s`);
  console.log('================================================================');

  if (failedTrials.length > 0) {
    console.log('\n  Failed trials:');
    for (const f of failedTrials) {
      console.log(`    Trial ${f.trialId}: ${f.error}`);
    }
  }

  if (trialResults.length === 0) {
    console.error('\n  No trials completed successfully. Cannot generate report.');
    process.exit(1);
  }

  console.log('\n  Generating statistical report...');
  const reportPath = writeReport(trialResults, runConfig, totalElapsed);
  console.log(`  Report written to: ${reportPath}`);
  console.log('');
}

main().catch(err => {
  console.error('Statistical simulation failed:', err);
  process.exit(1);
});
