'use strict';

/**
 * Milestone 2 smoke tests — Contract Review Stage 2: extraction (pipeline
 * stage 1, incl. OCR fallback) and segmentation (pipeline stage 2), gated
 * against the 6-fixture smoke set. No contract-type detection, parties,
 * definitions, classification, risk scoring, or obligations extraction —
 * those are Stage 3/4. OCR-dependent assertions (tests 3, 4, part of 11)
 * skip with a clear log line, not a false pass, when pdftoppm isn't on PATH
 * (this sandbox has none — verified via server/services/contractReview/
 * pdfRasterize.js's isPdftoppmAvailable()); they run for real against the
 * Railway staging deploy, which has poppler-utils via the Dockerfile.
 * Run: node server/services/contractReview/milestone2.test.js
 */

require('dotenv').config();
const assert = require('assert');

// ── Disposable-database safety gate (identical to milestone1.test.js) ──────
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

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const { pool, initSchema } = require('../../db');
const ContractService = require('./contractService');
const { locateLlmBoundaries, llmBoundarySegment, heuristicSegment } = require('./segmentation');
const { isPdftoppmAvailable } = require('./pdfRasterize');
const { buildAllFixtures } = require('./smokeSet/buildFixtures');
const expected = require('./smokeSet/expected');

const SUBPROCESS_SCRIPT = path.join(__dirname, 'smokeSet', 'ingestSegmentSubprocess.js');

// pdf-parse's bundled pdfjs (v1.10.100) has a confirmed non-deterministic
// state-corruption bug — even a single, fresh-process extraction of a
// perfectly valid PDF occasionally fails with this signature (direct repro:
// 1 failure in 5 identical sequential calls; also seen on a single isolated
// call). Logged as a Suggestions-inbox item against translateExtract.js
// (shared production code, out of bounds to fix here). Subprocess isolation
// (below) bounds exposure to at most one extractFromPdf call per attempt;
// this bounded retry absorbs the residual per-call flake rate rather than
// failing the whole gate on a known upstream race.
const KNOWN_PDF_PARSE_FLAKE = /Invalid PDF structure|Unknown compression method/;
const MAX_FLAKE_RETRIES = 4;

/** Runs ingest+segment for one document in its own process — see
 * ingestSegmentSubprocess.js's header for why. Returns
 * { ok: true, ...result } or { ok: false, error }. */
async function ingestAndSegmentInSubprocess(documentId) {
  let lastResult;
  for (let attempt = 0; attempt <= MAX_FLAKE_RETRIES; attempt++) {
    lastResult = await runSubprocessOnce(documentId);
    if (lastResult.ok || !KNOWN_PDF_PARSE_FLAKE.test(lastResult.error || '')) return lastResult;
    console.log(`  ⚠ known pdf-parse flake hit for document ${documentId} (attempt ${attempt + 1}/${MAX_FLAKE_RETRIES + 1}) — retrying`);
    await new Promise((r) => setTimeout(r, 750));
  }
  return lastResult;
}

async function runSubprocessOnce(documentId) {
  // The subprocess writes its result to a dedicated file, not stdout —
  // db.js's pino logger also writes to stdout, and line-splitting to find
  // "our" JSON among its output proved fragile (confirmed while debugging:
  // a pino line without its own trailing newline merged with our payload on
  // one "line", breaking JSON.parse). A file sidesteps that entirely.
  const outputFilePath = path.join(os.tmpdir(), `contract-review-m2-${crypto.randomUUID()}.json`);
  try {
    await execFileAsync(
      process.execPath, [SUBPROCESS_SCRIPT, String(documentId), outputFilePath],
      { env: process.env, timeout: 120_000, maxBuffer: 20 * 1024 * 1024 }
    );
    const result = JSON.parse(fs.readFileSync(outputFilePath, 'utf8'));
    return { ok: true, ...result };
  } catch (err) {
    let parsedError = err.message;
    try { parsedError = JSON.parse(fs.readFileSync(outputFilePath, 'utf8')).error || parsedError; } catch (_) { /* keep raw message */ }
    return { ok: false, error: parsedError };
  } finally {
    try { fs.unlinkSync(outputFilePath); } catch (_) { /* may not exist if the subprocess crashed before writing */ }
  }
}

async function waitForSchema() {
  // db.js fires its own initSchema() as an unawaited promise at module load.
  // Polling a row count (Stage 1's original approach) only proves the
  // database ALREADY has that data from some prior run — it does not prove
  // THIS process's own background chain has finished, so an early test
  // failure's run().catch() could still call pool.end() while that chain is
  // mid-flight, throwing "Cannot use a pool after calling end on the pool"
  // from inside it (confirmed via direct repro while debugging Stage 2).
  // Awaiting initSchema() explicitly (idempotent) is a real signal, not an
  // inference.
  await initSchema();
}

async function makeUser(tag) {
  const email = `contract-review-test-m2-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.invalid`;
  const { rows } = await pool.query(`INSERT INTO users (email, "passwordHash") VALUES ($1, 'x') RETURNING id`, [email]);
  return rows[0].id;
}

async function cleanupUsers(userIds) {
  const ids = userIds.filter(Boolean);
  if (ids.length) await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [ids]);
}

async function cleanupLeftoversFromPriorRuns() {
  const { rows } = await pool.query(
    `DELETE FROM users WHERE email LIKE 'contract-review-test-m2-%@example.invalid' RETURNING id`
  );
  console.log(`[contract-review-tests] pre-run cleanup: removed ${rows.length} leftover fixture user(s)`);
}

let fixtures = null;
async function getFixtures() {
  if (!fixtures) fixtures = await buildAllFixtures();
  return fixtures;
}

/** Uploads one fixture as a document on a fresh contract, owned by userId. */
async function uploadFixture(userId, fixtureKey) {
  const fx = (await getFixtures())[fixtureKey];
  const contract = await ContractService.createContract(userId, { title: `Smoke set: ${fixtureKey}` });
  const doc = await ContractService.addDocument(userId, contract.id, {
    file: { buffer: fx.buffer, filename: fx.filename, mimeType: fx.mimeType },
  });
  return { contract, doc };
}

/** Runs ingest+segment for a document (in its own subprocess) and returns the
 * same {ingestResult, segResult} shape the rest of this test file expects. */
async function ingestAndSegment(doc) {
  const result = await ingestAndSegmentInSubprocess(doc.id);
  if (!result.ok) {
    const err = new Error(result.error);
    err.subprocessFailed = true;
    throw err;
  }
  const { reviewId, outcome, extractedText, pageMap, segResult } = result;
  return { ingestResult: { reviewId, outcome, extractedText, pageMap }, segResult };
}

async function testExtractionPdfTextLayer() {
  const userId = await makeUser('pdf-text');
  try {
    const { doc } = await uploadFixture(userId, 'deepNesting');
    const { ingestResult } = await ingestAndSegment(doc);
    assert.strictEqual(ingestResult.outcome, 'complete');
    assert.ok(ingestResult.extractedText.includes('Limitation of Liability'), 'expected real text-layer content');
    const { rows: [updatedDoc] } = await pool.query(`SELECT "ocrUsed" FROM contract_documents WHERE id=$1`, [doc.id]);
    assert.strictEqual(updatedDoc.ocrUsed, false, 'a normal text-layer PDF must not report ocrUsed');
    console.log('  ✓ PDF text-layer extraction works and does not trigger OCR');
  } finally {
    await cleanupUsers([userId]);
  }
}

async function testExtractionDocx() {
  const userId = await makeUser('docx');
  try {
    const { doc } = await uploadFixture(userId, 'unnumbered');
    const { ingestResult } = await ingestAndSegment(doc);
    assert.strictEqual(ingestResult.outcome, 'complete');
    assert.ok(ingestResult.extractedText.includes('MUTUAL NON-DISCLOSURE AGREEMENT'), 'expected DOCX content extracted');
    console.log('  ✓ DOCX extraction works');
  } finally {
    await cleanupUsers([userId]);
  }
}

async function testExtractionScannedPdf() {
  if (!(await isPdftoppmAvailable())) {
    console.log('  ⚠ SKIPPED (pdftoppm not on PATH in this environment) — scanned contract extraction. Run against the Railway staging deploy to verify.');
    return;
  }
  const userId = await makeUser('scanned');
  try {
    const { doc } = await uploadFixture(userId, 'scanned');
    const { ingestResult } = await ingestAndSegment(doc);
    assert.strictEqual(ingestResult.outcome, 'complete');
    const { rows: [updatedDoc] } = await pool.query(`SELECT "ocrUsed", "ocrConfidence" FROM contract_documents WHERE id=$1`, [doc.id]);
    assert.strictEqual(updatedDoc.ocrUsed, true, 'a genuine image-only PDF must report ocrUsed=true');
    // NUMERIC(5,2) columns come back from pg as strings, not numbers.
    assert.ok(!Number.isNaN(Number(updatedDoc.ocrConfidence)) && Number(updatedDoc.ocrConfidence) > 0, 'expected a real OCR confidence value');
    assert.ok(/Coastal|Lessee|forklift/i.test(ingestResult.extractedText), 'OCR output should roughly match the source content');
    console.log('  ✓ scanned-PDF OCR extraction works end-to-end');
  } finally {
    await cleanupUsers([userId]);
  }
}

async function testExtractionMixedDocument() {
  if (!(await isPdftoppmAvailable())) {
    console.log('  ⚠ SKIPPED (pdftoppm not on PATH in this environment) — mixed-document OCR/page-order. Run against the Railway staging deploy to verify.');
    return;
  }
  const userId = await makeUser('mixed');
  try {
    const { doc } = await uploadFixture(userId, 'mixed');
    const { ingestResult } = await ingestAndSegment(doc);
    assert.strictEqual(ingestResult.outcome, 'complete');
    const typedIdx = ingestResult.extractedText.indexOf('SERVICE ORDER FORM');
    const scannedIdx = ingestResult.extractedText.indexOf('EXHIBIT A');
    assert.ok(typedIdx !== -1, 'typed page content must be present');
    assert.ok(scannedIdx !== -1, 'OCR page content must be present');
    assert.ok(typedIdx < scannedIdx, 'typed page must precede the scanned page — page order must be preserved');
    // A span computed against a later typed sentence must still be correct
    // relative to the whole joined document, not just the typed portion.
    const laterTypedSnippet = "within 30 days of the Vendor's invoice";
    const laterIdx = ingestResult.extractedText.indexOf(laterTypedSnippet);
    assert.ok(laterIdx > -1 && laterIdx < scannedIdx, 'later typed content must still be located before the scanned page in a correct page-ordered join');
    console.log('  ✓ mixed document keeps true page order and later typed spans stay correct');
  } finally {
    await cleanupUsers([userId]);
  }
}

async function testExtractionNotSupported() {
  const userId = await makeUser('notsupported');
  try {
    const contract = await ContractService.createContract(userId, { title: 'Not supported test' });
    const doc = await ContractService.addDocument(userId, contract.id, {
      file: { buffer: Buffer.from('irrelevant'), filename: 'x.txt', mimeType: 'text/plain' },
    });
    const result = await ingestAndSegmentInSubprocess(doc.id);
    assert.ok(result.ok, `ingest should not error for an unsupported-but-parseable file: ${result.error}`);
    assert.strictEqual(result.outcome, 'not_supported');
    const { rows: [review] } = await pool.query(`SELECT status FROM contract_reviews WHERE id=$1`, [result.reviewId]);
    assert.strictEqual(review.status, 'not_supported');
    console.log('  ✓ unsupported file type returns not_supported, not a thrown error');
  } finally {
    await cleanupUsers([userId]);
  }
}

async function testExtractionCorruptFile() {
  const userId = await makeUser('corrupt');
  try {
    const contract = await ContractService.createContract(userId, { title: 'Corrupt file test' });
    const doc = await ContractService.addDocument(userId, contract.id, {
      file: { buffer: Buffer.from('this is not a real pdf'), filename: 'corrupt.pdf', mimeType: 'application/pdf' },
    });
    const result = await ingestAndSegmentInSubprocess(doc.id);
    assert.strictEqual(result.ok, false, 'a corrupt file must cause ingest to fail');
    const { rows } = await pool.query(`SELECT id, status FROM contract_reviews WHERE "documentId"=$1`, [doc.id]);
    const review = rows[0];
    assert.ok(review, 'a review row should still exist to record the failure');
    assert.strictEqual(review.status, 'failed');
    console.log('  ✓ corrupt file throws and is recorded as a failed review');
  } finally {
    await cleanupUsers([userId]);
  }
}

async function testSegmentationNumberedHeuristic() {
  const userId = await makeUser('numbered');
  try {
    const { doc } = await uploadFixture(userId, 'deepNesting');
    const { ingestResult, segResult } = await ingestAndSegment(doc);
    assert.strictEqual(segResult.method, 'numbered');
    const exp = expected.deepNesting;
    assert.ok(segResult.clauseCount >= exp.minClauseCount && segResult.clauseCount <= exp.maxClauseCount,
      `clause count ${segResult.clauseCount} outside expected range [${exp.minClauseCount}, ${exp.maxClauseCount}]`);
    const { rows: clauses } = await pool.query(
      `SELECT "numberLabel" FROM contract_clauses WHERE "reviewId"=$1 ORDER BY ordinal`,
      [ingestResult.reviewId]
    );
    assert.deepStrictEqual(clauses.map((c) => c.numberLabel), exp.expectedNumberLabels,
      'clause number labels must be exactly the top-level headings, in order — sub-items like (a)/(i) must stay embedded, not become their own clauses');
    console.log('  ✓ deep-nesting fixture segments via the numbered heuristic with exactly the expected top-level clause labels');
  } finally {
    await cleanupUsers([userId]);
  }
}

async function testSegmentationUnnumberedFallback() {
  const userId = await makeUser('unnumb-seg');
  try {
    const { doc } = await uploadFixture(userId, 'unnumbered');
    const { segResult } = await ingestAndSegment(doc);
    assert.notStrictEqual(segResult.method, 'numbered', 'an unnumbered document must not mis-fire the numbered heuristic');
    console.log('  ✓ unnumbered fixture correctly falls through to a non-numbered segmentation method');
  } finally {
    await cleanupUsers([userId]);
  }
}

async function testClauseTextAlwaysExactSlice() {
  const userId = await makeUser('exactslice');
  try {
    for (const key of Object.keys(expected)) {
      const { doc } = await uploadFixture(userId, key);
      const { ingestResult, segResult } = await ingestAndSegment(doc);
      if (ingestResult.outcome !== 'complete') continue; // OCR skipped locally — nothing to check here
      const { rows: clauses } = await pool.query(
        `SELECT text, "spanStart", "spanEnd" FROM contract_clauses WHERE "reviewId"=$1`,
        [ingestResult.reviewId]
      );
      for (const c of clauses) {
        assert.strictEqual(
          ingestResult.extractedText.slice(c.spanStart, c.spanEnd), c.text,
          `clause text must be an exact slice of extractedText (fixture: ${key})`
        );
      }
    }
    console.log('  ✓ clause text is an exact slice of extractedText across every fixture');
  } finally {
    await cleanupUsers([userId]);
  }
}

async function testLlmFallbackBoundaryLocation() {
  const text = 'Opening statement here. First clause opens now and continues with real content. It ends right before the second clause. Second clause opens now and has its own content. It ends here too.';
  const boundaries = [
    { opening: 'First clause opens now', closing: 'the second clause' },
    { opening: 'This text does not exist anywhere', closing: 'in the source at all' }, // deliberately unlocatable
    { opening: 'Second clause opens now', closing: 'has its own content' },
  ];
  const located = locateLlmBoundaries(text, boundaries);
  assert.ok(located[0], 'the first, valid boundary pair must be located');
  assert.strictEqual(located[1], null, 'the deliberately unlocatable boundary pair must not be located');
  assert.ok(located[2], 'the third, valid boundary pair must be located');

  const clauses = llmBoundarySegment(text, boundaries);
  for (const c of clauses) {
    assert.strictEqual(text.slice(c.spanStart, c.spanEnd), c.text, 'every produced clause, including fallback regions, must be an exact slice');
  }
  // The unlocatable region must not have silently vanished or been replaced
  // by the model's literal (unverifiable) boundary text.
  const joined = clauses.map((c) => c.text).join('');
  assert.ok(!joined.includes('This text does not exist anywhere'), 'unlocated model text must never be accepted as clause content');
  console.log('  ✓ LLM boundary fallback locates valid boundaries and falls back to paragraph segmentation for unlocatable ones, never accepting unlocated model text');
}

function testSequenceCheckRejectsCrossReference() {
  const text = `1.1 Introduction.

This is the intro clause.

2.1 Payment.

Customer pays on time.

Section 9 shall survive termination of this Agreement.

3.1 Miscellaneous.

Final clause.`;
  const clauses = heuristicSegment(text);
  const labels = clauses.map((c) => c.numberLabel);
  assert.deepStrictEqual(labels, ['1.1', '2.1', '3.1'],
    `a cross-reference that merely LOOKS like a heading ("Section 9...") must not start its own clause — got labels ${JSON.stringify(labels)}`);
  const paymentClause = clauses.find((c) => c.numberLabel === '2.1');
  assert.ok(paymentClause.text.includes('Section 9 shall survive termination'),
    'the cross-reference sentence must stay embedded in the preceding clause\'s body');
  console.log('  ✓ sequence check rejects a cross-reference that looks like a heading but does not continue the numbering');
}

function testSequenceCheckRejectsEmbeddedNumberedList() {
  const text = `1.1 Eligibility.

The following criteria apply:

1. Must be over 18.
2. Must reside in Australia.
3. Must hold a valid license.

2.1 Payment.

Customer pays on time.`;
  const clauses = heuristicSegment(text);
  const labels = clauses.map((c) => c.numberLabel);
  assert.deepStrictEqual(labels, ['1.1', '2.1'],
    `a numbered list embedded inside a clause's body must not split into its own clauses — got labels ${JSON.stringify(labels)}`);
  const eligibilityClause = clauses.find((c) => c.numberLabel === '1.1');
  assert.ok(eligibilityClause.text.includes('Must be over 18'),
    'the embedded numbered-list item must stay inside the enclosing clause\'s body');
  console.log('  ✓ sequence check rejects a numbered list embedded inside a clause, not continuing the section numbering');
}

async function testObligationSentencesStayWithinOneClause() {
  const userId = await makeUser('obligations');
  const pdftoppmAvailable = await isPdftoppmAvailable();
  try {
    for (const [key, exp] of Object.entries(expected)) {
      if ((key === 'scanned' || key === 'mixed') && !pdftoppmAvailable) {
        console.log(`  ⚠ SKIPPED (pdftoppm unavailable) — obligation-boundary check for fixture "${key}"`);
        continue;
      }
      const { doc } = await uploadFixture(userId, key);
      const { ingestResult } = await ingestAndSegment(doc);
      if (ingestResult.outcome !== 'complete') continue;
      const { rows: clauses } = await pool.query(
        `SELECT "spanStart", "spanEnd" FROM contract_clauses WHERE "reviewId"=$1`,
        [ingestResult.reviewId]
      );
      for (const obligation of exp.expectedObligations) {
        const idx = ingestResult.extractedText.indexOf(obligation.sourceQuote);
        assert.ok(idx !== -1, `expected obligation sourceQuote not found in extracted text (fixture: ${key}): "${obligation.sourceQuote}"`);
        const quoteEnd = idx + obligation.sourceQuote.length;
        const containingClauses = clauses.filter((c) => idx >= c.spanStart && quoteEnd <= c.spanEnd);
        assert.strictEqual(containingClauses.length, 1,
          `obligation sourceQuote must land inside exactly one clause, not split across a boundary (fixture: ${key}): "${obligation.sourceQuote}"`);
      }
    }
    console.log('  ✓ every expected obligation sentence lands inside a single segmented clause, never split across a boundary');
  } finally {
    await cleanupUsers([userId]);
  }
}

async function run() {
  await waitForSchema();
  await cleanupLeftoversFromPriorRuns();
  await testExtractionPdfTextLayer();
  await testExtractionDocx();
  await testExtractionScannedPdf();
  await testExtractionMixedDocument();
  await testExtractionNotSupported();
  await testExtractionCorruptFile();
  await testSegmentationNumberedHeuristic();
  await testSegmentationUnnumberedFallback();
  await testClauseTextAlwaysExactSlice();
  await testLlmFallbackBoundaryLocation();
  testSequenceCheckRejectsCrossReference();
  testSequenceCheckRejectsEmbeddedNumberedList();
  await testObligationSentencesStayWithinOneClause();
  console.log('\nAll Contract Review Stage 2 smoke tests passed.');
  await pool.end();
}

run().catch(async (err) => {
  console.error(err);
  try { await pool.end(); } catch (_) {}
  process.exit(1);
});
