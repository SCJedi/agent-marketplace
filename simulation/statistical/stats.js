'use strict';

/**
 * Statistical analysis functions for market simulation data.
 * All functions are pure — no side effects, no I/O.
 */

// ── Basic Statistics ──

function mean(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function median(arr) {
  if (!arr || arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function stddev(arr) {
  if (!arr || arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((sum, x) => sum + (x - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function percentile(arr, p) {
  if (!arr || arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

function standardError(arr) {
  if (!arr || arr.length < 2) return 0;
  return stddev(arr) / Math.sqrt(arr.length);
}

// ── Confidence Intervals ──

/**
 * Returns { mean, lower, upper, margin, n, se }
 * Uses t-distribution critical values for small samples.
 */
function confidenceInterval(arr, confidence = 0.95) {
  if (!arr || arr.length < 2) {
    const m = arr && arr.length === 1 ? arr[0] : 0;
    return { mean: m, lower: m, upper: m, margin: 0, n: arr ? arr.length : 0, se: 0 };
  }
  const m = mean(arr);
  const se = standardError(arr);
  const tCrit = tCriticalValue(arr.length - 1, confidence);
  const margin = tCrit * se;
  return {
    mean: m,
    lower: m - margin,
    upper: m + margin,
    margin,
    n: arr.length,
    se,
  };
}

/**
 * Approximate t-distribution critical value.
 * Uses Abramowitz and Stegun approximation for df >= 3, exact for common values.
 */
function tCriticalValue(df, confidence) {
  // Common critical values for 95% confidence (two-tailed)
  const t95 = {
    1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571,
    6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228,
    15: 2.131, 20: 2.086, 25: 2.060, 29: 2.045, 30: 2.042,
    40: 2.021, 60: 2.000, 120: 1.980,
  };
  const t99 = {
    1: 63.657, 2: 9.925, 3: 5.841, 4: 4.604, 5: 4.032,
    10: 3.169, 20: 2.845, 29: 2.756, 30: 2.750, 60: 2.660, 120: 2.617,
  };

  const table = confidence >= 0.99 ? t99 : t95;

  if (table[df]) return table[df];

  // Find nearest
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  for (let i = 0; i < keys.length - 1; i++) {
    if (df >= keys[i] && df <= keys[i + 1]) {
      // Linear interpolation
      const frac = (df - keys[i]) / (keys[i + 1] - keys[i]);
      return table[keys[i]] * (1 - frac) + table[keys[i + 1]] * frac;
    }
  }

  // For very large df, use z-value
  return confidence >= 0.99 ? 2.576 : 1.96;
}

// ── Distribution ──

function histogram(arr, bins = 10) {
  if (!arr || arr.length === 0) return [];
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  const range = max - min || 1;
  const binWidth = range / bins;

  const result = [];
  for (let i = 0; i < bins; i++) {
    result.push({
      binStart: min + i * binWidth,
      binEnd: min + (i + 1) * binWidth,
      count: 0,
    });
  }

  for (const val of arr) {
    let idx = Math.floor((val - min) / binWidth);
    if (idx >= bins) idx = bins - 1;
    result[idx].count++;
  }

  return result;
}

// ── Time Series Analysis ──

/**
 * Average multiple time series at each time step.
 * Arrays can be different lengths — uses only overlapping region.
 */
function averageTimeSeries(arrayOfArrays) {
  if (!arrayOfArrays || arrayOfArrays.length === 0) return [];
  const maxLen = Math.max(...arrayOfArrays.map(a => a.length));
  const result = [];
  for (let t = 0; t < maxLen; t++) {
    const vals = arrayOfArrays.filter(a => t < a.length).map(a => a[t]);
    result.push(vals.length > 0 ? mean(vals) : 0);
  }
  return result;
}

/**
 * Returns { mean: [...], lower: [...], upper: [...] }
 * 95% CI band at each time step.
 */
function confidenceBandTimeSeries(arrayOfArrays, confidence = 0.95) {
  if (!arrayOfArrays || arrayOfArrays.length === 0) {
    return { mean: [], lower: [], upper: [] };
  }
  const maxLen = Math.max(...arrayOfArrays.map(a => a.length));
  const means = [];
  const lowers = [];
  const uppers = [];

  for (let t = 0; t < maxLen; t++) {
    const vals = arrayOfArrays.filter(a => t < a.length).map(a => a[t]);
    if (vals.length < 2) {
      const m = vals.length === 1 ? vals[0] : 0;
      means.push(m);
      lowers.push(m);
      uppers.push(m);
    } else {
      const ci = confidenceInterval(vals, confidence);
      means.push(ci.mean);
      lowers.push(ci.lower);
      uppers.push(ci.upper);
    }
  }

  return { mean: means, lower: lowers, upper: uppers };
}

// ── Convergence Tests ──

/**
 * Do prices converge across trials?
 * Checks if the last 100 rounds have significantly lower variance than the first 100.
 */
function priceConvergenceTest(priceHistories) {
  const convergenceResults = [];
  let convergedCount = 0;
  const equilibria = [];
  const convergenceRounds = [];

  for (const prices of priceHistories) {
    if (prices.length < 200) {
      convergenceResults.push(false);
      continue;
    }

    const last100 = prices.slice(-100);
    const first100 = prices.slice(0, 100);

    const lastStd = stddev(last100);
    const firstStd = stddev(first100);

    // Converged if final variance is < 50% of initial variance
    const converged = lastStd < firstStd * 0.5 || lastStd < 0.0001;
    convergenceResults.push(converged);

    if (converged) {
      convergedCount++;
      equilibria.push(mean(last100));

      // Find convergence round — first 50-round window with std < threshold
      const threshold = lastStd * 2;
      let convRound = null;
      for (let r = 50; r < prices.length - 50; r += 10) {
        const window = prices.slice(r, r + 50);
        if (stddev(window) < threshold) {
          convRound = r;
          break;
        }
      }
      if (convRound !== null) convergenceRounds.push(convRound);
    }
  }

  return {
    converges: convergedCount > priceHistories.length * 0.5,
    convergenceRate: convergedCount / priceHistories.length,
    convergedCount,
    totalTrials: priceHistories.length,
    equilibrium: equilibria.length > 0 ? confidenceInterval(equilibria) : null,
    convergenceRound: convergenceRounds.length > 0 ? confidenceInterval(convergenceRounds) : null,
  };
}

/**
 * Is cache hit rate monotonically increasing (on average)?
 * Returns trend statistics.
 */
function cacheEfficiencyTrend(cacheHistories) {
  const avgSeries = averageTimeSeries(cacheHistories);
  if (avgSeries.length < 10) return { increasing: false, slope: 0 };

  // Simple linear regression on the average series
  const n = avgSeries.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += avgSeries[i];
    sumXY += i * avgSeries[i];
    sumX2 += i * i;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // Check if first half < second half (overall increasing)
  const firstHalf = mean(avgSeries.slice(0, Math.floor(n / 2)));
  const secondHalf = mean(avgSeries.slice(Math.floor(n / 2)));

  return {
    increasing: secondHalf > firstHalf,
    slope,
    intercept,
    firstHalfMean: firstHalf,
    secondHalfMean: secondHalf,
    finalValue: avgSeries[avgSeries.length - 1],
  };
}

// ── Hypothesis Testing ──

/**
 * One-sample t-test: is the sample mean significantly different from hypothesizedMean?
 * Returns { t, df, pValue, significant, direction }
 */
function tTest(sample, hypothesizedMean) {
  if (!sample || sample.length < 2) {
    return { t: 0, df: 0, pValue: 1, significant: false, direction: 'none' };
  }

  const m = mean(sample);
  const se = standardError(sample);
  const t = se > 0 ? (m - hypothesizedMean) / se : 0;
  const df = sample.length - 1;
  const pValue = tToPValue(Math.abs(t), df);

  return {
    t,
    df,
    pValue,
    significant: pValue < 0.05,
    direction: m > hypothesizedMean ? 'greater' : m < hypothesizedMean ? 'less' : 'none',
    sampleMean: m,
    sampleSE: se,
  };
}

/**
 * Paired t-test: are two conditions significantly different?
 */
function pairedTTest(before, after) {
  if (!before || !after || before.length !== after.length || before.length < 2) {
    return { t: 0, df: 0, pValue: 1, significant: false, direction: 'none' };
  }

  const diffs = before.map((b, i) => after[i] - b);
  return tTest(diffs, 0);
}

/**
 * Approximate p-value from t-statistic using the Beta incomplete function approximation.
 * Two-tailed p-value.
 */
function tToPValue(t, df) {
  // Use approximation: p ≈ 2 * (1 - Phi(t * sqrt(df/(df + t^2)) * correction))
  // This is the Abramowitz & Stegun approximation
  if (df <= 0 || t === 0) return 1;

  const x = df / (df + t * t);
  // Regularized incomplete beta function approximation
  // For large df, this approaches normal distribution
  if (df > 100) {
    // Use normal approximation
    return 2 * (1 - normalCDF(Math.abs(t)));
  }

  // Simple approximation using the relationship between t and F distributions
  // p = I_x(df/2, 1/2) where x = df/(df + t^2)
  // Use series expansion for the regularized beta
  const a = df / 2;
  const b = 0.5;
  let result = betaIncomplete(x, a, b);

  // Two-tailed
  return Math.min(1, Math.max(0, result));
}

/**
 * Standard normal CDF approximation (Abramowitz & Stegun 26.2.17)
 */
function normalCDF(x) {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);

  return 0.5 * (1.0 + sign * y);
}

/**
 * Regularized incomplete beta function I_x(a, b) — simple series approximation.
 */
function betaIncomplete(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  // Use continued fraction method for better convergence
  // For the t-distribution case (b=0.5), this is well-behaved
  const lbeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lbeta) / a;

  // Simple series: I_x(a,b) = x^a * (1-x)^b / (a * B(a,b)) * sum
  let sum = 1;
  let term = 1;
  for (let n = 1; n <= 200; n++) {
    term *= (n - b) * x / (a + n);
    sum += term;
    if (Math.abs(term) < 1e-10) break;
  }

  const result = front * sum;
  return Math.min(1, Math.max(0, result));
}

/**
 * Log-gamma function (Stirling approximation with correction terms)
 */
function lnGamma(x) {
  if (x <= 0) return 0;
  if (x < 0.5) {
    // Reflection formula
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  }
  x -= 1;
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  let sum = c[0];
  for (let i = 1; i < g + 2; i++) {
    sum += c[i] / (x + i);
  }
  const t = x + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(sum);
}

// ── Correlation ──

function correlation(x, y) {
  if (!x || !y || x.length !== y.length || x.length < 3) return 0;
  const mx = mean(x);
  const my = mean(y);
  let num = 0, denomX = 0, denomY = 0;
  for (let i = 0; i < x.length; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    num += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  const denom = Math.sqrt(denomX * denomY);
  return denom > 0 ? num / denom : 0;
}

// ── HHI (Herfindahl-Hirschman Index) ──

function hhi(marketShares) {
  if (!marketShares || marketShares.length === 0) return 0;
  const total = marketShares.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  return marketShares.reduce((sum, s) => sum + (s / total) ** 2, 0) * 10000;
}

module.exports = {
  mean, median, stddev, percentile, standardError,
  confidenceInterval, confidenceBandTimeSeries,
  histogram, averageTimeSeries,
  priceConvergenceTest, cacheEfficiencyTrend,
  tTest, pairedTTest, correlation, hhi,
};
