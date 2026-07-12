#!/usr/bin/env python3
"""product-scout — unbiased Amazon product comparison CLI."""

from __future__ import annotations

import argparse
import json
import sys

from dotenv import load_dotenv

load_dotenv()

from amazon import AmazonError, search_products
from compare import score_and_rank
from llm import LLMError
from websearch import WebSearchError, cross_market_alternatives


def run_pipeline(query: str) -> dict:
    candidates = search_products(query, max_results=10)
    comparison = score_and_rank(query, candidates)
    top3 = comparison.get("top3") or []
    winner = top3[0] if top3 else {}

    external: list[dict] = []
    if winner:
        try:
            external = cross_market_alternatives(winner, query)
        except WebSearchError:
            external = []

    return {
        "query": query,
        "candidates_fetched": len(candidates),
        "comparison": comparison,
        "external_alternatives": external,
    }


def format_markdown(result: dict) -> str:
    lines = [f"# Product Scout — {result['query']}\n"]
    comp = result.get("comparison") or {}
    if comp.get("summary"):
        lines.append(f"{comp['summary']}\n")

    lines.append("## Top 3 on Amazon\n")
    lines.append("| Rank | Product | Price | Rating | Reviews | Value | Key features |")
    lines.append("|------|---------|-------|--------|---------|-------|--------------|")

    for item in comp.get("top3") or []:
        rating = item.get("rating")
        rating_str = f"{rating}★" if rating is not None else "—"
        reviews = item.get("review_count") or "—"
        features = "; ".join((item.get("key_features") or [])[:3]) or "—"
        title = (item.get("title") or "")[:60]
        lines.append(
            f"| {item.get('rank', '—')} | {title} | {item.get('price', '—')} | "
            f"{rating_str} | {reviews} | **{item.get('value_score', '—')}** | {features} |"
        )

    for item in comp.get("top3") or []:
        if item.get("value_rationale"):
            lines.append(f"\n**#{item.get('rank')} rationale:** {item['value_rationale']}")
        if item.get("link"):
            lines.append(f"- [Amazon link]({item['link']})")

    externals = result.get("external_alternatives") or []
    if externals:
        lines.append("\n## External alternatives (non-Amazon)\n")
        for alt in externals[:6]:
            title = alt.get("title") or alt.get("url") or "Result"
            url = alt.get("url") or ""
            snippet = (alt.get("snippet") or "")[:120]
            lines.append(f"- [{title}]({url}) — {snippet}")
    else:
        lines.append("\n## External alternatives\n")
        lines.append("_No cross-market results (SEARCH_API_KEY not set or search failed)._")

    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compare Amazon products and find external alternatives."
    )
    parser.add_argument("query", help='Product search, e.g. "wireless earbuds under $150"')
    parser.add_argument("--json", action="store_true", help="Output raw JSON instead of markdown")
    args = parser.parse_args()

    try:
        result = run_pipeline(args.query)
    except AmazonError as err:
        print(f"Amazon error: {err}", file=sys.stderr)
        return 1
    except LLMError as err:
        print(f"LLM error: {err}", file=sys.stderr)
        return 1
    except WebSearchError as err:
        print(f"Search error: {err}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Cancelled.", file=sys.stderr)
        return 130

    if args.json:
        print(json.dumps(result, indent=2, default=str))
    else:
        print(format_markdown(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
