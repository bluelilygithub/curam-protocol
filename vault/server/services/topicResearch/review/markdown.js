'use strict';

// Topic Research: a structure verdict as Markdown, for "Copy as Markdown". Plain Markdown with no HTML. It is advice for the writer, and says so.

const day = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

/**
 * @param review  the validated verdict (review/schema.js)
 * @param meta    { createdAt, model, keyword, sources: [{ url, title, domain }] } sources in the brief's citation order
 */
function reviewToMarkdown(review, { createdAt = null, model = '', keyword = '', sources = [] } = {}) {
  const when = day(createdAt);
  const refs = (nums) => (nums || []).filter((n) => sources[n - 1]).map((n) => `[${n}]`).join('');
  const out = [];
  out.push(`# Structure verdict${keyword ? `: ${keyword}` : ''}`);
  out.push(`_${when ? `Made ${when}` : 'A second opinion'}${model ? ` by ${model}` : ''}. Advice on structure for you to weigh, not text to publish. It can be wrong: check it against your own knowledge._`);
  out.push(`## Verdict\n\n${review.verdict}`);
  if (review.thesis) out.push(`**Thesis:** ${review.thesis}`);
  if (review.titleOptions.length) out.push(`## Working titles\n\n${review.titleOptions.map((t) => `- ${t}`).join('\n')}`);
  out.push('## Recommended structure');
  review.structure.forEach((s, i) => {
    const parts = [`### ${i + 1}. ${s.heading}`];
    if (s.purpose) parts.push(`**Purpose:** ${s.purpose}`);
    if (s.contents) parts.push(`**What goes here:** ${s.contents}${s.sources.length ? ` ${refs(s.sources)}` : ''}`);
    else if (s.sources.length) parts.push(`**Sources:** ${refs(s.sources)}`);
    if (s.writerInput) parts.push(`**Needs your input:** ${s.writerInput}`);
    out.push(parts.join('\n\n'));
  });
  if (review.moves.length) out.push(`## Changes to the current draft\n\n${review.moves.map((m) => `- **${m.action}:** ${m.detail}`).join('\n')}`);
  if (review.missingEvidence.length) out.push(`## Evidence still missing\n\n${review.missingEvidence.map((x) => `- ${x}`).join('\n')}`);
  if (review.risks.length) out.push(`## Risks\n\n${review.risks.map((x) => `- ${x}`).join('\n')}`);
  if (sources.length) out.push('## Sources', sources.map((s, i) => `${i + 1}. ${s.title || s.url} (${s.domain || ''}) ${s.url}`.replace(/\s+\(\)\s*/, ' ')).join('\n'));
  return `${out.join('\n\n')}\n`;
}

module.exports = { reviewToMarkdown };
