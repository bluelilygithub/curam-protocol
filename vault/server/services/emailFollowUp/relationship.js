'use strict';

// Who a case is with, and what that changes. Pure: every input, including "now", is passed in.
//
//  - Matters the tool will not read (health, mortgage, legal dispute) are refused for good, and a case is only opened once the person
//    has confirmed its mail may be sent to the AI to be read (a per-case decision, kept as ef_cases."aiConsentAt").
//  - The relationship (professional, service provider, personal) changes the wording of a follow-up draft and how soon a second chase on
//    the same row is flagged. It never changes what the draft is checked against: every sentence still quotes the source.
//  - Something said outside email (a call, a text, in person) is typed in by the person and becomes a source like a message, so a row
//    built from it still quotes it word for word.

const { RuleError } = require('./common');

// [value, label]. The blocked kinds below are never offered; the server refuses them if they are sent.
const KINDS = [
  ['accounting', 'Accounting: chasing documents for BAS, tax or year end'],
  ['freelance', 'Freelance: scope and deliverables'],
  ['job-search', 'Job search'],
  ['home', 'Home: landlord, agent, strata, repairs'],
  ['trades', 'Quotes and tradies: quote, start date, warranty'],
  ['government', 'Council or government: applications, call-backs'],
  ['insurance', 'Insurance or warranty claim'],
  ['purchase', 'Purchase or return: refund, replacement, delivery'],
  ['school-club', 'School, club or committee'],
  ['personal', 'Friend, family or neighbour (something borrowed, promised or arranged)'],
  ['other', 'Something else'],
];
const BLOCKED_KINDS = {
  health: 'Health and medical matters',
  mortgage: 'Mortgages and loan applications',
  legal: 'Legal disputes',
};
const BLOCKED_WORDS = 'health or medical matters, mortgages or loan applications, or legal disputes';

const RELATIONSHIPS = ['professional', 'service', 'personal'];
const RELATIONSHIP_LABELS = {
  professional: 'Professional: a client, supplier or employer',
  service: 'Service provider: a tradie, landlord, council, shop or insurer',
  personal: 'Personal: a friend, family, neighbour or club',
};
// Days after an approved chase on a row before another is flagged for a second look
const GAP_DAYS = { professional: 0, service: 3, personal: 7 };

/** A case may only be opened for an allowed kind, with the person's say-so that its mail may go to the AI. */
function checkNewCase(input) {
  const kind = String(input.kind || 'other');
  if (Object.prototype.hasOwnProperty.call(BLOCKED_KINDS, kind)) {
    throw new RuleError('privacy', `${BLOCKED_KINDS[kind]} are never read by this tool, because the emails would be sent to the AI. Keep these in your mailbox.`);
  }
  if (input.aiConsent !== true) {
    throw new RuleError('privacy', `tick the box to confirm this case is not about ${BLOCKED_WORDS}, and that its emails may be sent to the AI to be read`);
  }
  const relationship = RELATIONSHIPS.includes(input.relationship) ? input.relationship : 'professional';
  return { kind, relationship };
}

/** The courtesy lines of a draft. The default (professional) wording is the wording the tool always used. */
function courtesyFor(relationship, direction) {
  const rel = RELATIONSHIPS.includes(relationship) ? relationship : 'professional';
  if (direction === 'i_owe') {
    if (rel === 'personal') return 'I will let you know as soon as this is done. Thanks for your patience.';
    return 'I will confirm once this is done. Thank you.';
  }
  if (rel === 'personal') return 'No rush, I just wanted to check in. Could you let me know where this is up to when you get a chance? Thanks so much.';
  if (rel === 'service') return 'Could you let me know where this stands and when I can expect it? Thank you.';
  return 'Could you let me know where this stands? Thank you.';
}

/**
 * A second look when the same row was already chased (a draft approved) too recently for this kind of relationship.
 * `drafts` are ef_drafts rows ({ rowId, status, updatedAt }). Returns a sentence or null.
 */
function recentChaseNote(relationship, drafts, rowId, now) {
  const days = GAP_DAYS[RELATIONSHIPS.includes(relationship) ? relationship : 'professional'];
  if (!days) return null;
  const nowMs = new Date(now).getTime();
  const last = (drafts || [])
    .filter((d) => d.rowId === rowId && d.status === 'approved' && d.updatedAt)
    .map((d) => new Date(d.updatedAt).getTime())
    .filter((t) => Number.isFinite(t) && t <= nowMs)
    .sort((a, b) => b - a)[0];
  if (last === undefined) return null;
  const ago = Math.floor((nowMs - last) / 86400000);
  if (ago >= days) return null;
  const when = ago === 0 ? 'today' : ago === 1 ? 'yesterday' : `${ago} days ago`;
  return `You approved a follow-up for this ${when}. For this kind of case, wait about ${days} days before chasing again so it does not feel pushy. Check you really want to send another.`;
}

// ---- something said outside email ----

const HOW = {
  phone: { label: 'Phone call', on: 'On the phone' },
  text: { label: 'Text message', on: 'In a text' },
  person: { label: 'In person', on: 'When we spoke' },
  other: { label: 'Other', on: 'When we spoke' },
};
const MAX_LOGGED_CHARS = 4000;
const MAX_LOGGED_PER_CASE = 50;

/**
 * Check what the person typed and turn it into the fields of a source. `who` is the other person's name; `saidBy` is 'them' or 'me'.
 * A note from me is stored as sent by the mailbox owner, one from them as received, so the ledger works out who owes what exactly as it
 * does for email.
 */
function loggedSource(input, { ownerEmail, now }) {
  const how = HOW[input.how] ? input.how : null;
  if (!how) throw new RuleError('log', 'choose how it was said (phone call, text, in person or other)');
  const who = String(input.who || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!who) throw new RuleError('log', 'say who it was with');
  const text = String(input.text || '').replace(/\r\n/g, '\n').trim();
  if (text.length < 5) throw new RuleError('log', 'type what was said or agreed');
  if (text.length > MAX_LOGGED_CHARS) throw new RuleError('log', `keep it under ${MAX_LOGGED_CHARS} characters`);
  const saidBy = input.saidBy === 'me' ? 'me' : 'them';
  const when = input.when ? new Date(input.when) : new Date(now);
  if (!Number.isFinite(when.getTime())) throw new RuleError('log', 'that date is not valid');
  if (when.getTime() > new Date(now).getTime() + 86400000) throw new RuleError('log', 'the date cannot be in the future');
  return {
    kind: 'logged',
    channel: saidBy === 'me' ? 'sent' : 'inbound',
    subject: `${HOW[how].label} with ${who}`,
    fromAddr: saidBy === 'me' ? (ownerEmail || 'me') : who,
    toAddr: saidBy === 'me' ? who : (ownerEmail || 'me'),
    receivedAt: when.toISOString(),
    text,
    how,
    parseStatus: 'parsed',
  };
}

function guessHow(source) {
  const s = String((source && source.subject) || '');
  if (/^phone call/i.test(s)) return 'phone';
  if (/^text message/i.test(s)) return 'text';
  if (/^in person/i.test(s)) return 'person';
  return 'other';
}

/** How a draft refers to something said outside email: "On the phone you said: ..." */
function sayingLeadIn(source, direction) {
  const how = (source && source.how) || guessHow(source);
  const on = (HOW[how] || HOW.other).on;
  return direction === 'i_owe' ? `${on} I said` : `${on} you said`;
}

module.exports = {
  KINDS, BLOCKED_KINDS, BLOCKED_WORDS, RELATIONSHIPS, RELATIONSHIP_LABELS, GAP_DAYS, HOW, MAX_LOGGED_PER_CASE,
  checkNewCase, courtesyFor, recentChaseNote, loggedSource, sayingLeadIn,
};
