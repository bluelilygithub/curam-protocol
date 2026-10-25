'use strict';

// Topic Research: the draft as Markdown, for "Copy as Markdown" and "Download .md". One writer for both, so what is copied is what is
// downloaded. Plain Markdown with no HTML. The warnings (copied wording, left-out claims, gaps) come first so they travel with the file.

const FILE_SLUG_MAX = 60;

const day = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

/** draft-heat-pumps-queensland-2026-10-26.md */
function draftFileName(keyword, createdAt) {
  const slug = String(keyword || 'topic').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, FILE_SLUG_MAX).replace(/-+$/g, '') || 'topic';
  const d = day(createdAt);
  return `draft-${slug}${d ? `-${d}` : ''}.md`;
}

/**
 * @param draft   the validated draft (draft/schema.js)
 * @param meta    { createdAt, overlap: [...], sources: [{ url, title, domain }] } sources in the brief's citation order
 */
function draftToMarkdown(draft, { createdAt = null, overlap = [], sources = [] } = {}) {
  const cite = new Map(sources.map((s, i) => [s.url, i + 1]));
  const refs = (urls) => urls.map((u) => (cite.has(u) ? `[${cite.get(u)}]` : null)).filter(Boolean).join('');
  const gaps = draft.sections.reduce((n, s) => n + s.paragraphs.filter((p) => p.kind === 'gap').length, 0);
  const out = [];
  out.push(`# ${draft.title}`);
  const when = day(createdAt);
  out.push(`_${when ? `Draft made ${when}. ` : 'Draft. '}A starting point built from your research brief, for you to edit. Check every fact against its sources before you publish._`);

  const notes = [];
  if (gaps) notes.push(`${gaps} place${gaps === 1 ? '' : 's'} marked **[needs your input]** for you to fill.`);
  if (overlap.length) {
    notes.push('Part of this draft repeats wording from a source or from the brief. Rewrite these in your own words:');
    overlap.forEach((o) => notes.push(`  - ${o.field}: "${o.excerpt}…" (${o.words} words match ${o.sourceUrl === 'brief' ? 'your research brief' : `source: ${o.sourceTitle || o.sourceUrl}`})`));
  }
  if (notes.length) out.push(`> **Before you use this:**\n${notes.map((n) => (n.startsWith('  ') ? `> ${n}` : `> - ${n}`)).join('\n')}`);

  for (const s of draft.sections) {
    const body = s.paragraphs.map((p) => (p.kind === 'gap' ? `**[needs your input: ${p.text}]**` : `${p.text}${p.sources.length ? ` ${refs(p.sources)}` : ''}`.trimEnd()));
    out.push(...(s.heading ? [`## ${s.heading}`] : []), ...body);
  }

  if (sources.length) out.push('## Sources', sources.map((s, i) => `${i + 1}. ${s.title || s.url} (${s.domain || ''}) ${s.url}`.replace(/\s+\(\)\s*/, ' ')).join('\n'));
  return `${out.join('\n\n')}\n`;
}

module.exports = { draftToMarkdown, draftFileName };
