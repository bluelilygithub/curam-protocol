'use strict';

// Gates that decide whether something may happen (case model §1, §6, §8, §10).
// Pure: every input, including "now", is passed in.

const { RuleError } = require('./common');

/** Rule 1.1: a case exists because a human opened one and named the obligation. */
function createCase(input, actor) {
  if (!actor || actor.type !== 'human') throw new RuleError('1.1', 'a case can only be opened by a person');
  const title = String(input.title || '').trim();
  const obligation = String(input.obligation || '').trim();
  if (!title) throw new RuleError('1.1', 'a case needs a title');
  if (!obligation) throw new RuleError('1.1', 'a case is opened from an obligation: say what is owed');
  const profile = input.profile === 'professional' ? 'professional' : 'soft';
  return { title, obligation, kind: input.kind || 'other', profile, governing: input.governing || [], status: 'draft' };
}

/** Rule 1.2: mail never creates a case. */
function createCaseFromMessage() {
  throw new RuleError('1.2', 'suggestion never initiates: an inbound message cannot create a case');
}

/**
 * Rule 1.2: inbound mail may be SUGGESTED for an existing case, requiring acceptance; it never attaches silently.
 * Matching is by known aliases only.
 */
function suggestCaseForMessage(message, cases) {
  const from = String(message.from || '').toLowerCase();
  const hit = (cases || []).find((c) => c.status !== 'closed' && c.status !== 'abandoned'
    && (c.aliases || []).some((a) => from.includes(String(a).toLowerCase())));
  return hit
    ? { action: 'suggest', caseId: hit.id, needsAcceptance: true, attached: false }
    : { action: 'queue', attached: false };
}

/** Rule 10.1/10.3: the Sent watermark is per case and must cover [request date, now]. */
function sentSweepCovers(watermark, requestDate, now, { toleranceMs = 15 * 60 * 1000 } = {}) {
  if (!watermark || !watermark.completed) return false;
  if (requestDate && new Date(watermark.from).getTime() > new Date(requestDate).getTime()) return false;
  return new Date(watermark.to).getTime() >= new Date(now).getTime() - toleranceMs;
}

/**
 * May this row produce a nudge draft right now?
 * @returns {{ok:boolean, close?:boolean, blocks:{rule:string, reason:string}[]}}
 */
function canDraft({ row, watermark, now, pendingDrafts = 0, cap = 5, sentLinks = [] }) {
  const blocks = [];
  if (row.status === 'unverified') blocks.push({ rule: '11.2', reason: 'row is unverified (no recent evidence): unverified rows cannot draft' });
  else if (row.status !== 'open') blocks.push({ rule: '4.5', reason: `row is ${row.status}` });
  if (row.claimType === 'refused') blocks.push({ rule: '4.1', reason: 'the ask was refused: nothing to chase' });
  if (row.conflictWith) blocks.push({ rule: '4.3', reason: `${row.conflictQuestion || 'two sources disagree on the figure'} Waive the wrong one first.` });

  // Rule 10.1: reconcile against Sent before anything is chased.
  const answered = sentLinks.find((l) => l.kind === 'answered');
  if (answered) return { ok: false, close: true, blocks: [{ rule: '10', reason: `already answered in Sent (${answered.messageId}): close the row, no draft` }] };

  if (row.direction === 'they_owe' || row.direction === 'external') {
    if (!sentSweepCovers(watermark, row.requestDate, now)) {
      blocks.push({ rule: '10.1', reason: 'no completed Sent sweep covers the request date to now: run the Sent check first' });
    }
    const chased = sentLinks.find((l) => l.kind === 'chased');
    if (chased) blocks.push({ rule: '10', reason: `already chased in Sent (${chased.messageId})` });
  }

  // Rule 8.2: unreviewed backlog is a blocking state.
  if (pendingDrafts >= cap) blocks.push({ rule: '8.2', reason: `${pendingDrafts} drafts are waiting for review (limit ${cap}): review them before making more` });

  return { ok: blocks.length === 0, blocks };
}

/**
 * Export gates that depend on sources and governing items (case model §6).
 * @param {{profile, sources: {id, parseStatus, candidateObligations?:number}[], rows: object[], governing: {id, mappedRowId?, notApplicable?:string}[]}} p
 * @returns {{exportBlocked:boolean, reasons:string[], blockedDraftSources:string[]}}
 */
function exportGates({ profile, sources, rows, governing }) {
  const reasons = [];
  const blockedDraftSources = [];

  for (const s of sources || []) {
    if (s.parseStatus === 'reference_only' && !s.parseReason) reasons.push(`§2.6: ${s.id} is reference-only with no stated reason`);
    if (s.parseStatus !== 'failed') continue;
    const attributed = (rows || []).some((r) => (r.evidence || []).includes(s.id) || (r.anchors || []).some((a) => a.sourceId === s.id))
      || (s.candidateObligations || 0) > 0;
    if (attributed) reasons.push(`§6.1: ${s.id} is unreadable and carries an obligation: the case cannot be exported`);
    else if (profile === 'professional') reasons.push(`§2.6: ${s.id} is unreadable`);
    else blockedDraftSources.push(s.id); // soft + unattributed: blocks only the drafts that cite it
  }

  // Gate 3 is vacuous when there is no governing document (Rule 1.4).
  for (const g of governing || []) {
    if (profile === 'professional' && !g.mappedRowId && !g.notApplicable) reasons.push(`§6: governing item ${g.id} maps to no obligation and is not marked not-applicable`);
  }
  return { exportBlocked: reasons.length > 0, reasons, blockedDraftSources };
}

module.exports = { createCase, createCaseFromMessage, suggestCaseForMessage, sentSweepCovers, canDraft, exportGates };
