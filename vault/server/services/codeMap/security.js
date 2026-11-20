'use strict';

// Code Map, security stage: plain pattern checks over the whole codebase, shown on the Security tab (docs/code-map.md "Security").
// Free like the rest of the analysis (no model, no network) and part of every run, including the weekly one. Each check returns
// { id, label, severity, why, fix, status: 'pass'|'warn'|'fail'|'info', note, items: [{ file, line, text, tool }], total }.
// Pattern matches can be wrong both ways: they point at code to read, they do not prove a hole or its absence.
// Secret values are never stored: a matched secret is cut to its first characters before it goes into the run.

const { splitLines, isTest } = require('./files');

const MAX_ITEMS = 50;
const ROUTE_RX = /\brouter\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g;
const SQL_RX = /\b(SELECT|UPDATE|DELETE\s+FROM|INSERT\s+INTO|WHERE)\b/;
const REQ_RX = /req\.(body|query|params)/;
const LITERAL_CHOICE_RX = /^[^?]+\?\s*(['"`])[^'"`]*\1\s*:\s*(['"`])[^'"`]*\2$/; // cond ? 'A' : 'B' picks fixed text, not the input
const SECRET_RX = /sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9]{36}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
const EVAL_RX = /(^|[^.\w])(eval|new Function)\s*\(/;
const SHELL_RX = /\b(exec|execSync)\s*\(\s*`[^`]*\$\{|shell:\s*true/;
const PATH_RX = /(path\.(join|resolve)|fs\.\w+|createReadStream|sendFile|res\.download)\([^)]*req\.(body|query|params)/;
const USER_RX = /userId|user_id|req\.user|ownerId|accountantOf/;
const AUTH_ROUTE_RX = /router\.post\(\s*['"`][^'"`]*(login|register|reset|forgot|password|verify|mfa|2fa)/i;

const FAKE_RX = /SECRET|FAKE|TEST|EXAMPLE|DUMMY|do-not|x{8}/i; // a test's made-up value, not a real key
const redact = (s) => s.replace(new RegExp(SECRET_RX.source, 'g'), (m) => `${m.slice(0, 6)}… (hidden)`);

function lineOf(src, index) {
  let n = 1;
  for (let i = src.indexOf('\n'); i !== -1 && i < index; i = src.indexOf('\n', i + 1)) n++;
  return n;
}

/** file -> tool id, from the tools' owned files (a file two tools own counts as shared). */
function owners(tools) {
  const out = {};
  for (const t of tools) for (const f of [...(t.ownedServer || []), ...(t.ownedClient || [])]) out[f] = out[f] && out[f] !== t.id ? 'shared' : t.id;
  return out;
}

const CHECKS = [
  {
    id: 'routesListed', label: 'Every route is in the access list', severity: 'high',
    why: 'server/testing/routeManifest.json says who may call each route (public, admin or signed-in), and crossUser.test.js checks the app against it. A route missing from the list is not covered by that test.',
    fix: 'Run DATABASE_URL=... node server/routes/crossUser.test.js --update, review the new lines (class public / admin / authed), and commit the manifest.',
    run({ files, mounts, manifest }) {
      if (!manifest) return { status: 'warn', note: 'server/testing/routeManifest.json could not be read.', items: [] };
      const idx = splitLines(files['server/index.js'] || '');
      const items = [];
      let found = 0;
      for (const m of mounts) {
        const mountLine = idx[m.line - 1] || '';
        if (m.modules.length !== 1 || /require\([^)]*\)\s*\.\s*\w+/.test(mountLine)) continue; // a router picked off a module or built by a factory: not followed
        const src = files[m.modules[0]] || '';
        for (const r of src.matchAll(ROUTE_RX)) {
          found++;
          const key = `${r[1].toUpperCase()} ${(m.path + (r[2] === '/' ? '' : r[2])).replace(/\/$/, '') || '/'}`;
          if (!manifest[key]) items.push({ file: m.modules[0], line: lineOf(src, r.index), text: key });
        }
      }
      return items.length
        ? { status: 'fail', note: `${items.length} route(s) in the code are not in the access list.`, items }
        : { status: 'pass', note: `All ${found} routes found in the code are in the access list. Routers built by a factory or taken off another module are not followed.`, items };
    },
  },
  {
    id: 'publicRoutes', label: 'Public routes (no sign-in)', severity: 'medium',
    why: 'Anyone on the internet can call these. Each one should be public on purpose and check its own token, signature or input.',
    fix: 'Read each route. If one should need a sign-in, move its mount after requireAuth in server/index.js and change its class in routeManifest.json.',
    run({ manifest }) {
      const items = Object.entries(manifest || {}).filter(([, v]) => v && v.class === 'public').map(([k]) => ({ file: 'server/testing/routeManifest.json', line: 0, text: k }));
      return { status: 'info', note: `${items.length} public route(s) to keep under review.`, items };
    },
  },
  {
    id: 'sqlInput', label: 'Request values pasted into SQL', severity: 'high',
    why: 'Text from a request put straight into a SQL string lets a caller change the query (SQL injection). Values must go in as $1, $2 parameters.',
    fix: 'Pass the value in the parameters array and use $n in the SQL; for a column or sort name, pick it from a fixed list.',
    run({ files }) {
      const items = [];
      for (const [f, src] of Object.entries(files)) {
        if (!f.startsWith('server/') || isTest(f)) continue;
        for (const m of src.matchAll(/`((?:[^`\\]|\\.)*)`/g)) {
          if (!SQL_RX.test(m[1])) continue;
          for (const e of m[1].matchAll(/\$\{([^}]*)\}/g)) {
            const x = e[1].trim();
            if (REQ_RX.test(x) && !LITERAL_CHOICE_RX.test(x)) items.push({ file: f, line: lineOf(src, m.index), text: `\${${x.slice(0, 120)}}` });
          }
        }
      }
      return items.length
        ? { status: 'fail', note: `${items.length} request value(s) inside SQL text.`, items }
        : { status: 'pass', note: 'No request value is pasted straight into SQL text. (A value copied into a variable first is not followed.)', items };
    },
  },
  {
    id: 'userScope', label: 'Routes by id with no per-user check', severity: 'medium',
    why: 'A route that loads a record by id must also check it belongs to the caller, or one user can read or change another\'s data by changing the id.',
    fix: 'Add AND "userId" = $n (or the owning parent\'s check) to the query. Shared reference data (not owned by anyone) is fine: note why in the file.',
    run({ files }) {
      const items = [];
      for (const [f, src] of Object.entries(files)) {
        if (!f.startsWith('server/routes/') || isTest(f) || USER_RX.test(src)) continue;
        const lines = splitLines(src);
        const i = lines.findIndex((l) => /router\.(get|put|patch|delete|post)\(\s*['"`][^'"`]*:\w+/.test(l));
        if (i !== -1) items.push({ file: f, line: i + 1, text: lines[i].trim().slice(0, 160) });
      }
      return items.length
        ? { status: 'warn', note: `${items.length} route file(s) take an id but never mention the user. Often shared data; check each.`, items }
        : { status: 'pass', note: 'Every route file that takes an id refers to the user somewhere. (This does not prove each query checks it.)', items };
    },
  },
  {
    id: 'secrets', label: 'Secrets written in the code', severity: 'high',
    why: 'An API key or private key in the source is readable by anyone with the code or a copy of the repo, and stays in git history.',
    fix: 'Move it to an environment variable (docs/env-vars.md), then revoke and replace the key: it is already exposed.',
    run({ files }) {
      const items = [];
      for (const [f, src] of Object.entries(files)) {
        splitLines(src).forEach((l, i) => { const m = SECRET_RX.exec(l); if (m && !FAKE_RX.test(m[0])) items.push({ file: f, line: i + 1, text: redact(l.trim()).slice(0, 160) }); });
      }
      return items.length ? { status: 'fail', note: `${items.length} line(s) look like a real key (values hidden here).`, items } : { status: 'pass', note: 'No key-shaped values found in server/ or client/src/.', items };
    },
  },
  {
    id: 'codeExec', label: 'Running code or shell commands from strings', severity: 'high',
    why: 'eval, new Function, or a shell command built from a string can run whatever a caller manages to get into that string.',
    fix: 'Use execFile or spawn with an argument list (no shell), and never eval. Validate any value that becomes an argument.',
    run({ files }) {
      const items = [];
      for (const [f, src] of Object.entries(files)) {
        if (isTest(f)) continue;
        const shell = f.startsWith('server/') && src.includes('child_process'); // a database's .exec() is not a shell
        splitLines(src).forEach((l, i) => {
          const t = l.trim();
          if (t.startsWith('//') || t.startsWith('*')) return;
          if (EVAL_RX.test(l) || (shell && SHELL_RX.test(l))) items.push({ file: f, line: i + 1, text: t.slice(0, 160) });
        });
      }
      return items.length ? { status: 'fail', note: `${items.length} place(s) run code or a shell from a string.`, items } : { status: 'pass', note: 'No eval or new Function; shell commands use argument lists.', items };
    },
  },
  {
    id: 'pathInput', label: 'File paths built from request values', severity: 'medium',
    why: 'A path built from a request value can reach outside the folder it was meant for ("../../.env") unless the value is checked first.',
    fix: 'Check the value against a strict pattern (digits, or a known id) before using it, or resolve the path and confirm it stays inside the folder.',
    run({ files }) {
      const items = [];
      for (const [f, src] of Object.entries(files)) {
        if (!f.startsWith('server/') || isTest(f)) continue;
        splitLines(src).forEach((l, i) => {
          if (!PATH_RX.test(l)) return;
          const v = /req\.(?:body|query|params)\.(\w+)/.exec(l);
          if (v && new RegExp(`\\.test\\(\\s*req\\.(?:body|query|params)\\.${v[1]}\\b`).test(src)) return; // checked against a pattern in the same file
          items.push({ file: f, line: i + 1, text: l.trim().slice(0, 160) });
        });
      }
      return items.length ? { status: 'warn', note: `${items.length} path(s) use a request value with no pattern check in the same file.`, items } : { status: 'pass', note: 'Every file path built from a request value is checked against a pattern in the same file.', items };
    },
  },
  {
    id: 'rawHtml', label: 'Raw HTML put into the page', severity: 'medium',
    why: 'dangerouslySetInnerHTML with text that came from a user, a file or a model can run a script in the admin\'s browser (cross-site scripting).',
    fix: 'Render as text or Markdown instead, or clean the HTML with DOMPurify first.',
    run({ files }) {
      const items = [];
      for (const [f, src] of Object.entries(files)) {
        if (!f.startsWith('client/') || isTest(f) || /DOMPurify|sanitize/i.test(src)) continue;
        splitLines(src).forEach((l, i) => { if (l.includes('dangerouslySetInnerHTML')) items.push({ file: f, line: i + 1, text: l.trim().slice(0, 160) }); });
      }
      return items.length ? { status: 'warn', note: `${items.length} use(s) without a sanitizer in the same file.`, items } : { status: 'pass', note: 'Every dangerouslySetInnerHTML is in a file that sanitizes.', items };
    },
  },
  {
    id: 'authLimits', label: 'Sign-in routes are rate-limited', severity: 'high',
    why: 'Without a limit, login, password-reset and sign-up routes can be hammered to guess passwords or flood email.',
    fix: 'Add an express-rate-limit limiter to the route in server/routes/auth.js, as /login has.',
    run({ files }) {
      const src = files['server/routes/auth.js'];
      if (!src) return { status: 'warn', note: 'server/routes/auth.js not found.', items: [] };
      const items = [];
      const lines = splitLines(src);
      lines.forEach((l, i) => { if (AUTH_ROUTE_RX.test(l) && !/limit/i.test(l) && !/status\(403\)/.test(lines[i + 1] || '')) items.push({ file: 'server/routes/auth.js', line: i + 1, text: l.trim().slice(0, 160) }); });
      return items.length ? { status: 'fail', note: `${items.length} sign-in route(s) without a limiter on the route line.`, items } : { status: 'pass', note: 'Login, reset and sign-up routes each have a limiter.', items };
    },
  },
  {
    id: 'headers', label: 'Security headers and CORS', severity: 'medium',
    why: 'helmet sets the browser security headers (content security policy, no sniffing, frame protection). An open CORS setting lets any website call the API from a visitor\'s browser.',
    fix: 'Keep app.use(helmet(...)) in server/index.js with its content security policy on; do not use cors() with origin * or true.',
    run({ files }) {
      const src = files['server/index.js'] || '';
      const lines = splitLines(src);
      const items = [];
      const at = (rx) => lines.findIndex((l) => rx.test(l));
      if (at(/helmet\(/) === -1) items.push({ file: 'server/index.js', line: 0, text: 'helmet() is not used' });
      for (const rx of [/contentSecurityPolicy:\s*false/, /cors\(\s*\)|origin:\s*(['"]\*['"]|true\b)/]) {
        const i = at(rx);
        if (i !== -1) items.push({ file: 'server/index.js', line: i + 1, text: lines[i].trim().slice(0, 160) });
      }
      return items.length ? { status: 'warn', note: 'Headers or CORS need a look.', items } : { status: 'pass', note: 'helmet is on with its content security policy, and CORS is not opened up.', items };
    },
  },
  {
    id: 'ssrf', label: 'Web addresses fetched safely (SSRF)', severity: 'high',
    why: 'Fetching a web address a person typed, without the SSRF guard, can make the server reach internal services or cloud metadata.',
    fix: 'Fetch through safeFetch or htmlFetch.checkSsrf (server/utils/safeFetch.js). Same as the SSRF guard rule on the Conventions tab.',
    run({ tools }) {
      const items = [];
      const seen = new Set();
      for (const t of tools) {
        const c = (t.checks || {}).ssrf;
        if (!c || (c.status !== 'fail' && c.status !== 'warn')) continue;
        seen.add(c.status);
        for (const e of c.evidence || []) items.push({ ...e, tool: t.id });
        if (!(c.evidence || []).length) items.push({ file: '', line: 0, text: c.note, tool: t.id });
      }
      const worst = seen.has('fail') ? 'fail' : seen.has('warn') ? 'warn' : 'pass';
      return { status: worst, note: worst === 'pass' ? 'Every tool that fetches a typed web address uses the guard.' : `${new Set(items.map((x) => x.tool)).size} tool(s) to check.`, items };
    },
  },
];

/** Every security check over the code. `manifest` is routeManifest.json's routes object (null when unreadable). */
function buildSecurity({ files, tools = [], mounts = [], manifest = null, checks = CHECKS }) {
  const own = owners(tools);
  const out = checks.map((c) => {
    let r;
    try { r = c.run({ files, tools, mounts, manifest }); } catch (err) { r = { status: 'warn', note: `This check failed to run: ${err.message}`, items: [] }; }
    const items = r.items.map((x) => ({ ...x, tool: x.tool || own[x.file] || null }));
    return { id: c.id, label: c.label, severity: c.severity, why: c.why, fix: c.fix, status: r.status, note: r.note, total: items.length, items: items.slice(0, MAX_ITEMS) };
  });
  const counts = { fail: 0, warn: 0, pass: 0, info: 0 };
  for (const c of out) counts[c.status] = (counts[c.status] || 0) + 1;
  return { checks: out, counts };
}

module.exports = { buildSecurity, CHECKS, redact, SECRET_RX, LITERAL_CHOICE_RX, MAX_ITEMS };
