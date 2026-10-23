'use strict';

// node server/services/noteFileText.test.js — reading text out of attached files, and choosing the parts that matter to a question.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const F = require('./noteFileText');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-file-text-'));
  const put = (name, data) => { const p = path.join(dir, name); fs.writeFileSync(p, data); return p; };
  try {
    // ---- which kinds can be read
    assert.ok(F.canRead('Quote.PDF') && F.canRead('a.docx') && F.canRead('a.xlsx') && F.canRead('a.pptx') && F.canRead('a.csv') && F.canRead('a.md'));
    assert.ok(!F.canRead('photo.jpg') && !F.canRead('old.doc') && !F.canRead('old.ppt') && !F.canRead('noextension'));

    // ---- tidying
    assert.strictEqual(F.cleanText('﻿a\r\n\r\n\r\n\r\nb   c\u0000d'), 'a\n\nb c d');
    assert.strictEqual(F.cleanText(null), '');
    assert.strictEqual(F.cleanText('x'.repeat(F.MAX_TEXT_CHARS + 50)).length, F.MAX_TEXT_CHARS);

    // ---- plain text kinds
    assert.deepStrictEqual(await F.readFileText(put('a.txt', 'The kiwi deal is $4,000'), 'a.txt'), { status: 'ok', text: 'The kiwi deal is $4,000' });
    assert.strictEqual((await F.readFileText(put('a.csv', 'name,amount\nAcme,100\n'), 'a.csv')).text, 'name,amount\nAcme,100');
    assert.strictEqual((await F.readFileText(put('a.json', '{"k":"v"}'), 'a.json')).status, 'ok');
    assert.strictEqual((await F.readFileText(put('empty.txt', ''), 'empty.txt')).status, 'none', 'an empty file has nothing to read');
    assert.strictEqual((await F.readFileText(put('bin.txt', Buffer.from([0x41, 0, 0, 0, 0x42])), 'bin.txt')).status, 'none', 'a "text" file full of binary is not text');
    assert.strictEqual((await F.readFileText(put('photo.jpg', 'x'), 'photo.jpg')).status, 'none', 'a picture is not read');
    assert.strictEqual((await F.readFileText(path.join(dir, 'missing.txt'), 'missing.txt')).status, 'none', 'a missing file does not throw');

    // ---- PDF (made here, so there is real text to find)
    const { PDFDocument } = require('pdf-lib');
    const pdf = await PDFDocument.create();
    pdf.addPage().drawText('Quarterly budget for the Mango project', { x: 40, y: 700, size: 14 });
    pdf.addPage().drawText('Second page about invoices', { x: 40, y: 700, size: 14 });
    const pdfText = await F.readFileText(put('b.pdf', Buffer.from(await pdf.save())), 'b.pdf');
    assert.strictEqual(pdfText.status, 'ok');
    assert.match(pdfText.text, /Quarterly budget for the Mango project/);
    assert.match(pdfText.text, /Second page about invoices/);
    const blank = await PDFDocument.create();
    blank.addPage();
    assert.strictEqual((await F.readFileText(put('blank.pdf', Buffer.from(await blank.save())), 'blank.pdf')).status, 'none', 'a PDF with no text (a scan) has nothing to read');
    assert.strictEqual((await F.readFileText(put('broken.pdf', 'not a pdf'), 'broken.pdf')).status, 'none', 'a damaged PDF does not throw');

    // ---- Word
    const JSZip = require('jszip');
    const docx = new JSZip();
    docx.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    docx.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    docx.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Contract with Zebra Pty Ltd</w:t></w:r></w:p><w:p><w:r><w:t>Term: 12 months</w:t></w:r></w:p></w:body></w:document>');
    const word = await F.readFileText(put('c.docx', await docx.generateAsync({ type: 'nodebuffer' })), 'c.docx');
    assert.strictEqual(word.status, 'ok');
    assert.match(word.text, /Contract with Zebra Pty Ltd\n+Term: 12 months/);

    // ---- Excel
    const XLSX = require('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['item', 'cost'], ['Kayak', 950]]), 'Gear');
    XLSX.writeFile(wb, path.join(dir, 'd.xlsx'));
    const sheet = await F.readFileText(path.join(dir, 'd.xlsx'), 'd.xlsx');
    assert.strictEqual(sheet.status, 'ok');
    assert.match(sheet.text, /Sheet Gear:\nitem,cost\nKayak,950/);

    // ---- PowerPoint
    const pptx = new JSZip();
    pptx.file('ppt/slides/slide2.xml', '<p:sld><a:t>Roadmap &amp; goals</a:t></p:sld>');
    pptx.file('ppt/slides/slide1.xml', '<p:sld><a:t>Welcome</a:t><a:t>to the launch</a:t></p:sld>');
    pptx.file('ppt/slides/slide10.xml', '<p:sld><a:t>Thanks</a:t></p:sld>');
    const deck = await F.readFileText(put('e.pptx', await pptx.generateAsync({ type: 'nodebuffer' })), 'e.pptx');
    assert.strictEqual(deck.text, 'Slide 1: Welcome to the launch\nSlide 2: Roadmap & goals\nSlide 3: Thanks', 'slides in number order, entities decoded');

    // ---- choosing the parts of a long file
    const filler = (n) => Array.from({ length: n }, (_, i) => `Line ${i} about nothing in particular, just filler text to pad the page.`).join('\n');
    const long = `${filler(60)}\nThe warranty period is 24 months from delivery.\n${filler(60)}\nPayment terms are net 30 days.\n${filler(20)}`;
    assert.strictEqual(F.fileExcerpt('short text', ['x'], 500), 'short text', 'short text comes back whole');
    const ex = F.fileExcerpt(long, ['warranty'], 600);
    assert.ok(ex.length <= 600, `bounded (${ex.length})`);
    assert.match(ex, /warranty period is 24 months/, 'the passage with the word is kept');
    assert.ok(!/Payment terms/.test(ex), 'and one that does not match is not');
    const both = F.fileExcerpt(long, ['warranty', 'payment'], 1800);
    assert.ok(both.indexOf('warranty') < both.indexOf('Payment terms'), 'passages keep their order in the file');
    assert.ok(both.includes(' … '), 'and are joined to show text was left out');
    assert.ok(F.fileExcerpt(long, ['warrant'], 600).includes('warranty period'), 'a keyword matches the start of a word, as in the search');
    assert.ok(!F.fileExcerpt(long, ['arrant'], 600).includes('warranty period'), 'but not the middle of one');
    const noHit = F.fileExcerpt(long, ['zzzz'], 300);
    assert.ok(noHit.startsWith('Line 0') && noHit.length <= 300 && noHit.endsWith('…'), 'no match: the start of the file');
    assert.ok(F.fileExcerpt(long, [], 300).startsWith('Line 0'), 'no keywords: the start');

    // ---- what the model is shown for a note's files
    const shown = F.filesForPrompt([
      { filename: 'Quote.pdf', status: 'ok', text: 'Total $4,000 including GST' },
      { filename: 'scan.pdf', status: 'none', text: '' },
      { filename: 'New.docx', status: 'pending', text: '' },
    ], ['total'], 2000);
    assert.deepStrictEqual({ read: shown.read, unread: shown.unread, pending: shown.pending }, { read: ['Quote.pdf'], unread: ['scan.pdf'], pending: ['New.docx'] });
    assert.match(shown.text, /FILE "Quote.pdf" \(text read from this attached file\):\nTotal \$4,000 including GST/);
    assert.match(shown.text, /not read \(no text could be taken from it\): scan.pdf/);
    assert.match(shown.text, /not read yet \(still being prepared\): New.docx/);
    assert.deepStrictEqual(F.filesForPrompt([], [], 1000), { text: '', read: [], unread: [], pending: [] });
    const cut = F.filesForPrompt([{ filename: 'Big.txt', status: 'ok', text: long }], ['warranty'], 500);
    assert.match(cut.text, /the parts that matter to the question/, 'a cut file says so');

    console.log('noteFileText tests passed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((err) => { console.error(err); process.exit(1); });
