'use strict';

// ANSI color codes — no external deps
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

/**
 * Format a price as a dollar string.
 * @param {number} val
 * @returns {string}
 */
function price(val) {
  if (val === null || val === undefined) return '-';
  const n = parseFloat(val);
  if (isNaN(n)) return '-';
  if (n === 0) return '$0';
  if (n < 0.01) return '$' + n.toFixed(4);
  if (n < 1) return '$' + n.toFixed(3);
  return '$' + n.toFixed(2);
}

/**
 * Format a number as a percentage string.
 * @param {number} val - decimal (0.70 = 70%)
 * @returns {string}
 */
function percent(val) {
  if (val === null || val === undefined) return '-';
  return (parseFloat(val) * 100).toFixed(0) + '%';
}

/**
 * Print a table from an array of row objects.
 * @param {string[]} headers - column names
 * @param {Array<Array<string>>} rows - 2D array of cell values
 */
function table(headers, rows) {
  if (!rows || rows.length === 0) {
    console.log(c.dim + '  (no results)' + c.reset);
    return;
  }

  // Calculate column widths
  const widths = headers.map((h, i) => {
    const maxData = rows.reduce((max, row) => Math.max(max, String(row[i] || '').length), 0);
    return Math.max(h.length, maxData);
  });

  // Header
  const headerLine = headers.map((h, i) => h.padEnd(widths[i])).join('  ');
  console.log(c.bold + '  ' + headerLine + c.reset);
  console.log(c.dim + '  ' + widths.map(w => '-'.repeat(w)).join('  ') + c.reset);

  // Rows
  for (const row of rows) {
    const line = row.map((cell, i) => String(cell || '').padEnd(widths[i])).join('  ');
    console.log('  ' + line);
  }
}

/**
 * Print a key-value block.
 * @param {Array<[string, string]>} pairs
 */
function kvBlock(pairs) {
  const maxKey = pairs.reduce((max, [k]) => Math.max(max, k.length), 0);
  for (const [key, val] of pairs) {
    console.log(`  ${c.bold}${key.padEnd(maxKey)}${c.reset}  ${val}`);
  }
}

/**
 * Print a success message.
 * @param {string} msg
 */
function success(msg) {
  console.log(`${c.green}${c.bold}  OK${c.reset}  ${msg}`);
}

/**
 * Print an error message.
 * @param {string} msg
 */
function error(msg) {
  console.log(`${c.red}${c.bold}  ERR${c.reset} ${msg}`);
}

/**
 * Print an info message.
 * @param {string} msg
 */
function info(msg) {
  console.log(`${c.cyan}  >>${c.reset} ${msg}`);
}

module.exports = { c, price, percent, table, kvBlock, success, error, info };
