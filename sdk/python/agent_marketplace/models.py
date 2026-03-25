"""Data models for the Agent Marketplace SDK."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class ContentRecord:
    """Represents a clean, AI-ready version of a web page.

    Attributes:
        url: The original URL this content was fetched from.
        source_hash: SHA-256 hash of the raw source HTML.
        fetched_at: ISO 8601 timestamp of when the content was fetched.
        text: Clean plaintext extracted from the page.
        structured: Parsed structural elements (headings, code_blocks, lists, tables).
        links: List of links found on the page.
        metadata: Page metadata (title, author, date, description).
        price: Price paid (or to be charged) for this content in credits.
        token_cost_saved: Estimated token cost saved by using pre-cleaned content.
    """

    url: str
    source_hash: str = ""
    fetched_at: str = ""
    text: str = ""
    structured: Dict[str, Any] = field(default_factory=dict)
    links: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    price: float = 0.0
    token_cost_saved: float = 0.0

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> ContentRecord:
        """Create a ContentRecord from a dictionary (e.g. API response).

        Handles both SDK-style keys (text, structured, links, metadata)
        and server-style keys (content_text, content_structured, content_links, content_metadata).
        """
        import json

        def _parse_json_field(val):
            if isinstance(val, str):
                try:
                    return json.loads(val)
                except (json.JSONDecodeError, TypeError):
                    return val
            return val if val is not None else {}

        return cls(
            url=data.get("url", ""),
            source_hash=data.get("source_hash", ""),
            fetched_at=data.get("fetched_at", ""),
            text=data.get("text", "") or data.get("content_text", "") or "",
            structured=_parse_json_field(data.get("structured") or data.get("content_structured") or {}),
            links=_parse_json_field(data.get("links") or data.get("content_links") or []),
            metadata=_parse_json_field(data.get("metadata") or data.get("content_metadata") or {}),
            price=float(data.get("price", 0.0) or 0.0),
            token_cost_saved=float(data.get("token_cost_saved", 0.0) or 0.0),
        )

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to a dictionary."""
        return {
            "url": self.url,
            "source_hash": self.source_hash,
            "fetched_at": self.fetched_at,
            "text": self.text,
            "structured": self.structured,
            "links": self.links,
            "metadata": self.metadata,
            "price": self.price,
            "token_cost_saved": self.token_cost_saved,
        }


@dataclass
class ArtifactRecord:
    """Represents a build artifact in the marketplace.

    Attributes:
        slug: URL-safe unique identifier for the artifact.
        name: Human-readable name.
        category: Category (e.g. 'tool', 'library', 'template', 'dataset').
        version: Semantic version string.
        description: What the artifact does and who it's for.
        tags: Searchable tags.
        files: List of file paths/names included in the artifact.
        price: Price in credits.
        verified: Whether the artifact has been verified by the marketplace.
    """

    slug: str
    name: str = ""
    category: str = ""
    version: str = "0.1.0"
    description: str = ""
    tags: List[str] = field(default_factory=list)
    files: List[str] = field(default_factory=list)
    price: float = 0.0
    verified: bool = False

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> ArtifactRecord:
        """Create an ArtifactRecord from a dictionary (e.g. API response).

        Handles JSON-encoded strings for list fields (tags, files) from the server.
        """
        import json

        def _parse_list(val):
            if isinstance(val, str):
                try:
                    return json.loads(val)
                except (json.JSONDecodeError, TypeError):
                    return []
            return val if val is not None else []

        return cls(
            slug=data.get("slug", ""),
            name=data.get("name", ""),
            category=data.get("category", "") or "",
            version=data.get("version", "0.1.0") or "0.1.0",
            description=data.get("description", "") or "",
            tags=_parse_list(data.get("tags", [])),
            files=_parse_list(data.get("files", [])),
            price=float(data.get("price", 0.0) or 0.0),
            verified=bool(data.get("verified", False)),
        )

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to a dictionary."""
        return {
            "slug": self.slug,
            "name": self.name,
            "category": self.category,
            "version": self.version,
            "description": self.description,
            "tags": self.tags,
            "files": self.files,
            "price": self.price,
            "verified": self.verified,
        }
