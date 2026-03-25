"""Local cache for the Agent Marketplace SDK.

Provides SDK-side caching with TTL so agents don't hit the network for
recently-fetched content. Also serves as a graceful degradation layer —
if the marketplace node is unreachable, stale cache is better than nothing.
"""

from __future__ import annotations

import time
from typing import Dict, Optional

from agent_marketplace.models import ContentRecord


class LocalCache:
    """SDK-side in-memory cache with TTL.

    Stores ContentRecord objects keyed by URL. Entries expire after
    ``ttl_seconds`` (default 4 hours). Stale entries can still be
    retrieved explicitly for graceful degradation when the marketplace
    is unavailable.
    """

    def __init__(self, ttl_seconds: int = 14400) -> None:
        """Initialize in-memory cache.

        Args:
            ttl_seconds: Default time-to-live for cached entries (default 4 hours).
        """
        self._ttl = ttl_seconds
        self._store: Dict[str, Dict] = {}  # url -> {"record": ContentRecord, "cached_at": float}

    def get(self, url: str) -> Optional[ContentRecord]:
        """Get cached content if fresh enough.

        Args:
            url: The URL to look up.

        Returns:
            The cached ContentRecord if it exists and has not expired, else None.
        """
        entry = self._store.get(url)
        if entry is None:
            return None
        if not self._entry_is_fresh(entry):
            return None
        return entry["record"]

    def get_stale(self, url: str) -> Optional[ContentRecord]:
        """Get cached content even if expired (for graceful degradation).

        Args:
            url: The URL to look up.

        Returns:
            The cached ContentRecord regardless of age, or None if never cached.
        """
        entry = self._store.get(url)
        if entry is None:
            return None
        return entry["record"]

    def put(self, url: str, content: ContentRecord) -> None:
        """Cache content locally.

        Args:
            url: The URL key.
            content: The ContentRecord to cache.
        """
        self._store[url] = {
            "record": content,
            "cached_at": time.time(),
        }

    def is_fresh(self, url: str, max_age_seconds: Optional[int] = None) -> bool:
        """Check if cached entry is still fresh.

        Args:
            url: The URL to check.
            max_age_seconds: Override TTL for this check. Uses default TTL if None.

        Returns:
            True if the entry exists and has not expired.
        """
        entry = self._store.get(url)
        if entry is None:
            return False
        ttl = max_age_seconds if max_age_seconds is not None else self._ttl
        return (time.time() - entry["cached_at"]) < ttl

    def invalidate(self, url: str) -> None:
        """Remove an entry from the cache.

        Args:
            url: The URL to remove.
        """
        self._store.pop(url, None)

    def clear(self) -> None:
        """Remove all entries from the cache."""
        self._store.clear()

    def size(self) -> int:
        """Return the number of entries in the cache."""
        return len(self._store)

    def _entry_is_fresh(self, entry: Dict) -> bool:
        """Check if an individual cache entry is within TTL."""
        return (time.time() - entry["cached_at"]) < self._ttl
