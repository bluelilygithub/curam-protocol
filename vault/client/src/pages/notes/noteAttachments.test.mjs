import assert from 'node:assert';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { MAX_FILES, READABLE_EXTENSIONS, askCanRead, MAX_BYTES, ALLOWED_EXTENSIONS, ACCEPT, formatSize, fileProblem, kindOf, isViewable, ICONS } from './noteAttachments.mjs';

// the screen offers exactly the file types the server accepts
const serverSource = fs.readFileSync(new URL('../../../../server/utils/attachments.js', import.meta.url), 'utf8');
const serverList = [...serverSource.match(/const ATTACHMENT_EXTENSIONS = \[([\s\S]*?)\];/)[1].matchAll(/'(\.[a-z0-9]+)'/g)].map((m) => m[1]);
assert.deepStrictEqual([...ALLOWED_EXTENSIONS].sort(), [...serverList].sort(), 'same file types as the server');
assert.strictEqual(ACCEPT, ALLOWED_EXTENSIONS.join(','));
assert.ok(serverSource.includes('50 * 1024 * 1024') && MAX_BYTES === 50 * 1024 * 1024, 'same size cap');
const routeSource = fs.readFileSync(new URL('../../../../server/routes/notes.js', import.meta.url), 'utf8');
assert.ok(routeSource.includes(`MAX_FILES_PER_NOTE = ${MAX_FILES}`), 'same number of files per note');

const serverReadable = [...createRequire(import.meta.url)('../../../../server/services/noteFileText.js').READABLE].sort();
assert.deepStrictEqual([...READABLE_EXTENSIONS].sort(), serverReadable, 'the screen knows the same readable kinds as the server');
assert.ok(READABLE_EXTENSIONS.every((e) => ALLOWED_EXTENSIONS.includes(e)), 'and only kinds that can be attached');
assert.strictEqual(askCanRead({ filename: 'a.PDF' }), true);
assert.strictEqual(askCanRead({ filename: 'photo.jpg' }), false);
assert.strictEqual(askCanRead({ filename: 'old.doc' }), false);
assert.strictEqual(askCanRead({ filename: 'a.pdf', readable: false }), false, 'what the server found (a scan with no text) wins');
assert.strictEqual(askCanRead({ filename: 'a.pdf', readable: null }), true, 'not looked at yet: by the kind of file');
assert.strictEqual(askCanRead(null), false);

assert.strictEqual(formatSize(1), '1 byte');
assert.strictEqual(formatSize(13), '13 bytes');
assert.strictEqual(formatSize(4096), '4.0 KB');
assert.strictEqual(formatSize(1.5 * 1024 * 1024), '1.5 MB');
assert.strictEqual(formatSize(-1), '');
assert.strictEqual(formatSize('x'), '');

const f = (name, size = 100) => ({ name, size });
assert.strictEqual(fileProblem(f('quote.pdf')), '');
assert.strictEqual(fileProblem(f('PHOTO.JPG')), '', 'the extension is not case sensitive');
assert.match(fileProblem(f('setup.exe')), /cannot be attached/);
assert.match(fileProblem(f('noextension')), /cannot be attached/);
assert.match(fileProblem(f('big.pdf', MAX_BYTES + 1)), /over 50 MB/);
assert.strictEqual(fileProblem(f('exactly.pdf', MAX_BYTES)), '', 'exactly the cap is fine');
assert.match(fileProblem(f('empty.txt', 0)), /empty/);
assert.match(fileProblem(f('one.txt'), MAX_FILES), /up to 20 files/);
assert.strictEqual(fileProblem(f('one.txt'), MAX_FILES - 1), '');
assert.match(fileProblem(null), /not a file/);

assert.strictEqual(kindOf({ filename: 'a.PNG', mimeType: '' }), 'image');
assert.strictEqual(kindOf({ filename: 'x', mimeType: 'image/webp' }), 'image');
assert.strictEqual(kindOf({ filename: 'a.pdf' }), 'pdf');
assert.strictEqual(kindOf({ filename: 'a.xlsx' }), 'sheet');
assert.strictEqual(kindOf({ filename: 'a.csv', mimeType: 'text/csv' }), 'sheet', 'a CSV is a sheet, not plain text');
assert.strictEqual(kindOf({ filename: 'a.docx' }), 'doc');
assert.strictEqual(kindOf({ filename: 'a.ppt' }), 'slides');
assert.strictEqual(kindOf({ filename: 'a.md', mimeType: 'text/markdown' }), 'text');
assert.strictEqual(kindOf({ filename: 'a.json' }), 'text');
assert.strictEqual(kindOf({ filename: 'mystery' }), 'file');
assert.strictEqual(kindOf(null), 'file');
assert.deepStrictEqual(Object.keys(ICONS).sort(), ['doc', 'file', 'image', 'pdf', 'sheet', 'slides', 'text']);

assert.strictEqual(isViewable({ filename: 'a.png' }), true);
assert.strictEqual(isViewable({ filename: 'a.pdf' }), true);
assert.strictEqual(isViewable({ filename: 'a.txt', mimeType: 'text/plain' }), true);
assert.strictEqual(isViewable({ filename: 'a.csv', mimeType: 'text/csv' }), false, 'a CSV is saved, not shown');
assert.strictEqual(isViewable({ filename: 'a.docx' }), false);
assert.strictEqual(isViewable({ filename: 'a.xlsx' }), false);

console.log('ok - note attachments: same limits as the server, size wording, what is refused, kinds');
