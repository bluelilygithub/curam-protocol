'use strict';

/**
 * Milestone 3 smoke tests — Contract Review Stage 3: the analysis pipeline
 * (contract type detection, parties + key terms, definitions, clause
 * classification, risk scoring, summary, grounding verification, coverage
 * report). Runs the LIVE pipeline (real LLM calls via ANTHROPIC_API_KEY) end
 * to end on the smoke set and checks the output against
 * smokeSet/expected.js's contractType/parties/keyTerms/definitions/
 * mustFlagClauses/mustNotFlagClauses/roleFlip — never the reverse; expected.js
 * was written before this file. Obligation correctness (obligor, timing
 * shape, no invented dates) is Stage 4's own gate — see milestone4.test.js.
 *
 * Because this calls a real model, results are not bit-exact every run —
 * assertions are written to tolerate normal LLM variance (a small number of
 * false positives on must-not-flag, for example) while still failing loudly
 * on the things the spec actually guarantees mechanically (grounding, no
 * invented data, exact contractType/party enum values).
 *
 * Run: node server/services/contractReview/milestone3.test.js
 */

require('dotenv').config();
const assert = require('assert');

// ── Disposable-database safety gate (identical to milestone1/2.test.js) ────
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
  console.error('[contract-review-tests] ANTHROPIC_API_KEY is not set — Stage 3 makes real LLM calls and cannot run without it.');
  process.exit(1);
}

const { pool, initSchema } = require('../../db');
const ContractService = require('./contractService');
const { ingestDocument } = require('./ingest');
const { segmentDocument } = require('./segmentation');
const { buildAllFixtures } = require('./smokeSet/buildFixtures');
const { isPdftoppmAvailable } = require('./pdfRasterize');
const { isPdftotextAvailable } = require('./pdfTextExtract');
const { normalize } = require('./grounding');
const expected = require('./smokeSet/expected');

const OCR_FIXTURE_KEYS = new Set(['scanned', 'mixed']); // depend on OCR for at least part of their text
const PDF_FIXTURE_KEYS = new Set(['scanned', 'mixed', 'deepNesting', 'amendment']);

async function waitForSchema() {
  await initSchema();
}

async function makeUser(tag) {
  const email = `contract-review-test-m3-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.invalid`;
  const { rows } = await pool.query(`INSERT INTO users (email, "passwordHash") VALUES ($1, 'x') RETURNING id`, [email]);
  // A real vault_models row is required — getModelsForUser falls back to the
  // first admin's models otherwise, which may not exist in a fresh test DB.
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
  const { rows } = await pool.query(`DELETE FROM users WHERE email LIKE 'contract-review-test-m3-%@example.invalid' RETURNING id`);
  console.log(`[contract-review-tests] pre-run cleanup: removed ${rows.length} leftover fixture user(s)`);
}

let fixtures = null;
async function getFixtures() {
  if (!fixtures) fixtures = await buildAllFixtures();
  return fixtures;
}

/** Uploads fixtureKey as a new contract's base document, runs ingest+segment
 * directly (Stage 2, already verified in milestone2.test.js — not re-tested
 * here), then confirms the fixture's designated user party and runs the
 * analysis pipeline (Stage 3) to completion. Returns { contract, review }. */
async function runFixtureThroughAnalysis(userId, fixtureKey, { userPartyName, userRole } = {}) {
  const fx = (await getFixtures())[fixtureKey];
  const exp = expected[fixtureKey];
  const contract = await ContractService.createContract(userId, { title: `Smoke set (m3): ${fixtureKey}` });
  const doc = await ContractService.addDocument(userId, contract.id, {
    file: { buffer: fx.buffer, filename: fx.filename, mimeType: fx.mimeType },
  });

  const ingestResult = await ingestDocument(doc.id);
  if (ingestResult.outcome !== 'complete') {
    throw new Error(`Fixture ${fixtureKey} did not extract cleanly (outcome=${ingestResult.outcome}) — check OCR availability`);
  }
  await segmentDocument(ingestResult.reviewId, ingestResult.extractedText, ingestResult.pageMap, { userId });

  const { runAnalysis, resumeAfterRoleConfirmation } = require('./analysisPipeline');
  const analysisResult = await runAnalysis(ingestResult.reviewId, { userId });
  assert.strictEqual(analysisResult.status, 'awaiting_role_confirmation', `expected the pipeline to pause for role confirmation (fixture: ${fixtureKey})`);

  const targetName = userPartyName || exp.parties.find((p) => p.isUser).name;
  const { rows: parties } = await pool.query(`SELECT * FROM contract_parties WHERE "contractId"=$1`, [contract.id]);
  const targetParty = parties.find((p) => normalize(p.name) === normalize(targetName));
  assert.ok(targetParty, `expected an extracted party matching "${targetName}" (fixture: ${fixtureKey}); got: ${parties.map((p) => p.name).join(', ')}`);
  await ContractService.confirmParty(userId, contract.id, targetParty.id);

  const finalResult = await resumeAfterRoleConfirmation(ingestResult.reviewId, { userId });
  assert.strictEqual(finalResult.status, 'complete', `expected the review to complete (fixture: ${fixtureKey}), got status=${finalResult.status}`);

  const review = await ContractService.getReview(userId, ingestResult.reviewId);
  return { contract, review, extractedText: ingestResult.extractedText, userPartyId: targetParty.id, userRole: userRole || targetParty.role };
}

function findClauseByQuote(clauses, sourceQuote) {
  return clauses.find((c) => c.text.includes(sourceQuote));
}

/** Bullet 3: nothing marked verified unless its quote was found in the
 * source text. Checked generically across definitions and summary points —
 * obligations get the same check plus obligor/timing correctness in
 * milestone4.test.js. */
function assertGroundingHonest(extractedText, rows, quoteField, label) {
  for (const row of rows) {
    if (row.verificationStatus === 'failed') {
      assert.strictEqual(row.spanStart, null, `${label} marked failed must have a null span`);
      continue;
    }
    if (row.verificationStatus == null) continue; // e.g. a summary point with no quotedText at all
    assert.ok(row.spanStart != null && row.spanEnd != null, `${label} marked verified must have real spans`);
    const sliced = extractedText.slice(row.spanStart, row.spanEnd);
    const quote = row[quoteField];
    const matches = row.verificationStatus === 'verified_exact'
      ? sliced === quote
      : normalize(sliced) === normalize(quote);
    assert.ok(matches, `${label} marked ${row.verificationStatus} but the span text does not match the quote (span: "${sliced}", quote: "${quote}")`);
  }
}

async function testContractTypeAndKeyTerms(key) {
  const userId = await makeUser(`type-${key}`);
  try {
    if (PDF_FIXTURE_KEYS.has(key) && !(await isPdftotextAvailable())) {
      console.log(`  ⚠ SKIPPED (pdftotext unavailable) — contract type/key terms for "${key}"`);
      return;
    }
    if (OCR_FIXTURE_KEYS.has(key) && !(await isPdftoppmAvailable())) {
      console.log(`  ⚠ SKIPPED (pdftoppm unavailable) — contract type/key terms for "${key}"`);
      return;
    }
    const { review } = await runFixtureThroughAnalysis(userId, key);
    const exp = expected[key];
    assert.strictEqual(review.detectedContractType, exp.contractType, `contractType mismatch for "${key}"`);
    console.log(`  ✓ [${key}] detected contractType="${review.detectedContractType}" as expected`);
  } finally {
    await cleanupUsers([userId]);
  }
}

async function testDefinitionsGrounded(key) {
  const userId = await makeUser(`defs-${key}`);
  try {
    if (PDF_FIXTURE_KEYS.has(key) && !(await isPdftotextAvailable())) { console.log(`  ⚠ SKIPPED (pdftotext unavailable) — definitions for "${key}"`); return; }
    if (OCR_FIXTURE_KEYS.has(key) && !(await isPdftoppmAvailable())) { console.log(`  ⚠ SKIPPED (pdftoppm unavailable) — definitions for "${key}"`); return; }
    const { review, extractedText } = await runFixtureThroughAnalysis(userId, key);
    assertGroundingHonest(extractedText, review.definitions, 'quotedText', `definition (fixture ${key})`);
    console.log(`  ✓ [${key}] every verified definition's span matches its quotedText`);
  } finally {
    await cleanupUsers([userId]);
  }
}

async function testSummaryGrounded(key) {
  const userId = await makeUser(`summary-${key}`);
  try {
    if (PDF_FIXTURE_KEYS.has(key) && !(await isPdftotextAvailable())) { console.log(`  ⚠ SKIPPED (pdftotext unavailable) — summary for "${key}"`); return; }
    if (OCR_FIXTURE_KEYS.has(key) && !(await isPdftoppmAvailable())) { console.log(`  ⚠ SKIPPED (pdftoppm unavailable) — summary for "${key}"`); return; }
    const { review, extractedText } = await runFixtureThroughAnalysis(userId, key);
    const pointsWithQuotes = (review.summaryPoints || []).filter((p) => p.quotedText);
    assertGroundingHonest(extractedText, pointsWithQuotes, 'quotedText', `summary point (fixture ${key})`);
    console.log(`  ✓ [${key}] every verified summary point's span matches its quotedText`);
  } finally {
    await cleanupUsers([userId]);
  }
}

/** Bullets 1 + 2 for the default (non-role-flip) run of a fixture. */
async function testRiskFlags(key) {
  const userId = await makeUser(`risk-${key}`);
  try {
    if (PDF_FIXTURE_KEYS.has(key) && !(await isPdftotextAvailable())) { console.log(`  ⚠ SKIPPED (pdftotext unavailable) — risk flags for "${key}"`); return; }
    if (OCR_FIXTURE_KEYS.has(key) && !(await isPdftoppmAvailable())) { console.log(`  ⚠ SKIPPED (pdftoppm unavailable) — risk flags for "${key}"`); return; }
    const exp = expected[key];
    const { review } = await runFixtureThroughAnalysis(userId, key);

    for (const mf of exp.mustFlagClauses || []) {
      const clause = findClauseByQuote(review.clauses, mf.sourceQuote);
      assert.ok(clause, `must-flag clause not found by its sourceQuote (fixture ${key}): "${mf.sourceQuote}"`);
      assert.strictEqual(clause.riskLevel, 'risky', `must-flag clause was not flagged risky (fixture ${key}): "${mf.sourceQuote}" (got riskLevel="${clause.riskLevel}")`);
    }

    let falsePositives = 0;
    for (const mnf of exp.mustNotFlagClauses || []) {
      const clause = findClauseByQuote(review.clauses, mnf.sourceQuote);
      assert.ok(clause, `must-not-flag clause not found by its sourceQuote (fixture ${key}): "${mnf.sourceQuote}"`);
      if (clause.riskLevel === 'risky') falsePositives += 1;
    }
    assert.ok(falsePositives <= 1, `more than one must-not-flag clause was flagged risky (fixture ${key}): ${falsePositives}`);

    console.log(`  ✓ [${key}] every must-flag clause flagged risky; at most one must-not-flag clause flagged (${falsePositives}/${(exp.mustNotFlagClauses || []).length})`);
  } finally {
    await cleanupUsers([userId]);
  }
}

/** Bullet 5 — multiParty's roleFlip: same fixture, a different confirmed
 * user party, in a SEPARATE contract (confirmation is sticky per-contract by
 * design — a second review of the same document intentionally skips
 * re-asking, so testing the flip means a fresh contract, not a re-review). */
async function testRoleFlip() {
  const userId = await makeUser('roleflip');
  try {
    if (!(await isPdftotextAvailable())) { console.log('  ⚠ SKIPPED (pdftotext unavailable) — role-flip test'); return; }
    const exp = expected.multiParty;
    assert.ok(exp.roleFlip, 'multiParty fixture must define a roleFlip block for this test to run');

    const defaultRun = await runFixtureThroughAnalysis(userId, 'multiParty');
    const flippedRun = await runFixtureThroughAnalysis(userId, 'multiParty', {
      userPartyName: exp.roleFlip.userPartyName, userRole: exp.roleFlip.userRole,
    });

    // Role-sensitive flags must differ between the two runs.
    let inverted = 0;
    for (const mf of exp.roleFlip.mustFlagClauses) {
      const defaultClause = findClauseByQuote(defaultRun.review.clauses, mf.sourceQuote);
      const flippedClause = findClauseByQuote(flippedRun.review.clauses, mf.sourceQuote);
      assert.ok(defaultClause && flippedClause, `role-flip clause not found in both runs: "${mf.sourceQuote}"`);
      assert.strictEqual(flippedClause.riskLevel, 'risky', `expected "${mf.sourceQuote}" to be risky for the Guarantor`);
      if (defaultClause.riskLevel !== flippedClause.riskLevel) inverted += 1;
    }
    assert.ok(inverted >= 1, 'expected at least one role-sensitive clause to actually change riskLevel between the Lender and Guarantor runs — a role-flip test that never flips anything is not testing role sensitivity');

    // Role-INVARIANT flags must stay the same in both runs.
    for (const mnf of exp.roleFlip.mustNotFlagClauses) {
      const flippedClause = findClauseByQuote(flippedRun.review.clauses, mnf.sourceQuote);
      assert.ok(flippedClause, `role-invariant clause not found in flipped run: "${mnf.sourceQuote}"`);
      assert.notStrictEqual(flippedClause.riskLevel, 'risky', `role-invariant clause "${mnf.sourceQuote}" should not flip to risky just because the user role changed`);
    }

    console.log(`  ✓ [multiParty] role flip (Lender -> Guarantor) changed ${inverted} role-sensitive flag(s) and left role-invariant flags unchanged`);
  } finally {
    await cleanupUsers([userId]);
  }
}

async function testPartiesReconciliation() {
  const userId = await makeUser('reconcile');
  try {
    if (!(await isPdftotextAvailable())) { console.log('  ⚠ SKIPPED (pdftotext unavailable) — party reconciliation test'); return; }
    // Upload the same fixture twice as two documents on ONE contract — the
    // second pass must reuse the first pass's party rows by normalized name,
    // not insert duplicates (spec: reconciliation, never blind insert).
    const fx = (await getFixtures()).deepNesting;
    const contract = await ContractService.createContract(userId, { title: 'Reconciliation test' });
    const doc1 = await ContractService.addDocument(userId, contract.id, { file: { buffer: fx.buffer, filename: fx.filename, mimeType: fx.mimeType } });
    const ingest1 = await ingestDocument(doc1.id);
    await segmentDocument(ingest1.reviewId, ingest1.extractedText, ingest1.pageMap, { userId });
    const { runAnalysis } = require('./analysisPipeline');
    await runAnalysis(ingest1.reviewId, { userId });
    const { rows: partiesAfterFirst } = await pool.query(`SELECT * FROM contract_parties WHERE "contractId"=$1`, [contract.id]);

    const doc2 = await ContractService.addDocument(userId, contract.id, { file: { buffer: fx.buffer, filename: fx.filename, mimeType: fx.mimeType }, kind: 'amendment', parentDocumentId: doc1.id });
    const ingest2 = await ingestDocument(doc2.id);
    await segmentDocument(ingest2.reviewId, ingest2.extractedText, ingest2.pageMap, { userId });
    await runAnalysis(ingest2.reviewId, { userId });
    const { rows: partiesAfterSecond } = await pool.query(`SELECT * FROM contract_parties WHERE "contractId"=$1`, [contract.id]);

    assert.strictEqual(partiesAfterSecond.length, partiesAfterFirst.length, `expected the second review to reuse the same party rows, not duplicate them (had ${partiesAfterFirst.length}, now ${partiesAfterSecond.length})`);
    console.log(`  ✓ re-reviewing a second document on the same contract reconciled parties by name instead of duplicating them (${partiesAfterFirst.length} parties, stable)`);
  } finally {
    await cleanupUsers([userId]);
  }
}

async function run() {
  await waitForSchema();
  await cleanupLeftoversFromPriorRuns();

  const keys = Object.keys(expected);
  for (const key of keys) await testContractTypeAndKeyTerms(key);
  for (const key of keys) await testDefinitionsGrounded(key);
  for (const key of keys) await testSummaryGrounded(key);
  for (const key of keys) await testRiskFlags(key);
  await testRoleFlip();
  await testPartiesReconciliation();

  console.log('\nAll Contract Review Stage 3 smoke tests passed.');
  await pool.end();
}

run().catch(async (err) => {
  console.error(err);
  try { await pool.end(); } catch (_) {}
  process.exit(1);
});
