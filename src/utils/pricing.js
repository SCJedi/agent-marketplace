'use strict';

/**
 * Validate that the price is below the estimated token cost
 * (the whole point: cached content should be cheaper than re-fetching)
 */
function validatePriceCeiling(price, estimatedTokenCost) {
  if (typeof price !== 'number' || typeof estimatedTokenCost !== 'number') {
    return { valid: false, reason: 'price and estimatedTokenCost must be numbers' };
  }
  if (price < 0) {
    return { valid: false, reason: 'price cannot be negative' };
  }
  if (price >= estimatedTokenCost) {
    return { valid: false, reason: `price (${price}) must be less than token cost (${estimatedTokenCost})` };
  }
  return { valid: true, reason: null };
}

/**
 * Calculate total revenue for a provider based on price per query
 */
function calculateProviderRevenue(price, queryCount) {
  if (typeof price !== 'number' || typeof queryCount !== 'number') {
    return 0;
  }
  return Math.round(price * queryCount * 100) / 100;
}

module.exports = { validatePriceCeiling, calculateProviderRevenue };
