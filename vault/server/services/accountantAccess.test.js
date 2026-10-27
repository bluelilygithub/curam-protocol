#!/usr/bin/env node
/**
 * Accountant scope: Finance always, Shares only when the owner opted that accountant in, read-only,
 * Questions history never. Run: node server/services/accountantAccess.test.js
 */
'use strict';
const assert = require('assert');
const { isSharesPath, hasSharesAccess, applyAccountantScope } = require('./accountantAccess');

let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log(`  ok   ${name}`); };

const accountant = (featureOverrides) => ({ id: 34, email: 'acc@example.com', accountantOfUserId: 1, featureOverrides });
function run(user, method, path) {
  const req = { method, path, originalUrl: `/api${path}`, headers: {} };
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, on() {} };
  return applyAccountantScope(req, res, user, 'tok').then((ok) => ({ ok, req, res }));
}

(async () => {
  await test('shares paths: everything under /shares except the Questions history', () => {
    assert.ok(isSharesPath('/shares/cgt') && isSharesPath('/shares') && isSharesPath('/shares/statements/5'));
    assert.ok(!isSharesPath('/shares/ask') && !isSharesPath('/shares/ask/3') && !isSharesPath('/sharesx') && !isSharesPath('/finance/x'));
  });

  await test('opt-in is explicit: only featureOverrides.shares === true', () => {
    assert.strictEqual(hasSharesAccess(accountant({ shares: true })), true);
    assert.strictEqual(hasSharesAccess(accountant({ shares: false })), false);
    assert.strictEqual(hasSharesAccess(accountant({})), false);
    assert.strictEqual(hasSharesAccess(accountant(null)), false);
  });

  await test('opted in: GET /shares/cgt reads the OWNER\'s data, flags checked as the accountant', async () => {
    const { ok, req } = await run(accountant({ shares: true }), 'GET', '/shares/cgt');
    assert.strictEqual(ok, true);
    assert.strictEqual(req.user.id, 1);
    assert.strictEqual(req.featureUserId, 34);
    assert.strictEqual(req.user.isAdmin, false);
  });

  await test('not opted in: GET /shares/cgt is refused', async () => {
    const { ok, res } = await run(accountant({ shares: false }), 'GET', '/shares/cgt');
    assert.strictEqual(ok, false);
    assert.strictEqual(res.statusCode, 403);
  });

  await test('opted in but still read-only: POST/PUT/DELETE on shares are refused', async () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const { ok, res } = await run(accountant({ shares: true }), m, '/shares/trades/4');
      assert.strictEqual(ok, false, m);
      assert.strictEqual(res.statusCode, 403, m);
    }
  });

  await test('opted in: the Questions history stays private', async () => {
    const { ok } = await run(accountant({ shares: true }), 'GET', '/shares/ask');
    assert.strictEqual(ok, false);
  });

  await test('the Finance guide (POST /finance-tutor) is allowed, as the accountant itself, and nothing else is', async () => {
    const { ok, req } = await run(accountant({}), 'POST', '/finance-tutor');
    assert.strictEqual(ok, true);
    assert.strictEqual(req.user.id, 34, 'never remapped to the owner');
    for (const [m, p] of [['GET', '/finance-tutor'], ['POST', '/finance-tutor/x'], ['POST', '/finance/invoices'], ['POST', '/notes-tutor']]) {
      const r = await run(accountant({}), m, p);
      assert.strictEqual(r.ok, false, m + ' ' + p);
    }
  });

  await test('Finance is unchanged, other apps stay closed', async () => {
    assert.strictEqual((await run(accountant({ shares: false }), 'GET', '/finance/invoices')).ok, true);
    assert.strictEqual((await run(accountant({ shares: true }), 'GET', '/notes')).ok, false);
    assert.strictEqual((await run(accountant({ shares: true }), 'POST', '/finance/expenses')).ok, false);
  });

  await test('an ended login is refused', async () => {
    const u = { ...accountant({ shares: true }), accessExpiresAt: new Date(Date.now() - 1000) };
    const { ok, res } = await run(u, 'GET', '/shares/cgt');
    assert.strictEqual(ok, false);
    assert.strictEqual(res.statusCode, 401);
  });

  console.log(`\nall ${n} passed`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
