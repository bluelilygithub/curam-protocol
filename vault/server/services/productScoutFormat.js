'use strict';

function mdCell(value) {
  return String(value ?? '—').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
}

/**
 * @param {{ query: string, comparison?: object, external_alternatives?: object[] }} result
 */
function formatMarkdown(result) {
  const lines = [`# Amazon Search — ${result.query}`, ''];
  const comp = result.comparison || {};

  if (comp.summary) {
    lines.push(comp.summary, '');
  }

  const priority = comp.priority_features || [];
  if (priority.length) {
    lines.push('## Features that matter most', '');
    for (const pf of priority) {
      const imp = pf.importance ? ` *(${pf.importance})*` : '';
      lines.push(`- **${mdCell(pf.feature)}**${imp} — ${mdCell(pf.why_it_matters)}`);
    }
    lines.push('');
  }

  if (comp.selection_summary) {
    lines.push('## Why these three?', '', comp.selection_summary, '');
  }

  lines.push('## Top 3 on Amazon', '');
  lines.push('| Rank | Product | Price | Rating | Reviews | Value | Key features |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');

  for (const item of comp.top3 || []) {
    const rating = item.rating != null ? `${item.rating}★` : '—';
    const reviews = item.review_count != null ? Number(item.review_count).toLocaleString() : '—';
    const features = (item.key_features || []).slice(0, 3).join('; ') || '—';
    lines.push(
      `| ${item.rank ?? '—'} | ${mdCell((item.title || '').slice(0, 70))} | ${mdCell(item.price)} | ${rating} | ${reviews} | **${item.value_score ?? '—'}** | ${mdCell(features)} |`
    );
  }
  lines.push('');

  for (const item of comp.top3 || []) {
    lines.push(`### #${item.rank} — ${mdCell(item.title)}`, '');
    if (item.value_rationale) lines.push(item.value_rationale, '');
    if (item.link) lines.push(`[View on Amazon](${item.link})`, '');
  }

  const stretch = comp.stretch_suggestions || [];
  if (stretch.length) {
    const budget = result.budget;
    lines.push('## Slightly over budget', '');
    if (budget?.maxPrice) {
      lines.push(`_Above max price of $${budget.maxPrice}._`, '');
    }
    for (const item of stretch) {
      const over = item.over_budget_pct != null ? ` (+${item.over_budget_pct}%)` : '';
      lines.push(`### ${mdCell(item.title)} — ${mdCell(item.price)}${over}`, '');
      if (item.stretch_rationale) lines.push(item.stretch_rationale, '');
      else if (item.value_rationale) lines.push(item.value_rationale, '');
      if (item.link) lines.push(`[View on Amazon](${item.link})`, '');
    }
  }

  const ext = result.external_alternatives || [];
  if (ext.length) {
    lines.push('## External alternatives (non-Amazon)', '');
    for (const alt of ext.slice(0, 6)) {
      lines.push(`- [${mdCell(alt.title)}](${alt.url}) — ${mdCell((alt.snippet || '').slice(0, 120))}`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

module.exports = { formatMarkdown, mdCell };
