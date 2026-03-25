'use strict';

const path = require('path');
const stats = require('../../simulation/statistical/stats');

/**
 * Collects per-round and per-event metrics for red team scenarios.
 */
class MetricsCollector {
  constructor() {
    this.metrics = {};  // { metricName: [{ value, round, timestamp }] }
  }

  /**
   * Record a data point.
   */
  record(metricName, value, round = null) {
    if (!this.metrics[metricName]) {
      this.metrics[metricName] = [];
    }
    this.metrics[metricName].push({
      value,
      round,
      timestamp: Date.now(),
    });
  }

  /**
   * Get time series of values for a metric.
   */
  getTimeSeries(metricName) {
    const entries = this.metrics[metricName] || [];
    return entries.map(e => e.value);
  }

  /**
   * Compute summary statistics for all metrics.
   */
  getSummary() {
    const summary = {};
    for (const [name, entries] of Object.entries(this.metrics)) {
      const values = entries.map(e => e.value);
      if (values.length === 0) {
        summary[name] = { count: 0, mean: 0, median: 0, stddev: 0, ci: null };
        continue;
      }
      summary[name] = {
        count: values.length,
        mean: stats.mean(values),
        median: stats.median(values),
        stddev: stats.stddev(values),
        min: Math.min(...values),
        max: Math.max(...values),
        ci: values.length >= 2 ? stats.confidenceInterval(values) : null,
      };
    }
    return summary;
  }

  /**
   * Export all data to a plain object for JSON serialization.
   */
  toJSON() {
    const result = {};
    for (const [name, entries] of Object.entries(this.metrics)) {
      result[name] = entries;
    }
    return result;
  }

  /**
   * Reset all metrics.
   */
  reset() {
    this.metrics = {};
  }
}

module.exports = MetricsCollector;
