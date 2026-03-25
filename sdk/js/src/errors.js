'use strict';

/**
 * Base error class for marketplace SDK errors.
 */
class MarketplaceError extends Error {
  constructor(message, statusCode = null, response = null) {
    super(message);
    this.name = 'MarketplaceError';
    this.statusCode = statusCode;
    this.response = response;
  }
}

/**
 * Raised when the marketplace node is unreachable.
 */
class NetworkError extends MarketplaceError {
  constructor(message, response = null) {
    super(message, null, response);
    this.name = 'NetworkError';
  }
}

/**
 * Raised when the requested resource doesn't exist (404).
 */
class NotFoundError extends MarketplaceError {
  constructor(message, response = null) {
    super(message, 404, response);
    this.name = 'NotFoundError';
  }
}

/**
 * Raised when the marketplace node returns a 5xx error.
 */
class ServerError extends MarketplaceError {
  constructor(message, statusCode = 500, response = null) {
    super(message, statusCode, response);
    this.name = 'ServerError';
  }
}

/**
 * Raised when authentication fails (401/403).
 */
class AuthError extends MarketplaceError {
  constructor(message, statusCode = 401, response = null) {
    super(message, statusCode, response);
    this.name = 'AuthError';
  }
}

module.exports = { MarketplaceError, NetworkError, NotFoundError, ServerError, AuthError };
