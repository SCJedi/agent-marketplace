'use strict';

/**
 * Publish a content record to a marketplace node.
 * @param {object} contentRecord - Content record from createContentRecord()
 * @param {string} nodeUrl       - Base URL of the marketplace node (e.g. http://localhost:3000)
 * @param {string} apiKey        - API key for authentication
 * @param {number} price         - Price in USD to charge for this content
 * @returns {Promise<object>}    - Response from the node
 */
async function publishContent(contentRecord, nodeUrl, apiKey, price) {
  const record = { ...contentRecord, price };

  const response = await fetch(`${nodeUrl.replace(/\/+$/, '')}/publish/content`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(record),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Publish failed (${response.status}): ${body}`);
  }

  return response.json();
}

/**
 * Check if content for a URL already exists on a marketplace node.
 * @param {string} url     - The original content URL to check
 * @param {string} nodeUrl - Base URL of the marketplace node
 * @returns {Promise<{available: boolean, record?: object}>}
 */
async function checkAvailability(url, nodeUrl) {
  const endpoint = `${nodeUrl.replace(/\/+$/, '')}/check?url=${encodeURIComponent(url)}`;

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
  });

  if (response.status === 404) {
    return { available: false };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Availability check failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  return { available: true, record: data };
}

/**
 * Fetch (buy) cached content from a marketplace node.
 * @param {string} url     - The original content URL to fetch
 * @param {string} nodeUrl - Base URL of the marketplace node
 * @param {string} apiKey  - API key for authentication / payment
 * @returns {Promise<object>} - The content record
 */
async function fetchFromMarketplace(url, nodeUrl, apiKey) {
  const endpoint = `${nodeUrl.replace(/\/+$/, '')}/fetch?url=${encodeURIComponent(url)}`;

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Fetch from marketplace failed (${response.status}): ${body}`);
  }

  return response.json();
}

module.exports = {
  publishContent,
  checkAvailability,
  fetchFromMarketplace,
};
