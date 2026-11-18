'use strict';

// node server/services/codeMap/briefing/buildBriefing.test.js
// The Code Map briefing (docs/code-map.md "Context"): section order, size trimming, privacy, the rules.md hash check, building-block
// paths, and the outside-service names. No database, no network.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildBriefing, MAX_CHARS } = require('./buildBriefing');
const { configuredServices, SERVICES, toolPurposes, curatedPurposes, purposeFrom } = require('./snapshot');
const sources = require('./sources');

let passed = 0;
const t = (name, fn) => { try { fn(); passed += 1; } catch (e) { console.error(`FAIL ${name}`); throw e; } };

// Things that must never reach a briefing: they sit in fields the builder must not read.
const CLIENT_NAME = 'Wombat Holdings Pty Ltd';
const AMOUNT = '$48,213.77';
const ENV_VALUE = 'sk-ant-api03-SECRET-do-not-leak-9f8e7d';

function fixture(over = {}) {
  const tool = (id, label, group, extra = {}) => ({
    id, label, group, lifecycle: 'ga', adminOnly: false, locClient: 1200, locServer: 800, score: 85,
    tests: ['server/x.test.js', 'server/y.test.js'], fails: 0, warns: 1,
    // fields a run carries that the briefing must ignore
    checks: { docs: { status: 'pass', note: `Client ${CLIENT_NAME} invoice ${AMOUNT}`, evidence: [{ file: 'a.js', line: 1, text: `const owner = '${CLIENT_NAME}'` }] } },
    ...extra,
  });
  return {
    generatedAt: '2026-11-19T00:00:00.000Z',
    commitHint: 'abc123def4567890',
    run: {
      summary: { tools: 3, mounts: 146, routesFiles: 170, files: 1995, locServer: 173830, locClient: 195579, locTests: 58875, tests: 410, cycles: 2 },
      tools: [tool('finance', 'Finance', 'Business'), tool('plans', 'Plans', 'Workspace', { lifecycle: 'preview' }), tool('codeMap', 'Code Map', 'Business', { adminOnly: true })],
      edges: [{ a: 'finance', b: 'plans', n: 3, files: [`client/${CLIENT_NAME}.js`] }],
      cycles: [['a.js', 'b.js'], ['c.js', 'd.js']],
      hotspots: [],
      largest: [{ file: 'client/src/pages/FinancePage.jsx', loc: 7241 }],
      findings: [
        { sev: 'low', title: 'Docs: 1 tool', tools: ['plans'], body: `Seen in ${CLIENT_NAME}`, evidence: [{ text: AMOUNT }] },
        { sev: 'high', title: 'AI rate limit: 2 tools to check', tools: ['finance', 'plans'], body: 'x', toolNotes: [{ note: AMOUNT }] },
      ],
    },
    curated: { about: 'ABOUT-TEXT', rules: '1. RULE-ONE', buildingBlocks: '- `server/db.js` — the pool' },
    purposes: { finance: 'Income, expenses and BAS.' },
    packages: ['express', 'pg', 'react'],
    services: configuredServices({ ANTHROPIC_API_KEY: ENV_VALUE, GOOGLE_CLIENT_ID: 'id-only' }),
    changelog: [
      { committedAt: '2026-11-18T05:00:00Z', area: 'Finance', subject: 'Finance: BAS export', concerns: 'None noted.', whatChanged: `Fixed ${CLIENT_NAME} ${AMOUNT}`, goal: AMOUNT },
      { committedAt: '2026-11-01T05:00:00Z', area: 'Plans', subject: 'Plans: due dates', concerns: 'Untested on mobile.', benefit: CLIENT_NAME },
      { committedAt: '2026-08-01T05:00:00Z', area: 'Old', subject: 'Old work with an open concern', concerns: 'Index missing on big tables.' },
      { committedAt: '2026-08-02T05:00:00Z', area: 'Old', subject: 'Old work done', concerns: 'None noted.' },
    ],
    ponytail: { tasks: 14, cost: 39.98, avgReuse: 56.8, names: [CLIENT_NAME] },
    notes: 'Next: a booking tool. Decided against a mobile app.',
    cronJobs: 18,
    rulesStale: [],
    ...over,
  };
}

t('sections come in the requested order, inside <vault_briefing>', () => {
  const { markdown, sections } = buildBriefing(fixture());
  assert.deepStrictEqual(sections.map((s) => s.id), ['use', 'about', 'architecture', 'rules', 'blocks', 'tools', 'services', 'state', 'direction', 'pattern', 'notes', 'handoff']);
  assert.ok(markdown.startsWith('<vault_briefing>') && markdown.trim().endsWith('</vault_briefing>'));
  let at = 0;
  for (const s of sections) { const i = markdown.indexOf(`## ${s.title}`); assert.ok(i > at, `${s.title} in order`); at = i; }
  assert.match(markdown, /as of 2026-11-19, commit abc123def456\b/);
  assert.match(markdown, /ABOUT-TEXT/);
  assert.match(markdown, /1\. RULE-ONE/);
  assert.match(markdown, /`express`, `pg`, `react`/);
});

t('tools: status from lifecycle and admin, purpose from the doc else the label, links by name', () => {
  const { markdown, sections } = buildBriefing(fixture());
  const tools = sections.find((s) => s.id === 'tools').data.tools;
  assert.deepStrictEqual(tools.map((x) => x.status), ['ga', 'preview', 'admin']);
  assert.strictEqual(tools[0].purpose, 'Income, expenses and BAS.');
  assert.strictEqual(tools[1].purpose, 'Plans');
  assert.deepStrictEqual(tools[0].links, ['Plans']);
  assert.strictEqual(tools[0].lines, 2000);
  assert.strictEqual(tools[0].tests, 2);
  assert.match(markdown, /\| Plans \| Workspace \| preview \(work in progress\) \|/);
});

t('state, direction, pattern and notes', () => {
  const { markdown, sections } = buildBriefing(fixture());
  const state = sections.find((s) => s.id === 'state').data;
  assert.strictEqual(state.findings[0].severity, 'high', 'high findings first');
  assert.deepStrictEqual(state.findings[0].tools, ['Finance', 'Plans']);
  assert.match(markdown, /Import cycles:\*\* 2/);
  assert.match(markdown, /not available \(the deployed server has no git history\)/);
  const dir = sections.find((s) => s.id === 'direction').data;
  assert.deepStrictEqual(dir.recent.map((e) => e.subject), ['Finance: BAS export', 'Plans: due dates'], 'last 30 days only');
  assert.deepStrictEqual(dir.concerns.map((e) => e.subject), ['Plans: due dates', 'Old work with an open concern'], 'open concerns of any age; "None noted." left out');
  assert.match(markdown, /14 tasks, \$39\.98 in all/);
  assert.match(markdown, /Decided against a mobile app/);
  assert.match(markdown, /Write it as a brief for Claude Code/);
});

t('dates are Brisbane days: 9 pm UTC on the 18th is the 19th', () => {
  const { markdown } = buildBriefing(fixture({ generatedAt: '2026-11-18T21:00:00.000Z' }));
  assert.match(markdown, /as of 2026-11-19,/);
  assert.match(markdown, /# Vault briefing \(2026-11-19\)/);
});

t('no run, no Ponytail, unknown commit, no notes', () => {
  const { markdown } = buildBriefing(fixture({ run: null, ponytail: null, commitHint: null, notes: '' }));
  assert.match(markdown, /commit unknown/);
  assert.match(markdown, /No Code Map run yet/);
  assert.match(markdown, /No Ponytail data/);
  assert.match(markdown, /## 10\. Owner notes\n\nNone\./);
});

t('a stale rules summary is flagged at the top', () => {
  const { markdown } = buildBriefing(fixture({ rulesStale: ['CLAUDE.md'] }));
  assert.match(markdown, /may be out of date \(CLAUDE\.md changed/);
});

t('over the limit: one line per tool, 14 days of changelog, and it says so', () => {
  const many = Array.from({ length: 300 }, (_, i) => ({
    id: `tool${i}`, label: `Tool number ${i}`, group: 'Group', lifecycle: 'ga', adminOnly: false, locClient: 10, locServer: 10, score: 90, tests: [],
  }));
  const f = fixture();
  f.run.tools = many;
  f.purposes = Object.fromEntries(many.map((x) => [x.id, 'A purpose sentence that is long enough to make the table big. '.repeat(3)]));
  const full = buildBriefing(f, { maxChars: Infinity });
  assert.ok(full.markdown.length > MAX_CHARS, `fixture is big enough (${full.markdown.length})`);
  const out = buildBriefing(f);
  assert.strictEqual(out.stats.trimmed, true);
  assert.match(out.markdown, /shortened to fit: section 5 lists one line per tool and section 8 covers the last 14 days/);
  assert.match(out.markdown, /^- Tool number 0 \(Group, ga\): /m);
  assert.ok(!/\| Tool \| Group \|/.test(out.markdown), 'no table when trimmed');
  assert.ok(out.markdown.length < full.markdown.length);
  assert.match(out.markdown, /Changelog since 2026-11-05/);
  assert.strictEqual(out.stats.tokens, Math.ceil(out.stats.chars / 4));
});

t('privacy: a client name, an amount and an env value never appear', () => {
  const { markdown, sections } = buildBriefing(fixture());
  const all = markdown + JSON.stringify(sections);
  for (const secret of [CLIENT_NAME, AMOUNT, ENV_VALUE, 'id-only']) assert.ok(!all.includes(secret), `"${secret}" leaked`);
  assert.match(markdown, /\*\*Anthropic:\*\* YES/);
  assert.match(markdown, /\*\*Google sign-in \(OAuth\):\*\* NO/, 'needs both id and secret');
});

t('configuredServices keeps booleans only', () => {
  const out = configuredServices({ ANTHROPIC_API_KEY: ENV_VALUE, GEMINI_API_KEY: '' });
  assert.ok(!JSON.stringify(out).includes(ENV_VALUE));
  assert.strictEqual(out.find((x) => x.service === 'Anthropic').configured, true);
  assert.strictEqual(out.find((x) => x.service === 'Google Gemini').configured, false, 'empty counts as not set');
  for (const x of out) assert.strictEqual(typeof x.configured, 'boolean');
});

t('every service variable is documented in docs/env-vars.md or read by server code', () => {
  const doc = fs.readFileSync(path.join(sources.VAULT_ROOT, 'docs/env-vars.md'), 'utf8');
  const serverText = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p); else if (e.name.endsWith('.js') && !e.name.includes('.test.')) serverText.push(fs.readFileSync(p, 'utf8'));
    }
  };
  walk(path.join(sources.VAULT_ROOT, 'server'));
  const code = serverText.join('\n');
  const unknown = SERVICES.flatMap((s) => s.vars).filter((v) => !doc.includes(v) && !code.includes(`process.env.${v}`) && !code.includes(`env.${v}`));
  assert.deepStrictEqual(unknown, []);
});

t('rules.md is current: CLAUDE.md and docs/core-conventions.md match the hashes it was written from', () => {
  const stale = sources.staleRuleSources();
  assert.deepStrictEqual(stale, [], `The rules summary may be out of date: ${stale.join(' and ')} changed since server/services/codeMap/briefing/rules.md was written. Re-read it against the changed file(s), update the rules, then set its first line to:\n${sources.currentRulesHeader()}`);
});

t('the hash ignores Windows versus Unix line endings', () => {
  assert.strictEqual(sources.textHash('a\r\nb\r\n'), sources.textHash('a\nb\n'));
  assert.notStrictEqual(sources.textHash('a\nb\n'), sources.textHash('a\nc\n'));
});

t('every path in building-blocks.md exists', () => {
  const paths = sources.buildingBlockPaths();
  assert.ok(paths.length >= 20, `${paths.length} paths`);
  const missing = paths.filter((p) => !fs.existsSync(path.join(sources.VAULT_ROOT, p)));
  assert.deepStrictEqual(missing, []);
});

t('the curated files are short and in place', () => {
  const c = sources.curated();
  assert.ok(c.about.split('\n').length <= 20, 'about.md stays about 15 lines');
  assert.ok(!c.rules.startsWith('<!--'), 'the hash header is not part of the rules text');
  assert.match(c.rules, /^1\. /);
});

t('tool purposes: curated line first; every curated id is a real menu entry', () => {
  const p = toolPurposes([{ id: 'codeMap' }, { id: 'noSuchToolHere' }]);
  assert.match(p.codeMap, /Reads Vault's own source/);
  assert.ok(!('noSuchToolHere' in p));
  const nav = fs.readFileSync(path.join(sources.VAULT_ROOT, 'client/src/config/appNavigation.js'), 'utf8');
  const unknown = Object.keys(curatedPurposes()).filter((id) => !nav.includes(`id: '${id}'`) && !['tasks', 'chat'].includes(id));
  assert.deepStrictEqual(unknown, [], 'ids in tool-purposes.md that are not in appNavigation.js');
  assert.ok(Object.keys(curatedPurposes()).length >= 60);
});

t('doc fallback keeps the descriptive sentences and drops paths, routes and flags', () => {
  assert.strictEqual(
    purposeFrom('# Finance\n\nReal double-entry bookkeeping for a sole trader. Route: server/routes/finance.js. Client: client/src/pages/FinancePage.jsx. Every posting stays balanced.'),
    'Real double-entry bookkeeping for a sole trader. Every posting stays balanced.');
  assert.strictEqual(purposeFrom('# X\n\nStatus: built.\n\n`/x`, flag x.\n\nShort.'), '');
});

console.log(`buildBriefing tests passed (${passed})`);
