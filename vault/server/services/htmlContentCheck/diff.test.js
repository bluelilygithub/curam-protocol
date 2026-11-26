'use strict';
// node server/services/htmlContentCheck/diff.test.js
// The diff on fixtures: added, removed, changed, moved; case and dash changes reported; whitespace-only changes ignored; stable change
// ids; pictures, links and a heading that was a paragraph; and which changes are marked as content changing by itself.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { diffSnapshots, goneTexts } = require('./diff');
const { buildSnapshot } = require('./extract');

const snapOf = (html) => buildSnapshot(html, { finalUrl: 'https://gallery.example/a', fetchedVia: 'plain' }).snapshot;
const page = (body) => snapOf(`<html><body>${body}</body></html>`);
const fixture = (n) => snapOf(fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8'));
const summary = (d) => d.changes.map((c) => `${c.id} ${c.type}${c.volatile ? `/${c.volatile}` : ''}: ${(c.before || c.after).text}${c.type === 'changed' ? ` -> ${c.after.text}` : ''}`);
const P = (t) => `<p>${t}</p>`;
const FILLER = ['Dorothy Stoner was born in Melbourne in 1921.', 'She studied at the National Gallery School.', 'Her still lifes are held in public collections.', 'She taught for many years.'];

// ---- the artist page before and after the developer's edits ----
let d = diffSnapshots(fixture('artist-before.html'), fixture('artist-after.html'));
assert.deepEqual(summary(d), [
  'c1 changed: Exhibitions -> Past exhibitions',
  'c2 changed: Dorothy Stoner -> Dorothy Stoner (1921–2008)',
  'c3 changed: Dorothy Stoner in her studio, about 1950 -> Dorothy Stoner in her Fitzroy studio, about 1952',
  'c4 removed: 1998: Retrospective, Example Gallery',
  'c5 changed: Grace Cossington Smith, Margaret Preston -> Grace Cossington Smith, Margaret Preston, Clarice Beckett',
  'c6 changed: Phone 03 9000 0000 · Open Tuesday to Sunday -> Phone 03 9000 1111 · Open Wednesday to Sunday',
  'c7 changed/date: © 2024 Example Gallery -> © 2025 Example Gallery',
]);
assert.deepEqual(d.stats, { added: 0, removed: 1, changed: 6, moved: 0, volatile: 1, total: 7 });
const c3 = d.changes[2];
assert.deepEqual(c3.words.filter((w) => w.op !== '='), [{ op: '+', text: 'Fitzroy ' }, { op: '-', text: '1950' }, { op: '+', text: '1952' }], 'a word diff of the original text');
assert.deepEqual(c3.before.section, ['Dorothy Stoner']);
assert.equal(c3.before.blockId, 'b9'); assert.equal(c3.after.blockId, 'b9');
assert.deepEqual(diffSnapshots(fixture('artist-before.html'), fixture('artist-after.html')), d, 'the same two snapshots give the same changes and ids');
assert.deepEqual(diffSnapshots(fixture('artist-before.html'), fixture('artist-before.html')).changes, [], 'an unchanged page has no changes');

// ---- added, removed, moved ----
d = diffSnapshots(page(FILLER.map(P).join('')), page([FILLER[0], 'A new paragraph about her prizes.', FILLER[1], FILLER[2], FILLER[3]].map(P).join('')));
assert.deepEqual(summary(d), ['c1 added: A new paragraph about her prizes.']);
d = diffSnapshots(page(FILLER.map(P).join('')), page([FILLER[0], FILLER[2], FILLER[3]].map(P).join('')));
assert.deepEqual(summary(d), ['c1 removed: She studied at the National Gallery School.']);
d = diffSnapshots(page(FILLER.map(P).join('')), page([FILLER[1], FILLER[2], FILLER[3], FILLER[0]].map(P).join('')));
assert.deepEqual(summary(d), ['c1 moved: Dorothy Stoner was born in Melbourne in 1921.'], 'a moved block is one change');
assert.equal(d.changes[0].after.blockId, 'b4');

// ---- what counts as a change ----
const one = (a, b) => diffSnapshots(page(P(a) + P(FILLER[1])), page(P(b) + P(FILLER[1])));
assert.equal(one('Dorothy Stoner', 'Dorothy stoner').changes.length, 1, 'case is a change');
assert.equal(one('1921-2008', '1921–2008').changes.length, 1, 'a dash is a change');
assert.equal(one('Dorothy Stoner', 'Dorothy&nbsp;Stoner').changes.length, 0, 'a non-breaking space is not');
assert.equal(one('Dorothy   Stoner', 'Dorothy\n Stoner').changes.length, 0, 'whitespace is not');
assert.equal(one('Stoner’s still lifes', "Stoner's still lifes").changes.length, 0, 'curly against straight quotes is not');
assert.equal(one('retro&shy;spective', 'retrospective').changes.length, 0, 'a soft hyphen is not');
d = one('Read the <a href="/essay">essay</a>', 'Read the <a href="/essay-2">essay</a>');
assert.equal(d.changes[0].type, 'changed', 'a link address change');
assert.deepEqual(d.changes[0].links, { before: ['https://gallery.example/essay'], after: ['https://gallery.example/essay-2'] });
d = diffSnapshots(page('<p>Exhibitions and shows</p>' + P(FILLER[1])), page('<h2>Exhibitions and shows</h2>' + P(FILLER[1])));
assert.equal(d.changes[0].type, 'changed'); assert.equal(d.changes[0].kindChanged, true, 'a paragraph that became a heading');
d = diffSnapshots(page('<img src="/a.jpg" alt="Portrait">' + P(FILLER[1])), page('<img src="/b.jpg" alt="Portrait">' + P(FILLER[1])));
assert.equal(d.changes[0].type, 'changed', 'a new picture address with the same alt text');
assert.equal(d.changes[0].after.src, 'https://gallery.example/b.jpg');

// ---- content that changes by itself is marked, real edits are not ----
const vol = (a, b) => one(a, b).changes[0]?.volatile || null;
assert.equal(vol('We use cookies to improve this site.', 'We use cookies to give you the best experience.'), 'cookie');
assert.equal(vol('Updated 3 hours ago', 'Updated 5 hours ago'), 'date');
assert.equal(vol('Last updated 24 November 2026', 'Last updated 26 November 2026'), 'date');
assert.equal(vol('Sale ends 10:42', 'Sale ends 10:57'), 'date');
assert.equal(vol('1,204 members', '1,231 members'), 'counter');
assert.equal(vol('© 2024 Example Gallery', '© 2025 Example Gallery'), 'date', 'a copyright year');
assert.equal(vol('Open Tuesday to Sunday', 'Open Wednesday to Sunday'), null, 'a changed opening day is an edit');
assert.equal(vol('Phone 03 9000 0000', 'Phone 03 9000 1111'), null, 'a new phone number is an edit');
assert.equal(vol('Prints from $49', 'Prints from $59'), null, 'a new price is an edit');
assert.equal(vol('45,725,780 results', '45,725,774 results'), 'counter');
assert.equal(vol('Dorothy Stoner was born in Melbourne in 1921 and studied painting.', 'Dorothy Stoner was born in Melbourne in 1922 and studied painting.'), null, 'a year inside a sentence is an edit');
assert.equal(vol('Founded in 1970', 'Founded in 1971'), null, 'a year without a copyright sign is an edit');
assert.equal(vol('Plenty of words about her life and her work here', 'Plenty of words about her life and her paintings here'), null);
// rotating: wording that left the page in an earlier round and came back
const r0 = page(P('Featured: Still Life, 1950') + P(FILLER[1]));
const r1 = page(P('Featured: Interior with Chair') + P(FILLER[1]));
const r2 = page(P('Featured: Still Life, 1950') + P(FILLER[1]));
const d1 = diffSnapshots(r0, r1);
assert.equal(d1.changes[0].volatile, undefined, 'the first change is not yet known to rotate');
const d2 = diffSnapshots(r1, r2, { goneTexts: goneTexts(d1) });
assert.equal(d2.changes[0].volatile, 'rotating', 'it came back');
assert.equal(diffSnapshots(r1, page(P('Featured: Garden Path') + P(FILLER[1])), { goneTexts: goneTexts(d1) }).changes[0].volatile, undefined, 'new wording is not rotating');

console.log('diff.test.js: passed');
