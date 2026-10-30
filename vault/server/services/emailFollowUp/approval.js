'use strict';

// Approval and staleness (case model §9). One record per draft version, append-only.
// The hash covers the WHOLE outbound object, not just the body: changing the recipient after approval is the most
// dangerous edit there is (Rule 9.1). Absence of a record means no (Rule 9.3). Staleness is checked at copy time (Rule 9.4).

const { sha256, canonicalJson } = require('./common');

function addrs(list) { return (list || []).map((a) => String(a).trim().toLowerCase()).sort(); }

/** The exact object an approval is about. */
function outboundObject(draft) {
  return {
    subject: String(draft.subject || ''),
    body: String(draft.body || ''),
    to: addrs(draft.to),
    cc: addrs(draft.cc),
    bcc: addrs(draft.bcc),
    inReplyTo: draft.inReplyTo || null,
    references: [...(draft.references || [])],
    citations: (draft.claims || []).map((c) => (c.anchor ? { s: c.anchor.sourceId, v: c.anchor.versionHash || null, h: c.anchor.spanHash || null } : null)),
  };
}

function draftHash(draft) { return sha256(canonicalJson(outboundObject(draft))); }

/** Build the approval record for the current draft. Records which warnings the approver accepted (Rule 6). */
function approve(draft, { userId, at, acceptedWarnings = [] }) {
  return { draftId: draft.id, version: draft.version, hash: draftHash(draft), decision: 'approved', userId, at, acceptedWarnings };
}

/** Does a new inbound message touch this draft? Sender is the counterparty, or it is in a cited thread. */
function touches(inbound, draft) {
  const from = String(inbound.from || '').toLowerCase();
  if ((draft.to || []).some((a) => from.includes(String(a).toLowerCase()))) return 'the counterparty wrote again';
  if (inbound.threadId && (draft.threadIds || []).includes(inbound.threadId)) return 'new mail in a thread this draft cites';
  if (inbound.mentionsRowIds && (draft.rowIds || []).some((id) => inbound.mentionsRowIds.includes(id))) return 'new mail touches the same obligation';
  return null;
}

/**
 * Run at copy time. Returns {ok:true} or {ok:false, status:'pending', reason}.
 * @param {object} approval  latest approval record for this draft version (or null)
 * @param {object} draft     the draft as it is NOW
 * @param {object[]} inboundSince mail that arrived after the draft was created
 */
function checkAtCopy(approval, draft, inboundSince = []) {
  if (!approval || approval.decision !== 'approved') return { ok: false, status: 'pending', rule: '9.3', reason: 'no approval record: absence of a record means no' };
  if (approval.version !== draft.version) return { ok: false, status: 'pending', rule: '9.2', reason: 'this is a newer version than the one approved' };
  if (approval.hash !== draftHash(draft)) return { ok: false, status: 'pending', rule: '9.1', reason: 'hash mismatch: the draft (body, subject, recipients or citations) changed after approval' };
  for (const m of inboundSince) {
    const why = touches(m, draft);
    if (why) return { ok: false, status: 'pending', rule: '9.4', reason: `stale: ${why} since this draft was made`, conflict: m.id || null };
  }
  return { ok: true, hash: approval.hash };
}

module.exports = { draftHash, outboundObject, approve, checkAtCopy, touches };
