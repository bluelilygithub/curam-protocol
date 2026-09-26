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

async function confirmParty(userId, contractId, partyId) {
  await assertContractAccess(userId, contractId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE contract_parties SET "confirmedByUser"=TRUE
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
};
