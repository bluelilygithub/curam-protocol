"""Markdown formatting for CLI output."""

from __future__ import annotations


def _md_cell(value: object) -> str:
    return str(value if value is not None else "—").replace("|", "\\|").replace("\n", " ").strip()


def format_markdown(result: dict) -> str:
    lines = [f"# Product Scout — {result['query']}", ""]
    comp = result.get("comparison") or {}

    if comp.get("summary"):
        lines.extend([comp["summary"], ""])

    priority = comp.get("priority_features") or []
    if priority:
        lines.extend(["## Features that matter most", ""])
        for pf in priority:
            imp = f" *({pf.get('importance')})*" if pf.get("importance") else ""
            lines.append(
                f"- **{_md_cell(pf.get('feature'))}**{imp} — {_md_cell(pf.get('why_it_matters'))}"
            )
        lines.append("")

    if comp.get("selection_summary"):
        lines.extend(["## Why these three?", "", comp["selection_summary"], ""])

    lines.extend(["## Top 3 on Amazon", ""])
    lines.extend([
        "| Rank | Product | Price | Rating | Reviews | Value | Key features |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ])

    for item in comp.get("top3") or []:
        rating = item.get("rating")
        rating_str = f"{rating}★" if rating is not None else "—"
        reviews = item.get("review_count")
        reviews_str = f"{reviews:,}" if isinstance(reviews, int) else (str(reviews) if reviews else "—")
        features = "; ".join((item.get("key_features") or [])[:3]) or "—"
        title = _md_cell((item.get("title") or "")[:70])
        lines.append(
            f"| {item.get('rank', '—')} | {title} | {_md_cell(item.get('price'))} | "
            f"{rating_str} | {reviews_str} | **{item.get('value_score', '—')}** | {_md_cell(features)} |"
        )
    lines.append("")

    for item in comp.get("top3") or []:
        lines.extend([f"### #{item.get('rank')} — {_md_cell(item.get('title'))}", ""])
        if item.get("value_rationale"):
            lines.extend([item["value_rationale"], ""])
        if item.get("link"):
            lines.extend([f"[View on Amazon]({item['link']})", ""])

    externals = result.get("external_alternatives") or []
    if externals:
        lines.extend(["## External alternatives (non-Amazon)", ""])
        for alt in externals[:6]:
            title = _md_cell(alt.get("title") or alt.get("url") or "Result")
            url = alt.get("url") or ""
            snippet = _md_cell((alt.get("snippet") or "")[:120])
            lines.append(f"- [{title}]({url}) — {snippet}")
        lines.append("")
    else:
        lines.extend(["## External alternatives", "", "_No cross-market results (SEARCH_API_KEY not set or search failed)._", ""])

    return "\n".join(lines) + "\n"
