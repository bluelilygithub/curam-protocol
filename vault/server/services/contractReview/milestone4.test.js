'use strict';

/**
 * Milestone 4 smoke tests — Contract Review Stage 4: obligations extraction
 * + tracking + execution/promotion. Runs the LIVE pipeline end to end and
 * checks each smoke fixture's expectedObligations (obligor, timing shape, no
 * invented dates — written in smokeSet/expected.js before any Stage 4 code
 * existed), plus the execution/promotion/tracking/ICS mechanics the spec
 * assigns to this stage.
 *
 * Run: node server/services/contractReview/milestone4.test.js
 */

require('dotenv').config();
const assert = require('assert');

// pg returns a DATE column as either a string ('YYYY-MM-DD') or a JS Date
// object depending on context (confirmed live: a naive String(val).slice(0,10)
// on a Date object produces "Tue Jun 30", not "2026-06-30" — node's default
// Date.toString() is locale/timezone text, not ISO). node-pg's date parser
// builds DATE-typed Date objects at UTC midnight, so .toISOString() round-
// trips correctly with no timezone drift either way.
function toIsoDateOnly(val) {
  if (val == null) return null;
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val).slice(0, 10);
}

// ── Disposable-database safety gate (identical to milestone1/2/3.test.js) ──
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
  if (process.env.TEST_DATABASE_CONFIRMED_STAGING !== 'true') {
    console.error('[contract-review-tests] TEST_DATABASE_URL points at a Railway host. Refusing to run unless TEST_DATABASE_CONFIRMED_STAGING=true is also set (deliberately, per-run).');
    process.exit(1);
  }
  console.warn('[contract-review-tests] TEST_DATABASE_URL points at a Railway host, and TEST_DATABASE_CONFIRMED_STAGING=true was set — proceeding. This must be a disposable staging database, never production.');
}
process.env.DATABASE_URL = TEST_DATABASE_URL;

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('[contract-review-tests] ANTHROPIC_API_KEY is not set — Stage 4 makes real LLM calls and cannot run without it.');
  process.exit(1);
}

const { pool, initSchema } = require('../../db');
const ContractService = require('./contractService');
const { ingestDocument } = require('./ingest');
const { segmentDocument } = require('./segmentation');
const { runAnalysis, resumeAfterRoleConfirmation } = require('./analysisPipeline');
const { buildAllFixtures } = require('./smokeSet/buildFixtures');
const { isPdftoppmAvailable } = require('./pdfRasterize');
const { isPdftotextAvailable } = require('./pdfTextExtract');
const { normalize } = require('./grounding');
const expected = require('./smokeSet/expected');

const OCR_FIXTURE_KEYS = new Set(['scanned', 'mixed']);
const PDF_FIXTURE_KEYS = new Set(['scanned', 'mixed', 'deepNesting', 'amendment']);

async function waitForSchema() { await initSchema(); }

async function makeUser(tag) {
  const email = `contract-review-test-m4-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.invalid`;
  const { rows } = await pool.query(`INSERT INTO users (email, "passwordHash") VALUES ($1, 'x') RETURNING id`, [email]);
  await pool.query(
    `INSERT INTO settings ("userId", key, value) VALUES ($1, 'vault_models', $2)`,
    [rows[0].id, JSON.stringify([{ id: 'claude-haiku-4-5-20251001', name: 'Haiku', provider: 'anthropic' }])]
  );
  return rows[0].id;
}

async function cleanupUsers(userIds) {
  const ids = userIds.filter(Boolean);
  if (ids.length) await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [ids]);
}

async function cleanupLeftoversFromPriorRuns() {
  const { rows } = await pool.query(`DELETE FROM users WHERE email LIKE 'contract-review-test-m4-%@example.invalid' RETURNING id`);
  console.log(`[contract-review-tests] pre-run cleanup: removed ${rows.length} leftover fixture user(s)`);
}

let fixtures = null;
async function getFixtures() {
  if (!fixtures) fixtures = await buildAllFixtures();
  return fixtures;
}

async function runFixtureThroughAnalysis(userId, fixtureKey) {
  const fx = (await getFixtures())[fixtureKey];
  const exp = expected[fixtureKey];
  const contract = await ContractService.createContract(userId, { title: `Smoke set (m4): ${fixtureKey}` });
  const doc = await ContractService.addDocument(userId, contract.id, {
    file: { buffer: fx.buffer, filename: fx.filename, mimeType: fx.mimeType },
  });
  const ingestResult = await ingestDocument(doc.id);
  if (ingestResult.outcome !== 'complete') throw new Error(`Fixture ${fixtureKey} did not extract cleanly (outcome=${ingestResult.outcome})`);
  await segmentDocument(ingestResult.reviewId, ingestResult.extractedText, ingestResult.pageMap, { userId });

  await runAnalysis(ingestResult.reviewId, { userId });
  const targetName = exp.parties.find((p) => p.isUser).name;
  const { rows: parties } = await pool.query(`SELECT * FROM contract_parties WHERE "contractId"=$1`, [contract.id]);
  const targetParty = parties.find((p) => normalize(p.name) === normalize(targetName));
  assert.ok(targetParty, `expected an extracted party matching "${targetName}" (fixture: ${fixtureKey})`);
  await ContractService.confirmParty(userId, contract.id, targetParty.id);
  const finalResult = await resumeAfterRoleConfirmation(ingestResult.reviewId, { userId });
  assert.strictEqual(finalResult.status, 'complete', `expected review to complete (fixture ${fixtureKey})`);

  const review = await ContractService.getReview(userId, ingestResult.reviewId);
  console.log(`  [cost] ${fixtureKey}: $${Number(review.costUsd || 0).toFixed(4)}`);
  return { contract, doc, review, extractedText: ingestResult.extractedText, userPartyId: targetParty.id };
}

function findMatchingObligation(obligations, extractedText, expectedOb) {
  const idx = extractedText.indexOf(expectedOb.sourceQuote);
  if (idx === -1) return null;
  const quoteStart = idx;
  const quoteEnd = idx + expectedOb.sourceQuote.length;
  const overlapping = obligations.filter((o) => o.spanStart != null && o.spanEnd != null && o.spanStart < quoteEnd && o.spanEnd > quoteStart);
  if (overlapping.length) return overlapping[0];
  // Fallback for an obligation the model didn't ground with a quote — match
  // on timing-shape signature alone.
  return obligations.find((o) => {
    if (expectedOb.timingShape === 'absolute') return toIsoDateOnly(o.absoluteDate) === expectedOb.absoluteDate;
    if (expectedOb.timingShape === 'anchorOffset') return o.offsetDays === expectedOb.offsetDays && (!expectedOb.anchorEvent || o.anchorEvent === expectedOb.anchorEvent);
    if (expectedOb.timingShape === 'rrule') return !!o.rrule;
    return false;
  }) || null;
}

async function testObligationsForFixture(key) {
  const userId = await makeUser(`ob-${key}`);
  try {
    if (PDF_FIXTURE_KEYS.has(key) && !(await isPdftotextAvailable())) { console.log(`  ⚠ SKIPPED (pdftotext unavailable) — obligations for "${key}"`); return; }
    if (OCR_FIXTURE_KEYS.has(key) && !(await isPdftoppmAvailable())) { console.log(`  ⚠ SKIPPED (pdftoppm unavailable) — obligations for "${key}"`); return; }
    const exp = expected[key];
    const { review, extractedText, userPartyId } = await runFixtureThroughAnalysis(userId, key);

    for (const expOb of exp.expectedObligations) {
      const match = findMatchingObligation(review.obligations, extractedText, expOb);
      assert.ok(match, `no extracted obligation matched expected "${expOb.description}" (fixture ${key})`);

      if (expOb.timingShape === 'absolute') {
        assert.strictEqual(toIsoDateOnly(match.absoluteDate), expOb.absoluteDate,
          `wrong absoluteDate for "${expOb.description}" (fixture ${key})`);
      } else {
        // No invented date — an anchor/rrule-shaped obligation must never
        // carry a guessed absoluteDate.
        assert.strictEqual(match.absoluteDate, null, `obligation invented an absoluteDate for a ${expOb.timingShape}-shaped obligation (fixture ${key}): "${expOb.description}"`);
        if (expOb.timingShape === 'anchorOffset') {
          assert.strictEqual(match.offsetDays, expOb.offsetDays, `wrong offsetDays for "${expOb.description}" (fixture ${key})`);
          if (expOb.anchorEvent) assert.strictEqual(match.anchorEvent, expOb.anchorEvent, `wrong anchorEvent for "${expOb.description}" (fixture ${key})`);
        } else if (expOb.timingShape === 'rrule') {
          assert.ok(match.rrule, `expected a non-null rrule for "${expOb.description}" (fixture ${key})`);
        }
      }

      if (expOb.obligor === 'user') {
        assert.strictEqual(match.obligorPartyId, userPartyId, `expected obligor to be the user party for "${expOb.description}" (fixture ${key})`);
      } else if (expOb.obligor === 'counterparty') {
        assert.ok(match.obligorPartyId && match.obligorPartyId !== userPartyId, `expected obligor to be a real, non-user party for "${expOb.description}" (fixture ${key})`);
      } // 'ambiguous' — no assertion; genuinely allowed to be null or any party.
    }
    console.log(`  ✓ [${key}] every expected obligation found with correct obligor + timing shape, no invented dates`);
  } finally {
    await cleanupUsers([userId]);
  }
}

/** Execution + promotion smoke: marking a document executed promotes its
 * detected contractType/key terms onto contracts (spec Stage 4). */
async function testExecutionAndPromotion() {
  const userId = await makeUser('execution');
  try {
    if (!(await isPdftotextAvailable())) { console.log('  ⚠ SKIPPED (pdftotext unavailable) — execution/promotion test'); return; }
    const { contract, doc, review } = await runFixtureThroughAnalysis(userId, 'deepNesting');
    assert.strictEqual((await ContractService.getContract(userId, contract.id)).contractType, 'other', 'contract.contractType must stay the default until execution — promotion has not run yet');

    await ContractService.markDocumentExecuted(userId, doc.id);
    const updated = await ContractService.getContract(userId, contract.id);
    assert.strictEqual(updated.status, 'executed', 'contract status must flip to executed');
    assert.strictEqual(updated.contractType, review.detectedContractType, 'markDocumentExecuted must promote the review\'s detectedContractType onto the contract');
    assert.strictEqual(updated.termLengthMonths, 12, 'markDocumentExecuted must promote extractedKeyTerms.termLengthMonths onto the contract');

    const { rows: [docRow] } = await pool.query(`SELECT status FROM contract_documents WHERE id=$1`, [doc.id]);
    assert.strictEqual(docRow.status, 'executed', 'document status must flip to executed');
    console.log('  ✓ markDocumentExecuted promotes detectedContractType/key terms onto the contract and flips both statuses');
  } finally {
    await cleanupUsers([userId]);
  }
}

/** Obligation tracking + ICS export smoke: an obligation on an executed
 * document becomes "active", can be marked handled, linked to a task
 * (unlinked on contract delete), and a resolvable one appears in the .ics
 * export while an unverified one does not. */
async function testObligationTrackingAndIcs() {
  const userId = await makeUser('tracking');
  try {
    if (!(await isPdftotextAvailable())) { console.log('  ⚠ SKIPPED (pdftotext unavailable) — obligation tracking/ICS test'); return; }
    const { contract, doc } = await runFixtureThroughAnalysis(userId, 'amendment');
    await ContractService.markDocumentExecuted(userId, doc.id);

    const obligations = await ContractService.listObligations(userId, { contractId: contract.id });
    assert.ok(obligations.length > 0, 'expected at least one active obligation after execution');

    const target = obligations[0];
    await ContractService.setObligationState(userId, target.id, 'handled');
    const afterState = await ContractService.listObligations(userId, { contractId: contract.id });
    assert.strictEqual(afterState.find((o) => o.id === target.id).userState, 'handled', 'setObligationState must persist via contract_obligation_tracking');

    const taskRes = await pool.query(
      `INSERT INTO tasks (title, "userId") VALUES ('Contract Review test task', $1) RETURNING id`,
      [userId]
    );
    const taskId = taskRes.rows[0].id;
    await ContractService.linkObligationToTask(userId, target.id, taskId);
    const afterLink = await ContractService.listObligations(userId, { contractId: contract.id });
    assert.strictEqual(afterLink.find((o) => o.id === target.id).linkedTaskId, taskId, 'linkObligationToTask must persist the link');

    const ics = await ContractService.exportIcs(userId, { contractId: contract.id });
    assert.ok(ics.startsWith('BEGIN:VCALENDAR') && ics.trim().endsWith('END:VCALENDAR'), 'exportIcs must return a well-formed ICS document');
    const resolvableCount = obligations.filter((o) => o.verificationStatus !== 'failed' && (o.absoluteDate || o.anchorEvent === 'effective_date' || o.rrule)).length;
    if (resolvableCount > 0) {
      assert.ok(ics.includes('BEGIN:VEVENT'), 'expected at least one VEVENT for a resolvable, verified obligation');
    }

    await ContractService.deleteContract(userId, contract.id);
    const { rows: [taskAfterDelete] } = await pool.query(`SELECT notes FROM tasks WHERE id=$1`, [taskId]);
    assert.ok(taskAfterDelete.notes && /unlinked/i.test(taskAfterDelete.notes), 'deleting the contract must unlink (not delete) the linked task, with a note');
    await pool.query(`DELETE FROM tasks WHERE id=$1`, [taskId]);

    console.log('  ✓ obligation tracking (handled state, task link), ICS export, and unlink-on-delete all work');
  } finally {
    await cleanupUsers([userId]);
  }
}

// Collects failures instead of aborting on the first one — see
// milestone3.test.js's identical helper for the rationale.
async function runAll(label, fn) {
  try {
    await fn();
    return null;
  } catch (err) {
    console.error(`  ✗ FAILED: ${label} — ${err.message}`);
    return { label, message: err.message };
  }
}

async function run() {
  await waitForSchema();
  await cleanupLeftoversFromPriorRuns();

  const failures = [];
  for (const key of Object.keys(expected)) failures.push(await runAll(`obligations:${key}`, () => testObligationsForFixture(key)));
  failures.push(await runAll('executionAndPromotion', testExecutionAndPromotion));
  failures.push(await runAll('obligationTrackingAndIcs', testObligationTrackingAndIcs));

  const real = failures.filter(Boolean);
  if (real.length) {
    console.error(`\n${real.length} Contract Review Stage 4 check(s) FAILED:`);
    for (const f of real) console.error(`  - ${f.label}: ${f.message}`);
    await pool.end();
    process.exitCode = 1;
    return;
  }

  console.log('\nAll Contract Review Stage 4 smoke tests passed.');
  await pool.end();
}

run().catch(async (err) => {
  console.error(err);
  try { await pool.end(); } catch (_) {}
  process.exit(1);
});
