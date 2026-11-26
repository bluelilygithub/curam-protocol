'use strict';
// node server/services/htmlContentCheck/splitRequest.test.js
// The splitter on small cases, and on the owner's real Dorothy Stoner request (fixtures/dorothy-request.txt) as a fixed test: where the
// "Under …" headings go, the held-over line, the Keep line, and the two "Passes away after a fall" lines flagged as likely duplicates.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { splitRequest, findDuplicates } = require('./splitRequest');

const texts = (s) => splitRequest(s).map((l) => l.lineText);
const cases = [
  ['empty', '', []],
  ['spaces only', '  \n \n', []],
  ['one line per line, no bullets or blank lines', 'Change the title to "Dorothy Stoner"\nRemove the 1998 exhibition\nFix the typo in the footer',
    ['Change the title to "Dorothy Stoner"', 'Remove the 1998 exhibition', 'Fix the typo in the footer']],
  ['dash bullets, with an intro line kept', 'Hi, please make these changes:\n- Change the heading\n- Remove the second paragraph',
    ['Hi, please make these changes:', 'Change the heading', 'Remove the second paragraph']],
  ['a wrapped bullet joins its continuation', '- Replace "born in 1921" with\n  "born in Melbourne in 1921"\n- Delete the caption',
    ['Replace "born in 1921" with "born in Melbourne in 1921"', 'Delete the caption']],
  ['numbered with dots and brackets', '1. First\n2) Second\n10. Tenth', ['First', 'Second', 'Tenth']],
  ['letters and roman numerals', 'a) one\n(b) two\niv. four', ['one', 'two', 'four']],
  ['unicode bullets', '• alpha\n· beta\n– gamma', ['alpha', 'beta', 'gamma']],
  ['wrapped email lines (a small letter) join the line before', 'Please change the opening line to read\nas below.\n\nAlso remove the old phone number\nfrom the footer.',
    ['Please change the opening line to read as below.', 'Also remove the old phone number from the footer.']],
  ['without bullets, lines in one paragraph stay apart', 'Remove the 1998 show\nAdd the 2024 award\n\nFix the footer', ['Remove the 1998 show', 'Add the 2024 award', 'Fix the footer']],
  ['a blank line ends a bullet: the next plain line is its own', '- One\n\nSign-off text', ['One', 'Sign-off text']],
  ['Windows line endings', '- One\r\n- Two\r\n', ['One', 'Two']],
  ['a hyphenated word is not a bullet', 'Re-word the intro\nAdd a link', ['Re-word the intro', 'Add a link']],
  ['"e.g." is not a letter bullet', 'e.g. the footer\nNext', ['e.g. the footer', 'Next']],
  ['runs of spaces collapse', '-   lots    of   space  ', ['lots of space']],
  ['"Change to:" and "Insert:" start a line even after a bullet', '- Add the photo\nChange to: Moon Over Backyard\nInsert: a caption',
    ['Add the photo', 'Change to: Moon Over Backyard', 'Insert: a caption']],
  ['an "Under" sentence with a comma is a request line', 'Under the photo, change the caption to "Studio, 1950"', ['Under the photo, change the caption to "Studio, 1950"']],
];
for (const [name, input, want] of cases) assert.deepEqual(texts(input), want, name);
assert.deepEqual(splitRequest(null), []);

// labels and kinds on small cases
let s = splitRequest('Under Events\n- Add the 2027 launch\nKeep: the gallery hours\n- Something (held over)');
assert.deepEqual(s.map((l) => [l.kind, l.section]), [['request_line', 'Events'], ['keep', 'Events'], ['held_over', 'Events']], 'labels work with bullets too');
assert.equal(s[1].lineText, 'the gallery hours', '"Keep:" is taken off');
s = splitRequest('Under About:\nPortrait of the artist\nInsert: a new caption\n\nRemove the old one');
assert.deepEqual(s.map((l) => l.section), ['About › Portrait of the artist', 'About'], 'a sub-label lasts until the blank line');

// ---- the owner's real request ----
const real = splitRequest(fs.readFileSync(path.join(__dirname, 'fixtures', 'dorothy-request.txt'), 'utf8'));
const show = real.map((l, i) => `R${i + 1} ${l.kind} [${l.section || ''}] ${l.lineText.slice(0, 40)}`);
assert.equal(real.length, 18, show.join('\n'));
assert.ok(!real.some((l) => /^Under /i.test(l.lineText)), 'no "Under …" heading is a request line');
assert.deepEqual([...new Set(real.map((l) => l.section))],
  [null, 'The Artist', 'life milestones', 'Plates and Passages › Portrait of Dorothy Stoner', "image of Dorothy Stoner's Easel", 'Read a Chapter', 'Events'],
  'the headings label the lines beneath them');
assert.equal(real[0].section, null, 'the photo line before any heading has no label');
assert.ok(real[0].lineText.startsWith('emove photo of George Davis'), 'the first line is kept as pasted');
assert.equal(real.filter((l) => l.section === 'The Artist').length, 3);
assert.equal(real.filter((l) => l.section === 'life milestones').length, 6);
const keep = real.filter((l) => l.kind === 'keep');
assert.equal(keep.length, 1);
assert.ok(keep[0].lineText.startsWith('George established himself early in his career'), 'the Keep line, without "Keep:"');
assert.equal(keep[0].section, 'Plates and Passages › Portrait of Dorothy Stoner', 'the plate title is a sub-label, not a request line');
const held = real.filter((l) => l.kind === 'held_over');
assert.equal(held.length, 1);
assert.ok(held[0].lineText.startsWith('I will have to think about this a bit more'));
assert.equal(held[0].section, 'Read a Chapter');
assert.ok(real.some((l) => l.lineText === 'Come and see her work' && l.section === 'Events'), 'new content to insert stays a request line');
const dupes = findDuplicates(real.map((l) => l.lineText));
assert.deepEqual(dupes, { 8: 7 }, 'R9 "Passes away after a fall - leaves …" repeats R8');
assert.ok(real[7].lineText.startsWith("1992 - Remove 'Dies'") && real[8].lineText.startsWith('Passes away after a fall'));

assert.deepEqual(findDuplicates(['Fix the footer', 'Fix the footer link']), {}, 'too short to call a repeat');
console.log(`splitRequest: ${cases.length + 3} cases and the Dorothy Stoner request passed`);
