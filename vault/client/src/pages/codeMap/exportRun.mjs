// Code Map export: turns one stored run result (server/services/codeMap/index.js) into Markdown or CSV for the Copy and Download buttons.
// Pure functions, no React, so `node client/src/pages/codeMap/exportRun.test.mjs` can check them.

const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
const n = (v) => (v == null ? '' : Number(v).toLocaleString('en-AU'));
const ev = (e) => `\`${e.file}${e.line ? `:${e.line}` : ''}\`${e.text ? ` ${String(e.text).trim()}` : ''}`;

export function mdTable(head, rows) {
  if (!rows.length) return '_None._';
  return [`| ${head.map(cell).join(' | ')} |`, `|${head.map(() => ' --- ').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');
}

export function toCsv(head, rows) {
  const q = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [head, ...rows].map((r) => r.map(q).join(',')).join('\r\n');
}

export function findingsMd(data) {
  const label = (id) => (data.tools || []).find((t) => t.id === id)?.label || id;
  const list = data.findings || [];
  if (!list.length) return '## What to improve\n\nNothing to improve: every rule passes for every tool.';
  return ['## What to improve, in order', ...list.map((f, i) => {
    const total = f.evidenceTotal || (f.evidence || []).length;
    return [
      `### ${i + 1}. [${f.sev}] ${f.title}`,
      f.area ? `_${f.area}_` : '',
      f.body || '',
      (f.tools || []).length ? `**Tools:** ${f.tools.map(label).join(', ')}` : '',
      (f.evidence || []).length ? `**Evidence** (${f.evidence.length < total ? `first ${f.evidence.length} of ${total}` : total}):\n${f.evidence.map((e) => `- ${ev(e)}`).join('\n')}` : '',
    ].filter(Boolean).join('\n\n');
  })].join('\n\n');
}

export function toolMd(t, rules) {
  const checks = t.checks || {};
  const ruleLines = rules.map((r) => {
    const c = checks[r.id] || { status: 'na', note: '', evidence: [] };
    const word = { pass: 'follows', warn: 'check', fail: 'gap', na: 'n/a' }[c.status] || c.status;
    const fix = (c.status === 'fail' || c.status === 'warn') && r.fix ? `\n  - Fix: ${r.fix}` : '';
    return `- **${r.label}** (${word}): ${c.note || ''}${fix}${(c.evidence || []).map((e) => `\n  - ${ev(e)}`).join('')}`;
  });
  return [
    `## ${t.label}`,
    `${t.group} · page \`${t.path}\`${t.featureKey ? ` · flag \`${t.featureKey}\`` : ''}${t.adminOnly ? ' · admin only' : ''}${t.lifecycle && t.lifecycle !== 'ga' ? ` · ${t.lifecycle}` : ''}`,
    `Score ${t.score}% · ${n(t.locClient)} client lines · ${n(t.locServer)} server lines · ${(t.tests || []).length} test files`,
    '### Rules', ...ruleLines,
    (t.mounts || []).length ? `### API mounts\n${t.mounts.map((m) => `- \`${m.path}\`${m.aiLimiter ? ' (aiLimiter)' : ''}${m.admin ? ' (admin)' : ''}${m.public ? ' (public)' : ''}`).join('\n')}` : '',
    (t.ownedServer || []).length || (t.ownedClient || []).length ? `### Owned files\n${[...(t.ownedServer || []), ...(t.ownedClient || [])].map((f) => `- \`${f}\``).join('\n')}` : '',
    (t.tests || []).length ? `### Tests\n${t.tests.map((f) => `- \`${f}\``).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

export function structureMd(data) {
  return [
    '## Structure',
    '### Largest files', mdTable(['File', 'Lines'], (data.largest || []).map((h) => [h.file, n(h.loc)])),
    '### Import cycles', (data.cycles || []).length ? data.cycles.map((c) => `- ${c.map((f) => `\`${f}\``).join(' → ')}`).join('\n') : '_None._',
    '### Shared foundations (most imported)', mdTable(['File', 'Importers', 'Lines'], (data.fanin || []).map((f) => [f.file, f.importers, n(f.loc)])),
    '### Separate packages', mdTable(['Package', 'Files', 'Lines'], (data.packages || []).map((p) => [p.name, p.files, n(p.loc)])),
    '### Backups and possibly unused files', mdTable(['File', 'Lines'], [...(data.backups || []).map((b) => [b, 'backup copy']), ...(data.orphans || []).map((o) => [o.file, n(o.loc)])]),
  ].join('\n\n');
}

const TOOL_HEAD = ['Tool', 'Id', 'Group', 'Feature flag', 'Lifecycle', 'Admin only', 'Score %', 'Gaps', 'Checks', 'Client lines', 'Server lines', 'Test files'];
const toolRow = (t) => [t.label, t.id, t.group, t.featureKey || '', t.lifecycle || 'ga', t.adminOnly ? 'yes' : '', t.score, t.fails, t.warns, t.locClient, t.locServer, (t.tests || []).length];

export const toolsCsv = (data) => toCsv(TOOL_HEAD, (data.tools || []).map(toolRow));

/** The Conventions grid: one row per tool, one column per rule (follows / check / gap / n/a). */
export function conventionsCsv(data, rules) {
  const word = { pass: 'follows', warn: 'check', fail: 'gap', na: 'n/a' };
  return toCsv(['Tool', 'Score %', ...rules.map((r) => r.label)], (data.tools || []).map((t) => [t.label, t.score, ...rules.map((r) => word[(t.checks || {})[r.id]?.status || 'na'])]));
}

/** The whole run as one readable Markdown document. */
export function runMd(data, run = {}) {
  const s = data.summary || {};
  const rules = data.rules || [];
  return [
    '# Vault Code Map',
    `Run ${run.finishedAt || data.generatedAt || ''}${data.commitHint ? ` · commit ${String(data.commitHint).slice(0, 8)}` : ''}`,
    '## Summary',
    mdTable(['Measure', 'Value'], [
      ['Tools', n(s.tools)], ['Files', n(s.files)], ['Test files', n(s.tests)], ['Server lines', n(s.locServer)], ['Client lines', n(s.locClient)],
      ['Test lines', n(s.locTests)], ['API mounts', n(s.mounts)], ['Route files', n(s.routesFiles)], ['Import cycles', n(s.cycles)], ['Findings', n(s.findings)], ['Rule gaps', n(s.gaps)],
    ]),
    findingsMd(data),
    '## Tools',
    mdTable(TOOL_HEAD, (data.tools || []).map(toolRow)),
    '## Rules',
    rules.map((r) => `- **${r.label}** (${r.severity}, ${r.area}): ${r.why} Fix: ${r.fix}`).join('\n'),
    structureMd(data),
    '## Every tool in detail',
    ...(data.tools || []).map((t) => toolMd(t, rules)),
  ].join('\n\n');
}

// AI review (server/services/codeMap/aiReview.js): every call site and its verdict.
const AI_ORDER = ['replace', 'hybrid', 'unclear', 'keep'];
const aiSites = (review) => ((review && review.result && review.result.files) || []).flatMap((f) => f.sites.map((s) => ({ ...s, tool: f.tool })));

export function aiReviewMd(review) {
  const sites = aiSites(review);
  const s = (review && review.summary) || {};
  return [
    '# Vault AI review: where plain code would beat a model call',
    `Run ${review?.finishedAt || ''} · ${review?.model || ''} · ${sites.length} call sites · replace ${s.replace || 0}, hybrid ${s.hybrid || 0}, unclear ${s.unclear || 0}, keep ${s.keep || 0}`,
    ...AI_ORDER.map((v) => {
      const list = sites.filter((x) => x.verdict === v);
      return [`## ${v[0].toUpperCase()}${v.slice(1)} (${list.length})`, ...(list.length ? list.map((x) => [
        `### \`${x.file}:${x.line}\` (${x.confidence} confidence${v === 'keep' ? '' : `, ${x.saving} saving`}${x.tool ? `, ${x.tool}` : ''})`,
        `\`${x.text}\``, x.does, x.why, x.alternative ? `**Instead:** ${x.alternative}` : '',
      ].filter(Boolean).join('\n\n')) : ['_None._'])].join('\n\n');
    }),
  ].join('\n\n');
}

export const aiReviewCsv = (review) => toCsv(['File', 'Line', 'Tool', 'Verdict', 'Confidence', 'Saving', 'What it does', 'Why', 'Instead', 'Code'],
  aiSites(review).map((x) => [x.file, x.line, x.tool || '', x.verdict, x.confidence, x.saving, x.does, x.why, x.alternative, x.text]));

export const datedName =(prefix, ext, iso) => `${prefix}-${String(iso || new Date().toISOString()).slice(0, 10)}.${ext}`;
