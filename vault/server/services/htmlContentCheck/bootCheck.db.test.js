'use strict';
// DATABASE_URL=... node server/services/htmlContentCheck/bootCheck.db.test.js
// A broken reader bundle files ONE Suggestions-inbox alert however many times the server starts, and a working one files none.
const assert = require('node:assert/strict');

if (!process.env.DATABASE_URL) { console.log('SKIP bootCheck.db.test.js: DATABASE_URL is not set'); process.exit(0); }

let schemaReady;
const schemaDone = new Promise((resolve) => { schemaReady = resolve; });
const realLog = console.log;
console.log = (...a) => { if (String(a[0]).includes('[db] Schema ready')) schemaReady(); realLog(...a); };
const { pool } = require('../../db');
const lib = require('./lib');
const builder = require('../../../scripts/buildHtmlContentCheckLib');
const { makeFingerprint, getPrimaryAdminUserId } = require('../SuggestionService');

(async () => {
  await Promise.race([schemaDone, new Promise((_, rej) => setTimeout(() => rej(new Error('schema never became ready')), 120000))]);
  console.log = realLog;
  const fingerprint = makeFingerprint('html-content-check', 'reader-bundle');
  const adminId = await getPrimaryAdminUserId();
  if (!adminId) { console.log('SKIP bootCheck.db.test.js: no admin user'); return pool.end(); }
  const count = async () => Number((await pool.query('SELECT COUNT(*) n FROM agent_suggestions WHERE "userId" = $1 AND fingerprint = $2', [adminId, fingerprint])).rows[0].n);
  const before = await count();
  const realOut = builder.OUT;
  const realEnv = process.env.NODE_ENV;
  try {
    assert.equal(await lib.bootCheck(), true, 'a working bundle passes');
    assert.equal(await count(), before, 'and files nothing');

    process.env.NODE_ENV = 'production'; // no rebuild on the way
    builder.OUT = `${realOut}.missing`;
    lib._reset();
    assert.equal(await lib.bootCheck(), false);
    assert.equal(await lib.bootCheck(), false, 'a second boot');
    assert.equal(await lib.bootCheck(), false, 'a third boot');
    assert.equal(await count(), Math.max(before, 1), 'one inbox item, not one per boot');
    const row = (await pool.query('SELECT title, source, category FROM agent_suggestions WHERE "userId" = $1 AND fingerprint = $2', [adminId, fingerprint])).rows[0];
    assert.deepEqual(row, { title: 'HTML Content Check cannot read pages', source: 'html-content-check', category: 'alert' });
    console.log('bootCheck.db.test.js: passed');
  } finally {
    builder.OUT = realOut; lib._reset();
    if (realEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = realEnv;
    if (before === 0) await pool.query('DELETE FROM agent_suggestions WHERE "userId" = $1 AND fingerprint = $2', [adminId, fingerprint]);
    await pool.end();
  }
})().catch((err) => { console.error(err); process.exit(1); });
