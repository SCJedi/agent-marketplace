'use strict';

const Scenario = require('../../framework/scenario');

/**
 * RT-A005: Hash Collision / Content Integrity
 *
 * Hypothesis: Content with subtle differences can pass hash verification.
 *
 * Attack: Publish content for a URL with specific text. Then publish again with
 * text that uses unicode tricks, zero-width chars, and homoglyph substitution.
 * Check if the content_hash divergence detection catches it.
 *
 * Pass: Divergent content is flagged.
 * Fail: It passes silently.
 */
class HashCollision extends Scenario {
  constructor() {
    super(
      'RT-A005',
      'Hash Collision / Content Integrity Bypass',
      'Content with subtle differences can pass hash verification undetected'
    );
  }

  async setup(baseUrl) {
    // Register two legitimate providers to establish consensus
    this.provider1 = await this.registerNode(baseUrl, 'honest-provider-1', 0.01);
    this.provider2 = await this.registerNode(baseUrl, 'honest-provider-2', 0.01);

    if (!this.provider1 || !this.provider2) {
      throw new Error('Failed to register honest providers');
    }
  }

  async execute(baseUrl, config) {
    const testUrl = 'https://example.com/important-content';
    const originalText = 'The quick brown fox jumps over the lazy dog. Price: $100.00';

    // Step 1: Publish original content from 2 honest providers (establish consensus)
    // Include API keys to authenticate as the registered providers (required post-A001 fix)
    const pub1 = await this.fetch(baseUrl, '/publish/content', {
      method: 'POST',
      headers: this.provider1.api_key ? { 'x-api-key': this.provider1.api_key } : {},
      body: {
        url: testUrl,
        source_hash: 'originalhash1',
        content_text: originalText,
        provider_id: this.provider1.id,
        price: 0.001,
      },
    });

    const pub2 = await this.fetch(baseUrl, '/publish/content', {
      method: 'POST',
      headers: this.provider2.api_key ? { 'x-api-key': this.provider2.api_key } : {},
      body: {
        url: testUrl,
        source_hash: 'originalhash2',
        content_text: originalText,
        provider_id: this.provider2.id,
        price: 0.001,
      },
    });

    // Step 2: Now attack with subtly different content
    const attackVariants = [
      {
        name: 'zero-width space injection',
        text: 'The quick brown fox jumps over the lazy dog. Price: $\u200B100.00',
      },
      {
        name: 'zero-width non-joiner',
        text: 'The quick brown fox jumps over the lazy dog. Price: $\u200C100.00',
      },
      {
        name: 'zero-width joiner',
        text: 'The quick brown fox jumps over the lazy dog. Price: $\u200D100.00',
      },
      {
        name: 'homoglyph: Cyrillic o',
        text: 'The quick br\u043Ewn f\u043Ex jumps over the lazy dog. Price: $100.00',
      },
      {
        name: 'homoglyph: Greek omicron',
        text: 'The quick br\u03BFwn f\u03BFx jumps over the lazy dog. Price: $100.00',
      },
      {
        name: 'right-to-left override',
        text: 'The quick brown fox jumps over the lazy dog. Price: $\u202E00.001',
      },
      {
        name: 'soft hyphen injection',
        text: 'The quick brown fox jumps over the la\u00ADzy dog. Price: $100.00',
      },
      {
        name: 'combining diacritical marks',
        text: 'The quick brown fox jumps over the lazy dog. Price: $100\u0300.00',
      },
      {
        name: 'figure space',
        text: 'The quick brown fox jumps over the lazy dog. Price:\u2007$100.00',
      },
      {
        name: 'fullwidth numbers',
        text: 'The quick brown fox jumps over the lazy dog. Price: $\uFF11\uFF10\uFF10.00',
      },
      {
        name: 'price change with lookalike',
        text: 'The quick brown fox jumps over the lazy dog. Price: $1OO.OO',  // O not 0
      },
      {
        name: 'trailing whitespace',
        text: 'The quick brown fox jumps over the lazy dog. Price: $100.00   ',
      },
      {
        name: 'leading whitespace',
        text: '  The quick brown fox jumps over the lazy dog. Price: $100.00',
      },
      {
        name: 'tab injection',
        text: 'The quick brown fox jumps over the lazy dog. Price:\t$100.00',
      },
      {
        name: 'newline injection',
        text: 'The quick brown fox jumps over the lazy dog. Price: $100.00\nActual price: $1.00',
      },
    ];

    const results = [];
    let flaggedCount = 0;
    let unflaggedCount = 0;

    // Register an attacker provider
    const attackerNode = await this.registerNode(baseUrl, 'attacker-content', 0.001);

    for (const variant of attackVariants) {
      const pubRes = await this.fetch(baseUrl, '/publish/content', {
        method: 'POST',
        headers: attackerNode && attackerNode.api_key ? { 'x-api-key': attackerNode.api_key } : {},
        body: {
          url: testUrl,
          source_hash: `attackhash-${variant.name}`,
          content_text: variant.text,
          provider_id: attackerNode ? attackerNode.id : 'attacker',
          price: 0.001,
        },
      });

      // Check providers endpoint to see all content for this URL
      const providersRes = await this.fetch(baseUrl, `/fetch/providers?url=${encodeURIComponent(testUrl)}`);
      const allProviders = providersRes.data?.data || [];

      // Check if hashes differ (content was detected as divergent)
      const uniqueHashes = new Set(allProviders.map(p => p.content_hash).filter(Boolean));
      const hashDiverged = uniqueHashes.size > 1;

      // The divergence detection in the system flags content but still publishes it
      // So we check if the content was flagged (via the hash divergence mechanism)
      const wasAccepted = pubRes.status === 201;
      const contentRecord = pubRes.data?.data;
      const contentHash = contentRecord?.content_hash;

      // Check if hash differs from original (basic detection)
      const hashDiffersFromOriginal = contentHash && allProviders.length > 1 &&
        allProviders.some(p => p.content_hash && p.content_hash !== contentHash);

      if (hashDiffersFromOriginal) {
        flaggedCount++;
      } else {
        unflaggedCount++;
      }

      results.push({
        variant: variant.name,
        accepted: wasAccepted,
        hashDiffersFromOriginal,
        contentHash,
      });
    }

    return {
      totalVariants: attackVariants.length,
      flaggedCount,
      unflaggedCount,
      flagRate: flaggedCount / attackVariants.length,
      variantResults: results,
    };
  }

  assert(results) {
    const { totalVariants, flaggedCount, unflaggedCount, flagRate, variantResults } = results;

    // We expect ALL variants to produce different hashes (since they have different content)
    // The hash should catch even subtle unicode tricks
    const unflaggedVariants = variantResults
      .filter(r => !r.hashDiffersFromOriginal)
      .map(r => r.variant);

    if (unflaggedCount === 0) {
      return {
        pass: true,
        metric: flagRate,
        threshold: 1.0,
        details: `${flaggedCount}/${totalVariants} content variants were detected as divergent. Hash-based content integrity verification catches all tested attack variants.`,
        severity: 'none',
      };
    }

    // Trim.() whitespace variants might not be caught — depends on implementation
    // Check severity based on what slipped through
    const criticalUnflagged = unflaggedVariants.filter(v =>
      !v.includes('whitespace') && !v.includes('trailing') && !v.includes('leading')
    );

    const severity = criticalUnflagged.length > 0 ? 'high' : 'low';

    return {
      pass: false,
      metric: flagRate,
      threshold: 1.0,
      details: `VULNERABILITY: Only ${flaggedCount}/${totalVariants} (${(flagRate * 100).toFixed(1)}%) content variants detected. Undetected: ${unflaggedVariants.join(', ')}. The content hashing does not normalize text before hashing, allowing ${severity === 'high' ? 'semantic manipulation via unicode tricks' : 'minor whitespace variations'} to bypass divergence detection.`,
      severity,
    };
  }
}

module.exports = HashCollision;
