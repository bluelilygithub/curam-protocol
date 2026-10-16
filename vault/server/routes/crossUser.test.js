#!/usr/bin/env node
/**
 * Cross-user route test. Boots the real app and checks, for EVERY route it serves:
 *   1. Inventory: the route is listed in server/testing/routeManifest.json with a class. A route added
 *      without being classified fails here, so nobody can ship a new endpoint without deciding who may
 *      call it. (Run with --update to add new routes to the manifest, then review the diff.)
 *   2. Signed out: every route that is not marked public answers 401.
 *   3. Admin: every admin route answers 403 to an ordinary signed-in member.
 * The ownership probes (user B using user A's ids) are in crossUserOwnership.test.js.
 *
 * Integration test: needs a throwaway Postgres on THIS machine (the harness refuses anything else) and
 * never makes an outside network call.
 * Run: DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_xuser node server/routes/crossUser.test.js [--update]
 */
'use strict';
const harness = require('../testing/crossUserHarness');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { listRoutes } = require('../testing/listRoutes');

const MANIFEST = path.join(__dirname, '..', 'testing', 'routeManifest.json');
const UPDATE = process.argv.includes('--update');
const key = (r) => `${r.method} ${r.path}`;
const fill = (p) => p.replace(/:([A-Za-z0-9_]+)(\([^)]*\))?\??/g, '1').replace(/\*/g, 'x');

(async () => {
  const h = await harness.start();
  const routes = listRoutes(h.app);
  const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : { routes: {} };
  let failed = 0;
  const fail = (msg) => { failed++; console.log(`  FAIL ${msg}`); };
  const ok = (msg) => console.log(`  ok   ${msg}`);

  const member = await h.makeUser('member', false);

  // ── 1. discover who answers without a token, to classify new routes ─────────────────────────────
  const unauth = {};
  for (const r of routes) {
    const res = await harness.call(h.base, r.method, fill(r.path), { body: {} });
    unauth[key(r)] = res.status;
  }
  const classify = (r) => {
    if (unauth[key(r)] !== 401) return 'public';
    if (r.path.startsWith('/api/admin')) return 'admin';
    return 'authed';
  };

  if (UPDATE) {
    const next = { _note: 'Every route the app serves and who may call it: public (no sign-in, by design), admin, or authed (any signed-in user; ids are checked per owner). Add new routes with --update, then review.', routes: {} };
    for (const r of routes) {
      const prev = manifest.routes[key(r)];
      next.routes[key(r)] = prev || { class: classify(r) };
    }
    fs.writeFileSync(MANIFEST, JSON.stringify(next, null, 1) + '\n');
    console.log(`manifest updated: ${routes.length} routes`);
    process.exit(0);
  }

  // 1. inventory
  const known = new Set(Object.keys(manifest.routes));
  const unclassified = routes.filter((r) => !known.has(key(r)));
  const stale = [...known].filter((k) => !routes.some((r) => key(r) === k));
  if (unclassified.length) fail(`inventory: ${unclassified.length} route(s) not in routeManifest.json (run with --update and review): ${unclassified.slice(0, 8).map(key).join(', ')}${unclassified.length > 8 ? ', …' : ''}`);
  else ok(`inventory: all ${routes.length} routes are classified`);
  if (stale.length) console.log(`  note ${stale.length} manifest entries no longer match a route (remove them): ${stale.slice(0, 5).join(', ')}`);

  // a route that is open to the world must be marked public in the manifest, never by accident
  const accidentallyOpen = routes.filter((r) => manifest.routes[key(r)] && manifest.routes[key(r)].class !== 'public' && unauth[key(r)] !== 401);
  if (accidentallyOpen.length) fail(`signed-out: ${accidentallyOpen.length} route(s) answered without a sign-in but are not marked public: ${accidentallyOpen.slice(0, 8).map((r) => `${key(r)} -> ${unauth[key(r)]}`).join(', ')}`);
  else ok(`signed-out: every route that is not marked public answers 401 (${routes.filter((r) => manifest.routes[key(r)] && manifest.routes[key(r)].class !== 'public').length} checked)`);

  const publicNow = routes.filter((r) => unauth[key(r)] !== 401 && manifest.routes[key(r)] && manifest.routes[key(r)].class === 'public');
  console.log(`  note ${publicNow.length} routes are public by design (see manifest class "public")`);

  // 3. admin routes refuse an ordinary member
  const adminRoutes = routes.filter((r) => manifest.routes[key(r)] && manifest.routes[key(r)].class === 'admin');
  const notRefused = [];
  for (const r of adminRoutes) {
    const res = await harness.call(h.base, r.method, fill(r.path), { token: member.token, body: {} });
    if (res.status !== 403) notRefused.push(`${key(r)} -> ${res.status}`);
  }
  if (notRefused.length) fail(`admin: ${notRefused.length} admin route(s) did not answer 403 to a member: ${notRefused.slice(0, 8).join(', ')}`);
  else ok(`admin: all ${adminRoutes.length} admin routes answer 403 to an ordinary member`);

  if (h.blocked.length) console.log(`  note ${h.blocked.length} outside network attempt(s) were blocked: ${[...new Set(h.blocked)].slice(0, 5).join(', ')}`);

  await h.pool.query('DELETE FROM users WHERE id = $1', [member.id]);
  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
