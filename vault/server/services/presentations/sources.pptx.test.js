'use strict';

// node server/services/presentations/sources.pptx.test.js — builds a PPTX in memory; no disk, network or db.

const assert = require('node:assert/strict');
const JSZip = require('jszip');
const PptxGenJS = require('pptxgenjs');
const { extractSources } = require('./sources');

const PPTX_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const TINY_PNG = 'image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

async function makePptx() {
  const pptx = new PptxGenJS();
  pptx.title = 'Probe Deck';

  const first = pptx.addSlide();
  first.addText('Hello title', { x: 0.5, y: 0.5, w: 8, h: 1, placeholder: 'title' });
  first.addText([
    { text: 'First bullet', options: { bullet: true, breakLine: true } },
    { text: 'Second bullet', options: { bullet: true } },
  ], { x: 0.5, y: 2, w: 8, h: 2 });
  first.addNotes('Say hello.');

  const second = pptx.addSlide();
  second.addText('Second slide', { x: 0.5, y: 0.5, w: 8, h: 1 });
  second.addTable([['Head A', 'Head B'], ['Cell A', 'Cell B']], { x: 0.5, y: 2, w: 8, h: 2 });
  second.addImage({ data: TINY_PNG, type: 'png' }, { x: 5, y: 5, w: 1, h: 1 });
  second.addNotes('Second note.');

  return pptx.write({ outputType: 'nodebuffer' });
}

function depsFor(saved) {
  return {
    JSZip,
    saveAsset: async (userId, bytes, mimeType) => {
      saved.push({ userId, bytes, mimeType });
      return `/api/presentations/assets/${userId}/img-${saved.length}.${mimeType.split('/')[1]}`;
    },
  };
}

async function run() {
  const saved = [];
  const deps = depsFor(saved);
  const buffer = await makePptx();
  const out = await extractSources({
    files: [{ originalname: 'probe.pptx', mimetype: PPTX_TYPE, buffer }],
    userId: 'u1',
  }, deps);

  assert.ok(out.deck, 'a PPTX import returns a deck');
  assert.equal(out.deck.schemaVersion, 2);
  assert.equal(out.deck.title, 'Probe Deck', 'title comes from docProps/core.xml');
  assert.equal(out.deck.themeId, 'paper');
  assert.equal(out.deck.aspect, '16:9');
  assert.equal(out.deck.subtitle, '');
  assert.equal(out.deck.slides.length, 2);

  const [first, second] = out.deck.slides;
  assert.equal(first.layout, 'title');
  assert.equal(first.title, 'Hello title');
  assert.deepEqual(first.bullets, ['First bullet', 'Second bullet']);
  assert.equal(first.notes, 'Say hello.');
  assert.equal(second.title, 'Second slide');
  assert.equal(second.notes, 'Second note.');
  assert.deepEqual(second.table.rows, [['Head A', 'Head B'], ['Cell A', 'Cell B']]);
  assert.equal(second.table.header, true);
  assert.equal(saved.length, 1, 'one picture was saved through saveAsset');
  assert.equal(saved[0].userId, 'u1');
  assert.equal(saved[0].mimeType, 'image/png');
  assert.ok(Buffer.isBuffer(saved[0].bytes) && saved[0].bytes.length > 10);
  assert.equal(second.imageRef, '/api/presentations/assets/u1/img-1.png');
  assert.deepEqual(second.images, []);
  assert.ok(out.sourceText.includes('First bullet'), 'slide text is still in sourceText');

  for (const slide of out.deck.slides) {
    assert.equal(typeof slide.id, 'string');
    assert.ok(Array.isArray(slide.bullets) && Array.isArray(slide.images));
    assert.equal(typeof slide.notes, 'string');
    assert.ok(slide.notes.length <= 1200 && slide.body.length <= 700 && slide.title.length <= 120);
  }

  // Plain text keeps the old behaviour: source material, no deck.
  const plain = await extractSources({
    files: [{ originalname: 'brief.txt', mimetype: 'text/plain', buffer: Buffer.from('A plain source.') }],
    userId: 'u1',
  }, deps);
  assert.equal(plain.sourceText, 'A plain source.');
  assert.deepEqual(plain.imageRefs, []);
  assert.equal(plain.deck, undefined);
  assert.deepEqual(plain.warnings, []);

  // A damaged presentation warns instead of throwing; the text file keeps the import usable.
  const mixed = await extractSources({
    files: [
      { originalname: 'broken.pptx', mimetype: PPTX_TYPE, buffer: Buffer.from('not a zip') },
      { originalname: 'brief.txt', mimetype: 'text/plain', buffer: Buffer.from('Still useful.') },
    ],
    userId: 'u1',
  }, deps);
  assert.equal(mixed.sourceText, 'Still useful.');
  assert.ok(mixed.warnings.some((warning) => /broken\.pptx/.test(warning)));
  assert.equal(mixed.deck, undefined);

  // With two presentations only the first is imported, and the extra one is called out.
  const twice = await extractSources({
    files: [
      { originalname: 'one.pptx', mimetype: PPTX_TYPE, buffer },
      { originalname: 'two.pptx', mimetype: PPTX_TYPE, buffer },
    ],
    userId: 'u1',
  }, deps);
  assert.equal(twice.deck.slides.length, 2);
  assert.ok(twice.warnings.some((warning) => /two\.pptx/.test(warning)));
}

run().then(() => console.log('presentations sources.pptx tests passed')).catch((err) => { console.error(err); process.exitCode = 1; });
