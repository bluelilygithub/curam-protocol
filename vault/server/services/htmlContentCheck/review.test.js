'use strict';
// node server/services/htmlContentCheck/review.test.js
// Where each request line and each unrequested change stands (rework R2): Needs attention, To approve, Approved; "was approved, now
// changed"; self-changing changes counted as Expected automatically; New this check; Ready to send.
const assert = require('node:assert/strict');
const { reviewState } = require('./review');

const items = [
  { ref: 'R1', kind: 'request_line', pageId: 1 },
  { ref: 'R2', kind: 'request_line', pageId: 1 },
  { ref: 'R3', kind: 'request_line', pageId: null },
  { ref: 'R4', kind: 'keep', pageId: 1 },
  { ref: 'R5', kind: 'held_over', pageId: 2 },
  { ref: 'R6', kind: 'request_line', pageId: 2 },
];
const changes1 = [
  { id: 'c1', fp: 'p1.aaa' }, // R1's edit
  { id: 'c2', fp: 'p1.bbb' }, // unrequested: an LLM's "helpful" rewording
  { id: 'c3', fp: 'p1.ccc', volatile: 'date' }, // a date that updates itself
];
const changes2 = [{ id: 'c1', fp: 'p2.ddd' }]; // R6's edit
const lines = [
  { ref: 'R1', status: 'linked', links: [{ pageId: 1, changeId: 'c1' }] },
  { ref: 'R2', status: 'noChange' },
  { ref: 'R3', status: 'notMatched' },
  { ref: 'R4', status: 'kept' },
  { ref: 'R5', status: 'held' },
  { ref: 'R6', status: 'linked', links: [{ pageId: 2, changeId: 'c1' }] },
];
const pages = (prev1 = null) => [{ pageId: 1, changes: changes1, prevFps: prev1 }, { pageId: 2, changes: changes2, prevFps: null }];
const where = (s) => Object.fromEntries(['attention', 'approve', 'approved'].map((k) => [k, s[k].map((x) => (x.type === 'line' ? x.ref : x.changeId + '@' + x.pageId))]));

// ---- nothing decided yet ----
let s = reviewState({ items, lines, pages: pages(), decisions: { lines: {}, changes: {} } });
assert.deepEqual(where(s), {
  attention: ['c2@1', 'R2', 'R3'], // the unrequested change first, then lines with no change / not matched
  approve: ['R1', 'R5', 'R6'], // R5 held: listed, not blocking
  approved: ['R4', 'c3@1'], // a kept Keep line; the date, Expected automatically
});
assert.equal(s.counts.autoExpected, 1);
assert.equal(s.counts.toApprove, 2, 'held-over lines do not block');
assert.equal(s.ready, false);
assert.equal(s.approve.find((x) => x.ref === 'R1').links[0].fp, 'p1.aaa', 'links carry fingerprints');

// ---- decided: everything clear -> ready ----
const decided = {
  lines: { R1: { status: 'approved', fps: ['p1.aaa'] }, R2: { status: 'approved', fps: null }, R3: { status: 'approved', fps: null }, R6: { status: 'approved', fps: ['p2.ddd'] } },
  changes: { '1|p1.bbb': { status: 'mine', note: 'Tidied the intro on purpose' } },
};
s = reviewState({ items, lines, pages: pages(), decisions: decided });
assert.deepEqual(s.attention, []);
assert.equal(s.ready, true);
assert.equal(s.approved.find((x) => x.changeId === 'c2').decision.status, 'mine');
assert.equal(s.approved.find((x) => x.changeId === 'c3').decision.auto, true);

// ---- was approved, now changed: R1's edit is different at the next check ----
const later = [{ id: 'c1', fp: 'p1.zzz' }, changes1[1], changes1[2]];
s = reviewState({
  items, decisions: decided,
  lines: lines.map((l) => (l.ref === 'R1' ? { ...l, links: [{ pageId: 1, changeId: 'c1' }] } : l)),
  pages: [{ pageId: 1, changes: later, prevFps: new Set(changes1.map((c) => c.fp)) }, { pageId: 2, changes: changes2, prevFps: null }],
});
const r1 = s.attention.find((x) => x.ref === 'R1');
assert.equal(r1.reason, 'changedSinceApproval');
assert.equal(r1.links[0].isNew, true, 'its change is new this check');
assert.equal(s.approved.find((x) => x.changeId === 'c2').isNew, false, 'an unchanged change is not new');
assert.equal(s.ready, false);

// ---- an approved line whose change disappeared ----
s = reviewState({ items, decisions: decided, lines: lines.map((l) => (l.ref === 'R1' ? { ref: 'R1', status: 'noChange' } : l)), pages: pages() });
assert.equal(s.attention.find((x) => x.ref === 'R1').reason, 'changedSinceApproval');

// ---- questions, and a self-changing change the person marked otherwise ----
s = reviewState({
  items, lines, pages: pages(),
  decisions: { lines: { R1: { status: 'question', note: 'Wrong year' } }, changes: { '1|p1.ccc': { status: 'question' }, '1|p1.bbb': { status: 'expected' } } },
});
assert.equal(s.attention.find((x) => x.ref === 'R1').reason, 'questioned');
assert.equal(s.attention.find((x) => x.changeId === 'c3').reason, 'questioned');
assert.equal(s.counts.autoExpected, 0);
assert.equal(s.approved.find((x) => x.changeId === 'c2').decision.auto, false);

// ---- a Keep line whose text changed needs attention ----
s = reviewState({ items, lines: lines.map((l) => (l.ref === 'R4' ? { ...l, status: 'keepChanged' } : l)), pages: pages(), decisions: { lines: {}, changes: {} } });
assert.equal(s.attention.find((x) => x.ref === 'R4').reason, 'keepChanged');

console.log('review.test.js: passed');
