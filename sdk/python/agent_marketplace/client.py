"""Main client for the Agent Marketplace SDK.

Usage::

    from agent_marketplace import Marketplace

    mp = Marketplace(node_url="http://localhost:3000", api_key="your-key")
    record = mp.smart_fetch("https://example.com/docs")
    if record:
        print(record.text)
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

import requests

from agent_marketplace.cache import LocalCache
from agent_marketplace.models import ArtifactRecord, ContentRecord

logger = logging.getLogger(__name__)


class MarketplaceError(Exception):
    """Base exception for marketplace SDK errors."""

    def __init__(self, message: str, status_code: Optional[int] = None, response: Optional[Dict] = None):
        super().__init__(message)
        self.status_code = status_code
        self.response = response


class NetworkError(MarketplaceError):
    """Raised when the marketplace node is unreachable."""


class NotFoundError(MarketplaceError):
    """Raised when the requested resource doesn't exist (404)."""


class ServerError(MarketplaceError):
    """Raised when the marketplace node returns a 5xx error."""


class Marketplace:
    """Client for interacting with an Agent Marketplace node.

    Provides methods to search, fetch, and publish content and artifacts.
    Includes automatic local caching for performance and availability.

    Args:
        node_url: Base URL of the marketplace node (default ``http://localhost:3000``).
        api_key: Optional API key for authenticated requests.
        cache_ttl: Cache time-to-live in seconds (default 4 hours).
        timeout: HTTP request timeout in seconds (default 30).
    """

    def __init__(
        self,
        node_url: str = "http://localhost:3000",
        api_key: Optional[str] = None,
        cache_ttl: int = 14400,
        timeout: int = 30,
    ) -> None:
        self._base_url = node_url.rstrip("/")
        self._api_key = api_key
        self._timeout = timeout
        self._cache = LocalCache(ttl_seconds=cache_ttl)
        self._session = requests.Session()
        if api_key:
            self._session.headers["Authorization"] = f"Bearer {api_key}"
            self._session.headers["x-api-key"] = api_key
        self._session.headers["User-Agent"] = "agent-marketplace-sdk/0.1.0"

    # ------------------------------------------------------------------
    # Content operations
    # ------------------------------------------------------------------

    def check(self, url: str) -> Dict[str, Any]:
        """Check if an AI-clean version of a URL exists on the marketplace.

        Args:
            url: The URL to look up.

        Returns:
            Dictionary with keys: ``available`` (bool), ``price`` (float),
            ``freshness`` (str), ``providers`` (int).
        """
        return self._request("GET", "/check", params={"url": url})

    def fetch(self, url: str) -> ContentRecord:
        """Buy and retrieve the clean content for a URL.

        Checks the local cache first. On cache miss, fetches from the
        marketplace and caches the result.

        Args:
            url: The URL to fetch clean content for.

        Returns:
            A ContentRecord with text, structured data, links, and metadata.

        Raises:
            NotFoundError: If no clean content exists for this URL.
            NetworkError: If the marketplace node is unreachable.
        """
        # Check cache first
        cached = self._cache.get(url)
        if cached is not None:
            return cached

        data = self._request("GET", "/fetch", params={"url": url})
        record = ContentRecord.from_dict(data)
        self._cache.put(url, record)
        return record

    def publish_content(
        self,
        url: str,
        content: Dict[str, Any],
        price: float = 0,
        token_cost_saved: float = 0,
        visibility: Optional[str] = None,
        authorized_keys: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Publish clean content you've processed.

        Other agents will pay you when they fetch it.

        Args:
            url: The original URL of the content.
            content: Dictionary with ``text``, ``structured``, ``links``, ``metadata``.
            price: Price to charge in credits (default 0 = free).
            token_cost_saved: Estimated token cost saved by using this pre-cleaned content.
            visibility: Access level — ``"public"`` (default), ``"private"``, or ``"whitelist"``.
            authorized_keys: List of API keys to whitelist (only when visibility is ``"whitelist"``).

        Returns:
            Confirmation dictionary with ``id``, ``status``, ``url``.
        """
        import hashlib
        # Flatten content into the format the server expects
        payload: Dict[str, Any] = {
            "url": url,
            "source_hash": content.get("source_hash", hashlib.sha256(url.encode()).hexdigest()),
            "content_text": content.get("text", ""),
            "content_structured": content.get("structured"),
            "content_links": content.get("links"),
            "content_metadata": content.get("metadata"),
            "price": price,
            "token_cost_saved": token_cost_saved,
        }
        if visibility is not None:
            payload["visibility"] = visibility
        if authorized_keys is not None:
            payload["authorized_keys"] = authorized_keys
        return self._request("POST", "/publish/content", json=payload)

    # ------------------------------------------------------------------
    # Search operations
    # ------------------------------------------------------------------

    def search(
        self,
        query: str,
        type: Optional[str] = None,
        category: Optional[str] = None,
        language: Optional[str] = None,
        license: Optional[str] = None,
        max_age: Optional[str] = None,
        budget: Optional[float] = None,
        sort: str = "relevance",
    ) -> List[Dict[str, Any]]:
        """Search across content and artifacts.

        Args:
            query: Search query string.
            type: Filter by type (``content`` or ``artifact``).
            category: Filter by category.
            language: Filter by programming language.
            license: Filter by license type.
            max_age: Maximum age (e.g. ``"7d"``, ``"1h"``).
            budget: Maximum price in credits.
            sort: Sort order — ``relevance``, ``price``, ``date``, ``popularity``.

        Returns:
            List of result dictionaries with relevance scores.
        """
        params: Dict[str, Any] = {"q": query, "sort": sort}
        if type is not None:
            params["type"] = type
        if category is not None:
            params["category"] = category
        if language is not None:
            params["language"] = language
        if license is not None:
            params["license"] = license
        if max_age is not None:
            params["max_age"] = max_age
        if budget is not None:
            params["budget"] = budget

        data = self._request("GET", "/search", params=params)
        return data.get("results", []) if isinstance(data, dict) else data

    def search_best(self, query: str, **kwargs: Any) -> Optional[Dict[str, Any]]:
        """Return the single best result for a query.

        Convenience wrapper around :meth:`search` that returns only the
        top-ranked result.

        Args:
            query: Search query string.
            **kwargs: Additional filters passed to :meth:`search`.

        Returns:
            The highest-relevance result dictionary, or None if no results.
        """
        results = self.search(query, **kwargs)
        return results[0] if results else None

    def trending(self, period: str = "7d") -> Dict[str, Any]:
        """Get trending searches and resources (Layer 3 aggregate data).

        Args:
            period: Time period — ``"1d"``, ``"7d"``, ``"30d"``.

        Returns:
            Dictionary with ``trending_searches``, ``trending_content``,
            ``trending_artifacts``.
        """
        return self._request("GET", "/trending", params={"period": period})

    def gaps(self, category: Optional[str] = None) -> List[Dict[str, Any]]:
        """Find unmet demand — searches with no results.

        Use this to discover what agents are looking for but can't find.
        Publishing content or artifacts that fill gaps earns more.

        Args:
            category: Optional category filter.

        Returns:
            List of gap dictionaries with ``query``, ``search_count``, ``category``.
        """
        params: Dict[str, Any] = {}
        if category is not None:
            params["category"] = category
        data = self._request("GET", "/gaps", params=params)
        return data.get("gaps", []) if isinstance(data, dict) else data

    # ------------------------------------------------------------------
    # Artifact operations
    # ------------------------------------------------------------------

    def publish_artifact(
        self,
        name: str,
        description: str,
        category: str,
        files: List[str],
        price: float = 0,
        visibility: Optional[str] = None,
        authorized_keys: Optional[List[str]] = None,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """List a build artifact on the marketplace.

        Args:
            name: Human-readable name for the artifact.
            description: What the artifact does and who it's for.
            category: Category (e.g. ``tool``, ``library``, ``template``).
            files: List of file paths to include.
            price: Price in credits (default 0 = free).
            visibility: Access level — ``"public"`` (default), ``"private"``, or ``"whitelist"``.
            authorized_keys: List of API keys to whitelist (only when visibility is ``"whitelist"``).
            **kwargs: Additional fields (``tags``, ``version``, ``license``).

        Returns:
            Confirmation dictionary with ``slug``, ``status``.
        """
        import re
        slug = kwargs.pop("slug", None) or re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
        payload: Dict[str, Any] = {
            "name": name,
            "slug": slug,
            "description": description,
            "category": category,
            "files": files,
            "price": price,
        }
        if visibility is not None:
            payload["visibility"] = visibility
        if authorized_keys is not None:
            payload["authorized_keys"] = authorized_keys
        payload.update(kwargs)
        return self._request("POST", "/publish/artifact", json=payload)

    def get_artifact(self, slug: str) -> ArtifactRecord:
        """Get artifact details.

        Args:
            slug: The unique slug identifier for the artifact.

        Returns:
            An ArtifactRecord with full details.

        Raises:
            NotFoundError: If no artifact with this slug exists.
        """
        data = self._request("GET", f"/artifacts/{slug}")
        return ArtifactRecord.from_dict(data)

    def download_artifact(self, slug: str) -> Dict[str, Any]:
        """Download an artifact (charges your account).

        Args:
            slug: The unique slug identifier for the artifact.

        Returns:
            Dictionary with ``download_url``, ``files``, ``price_charged``.
        """
        return self._request("GET", f"/artifacts/{slug}/download")

    # ------------------------------------------------------------------
    # Smart workflow
    # ------------------------------------------------------------------

    def smart_fetch(self, url: str, max_price: Optional[float] = None) -> Optional[ContentRecord]:
        """The main agent workflow for getting clean content.

        1. Check local cache first.
        2. Check if a clean version exists on the marketplace at acceptable price.
        3. If yes, buy it and cache it.
        4. If no (not available or too expensive), return None.
           The agent should then crawl the URL themselves and call
           :meth:`publish_content` to make it available to others.

        Args:
            url: The URL to get clean content for.
            max_price: Maximum price in credits. Defaults to estimated
                token cost of parsing the HTML (from the marketplace check).

        Returns:
            A ContentRecord if content was available at acceptable price,
            or None if the agent should crawl and publish themselves.
        """
        # 1. Check local cache
        cached = self._cache.get(url)
        if cached is not None:
            return cached

        # 2. Check marketplace availability
        try:
            info = self.check(url)
        except NetworkError:
            # Marketplace down — try stale cache as fallback
            stale = self._cache.get_stale(url)
            if stale is not None:
                logger.info("Marketplace unreachable, serving stale cache for %s", url)
                return stale
            return None
        except MarketplaceError:
            return None

        if not info.get("available", False):
            return None

        # 3. Check price ceiling
        price = float(info.get("price", 0))
        if max_price is not None and price > max_price:
            return None

        # 4. Fetch and cache
        try:
            return self.fetch(url)
        except MarketplaceError:
            return None

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _request(
        self,
        method: str,
        path: str,
        params: Optional[Dict[str, Any]] = None,
        json: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Make an HTTP request to the marketplace node.

        Args:
            method: HTTP method (GET, POST, etc.).
            path: API path (e.g. ``/content/check``).
            params: Query parameters.
            json: JSON body for POST requests.

        Returns:
            Parsed JSON response as a dictionary.

        Raises:
            NetworkError: If the node is unreachable.
            NotFoundError: If the resource was not found (404).
            ServerError: If the node returned a 5xx error.
            MarketplaceError: For other HTTP errors.
        """
        url = f"{self._base_url}{path}"
        try:
            resp = self._session.request(
                method,
                url,
                params=params,
                json=json,
                timeout=self._timeout,
            )
        except requests.ConnectionError as exc:
            raise NetworkError(f"Cannot reach marketplace at {self._base_url}: {exc}") from exc
        except requests.Timeout as exc:
            raise NetworkError(f"Request to {url} timed out after {self._timeout}s") from exc
        except requests.RequestException as exc:
            raise MarketplaceError(f"Request failed: {exc}") from exc

        if resp.status_code == 404:
            raise NotFoundError(
                f"Not found: {path}",
                status_code=404,
                response=self._safe_json(resp),
            )
        if resp.status_code >= 500:
            raise ServerError(
                f"Server error {resp.status_code}: {path}",
                status_code=resp.status_code,
                response=self._safe_json(resp),
            )
        if resp.status_code >= 400:
            raise MarketplaceError(
                f"Request failed with {resp.status_code}: {path}",
                status_code=resp.status_code,
                response=self._safe_json(resp),
            )

        body = self._safe_json(resp) or {}
        # Unwrap the server's {success, data, error} envelope if present
        if "data" in body and "success" in body:
            return body["data"] if body["data"] is not None else {}
        return body

    @staticmethod
    def _safe_json(resp: requests.Response) -> Optional[Dict[str, Any]]:
        """Try to parse JSON from a response, return None on failure."""
        try:
            return resp.json()
        except (ValueError, AttributeError):
            return None
