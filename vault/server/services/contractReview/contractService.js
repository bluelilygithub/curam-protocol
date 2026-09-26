'use strict';

// Contract Review — ContractService (Stage 1: entity CRUD, cascading delete,
// legal hold). Plain exported async functions, no class — matches
// server/services/modelResolver.js / server/services/SuggestionService.js.
// Single centralized access-check (assertContractAccess), used everywhere,
// per docs/contract-review-spec.md's "single choke point" decision — a
// deliberate deviation from the per-route assertClientOwner/assertDealOwner
// pattern in clients.js/deals.js/cases.js, not an oversight of it.
//
// Out of scope for Stage 1 (see spec's build-stage plan, Stages 3-6):
// startReview/getReview/listReviews, promoteReviewToContract,
// markDocumentExecuted/setContractStatus, recordCorrection,
// listObligations/setObligationState/linkObligationToTask,
// exportIcs/searchClauses. Their tables exist now; their logic doesn't yet.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pool } = require('../../db');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../../../uploads');

class ContractAccessError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ContractAccessError';
    this.statusCode = 404;
  }
}

/** Throws if the contract doesn't exist or isn't owned by userId. Every other
 * function in this service calls this first. */
async function assertContractAccess(userId, contractId) {
  const { rows } = await pool.query(
    `SELECT id, "legalHold" FROM contracts WHERE id=$1 AND "userId"=$2`,
    [contractId, userId]
  );
  if (!rows[0]) throw new ContractAccessError(`Contract ${contractId} not found for this user`);
  return rows[0];
}

/** Same access check, resolved via a document id instead of a contract id
 * (deleteDocument's entry point). Returns both ids. */
async function assertDocumentAccess(userId, documentId) {
  const { rows } = await pool.query(
    `SELECT d.id AS "documentId", d."contractId", c."legalHold"
     FROM contract_documents d
     JOIN contracts c ON c.id = d."contractId"
     WHERE d.id=$1 AND c."userId"=$2`,
    [documentId, userId]
  );
  if (!rows[0]) throw new ContractAccessError(`Document ${documentId} not found for this user`);
  return rows[0];
}

async function writeEvent(client, { contractId, type, actorUserId = null, documentId = null, obligationId = null, payload = {} }) {
  await client.query(
    `INSERT INTO contract_events ("contractId", type, "actorUserId", "documentId", "obligationId", payload)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [contractId, type, actorUserId, documentId, obligationId, JSON.stringify(payload)]
  );
}

// ── Contracts ────────────────────────────────────────────────────────────────

async function createContract(userId, { title, contractType }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO contracts ("userId", title, "contractType")
       VALUES ($1, $2, COALESCE($3, 'other'))
       RETURNING *`,
      [userId, title, contractType || null]
    );
    const contract = rows[0];
    await writeEvent(client, { contractId: contract.id, type: 'contract_created', actorUserId: userId });
    await client.query('COMMIT');
    return contract;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function getContract(userId, contractId) {
  await assertContractAccess(userId, contractId);
  const [{ rows: [contract] }, { rows: parties }, { rows: documents }, { rows: events }] = await Promise.all([
    pool.query(`SELECT * FROM contracts WHERE id=$1`, [contractId]),
    pool.query(`SELECT * FROM contract_parties WHERE "contractId"=$1 ORDER BY "createdAt" ASC`, [contractId]),
    pool.query(`SELECT * FROM contract_documents WHERE "contractId"=$1 ORDER BY "createdAt" ASC`, [contractId]),
    pool.query(`SELECT * FROM contract_events WHERE "contractId"=$1 ORDER BY "occurredAt" DESC LIMIT 50`, [contractId]),
  ]);
  return { ...contract, parties, documents, events };
}

async function listContracts(userId, { status, search } = {}) {
  const clauses = [`"userId"=$1`];
  const params = [userId];
  if (status) { params.push(status); clauses.push(`status=$${params.length}`); }
  if (search) { params.push(`%${search}%`); clauses.push(`title ILIKE $${params.length}`); }
  const { rows } = await pool.query(
    `SELECT * FROM contracts WHERE ${clauses.join(' AND ')} ORDER BY "createdAt" DESC`,
    params
  );
  return rows;
}

async function setLegalHold(userId, contractId, hold) {
  await assertContractAccess(userId, contractId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE contracts SET "legalHold"=$1, "updatedAt"=NOW() WHERE id=$2`, [!!hold, contractId]);
    await writeEvent(client, { contractId, type: hold ? 'hold_set' : 'hold_released', actorUserId: userId });
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Unlinks any Tasks linked (via contract_obligation_tracking) to obligations
 * under this contract, appending a note to each task first, then deletes the
 * contract. Everything else cascades at the DB level (contract_obligation_tracking
 * and contract_corrections both have contractId ON DELETE CASCADE). */
async function deleteContract(userId, contractId) {
  const { legalHold } = await assertContractAccess(userId, contractId);
  if (legalHold) throw new Error('Contract is on legal hold and cannot be deleted');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await unlinkTasksForContract(client, contractId, 'the contract it was linked to was deleted');
    await client.query(`DELETE FROM contracts WHERE id=$1`, [contractId]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function unlinkTasksForContract(client, contractId, note) {
  const { rows: linked } = await client.query(
    `SELECT "linkedTaskId" FROM contract_obligation_tracking WHERE "contractId"=$1 AND "linkedTaskId" IS NOT NULL`,
    [contractId]
  );
  for (const { linkedTaskId } of linked) {
    await client.query(
      `UPDATE tasks SET notes = COALESCE(notes || E'\\n', '') || $1, "updatedAt"=NOW() WHERE id=$2`,
      [`[Contract Review] Unlinked — ${note}.`, linkedTaskId]
    );
  }
  await client.query(
    `UPDATE contract_obligation_tracking SET "linkedTaskId"=NULL WHERE "contractId"=$1 AND "linkedTaskId" IS NOT NULL`,
    [contractId]
  );
}

// ── Parties ──────────────────────────────────────────────────────────────────

async function addParty(userId, contractId, { name, role, isUser = false }) {
  await assertContractAccess(userId, contractId);
  const { rows } = await pool.query(
    `INSERT INTO contract_parties ("contractId", name, role, "isUser")
     VALUES ($1, $2, COALESCE($3, 'other'), $4)
     RETURNING *`,
    [contractId, name, role || null, !!isUser]
  );
  return rows[0];
}

/** Confirming a role IS declaring "this is me" — isUser is mutually
 * exclusive across a contract's parties, so confirming one clears it on any
 * others (a contract has exactly one user party at a time). */
async function confirmParty(userId, contractId, partyId) {
  await assertContractAccess(userId, contractId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE contract_parties SET "isUser"=FALSE WHERE "contractId"=$1`, [contractId]);
    const { rows } = await client.query(
      `UPDATE contract_parties SET "confirmedByUser"=TRUE, "isUser"=TRUE
       WHERE id=$1 AND "contractId"=$2 RETURNING *`,
      [partyId, contractId]
    );
    if (!rows[0]) throw new Error(`Party ${partyId} not found on contract ${contractId}`);
    await writeEvent(client, { contractId, type: 'role_confirmed', actorUserId: userId, payload: { partyId } });
    await client.query('COMMIT');
    return rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ── Documents ────────────────────────────────────────────────────────────────

/** file: { buffer, filename, mimeType }. No text extraction in Stage 1 —
 * extractedText stays null; that's Stage 2. */
async function addDocument(userId, contractId, { file, kind = 'base', parentDocumentId = null }) {
  await assertContractAccess(userId, contractId);
  const contentHash = crypto.createHash('sha256').update(file.buffer).digest('hex');

  const dir = path.join(UPLOAD_DIR, 'contracts', String(contractId));
  fs.mkdirSync(dir, { recursive: true });
  const safeName = file.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storedPath = path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}`);
  fs.writeFileSync(storedPath, file.buffer);

  let version = 1;
  if (parentDocumentId) {
    const { rows } = await pool.query(`SELECT version FROM contract_documents WHERE id=$1`, [parentDocumentId]);
    if (rows[0]) version = rows[0].version + 1;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO contract_documents
         ("contractId", kind, "parentDocumentId", version, filename, "mimeType", "storedPath", "contentHash")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [contractId, kind, parentDocumentId, version, file.filename, file.mimeType, storedPath, contentHash]
    );
    const doc = rows[0];
    await writeEvent(client, { contractId, type: 'uploaded', actorUserId: userId, documentId: doc.id });
    await client.query('COMMIT');
    return doc;
  } catch (e) {
    await client.query('ROLLBACK');
    fs.unlinkSync(storedPath);
    throw e;
  } finally {
    client.release();
  }
}

/** Deletes one document and everything scoped to it (reviews -> clauses/
 * definitions/obligations/raw outputs, all DB-cascaded), re-points any child
 * draft's parentDocumentId to this document's own parent, then cleans up
 * contract_obligation_tracking and contract_corrections rows whose lineage
 * no longer exists anywhere on the contract (neither cascades on a document
 * delete — both are contractId-scoped, and the contract still exists). */
async function deleteDocument(userId, documentId) {
  const { contractId, legalHold } = await assertDocumentAccess(userId, documentId);
  if (legalHold) throw new Error('Contract is on legal hold and this document cannot be deleted');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [doc] } = await client.query(
      `SELECT "parentDocumentId" FROM contract_documents WHERE id=$1`, [documentId]
    );
    // Middle-draft re-pointing: any document whose parent is the one being
    // deleted now points at that document's own parent instead.
    await client.query(
      `UPDATE contract_documents SET "parentDocumentId"=$1 WHERE "parentDocumentId"=$2`,
      [doc.parentDocumentId, documentId]
    );

    // Storage cleanup — best-effort, the DB row is the source of truth.
    const { rows: [{ storedPath, filename, contentHash, version }] } = await client.query(
      `SELECT "storedPath", filename, "contentHash", version FROM contract_documents WHERE id=$1`, [documentId]
    );

    await writeEvent(client, {
      contractId, type: 'document_deleted', actorUserId: userId,
      payload: { documentId, filename, contentHash, version },
    });

    await client.query(`DELETE FROM contract_documents WHERE id=$1`, [documentId]);

    // Orphan cleanup — lineages that only ever existed on the now-deleted
    // document's reviews. A lineage "survives" if any remaining obligation
    // on the contract (across its other documents/reviews) still has it.
    const { rows: orphanedTracking } = await client.query(
      `SELECT t.id, t."lineageId", t."linkedTaskId"
       FROM contract_obligation_tracking t
       WHERE t."contractId"=$1
         AND NOT EXISTS (
           SELECT 1 FROM contract_obligations o
           WHERE o."contractId"=$1 AND o."lineageId"=t."lineageId"
         )`,
      [contractId]
    );
    for (const row of orphanedTracking) {
      if (row.linkedTaskId) {
        await client.query(
          `UPDATE tasks SET notes = COALESCE(notes || E'\\n', '') || $1, "updatedAt"=NOW() WHERE id=$2`,
          [`[Contract Review] Unlinked — the linked obligation no longer exists (its document was deleted).`, row.linkedTaskId]
        );
      }
      await client.query(`DELETE FROM contract_obligation_tracking WHERE id=$1`, [row.id]);
    }

    await client.query(
      `DELETE FROM contract_corrections c
       WHERE c."contractId"=$1
         AND c."lineageId" IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM contract_clauses cl JOIN contract_reviews r ON r.id = cl."reviewId"
           JOIN contract_documents d ON d.id = r."documentId"
           WHERE d."contractId"=$1 AND cl."lineageId"=c."lineageId"
         )
         AND NOT EXISTS (
           SELECT 1 FROM contract_obligations o WHERE o."contractId"=$1 AND o."lineageId"=c."lineageId"
         )`,
      [contractId]
    );

    await client.query('COMMIT');

    try { if (storedPath && fs.existsSync(storedPath)) fs.unlinkSync(storedPath); } catch (_) { /* best-effort */ }
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ── Reviews (Stage 3/4) ──────────────────────────────────────────────────────

/** Runs the whole pipeline (ingest -> segment -> analysis) for a document,
 * end to end, within this call — no separate job queue exists in this
 * codebase (matches every other Vault agent's pattern: a single blocking
 * call that runs multiple LLM stages, e.g. sharesNewsService/Document
 * Redaction's own "propose" endpoint). Returns once the review reaches a
 * stable state: 'complete' | 'failed' | 'not_supported' | 'awaiting_role_confirmation'. */
async function startReview(userId, documentId) {
  const { contractId } = await assertDocumentAccess(userId, documentId);
  const { ingestDocument } = require('./ingest');
  const { segmentDocument } = require('./segmentation');
  const { runAnalysis } = require('./analysisPipeline');

  const ingestResult = await ingestDocument(documentId);
  if (ingestResult.outcome !== 'complete') {
    return { reviewId: ingestResult.reviewId, status: ingestResult.outcome };
  }
  await segmentDocument(ingestResult.reviewId, ingestResult.extractedText, ingestResult.pageMap, { userId });
  const analysisResult = await runAnalysis(ingestResult.reviewId, { userId });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await writeEvent(client, { contractId, type: 'reviewed', actorUserId: userId, documentId, payload: { reviewId: ingestResult.reviewId, status: analysisResult.status } });
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }

  return { reviewId: ingestResult.reviewId, status: analysisResult.status };
}

/** Resumes a review paused at awaiting_role_confirmation — called after
 * ContractService.confirmParty (or the pipeline's own reconciliation, which
 * already skips the pause when a party is pre-confirmed). */
async function resumeReview(userId, reviewId) {
  const { rows: [row] } = await pool.query(
    `SELECT r.id, d."contractId" FROM contract_reviews r JOIN contract_documents d ON d.id = r."documentId" WHERE r.id=$1`,
    [reviewId]
  );
  if (!row) throw new ContractAccessError(`Review ${reviewId} not found`);
  await assertContractAccess(userId, row.contractId);
  const { resumeAfterRoleConfirmation } = require('./analysisPipeline');
  return resumeAfterRoleConfirmation(reviewId, { userId });
}

async function getReview(userId, reviewId) {
  const { rows: [row] } = await pool.query(
    `SELECT r.*, d."contractId" FROM contract_reviews r JOIN contract_documents d ON d.id = r."documentId" WHERE r.id=$1`,
    [reviewId]
  );
  if (!row) throw new ContractAccessError(`Review ${reviewId} not found`);
  await assertContractAccess(userId, row.contractId);
  const [{ rows: clauses }, { rows: definitions }, { rows: obligations }] = await Promise.all([
    pool.query(`SELECT * FROM contract_clauses WHERE "reviewId"=$1 ORDER BY ordinal`, [reviewId]),
    pool.query(`SELECT * FROM contract_definitions WHERE "reviewId"=$1`, [reviewId]),
    pool.query(`SELECT * FROM contract_obligations WHERE "reviewId"=$1`, [reviewId]),
  ]);
  return { ...row, clauses, definitions, obligations };
}

async function listReviews(userId, documentId) {
  await assertDocumentAccess(userId, documentId);
  const { rows } = await pool.query(`SELECT * FROM contract_reviews WHERE "documentId"=$1 ORDER BY "createdAt" DESC`, [documentId]);
  return rows;
}

// ── Promotion + execution lifecycle ─────────────────────────────────────────

const PROMOTABLE_FIELDS = ['effectiveDate', 'termLengthMonths', 'governingLawCountry', 'governingLawRegion', 'contractValue', 'contractValueCurrency'];

/** Copies detectedContractType/extractedKeyTerms from a document's current
 * review onto contracts — the ONLY path that writes contracts.contractType/
 * key terms (spec: pipeline never writes these directly). Base documents
 * promote fully; amendments promote only their non-null fields, never
 * overwriting a real base-contract value with an amendment's mostly-empty
 * key terms. Contract-level corrections win over whatever the review
 * detected. */
async function promoteReviewToContract(userId, reviewId) {
  const { rows: [row] } = await pool.query(
    `SELECT r.*, d.kind, d."contractId" FROM contract_reviews r JOIN contract_documents d ON d.id = r."documentId" WHERE r.id=$1`,
    [reviewId]
  );
  if (!row) throw new ContractAccessError(`Review ${reviewId} not found`);
  await assertContractAccess(userId, row.contractId);

  const { rows: corrections } = await pool.query(
    `SELECT field, "userValue" FROM contract_corrections
     WHERE "contractId"=$1 AND "clauseId" IS NULL AND "obligationId" IS NULL AND "partyId" IS NULL AND "definitionId" IS NULL`,
    [row.contractId]
  );
  const correctionByField = new Map(corrections.map((c) => [c.field, c.userValue]));
  const isBase = row.kind === 'base';
  const keyTerms = row.extractedKeyTerms || {};

  const updates = {};
  const typeValue = correctionByField.has('contractType') ? correctionByField.get('contractType') : row.detectedContractType;
  if (typeValue && (isBase || correctionByField.has('contractType'))) updates.contractType = typeValue;

  for (const field of PROMOTABLE_FIELDS) {
    const value = correctionByField.has(field) ? correctionByField.get(field) : keyTerms[field];
    if (value == null && !isBase && !correctionByField.has(field)) continue; // amendment: never overwrite with null
    if (value !== undefined) updates[field] = value;
  }

  if (!Object.keys(updates).length) return;
  const cols = Object.keys(updates);
  const setSql = cols.map((c, i) => `"${c}"=$${i + 2}`).join(', ');
  await pool.query(`UPDATE contracts SET ${setSql}, "updatedAt"=NOW() WHERE id=$1`, [row.contractId, ...cols.map((c) => updates[c])]);
}

/** Sets a document's status='executed', supersedes any other document
 * currently 'executed' in the same parentDocumentId chain, promotes its
 * current review onto the contract, and flips contracts.status to
 * 'executed' if it was still 'draft'. The only place that sets
 * contract_documents.status/contracts.status other than setContractStatus. */
async function markDocumentExecuted(userId, documentId, executedAt) {
  const { contractId } = await assertDocumentAccess(userId, documentId);
  const execAt = executedAt || new Date().toISOString();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE contract_documents SET status='executed', "executedAt"=$1 WHERE id=$2`, [execAt, documentId]);

    const { rows: [doc] } = await client.query(`SELECT "parentDocumentId" FROM contract_documents WHERE id=$1`, [documentId]);
    const chainIds = [];
    let cursor = doc.parentDocumentId;
    while (cursor) {
      chainIds.push(cursor);
      const { rows: [p] } = await client.query(`SELECT "parentDocumentId" FROM contract_documents WHERE id=$1`, [cursor]);
      cursor = p ? p.parentDocumentId : null;
    }
    if (chainIds.length) {
      await client.query(`UPDATE contract_documents SET status='superseded' WHERE id = ANY($1) AND status='executed'`, [chainIds]);
    }
    await writeEvent(client, { contractId, type: 'executed', actorUserId: userId, documentId });
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const { rows: [currentReview] } = await pool.query(
    `SELECT id FROM contract_reviews WHERE "documentId"=$1 AND status='complete' ORDER BY "createdAt" DESC LIMIT 1`,
    [documentId]
  );
  if (currentReview) await promoteReviewToContract(userId, currentReview.id);
  await pool.query(`UPDATE contracts SET status='executed', "updatedAt"=NOW() WHERE id=$1 AND status='draft'`, [contractId]);
}

/** 'expired' | 'terminated' only — 'draft'/'executed' are only ever set by
 * markDocumentExecuted above. */
async function setContractStatus(userId, contractId, status) {
  if (!['expired', 'terminated'].includes(status)) throw new Error(`Invalid contract status: ${status}`);
  await assertContractAccess(userId, contractId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE contracts SET status=$1, "updatedAt"=NOW() WHERE id=$2`, [status, contractId]);
    await writeEvent(client, { contractId, type: 'status_changed', actorUserId: userId, payload: { status } });
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ── Corrections ──────────────────────────────────────────────────────────────

/** contractId always required — the (contractId, lineageId) lookup key a
 * later review's carry-forward check uses, per the spec's Round 4 redesign.
 * At most one of clauseId/obligationId/partyId/definitionId (provenance only). */
async function recordCorrection(userId, { contractId, clauseId = null, obligationId = null, partyId = null, definitionId = null, field, userValue = null, action, note = null }) {
  await assertContractAccess(userId, contractId);
  const targetCount = [clauseId, obligationId, partyId, definitionId].filter((v) => v != null).length;
  if (targetCount > 1) throw new Error('At most one of clauseId/obligationId/partyId/definitionId may be set');

  let lineageId = null;
  let matchedTextSnapshot = null;
  if (clauseId) {
    const { rows: [clause] } = await pool.query(`SELECT "lineageId", text FROM contract_clauses WHERE id=$1`, [clauseId]);
    if (clause) { lineageId = clause.lineageId; matchedTextSnapshot = clause.text; }
  } else if (obligationId) {
    const { rows: [ob] } = await pool.query(`SELECT "lineageId", description, "quotedText" FROM contract_obligations WHERE id=$1`, [obligationId]);
    if (ob) { lineageId = ob.lineageId; matchedTextSnapshot = ob.quotedText ? `${ob.description} | ${ob.quotedText}` : ob.description; }
  }

  const { rows } = await pool.query(
    `INSERT INTO contract_corrections
       ("userId", "contractId", "clauseId", "obligationId", "partyId", "definitionId", "lineageId", "matchedTextSnapshot", field, "modelValue", "userValue", action, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [userId, contractId, clauseId, obligationId, partyId, definitionId, lineageId, matchedTextSnapshot, field, null, userValue, action, note]
  );
  return rows[0];
}

// ── Obligations ──────────────────────────────────────────────────────────────

/** Active obligations come from executed, non-superseded documents' current
 * reviews only (spec's lifecycle rule) — this join enforces that, not
 * contracts.status. verificationStatus='failed' obligations are still
 * returned (so the UI can show them visibly separated) but flagged
 * derivedStatus='unverified' instead of a time-based bucket. */
async function listObligations(userId, { contractId = null, upcoming = false, obligorPartyId = null } = {}) {
  const clauses = [`cnt."userId"=$1`, `d.status='executed'`];
  const params = [userId];
  if (contractId) { params.push(contractId); clauses.push(`o."contractId"=$${params.length}`); }
  if (obligorPartyId) { params.push(obligorPartyId); clauses.push(`o."obligorPartyId"=$${params.length}`); }

  const { rows } = await pool.query(
    `SELECT o.*, t."userState", t."linkedTaskId"
     FROM contract_obligations o
     JOIN contract_reviews r ON r.id = o."reviewId"
     JOIN contract_documents d ON d.id = r."documentId"
     JOIN contracts cnt ON cnt.id = o."contractId"
     LEFT JOIN contract_obligation_tracking t ON t."contractId" = o."contractId" AND t."lineageId" = o."lineageId"
     WHERE ${clauses.join(' AND ')}
       AND r.id = (SELECT id FROM contract_reviews r2 WHERE r2."documentId" = d.id AND r2.status = 'complete' ORDER BY r2."createdAt" DESC LIMIT 1)
     ORDER BY o."absoluteDate" ASC NULLS LAST, o.id ASC`,
    params
  );

  const now = new Date();
  const withStatus = rows.map((o) => {
    let derivedStatus;
    if (o.verificationStatus === 'failed') derivedStatus = 'unverified';
    else if (o.absoluteDate) derivedStatus = new Date(o.absoluteDate) < now ? 'overdue' : 'upcoming';
    else derivedStatus = 'recurring_or_relative';
    return { ...o, derivedStatus };
  });
  return upcoming ? withStatus.filter((o) => o.derivedStatus === 'upcoming') : withStatus;
}

async function setObligationState(userId, obligationId, state) {
  if (!['handled', 'dismissed'].includes(state)) throw new Error(`Invalid obligation state: ${state}`);
  const { rows: [ob] } = await pool.query(
    `SELECT o."contractId", o."lineageId" FROM contract_obligations o JOIN contracts c ON c.id = o."contractId" WHERE o.id=$1 AND c."userId"=$2`,
    [obligationId, userId]
  );
  if (!ob) throw new ContractAccessError(`Obligation ${obligationId} not found for this user`);
  await pool.query(
    `INSERT INTO contract_obligation_tracking ("contractId", "lineageId", "userState") VALUES ($1,$2,$3)
     ON CONFLICT ("contractId", "lineageId") DO UPDATE SET "userState"=EXCLUDED."userState", "updatedAt"=NOW()`,
    [ob.contractId, ob.lineageId, state]
  );
}

/** Same one-directional bridge as the CRM touchpoint -> Task pattern —
 * tasks never point back. */
async function linkObligationToTask(userId, obligationId, taskId) {
  const { rows: [ob] } = await pool.query(
    `SELECT o."contractId", o."lineageId" FROM contract_obligations o JOIN contracts c ON c.id = o."contractId" WHERE o.id=$1 AND c."userId"=$2`,
    [obligationId, userId]
  );
  if (!ob) throw new ContractAccessError(`Obligation ${obligationId} not found for this user`);
  await pool.query(
    `INSERT INTO contract_obligation_tracking ("contractId", "lineageId", "linkedTaskId") VALUES ($1,$2,$3)
     ON CONFLICT ("contractId", "lineageId") DO UPDATE SET "linkedTaskId"=EXCLUDED."linkedTaskId", "updatedAt"=NOW()`,
    [ob.contractId, ob.lineageId, taskId]
  );
}

function escapeIcsText(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
}

/** Active, verified obligations only. Absolute dates and effective_date-
 * anchored obligations resolve to a concrete date; other anchor events have
 * no stored anchor date anywhere in the schema yet, so those (along with
 * anything verificationStatus='failed') are skipped here — the spec's "listed
 * separately in the UI as such, not silently dropped from the export" refers
 * to the UI's obligations view, not to this file appearing in a calendar. */
async function exportIcs(userId, { contractId = null } = {}) {
  const obligations = await listObligations(userId, { contractId });
  let contractEffectiveDate = null;
  if (contractId) {
    const { rows: [c] } = await pool.query(`SELECT "effectiveDate" FROM contracts WHERE id=$1`, [contractId]);
    contractEffectiveDate = c?.effectiveDate || null;
  }

  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Curam Vault//Contract Review//EN'];
  for (const o of obligations) {
    if (o.verificationStatus === 'failed') continue;
    let dtstart = null;
    if (o.absoluteDate) {
      dtstart = String(o.absoluteDate).slice(0, 10).replace(/-/g, '');
    } else if (o.anchorEvent === 'effective_date' && contractEffectiveDate && o.offsetDays != null) {
      const base = new Date(contractEffectiveDate);
      base.setUTCDate(base.getUTCDate() + o.offsetDays);
      dtstart = base.toISOString().slice(0, 10).replace(/-/g, '');
    } else if (o.rrule) {
      dtstart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    }
    if (!dtstart) continue;
    lines.push('BEGIN:VEVENT', `UID:vault-contract-obligation-${o.id}@curam-vault`, `DTSTART;VALUE=DATE:${dtstart}`);
    if (o.rrule) lines.push(`RRULE:${o.rrule}`);
    lines.push(`SUMMARY:${escapeIcsText(o.description)}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

/** Defaults to clauses from each document's current review only, matching
 * every other "active" view; includeAllDrafts opts into everything. */
async function searchClauses(userId, { query, includeAllDrafts = false } = {}) {
  const params = [userId, query];
  let sql = `
    SELECT cl.*, d.id AS "documentId", d."contractId", cnt.title AS "contractTitle"
    FROM contract_clauses cl
    JOIN contract_reviews r ON r.id = cl."reviewId"
    JOIN contract_documents d ON d.id = r."documentId"
    JOIN contracts cnt ON cnt.id = d."contractId"
    WHERE cnt."userId"=$1 AND to_tsvector('english', cl.text) @@ plainto_tsquery('english', $2)`;
  if (!includeAllDrafts) {
    sql += ` AND r.id = (SELECT id FROM contract_reviews r2 WHERE r2."documentId" = d.id AND r2.status = 'complete' ORDER BY r2."createdAt" DESC LIMIT 1)`;
  }
  sql += ` ORDER BY cl."createdAt" DESC LIMIT 100`;
  const { rows } = await pool.query(sql, params);
  return rows;
}

module.exports = {
  ContractAccessError,
  assertContractAccess,
  assertDocumentAccess,
  createContract,
  getContract,
  listContracts,
  setLegalHold,
  deleteContract,
  addParty,
  confirmParty,
  addDocument,
  deleteDocument,
  startReview,
  resumeReview,
  getReview,
  listReviews,
  promoteReviewToContract,
  markDocumentExecuted,
  setContractStatus,
  recordCorrection,
  listObligations,
  setObligationState,
  linkObligationToTask,
  exportIcs,
  searchClauses,
};
