'use strict';

/**
 * Automated verification checks for content and artifacts.
 * Run server-side before/during human verification to flag obvious issues.
 */

// --- Helper functions ---

/**
 * Check if content is readable text (high ratio of printable ASCII/unicode chars)
 */
function isReadableText(text) {
  if (!text || typeof text !== 'string') return false;
  if (text.length === 0) return false;
  // Count printable characters (ASCII 32-126, plus common unicode letters/punctuation)
  let printable = 0;
  for (let i = 0; i < Math.min(text.length, 5000); i++) {
    const code = text.charCodeAt(i);
    // Printable ASCII, newlines, tabs, or unicode letters (above 127)
    if ((code >= 32 && code <= 126) || code === 10 || code === 13 || code === 9 || code > 127) {
      printable++;
    }
  }
  const ratio = printable / Math.min(text.length, 5000);
  return ratio > 0.85;
}

/**
 * Check if content has proper metadata (title at minimum)
 */
function hasMetadata(content) {
  if (!content) return false;
  let meta = content.content_metadata;
  if (typeof meta === 'string') {
    try { meta = JSON.parse(meta); } catch (e) { return false; }
  }
  if (!meta || typeof meta !== 'object') return false;
  // Must have a title or name
  return !!(meta.title || meta.name || meta.filename);
}

/**
 * Basic keyword overlap between title and content text.
 * At least one significant word from the title should appear in the content.
 */
function titleMatchesContent(content) {
  if (!content) return false;
  let meta = content.content_metadata;
  if (typeof meta === 'string') {
    try { meta = JSON.parse(meta); } catch (e) { return true; /* no metadata, skip check */ }
  }
  const title = (meta && (meta.title || meta.name || meta.filename)) || '';
  if (!title || title.length < 3) return true; // no title to check against

  const text = (content.content_text || '').toLowerCase();
  if (!text || text.length < 20) return true; // too short to meaningfully check

  // Extract significant words from title (3+ chars, not common stopwords)
  const stopwords = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'has', 'her', 'was', 'one', 'our', 'out', 'with', 'this', 'that', 'from', 'have', 'been']);
  const titleWords = title.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !stopwords.has(w));

  if (titleWords.length === 0) return true; // no significant words

  // At least one title word should appear in the content
  return titleWords.some(word => text.includes(word));
}

/**
 * Detect suspicious patterns: base64 blobs, excessive repetition, SEO spam
 */
function hasSuspiciousPatterns(text) {
  if (!text || typeof text !== 'string') return false;

  // Check for large base64-encoded blocks (>200 chars of continuous base64)
  if (/[A-Za-z0-9+/=]{200,}/.test(text)) return true;

  // Check for excessive repetition (same line repeated 10+ times)
  const lines = text.split('\n').filter(l => l.trim().length > 5);
  if (lines.length > 20) {
    const freq = {};
    for (const line of lines) {
      const trimmed = line.trim();
      freq[trimmed] = (freq[trimmed] || 0) + 1;
      if (freq[trimmed] >= 10) return true;
    }
  }

  // Check for SEO spam patterns (keyword stuffing)
  const words = text.toLowerCase().split(/\s+/);
  if (words.length > 50) {
    const wordFreq = {};
    for (const w of words) {
      if (w.length >= 4) {
        wordFreq[w] = (wordFreq[w] || 0) + 1;
      }
    }
    // If any single word is more than 20% of all words, suspicious
    const threshold = words.length * 0.2;
    for (const count of Object.values(wordFreq)) {
      if (count > threshold && count > 20) return true;
    }
  }

  return false;
}

/**
 * Detect embedded secrets: API keys, private keys, passwords, tokens
 */
function hasSecrets(text) {
  if (!text || typeof text !== 'string') return false;

  const patterns = [
    // AWS keys
    /AKIA[0-9A-Z]{16}/,
    // Generic API key patterns
    /api[_-]?key[\s:="']+[a-zA-Z0-9_\-]{20,}/i,
    /api[_-]?secret[\s:="']+[a-zA-Z0-9_\-]{20,}/i,
    // Private keys
    /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
    // AWS secret key format
    /[a-zA-Z0-9/+=]{40}/,
    // Generic password in config
    /password[\s:="']+[^\s"']{8,}/i,
    // Bearer tokens
    /bearer\s+[a-zA-Z0-9_\-.]{20,}/i,
    // GitHub tokens
    /gh[ps]_[a-zA-Z0-9]{36}/,
    // Slack tokens
    /xox[bporas]-[a-zA-Z0-9-]{10,}/,
    // Generic secret/token assignments
    /(?:secret|token|credential)[\s:="']+[a-zA-Z0-9_\-/+=]{16,}/i,
  ];

  // Only flag if multiple patterns match or a high-confidence pattern matches
  let matchCount = 0;
  const highConfidence = [0, 4, 7, 8]; // AWS key, private key, GH token, Slack token

  for (let i = 0; i < patterns.length; i++) {
    if (patterns[i].test(text)) {
      if (highConfidence.includes(i)) return true;
      matchCount++;
    }
  }

  return matchCount >= 2;
}

/**
 * Run all automated checks on a content item.
 * @param {Object} content - Content record from DB (must have content_text, content_metadata)
 * @returns {Object} Check results with individual check outcomes
 */
function runChecks(content) {
  const results = [];

  // Check 1: Content is readable text (not binary garbage)
  results.push({
    name: 'readable',
    label: 'Content is readable text (not binary/garbage)',
    passed: isReadableText(content.content_text)
  });

  // Check 2: Has meaningful content (not empty/trivial)
  results.push({
    name: 'substantial',
    label: 'Content is substantial (>100 chars)',
    passed: !!(content.content_text && content.content_text.length > 100)
  });

  // Check 3: Metadata present
  results.push({
    name: 'metadata',
    label: 'Metadata fields present',
    passed: hasMetadata(content)
  });

  // Check 4: Title matches content
  results.push({
    name: 'title_match',
    label: 'Title relates to content',
    passed: titleMatchesContent(content)
  });

  // Check 5: No suspicious patterns
  results.push({
    name: 'no_suspicious',
    label: 'No suspicious patterns detected',
    passed: !hasSuspiciousPatterns(content.content_text)
  });

  // Check 6: No embedded secrets/credentials
  results.push({
    name: 'no_secrets',
    label: 'No embedded secrets or credentials',
    passed: !hasSecrets(content.content_text)
  });

  return {
    checks: results,
    passedCount: results.filter(r => r.passed).length,
    totalCount: results.length,
    allPassed: results.every(r => r.passed)
  };
}

module.exports = {
  runChecks,
  isReadableText,
  hasMetadata,
  titleMatchesContent,
  hasSuspiciousPatterns,
  hasSecrets
};
