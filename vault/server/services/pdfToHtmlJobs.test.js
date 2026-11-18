'use strict';

// node server/services/pdfToHtmlJobs.test.js   (no database: the progress maths only; the job flow is checked in a browser against the
// local database, see docs/pdf-agent.md)

const assert = require('assert');
const { expectedChars, writingProgress, partialFrom } = require('./pdfToHtmlJobs');

// the bar: 12% when writing starts, never past 95% until the job finishes
assert.strictEqual(writingProgress(0, 50000), 12);
assert.strictEqual(writingProgress(25000, 50000), 54);
assert.strictEqual(writingProgress(500000, 50000), 95, 'a longer page than expected waits at 95%');

// the expected length: grows with slices and pictures, within sensible bounds; a change request expects about the current page
assert.strictEqual(expectedChars({ slices: 1, images: 0 }), 12000);
assert.strictEqual(expectedChars({ slices: 8, images: 31 }), 8 * 7000 + 31 * 200);
assert.strictEqual(expectedChars({ slices: 14, images: 500 }), 110000);
assert.strictEqual(expectedChars({ currentHtml: 'x'.repeat(40000) }), 40000);
assert.strictEqual(expectedChars({ currentHtml: 'x' }), 8000);

// the growing preview starts at the HTML, not at any words before it
assert.strictEqual(partialFrom('Here is the page:\n```html\n<!DOCTYPE html><html><body><h1>Hi'), '<!DOCTYPE html><html><body><h1>Hi');
assert.strictEqual(partialFrom('Thinking about it'), '');
assert.strictEqual(partialFrom('<html lang="en"><body>x</body></html>\n```'), '<html lang="en"><body>x</body></html>\n');

console.log('pdfToHtmlJobs tests passed');
