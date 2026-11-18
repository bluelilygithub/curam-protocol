#!/usr/bin/env node
/**
 * Vault must start on a brand-new, empty database. server/db.js builds every table on boot, in file order, inside one transaction for
 * the main block, so a table that points at another table created further down ("relation clients does not exist") stops the whole boot.
 * This makes a throwaway database on THIS machine, loads db.js against it in a child process (db.js starts initSchema by itself and prints
 * "[db] Schema ready", or exits 1 with "[db] PostgreSQL startup failed"), then runs the schema a second time to prove it stays idempotent,
 * and drops the database.
 *
 * Run: DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_local node server/db.freshSchema.test.js
 *      DATABASE_URL is only used to connect and create / drop the throwaway database; nothing in that database is touched.
 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const { Client } = require('pg');

const base = process.env.DATABASE_URL;
const local = (() => { try { return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(base).hostname); } catch { return false; } })();
if (!base || !local) {
  console.log('SKIP db.freshSchema.test.js: set DATABASE_URL to a Postgres on this machine (localhost / 127.0.0.1)');
  process.exit(0);
}

const name = `vault_fresh_${Date.now()}_${process.pid}`;
const urlFor = (db) => { const u = new URL(base); u.pathname = `/${db}`; return u.toString(); };
const TIMEOUT_MS = 240000;

/** Loads db.js against the database in a child process. Resolves { ok, output }. */
function boot(url) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', "require('./server/db')"], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env, DATABASE_URL: url, NODE_ENV: 'test', LOG_LEVEL: 'silent', DISABLE_EXTERNAL_CRON: 'true',
        SEED_EMAIL: '', SEED_PASSWORD: '', ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let done = false;
    const finish = (ok) => { if (done) return; done = true; clearTimeout(timer); child.kill(); resolve({ ok, output }); };
    const timer = setTimeout(() => { output += '\n(timed out)'; finish(false); }, TIMEOUT_MS);
    const read = (chunk) => {
      output += chunk;
      if (output.includes('[db] Schema ready')) finish(true);
      else if (output.includes('[db] PostgreSQL startup failed')) finish(false);
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.on('exit', () => finish(output.includes('[db] Schema ready')));
  });
}

(async () => {
  const admin = new Client({ connectionString: base });
  await admin.connect();
  let failed = 0;
  try {
    await admin.query(`CREATE DATABASE ${name}`);

    const first = await boot(urlFor(name));
    if (first.ok) console.log('  ok   an empty database gets the whole schema on first boot');
    else { failed += 1; console.log(`  FAIL first boot on an empty database:\n${first.output.split('\n').filter((l) => /\[db\]|Error|error/.test(l)).slice(-8).join('\n')}`); }

    if (first.ok) {
      const db = new Client({ connectionString: urlFor(name) });
      await db.connect();
      const tables = Number((await db.query(`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = current_schema()`)).rows[0].count);
      const clientFks = Number((await db.query(
        `SELECT COUNT(*) FROM pg_constraint c JOIN pg_class t ON t.oid = c.confrelid WHERE c.contype = 'f' AND t.relname = 'clients'`)).rows[0].count);
      const efClient = (await db.query(
        `SELECT 1 FROM pg_constraint c JOIN pg_class s ON s.oid = c.conrelid JOIN pg_class t ON t.oid = c.confrelid
          WHERE c.contype = 'f' AND s.relname = 'ef_cases' AND t.relname = 'clients'`)).rows.length;
      await db.end();
      if (tables > 100 && clientFks > 10 && efClient === 1) console.log(`  ok   ${tables} tables, ${clientFks} links to clients, ef_cases."clientId" still points at clients`);
      else { failed += 1; console.log(`  FAIL schema looks incomplete: ${tables} tables, ${clientFks} links to clients, ef_cases link ${efClient}`); }

      const second = await boot(urlFor(name));
      if (second.ok) console.log('  ok   a second boot on the same database succeeds (every statement is idempotent)');
      else { failed += 1; console.log(`  FAIL second boot:\n${second.output.split('\n').filter((l) => /\[db\]/.test(l)).slice(-5).join('\n')}`); }
    }
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch((e) => console.log(`  note could not drop ${name}: ${e.message}`));
    await admin.end();
  }
  console.log(failed ? `db.freshSchema: ${failed} failed` : 'db.freshSchema tests passed');
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
