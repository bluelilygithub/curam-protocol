'use strict';

// Single-flight guard for scheduled jobs. During a rolling deploy two server instances run at once; without this both
// would fire the same cron and send a reminder or digest twice. The lock is a Postgres session-level advisory lock held on
// one pooled connection for the length of the job, so it also frees itself if that connection or the server dies.
//
//   const r = await withCronLock('note-reminders', runNoteReminders);   // r is undefined when another instance holds it
//
// If the lock itself cannot be taken (database unreachable, pool exhausted) the job runs unguarded, exactly as before this
// helper existed: a missed reminder is worse than the small double-send risk, and a job needing the database fails by itself.

const LOCK_NAMESPACE = 7100; // pg_advisory_xact_lock(7001, userId) is already used by the invoice routes

async function withCronLock(name, fn, { pool } = {}) {
  const p = pool || require('../db').pool;
  let client = null;
  let got = false;
  try {
    client = await p.connect();
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1, hashtext($2)) AS got', [LOCK_NAMESPACE, String(name)]);
    got = rows[0].got === true;
  } catch (err) {
    console.warn(`[cron-lock] ${name}: could not take the lock (${err.message}); running without it`);
    if (client) { try { client.release(true); } catch { /* connection already gone */ } client = null; }
    return fn();
  }

  if (!got) {
    client.release();
    console.log(`[cron-lock] ${name}: another instance is running it, skipped`);
    return undefined;
  }

  try {
    return await fn();
  } finally {
    let clean = true;
    try { await client.query('SELECT pg_advisory_unlock($1, hashtext($2))', [LOCK_NAMESPACE, String(name)]); } catch { clean = false; }
    // a connection that still holds the lock must never go back into the pool: destroy it so the session ends and Postgres frees it
    client.release(clean ? undefined : true);
  }
}

module.exports = { withCronLock, LOCK_NAMESPACE };
