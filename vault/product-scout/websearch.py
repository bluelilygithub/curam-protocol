"""Cross-market web search — reuses Vault's SEARCH_API_KEY provider pattern."""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


class WebSearchError(Exception):
    pass


def _api_key() -> str:
    key = os.getenv("SEARCH_API_KEY", "").strip()
    if not key:
        raise WebSearchError(
            "SEARCH_API_KEY is not set. Add Brave, Serper, or SerpAPI key to .env."
        )
    return key


def _provider() -> str:
    explicit = (os.getenv("SEARCH_PROVIDER") or "").strip().lower()
    if explicit:
        return explicit
    key = _api_key()
    if key.startswith("BSA"):
        return "brave"
    if re.fullmatch(r"[a-fA-F0-9]{40}", key):
        return "serper"
    return "serpapi"


def search(query: str, *, num: int = 8) -> list[dict[str, str]]:
    provider = _provider()
    if provider == "brave":
        return _search_brave(query, num=num)
    if provider == "serper":
        return _search_serper(query, num=num)
    if provider == "serpapi":
        return _search_serpapi(query, num=num)
    raise WebSearchError(f"Unsupported SEARCH_PROVIDER={provider!r}")


def cross_market_alternatives(winner: dict[str, Any], original_query: str) -> list[dict[str, str]]:
    """Find non-Amazon alternatives comparable to the winning product."""
    title = winner.get("title") or "product"
    features = winner.get("key_features") or winner.get("feature_bullets") or []
    feat_text = ", ".join(features[:4]) if features else original_query
    q = (
        f"best alternatives to {title} {feat_text} "
        f"-site:amazon.com -site:amazon.com.au review"
    )
    try:
        return search(q, num=8)
    except WebSearchError:
        return search(f"{original_query} best alternatives not amazon", num=6)


def _search_brave(query: str, *, num: int) -> list[dict[str, str]]:
    key = _api_key()
    url = f"https://api.search.brave.com/res/v1/web/search?q={urllib.parse.quote(query)}&count={num}"
    req = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "X-Subscription-Token": key},
    )
    data = _fetch_json(req)
    return [
        {"title": r.get("title") or "", "url": r.get("url") or "", "snippet": r.get("description") or ""}
        for r in (data.get("web", {}).get("results") or [])[:num]
        if r.get("url")
    ]


def _search_serper(query: str, *, num: int) -> list[dict[str, str]]:
    key = _api_key()
    body = json.dumps({"q": query, "num": num}).encode()
    req = urllib.request.Request(
        "https://google.serper.dev/search",
        data=body,
        headers={"X-API-KEY": key, "Content-Type": "application/json"},
        method="POST",
    )
    data = _fetch_json(req)
    return [
        {"title": r.get("title") or "", "url": r.get("link") or "", "snippet": r.get("snippet") or ""}
        for r in (data.get("organic") or [])[:num]
        if r.get("link")
    ]


def _search_serpapi(query: str, *, num: int) -> list[dict[str, str]]:
    key = _api_key()
    url = (
        "https://serpapi.com/search.json?"
        + urllib.parse.urlencode({"q": query, "api_key": key, "num": num, "engine": "google"})
    )
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    data = _fetch_json(req)
    return [
        {"title": r.get("title") or "", "url": r.get("link") or "", "snippet": r.get("snippet") or ""}
        for r in (data.get("organic_results") or [])[:num]
        if r.get("link")
    ]


def _fetch_json(req: urllib.request.Request) -> dict:
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as err:
        if err.code == 429:
            raise WebSearchError("Web search rate limit exceeded.") from err
        raise WebSearchError(f"Web search HTTP {err.code}") from err
    except urllib.error.URLError as err:
        raise WebSearchError(f"Web search failed: {err}") from err
