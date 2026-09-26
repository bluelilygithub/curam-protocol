'use strict';

// Contract Review — Pipeline stage 4 (Parties + key terms extraction).
// Reconciles extracted parties against contract_parties by normalized name
// (never blind-inserted) and determines whether the pipeline must pause at
// awaiting_role_confirmation, per docs/contract-review-spec.md's
// contract_parties reconciliation note.

const { pool, PARTY_ROLE_KEYS } = require('../../db');
const { getModelsForUser } = require('../modelResolver');
const { callModel } = require('../callModel');
const { parseModelJson } = require('../../utils/parseModelJson');
const { recordRawOutput } = require('./rawOutputs');
const { partiesKeyTermsPrompt, PROMPT_VERSION } = require('./prompts/v1');

function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[.,'"()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function sanitizeKeyTerms(raw) {
  const kt = raw && typeof raw === 'object' ? raw : {};
  return {
    effectiveDate: DATE_RE.test(kt.effectiveDate) ? kt.effectiveDate : null,
    termLengthMonths: Number.isFinite(Number(kt.termLengthMonths)) && kt.termLengthMonths != null ? Math.round(Number(kt.termLengthMonths)) : null,
    governingLawCountry: typeof kt.governingLawCountry === 'string' && kt.governingLawCountry.trim() ? kt.governingLawCountry.trim().slice(0, 2).toUpperCase() : null,
    governingLawRegion: typeof kt.governingLawRegion === 'string' && kt.governingLawRegion.trim() ? kt.governingLawRegion.trim() : null,
    contractValue: Number.isFinite(Number(kt.contractValue)) && kt.contractValue != null ? Number(kt.contractValue) : null,
    contractValueCurrency: typeof kt.contractValueCurrency === 'string' && kt.contractValueCurrency.trim() ? kt.contractValueCurrency.trim().slice(0, 3).toUpperCase() : null,
  };
}

/**
 * Extracts parties + key terms, reconciles parties against the contract's
 * existing contract_parties by normalized name, writes extractedKeyTerms
 * onto the review. Returns { parties, keyTerms, needsRoleConfirmation } —
 * needsRoleConfirmation is false only when a party on this contract is
 * already confirmedByUser=true (skip re-asking on every re-review).
 */
async function extractPartiesAndKeyTerms(reviewId, contractId, extractedText, userId) {
  const { standard } = await getModelsForUser(userId);
  const modelId = standard || 'none';
  let extractedParties = [];
  let keyTerms = sanitizeKeyTerms(null);

  if (standard) {
    const prompt = partiesKeyTermsPrompt(extractedText, PARTY_ROLE_KEYS);
    const text = await callModel(standard, prompt, { maxTokens: 900 });
    const parsed = parseModelJson(text);
    await recordRawOutput({ reviewId, stage: 'parties_key_terms', modelId, promptVersion: PROMPT_VERSION, rawResponse: { prompt: prompt.slice(0, 500), text, parsed } });
    if (parsed && typeof parsed === 'object') {
      extractedParties = Array.isArray(parsed.parties) ? parsed.parties : [];
      keyTerms = sanitizeKeyTerms(parsed.keyTerms);
    }
  } else {
    await recordRawOutput({ reviewId, stage: 'parties_key_terms', modelId, promptVersion: PROMPT_VERSION, rawResponse: { skipped: 'no model configured' } });
  }

  const { rows: existingParties } = await pool.query(
    `SELECT * FROM contract_parties WHERE "contractId"=$1`, [contractId]
  );
  const existingByNorm = new Map(existingParties.map((p) => [normalizeName(p.name), p]));

  const reconciled = [];
  for (const raw of extractedParties) {
    const name = String(raw?.name || '').trim();
    if (!name) continue;
    const roleRaw = raw?.roleRaw ? String(raw.roleRaw).slice(0, 200) : null;
    const role = PARTY_ROLE_KEYS.includes(raw?.role) ? raw.role : 'other';
    const norm = normalizeName(name);
    const existing = existingByNorm.get(norm);
    if (existing) {
      // Reuse the existing row — a re-review of a new draft doesn't create a
      // duplicate party for a real-world party already on the contract.
      await pool.query(
        `UPDATE contract_parties SET "roleRaw"=COALESCE("roleRaw",$1) WHERE id=$2`,
        [roleRaw, existing.id]
      );
      reconciled.push(existing);
    } else {
      const { rows } = await pool.query(
        `INSERT INTO contract_parties ("contractId", name, role, "roleRaw") VALUES ($1,$2,$3,$4) RETURNING *`,
        [contractId, name, role, roleRaw]
      );
      reconciled.push(rows[0]);
      existingByNorm.set(norm, rows[0]);
    }
  }

  await pool.query(
    `UPDATE contract_reviews SET "extractedKeyTerms"=$1 WHERE id=$2`,
    [JSON.stringify(keyTerms), reviewId]
  );

  const { rows: allParties } = await pool.query(`SELECT * FROM contract_parties WHERE "contractId"=$1`, [contractId]);
  const alreadyConfirmed = allParties.some((p) => p.confirmedByUser);

  return { parties: allParties, keyTerms, needsRoleConfirmation: !alreadyConfirmed };
}

module.exports = { extractPartiesAndKeyTerms, normalizeName, sanitizeKeyTerms };
