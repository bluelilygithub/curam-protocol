// node client/src/pages/translate/reviewDocx.test.mjs   (no npm script on purpose: it would change package.json)
// Builds the review document, zips it, and reads it back with mammoth (the Word reader the server already uses for uploads):
// if mammoth can read the text back, Word can open the file. Also checks macrons survive and odd characters are escaped.
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { reviewDocxParts, reviewFileName } from './reviewDocx.mjs';

const require = createRequire(import.meta.url);
const JSZip = require('jszip');
const mammoth = require('mammoth');

const data = {
  setName: 'Corporate vision statements', languageLabel: 'te reo Māori', model: 'test-model', date: new Date(2026, 10, 17),
  comment: 'Elevated ōkawa register. Keep Taumata as written & use te rōpū Taumata <always>.',
  results: [
    { originalLabel: 'English', original: 'For Taumata to be the leading partner.\nSecond line.', approved: 'Kia matua te tū a te rōpū Taumata.', got: 'He rerekē tēnei.' },
    { originalLabel: 'English', original: 'We value our people.', approved: 'E whakamana ana mātou.', error: 'timed out' },
  ],
};
const parts = reviewDocxParts(data);
for (const [name, xml] of Object.entries(parts)) assert.ok(xml.startsWith('<?xml'), `${name} is XML`);
assert.ok(parts['word/document.xml'].includes('&amp; use te rōpū Taumata &lt;always&gt;'), 'special characters are escaped, macrons kept');

const zip = new JSZip();
for (const [name, xml] of Object.entries(parts)) zip.file(name, xml);
const buffer = await zip.generateAsync({ type: 'nodebuffer' });
const { value: text } = await mammoth.extractRawText({ buffer });
for (const expect of ['Translation review: Corporate vision statements', 'Kia matua te tū a te rōpū Taumata.', 'He rerekē tēnei.', 'Could not be made: timed out',
  'Which reads better?', 'The AI version reads better', 'Reviewer\'s comments', 'Second line.', 'Elevated ōkawa register']) {
  assert.ok(text.includes(expect), `the document says "${expect}"`);
}
assert.strictEqual(reviewFileName('Corporate vision statements', 'te reo Māori', new Date(2026, 10, 17)), 'review-corporate-vision-statements-te-reo-maori-2026-11-17.docx');
console.log('reviewDocx tests passed');
