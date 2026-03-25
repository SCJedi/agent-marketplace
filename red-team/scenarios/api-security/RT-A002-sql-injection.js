'use strict';

const Scenario = require('../../framework/scenario');

/**
 * RT-A002: SQL Injection
 *
 * Hypothesis: Search endpoint is vulnerable to SQL injection.
 *
 * Attack: Submit OWASP SQLi cheat sheet payloads via GET /search?q=
 * Check for: server crashes (5xx), data leakage, unexpected results.
 *
 * Pass: Zero injection payloads cause errors or data leakage.
 * Fail: Any payload causes 5xx error or returns non-content data.
 */
class SqlInjection extends Scenario {
  constructor() {
    super(
      'RT-A002',
      'SQL Injection via Search',
      'Search endpoint is vulnerable to SQL injection'
    );
  }

  async setup(baseUrl) {
    // Seed some legitimate content so we can detect data leakage
    await this.fetch(baseUrl, '/publish/content', {
      method: 'POST',
      body: {
        url: 'https://example.com/legit-content',
        source_hash: 'legithash123',
        content_text: 'This is legitimate test content for SQL injection testing',
        provider_id: 'legit-provider',
        price: 0.001,
      },
    });

    // Seed a secret artifact to check if injection leaks it
    await this.fetch(baseUrl, '/publish/artifact', {
      method: 'POST',
      body: {
        name: 'Secret Artifact',
        slug: 'secret-artifact-sqli-test',
        description: 'SQLI_CANARY_TOKEN_12345',
        price: 999,
      },
    });
  }

  async execute(baseUrl, config) {
    // OWASP SQLi payloads — standard cheat sheet entries
    const payloads = [
      // Classic OR-based injection
      "' OR '1'='1",
      "' OR '1'='1' --",
      "' OR '1'='1' /*",
      "1' OR '1' = '1",
      "' OR 1=1 --",
      "' OR 1=1#",
      "admin' --",
      "admin' #",

      // UNION-based injection
      "' UNION SELECT 1,2,3,4,5,6,7,8,9,10,11,12,13 --",
      "' UNION SELECT sql,2,3,4,5,6,7,8,9,10,11,12,13 FROM sqlite_master --",
      "' UNION SELECT key,owner_id,3,4,5,6,7,8,9,10,11,12,13 FROM api_keys --",
      "' UNION ALL SELECT NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL --",

      // Boolean-based blind injection
      "' AND 1=1 --",
      "' AND 1=2 --",
      "' AND (SELECT COUNT(*) FROM api_keys) > 0 --",

      // Time-based blind injection (SQLite doesn't have SLEEP but these test parsing)
      "' AND (SELECT CASE WHEN 1=1 THEN 1 ELSE 0 END) --",

      // Stacked queries
      "'; DROP TABLE content; --",
      "'; DELETE FROM api_keys; --",
      "'; INSERT INTO api_keys VALUES ('hacked','hacker','admin'); --",

      // Error-based injection
      "' AND CAST(version() AS INT) --",
      "' AND 1=CONVERT(INT,(SELECT @@version)) --",

      // SQLite-specific
      "' AND sqlite_version() --",
      "' UNION SELECT sql,name,type,tbl_name,rootpage,'' FROM sqlite_master WHERE type='table' --",

      // Encoding tricks
      "%27%20OR%20%271%27%3D%271",
      "' OR ''='",
      "' OR 'x'='x",

      // Null byte injection
      "test%00' OR '1'='1",

      // Double encoding
      "%2527%2520OR%25201%253D1",

      // Comment injection
      "test'/**/OR/**/1=1--",

      // Nested injection
      "' OR (SELECT 1 FROM (SELECT 1) AS t WHERE 1=1) --",

      // Large payload
      "A".repeat(10000),

      // Unicode tricks
      "' \u004F\u0052 '1'='1",

      // Hex encoded
      "0x27204F5220273127",

      // Multi-line
      "'\nOR\n'1'='1",
      "'\rOR\r'1'='1",

      // Special characters
      "'; ATTACH DATABASE '/tmp/hack.db' AS hack; --",
      "' GLOB '*' --",
      "' LIKE '%' --",

      // JSON injection attempt
      '{"$ne": ""}',
      '{"$gt": ""}',

      // Command injection via SQL
      "'; .shell echo hacked; --",
      "'; .import /etc/passwd hack; --",

      // Empty / boundary
      "",
      "' ",
      "'",
      "''",
      "';",
    ];

    let serverErrors = 0;
    let dataLeaks = 0;
    let unexpectedResults = 0;
    const issues = [];

    for (let i = 0; i < payloads.length; i++) {
      const payload = payloads[i];
      const encodedPayload = encodeURIComponent(payload);

      const res = await this.fetch(baseUrl, `/search?q=${encodedPayload}`);

      // Check for server errors (5xx)
      if (res.status >= 500) {
        serverErrors++;
        issues.push({
          payloadIndex: i,
          payload: payload.slice(0, 100),
          status: res.status,
          type: 'server_error',
        });
        continue;
      }

      // Check for data leakage
      if (res.data && res.data.data && res.data.data.results) {
        const responseText = JSON.stringify(res.data.data.results);

        // Check if API keys leaked
        if (responseText.includes('api_key') && responseText.match(/[a-f0-9]{64}/)) {
          dataLeaks++;
          issues.push({
            payloadIndex: i,
            payload: payload.slice(0, 100),
            type: 'api_key_leak',
          });
        }

        // Check if sqlite_master data leaked
        if (responseText.includes('sqlite_master') || responseText.includes('CREATE TABLE')) {
          dataLeaks++;
          issues.push({
            payloadIndex: i,
            payload: payload.slice(0, 100),
            type: 'schema_leak',
          });
        }

        // Check if canary token leaked through injection (not through normal search)
        if (payload.includes('UNION') && responseText.includes('SQLI_CANARY_TOKEN_12345')) {
          dataLeaks++;
          issues.push({
            payloadIndex: i,
            payload: payload.slice(0, 100),
            type: 'data_leak_via_union',
          });
        }
      }
    }

    return {
      totalPayloads: payloads.length,
      serverErrors,
      dataLeaks,
      unexpectedResults,
      issues,
    };
  }

  assert(results) {
    const { serverErrors, dataLeaks, totalPayloads, issues } = results;
    const totalProblems = serverErrors + dataLeaks;

    if (totalProblems === 0) {
      return {
        pass: true,
        metric: 0,
        threshold: 0,
        details: `0/${totalPayloads} SQL injection payloads caused errors or data leakage. Search endpoint handles malicious input safely.`,
        severity: 'none',
      };
    }

    const parts = [];
    if (serverErrors > 0) parts.push(`${serverErrors} caused server errors (5xx)`);
    if (dataLeaks > 0) parts.push(`${dataLeaks} caused data leakage`);

    return {
      pass: false,
      metric: totalProblems,
      threshold: 0,
      details: `VULNERABILITY: ${parts.join(', ')} out of ${totalPayloads} payloads. Issues: ${issues.map(i => `[${i.type}] payload #${i.payloadIndex}`).join(', ')}`,
      severity: dataLeaks > 0 ? 'critical' : 'high',
    };
  }
}

module.exports = SqlInjection;
