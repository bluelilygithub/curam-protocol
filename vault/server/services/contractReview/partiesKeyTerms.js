'use strict';

// Contract Review — Pipeline stage 4 (Parties + key terms extraction).
// Reconciles extracted parties against contract_parties by normalized name
// (never blind-inserted) and determines whether the pipeline must pause at
// awaiting_role_confirmation, per docs/contract-review-spec.md's
// contract_parties reconciliation note.

const { pool, PARTY_ROLE_KEYS } = require('../../db');
const { resolveContractReviewModel } = require('../contractReviewModelResolver');
const { callModel } = require('../callModel');
const { parseModelJson } = require('../../utils/parseModelJson');
const { recordRawOutput } = require('./rawOutputs');
const { trackCost, LLM_CALL_TIMEOUT_MS } = require('./costTracking');
const { partiesKeyTermsPrompt, PROMPT_VERSION } = require('./prompts/v1');

function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[.,'"()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Common commercial-role labels that don't literally appear in
// PARTY_ROLE_KEYS but map cleanly onto one — a services agreement's
// "Provider"/"Client" is the everyday case, not an edge case, and defaulting
// straight to 'other' for these loses real signal the document already
// states plainly. roleRaw always keeps the document's own label regardless.
const ROLE_LABEL_MAP = {
  vendor: ['vendor', 'provider', 'service provider', 'supplier', 'contractor', 'consultant', 'seller'],
  customer: ['customer', 'client', 'purchaser', 'buyer'],
  employer: ['employer'],
  employee: ['employee'],
  licensor: ['licensor'],
  licensee: ['licensee'],
  landlord: ['landlord', 'lessor'],
  tenant: ['tenant', 'lessee'],
  lender: ['lender'],
  borrower: ['borrower'],
  guarantor: ['guarantor'],
};

function mapRoleLabel(label) {
  const norm = String(label || '').toLowerCase().trim();
  if (!norm) return 'other';
  for (const [role, keywords] of Object.entries(ROLE_LABEL_MAP)) {
    if (keywords.includes(norm)) return role;
  }
  return 'other';
}

// Deterministic fallback for when the model's own extraction comes back
// empty despite the parties being plainly stated — a real observed failure
// mode on a document whose preamble read "Bluegum Digital Pty Ltd ... (the
// Provider)" / "Harbourline Physiotherapy Pty Ltd ... (the Client)" and got
// zero parties from the model. This never silently drops a party the way an
// LLM occasionally does; it only ever ADDS candidates when the model found
// none at all, so it can't override a real model result. Longest labels
// first so "service provider" matches before "provider" inside it.
const KNOWN_ROLE_LABELS = [
  'service provider', 'provider', 'client', 'vendor', 'customer', 'supplier',
  'contractor', 'consultant', 'buyer', 'seller', 'purchaser', 'employer',
  'employee', 'licensor', 'licensee', 'landlord', 'tenant', 'lessor', 'lessee',
  'lender', 'borrower', 'guarantor', 'discloser', 'recipient',
].sort((a, b) => b.length - a.length);

// Legal-entity name suffixes — used to anchor a company name independently
// of the defined-term parenthetical, since a real preamble almost always has
// an ABN/registration-number parenthetical sitting BETWEEN the name and the
// "(the X)" label ("Bluegum Digital Pty Ltd (ABN 12 345 678 901) ... (the
// Provider)") — matching the name immediately before the label paren (the
// first version of this function) grabbed whatever capitalized words sat
// right before THAT paren instead, which is the ABN clause's own trailing
// text, not the company name. Anchoring on the legal suffix instead finds
// the name in one contiguous run with nothing in between.
// Each word of the name itself must start with a capital/digit — without
// that, the flexible middle group happily swallows an ordinary lowercase
// run ("Agreement is entered into between Bluegum Digital Pty Ltd" all
// matches as "the name" otherwise, since plain prose satisfies the same
// character class a real name would).
const ENTITY_SUFFIX_RE = /[A-Z][A-Za-z0-9&.,'-]*(?:\s+[A-Z0-9&][A-Za-z0-9&.,'-]*){0,6}?\s+(?:Pty\.?\s*Ltd\.?|Ltd\.?|L\.?L\.?C\.?|Inc\.?|Corp(?:oration)?\.?|Limited|LLP|LP)\b/g;

function detectPreambleParties(extractedText) {
  const preamble = String(extractedText || '').slice(0, 3000);

  const entities = [];
  let em;
  const entityRe = new RegExp(ENTITY_SUFFIX_RE);
  while ((em = entityRe.exec(preamble))) {
    entities.push({ name: em[0].trim().replace(/\s+/g, ' '), end: em.index + em[0].length });
  }
  if (!entities.length) return [];

  const labelAlt = KNOWN_ROLE_LABELS.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const labelRe = new RegExp(`\\(\\s*(?:the\\s+)?["“']?(${labelAlt})["”']?\\s*\\)`, 'gi');
  const seen = new Set();
  const found = [];
  let lm;
  while ((lm = labelRe.exec(preamble))) {
    const label = lm[1].trim();
    const labelStart = lm.index;
    // The nearest entity name ending before this label, within a reasonable
    // window — skips past an intervening ABN/registration parenthetical.
    let best = null;
    for (const e of entities) {
      if (e.end <= labelStart && labelStart - e.end < 300 && (!best || e.end > best.end)) best = e;
    }
    if (!best) continue;
    const key = normalizeName(best.name);
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ name: best.name, role: mapRoleLabel(label), roleRaw: label });
  }
  return found;
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
async function extractPartiesAndKeyTerms(reviewId, contractId, extractedText, userId, costTracker) {
  const { modelId: resolved } = await resolveContractReviewModel(userId);
  const modelId = resolved || 'none';
  let extractedParties = [];
  let keyTerms = sanitizeKeyTerms(null);

  if (resolved) {
    const prompt = partiesKeyTermsPrompt(extractedText, PARTY_ROLE_KEYS);
    const result = await callModel(resolved, prompt, { maxTokens: 900, returnUsage: true, timeoutMs: LLM_CALL_TIMEOUT_MS });
    const text = result.text;
    if (costTracker) await trackCost(costTracker, reviewId, modelId, result);
    const parsed = parseModelJson(text);
    await recordRawOutput({ reviewId, stage: 'parties_key_terms', modelId, promptVersion: PROMPT_VERSION, rawResponse: { prompt: prompt.slice(0, 500), text, parsed } });
    if (parsed && typeof parsed === 'object') {
      extractedParties = Array.isArray(parsed.parties) ? parsed.parties : [];
      keyTerms = sanitizeKeyTerms(parsed.keyTerms);
    }
  } else {
    await recordRawOutput({ reviewId, stage: 'parties_key_terms', modelId, promptVersion: PROMPT_VERSION, rawResponse: { skipped: 'no model configured' } });
  }

  // The model came back with zero parties despite a real contract always
  // naming at least one — never silently accept that as "there are no
  // parties" when the document's own preamble states them plainly (the
  // observed failure: a clear "X Pty Ltd ... (the Provider)" preamble still
  // produced an empty parties array). Only runs when the model found
  // nothing at all, so it can never override or drop a real model result.
  if (!extractedParties.length) {
    const fallback = detectPreambleParties(extractedText);
    if (fallback.length) {
      extractedParties = fallback;
      await recordRawOutput({
        reviewId, stage: 'parties_key_terms', modelId: 'regex-preamble-fallback', promptVersion: PROMPT_VERSION,
        rawResponse: { fallbackTriggeredBecause: 'model returned zero parties', found: fallback },
      });
      const { captureIf, makeFingerprint } = require('../SuggestionService');
      await captureIf(true, {
        userId,
        source: 'contractReviewParties',
        category: 'alert',
        fingerprint: makeFingerprint('contractReviewParties', `review:${reviewId}:model-empty-parties`),
        title: 'Contract Review: model returned no parties, regex fallback found some',
        body: `Review ${reviewId}: the parties extraction model returned an empty parties array even though a preamble party pattern was found by the deterministic fallback. Check the model's own raw output for this review to see why it missed them.`,
        context: `reviewId=${reviewId}`,
      });
    }
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
    // Never just 'other' when the model's role AND its own roleRaw label
    // both miss the enum — a generic label like "Provider"/"Client" maps
    // cleanly onto vendor/customer and shouldn't be flattened to 'other'
    // just because the model didn't pick the exact enum word itself.
    const role = PARTY_ROLE_KEYS.includes(raw?.role) ? raw.role : mapRoleLabel(roleRaw || raw?.role);
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

module.exports = { extractPartiesAndKeyTerms, normalizeName, sanitizeKeyTerms, mapRoleLabel, detectPreambleParties };
