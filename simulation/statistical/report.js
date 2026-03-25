'use strict';

const fs = require('fs');
const path = require('path');
const stats = require('./stats');

/**
 * Generate a comprehensive statistical report from multiple trial results.
 */
function generateReport(trialResults, config, elapsed) {
  const n = trialResults.length;
  const lines = [];

  lines.push('# Statistical Simulation Results');
  lines.push(`**Date:** ${new Date().toISOString().slice(0, 10)}`);
  lines.push(`**Trials completed:** ${n}/${config.trials}`);
  lines.push(`**Rounds per trial:** ${config.roundsPerTrial}`);
  lines.push(`**Total market-rounds:** ${n * config.roundsPerTrial}`);
  lines.push(`**Runtime:** ${(elapsed / 1000).toFixed(1)}s (${(elapsed / 1000 / n).toFixed(1)}s per trial)`);
  lines.push(`**Participants per trial:** ${config.agents} agents, ${config.initialProviders} providers, ${config.initialAttackers} attackers, ${config.initialVerifiers} verifiers`);
  if (n < config.trials) {
    lines.push(`\n> **NOTE:** Only ${n}/${config.trials} trials completed. Some results may have wider confidence intervals than expected.`);
  }
  if (n < 5) {
    lines.push(`\n> **WARNING:** Fewer than 5 trials — statistical significance is limited. Results are directional only.`);
  }
  lines.push('');

  // ────────────────────────────────────────────
  // 1. SAMPLE SIZE & POWER
  // ────────────────────────────────────────────
  lines.push('---');
  lines.push('## 1. Sample Size & Power');
  lines.push('');

  const finalPrices = trialResults.map(r => r.finalAvgPrice);
  const priceSE = stats.standardError(finalPrices);
  lines.push(`- **Trials:** ${n}`);
  lines.push(`- **Rounds per trial:** ${config.roundsPerTrial}`);
  lines.push(`- **Total market-rounds:** ${(n * config.roundsPerTrial).toLocaleString()}`);
  lines.push(`- **Standard error of final price:** $${priceSE.toFixed(6)}`);

  const minTrialsNeeded = priceSE > 0 ? Math.ceil((stats.stddev(finalPrices) * 1.96 / (priceSE * Math.sqrt(n))) ** 2) : n;
  if (n < 30) {
    lines.push(`- **Note:** ${n} trials is below the standard 30 for CLT assumptions. SE may be underestimated.`);
  }
  lines.push('');

  // ────────────────────────────────────────────
  // 2. PRICE DYNAMICS
  // ────────────────────────────────────────────
  lines.push('---');
  lines.push('## 2. Price Dynamics');
  lines.push('');

  const priceCI = stats.confidenceInterval(finalPrices);
  lines.push(`- **Mean final price:** $${priceCI.mean.toFixed(6)} +/- $${priceCI.margin.toFixed(6)} (95% CI: [$${priceCI.lower.toFixed(6)}, $${priceCI.upper.toFixed(6)}])`);

  const priceConv = stats.priceConvergenceTest(trialResults.map(r => r.priceHistory));
  lines.push(`- **Price convergence:** ${priceConv.convergedCount}/${priceConv.totalTrials} trials converged (${(priceConv.convergenceRate * 100).toFixed(1)}%)`);
  if (priceConv.equilibrium) {
    lines.push(`- **Equilibrium price:** $${priceConv.equilibrium.mean.toFixed(6)} +/- $${priceConv.equilibrium.margin.toFixed(6)}`);
  }
  if (priceConv.convergenceRound) {
    lines.push(`- **Avg rounds to equilibrium:** ${priceConv.convergenceRound.mean.toFixed(0)} +/- ${priceConv.convergenceRound.margin.toFixed(0)}`);
  }
  lines.push('');

  // ASCII chart: price over time with CI band
  const priceBand = stats.confidenceBandTimeSeries(trialResults.map(r => r.priceHistory));
  lines.push('### Average Price Over Time (with 95% CI band)');
  lines.push('```');
  lines.push(asciiChartWithBand(priceBand, config.roundsPerTrial, 'Price ($)', 70, 15));
  lines.push('```');
  lines.push('');

  // ────────────────────────────────────────────
  // 3. MARKET SUSTAINABILITY
  // ────────────────────────────────────────────
  lines.push('---');
  lines.push('## 3. Market Sustainability');
  lines.push('');

  const survivalRates = trialResults.map(r => r.survivingProviders / (r.survivingProviders + r.exitedProviders));
  const survCI = stats.confidenceInterval(survivalRates);
  lines.push(`- **Provider survival rate:** ${(survCI.mean * 100).toFixed(1)}% +/- ${(survCI.margin * 100).toFixed(1)}% (95% CI)`);

  const providerPnLs = trialResults.map(r => stats.mean(r.providerProfitability));
  const provPnLCI = stats.confidenceInterval(providerPnLs);
  lines.push(`- **Avg provider P&L at round ${config.roundsPerTrial}:** $${provPnLCI.mean.toFixed(4)} +/- $${provPnLCI.margin.toFixed(4)}`);

  const profitableTrials = trialResults.filter(r => {
    const profitable = r.providerProfitability.filter(p => p > 0).length;
    return profitable > r.providerProfitability.length * 0.5;
  }).length;
  lines.push(`- **Trials where >50% of providers profitable:** ${profitableTrials}/${n} (${(profitableTrials / n * 100).toFixed(1)}%)`);

  const provProfitTest = stats.tTest(providerPnLs, 0);
  lines.push(`- **t-test (provider profit != 0):** t=${provProfitTest.t.toFixed(3)}, p=${provProfitTest.pValue.toFixed(4)}, ${provProfitTest.significant ? 'SIGNIFICANT' : 'not significant'} (direction: ${provProfitTest.direction})`);
  lines.push('');

  // Provider count over time
  const provBand = stats.confidenceBandTimeSeries(trialResults.map(r => r.providerCountHistory));
  lines.push('### Provider Count Over Time');
  lines.push('```');
  lines.push(asciiChartWithBand(provBand, config.roundsPerTrial, 'Providers', 70, 10));
  lines.push('```');
  lines.push('');

  // ────────────────────────────────────────────
  // 4. ATTACK ECONOMICS
  // ────────────────────────────────────────────
  lines.push('---');
  lines.push('## 4. Attack Economics');
  lines.push('');

  const allExitTrials = trialResults.filter(r => r.finalAttackerCount === 0).length;
  lines.push(`- **Trials where all attackers exited:** ${allExitTrials}/${n} (${(allExitTrials / n * 100).toFixed(1)}%)`);

  const attackerExitRounds = trialResults.filter(r => r.roundsToAttackerExit !== null).map(r => r.roundsToAttackerExit);
  if (attackerExitRounds.length > 0) {
    const aeCI = stats.confidenceInterval(attackerExitRounds);
    lines.push(`- **Avg rounds to all-attacker exit:** ${aeCI.mean.toFixed(0)} +/- ${aeCI.margin.toFixed(0)} (${attackerExitRounds.length} trials)`);
  }

  const attackerPnLs = trialResults.map(r => stats.mean(r.attackerProfitability));
  const atkPnLCI = stats.confidenceInterval(attackerPnLs);
  lines.push(`- **Avg attacker P&L:** $${atkPnLCI.mean.toFixed(4)} +/- $${atkPnLCI.margin.toFixed(4)}`);

  const atkLossTest = stats.tTest(attackerPnLs, 0);
  lines.push(`- **t-test (attacker profit < 0):** t=${atkLossTest.t.toFixed(3)}, p=${atkLossTest.pValue.toFixed(4)}, ${atkLossTest.significant ? 'SIGNIFICANT' : 'not significant'} (direction: ${atkLossTest.direction})`);
  lines.push('');

  // Attack success rate over time
  const atkBand = stats.confidenceBandTimeSeries(trialResults.map(r => r.attackSuccessHistory));
  lines.push('### Attack Success Rate Over Time');
  lines.push('```');
  lines.push(asciiChartWithBand(atkBand, config.roundsPerTrial, 'Success Rate', 70, 10));
  lines.push('```');
  lines.push('');

  // ────────────────────────────────────────────
  // 5. CACHE EFFICIENCY
  // ────────────────────────────────────────────
  lines.push('---');
  lines.push('## 5. Cache Efficiency');
  lines.push('');

  const finalCacheRates = trialResults.map(r => r.finalCacheHitRate);
  const cacheCI = stats.confidenceInterval(finalCacheRates);
  lines.push(`- **Final cache hit rate:** ${(cacheCI.mean * 100).toFixed(1)}% +/- ${(cacheCI.margin * 100).toFixed(1)}% (95% CI)`);

  // Cache at different timepoints
  for (const t of [100, 250, 500, config.roundsPerTrial]) {
    const idx = t - 1;
    const vals = trialResults.map(r => idx < r.cacheHitHistory.length ? r.cacheHitHistory[idx] : null).filter(v => v !== null);
    if (vals.length > 0) {
      const ci = stats.confidenceInterval(vals);
      lines.push(`- **Cache hit rate at round ${t}:** ${(ci.mean * 100).toFixed(1)}% +/- ${(ci.margin * 100).toFixed(1)}%`);
    }
  }

  const wasteSaved = trialResults.map(r => r.totalWasteReduction);
  const wasteCI = stats.confidenceInterval(wasteSaved);
  lines.push(`- **Total waste reduction (tokens saved):** $${wasteCI.mean.toFixed(4)} +/- $${wasteCI.margin.toFixed(4)}`);

  const cacheTrend = stats.cacheEfficiencyTrend(trialResults.map(r => r.cacheHitHistory));
  lines.push(`- **Cache trend:** ${cacheTrend.increasing ? 'INCREASING' : 'NOT INCREASING'} (slope: ${cacheTrend.slope.toFixed(8)}, first half: ${(cacheTrend.firstHalfMean * 100).toFixed(1)}%, second half: ${(cacheTrend.secondHalfMean * 100).toFixed(1)}%)`);
  lines.push('');

  const cacheBand = stats.confidenceBandTimeSeries(trialResults.map(r => r.cacheHitHistory));
  lines.push('### Cache Hit Rate Over Time');
  lines.push('```');
  lines.push(asciiChartWithBand(cacheBand, config.roundsPerTrial, 'Hit Rate', 70, 12));
  lines.push('```');
  lines.push('');

  // ────────────────────────────────────────────
  // 6. CONSUMER WELFARE
  // ────────────────────────────────────────────
  lines.push('---');
  lines.push('## 6. Consumer Welfare');
  lines.push('');

  const satisfactions = trialResults.map(r => stats.mean(r.agentSatisfactions));
  const satCI = stats.confidenceInterval(satisfactions);
  lines.push(`- **Agent satisfaction at round ${config.roundsPerTrial}:** ${satCI.mean.toFixed(3)} +/- ${satCI.margin.toFixed(3)} (95% CI)`);

  // Savings vs self-crawling
  const totalPurchases = trialResults.map(r => r.totalPurchases);
  const purchaseCI = stats.confidenceInterval(totalPurchases);
  lines.push(`- **Avg total purchases per trial:** ${purchaseCI.mean.toFixed(0)} +/- ${purchaseCI.margin.toFixed(0)}`);

  const badExpRates = trialResults.map(r => {
    const totalBad = r.agentBadExperiences.reduce((a, b) => a + b, 0);
    return r.totalPurchases > 0 ? totalBad / r.totalPurchases : 0;
  });
  const badCI = stats.confidenceInterval(badExpRates);
  lines.push(`- **Quality failure rate:** ${(badCI.mean * 100).toFixed(2)}% +/- ${(badCI.margin * 100).toFixed(2)}%`);

  const satAbove80Test = stats.tTest(satisfactions, 0.8);
  lines.push(`- **t-test (satisfaction > 0.8):** t=${satAbove80Test.t.toFixed(3)}, p=${satAbove80Test.pValue.toFixed(4)}, ${satAbove80Test.significant ? 'SIGNIFICANT' : 'not significant'} (direction: ${satAbove80Test.direction})`);
  lines.push('');

  // Satisfaction over time
  const satBand = stats.confidenceBandTimeSeries(trialResults.map(r => r.agentSatisfactionHistory));
  lines.push('### Consumer Satisfaction Over Time');
  lines.push('```');
  lines.push(asciiChartWithBand(satBand, config.roundsPerTrial, 'Satisfaction', 70, 10));
  lines.push('```');
  lines.push('');

  // ────────────────────────────────────────────
  // 7. MARKET STRUCTURE
  // ────────────────────────────────────────────
  lines.push('---');
  lines.push('## 7. Market Structure');
  lines.push('');

  const hhiValues = trialResults.map(r => stats.hhi(r.providerSales));
  const hhiCI = stats.confidenceInterval(hhiValues);
  lines.push(`- **HHI at maturity:** ${hhiCI.mean.toFixed(0)} +/- ${hhiCI.margin.toFixed(0)} (${hhiCI.mean < 1500 ? 'COMPETITIVE' : hhiCI.mean < 2500 ? 'MODERATE' : 'CONCENTRATED'})`);

  const finalProvCounts = trialResults.map(r => r.finalProviderCount);
  const provCountCI = stats.confidenceInterval(finalProvCounts);
  lines.push(`- **Avg provider count at end:** ${provCountCI.mean.toFixed(1)} +/- ${provCountCI.margin.toFixed(1)}`);

  const newEntrants = trialResults.map(r => r.newEntrants);
  const entrantCI = stats.confidenceInterval(newEntrants);
  lines.push(`- **Avg new entrants per trial:** ${entrantCI.mean.toFixed(1)} +/- ${entrantCI.margin.toFixed(1)}`);

  const exitedProviders = trialResults.map(r => r.exitedProviders);
  const exitCI = stats.confidenceInterval(exitedProviders);
  lines.push(`- **Avg exits per trial:** ${exitCI.mean.toFixed(1)} +/- ${exitCI.margin.toFixed(1)}`);
  lines.push('');

  // ────────────────────────────────────────────
  // 8. THE 7 KEY QUESTIONS
  // ────────────────────────────────────────────
  lines.push('---');
  lines.push('## 8. The 7 Key Questions — Statistical Answers');
  lines.push('');

  // Q1: Does the market self-correct?
  lines.push('### Q1: Does the market self-correct?');
  lines.push(`- **Answer:** ${priceConv.convergenceRate > 0.5 ? 'YES' : priceConv.convergenceRate > 0.25 ? 'PARTIALLY' : 'NO'}`);
  lines.push(`- **Evidence:** Price converged in ${(priceConv.convergenceRate * 100).toFixed(1)}% of trials (${priceConv.convergedCount}/${priceConv.totalTrials})`);
  if (priceConv.equilibrium) {
    lines.push(`- **Equilibrium:** $${priceConv.equilibrium.mean.toFixed(6)} (95% CI: [$${priceConv.equilibrium.lower.toFixed(6)}, $${priceConv.equilibrium.upper.toFixed(6)}])`);
  }
  lines.push(`- **Confidence:** ${priceConv.convergenceRate > 0.7 ? 'HIGH' : priceConv.convergenceRate > 0.4 ? 'MODERATE' : 'LOW'}`);
  lines.push('');

  // Q2: Do attacks become unprofitable?
  lines.push('### Q2: Do attacks become unprofitable?');
  lines.push(`- **Answer:** ${atkLossTest.significant && atkLossTest.direction === 'less' ? 'YES' : 'UNCERTAIN'}`);
  lines.push(`- **Evidence:** Attacker P&L = $${atkPnLCI.mean.toFixed(4)} (p=${atkLossTest.pValue.toFixed(4)})`);
  lines.push(`- **All attackers exited:** ${allExitTrials}/${n} trials (${(allExitTrials / n * 100).toFixed(1)}%)`);
  lines.push(`- **Confidence:** ${atkLossTest.pValue < 0.01 ? 'HIGH' : atkLossTest.pValue < 0.05 ? 'MODERATE' : 'LOW'}`);
  lines.push('');

  // Q3: Do long-term costs decrease?
  const earlyPrices = trialResults.map(r => stats.mean(r.priceHistory.slice(50, 150)));
  const latePrices = trialResults.map(r => stats.mean(r.priceHistory.slice(-100)));
  const priceDeclineTest = stats.pairedTTest(earlyPrices, latePrices);
  lines.push('### Q3: Do long-term costs decrease?');
  lines.push(`- **Answer:** ${priceDeclineTest.significant && priceDeclineTest.direction === 'less' ? 'YES' : priceDeclineTest.significant && priceDeclineTest.direction === 'greater' ? 'NO — PRICES INCREASED' : 'UNCERTAIN'}`);
  lines.push(`- **Evidence:** Round 50-150 avg: $${stats.mean(earlyPrices).toFixed(6)}, Round ${config.roundsPerTrial - 99}-${config.roundsPerTrial} avg: $${stats.mean(latePrices).toFixed(6)} (paired t-test p=${priceDeclineTest.pValue.toFixed(4)})`);
  lines.push(`- **Confidence:** ${priceDeclineTest.pValue < 0.01 ? 'HIGH' : priceDeclineTest.pValue < 0.05 ? 'MODERATE' : 'LOW'}`);
  lines.push('');

  // Q4: Does creative destruction work?
  lines.push('### Q4: Does creative destruction work?');
  const hasChurn = trialResults.filter(r => r.exitedProviders > 0 || r.newEntrants > 0).length;
  lines.push(`- **Answer:** ${hasChurn > n * 0.7 ? 'YES' : hasChurn > n * 0.3 ? 'PARTIALLY' : 'NO'}`);
  lines.push(`- **Evidence:** ${hasChurn}/${n} trials showed provider churn. Avg exits: ${exitCI.mean.toFixed(1)} +/- ${exitCI.margin.toFixed(1)}, Avg new entrants: ${entrantCI.mean.toFixed(1)} +/- ${entrantCI.margin.toFixed(1)}`);
  lines.push(`- **Confidence:** ${hasChurn > n * 0.8 ? 'HIGH' : 'MODERATE'}`);
  lines.push('');

  // Q5: Does verification scale with threats?
  const attackRateByTrial = trialResults.map(r => stats.mean(r.attackSuccessHistory));
  const verifierCountByTrial = trialResults.map(r => stats.mean(r.verifierCountHistory));
  const verAttackCorr = stats.correlation(attackRateByTrial, verifierCountByTrial);
  lines.push('### Q5: Does verification scale with threats?');
  lines.push(`- **Answer:** ${Math.abs(verAttackCorr) > 0.3 ? 'YES' : 'WEAK/UNCERTAIN'}`);
  lines.push(`- **Evidence:** Correlation between attack rate and verifier count: r=${verAttackCorr.toFixed(3)}`);
  lines.push(`- **Confidence:** ${Math.abs(verAttackCorr) > 0.5 ? 'HIGH' : Math.abs(verAttackCorr) > 0.2 ? 'MODERATE' : 'LOW'}`);
  lines.push('');

  // Q6: Does cache reduce waste?
  lines.push('### Q6: Does cache reduce waste?');
  lines.push(`- **Answer:** ${cacheTrend.increasing ? 'YES' : 'NO'}`);
  lines.push(`- **Evidence:** Cache trend slope: ${cacheTrend.slope.toFixed(8)}, First half avg: ${(cacheTrend.firstHalfMean * 100).toFixed(1)}%, Second half avg: ${(cacheTrend.secondHalfMean * 100).toFixed(1)}%`);
  lines.push(`- **Waste reduction:** $${wasteCI.mean.toFixed(4)} +/- $${wasteCI.margin.toFixed(4)} saved per trial`);
  lines.push(`- **Confidence:** ${cacheTrend.increasing && cacheCI.lower > 0.3 ? 'HIGH' : 'MODERATE'}`);
  lines.push('');

  // Q7: Is final state better than initial?
  const earlySat = trialResults.map(r => stats.mean(r.agentSatisfactionHistory.slice(0, 50)));
  const lateSat = trialResults.map(r => stats.mean(r.agentSatisfactionHistory.slice(-50)));
  const satImprovTest = stats.pairedTTest(earlySat, lateSat);
  lines.push('### Q7: Is final state better than initial?');
  lines.push(`- **Answer:** ${satImprovTest.significant && satImprovTest.direction === 'greater' ? 'YES' : 'UNCERTAIN'}`);
  lines.push(`- **Evidence:** Early satisfaction: ${stats.mean(earlySat).toFixed(3)}, Late satisfaction: ${stats.mean(lateSat).toFixed(3)} (paired t-test p=${satImprovTest.pValue.toFixed(4)})`);
  lines.push(`- **Confidence:** ${satImprovTest.pValue < 0.01 ? 'HIGH' : satImprovTest.pValue < 0.05 ? 'MODERATE' : 'LOW'}`);
  lines.push('');

  // ────────────────────────────────────────────
  // 9. OVERALL VERDICT
  // ────────────────────────────────────────────
  lines.push('---');
  lines.push('## 9. Overall Verdict');
  lines.push('');

  const q1pass = priceConv.convergenceRate > 0.5;
  const q2pass = atkLossTest.significant && atkLossTest.direction === 'less';
  const q3pass = priceDeclineTest.significant && priceDeclineTest.direction === 'less';
  const q4pass = hasChurn > n * 0.5;
  const q5pass = Math.abs(verAttackCorr) > 0.2;
  const q6pass = cacheTrend.increasing;
  const q7pass = satImprovTest.significant && satImprovTest.direction === 'greater';
  const qResults = [q1pass, q2pass, q3pass, q4pass, q5pass, q6pass, q7pass];
  const score = qResults.filter(Boolean).length;
  const grade = score >= 6 ? 'A' : score >= 5 ? 'B+' : score >= 4 ? 'B' : score >= 3 ? 'C+' : score >= 2 ? 'C' : 'D';

  lines.push(`### Grade: ${grade} (${score}/7 questions answered with statistical significance)`);
  lines.push('');
  lines.push('| # | Question | Result | Confidence |');
  lines.push('|---|----------|--------|------------|');
  const qLabels = [
    'Market self-corrects', 'Attacks unprofitable', 'Costs decrease',
    'Creative destruction', 'Verification scales', 'Cache reduces waste',
    'Final > Initial',
  ];
  const qConfidences = [
    priceConv.convergenceRate > 0.7 ? 'HIGH' : 'MODERATE',
    atkLossTest.pValue < 0.01 ? 'HIGH' : atkLossTest.pValue < 0.05 ? 'MODERATE' : 'LOW',
    priceDeclineTest.pValue < 0.01 ? 'HIGH' : priceDeclineTest.pValue < 0.05 ? 'MODERATE' : 'LOW',
    hasChurn > n * 0.8 ? 'HIGH' : 'MODERATE',
    Math.abs(verAttackCorr) > 0.5 ? 'HIGH' : 'MODERATE',
    cacheTrend.increasing && cacheCI.lower > 0.3 ? 'HIGH' : 'MODERATE',
    satImprovTest.pValue < 0.01 ? 'HIGH' : satImprovTest.pValue < 0.05 ? 'MODERATE' : 'LOW',
  ];
  for (let i = 0; i < 7; i++) {
    lines.push(`| ${i + 1} | ${qLabels[i]} | ${qResults[i] ? 'PASS' : 'FAIL'} | ${qConfidences[i]} |`);
  }
  lines.push('');

  lines.push('### What we can say with >95% confidence:');
  const highConf = [];
  if (q2pass && atkLossTest.pValue < 0.05) highConf.push(`Attacker P&L is negative ($${atkPnLCI.mean.toFixed(4)}, p=${atkLossTest.pValue.toFixed(4)})`);
  if (priceCI.margin > 0) highConf.push(`Final price is in the range [$${priceCI.lower.toFixed(6)}, $${priceCI.upper.toFixed(6)}]`);
  if (cacheCI.margin > 0) highConf.push(`Final cache hit rate is ${(cacheCI.lower * 100).toFixed(1)}%-${(cacheCI.upper * 100).toFixed(1)}%`);
  if (survCI.margin > 0) highConf.push(`Provider survival rate is ${(survCI.lower * 100).toFixed(1)}%-${(survCI.upper * 100).toFixed(1)}%`);
  if (highConf.length === 0) highConf.push('Limited conclusions due to small sample size');
  for (const c of highConf) lines.push(`- ${c}`);
  lines.push('');

  lines.push('### What we are uncertain about:');
  const uncertain = [];
  if (!q1pass) uncertain.push('Price convergence — only seen in some trials');
  if (!q3pass) uncertain.push('Long-term cost decrease — insufficient evidence');
  if (!q5pass) uncertain.push('Verification scaling — weak correlation with threat levels');
  if (!q7pass) uncertain.push('Overall improvement — satisfaction improvement not statistically significant');
  if (uncertain.length === 0) uncertain.push('Nothing major — all key questions have clear answers');
  for (const u of uncertain) lines.push(`- ${u}`);
  lines.push('');

  if (n < 30) {
    lines.push('### What would need more trials:');
    const targetTrials = Math.max(30, config.trials);
    lines.push(`- Running ${targetTrials} trials (vs current ${n}) would reduce confidence intervals by ~${((1 - Math.sqrt(n / targetTrials)) * 100).toFixed(0)}%`);
    lines.push(`- Metrics with high variance (price, provider count) would benefit most from more trials`);
    lines.push('');
  }

  return lines.join('\n');
}

// ── ASCII Chart with Confidence Band ──

function asciiChartWithBand(band, totalRounds, title, width, height) {
  const { mean: means, lower, upper } = band;
  if (!means || means.length === 0) return '(no data)';

  const allVals = [...means, ...lower, ...upper].filter(v => isFinite(v));
  const min = Math.min(...allVals);
  const max = Math.max(...allVals);
  const range = max - min || 1;

  // Sample to fit width
  const step = Math.max(1, Math.floor(means.length / width));
  const sMean = [], sLow = [], sHigh = [];
  for (let i = 0; i < means.length; i += step) {
    sMean.push(means[i]);
    sLow.push(lower[i]);
    sHigh.push(upper[i]);
  }

  const w = Math.min(sMean.length, width);
  const lines = [];
  lines.push(`  ${title}`);

  for (let row = height - 1; row >= 0; row--) {
    const threshold = min + (range * row / (height - 1));
    let line = row === height - 1
      ? `${max.toFixed(4).padStart(8)} |`
      : row === 0
        ? `${min.toFixed(4).padStart(8)} |`
        : '         |';

    for (let col = 0; col < w; col++) {
      const mNorm = (sMean[col] - min) / range * (height - 1);
      const lNorm = (sLow[col] - min) / range * (height - 1);
      const hNorm = (sHigh[col] - min) / range * (height - 1);

      if (Math.abs(mNorm - row) < 0.5) {
        line += '*';
      } else if (row >= lNorm - 0.5 && row <= hNorm + 0.5) {
        line += '.';
      } else {
        line += ' ';
      }
    }
    lines.push(line);
  }

  lines.push('         +' + '-'.repeat(w));
  lines.push(`         ${String(1).padStart(3)}${' '.repeat(Math.max(0, w - 6))}${String(totalRounds).padStart(3)}`);
  lines.push('         (* = mean, . = 95% CI band)');

  return lines.join('\n');
}

function writeReport(trialResults, config, elapsed) {
  const report = generateReport(trialResults, config, elapsed);
  const outDir = path.join(__dirname, '..', 'logs');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'statistical-results.md');
  fs.writeFileSync(outPath, report, 'utf8');
  return outPath;
}

module.exports = { generateReport, writeReport };
