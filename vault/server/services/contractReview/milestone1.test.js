'use strict';

/**
 * Milestone 1 smoke tests — Contract Review Stage 1: schema, cascading
 * delete, legal hold, middle-draft re-pointing, task unlinking, access
 * checks, and the Round 4 addendum's correction-lineage-survives-delete
 * behavior. No extraction/LLM — reviews/clauses/obligations are inserted
 * directly as SQL fixtures, matching how the pipeline will produce them.
 * Run: node server/services/contractReview/milestone1.test.js
 */

require('dotenv').config();
const assert = require('assert');
const crypto = require('crypto');

// ── Disposable-database safety gate ─────────────────────────────────────────
// This suite creates and deletes real rows. It must never run against a real
// (dev or production) database. TEST_DATABASE_URL is required explicitly —
// DATABASE_URL is never read directly, and is rejected outright if someone
// points TEST_DATABASE_URL at the same value or at a Railway host.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DATABASE_URL) {
  console.error('[contract-review-tests] TEST_DATABASE_URL is not set. Refusing to run — this suite must never touch DATABASE_URL.');
  process.exit(1);
}
if (TEST_DATABASE_URL === process.env.DATABASE_URL) {
  console.error('[contract-review-tests] TEST_DATABASE_URL is identical to DATABASE_URL. Refusing to run.');
  process.exit(1);
}
if (/railway\.internal|rlwy\.net|railway\.app/i.test(TEST_DATABASE_URL)) {
  // Refused by default — a local sandbox couldn't bind a listen socket to run
  // a disposable local Postgres, so a genuinely separate Railway *staging*
  // database (never the production one) was authorized for this run
  // explicitly, out-of-band, by the project owner. Requiring a second,
  // separate env var here (not just allowlisting this hostname permanently)
  // means a future accidental re-run of this exact command still refuses —
  // each use against a Railway host has to be deliberately re-confirmed.
  if (process.env.TEST_DATABASE_CONFIRMED_STAGING !== 'true') {
    console.error('[contract-review-tests] TEST_DATABASE_URL points at a Railway host. Refusing to run unless TEST_DATABASE_CONFIRMED_STAGING=true is also set (deliberately, per-run).');
    process.exit(1);
  }
  console.warn('[contract-review-tests] TEST_DATABASE_URL points at a Railway host, and TEST_DATABASE_CONFIRMED_STAGING=true was set — proceeding. This must be a disposable staging database, never production.');
}
// server/db.js reads process.env.DATABASE_URL at require-time (via
// runtimeConfig) — pointing it at the disposable DB here, in this process
// only, is what makes the app's own pool/initSchema target the test DB
// without touching server/db.js's structure at all.
process.env.DATABASE_URL = TEST_DATABASE_URL;

const { pool, initSchema } = require('../../db');
const ContractService = require('./contractService');

async function waitForSchema() {
  // db.js fires its own initSchema() as an unawaited promise at module load —
  // polling a row count only proves the DATABASE already has that data from
  // some prior run, not that THIS process's own background chain has
  // finished; an early test failure's run().catch() could still call
  // pool.end() while it's mid-flight, throwing "Cannot use a pool after
  // calling end on the pool" from inside it (confirmed via direct repro
  // while debugging Stage 2's milestone2.test.js). Awaiting initSchema()
  // explicitly first (idempotent) closes that gap with a real signal.
  await initSchema();
}

// contracts.userId is ON DELETE CASCADE, so deleting a fixture user cascades
// through every contract/party/document/review/clause/obligation/tracking/
// correction/event it owns — cleanupUsers() below is the whole cleanup story
// for everything EXCEPT rows created independently of a user (e.g. tasks).
async function makeUser(tag) {
  const email = `contract-review-test-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.invalid`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, "passwordHash") VALUES ($1, 'x') RETURNING id`,
    [email]
  );
  return rows[0].id;
}

async function cleanupUsers(userIds) {
  const ids = userIds.filter(Boolean);
  if (ids.length) await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [ids]);
}

async function cleanupTasks(taskIds) {
  const ids = taskIds.filter(Boolean);
  if (ids.length) await pool.query(`DELETE FROM tasks WHERE id = ANY($1)`, [ids]);
}

/** One-off sweep of leftovers from prior interrupted runs (e.g. this suite's
 * own earlier debugging sessions) — same @example.invalid tag makeUser()
 * always uses, so it can never touch a real user. Cascades clean up
 * everything those users owned. Gated by the same TEST_DATABASE_URL check
 * already enforced above (this function only ever runs after that gate). */
async function cleanupLeftoversFromPriorRuns() {
  const { rows } = await pool.query(
    `DELETE FROM users WHERE email LIKE 'contract-review-test-%@example.invalid' RETURNING id`
  );
  const { rows: orphanTasks } = await pool.query(
    `DELETE FROM tasks WHERE title = 'Renew the contract' RETURNING id`
  );
  console.log(`[contract-review-tests] pre-run cleanup: removed ${rows.length} leftover fixture user(s), ${orphanTasks.length} leftover fixture task(s)`);
}

function uuid() {
  return crypto.randomUUID();
}

/** Inserts a fixture review + one clause + one obligation directly (bypassing
 * the pipeline, which doesn't exist yet), plus obligation tracking and a
 * correction referencing them — the full row set a real pipeline run would
 * produce, used to prove cascading delete actually reaches everything. */
async function fixtureReviewWithData(documentId, contractId, { userId, taskId } = {}) {
  const { rows: [review] } = await pool.query(
    `INSERT INTO contract_reviews
       ("documentId", "modelId", "promptVersion", "taxonomyVersion", "contractTypeEnumVersion", status)
     VALUES ($1, 'test-model', 'v1', 'v1', 'v1', 'complete')
     RETURNING id`,
    [documentId]
  );
  const clauseLineage = uuid();
  const { rows: [clause] } = await pool.query(
    `INSERT INTO contract_clauses
       ("reviewId", "lineageId", ordinal, text, "spanStart", "spanEnd")
     VALUES ($1, $2, 1, 'Sample clause text.', 0, 20)
     RETURNING id`,
    [review.id, clauseLineage]
  );
  const obligationLineage = uuid();
  const { rows: [obligation] } = await pool.query(
    `INSERT INTO contract_obligations
       ("reviewId", "contractId", "lineageId", type, description)
     VALUES ($1, $2, $3, 'payment', 'Sample obligation')
     RETURNING id`,
    [review.id, contractId, obligationLineage]
  );
  await pool.query(
    `INSERT INTO contract_obligation_tracking ("contractId", "lineageId", "linkedTaskId")
     VALUES ($1, $2, $3)`,
    [contractId, obligationLineage, taskId || null]
  );
  const { rows: [correction] } = await pool.query(
    `INSERT INTO contract_corrections
       ("userId", "contractId", "clauseId", "lineageId", "matchedTextSnapshot", field, "userValue", action)
     VALUES ($1, $2, $3, $4, $5, 'riskLevel', 'standard', 'override')
     RETURNING id`,
    [userId, contractId, clause.id, clauseLineage, 'Sample clause text.']
  );
  return { review, clause, obligation, clauseLineage, obligationLineage, correction };
}

async function testFullCascade() {
  const userId = await makeUser('cascade');
  try {
    const contract = await ContractService.createContract(userId, { title: 'Cascade test contract' });
    await ContractService.addParty(userId, contract.id, { name: 'Acme Pty Ltd', role: 'vendor' });
    const doc = await ContractService.addDocument(userId, contract.id, {
      file: { buffer: Buffer.from('contract text'), filename: 'test.pdf', mimeType: 'application/pdf' },
    });
    const { review, clause, obligation, correction } = await fixtureReviewWithData(doc.id, contract.id, { userId });

    await ContractService.deleteContract(userId, contract.id);

    const checks = await Promise.all([
      pool.query('SELECT 1 FROM contracts WHERE id=$1', [contract.id]),
      pool.query('SELECT 1 FROM contract_parties WHERE "contractId"=$1', [contract.id]),
      pool.query('SELECT 1 FROM contract_documents WHERE id=$1', [doc.id]),
      pool.query('SELECT 1 FROM contract_reviews WHERE id=$1', [review.id]),
      pool.query('SELECT 1 FROM contract_clauses WHERE id=$1', [clause.id]),
      pool.query('SELECT 1 FROM contract_obligations WHERE id=$1', [obligation.id]),
      pool.query('SELECT 1 FROM contract_obligation_tracking WHERE "contractId"=$1', [contract.id]),
      pool.query('SELECT 1 FROM contract_corrections WHERE id=$1', [correction.id]),
    ]);
    checks.forEach((r, i) => assert.strictEqual(r.rows.length, 0, `row set ${i} should be fully deleted`));
    console.log('  ✓ full cascade removes every child row across all tables');
  } finally {
    await cleanupUsers([userId]);
  }
}

async function testLegalHoldBlocksDeletion() {
  const userId = await makeUser('hold');
  try {
    const contract = await ContractService.createContract(userId, { title: 'Hold test contract' });
    const doc = await ContractService.addDocument(userId, contract.id, {
      file: { buffer: Buffer.from('x'), filename: 'x.pdf', mimeType: 'application/pdf' },
    });
    await ContractService.setLegalHold(userId, contract.id, true);

    await assert.rejects(() => ContractService.deleteContract(userId, contract.id), /legal hold/i);
    await assert.rejects(() => ContractService.deleteDocument(userId, doc.id), /legal hold/i);

    const { rows } = await pool.query('SELECT 1 FROM contracts WHERE id=$1', [contract.id]);
    assert.strictEqual(rows.length, 1, 'contract must still exist after blocked deletes');
    console.log('  ✓ legal hold blocks deletion at both the contract and document level');

    // The gate itself proved deletion is blocked while on hold — release the
    // hold now so this test's own fixture can still be cleaned up below.
    await ContractService.setLegalHold(userId, contract.id, false);
    await ContractService.deleteContract(userId, contract.id);
  } finally {
    await cleanupUsers([userId]);
  }
}

async function testMiddleDraftRepointing() {
  const userId = await makeUser('repoint');
  try {
    const contract = await ContractService.createContract(userId, { title: 'Version chain test contract' });
    const v1 = await ContractService.addDocument(userId, contract.id, {
      file: { buffer: Buffer.from('v1'), filename: 'v1.pdf', mimeType: 'application/pdf' },
    });
    const v2 = await ContractService.addDocument(userId, contract.id, {
      file: { buffer: Buffer.from('v2'), filename: 'v2.pdf', mimeType: 'application/pdf' },
      parentDocumentId: v1.id,
    });
    const v3 = await ContractService.addDocument(userId, contract.id, {
      file: { buffer: Buffer.from('v3'), filename: 'v3.pdf', mimeType: 'application/pdf' },
      parentDocumentId: v2.id,
    });

    await ContractService.deleteDocument(userId, v2.id);

    const { rows: [{ parentDocumentId }] } = await pool.query(
      `SELECT "parentDocumentId" FROM contract_documents WHERE id=$1`, [v3.id]
    );
    assert.strictEqual(parentDocumentId, v1.id, "v3's parent should now be v1, not the deleted v2");
    console.log('  ✓ deleting a middle draft re-points its child to the deleted document\'s own parent');

    await ContractService.deleteContract(userId, contract.id);
  } finally {
    await cleanupUsers([userId]);
  }
}

async function testLinkedTasksUnlinkedNotDeleted() {
  const userId = await makeUser('tasks');
  let taskId;
  try {
    const { rows: [task] } = await pool.query(
      `INSERT INTO tasks (title) VALUES ('Renew the contract') RETURNING id, notes`
    );
    taskId = task.id;
    const contract = await ContractService.createContract(userId, { title: 'Task unlink test contract' });
    const doc = await ContractService.addDocument(userId, contract.id, {
      file: { buffer: Buffer.from('x'), filename: 'x.pdf', mimeType: 'application/pdf' },
    });
    await fixtureReviewWithData(doc.id, contract.id, { userId, taskId: task.id });

    await ContractService.deleteContract(userId, contract.id);

    const { rows: [after] } = await pool.query('SELECT id, notes FROM tasks WHERE id=$1', [task.id]);
    assert.ok(after, 'task row must still exist after contract deletion');
    assert.ok(after.notes && after.notes.includes('Unlinked'), 'task should have an unlink note appended');
    console.log('  ✓ deleting a contract unlinks its tasks (with a note) instead of deleting them');
  } finally {
    await cleanupUsers([userId]);
    await cleanupTasks([taskId]);
  }
}

async function testAccessChecksRejectOtherUser() {
  const ownerId = await makeUser('owner');
  const otherId = await makeUser('other');
  try {
    const contract = await ContractService.createContract(ownerId, { title: 'Access check test contract' });

    await assert.rejects(
      () => ContractService.assertContractAccess(otherId, contract.id),
      ContractService.ContractAccessError
    );
    await assert.rejects(() => ContractService.getContract(otherId, contract.id));
    await assert.rejects(() => ContractService.setLegalHold(otherId, contract.id, true));
    console.log('  ✓ another user\'s access to this contract is rejected everywhere');

    await ContractService.deleteContract(ownerId, contract.id);
  } finally {
    await cleanupUsers([ownerId, otherId]);
  }
}

async function testCorrectionSurvivesDraftDeleteByLineage() {
  const userId = await makeUser('lineage');
  try {
    const contract = await ContractService.createContract(userId, { title: 'Lineage survival test contract' });
    const oldDraft = await ContractService.addDocument(userId, contract.id, {
      file: { buffer: Buffer.from('old'), filename: 'old.pdf', mimeType: 'application/pdf' },
    });
    const { clauseLineage: survivingLineage } = await fixtureReviewWithData(oldDraft.id, contract.id, { userId });

    // A newer draft whose current review has a clause sharing the same lineage
    // (simulating the pipeline's lineage-matching across drafts).
    const newDraft = await ContractService.addDocument(userId, contract.id, {
      file: { buffer: Buffer.from('new'), filename: 'new.pdf', mimeType: 'application/pdf' },
      parentDocumentId: oldDraft.id,
    });
    const { rows: [newReview] } = await pool.query(
      `INSERT INTO contract_reviews
         ("documentId", "modelId", "promptVersion", "taxonomyVersion", "contractTypeEnumVersion", status)
       VALUES ($1, 'test-model', 'v1', 'v1', 'v1', 'complete') RETURNING id`,
      [newDraft.id]
    );
    await pool.query(
      `INSERT INTO contract_clauses ("reviewId", "lineageId", ordinal, text, "spanStart", "spanEnd")
       VALUES ($1, $2, 1, 'Sample clause text.', 0, 20)`,
      [newReview.id, survivingLineage]
    );

    // A second correction whose lineage exists ONLY on the old draft, which is
    // about to be deleted — this one must be removed.
    const orphanLineage = uuid();
    const { rows: [orphanClause] } = await pool.query(
      `INSERT INTO contract_clauses ("reviewId", "lineageId", ordinal, text, "spanStart", "spanEnd")
       VALUES ($1, $2, 2, 'Orphan clause.', 21, 35) RETURNING id`,
      [(await pool.query('SELECT id FROM contract_reviews WHERE "documentId"=$1', [oldDraft.id])).rows[0].id, orphanLineage]
    );
    const { rows: [orphanCorrection] } = await pool.query(
      `INSERT INTO contract_corrections
         ("userId", "contractId", "clauseId", "lineageId", "matchedTextSnapshot", field, "userValue", action)
       VALUES ($1, $2, $3, $4, 'Orphan clause.', 'riskLevel', 'standard', 'override') RETURNING id`,
      [userId, contract.id, orphanClause.id, orphanLineage]
    );

    await ContractService.deleteDocument(userId, oldDraft.id);

    const { rows: survivingRows } = await pool.query(
      `SELECT * FROM contract_corrections WHERE "contractId"=$1 AND "lineageId"=$2`,
      [contract.id, survivingLineage]
    );
    assert.strictEqual(survivingRows.length, 1, 'correction whose lineage survives on a later draft must NOT be deleted');
    assert.strictEqual(survivingRows[0].clauseId, null, 'its clauseId should be nulled (SET NULL), not left pointing at the deleted clause');

    const { rows: orphanRows } = await pool.query(
      `SELECT 1 FROM contract_corrections WHERE id=$1`, [orphanCorrection.id]
    );
    assert.strictEqual(orphanRows.length, 0, 'correction whose lineage exists nowhere else must be removed');
    console.log('  ✓ Round 4 addendum: a correction survives an old-draft delete if its lineage survives elsewhere, and is removed if not');

    await ContractService.deleteContract(userId, contract.id);
  } finally {
    await cleanupUsers([userId]);
  }
}

async function testEnumSyncAssertionCatchesDrift() {
  const { CONTRACT_TYPE_KEYS } = require('../../db');
  const { getPlaybookKeys } = require('./playbooks');
  const { contractTypes } = getPlaybookKeys();
  // Simulate the startup check's own comparison logic (not re-requiring
  // server/index.js, which would boot the whole app) — proves the comparison
  // itself would catch a deliberately-introduced mismatch.
  const desynced = CONTRACT_TYPE_KEYS.concat(['not-a-real-type']);
  const missing = desynced.filter((t) => !contractTypes.includes(t));
  assert.ok(missing.includes('not-a-real-type'), 'the sync check must catch a type with no playbook');
  assert.deepStrictEqual(
    CONTRACT_TYPE_KEYS.filter((t) => !contractTypes.includes(t)),
    [],
    'the real, non-desynced enum must currently match playbooks.js exactly'
  );
  console.log('  ✓ enum-sync comparison catches an introduced mismatch and confirms the real lists currently match');
}

/** Runs the full migration a second time against an already-migrated database
 * and asserts nothing duplicates or errors — proves CREATE TABLE IF NOT EXISTS/
 * ALTER ... ADD COLUMN IF NOT EXISTS/the ON CONFLICT taxonomy seed are all
 * genuinely idempotent, not just written to look idempotent. */
async function testMigrationIsIdempotent() {
  const { rows: [{ count: before }] } = await pool.query(`SELECT COUNT(*) FROM contract_clause_types WHERE "taxonomyVersion"='v1'`);
  assert.strictEqual(Number(before), 14, 'expected the 14 seeded clause types before a second migration run');

  await initSchema(); // second run, same connection/database

  const { rows: [{ count: after }] } = await pool.query(`SELECT COUNT(*) FROM contract_clause_types WHERE "taxonomyVersion"='v1'`);
  assert.strictEqual(Number(after), 14, 'taxonomy seed must not duplicate rows on a second migration run');

  const { rows: tableCheck } = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_name LIKE 'contract_%'`
  );
  assert.ok(tableCheck.length >= 12, `expected at least 12 contract_* tables after re-running the migration, got ${tableCheck.length}`);
  console.log('  ✓ running the migration a second time is a genuine no-op — no duplicate seed rows, all tables still present');
}

async function run() {
  await waitForSchema();
  await cleanupLeftoversFromPriorRuns();
  await testMigrationIsIdempotent();
  await testFullCascade();
  await testLegalHoldBlocksDeletion();
  await testMiddleDraftRepointing();
  await testLinkedTasksUnlinkedNotDeleted();
  await testAccessChecksRejectOtherUser();
  await testCorrectionSurvivesDraftDeleteByLineage();
  await testEnumSyncAssertionCatchesDrift();
  console.log('\nAll Contract Review Stage 1 smoke tests passed.');
  await pool.end();
}

run().catch(async (err) => {
  console.error(err);
  try { await pool.end(); } catch (_) {}
  process.exit(1);
});
