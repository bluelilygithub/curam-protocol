"""LLM scoring and structured comparison."""

from __future__ import annotations

import json
from typing import Any

from llm import LLMError, generate_json

COMPARE_SYSTEM = """You are an unbiased product analyst. Score products on VALUE: features and quality relative to price and reviews — not brand loyalty or Amazon placement.
Identify which product features matter most for the user's specific query before ranking.
Return ONLY valid JSON matching the schema requested. No markdown fences. No prose outside JSON."""


def score_and_rank(query: str, candidates: list[dict[str, Any]]) -> dict[str, Any]:
    """Send candidates to the LLM; return structured comparison with top 3."""
    payload = {
        "user_query": query,
        "candidates": [
            {
                "id": i + 1,
                "asin": c.get("asin"),
                "title": c.get("title"),
                "price": c.get("price_display") or c.get("price"),
                "rating": c.get("rating"),
                "review_count": c.get("review_count"),
                "feature_bullets": c.get("feature_bullets") or [],
            }
            for i, c in enumerate(candidates)
        ],
    }

    prompt = f"""The user is shopping for: {query}

Here are Amazon search results (plain search, not sponsored):
{json.dumps(payload, indent=2)}

Analyze all candidates. Score each 0–100 on VALUE (features/specs vs price, adjusted for review quality).
Pick the top 3 by value score.

Also:
1. List 4–6 priority_features — the specs that matter most for THIS query (not generic marketing fluff), each with why_it_matters and importance ("high" or "medium").
2. Write selection_summary — 2–3 short paragraphs explaining why you chose these three as a set: what tradeoffs each represents, how they differ, and who each pick suits best.

Return JSON exactly in this shape:
{{
  "summary": "One sentence overall recommendation framing",
  "priority_features": [
    {{ "feature": "Active noise cancellation", "why_it_matters": "...", "importance": "high" }}
  ],
  "selection_summary": "Paragraph 1...\\n\\nParagraph 2...",
  "top3": [
    {{
      "rank": 1,
      "candidate_id": 1,
      "asin": "...",
      "title": "...",
      "price": "...",
      "rating": 4.5,
      "review_count": 1234,
      "key_features": ["bullet1", "bullet2", "bullet3"],
      "value_score": 87,
      "value_rationale": "Short why this score"
    }}
  ],
  "all_scores": [
    {{ "candidate_id": 1, "value_score": 87, "title": "..." }}
  ]
}}"""

    try:
        result = generate_json(prompt, system=COMPARE_SYSTEM, max_tokens=4096)
    except LLMError:
        raise
    except Exception as err:
        raise LLMError(f"Comparison failed: {err}") from err

    if not isinstance(result, dict) or not result.get("top3"):
        raise LLMError("LLM comparison missing top3 array")

    # Enrich top3 with links from original candidates
    by_asin = {c.get("asin"): c for c in candidates if c.get("asin")}
    by_id = {i + 1: c for i, c in enumerate(candidates)}

    for item in result["top3"]:
        cid = item.get("candidate_id")
        src = by_asin.get(item.get("asin")) or (by_id.get(cid) if cid else None)
        if src:
            item.setdefault("link", src.get("link"))
            item.setdefault("feature_bullets", src.get("feature_bullets"))

    return result
