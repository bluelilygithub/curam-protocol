// Copy / download a Skill Scanner report. Pure, so it is tested without a browser:
//   node client/src/pages/skillScan/exportReport.test.mjs
// Input: a scan as GET /api/skill-scan/scans/:id returns it ({ ...row, report, summary, groups }).

export const VERDICT_LABEL = { SAFE: 'Safe', CAUTION: 'Caution', DO_NOT_INSTALL: 'Do not install' };
export const READING_LABEL = { likely_fine: 'Likely fine for its purpose', review_first: 'Review first', do_not_install: 'Do not install' };
export const ASSESSMENT_LABEL = { expected: 'Expected for its purpose', check: 'Worth checking', concerning: 'Concerning' };

const md = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const day = (v) => (v ? new Date(v).toISOString().slice(0, 16).replace('T', ' ') : '');

/** A safe file name for the downloads: "skill-scan-claude-trading-skills-2026-11-24". */
export function exportName(scan) {
  const base = String(scan?.fileName || scan?.source || 'skill').replace(/^https:\/\/github\.com\//, '').replace(/\.zip$/i, '');
  const slug = base.split('/').filter(Boolean).slice(-1)[0] || 'skill';
  return `skill-scan-${slug.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60)}-${String(scan?.finishedAt || scan?.createdAt || '').slice(0, 10) || 'report'}`;
}

/** The whole report as Markdown: verdicts, the explanation, the findings by rule, then every finding. */
export function reportMarkdown(scan) {
  const r = scan?.report || {};
  const s = scan?.summary;
  const groups = scan?.groups || [];
  const byId = Object.fromEntries((s?.groups || []).map((g) => [g.id, g]));
  const out = [];
  out.push(`# Skill scan: ${scan?.fileName || scan?.source || 'skill'}`, '');
  out.push(`- **Source:** ${scan?.source || ''}`);
  out.push(`- **Scanned:** ${day(scan?.finishedAt || scan?.createdAt)} UTC · ${scan?.mode === 'deep' ? `deep scan (${scan?.model || 'AI'})` : 'static scan'}${scan?.recursive ? ', each skill separately' : ''}${r.version ? ` · SkillSpector ${r.version}` : ''}`);
  out.push(`- **SkillSpector verdict:** ${VERDICT_LABEL[r.recommendation] || r.recommendation || 'n/a'} (score ${r.score ?? 'n/a'}/100)`);
  if (s) out.push(`- **AI reading in context:** ${READING_LABEL[s.reading] || s.reading}${s.readingReason ? ` — ${s.readingReason}` : ''}`);
  out.push(`- **Findings:** ${['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((k) => `${k.toLowerCase()} ${r.counts?.[k] || 0}`).join(', ')}${r.complete === false ? ' · **scan incomplete**' : ''}`);
  out.push('');
  if (s) {
    out.push('## What the findings mean', '', s.overview, '');
    if (s.nextSteps?.length) out.push('### What to do next', '', ...s.nextSteps.map((n) => `- ${n}`), '');
    out.push(`_Written by AI (${s.model || 'model'}) from the scan's findings. An AI reading can be misled by text in the skill itself; the findings below are the record._`, '');
  }
  if (groups.length) {
    out.push('## Findings by rule', '', '| Rule | What | Severity | Count | Files | In context |', '| --- | --- | --- | --- | --- | --- |');
    for (const g of groups) {
      const a = byId[g.id];
      out.push(`| ${md(g.id)} | ${md(g.title)} | ${md(g.severity)} | ${g.count} | ${g.fileCount} | ${a ? `${ASSESSMENT_LABEL[a.assessment]}: ${md(a.explanation)}` : 'not assessed'} |`);
    }
    out.push('');
  }
  for (const sk of r.skills || []) {
    out.push(`## ${r.multi ? `Skill: ${sk.name}` : 'All findings'}`, '');
    if (sk.error) { out.push(`Could not scan: ${sk.error}`, ''); continue; }
    if (r.multi) out.push(`Verdict ${VERDICT_LABEL[sk.recommendation] || sk.recommendation || 'n/a'}, score ${sk.score ?? 'n/a'}/100.`, '');
    if (sk.complete === false) out.push(`Not everything could be read${sk.coverage != null ? ` (${sk.coverage}% covered)` : ''}${sk.limitations?.length ? `: ${sk.limitations.join('; ')}` : '.'}`, '');
    if (!sk.issues?.length) { out.push('No findings.', ''); continue; }
    for (const i of sk.issues) {
      out.push(`- **${i.severity}** ${i.id} ${i.pattern || i.category || ''} — \`${i.file || '?'}${i.line ? `:${i.line}` : ''}\`${i.explanation ? `: ${String(i.explanation).replace(/\s+/g, ' ')}` : ''}`);
    }
    out.push('');
  }
  out.push('---', 'A Safe verdict means SkillSpector found no known risky pattern, not that the skill is harmless.');
  return `${out.join('\n')}\n`;
}

/** The JSON download: what Vault saved, without database ids. */
export function reportJson(scan) {
  const { id, userId, ...rest } = scan || {};
  return `${JSON.stringify(rest, null, 2)}\n`;
}
