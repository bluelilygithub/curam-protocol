'use strict';
// node server/services/htmlContentCheck/splitRequest.test.js
const assert = require('node:assert/strict');
const { splitRequest } = require('./splitRequest');

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
  ['paragraphs separated by blank lines stay whole', 'Please change the opening line to read\nas below.\n\nAlso remove the old phone number\nfrom the footer.',
    ['Please change the opening line to read as below.', 'Also remove the old phone number from the footer.']],
  ['a blank line ends a bullet: the next plain line is its own', '- One\n\nSign-off text', ['One', 'Sign-off text']],
  ['Windows line endings', '- One\r\n- Two\r\n', ['One', 'Two']],
  ['a hyphenated word is not a bullet', 'Re-word the intro\nAdd a link', ['Re-word the intro', 'Add a link']],
  ['"e.g." is not a letter bullet', 'e.g. the footer\nNext', ['e.g. the footer', 'Next']],
  ['runs of spaces collapse', '-   lots    of   space  ', ['lots of space']],
];

let n = 0;
for (const [name, input, want] of cases) {
  assert.deepEqual(splitRequest(input), want, name);
  n++;
}
assert.deepEqual(splitRequest(null), []);
console.log(`splitRequest: ${n + 1} cases passed`);
