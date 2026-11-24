'use strict';

// One canonical report object, rendered to Markdown and then to PDF. The report holds no tax rules or rates of
// its own: every update and action comes from the model's reading of the defanged ATO excerpts, tied to a source
// id from the fixed allow-list. When a source or the model is unavailable, the report says so plainly.

const DISCLAIMER = 'General information only, not tax or legal advice. Check the linked ATO page for the exact wording and date, and confirm what applies to you with your accountant.';

function clip(value, max = 1200) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function publicSource(s) {
  return {
    sourceId: String(s.sourceId || ''),
    label: clip(s.label, 120),
    url: String(s.url || ''),
    finalUrl: String(s.finalUrl || ''),
    status: String(s.status || 'unavailable'),
    reason: clip(s.reason, 240),
    hash: String(s.hash || ''),
    title: clip(s.title, 200),
    excerpt: clip(s.excerpt, 1200),
    fetchedAt: s.fetchedAt || null,
  };
}

function buildReport({
  snapshots = [],
  ai = null,
  generatedAt = new Date().toISOString(),
  trigger = 'manual',
  modelId = '',
  aiError = '',
} = {}) {
  const sources = (Array.isArray(snapshots) ? snapshots : []).map(publicSource);
  const readable = sources.filter((s) => s.status === 'ok');
  const byId = new Map(sources.map((s) => [s.sourceId, s]));
  const available = sources.filter((s) => s.status !== 'ok');
  const limits = [];

  if (!readable.length) {
    limits.push('No ATO page could be read this run. Verify each source manually.');
  }
  if (available.length) {
    limits.push(`${available.length} source${available.length === 1 ? '' : 's'} could not be read: ${available.map((s) => s.label).join(', ')}.`);
  }
  if (aiError) limits.push(clip(aiError, 300));
  if (!ai || typeof ai !== 'object') {
    limits.push('The model summary was unavailable. Verify the sources manually.');
  }
  if (Array.isArray(ai?.limits)) {
    for (const line of ai.limits) {
      const clean = clip(line, 300);
      if (clean && !limits.includes(clean)) limits.push(clean);
    }
  }

  const updates = [];
  if (readable.length && ai && typeof ai === 'object') {
    for (const raw of Array.isArray(ai.updates) ? ai.updates : []) {
      const source = byId.get(String(raw?.sourceId || ''));
      if (!source || source.status !== 'ok') continue; // never accept a link or source the model invented
      updates.push({
        title: clip(raw.title, 200) || source.label,
        sourceId: source.sourceId,
        sourceLabel: source.label,
        detail: clip(raw.detail, 1200),
        sharesImpact: clip(raw.sharesImpact, 1200),
        action: clip(raw.action, 1200),
        confidence: ['high', 'medium', 'low'].includes(raw.confidence) ? raw.confidence : 'low',
      });
    }
  }

  const actions = [];
  if (readable.length && ai && typeof ai === 'object') {
    for (const raw of Array.isArray(ai.actions) ? ai.actions : []) {
      const clean = clip(raw, 400);
      if (clean && !actions.includes(clean)) actions.push(clean);
    }
  }
  if (!actions.length) {
    actions.push('Open each source below and check the ATO page for the exact wording, effective date and scope.');
    actions.push('Ask your accountant whether anything you find changes how your share records are kept or reported.');
  }

  const status = !readable.length ? 'unavailable' : (ai?.summary ? 'done' : 'partial');
  const summary = clip(ai?.summary, 2000)
    || (!readable.length
      ? 'ATO sources unavailable — verify manually.'
      : 'ATO sources were read, but the model summary was unavailable — verify manually.');

  return {
    version: 1,
    generatedAt,
    trigger: String(trigger || 'manual'),
    status,
    modelId: String(modelId || ''),
    summary,
    updates,
    actions,
    limits,
    sources,
    disclaimer: DISCLAIMER,
  };
}

function cell(value) {
  return clip(value, 600).replace(/\|/g, '\\|');
}

function markdownFor(report) {
  const r = report || {};
  const lines = [];
  lines.push('# Shares Compliance Advisory');
  lines.push('');
  lines.push(`Generated: ${clip(r.generatedAt, 40)} · ${clip(r.trigger, 20) === 'scheduled' ? 'Monthly check' : 'Manual check'}`);
  lines.push(`Sources read: ${(r.sources || []).filter((s) => s.status === 'ok').length} of ${(r.sources || []).length} · Status: ${clip(r.status, 20)}`);
  lines.push('');
  lines.push(`> ${DISCLAIMER}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(clip(r.summary, 2000) || 'No summary was available — verify the sources manually.');
  lines.push('');

  lines.push('## Updates that may matter for Shares');
  lines.push('');
  if ((r.updates || []).length) {
    lines.push('| Update | What the ATO page says | Why it may matter | Action to consider | Source |');
    lines.push('|---|---|---|---|---|');
    for (const u of r.updates) {
      const source = (r.sources || []).find((s) => s.sourceId === u.sourceId);
      const link = source ? `[${cell(source.label)}](${source.url})` : cell(u.sourceLabel);
      lines.push(`| ${cell(u.title)} | ${cell(u.detail)} | ${cell(u.sharesImpact)} | ${cell(u.action)} (${cell(u.confidence)} confidence) | ${link} |`);
    }
  } else {
    lines.push('_No significant update was identified in the pages that could be read. This is not a guarantee that nothing changed — check the sources below._');
  }
  lines.push('');

  lines.push('## Actions to consider');
  lines.push('');
  for (const action of (r.actions || [])) lines.push(`- ${clip(action, 600)}`);
  lines.push('');

  lines.push('## Sources checked');
  lines.push('');
  lines.push('| Source | Result | Fetched (UTC) | Link |');
  lines.push('|---|---|---|---|');
  for (const s of (r.sources || [])) {
    const result = s.status === 'ok' ? 'Read' : `Source unavailable — verify manually${s.reason ? `: ${cell(s.reason)}` : ''}`;
    lines.push(`| ${cell(s.label)} | ${result} | ${cell(s.fetchedAt || '—')} | [Open ATO page](${s.url}) |`);
  }
  lines.push('');

  if ((r.limits || []).length) {
    lines.push('## Limits of this check');
    lines.push('');
    for (const limit of r.limits) lines.push(`- ${clip(limit, 600)}`);
    lines.push('');
  }

  lines.push('## Verify before acting');
  lines.push('');
  lines.push('This note is general information, not tax or legal advice. It does not state a rate or rule of its own. Read the linked ATO page for the exact wording and effective date, then confirm what applies to your own records with your accountant.');
  lines.push('');
  return lines.join('\n');
}

module.exports = { DISCLAIMER, buildReport, markdownFor, publicSource, clip };
