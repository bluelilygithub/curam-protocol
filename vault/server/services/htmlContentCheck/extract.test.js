'use strict';
// node server/services/htmlContentCheck/extract.test.js
// The snapshot from the full-mode reader: menus, banners, captions, sidebars and footers are kept (edits there must survive), only
// what a browser never shows is dropped; ids, section paths, absolute addresses; normalisation for comparing; the size cap fails.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { buildSnapshot, normalizeText } = require('./extract');
const { MAX_SNAPSHOT_CHARS } = require('./config');

const fixture = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');
const snap = (html, finalUrl = 'https://gallery.example/artists/dorothy-stoner') => buildSnapshot(html, { finalUrl, fetchedVia: 'plain' });
const texts = (s) => s.blocks.map((b) => b.text);

// ---- what is kept and what is dropped ----
const before = snap(fixture('artist-before.html'));
const after = snap(fixture('artist-after.html'));
const t = texts(before.snapshot);
for (const kept of ['Australian art since 1970', 'Exhibitions', 'We use cookies to improve this site.', 'Dorothy Stoner in her studio, about 1950',
  'Related artists', 'Grace Cossington Smith, Margaret Preston', 'Phone 03 9000 0000 · Open Tuesday to Sunday', '© 2024 Example Gallery']) {
  assert.ok(t.includes(kept), `kept: ${kept}`);
}
for (const dropped of ['Sign up to our newsletter!', 'Hidden promotion text', 'Please turn on JavaScript.', 'Template text never shown', 'window.tracking = true;']) {
  assert.ok(!t.some((x) => x.includes(dropped)), `dropped: ${dropped}`);
}
// the edits the developer made in the menu, the heading, a caption, a list, the sidebar and the footer all show in the later snapshot
const ta = texts(after.snapshot);
for (const edited of ['Past exhibitions', 'Dorothy Stoner (1921–2008)', 'Dorothy Stoner in her Fitzroy studio, about 1952', 'Grace Cossington Smith, Margaret Preston, Clarice Beckett',
  'Phone 03 9000 1111 · Open Wednesday to Sunday', '© 2025 Example Gallery']) {
  assert.ok(ta.includes(edited) && !t.includes(edited), `the edit survives: ${edited}`);
}
assert.ok(!ta.includes('1998: Retrospective, Example Gallery'), 'the removed exhibition is gone');

// ---- shape ----
const s = before.snapshot;
assert.equal(s.v, 1);
assert.deepEqual(s.blocks.map((b) => b.id), s.blocks.map((_, i) => `b${i + 1}`), 'ids b1, b2 ... in reading order');
assert.equal(s.meta.title, 'Dorothy Stoner | Example Gallery');
assert.equal(s.meta.finalUrl, 'https://gallery.example/artists/dorothy-stoner');
assert.equal(s.meta.pageUrl, 'https://gallery.example/artists/dorothy-stoner', 'the canonical address');
assert.equal(s.meta.fetchedVia, 'plain');
assert.equal(s.meta.chars, s.blocks.filter((b) => b.type !== 'image').reduce((n, b) => n + b.text.length, 0));
const img = s.blocks.find((b) => b.type === 'image');
assert.equal(img.text, 'Portrait of Dorothy Stoner');
assert.equal(img.src, 'https://gallery.example/images/stoner-portrait.jpg', 'image address made absolute');
const exh = s.blocks.find((b) => b.text === '2004: Still Life, City Gallery');
assert.equal(exh.type, 'listItem');
assert.deepEqual(exh.section, ['Dorothy Stoner', 'Exhibitions'], 'section path');
assert.deepEqual(s.blocks.find((b) => b.text === 'Collections').section, ['Dorothy Stoner', 'Exhibitions', 'Collections']);
assert.deepEqual(s.blocks.find((b) => b.text === 'Related artists').section, ['Dorothy Stoner', 'Related artists'], 'a heading resets deeper levels');
assert.deepEqual(s.blocks.find((b) => b.text === 'National Gallery of Victoria').table, { t: 0, r: 1, c: 0 });
const essay = s.blocks.find((b) => b.text === 'Read the essay by Jane Citizen.');
assert.ok(essay.runs.some((r) => r.link === 'https://gallery.example/essays/stoner'), 'links kept in runs, absolute');
assert.ok(essay.runs.some((r) => r.bold && r.text === 'Jane Citizen'));
assert.equal(s.blocks.find((b) => b.text.startsWith('Dorothy Stoner was born')).runs, undefined, 'plain text keeps no runs');
assert.equal(before.thin, false);

// ---- a relative address with nowhere to resolve it, and a data: picture, are not kept as addresses ----
const odd = snap('<p>Some words here to read for this little test page, enough of them.</p><img src="data:image/png;base64,AAAA" alt="d"><img src="rel.png" alt="r">', null);
assert.deepEqual(odd.snapshot.blocks.filter((b) => b.type === 'image').map((b) => b.src), [undefined, undefined]);

// ---- almost no text ----
assert.equal(snap('<html><body><div id="app"></div><script>render()</script></body></html>').thin, true);

// ---- normalisation for comparing: the original is stored, only comparisons are evened out ----
assert.equal(normalizeText('Dorothy Stoner'), 'Dorothy Stoner', 'non-breaking space');
assert.equal(normalizeText('retro­spective'), 'retrospective', 'soft hyphen');
assert.equal(normalizeText('“Still Life” and Stoner’s'), '"Still Life" and Stoner\'s', 'curly quotes');
assert.equal(normalizeText('  a \n\t b  '), 'a b', 'runs of whitespace');
assert.equal(normalizeText('zero​width'), 'zerowidth');
assert.notEqual(normalizeText('Dorothy stoner'), normalizeText('Dorothy Stoner'), 'case is a real change');
assert.notEqual(normalizeText('1921–2008'), normalizeText('1921-2008'), 'a dash is a real change');
const nb = snap('<p>Dorothy&nbsp;Stoner &amp; friends, with enough words to count as a readable page for this test of entities.</p>', null);
assert.equal(nb.snapshot.blocks[0].text, 'Dorothy Stoner & friends, with enough words to count as a readable page for this test of entities.', 'entities decoded, the original kept for display');

// ---- the size cap fails, never cuts ----
const big = `<html><body>${Array.from({ length: Math.ceil(MAX_SNAPSHOT_CHARS / 9000) + 1 }, () => `<p>${'abcdefgh '.repeat(1000)}</p>`).join('')}</body></html>`; // just over the cap
assert.throws(() => snap(big), (err) => err.code === 'TOO_BIG' && err.isPublic && /Nothing was cut/.test(err.message));
const under = `<html><body>${Array.from({ length: 50 }, () => `<p>${'abcdefgh '.repeat(1000)}</p>`).join('')}</body></html>`;
assert.ok(snap(under).snapshot.meta.chars < MAX_SNAPSHOT_CHARS, 'a large page under the cap is kept whole');

console.log(`extract.test.js: passed (Node ${process.version})`);
