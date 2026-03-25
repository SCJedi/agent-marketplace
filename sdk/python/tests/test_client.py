"""Tests for the Agent Marketplace SDK."""

import time
import unittest
from unittest.mock import MagicMock, patch

import requests

from agent_marketplace.cache import LocalCache
from agent_marketplace.client import (
    Marketplace,
    MarketplaceError,
    NetworkError,
    NotFoundError,
    ServerError,
)
from agent_marketplace.models import ArtifactRecord, ContentRecord


def _mock_response(status_code: int = 200, json_data: dict = None) -> MagicMock:
    """Create a mock requests.Response."""
    resp = MagicMock(spec=requests.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data or {}
    return resp


class TestMarketplaceInit(unittest.TestCase):
    """Test Marketplace construction."""

    def test_default_init(self):
        mp = Marketplace()
        self.assertEqual(mp._base_url, "http://localhost:3000")
        self.assertIsNone(mp._api_key)
        self.assertIsNotNone(mp._cache)

    def test_custom_init(self):
        mp = Marketplace(
            node_url="https://node.example.com/",
            api_key="test-key-123",
            cache_ttl=3600,
            timeout=10,
        )
        self.assertEqual(mp._base_url, "https://node.example.com")
        self.assertEqual(mp._api_key, "test-key-123")
        self.assertEqual(mp._timeout, 10)
        self.assertIn("Authorization", mp._session.headers)
        self.assertEqual(mp._session.headers["Authorization"], "Bearer test-key-123")

    def test_trailing_slash_stripped(self):
        mp = Marketplace(node_url="http://localhost:3000/")
        self.assertEqual(mp._base_url, "http://localhost:3000")


class TestCheck(unittest.TestCase):
    """Test Marketplace.check()."""

    @patch.object(requests.Session, "request")
    def test_check_available(self, mock_request):
        mock_request.return_value = _mock_response(200, {
            "available": True,
            "price": 0.05,
            "freshness": "2h",
            "providers": 3,
        })
        mp = Marketplace()
        result = mp.check("https://example.com")
        self.assertTrue(result["available"])
        self.assertEqual(result["price"], 0.05)
        self.assertEqual(result["providers"], 3)

    @patch.object(requests.Session, "request")
    def test_check_not_available(self, mock_request):
        mock_request.return_value = _mock_response(200, {
            "available": False,
            "price": 0,
            "freshness": "",
            "providers": 0,
        })
        mp = Marketplace()
        result = mp.check("https://unknown.example.com")
        self.assertFalse(result["available"])


class TestFetch(unittest.TestCase):
    """Test Marketplace.fetch()."""

    @patch.object(requests.Session, "request")
    def test_fetch_success(self, mock_request):
        mock_request.return_value = _mock_response(200, {
            "url": "https://example.com",
            "source_hash": "abc123",
            "fetched_at": "2026-03-24T12:00:00Z",
            "text": "Hello world",
            "structured": {"headings": ["Title"]},
            "links": ["https://example.com/about"],
            "metadata": {"title": "Example"},
            "price": 0.05,
            "token_cost_saved": 500.0,
        })
        mp = Marketplace()
        record = mp.fetch("https://example.com")
        self.assertIsInstance(record, ContentRecord)
        self.assertEqual(record.text, "Hello world")
        self.assertEqual(record.price, 0.05)

    @patch.object(requests.Session, "request")
    def test_fetch_caches_result(self, mock_request):
        mock_request.return_value = _mock_response(200, {
            "url": "https://example.com",
            "text": "Cached content",
        })
        mp = Marketplace()
        record1 = mp.fetch("https://example.com")
        record2 = mp.fetch("https://example.com")
        # Second call should hit cache, not network
        self.assertEqual(mock_request.call_count, 1)
        self.assertEqual(record2.text, "Cached content")

    @patch.object(requests.Session, "request")
    def test_fetch_404(self, mock_request):
        mock_request.return_value = _mock_response(404, {"error": "not found"})
        mp = Marketplace()
        with self.assertRaises(NotFoundError):
            mp.fetch("https://nonexistent.example.com")


class TestPublishContent(unittest.TestCase):
    """Test Marketplace.publish_content()."""

    @patch.object(requests.Session, "request")
    def test_publish_success(self, mock_request):
        mock_request.return_value = _mock_response(200, {
            "id": "pub_123",
            "status": "published",
            "url": "https://example.com",
        })
        mp = Marketplace()
        result = mp.publish_content(
            url="https://example.com",
            content={"text": "Clean content", "structured": {}},
            price=0.03,
            token_cost_saved=400.0,
        )
        self.assertEqual(result["status"], "published")
        # Verify POST body
        call_kwargs = mock_request.call_args
        self.assertEqual(call_kwargs.kwargs.get("json", call_kwargs[1].get("json", {}))["price"], 0.03)


class TestSearch(unittest.TestCase):
    """Test Marketplace.search() and search_best()."""

    @patch.object(requests.Session, "request")
    def test_search_basic(self, mock_request):
        mock_request.return_value = _mock_response(200, {
            "results": [
                {"slug": "tool-1", "relevance": 0.95},
                {"slug": "tool-2", "relevance": 0.80},
            ]
        })
        mp = Marketplace()
        results = mp.search("python parser")
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0]["slug"], "tool-1")

    @patch.object(requests.Session, "request")
    def test_search_with_filters(self, mock_request):
        mock_request.return_value = _mock_response(200, {"results": []})
        mp = Marketplace()
        mp.search(
            "parser",
            type="artifact",
            category="tool",
            language="python",
            license="MIT",
            max_age="7d",
            budget=1.0,
            sort="price",
        )
        call_kwargs = mock_request.call_args
        params = call_kwargs.kwargs.get("params", call_kwargs[1].get("params", {}))
        self.assertEqual(params["type"], "artifact")
        self.assertEqual(params["language"], "python")
        self.assertEqual(params["budget"], 1.0)

    @patch.object(requests.Session, "request")
    def test_search_best_returns_first(self, mock_request):
        mock_request.return_value = _mock_response(200, {
            "results": [
                {"slug": "best", "relevance": 0.99},
                {"slug": "second", "relevance": 0.50},
            ]
        })
        mp = Marketplace()
        best = mp.search_best("python parser")
        self.assertEqual(best["slug"], "best")

    @patch.object(requests.Session, "request")
    def test_search_best_empty(self, mock_request):
        mock_request.return_value = _mock_response(200, {"results": []})
        mp = Marketplace()
        best = mp.search_best("nonexistent thing")
        self.assertIsNone(best)


class TestSmartFetch(unittest.TestCase):
    """Test the smart_fetch() workflow."""

    @patch.object(requests.Session, "request")
    def test_smart_fetch_cache_hit(self, mock_request):
        mp = Marketplace()
        # Pre-populate cache
        record = ContentRecord(url="https://example.com", text="Cached")
        mp._cache.put("https://example.com", record)

        result = mp.smart_fetch("https://example.com")
        self.assertEqual(result.text, "Cached")
        # No network calls
        mock_request.assert_not_called()

    @patch.object(requests.Session, "request")
    def test_smart_fetch_marketplace_hit(self, mock_request):
        # First call: check() returns available
        # Second call: fetch() returns content
        mock_request.side_effect = [
            _mock_response(200, {"available": True, "price": 0.05}),
            _mock_response(200, {"url": "https://example.com", "text": "Fresh content"}),
        ]
        mp = Marketplace()
        result = mp.smart_fetch("https://example.com")
        self.assertIsNotNone(result)
        self.assertEqual(result.text, "Fresh content")

    @patch.object(requests.Session, "request")
    def test_smart_fetch_not_available(self, mock_request):
        mock_request.return_value = _mock_response(200, {"available": False})
        mp = Marketplace()
        result = mp.smart_fetch("https://example.com")
        self.assertIsNone(result)

    @patch.object(requests.Session, "request")
    def test_smart_fetch_too_expensive(self, mock_request):
        mock_request.return_value = _mock_response(200, {
            "available": True,
            "price": 1.00,
        })
        mp = Marketplace()
        result = mp.smart_fetch("https://example.com", max_price=0.10)
        self.assertIsNone(result)
        # Only check() was called, not fetch()
        self.assertEqual(mock_request.call_count, 1)

    @patch.object(requests.Session, "request")
    def test_smart_fetch_network_down_stale_cache(self, mock_request):
        mp = Marketplace()
        # Put something in cache then expire it
        record = ContentRecord(url="https://example.com", text="Stale")
        mp._cache._store["https://example.com"] = {
            "record": record,
            "cached_at": time.time() - 999999,  # way past TTL
        }
        # Network is down
        mock_request.side_effect = requests.ConnectionError("connection refused")
        result = mp.smart_fetch("https://example.com")
        self.assertIsNotNone(result)
        self.assertEqual(result.text, "Stale")

    @patch.object(requests.Session, "request")
    def test_smart_fetch_network_down_no_cache(self, mock_request):
        mock_request.side_effect = requests.ConnectionError("connection refused")
        mp = Marketplace()
        result = mp.smart_fetch("https://example.com")
        self.assertIsNone(result)


class TestArtifactOperations(unittest.TestCase):
    """Test artifact publish, get, and download."""

    @patch.object(requests.Session, "request")
    def test_publish_artifact(self, mock_request):
        mock_request.return_value = _mock_response(200, {
            "slug": "my-tool",
            "status": "listed",
        })
        mp = Marketplace()
        result = mp.publish_artifact(
            name="My Tool",
            description="A useful tool",
            category="tool",
            files=["tool.py", "README.md"],
            price=0.50,
            tags=["python", "utility"],
        )
        self.assertEqual(result["slug"], "my-tool")

    @patch.object(requests.Session, "request")
    def test_get_artifact(self, mock_request):
        mock_request.return_value = _mock_response(200, {
            "slug": "my-tool",
            "name": "My Tool",
            "category": "tool",
            "version": "1.0.0",
            "verified": True,
        })
        mp = Marketplace()
        artifact = mp.get_artifact("my-tool")
        self.assertIsInstance(artifact, ArtifactRecord)
        self.assertEqual(artifact.name, "My Tool")
        self.assertTrue(artifact.verified)

    @patch.object(requests.Session, "request")
    def test_download_artifact(self, mock_request):
        mock_request.return_value = _mock_response(200, {
            "download_url": "https://cdn.example.com/my-tool.tar.gz",
            "files": ["tool.py"],
            "price_charged": 0.50,
        })
        mp = Marketplace()
        result = mp.download_artifact("my-tool")
        self.assertIn("download_url", result)


class TestLocalCache(unittest.TestCase):
    """Test LocalCache TTL behavior."""

    def test_put_and_get(self):
        cache = LocalCache(ttl_seconds=3600)
        record = ContentRecord(url="https://example.com", text="Hello")
        cache.put("https://example.com", record)
        result = cache.get("https://example.com")
        self.assertIsNotNone(result)
        self.assertEqual(result.text, "Hello")

    def test_get_missing_key(self):
        cache = LocalCache()
        result = cache.get("https://nonexistent.com")
        self.assertIsNone(result)

    def test_ttl_expiry(self):
        cache = LocalCache(ttl_seconds=1)
        record = ContentRecord(url="https://example.com", text="Expiring")
        cache.put("https://example.com", record)
        # Manually backdate the entry
        cache._store["https://example.com"]["cached_at"] = time.time() - 2
        result = cache.get("https://example.com")
        self.assertIsNone(result)

    def test_get_stale_returns_expired(self):
        cache = LocalCache(ttl_seconds=1)
        record = ContentRecord(url="https://example.com", text="Stale but useful")
        cache.put("https://example.com", record)
        cache._store["https://example.com"]["cached_at"] = time.time() - 2
        # get() returns None (expired)
        self.assertIsNone(cache.get("https://example.com"))
        # get_stale() returns it anyway
        result = cache.get_stale("https://example.com")
        self.assertIsNotNone(result)
        self.assertEqual(result.text, "Stale but useful")

    def test_is_fresh(self):
        cache = LocalCache(ttl_seconds=3600)
        record = ContentRecord(url="https://example.com", text="Fresh")
        cache.put("https://example.com", record)
        self.assertTrue(cache.is_fresh("https://example.com"))
        self.assertFalse(cache.is_fresh("https://nonexistent.com"))

    def test_is_fresh_custom_max_age(self):
        cache = LocalCache(ttl_seconds=3600)
        record = ContentRecord(url="https://example.com", text="Check age")
        cache.put("https://example.com", record)
        cache._store["https://example.com"]["cached_at"] = time.time() - 100
        # Fresh with default TTL (3600s), but stale with 50s max_age
        self.assertTrue(cache.is_fresh("https://example.com"))
        self.assertFalse(cache.is_fresh("https://example.com", max_age_seconds=50))

    def test_invalidate(self):
        cache = LocalCache()
        record = ContentRecord(url="https://example.com", text="Remove me")
        cache.put("https://example.com", record)
        cache.invalidate("https://example.com")
        self.assertIsNone(cache.get("https://example.com"))

    def test_clear(self):
        cache = LocalCache()
        for i in range(5):
            cache.put(f"https://example.com/{i}", ContentRecord(url=f"https://example.com/{i}"))
        self.assertEqual(cache.size(), 5)
        cache.clear()
        self.assertEqual(cache.size(), 0)


class TestErrorHandling(unittest.TestCase):
    """Test error handling for various HTTP failures."""

    @patch.object(requests.Session, "request")
    def test_network_error_connection(self, mock_request):
        mock_request.side_effect = requests.ConnectionError("refused")
        mp = Marketplace()
        with self.assertRaises(NetworkError):
            mp.check("https://example.com")

    @patch.object(requests.Session, "request")
    def test_network_error_timeout(self, mock_request):
        mock_request.side_effect = requests.Timeout("timed out")
        mp = Marketplace()
        with self.assertRaises(NetworkError):
            mp.check("https://example.com")

    @patch.object(requests.Session, "request")
    def test_server_error_500(self, mock_request):
        mock_request.return_value = _mock_response(500, {"error": "internal"})
        mp = Marketplace()
        with self.assertRaises(ServerError) as ctx:
            mp.check("https://example.com")
        self.assertEqual(ctx.exception.status_code, 500)

    @patch.object(requests.Session, "request")
    def test_server_error_503(self, mock_request):
        mock_request.return_value = _mock_response(503, {"error": "unavailable"})
        mp = Marketplace()
        with self.assertRaises(ServerError):
            mp.check("https://example.com")

    @patch.object(requests.Session, "request")
    def test_client_error_400(self, mock_request):
        mock_request.return_value = _mock_response(400, {"error": "bad request"})
        mp = Marketplace()
        with self.assertRaises(MarketplaceError) as ctx:
            mp.check("https://example.com")
        self.assertEqual(ctx.exception.status_code, 400)

    @patch.object(requests.Session, "request")
    def test_not_found_404(self, mock_request):
        mock_request.return_value = _mock_response(404, {"error": "not found"})
        mp = Marketplace()
        with self.assertRaises(NotFoundError):
            mp.fetch("https://nonexistent.com")


class TestModels(unittest.TestCase):
    """Test data model serialization."""

    def test_content_record_from_dict(self):
        data = {
            "url": "https://example.com",
            "text": "Hello",
            "price": "0.05",
            "token_cost_saved": "500",
        }
        record = ContentRecord.from_dict(data)
        self.assertEqual(record.url, "https://example.com")
        self.assertEqual(record.price, 0.05)
        self.assertEqual(record.token_cost_saved, 500.0)

    def test_content_record_to_dict(self):
        record = ContentRecord(
            url="https://example.com",
            text="Hello",
            price=0.05,
        )
        d = record.to_dict()
        self.assertEqual(d["url"], "https://example.com")
        self.assertEqual(d["text"], "Hello")

    def test_artifact_record_roundtrip(self):
        original = {
            "slug": "my-tool",
            "name": "My Tool",
            "category": "tool",
            "version": "1.2.0",
            "tags": ["python"],
            "price": "2.50",
            "verified": True,
        }
        record = ArtifactRecord.from_dict(original)
        d = record.to_dict()
        self.assertEqual(d["slug"], "my-tool")
        self.assertEqual(d["version"], "1.2.0")
        self.assertEqual(d["price"], 2.50)
        self.assertTrue(d["verified"])


class TestTrendingAndGaps(unittest.TestCase):
    """Test trending and gaps endpoints."""

    @patch.object(requests.Session, "request")
    def test_trending(self, mock_request):
        mock_request.return_value = _mock_response(200, {
            "trending_searches": ["python sdk", "web scraper"],
            "trending_content": [],
            "trending_artifacts": [],
        })
        mp = Marketplace()
        result = mp.trending("7d")
        self.assertIn("trending_searches", result)

    @patch.object(requests.Session, "request")
    def test_gaps(self, mock_request):
        mock_request.return_value = _mock_response(200, {
            "gaps": [
                {"query": "rust web framework", "search_count": 42},
            ]
        })
        mp = Marketplace()
        gaps = mp.gaps(category="tool")
        self.assertEqual(len(gaps), 1)
        self.assertEqual(gaps[0]["query"], "rust web framework")


if __name__ == "__main__":
    unittest.main()
