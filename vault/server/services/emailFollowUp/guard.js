'use strict';

// The citation guard (case model §6, §7). Three verdicts: pass | needs_review | fail. Unknown is never pass.
// Deterministic checks come first and can pass (Rule 7.2); anything only a reader can judge is needs_review (Rule 7.3).
// No model is used here, by design: an LLM judge would put back the stochastic failure the guard exists to remove.

const { spanHash, norm } = require('./common');

const HEDGE = /\b(might|may|could|perhaps|maybe|if|subject to|hopefully|depending|provided that|unless)\b/i;
const NEGATION = /\b(not|no|never|none|cannot)\b|n't\b/i;
const AGREED_WORDS = /\b(as agreed|you agreed|agreed to|you confirmed|confirmed that|you committed|you promised)\b/i;

const ORDER = { pass: 0, needs_review: 1, fail: 2 };
function worst(a, b) { return ORDER[a] >= ORDER[b] ? a : b; }

function numbersIn(text) {
  return (String(text).match(/\d[\d,]*(?:\.\d+)?/g) || []).map((n) => n.replace(/,/g, ''));
}

function result(index, verdict, code, rule, message, extra) {
  return { index, verdict, code, rule, message, ...(extra || {}) };
}

/**
 * Check one claim. A claim is { text, kind: 'fact'|'courtesy', anchor, derived? }.
 * sources: { [sourceId]: { id, versionHash, supersededBy, parseStatus, text, clauses? } }
 */
function checkClaim(claim, index, { sources, profile, row }) {
  const text = String(claim.text || '');
  const hasNumbers = numbersIn(text).length > 0;

  // A courtesy line ("Thanks for your email") passes silently, unless it smuggles in a figure.
  if (claim.kind === 'courtesy' && !hasNumbers && !AGREED_WORDS.test(text)) {
    return result(index, 'pass', 'COURTESY', '6', 'courtesy line, nothing load-bearing');
  }

  // "as agreed" about something that is not an agreed row (Rules 4.1 / 7.2)
  if (AGREED_WORDS.test(text) && row && row.claimType !== 'agreed') {
    return result(index, 'fail', 'CLAIM_TYPE_MISMATCH', '4.1',
      `claim says the matter was agreed but the ledger records it as ${row.claimType}${row.condition ? ` (condition: "${row.condition}")` : ''}`);
  }

  if (!claim.anchor) {
    return profile === 'soft'
      ? result(index, 'needs_review', 'UNCITED_SOFT', '6', 'load-bearing claim has no source (soft profile: needs review, export allowed once accepted)')
      : result(index, 'fail', 'UNCITED', '6', 'load-bearing claim has no source');
  }

  const a = claim.anchor;
  const src = sources[a.sourceId];
  if (!src) return result(index, 'fail', 'UNKNOWN_SOURCE', '7', `cites ${a.sourceId}, which is not in this case's sources`);
  if (a.locator && a.locator.clause && !(src.clauses || []).includes(a.locator.clause)) {
    return result(index, 'fail', 'UNKNOWN_CLAUSE', '7', `cites clause "${a.locator.clause}", which does not exist in ${a.sourceId}`);
  }
  if (src.supersededBy || (a.versionHash && src.versionHash && a.versionHash !== src.versionHash)) {
    return result(index, 'needs_review', 'SUPERSEDED_VERSION', '2.4',
      `cites an older version of ${a.sourceId}`, { question: `Which version of ${a.sourceId} governs this claim?` });
  }
  if (src.parseStatus === 'failed') {
    return result(index, 'fail', 'SOURCE_UNREADABLE', '2.6', `${a.sourceId} could not be read, so it cannot support a claim`);
  }

  const start = a.locator && Number.isInteger(a.locator.start) ? a.locator.start : null;
  const end = a.locator && Number.isInteger(a.locator.end) ? a.locator.end : null;
  if (start == null || end == null) return result(index, 'fail', 'NO_LOCATOR', '2.2', 'anchor has no span in the extracted text');
  const span = String(src.text || '').slice(start, end);
  if (!span || spanHash(span) !== a.spanHash) {
    return result(index, 'fail', 'SPAN_MISMATCH', '2.2', `the text at ${a.sourceId} ${start}-${end} is not the text that was cited`);
  }

  // A derived claim (a computed due date) is checked against the ledger row, not the span.
  if (claim.derived) {
    const ok = row && row.due && row.due.status === 'exact' && row.due.date === claim.derived.value;
    return ok
      ? result(index, 'pass', 'DERIVED_OK', '5.2', 'date matches the ledger row and its stored arithmetic')
      : result(index, 'fail', 'DERIVED_MISMATCH', '5.2', 'stated date does not match the ledger row');
  }

  const nText = norm(text);
  const nSpan = norm(span);
  const verbatim = nText.includes(nSpan);

  if (!verbatim) {
    const spanNums = new Set(numbersIn(span));
    const missing = numbersIn(text).filter((n) => !spanNums.has(n));
    if (missing.length) return result(index, 'fail', 'FIGURE_NOT_IN_SOURCE', '7.2', `figure ${missing.join(', ')} is not in the cited text`);
    if (HEDGE.test(span) && !HEDGE.test(text)) {
      return result(index, 'fail', 'HEDGE_DROPPED', '7.2', 'the cited text is hedged ("might", "if" ...) but the claim states it flatly');
    }
    if (NEGATION.test(span) !== NEGATION.test(text)) {
      return result(index, 'fail', 'NEGATION_MISMATCH', '7.2', 'negation differs between the claim and the cited text');
    }
    // Paraphrase that no exact check can confirm: a person reads it (Rule 7.3).
    return result(index, 'needs_review', 'SEMANTIC', '7.3', 'paraphrase of the source: only a reader can confirm it', { span });
  }
  return result(index, 'pass', 'VERBATIM', '7.2', 'quotes the cited text exactly');
}

/**
 * Check a whole draft.
 * @returns {{verdict, results[], exportAllowed, reasons[]}}
 */
function checkDraft(draft, ctx) {
  const results = (draft.claims || []).map((c, i) => checkClaim(c, i, ctx));
  // Findings that belong to the draft as a whole (for example: mail already sent to this person since the request)
  for (const n of ctx.notes || []) results.push(n);
  if (!(draft.claims || []).length) {
    return { verdict: 'fail', results: [result(-1, 'fail', 'EMPTY', '7', 'a draft with no claims cannot be checked')], exportAllowed: false, reasons: ['empty draft'] };
  }
  let verdict = 'pass';
  for (const r of results) verdict = worst(verdict, r.verdict);

  const accepted = new Set((draft.acceptedWarnings || []).map((w) => `${w.index}:${w.code}`));
  const open = results.filter((r) => r.verdict === 'needs_review');
  const exportAllowed = verdict === 'pass'
    || (verdict === 'needs_review' && ctx.profile === 'soft' && open.every((r) => r.code === 'UNCITED_SOFT' && accepted.has(`${r.index}:${r.code}`)));
  const reasons = results.filter((r) => r.verdict !== 'pass').map((r) => `${r.code} (§${r.rule}): ${r.message}`);
  return { verdict, results, exportAllowed, reasons };
}

module.exports = { checkClaim, checkDraft, numbersIn, HEDGE, NEGATION, AGREED_WORDS };
