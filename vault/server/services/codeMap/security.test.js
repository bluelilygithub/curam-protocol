#!/usr/bin/env node
// Code Map security checks on small made-up code. Fake keys are assembled at run time so this file never matches the secrets check itself.
// Run: node server/services/codeMap/security.test.js
'use strict';

const assert = require('assert');
const { buildSecurity, redact } = require('./security');

const fakeKey = ['sk', 'ant', 'api03', 'A'.repeat(30)].join('-');
const by = (r) => Object.fromEntries(r.checks.map((c) => [c.id, c]));

const files = {
  'server/index.js': [
    "const helmet = require('helmet');",
    'app.use(helmet({}));',
    "app.use('/api/notes', require('./routes/notes'));",
    "app.use('/api/pc', require('./routes/pc').helperRouter);",
  ].join('\n'),
  'server/routes/notes.js': [
    "router.get('/', async (req, res) => {",
    "  await pool.query(`SELECT * FROM notes WHERE \"userId\" = $1 AND title = '${req.query.title}'`, [req.user.id]);",
    "  await pool.query(`UPDATE notes SET pinned = ${req.body.pinned ? 'NOW()' : 'NULL'} WHERE id = $1`, [1]);",
    '});',
    "router.get('/:id', (req, res) => res.sendFile(path.join(dir, req.params.id)));",
    "router.post('/new', (req, res) => {});",
  ].join('\n'),
  'server/routes/pc.js': "router.get('/hidden', () => {});",
  'server/routes/plants.js': "router.get('/:plantId', (req, res) => res.json({}));",
  'server/routes/auth.js': [
    "router.post('/login', loginLimiter, async () => {});",
    "router.post('/forgot-password', async () => {});",
    "router.post('/logout', async () => {});",
  ].join('\n'),
  'server/services/run.js': [
    "const out = eval(code); const { execSync, execFile } = require('child_process');",
    '// eval(notReal)',
    'execSync(`convert ${name}`);',
    "execFile('ffmpeg', args);",
    'obj.eval(x);',
  ].join('\n'),
  'server/config/keys.js': `const KEY = '${fakeKey}';`,
  'client/src/A.jsx': '<div dangerouslySetInnerHTML={{ __html: html }} />',
  'client/src/B.jsx': "import DOMPurify from 'dompurify';\n<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(h) }} />",
};
const mounts = [
  { path: '/api/notes', line: 3, modules: ['server/routes/notes.js'] },
  { path: '/api/pc', line: 4, modules: ['server/routes/pc.js'] },
];
const manifest = { 'GET /api/notes': { class: 'authed' }, 'GET /api/notes/:id': { class: 'authed' }, 'GET /api/hook': { class: 'public' } };
const tools = [
  { id: 'notes', ownedServer: ['server/routes/notes.js'], checks: { ssrf: { status: 'pass' } } },
  { id: 'web', ownedServer: ['server/routes/web.js'], checks: { ssrf: { status: 'warn', note: 'fetch(url) without a guard', evidence: [{ file: 'server/routes/web.js', line: 4, text: 'fetch(url)' }] } } },
];

const r = buildSecurity({ files, tools, mounts, manifest });
const c = by(r);

assert.strictEqual(c.routesListed.status, 'fail');
assert.deepStrictEqual(c.routesListed.items.map((x) => x.text), ['POST /api/notes/new'], 'unlisted route found; a router taken off a module is skipped');
assert.strictEqual(c.routesListed.items[0].tool, 'notes', 'items carry the owning tool');
assert.strictEqual(by(buildSecurity({ files, tools, mounts, manifest: null })).routesListed.status, 'warn', 'no manifest is a warning, not a pass');

assert.strictEqual(c.publicRoutes.status, 'info');
assert.deepStrictEqual(c.publicRoutes.items.map((x) => x.text), ['GET /api/hook']);

assert.strictEqual(c.sqlInput.status, 'fail');
assert.strictEqual(c.sqlInput.items.length, 1, 'the fixed-text ternary is not flagged');
assert.ok(c.sqlInput.items[0].text.includes('req.query.title'));

assert.deepStrictEqual(c.userScope.items.map((x) => x.file), ['server/routes/plants.js'], 'files that mention the user are not flagged');
assert.strictEqual(c.userScope.status, 'warn');

assert.strictEqual(c.secrets.status, 'fail');
assert.ok(!c.secrets.items[0].text.includes(fakeKey), 'the key itself is never stored');
assert.ok(c.secrets.items[0].text.includes('(hidden)'));
assert.ok(!redact(`x ${fakeKey}`).includes(fakeKey));

assert.deepStrictEqual(c.codeExec.items.map((x) => x.line), [1, 3], 'eval and a shell string; not comments, execFile or obj.eval');

assert.deepStrictEqual(c.pathInput.items.map((x) => x.file), ['server/routes/notes.js']);
assert.deepStrictEqual(c.rawHtml.items.map((x) => x.file), ['client/src/A.jsx'], 'a file that sanitizes is fine');
assert.deepStrictEqual(c.authLimits.items.map((x) => x.line), [2], 'forgot-password has no limiter; logout is not a sign-in route');
assert.strictEqual(c.headers.status, 'pass');
assert.strictEqual(by(buildSecurity({ files: { ...files, 'server/index.js': "app.use(cors({ origin: '*' }));" }, tools, mounts: [], manifest })).headers.items.length, 2, 'no helmet and open CORS');

assert.strictEqual(c.ssrf.status, 'warn');
assert.deepStrictEqual(c.ssrf.items.map((x) => x.tool), ['web']);

assert.deepStrictEqual(r.counts, { fail: 5, warn: 4, pass: 1, info: 1 });

// the refinements found on the real code
const more = by(buildSecurity({ files: {
  'server/a.test.js': `const ENV = '${['sk', 'ant', 'api03', 'SECRET', 'do', 'not', 'leak', 'x'.repeat(20)].join('-')}';`, // a test's made-up key
  'server/db.js': 'db.exec(`PRAGMA ${s}`);', // a database exec, no child_process in the file
  'server/routes/files.js': "if (!/^\\d+$/.test(req.params.projectId)) return;\nconst dir = path.join(up, String(req.params.projectId));",
  'server/routes/auth.js': "router.post('/register', (req, res) => {\n  res.status(403).json({ error: 'closed' });\n});",
}, manifest }));
assert.strictEqual(more.secrets.status, 'pass', 'an obviously fake test key is not flagged');
assert.strictEqual(more.codeExec.status, 'pass', 'db.exec is not a shell');
assert.strictEqual(more.pathInput.status, 'pass', 'a value checked against a pattern in the same file');
assert.strictEqual(more.authLimits.status, 'pass', 'a route that only refuses (403) needs no limiter');

// a check that throws becomes a warning instead of breaking the run
const broken = buildSecurity({ files, checks: [{ id: 'x', label: 'X', severity: 'low', run() { throw new Error('boom'); } }] });
assert.strictEqual(broken.checks[0].status, 'warn');
assert.ok(broken.checks[0].note.includes('boom'));

console.log('security tests passed');
