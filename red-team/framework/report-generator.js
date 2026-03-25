'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Generate a markdown report from suite results.
 */
function generateReport(suiteResults, suiteName, outputPath) {
  const { results, summary, durationMs } = suiteResults;
  const timestamp = new Date().toISOString();

  let md = `# Red Team Report: Suite ${suiteName.toUpperCase()}\n\n`;
  md += `**Date:** ${timestamp}\n`;
  md += `**Duration:** ${(durationMs / 1000).toFixed(1)}s\n\n`;

  // Summary table
  md += `## Summary\n\n`;
  md += `| Metric | Value |\n`;
  md += `|--------|-------|\n`;
  md += `| Total tests | ${summary.total} |\n`;
  md += `| Passed | ${summary.passed} |\n`;
  md += `| Failed | ${summary.failed} |\n`;
  md += `| Errors | ${summary.errors} |\n`;
  md += `| Overall | ${summary.failed === 0 && summary.errors === 0 ? 'ALL PASS' : 'VULNERABILITIES FOUND'} |\n\n`;

  // Results table
  md += `## Test Results\n\n`;
  md += `| ID | Name | Result | Severity | Metric | Threshold |\n`;
  md += `|----|------|--------|----------|--------|----------|\n`;

  for (const r of results) {
    const status = r.pass === true ? 'PASS' : r.pass === false ? '**FAIL**' : 'ERROR';
    const severity = r.severity || '-';
    const metric = r.metric !== null && r.metric !== undefined ? String(r.metric) : '-';
    const threshold = r.threshold !== null && r.threshold !== undefined ? String(r.threshold) : '-';
    md += `| ${r.id} | ${r.name} | ${status} | ${severity} | ${metric} | ${threshold} |\n`;
  }

  md += `\n`;

  // Detailed results
  md += `## Detailed Results\n\n`;
  for (const r of results) {
    const status = r.pass === true ? 'PASS' : r.pass === false ? 'FAIL' : 'ERROR';
    md += `### ${r.id}: ${r.name}\n\n`;
    md += `- **Hypothesis:** ${r.hypothesis}\n`;
    md += `- **Result:** ${status}\n`;
    md += `- **Severity:** ${r.severity || 'N/A'}\n`;
    md += `- **Metric:** ${r.metric !== null && r.metric !== undefined ? r.metric : 'N/A'}\n`;
    md += `- **Threshold:** ${r.threshold !== null && r.threshold !== undefined ? r.threshold : 'N/A'}\n`;
    md += `- **Details:** ${r.details}\n`;
    md += `- **Duration:** ${r.durationMs}ms\n`;
    if (r.errors && r.errors.length > 0) {
      md += `- **Errors:** ${r.errors.map(e => e.error || JSON.stringify(e)).join('; ')}\n`;
    }
    md += `\n`;
  }

  // Vulnerabilities section
  const vulnerabilities = results.filter(r => r.pass === false);
  if (vulnerabilities.length > 0) {
    md += `## Vulnerabilities Discovered\n\n`;
    for (const v of vulnerabilities) {
      md += `### ${v.id}: ${v.name}\n\n`;
      md += `- **Severity:** ${v.severity}\n`;
      md += `- **Evidence:** ${v.details}\n`;
      md += `- **Metric:** ${v.metric}\n`;
      md += `\n`;
    }
  }

  // Recommendations
  md += `## Recommendations\n\n`;
  if (vulnerabilities.length === 0) {
    md += `All tests passed. The API defenses held against Suite ${suiteName.toUpperCase()} attack patterns.\n\n`;
    md += `Continue monitoring with the full profile (30 trials) for higher confidence.\n`;
  } else {
    for (const v of vulnerabilities) {
      md += `- **${v.id}:** ${v.details}\n`;
    }
    md += `\nAddress the above vulnerabilities before production deployment.\n`;
  }

  // Write file
  if (outputPath) {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outputPath, md, 'utf-8');
  }

  return md;
}

module.exports = { generateReport };
