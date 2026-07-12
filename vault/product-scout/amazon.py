"""Fetch Amazon search results via Rainforest API."""

from __future__ import annotations

import os
from typing import Any

import requests


class AmazonError(Exception):
    pass


RAINFOREST_URL = "https://api.rainforestapi.com/request"


def _api_key() -> str:
    key = os.getenv("RAINFOREST_API_KEY", "").strip()
    if not key:
        raise AmazonError(
            "RAINFOREST_API_KEY is not set. Add it to .env — see .env.example."
        )
    return key


def _domain() -> str:
    return os.getenv("AMAZON_DOMAIN", "amazon.com.au").strip() or "amazon.com.au"


def search_products(query: str, *, max_results: int = 10) -> list[dict[str, Any]]:
    """Return normalized candidates from a plain Amazon search (not sponsored picks)."""
    params = {
        "api_key": _api_key(),
        "type": "search",
        "amazon_domain": _domain(),
        "search_term": query.strip(),
        "number_of_results": str(max_results),
        "exclude_sponsored": "true",
    }

    try:
        resp = requests.get(RAINFOREST_URL, params=params, timeout=45)
    except requests.RequestException as err:
        raise AmazonError(f"Rainforest request failed: {err}") from err

    if resp.status_code == 429:
        raise AmazonError("Rainforest API rate limit exceeded — try again shortly.")
    if resp.status_code == 401:
        raise AmazonError("Rainforest API key invalid or unauthorised.")
    if not resp.ok:
        raise AmazonError(f"Rainforest API error HTTP {resp.status_code}: {resp.text[:300]}")

    data = resp.json()
    if data.get("request_info", {}).get("success") is False:
        raise AmazonError(data.get("request_info", {}).get("message") or "Rainforest search failed")

    raw_results = data.get("search_results") or []
    candidates: list[dict[str, Any]] = []

    for item in raw_results:
        if len(candidates) >= max_results:
            break
        if not isinstance(item, dict):
            continue
        title = (item.get("title") or "").strip()
        if not title:
            continue

        price_obj = item.get("price") or {}
        price_value = price_obj.get("value")
        price_raw = price_obj.get("raw") or (f"${price_value}" if price_value else None)

        bullets = item.get("feature_bullets") or []
        if not bullets and item.get("description"):
            bullets = [item["description"]]

        candidates.append({
            "asin": item.get("asin"),
            "title": title,
            "price": price_value,
            "price_display": price_raw,
            "currency": price_obj.get("currency") or "USD",
            "rating": item.get("rating"),
            "review_count": item.get("ratings_total") or item.get("reviews_total"),
            "feature_bullets": bullets[:6],
            "link": item.get("link"),
            "is_prime": bool(item.get("is_prime")),
            "position": item.get("position"),
        })

    if not candidates:
        raise AmazonError(f"No Amazon search results for query: {query!r}")

    return candidates
