// Builds the "Copy for AI" prompt for one Page speed run: an instruction to an LLM about what to weigh up when
// proposing improvements, with the selected device's findings attached as evidence. This replaces the old
// single-device developer-brief copy; the raw brief is still available for both devices via "Copy mobile + desktop"
// and in the PDF's Developer detail. Test: node client/src/pages/pageSpeed/pageSpeedLlmBrief.test.mjs

import { METRIC_HELP, FIELD_HELP, FIELD_CATEGORY_HELP, PRIORITY_GROUPS, humanEvidence } from './pageSpeedActions.mjs';

// Keep the prompt useful without pasting thousands of lines. The work order already carries the main evidence;
// the raw finding lists are capped per finding.
const MAX_ITEMS = 10;

export const LLM_INSTRUCTION = `# Task: turn this PageSpeed Insights result into an improvement plan

You are a senior web performance, accessibility and SEO consultant. The PageSpeed Insights result below is evidence, not the plan. Use it to produce a practical, prioritised improvement plan for the person who owns this page.

## Before you recommend anything, establish (ask if the answer is not in the brief)
- What the page is for and what a visitor should do on it (enquire, buy, read, book).
- The platform or CMS, and who can change what: developer, content editor, host or agency.
- Budget, time and any deadline. Say when a fix needs a developer or a hosting change.
- The audience: mobile share, locations, languages, connection quality, assistive technology.
- What must not change: forms, chat, analytics, ads, consent, personalisation, brand.
- The accessibility target (for example WCAG 2.2 AA) and any legal or procurement requirement.
- The page's role in search: target queries, whether it must rank, and any campaign landing page.
- Whether there is a staging site, a release process, and how success will be measured.

## Things to consider
1. **Real users before lab scores.** Chrome UX Report (field) data describes actual visitors; the Lighthouse lab test is one synthetic run and can move several points. If they disagree, trust the field data for priorities and the lab data for causes.
2. **Mobile first.** Google mostly ranks the mobile version. Fix the mobile result first unless the evidence shows a desktop-only problem.
3. **Impact x effort x risk.** Rank by expected user and business impact, not by Lighthouse score alone. Separate quick wins (config, content, caching, image compression) from structural work (bundles, rendering, platform changes).
4. **Do not just restate Lighthouse.** Explain the cause, the user consequence, the likely fix, and how to verify it. If the report does not contain enough evidence for a cause, say so and say what to collect.
5. **Trade-offs and risk.** Note what a fix could break (layout, tracking, consent, personalisation, caching, SEO), what needs testing, and what should be rolled back if it does not work.
6. **Accessibility is not a score chase.** Consider keyboard use, screen readers, contrast, focus, labels, target size, motion, zoom and plain language. A 100 score does not prove WCAG compliance; say what still needs a manual check.
7. **SEO basics and intent.** Check title, description, headings, canonical, indexability, internal links, structured data and search intent. Do not promise rankings.
8. **Best practices and trust.** HTTPS, console errors, deprecated APIs, third-party cookies, browser warnings and mixed content affect trust as well as the score.
9. **Third parties.** Ads, chat, tag managers, fonts, social embeds and analytics are common causes of slow mobile pages. Ask which are essential and whether they can load later or be removed.
10. **Delivery and hosting.** Consider caching, compression, CDN, HTTP/2 or 3, server response time, redirects and image/format pipelines before recommending code changes.
11. **Images, fonts and layout stability.** Check dimensions, formats (WebP or AVIF), responsive sizes, lazy loading (never the hero), font loading and reserved space to stop layout shift.
12. **JavaScript and rendering.** Look for unused or duplicated code, render-blocking resources, long tasks, hydration cost and heavy widgets. Prefer removing over optimising.
13. **What not to change.** Preserve functionality, analytics, consent, SEO equity, accessibility features and brand. Do not recommend deleting things merely because Lighthouse flags them.
14. **Measurement.** Say how to prove the fix worked: re-run PageSpeed after release, watch field data (it lags by about 28 days), Search Console or Core Web Vitals, and any real-user monitoring. Set a baseline and a check date.
15. **Uncertainty.** Mark estimates as estimates. Do not invent file names, plugin names, code, scores or causes that are not in the evidence. Ask for missing context instead of guessing.

## Output
1. A short diagnosis (3-5 bullets): what is actually holding the page back.
2. A prioritised table with columns: Action | Why it matters | Evidence from the report | Effort | Who | Expected impact | Risk or confidence.
3. A phased plan: Now (this week) / Next (this month) / Later (structural).
4. What to measure, and how to confirm each fix worked.
5. Open questions and missing context.
6. A short "do not bother" list: low-value items for this page, with the reason.

Keep the plan practical and specific to this page. Where the report is thin, say what you would check next.`;

function deviceLabel(view) {
  return view?.strategy === 'desktop' ? 'Desktop' : 'Mobile';
}

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function metricLine(m) {
  const help = String(METRIC_HELP[m.id] || '').replace(/^[^:]+:\s*/, '');
  const value = m.displayValue || (m.numericValue != null ? String(Math.round(m.numericValue)) : '-');
  const ms = m.id !== 'cumulative-layout-shift' && m.numericValue != null
    ? ` (${Math.round(m.numericValue)} ms)`
    : '';
  return `- ${m.title}: ${value}${ms}${help ? ` - ${help}` : ''}`;
}

function fieldLine(m) {
  const [label, help] = FIELD_HELP[m.id] || [String(m.id || '').replace(/_/g, ' ').toLowerCase(), ''];
  const value = `${m.category || '-'}${m.percentile != null ? ` ${m.percentile}` : ''}`;
  return `- ${label}: ${value}${help ? ` - ${help}` : ''}`;
}

function itemLine(it) {
  const h = humanEvidence(it);
  return [h.where, h.detail].filter(Boolean).join(' - ');
}

function workOrderBlock(lines, workOrder) {
  lines.push('', '## Ranked work order');
  if (!workOrder.length) {
    lines.push('- None');
    return;
  }
  for (const g of PRIORITY_GROUPS) {
    const rows = workOrder.filter((t) => t.priority === g.id);
    if (!rows.length) continue;
    lines.push('', `### ${g.id} - ${g.label} (${rows.length})`);
    for (const t of rows) {
      lines.push(`- **${t.title}**${t.categoryLabel ? ` - ${t.categoryLabel}` : ''}`);
      if (t.action) lines.push(`  - What to do: ${t.action}`);
      const evidence = t.evidence || [];
      for (const ev of evidence.slice(0, MAX_ITEMS)) lines.push(`  - ${ev}`);
      if (evidence.length > MAX_ITEMS) lines.push(`  - ... and ${evidence.length - MAX_ITEMS} more`);
    }
  }
}

function findingBlock(lines, title, items) {
  lines.push('', `## ${title}`);
  if (!items.length) {
    lines.push('- None');
    return;
  }
  for (const o of items) {
    const save = o.displayValue
      || [o.savingsMs ? `${o.savingsMs} ms` : '', o.savingsBytes ? `${Math.round(o.savingsBytes / 1024)} KiB` : ''].filter(Boolean).join(', ');
    lines.push(`### ${o.title}${save ? ` (${save})` : ''}`);
    if (o.description) lines.push(o.description);
    if (o.docsUrl) lines.push(`Docs: ${o.docsUrl}`);
    const rows = (o.items || []).map(itemLine).filter(Boolean);
    for (const row of rows.slice(0, MAX_ITEMS)) lines.push(`- ${row}`);
    if (rows.length > MAX_ITEMS) lines.push(`- ... and ${rows.length - MAX_ITEMS} more`);
  }
}

/**
 * The full "Copy for AI" text for one view (mobile or desktop). `view` is the same object the Report tab uses.
 * Returns the instruction alone when there is no view, so the button never copies an empty string.
 */
export function buildLlmBrief(view) {
  if (!view) return LLM_INSTRUCTION;
  const c = view.categories || {};
  const lines = [
    LLM_INSTRUCTION,
    '',
    '---',
    '',
    '# The PageSpeed Insights result',
    '',
    `- URL: ${view.finalUrl || ''}`,
    `- Device: ${deviceLabel(view)}`,
    `- Tested: ${fmtDate(view.fetchTime) || 'unknown'}`,
    `- Lighthouse: ${view.lighthouseVersion || 'unknown'}`,
    `- Scores: Performance ${c.performance ?? '-'} / Accessibility ${c.accessibility ?? '-'} / Best practices ${c.bestPractices ?? '-'} / SEO ${c.seo ?? '-'}`,
  ];
  if (view.summary) lines.push(`- Summary: ${view.summary}`);

  lines.push('', '## Lab metrics (one synthetic test)');
  if (view.metrics?.length) lines.push(...view.metrics.map(metricLine));
  else lines.push('- None');

  lines.push('', '## Real visitor data (Chrome UX Report, last 28 days)');
  if (view.fieldData?.length) {
    lines.push(FIELD_CATEGORY_HELP);
    lines.push(...view.fieldData.map(fieldLine));
  } else {
    lines.push('No field data: the site may be too small for Google to have enough real visitors.');
  }

  workOrderBlock(lines, view.workOrder || []);
  findingBlock(lines, 'Performance opportunities', view.opportunities || []);
  findingBlock(lines, 'Diagnostics', view.diagnostics || []);
  findingBlock(lines, 'Failed checks', view.failedAudits || []);
  findingBlock(lines, 'Warnings', view.warnings || []);

  return `${lines.join('\n').trim()}\n`;
}
