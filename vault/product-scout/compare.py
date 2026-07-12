"""LLM scoring and structured comparison."""

from __future__ import annotations

import json
import re
from typing import Any

from llm import LLMError, generate

COMPARE_SYSTEM = """You are an unbiased product analyst. Score products on VALUE: features and quality relative to price and reviews — not brand loyalty or Amazon placement.
Identify which product features matter most for the user's specific query before ranking.
Return ONLY a single valid JSON object. No markdown fences. No prose before or after the JSON."""


def _compact_candidates(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "id": i + 1,
            "asin": c.get("asin"),
            "title": str(c.get("title") or "")[:100],
            "price": c.get("price_display") or c.get("price"),
            "rating": c.get("rating"),
            "review_count": c.get("review_count"),
            "feature_bullets": (c.get("feature_bullets") or [])[:3],
        }
        for i, c in enumerate(candidates)
    ]


def _build_prompt(query: str, candidates: list[dict[str, Any]], *, compact: bool = False) -> str:
    payload = {"user_query": query, "candidates": _compact_candidates(candidates)}
    summary_limit = (
        "selection_summary: max 80 words total (one short paragraph). value_rationale: max 20 words each."
        if compact
        else "selection_summary: max 150 words total. value_rationale: max 30 words each."
    )
    return f"""The user is shopping for: {query}

Amazon search results (plain search, not sponsored):
{json.dumps(payload)}

Score each candidate 0–100 on VALUE (features/specs vs price, adjusted for review quality). Pick the top 3.

Also provide:
1. priority_features — 4–5 specs that matter most for THIS query (not marketing fluff), with why_it_matters and importance ("high" or "medium").
2. selection_summary — why you chose these three as a set: tradeoffs, differences, who each suits.

{summary_limit}

Return JSON only:
{{"summary":"...","priority_features":[{{"feature":"...","why_it_matters":"...","importance":"high"}}],"selection_summary":"...","top3":[{{"rank":1,"candidate_id":1,"asin":"...","title":"...","price":"...","rating":4.5,"review_count":1234,"key_features":["..."],"value_score":87,"value_rationale":"..."}}]}}"""


def _parse_comparison(text: str) -> dict[str, Any]:
    raw = (text or "").strip()
    if not raw:
        raise LLMError("LLM returned an empty response — try again or check your model config")

    cleaned = raw
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", cleaned, re.I)
    if fence:
        cleaned = fence.group(1).strip()

    parsed = None
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        obj_start = cleaned.find("{")
        obj_end = cleaned.rfind("}")
        if obj_start != -1 and obj_end > obj_start:
            try:
                parsed = json.loads(cleaned[obj_start : obj_end + 1])
            except json.JSONDecodeError:
                parsed = None

    if not isinstance(parsed, dict):
        preview = re.sub(r"\s+", " ", raw[:200])
        raise LLMError(f"LLM did not return valid JSON. Preview: {preview or '(empty)'}")

    if not isinstance(parsed.get("top3"), list) or not parsed["top3"]:
        raise LLMError("LLM comparison missing top3 array")

    return parsed


def _enrich_top3(result: dict[str, Any], candidates: list[dict[str, Any]]) -> dict[str, Any]:
    by_asin = {c.get("asin"): c for c in candidates if c.get("asin")}
    by_id = {i + 1: c for i, c in enumerate(candidates)}

    for item in result["top3"]:
        cid = item.get("candidate_id")
        src = by_asin.get(item.get("asin")) or (by_id.get(cid) if cid else None)
        if src:
            item.setdefault("link", src.get("link"))
            item.setdefault("feature_bullets", src.get("feature_bullets"))

    return result


def score_and_rank(query: str, candidates: list[dict[str, Any]]) -> dict[str, Any]:
    """Send candidates to the LLM; return structured comparison with top 3."""
    attempts = [
        _build_prompt(query, candidates, compact=False),
        _build_prompt(query, candidates, compact=True),
    ]

    last_err: Exception | None = None
    for i, prompt in enumerate(attempts):
        try:
            text = generate(prompt, system=COMPARE_SYSTEM, max_tokens=8192)
            parsed = _parse_comparison(text)
            return _enrich_top3(parsed, candidates)
        except (LLMError, Exception) as err:
            last_err = err
            if i == len(attempts) - 1:
                break

    raise last_err or LLMError("Product comparison failed")
