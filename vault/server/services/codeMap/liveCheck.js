'use strict';

// Code Map security, layer 3: checks against the RUNNING site, not the code (docs/code-map.md "Live site checks"). Pressed by an admin on the
// Security tab; no AI, no cost. About 15 harmless requests to the app's own public address (APP_URL via getAppUrl, never a typed address):
// headers on the home page, HTTP to HTTPS, the certificate's expiry, CORS from a foreign origin, protected GET routes refusing a request with
// no sign-in and with a made-up token, public GET routes not erroring, and a malformed JSON body not answered with a stack trace.
// Only GET routes without a :param are sampled, and the only POST sends a broken body to a path that does not exist, so nothing is changed.
// Injectable (fetch, certDays, manifest, pool, captureIf) so the test needs no network or database.

const fs = require('fs');
const path = require('path');
const tls = require('tls');

const ROOT = path.resolve(__dirname, '../../..');
const KEEP = 10;
const TIMEOUT_MS = 10000;
const AUTH_SAMPLE = 10;
const UA = 'Vault Code Map live check';
const FOREIGN_ORIGIN = 'https://code-map-check.invalid';
const PROBE_PATH = '/api/code-map-live-check-probe';
const STACK_RX = /\n\s+at\s|node_modules|SyntaxError:|\.js:\d+:\d+/;

const httpError = (status, message) => Object.assign(new Error(message), { status });
const lower = (headers) => Object.fromEntries([...headers.entries()].map(([k, v]) => [k.toLowerCase(), v]));

async function request(doFetch, target, opts = {}) {
  try {
    const res = await doFetch(target, { redirect: 'manual', ...opts, headers: { 'User-Agent': UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = await res.text().catch(() => '');
    return { status: res.status, headers: lower(res.headers), body: body.slice(0, 20000) };
  } catch (err) {
    return { status: 0, headers: {}, body: '', error: (err && err.message) || 'request failed' };
  }
}

/** Days until the TLS certificate of host expires (null when it cannot be read). */
function certDaysLeft(host, now = Date.now()) {
  return new Promise((resolve) => {
    const s = tls.connect({ host, port: 443, servername: host, timeout: TIMEOUT_MS }, () => {
      const c = s.getPeerCertificate();
      s.end();
      resolve(c && c.valid_to ? Math.floor((new Date(c.valid_to).getTime() - now) / 86400000) : null);
    });
    s.on('error', () => resolve(null));
    s.on('timeout', () => { s.destroy(); resolve(null); });
  });
}

/** GET routes with no :param from the access list: protected ones to probe without a sign-in, and the public ones. */
function sampleRoutes(manifest) {
  const gets = Object.entries(manifest || {}).filter(([k]) => /^GET \/api\//.test(k) && !k.includes(':')).map(([k, v]) => ({ path: k.slice(4), cls: v && v.class }));
  const admin = gets.filter((r) => r.cls === 'admin');
  const authed = gets.filter((r) => r.cls === 'authed');
  const spread = (list, n) => (list.length <= n ? list : Array.from({ length: n }, (_, i) => list[Math.floor((i * list.length) / n)]));
  return {
    protectedRoutes: [...spread(admin, Math.ceil(AUTH_SAMPLE / 2)), ...spread(authed, Math.floor(AUTH_SAMPLE / 2))],
    publicRoutes: gets.filter((r) => r.cls === 'public'),
  };
}

const C = (id, label, severity, why, fix) => ({ id, label, severity, why, fix });
const DEFS = {
  reachable: C('reachable', 'The site answers', 'high', 'Every other live check needs the site to answer at its public address.', 'Check APP_URL in Railway and that the deploy is up.'),
  https: C('https', 'HTTPS only', 'high', 'Plain HTTP can be read and changed on the way. The HTTP address should send visitors to HTTPS.', 'Set APP_URL to the https:// address; Railway serves HTTPS and redirects HTTP by itself.'),
  cert: C('cert', 'Certificate not about to expire', 'high', 'An expired certificate stops browsers opening the site.', 'Railway renews its certificates; for a custom domain check its DNS and certificate in Railway.'),
  hsts: C('hsts', 'Strict-Transport-Security (HSTS)', 'medium', 'Tells browsers to use HTTPS only, even when someone types http://.', 'helmet sends it by default; check nothing removes it (max-age of at least 180 days).'),
  csp: C('csp', 'Content Security Policy', 'medium', 'Limits where scripts can load from, which blunts cross-site scripting. helmet in server/index.js sets it only when NODE_ENV is production.', "Keep helmet's contentSecurityPolicy on in production and avoid 'unsafe-inline' and 'unsafe-eval' in script-src."),
  nosniff: C('nosniff', 'X-Content-Type-Options: nosniff', 'low', 'Stops browsers guessing a file type (an upload treated as a script).', 'helmet sends it by default.'),
  framing: C('framing', 'Cannot be framed by other sites', 'medium', 'Stops another site showing Vault inside a frame to trick clicks (clickjacking).', "Keep helmet's frame-ancestors / X-Frame-Options."),
  referrer: C('referrer', 'Referrer-Policy', 'low', 'Stops full Vault addresses (which can hold ids) leaking to other sites in the Referer header.', 'helmet sends no-referrer by default.'),
  poweredBy: C('poweredBy', 'No X-Powered-By header', 'low', 'Announcing Express makes it easier to target known Express issues.', 'helmet removes it; or app.disable("x-powered-by").'),
  cors: C('cors', 'Other sites cannot call the API from a browser', 'high', 'If the API answers a foreign Origin with Access-Control-Allow-Origin, another website could use a signed-in visitor\'s browser to read Vault data.', 'Do not enable CORS for /api, or allow only named origins.'),
  authRequired: C('authRequired', 'Protected routes refuse anonymous requests', 'high', 'A route marked signed-in or admin in the access list must refuse a request with no sign-in, or with a made-up token.', 'Mount the route after app.use(\'/api\', requireAuth) in server/index.js and fix its class in routeManifest.json.'),
  publicRoutes: C('publicRoutes', 'Public routes answer without errors', 'low', 'The routes open to everyone should answer cleanly; a 500 here can leak detail or show a broken public page.', 'Open the route and its logs; fix the error.'),
  errorLeak: C('errorLeak', 'Errors do not show code details', 'medium', 'A stack trace or file path in an error response tells an attacker how the code is laid out.', 'Answer errors with a short message (as the routes do) and log the detail; check the JSON body parser error handler.'),
};

const result = (def, status, note, items = []) => ({ ...def, status, note, items: items.slice(0, 50), total: items.length });

/**
 * Run every live check against `base` (e.g. https://vault.example.com). Pure apart from the injected fetch and certDays.
 */
async function runLiveChecks({ base, fetch: doFetch = fetch, certDays = certDaysLeft, manifest }) {
  const u = new URL(base);
  const local = /^(localhost|127\.|\[?::1\]?)/.test(u.hostname);
  const at = (p) => `${u.origin}${p}`;
  const out = [];

  const home = await request(doFetch, at('/'));
  if (!home.status || home.status >= 500) {
    out.push(result(DEFS.reachable, 'fail', home.error ? `No answer from ${u.origin}: ${home.error}` : `${u.origin} answered ${home.status}.`));
    return finish(base, out);
  }
  out.push(result(DEFS.reachable, 'pass', `${u.origin} answered ${home.status}.`));
  const h = home.headers;

  // HTTPS, certificate, HSTS: not applicable to a local http address
  if (u.protocol !== 'https:') {
    for (const d of [DEFS.https, DEFS.cert, DEFS.hsts]) out.push(result(d, local ? 'na' : 'fail', local ? 'Local address over http: checked only on the deployed site.' : `APP_URL is ${u.origin}, not https.`));
  } else {
    const plain = await request(doFetch, `http://${u.host}/`);
    const loc = plain.headers.location || '';
    out.push(plain.status >= 300 && plain.status < 400 && loc.startsWith('https://')
      ? result(DEFS.https, 'pass', `http:// answers ${plain.status} to ${loc}.`)
      : result(DEFS.https, plain.status ? 'fail' : 'warn', plain.status ? `http:// answered ${plain.status}${loc ? ` to ${loc}` : ''} instead of redirecting to https.` : `http:// could not be reached (${plain.error || 'no answer'}); fine if the host only listens on HTTPS.`));
    const days = await certDays(u.hostname);
    out.push(days == null ? result(DEFS.cert, 'warn', 'The certificate could not be read.')
      : result(DEFS.cert, days < 7 ? 'fail' : days < 21 ? 'warn' : 'pass', `The certificate expires in ${days} days.`));
    const max = Number((/max-age=(\d+)/i.exec(h['strict-transport-security'] || '') || [])[1] || 0);
    out.push(!h['strict-transport-security'] ? result(DEFS.hsts, 'fail', 'No Strict-Transport-Security header on the home page.')
      : result(DEFS.hsts, max >= 15552000 ? 'pass' : 'warn', `Strict-Transport-Security: ${h['strict-transport-security']}`));
  }

  const csp = h['content-security-policy'] || '';
  const scriptSrc = (/(?:^|;)\s*script-src\s+([^;]*)/i.exec(csp) || /(?:^|;)\s*default-src\s+([^;]*)/i.exec(csp) || [])[1] || '';
  out.push(!csp ? result(DEFS.csp, local ? 'na' : 'fail', local ? 'No policy: helmet sets it only when NODE_ENV is production, so this is expected locally.' : 'No Content-Security-Policy header on the home page.')
    : /'unsafe-inline'|'unsafe-eval'/.test(scriptSrc) ? result(DEFS.csp, 'warn', `script-src allows ${scriptSrc.match(/'unsafe-(inline|eval)'/g).join(' and ')}.`, [{ text: `script-src ${scriptSrc}` }])
      : result(DEFS.csp, 'pass', 'A policy is sent and script-src has no unsafe-inline or unsafe-eval.', [{ text: `script-src ${scriptSrc || '(from default-src)'}` }]));
  out.push(result(DEFS.nosniff, /nosniff/i.test(h['x-content-type-options'] || '') ? 'pass' : 'fail', `X-Content-Type-Options: ${h['x-content-type-options'] || '(missing)'}`));
  const framed = /frame-ancestors\s+('none'|'self')/i.test(csp) || /^(deny|sameorigin)$/i.test(h['x-frame-options'] || '');
  out.push(result(DEFS.framing, framed ? 'pass' : 'fail', framed ? `X-Frame-Options: ${h['x-frame-options'] || '(none)'}${/frame-ancestors/i.test(csp) ? `; ${/frame-ancestors[^;]*/i.exec(csp)[0]}` : ''}` : 'Neither frame-ancestors nor X-Frame-Options is set.'));
  out.push(result(DEFS.referrer, h['referrer-policy'] ? 'pass' : 'warn', `Referrer-Policy: ${h['referrer-policy'] || '(missing)'}`));
  out.push(result(DEFS.poweredBy, h['x-powered-by'] ? 'warn' : 'pass', h['x-powered-by'] ? `X-Powered-By: ${h['x-powered-by']}` : 'Not sent.'));

  const cors = await request(doFetch, at('/api/health'), { headers: { Origin: FOREIGN_ORIGIN } });
  const acao = cors.headers['access-control-allow-origin'];
  out.push(!cors.status ? result(DEFS.cors, 'warn', `/api/health could not be reached: ${cors.error}`)
    : acao === '*' || acao === FOREIGN_ORIGIN ? result(DEFS.cors, 'fail', `/api/health answered a foreign Origin with Access-Control-Allow-Origin: ${acao}${cors.headers['access-control-allow-credentials'] === 'true' ? ' and allows credentials' : ''}.`)
      : result(DEFS.cors, 'pass', acao ? `Access-Control-Allow-Origin is ${acao}, not the foreign origin.` : 'No Access-Control-Allow-Origin for a foreign origin.'));

  const { protectedRoutes, publicRoutes } = sampleRoutes(manifest);
  if (!manifest) {
    out.push(result(DEFS.authRequired, 'warn', 'server/testing/routeManifest.json could not be read, so no routes were sampled.'));
  } else {
    const ok = (s) => s === 401 || s === 403;
    const items = await Promise.all(protectedRoutes.map(async (r) => {
      const [none, fake] = await Promise.all([request(doFetch, at(r.path)), request(doFetch, at(r.path), { headers: { Authorization: `Bearer ${'0'.repeat(64)}` } })]);
      return { text: `${ok(none.status) && ok(fake.status) ? 'refused' : 'NOT REFUSED'}: GET ${r.path} (${r.cls}) → no sign-in ${none.status || none.error}, made-up token ${fake.status || fake.error}` };
    }));
    const open = items.filter((i) => i.text.startsWith('NOT')).length;
    items.sort((a, b) => Number(b.text.startsWith('NOT')) - Number(a.text.startsWith('NOT')));
    out.push(result(DEFS.authRequired, open ? 'fail' : 'pass', open ? `${open} of ${protectedRoutes.length} sampled protected routes did not refuse.` : `All ${protectedRoutes.length} sampled protected routes refused both requests.`, items));
  }

  const pub = await Promise.all(publicRoutes.map(async (r) => { const x = await request(doFetch, at(r.path)); return { status: x.status, text: `GET ${r.path} → ${x.status || x.error}` }; }));
  const broken = pub.filter((x) => !x.status || x.status >= 500);
  out.push(result(DEFS.publicRoutes, broken.length ? 'warn' : publicRoutes.length ? 'pass' : 'na', publicRoutes.length ? `${pub.length} public GET route(s) tried; ${broken.length} errored.` : 'No public GET routes without an id in the access list.', [...broken, ...pub.filter((x) => !broken.includes(x))].map(({ text }) => ({ text }))));

  const bad = await request(doFetch, at(PROBE_PATH), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"broken": ' });
  out.push(!bad.status ? result(DEFS.errorLeak, 'warn', `The probe could not be sent: ${bad.error}`)
    : STACK_RX.test(bad.body) ? result(DEFS.errorLeak, 'fail', `A malformed JSON body got ${bad.status} with code details in the answer.`, [{ text: bad.body.slice(0, 300) }])
      : result(DEFS.errorLeak, 'pass', `A malformed JSON body got ${bad.status} with no stack trace or file path.`));

  return finish(base, out);
}

function finish(base, checks) {
  const counts = {};
  for (const c of checks) counts[c.status] = (counts[c.status] || 0) + 1;
  return { base, checks, counts };
}

function readManifest() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'server/testing/routeManifest.json'), 'utf8')).routes || null; } catch { return null; }
}

function createLiveChecks(deps = {}) {
  const d = {
    pool: deps.pool || (() => require('../../db').pool),
    run: deps.run || ((base) => runLiveChecks({ base, manifest: readManifest() })),
    captureIf: deps.captureIf || ((c, p) => require('../SuggestionService').captureIf(c, p)),
    makeFingerprint: deps.makeFingerprint || ((s, k) => require('../SuggestionService').makeFingerprint(s, k)),
    log: deps.log || (() => require('../../middleware/requestContext').getLogger()),
  };
  const q = (sql, params) => (typeof d.pool === 'function' ? d.pool() : d.pool).query(sql, params);
  let busy = false;
  const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
  const shape = (r) => (r ? { id: r.id, userId: r.userId, base: r.base, durationMs: r.durationMs, createdAt: r.createdAt, ...parse(r.result) } : null);

  /** Run the checks now against base, store them, raise failing high checks in the inbox. Takes a few seconds. */
  async function check(userId, base) {
    if (busy) throw httpError(409, 'A live check is already running. Wait a few seconds.');
    busy = true;
    try {
      const t0 = Date.now();
      const r = await d.run(base);
      const { rows } = await q(`INSERT INTO code_map_live_checks ("userId", base, result, "durationMs") VALUES ($1, $2, $3, $4) RETURNING id, "createdAt"`,
        [userId, base, JSON.stringify({ checks: r.checks, counts: r.counts }), Date.now() - t0]);
      try {
        await q(`DELETE FROM code_map_live_checks WHERE id NOT IN (SELECT id FROM code_map_live_checks ORDER BY id DESC LIMIT $1)`, [KEEP]);
      } catch (err) { d.log().error({ err }, '[codeMap] trimming old live checks failed'); }
      try {
        for (const c of r.checks) {
          await d.captureIf(c.status === 'fail' && c.severity === 'high', {
            userId, source: 'codeMap', category: 'alert', fingerprint: d.makeFingerprint('codeMap', `live:${c.id}`),
            title: `Code Map live check: ${c.label}`,
            body: [c.note, `${c.why} ${c.fix}`, ...(c.items || []).slice(0, 6).map((i) => `- ${i.text}`)].filter(Boolean).join('\n\n'),
            context: `Live check of ${base}. Open Code Map → Security for every check.`,
          });
        }
      } catch (err) { d.log().error({ err }, '[codeMap] raising live checks in the inbox failed'); }
      return { id: rows[0].id, userId, base, durationMs: Date.now() - t0, createdAt: rows[0].createdAt, checks: r.checks, counts: r.counts };
    } finally {
      busy = false;
    }
  }

  async function latest() {
    const { rows } = await q(`SELECT * FROM code_map_live_checks ORDER BY id DESC LIMIT 1`);
    return shape(rows[0]);
  }

  return { check, latest };
}

module.exports = { createLiveChecks, runLiveChecks, sampleRoutes, certDaysLeft, DEFS, FOREIGN_ORIGIN, PROBE_PATH, ...createLiveChecks() };
