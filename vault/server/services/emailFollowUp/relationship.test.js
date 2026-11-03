'use strict';
// node server/services/emailFollowUp/relationship.test.js   (no database, no model)
const assert = require('assert');
const r = require('./relationship');

// blocked matters are refused for good, even with consent
for (const kind of ['health', 'mortgage', 'legal']) {
  assert.throws(() => r.checkNewCase({ kind, aiConsent: true }), /never read by this tool/);
}
// consent is needed, and only an explicit true counts
assert.throws(() => r.checkNewCase({ kind: 'trades' }), /tick the box/);
assert.throws(() => r.checkNewCase({ kind: 'trades', aiConsent: 'yes' }), /tick the box/);
assert.deepStrictEqual(r.checkNewCase({ kind: 'trades', aiConsent: true }), { kind: 'trades', relationship: 'professional' });
assert.strictEqual(r.checkNewCase({ kind: 'personal', aiConsent: true, relationship: 'personal' }).relationship, 'personal');
assert.strictEqual(r.checkNewCase({ kind: 'personal', aiConsent: true, relationship: 'enemy' }).relationship, 'professional', 'unknown value falls back');
assert.ok(r.KINDS.every(([v]) => !r.BLOCKED_KINDS[v]), 'no blocked kind is offered as a choice');

// default wording is exactly what the tool always said
assert.strictEqual(r.courtesyFor('professional', 'they_owe'), 'Could you let me know where this stands? Thank you.');
assert.strictEqual(r.courtesyFor(undefined, 'i_owe'), 'I will confirm once this is done. Thank you.');
// personal is gentler and never names a consequence; service asks for a date
assert.match(r.courtesyFor('personal', 'they_owe'), /No rush/);
assert.match(r.courtesyFor('service', 'they_owe'), /when I can expect it/);
for (const rel of r.RELATIONSHIPS) {
  for (const dir of ['they_owe', 'i_owe']) {
    assert.doesNotMatch(r.courtesyFor(rel, dir), /consequence|otherwise|legal|final notice|urgent/i);
  }
}

// a second chase too soon is flagged for personal and service cases only
const now = '2026-11-10T00:00:00Z';
const drafts = [{ rowId: 'r1', status: 'approved', updatedAt: '2026-11-08T00:00:00Z' }, { rowId: 'r2', status: 'pending', updatedAt: '2026-11-09T00:00:00Z' }];
assert.strictEqual(r.recentChaseNote('professional', drafts, 'r1', now), null);
assert.match(r.recentChaseNote('personal', drafts, 'r1', now), /2 days ago/);
assert.match(r.recentChaseNote('service', drafts, 'r1', now), /wait about 3 days/);
assert.strictEqual(r.recentChaseNote('personal', drafts, 'r2', now), null, 'a draft not approved is not a chase');
assert.strictEqual(r.recentChaseNote('personal', drafts, 'r1', '2026-11-20T00:00:00Z'), null, 'long enough ago');
assert.strictEqual(r.recentChaseNote('personal', [], 'r1', now), null);

// something said outside email becomes a source the ledger can read like a message
const ctx = { ownerEmail: 'me@x.com', now };
const a = r.loggedSource({ how: 'phone', who: ' Dave ', saidBy: 'them', text: 'I will fix the hot water by Friday.', when: '2026-11-09' }, ctx);
assert.strictEqual(a.kind, 'logged');
assert.strictEqual(a.channel, 'inbound');
assert.strictEqual(a.fromAddr, 'Dave');
assert.strictEqual(a.subject, 'Phone call with Dave');
const b = r.loggedSource({ how: 'person', who: 'Dave', saidBy: 'me', text: 'I said I would send the photos tomorrow.' }, ctx);
assert.strictEqual(b.channel, 'sent');
assert.strictEqual(b.fromAddr, 'me@x.com');
assert.strictEqual(b.toAddr, 'Dave');
assert.throws(() => r.loggedSource({ how: 'fax', who: 'D', text: 'something said' }, ctx), /choose how/);
assert.throws(() => r.loggedSource({ how: 'phone', who: '', text: 'something said' }, ctx), /who it was with/);
assert.throws(() => r.loggedSource({ how: 'phone', who: 'D', text: 'hi' }, ctx), /what was said/);
assert.throws(() => r.loggedSource({ how: 'phone', who: 'D', text: 'x'.repeat(4001) }, ctx), /under 4000/);
assert.throws(() => r.loggedSource({ how: 'phone', who: 'D', text: 'something said', when: '2027-01-01' }, ctx), /future/);
assert.throws(() => r.loggedSource({ how: 'phone', who: 'D', text: 'something said', when: 'nonsense' }, ctx), /not valid/);

// how a draft refers to it
assert.strictEqual(r.sayingLeadIn({ subject: 'Phone call with Dave' }, 'they_owe'), 'On the phone you said');
assert.strictEqual(r.sayingLeadIn({ subject: 'Text message with Dave' }, 'i_owe'), 'In a text I said');
assert.strictEqual(r.sayingLeadIn({ subject: 'In person with Dave' }, 'they_owe'), 'When we spoke you said');


// a draft built from something said by phone says so, passes the same guard as a draft from an email, and never says "you wrote"
{
  const { buildNudgeDraft } = require('./draft');
  const { checkDraft } = require('./guard');
  const { spanHash } = require('./common');
  const logged = r.loggedSource({ how: 'phone', who: 'Dave', saidBy: 'them', text: 'Dave: I will fix the hot water by Friday 14 November.', when: '2026-11-03' }, ctx);
  const source = { id: 7, ...logged };
  const quote = 'I will fix the hot water by Friday 14 November.';
  const start = source.text.indexOf(quote);
  const row = {
    id: 'r1', party: 'Dave', partyLabel: 'Dave', direction: 'they_owe', items: ['fix the hot water'], quote,
    anchors: [{ sourceId: 7, versionHash: 'v1', locator: { start, end: start + quote.length }, spanHash: spanHash(quote) }],
    due: { status: 'unknown' }, status: 'open', requestDate: '2026-11-03T00:00:00Z',
  };
  for (const relationship of r.RELATIONSHIPS) {
    const d = buildNudgeDraft(row, { relationship, anchorSource: source, to: [] });
    assert.match(d.body, /On the phone you said: "I will fix the hot water by Friday 14 November\."/);
    assert.doesNotMatch(d.body, /You wrote/);
    const v = checkDraft({ ...d, id: null, version: 1 }, { sources: { 7: { id: 7, versionHash: 'v1', supersededBy: null, parseStatus: 'parsed', text: source.text } }, profile: 'soft', row, notes: [] });
    assert.strictEqual(v.verdict, 'pass', `${relationship}: the guard passes a draft built from a phone call`);
  }
  // an ordinary email row keeps its old wording
  const plain = buildNudgeDraft(row, { to: [], anchorSource: { kind: 'message' } });
  assert.match(plain.body, /You wrote: "/);
}

console.log('relationship tests passed');
