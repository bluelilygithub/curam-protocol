'use strict';

// Topic Research: the brief as Markdown, for "Copy as Markdown" and "Download .md". One writer for both, so what is copied is what is
// downloaded. Plain Markdown with no HTML. The copy-warning (if the brief repeats a source) comes first so it travels with the file.

const FILE_SLUG_MAX = 60;

const day = (iso) => {
  if (!iso) return ''; // new Date(null) is 1970: no date means no date
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

/** research-brief-heat-pumps-queensland-2026-10-26.md */
function briefFileName(keyword, createdAt) {
  const slug = String(keyword || 'topic').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, FILE_SLUG_MAX).replace(/-+$/g, '') || 'topic';
  const d = day(createdAt);
  return `research-brief-${slug}${d ? `-${d}` : ''}.md`;
}

/**
 * @param brief    the validated brief (brief/schema.js)
 * @param meta     { keyword, createdAt, angle, overlap: [...], sources: [{ url, title, domain }] }  sources in citation order
 */
function briefToMarkdown(brief, { keyword = '', createdAt = null, overlap = [], sources = [] } = {}) {
  const cite = new Map(sources.map((s, i) => [s.url, i + 1]));
  const refs = (urls) => urls.map((u) => (cite.has(u) ? `[${cite.get(u)}]` : null)).filter(Boolean).join('');
  const out = [];
  out.push(`# Research brief: ${keyword}`);
  const when = day(createdAt);
  out.push(`_${when ? `Made ${when}. ` : ''}Notes for writing your own piece. Not text to publish._`);

  if (overlap.length) {
    out.push([
      '> **Check before you use this:** part of this brief repeats wording from a source. Rewrite these in your own words:',
      ...overlap.map((o) => `> - ${o.field}: "${o.excerpt}…" (${o.words} words match source: ${o.sourceTitle || o.sourceUrl})`),
    ].join('\n'));
  }

  out.push('## Summary', brief.summary);

  out.push('## Key facts');
  out.push(brief.keyFacts.map((f) => `- ${f.fact}${f.singleSource ? ' _(single source)_' : ` _(${f.outletCount} outlets)_`} ${refs(f.sources)}`.trimEnd()).join('\n'));

  if (brief.anglesTaken.length) out.push('## Angles taken', brief.anglesTaken.map((a) => `- **${a.outlet}:** ${a.framing}`).join('\n'));
  if (brief.gaps.length) out.push('## Gaps', brief.gaps.map((g) => `- ${g}`).join('\n'));

  out.push('## Suggested angles for your site', brief.suggestedAngles.map((a, i) => `${i + 1}. **${a.title}**${a.why ? `: ${a.why}` : ''}`).join('\n'));

  out.push(`## Outline: ${brief.chosenAngle}`);
  out.push(brief.outline.map((o) => [`${o.level === 3 ? '####' : '###'} ${o.heading}`, ...o.notes.map((n) => `- ${n}`)].join('\n')).join('\n\n'));

  out.push('## Keywords', `- Primary: ${brief.keywords.primary}`, ...(brief.keywords.related.length ? [`- Related: ${brief.keywords.related.join(', ')}`] : []));

  if (sources.length) out.push('## Sources', sources.map((s, i) => `${i + 1}. ${s.title || s.url} (${s.domain || ''}) ${s.url}`.replace(/\s+\(\)\s*/, ' ')).join('\n'));

  return `${out.join('\n\n')}\n`;
}

module.exports = { briefToMarkdown, briefFileName };
