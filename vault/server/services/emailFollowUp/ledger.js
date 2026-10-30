'use strict';

// The commitments ledger (case model §3, §4, §11). Pure functions over plain row objects: same rows in, same rows out.
// A row: { id, kind, direction, party, items[], amount, due, claimType, condition, status, authority,
//          conditionSatisfied, anchors[], evidence[], supersededBy, supersedes, delta, itemNoun, requestDate }

const { RuleError, norm } = require('./common');
const { daysBetween } = require('./deadlines');

const KINDS = ['commitment', 'waiting_on', 'decision', 'deadline'];
const DIRECTIONS = ['i_owe', 'they_owe', 'external'];
const CLAIM_TYPES = ['agreed', 'proposed', 'conditional', 'refused'];
const STATUSES = ['open', 'met', 'waived', 'superseded', 'unverified', 'suspended'];

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
function words(n) { return n <= 10 ? NUMBER_WORDS[n] : String(n); }

function normItem(s) { return norm(s).replace(/^(the|a|an|our|your) /, ''); }
function itemSet(items) { return [...new Set((items || []).map(normItem).filter(Boolean))].sort(); }

/** Validate and shape a mention (one thing the extractor read out of one source) into a row, ready to add. */
function rowFromMention(m, id) {
  if (!KINDS.includes(m.kind)) throw new RuleError('4', `unknown kind "${m.kind}"`);
  if (!DIRECTIONS.includes(m.direction)) throw new RuleError('4', `unknown direction "${m.direction}"`);
  if (!CLAIM_TYPES.includes(m.claimType)) throw new RuleError('4.1', `claim_type must be one of ${CLAIM_TYPES.join('/')}, got "${m.claimType}"`);
  if (m.claimType === 'conditional' && !String(m.condition || '').trim()) {
    throw new RuleError('4.1', 'a conditional claim must carry its condition verbatim');
  }
  if (!m.party || !String(m.party).trim()) throw new RuleError('3', 'a row needs a party');
  const items = itemSet(m.items);
  if (!items.length) throw new RuleError('4.2', 'a row needs at least one item (what is owed)');
  const anchors = m.anchor ? [m.anchor] : [];
  return {
    id,
    kind: m.kind,
    direction: m.direction,
    party: norm(m.party),
    partyLabel: m.partyLabel || m.party,
    items,
    itemNoun: m.itemNoun || 'item',
    amount: m.amount == null ? null : Number(m.amount),
    due: m.due || { status: 'needs_review', date: null, raw: null, missing: ['deadline wording'] },
    deadlineClass: m.deadlineClass || 'soft',
    claimType: m.claimType,
    condition: m.claimType === 'conditional' ? String(m.condition).trim() : null,
    conditionSatisfied: false,
    status: 'open',
    authority: m.authority || 'confirmed',
    anchors,
    evidence: m.sourceId ? [m.sourceId] : [],
    quote: m.quote || null,
    requestDate: m.requestDate || null,
    supersededBy: null,
    supersedes: null,
    delta: null,
  };
}

function sameDue(a, b) {
  if (a.status === 'exact' && b.status === 'exact') return a.date === b.date;
  if (a.status !== 'exact' && b.status !== 'exact') return norm(a.raw) === norm(b.raw);
  return false;
}

/** Rule 4.2: identity is structured, never sentence similarity. */
function sameIdentity(r, n) {
  return r.party === n.party && r.direction === n.direction && r.kind === n.kind
    && r.items.join('|') === n.items.join('|')
    && (r.amount ?? null) === (n.amount ?? null)
    && sameDue(r.due, n.due)
    && r.claimType === n.claimType
    && (r.condition || null) === (n.condition || null);
}

/** Same party, direction and kind with at least one item in common: the same ask, changed. */
function sameAsk(r, n) {
  return r.party === n.party && r.direction === n.direction && r.kind === n.kind
    && r.items.some((i) => n.items.includes(i));
}

/** The change between two versions of an ask, in plain words (Rule 4.3). */
function describeDelta(oldRow, newRow) {
  const parts = [];
  if (oldRow.due.status === 'exact' && newRow.due.status === 'exact' && oldRow.due.date !== newRow.due.date) {
    const d = daysBetween(oldRow.due.date, newRow.due.date);
    const n = Math.abs(d);
    parts.push(`deadline moved ${words(n)} day${n === 1 ? '' : 's'} ${d < 0 ? 'earlier' : 'later'}`);
  } else if (!sameDue(oldRow.due, newRow.due)) {
    parts.push('deadline wording changed');
  }
  const added = newRow.items.filter((i) => !oldRow.items.includes(i)).length;
  const removed = oldRow.items.filter((i) => !newRow.items.includes(i)).length;
  const noun = newRow.itemNoun || 'item';
  if (added) parts.push(`${words(added)} ${noun}${added === 1 ? '' : 's'} added`);
  if (removed) parts.push(`${words(removed)} ${noun}${removed === 1 ? '' : 's'} removed`);
  if ((oldRow.amount ?? null) !== (newRow.amount ?? null)) parts.push(`amount changed from ${oldRow.amount ?? 'none'} to ${newRow.amount ?? 'none'}`);
  if (oldRow.claimType !== newRow.claimType) parts.push(`claim changed from ${oldRow.claimType} to ${newRow.claimType}`);
  return parts.length ? `${parts.join('; ')}.` : 'details restated differently.';
}

/**
 * Fold one mention into the ledger.
 *  - identical identity  -> one row, one more anchor (Rule 4.4)
 *  - same ask, changed   -> the old row is superseded by a NEW row, delta in words (Rule 4.3)
 *  - otherwise           -> a new row
 * @returns {{rows: object[], row: object, action: 'evidence'|'supersede'|'new', delta: string|null}}
 */
function applyMention(rows, mention, ctx = {}) {
  const newId = ctx.newId || (() => `r${rows.length + 1}`);
  const next = rows.map((r) => ({ ...r, anchors: [...r.anchors], evidence: [...r.evidence] }));
  const candidate = rowFromMention(mention, newId());
  const live = next.filter((r) => r.status === 'open' || r.status === 'unverified');

  const same = live.find((r) => sameIdentity(r, candidate));
  if (same) {
    for (const a of candidate.anchors) same.anchors.push(a);
    for (const e of candidate.evidence) if (!same.evidence.includes(e)) same.evidence.push(e);
    return { rows: next, row: same, action: 'evidence', delta: null };
  }

  const old = live.find((r) => sameAsk(r, candidate));
  if (old) {
    candidate.supersedes = old.id;
    candidate.requestDate = old.requestDate || candidate.requestDate;
    candidate.delta = describeDelta(old, candidate);
    old.status = 'superseded';
    old.supersededBy = candidate.id;
    old.delta = candidate.delta;
    next.push(candidate);
    return { rows: next, row: candidate, action: 'supersede', delta: candidate.delta };
  }

  next.push(candidate);
  return { rows: next, row: candidate, action: 'new', delta: null };
}

function refuse(row, rule, reason) { return { row, ok: false, rule, reason: `§${rule}: ${reason}` }; }

/**
 * Move a row. Events:
 *  affirmation           "great, thanks": changes nothing, ever
 *  deliverable {anchor}  evidence the deliverable arrived
 *  condition_met {anchor | humanNote}   the named condition was satisfied (Rule 4.1a)
 *  human_close {note}    "resolved / handled elsewhere" (Rule 11.1): one click, optional note
 *  waive
 *  confirm_authority {by: primary|group|human_note}
 * Returns {row, ok, rule?, reason?}; a refusal names the rule.
 */
function transition(row, event) {
  const r = { ...row, anchors: [...row.anchors], evidence: [...row.evidence] };
  switch (event.type) {
    case 'affirmation':
      return { row: r, ok: true, changed: false, reason: 'an acknowledgement is not evidence' };
    case 'condition_met': {
      if (r.claimType !== 'conditional') return refuse(r, '4.1a', 'row is not conditional');
      if (!event.anchor && !String(event.humanNote || '').trim()) return refuse(r, '4.1a', 'condition satisfaction needs an anchor or a human note');
      r.conditionSatisfied = true;
      r.conditionProof = event.anchor ? { anchor: event.anchor } : { provenance: 'human', note: String(event.humanNote).trim() };
      return { row: r, ok: true, changed: true };
    }
    case 'deliverable': {
      if (r.status !== 'open' && r.status !== 'unverified') return refuse(r, '4.5', `a ${r.status} row cannot be met`);
      if (r.authority === 'unconfirmed') return refuse(r, '3.3a', 'authority is unconfirmed: cannot clear this obligation');
      if (!event.anchor) return refuse(r, '2', 'a deliverable needs an anchor');
      if (r.claimType === 'conditional' && !r.conditionSatisfied) return refuse(r, '4.1a', `condition "${r.condition}" is not shown satisfied`);
      if (r.claimType === 'refused') return refuse(r, '4.1', 'a refused ask has nothing to meet');
      r.status = 'met';
      r.anchors.push(event.anchor);
      return { row: r, ok: true, changed: true };
    }
    case 'human_close': {
      if (r.status !== 'open' && r.status !== 'unverified' && r.status !== 'suspended') return refuse(r, '11.1', `a ${r.status} row is already closed`);
      r.status = 'met';
      r.closedBy = { provenance: 'human', note: String(event.note || '').trim() || null };
      return { row: r, ok: true, changed: true };
    }
    case 'waive': {
      if (r.status !== 'open' && r.status !== 'unverified') return refuse(r, '4.5', `a ${r.status} row cannot be waived`);
      r.status = 'waived';
      return { row: r, ok: true, changed: true };
    }
    case 'confirm_authority': {
      if (!['primary', 'group', 'human_note'].includes(event.by)) return refuse(r, '3.3a', 'authority is confirmed by the primary party, the party group, or a human note');
      r.authority = 'confirmed';
      r.authorityConfirmedBy = event.by;
      return { row: r, ok: true, changed: true };
    }
    default:
      return refuse(r, '4.5', `unknown event "${event.type}"`);
  }
}

/**
 * Rule 3.3: a substitute suspends the ask, it does not inherit or satisfy it.
 * The original row goes to suspended; a new row opens against the substitute with authority: unconfirmed.
 */
function suspendForSubstitute(rows, rowId, substitute, ctx = {}) {
  const idx = rows.findIndex((r) => r.id === rowId);
  if (idx < 0) throw new RuleError('3.3', `no row ${rowId}`);
  const original = rows[idx];
  if (original.status !== 'open' && original.status !== 'unverified') throw new RuleError('3.3', `row ${rowId} is ${original.status}: nothing to suspend`);
  const next = rows.map((r) => ({ ...r, anchors: [...r.anchors], evidence: [...r.evidence] }));
  next[idx].status = 'suspended';
  const newId = ctx.newId ? ctx.newId() : `r${rows.length + 1}`;
  const sub = {
    ...rowFromMention({
      kind: original.kind, direction: original.direction, party: substitute.party, partyLabel: substitute.partyLabel,
      items: original.items, itemNoun: original.itemNoun, amount: original.amount, due: original.due,
      deadlineClass: original.deadlineClass, claimType: original.claimType, condition: original.condition,
      anchor: substitute.anchor, sourceId: substitute.sourceId, quote: substitute.quote, requestDate: original.requestDate,
      authority: 'unconfirmed',
    }, newId),
    substituteFor: original.id,
  };
  next.push(sub);
  return { rows: next, row: sub };
}

/** Rule 11.2: age downgrades, it does not nag. An open row with no inbound evidence for maxDays becomes unverified. */
function ageRows(rows, now, { maxDays = 21, lastInboundAt = {} } = {}) {
  const nowMs = new Date(now).getTime();
  return rows.map((r) => {
    if (r.status !== 'open') return r;
    const last = lastInboundAt[r.id] || r.requestDate;
    if (!last) return r;
    const ageDays = (nowMs - new Date(last).getTime()) / 86400000;
    return ageDays > maxDays ? { ...r, status: 'unverified' } : r;
  });
}

module.exports = {
  KINDS, DIRECTIONS, CLAIM_TYPES, STATUSES,
  rowFromMention, applyMention, transition, suspendForSubstitute, ageRows, describeDelta, sameIdentity, itemSet,
};
