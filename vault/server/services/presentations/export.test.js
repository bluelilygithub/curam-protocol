'use strict';

// node server/services/presentations/export.test.js — writes only to a temp folder.

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { exportDeck } = require('./export');
const { renderDeckHtml } = require('./render');
const { normalizeDeck } = require('./schema');

const fixture = normalizeDeck({
  title: 'Test deck', subtitle: 'A small deck', themeId: 'paper', aspect: '16:9',
  slides: [
    { id: 's1', layout: 'title', title: 'Test deck', body: 'A small deck' },
    { id: 's2', layout: 'bullets', title: 'Agenda', bullets: ['One', 'Two', 'Three'] },
    { id: 's3', layout: 'two-column', title: 'Detail', bullets: ['Left', 'Right'], body: 'Some body text' },
    { id: 's4', layout: 'picture', title: 'Picture', body: 'No image needed in this test' },
    { id: 's5', layout: 'bullets', title: 'Numbers', bullets: ['1', '2'] },
    { id: 's6', layout: 'closing', title: 'Thank you', body: 'Questions?' },
  ],
});

async function run() {
  const html = renderDeckHtml({ ...fixture, title: '<script>alert(1)</script>' }, 'paper');
  assert.ok(html.includes('&lt;script&gt;'), 'deck text is escaped');
  assert.ok(!html.includes('<script>'));
  assert.equal((html.match(/class="slide"/g) || []).length, 6);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'presentations-export-'));
  try {
    for (const format of ['pptx', 'html', 'pdf', 'png']) {
      // eslint-disable-next-line no-await-in-loop
      const out = await exportDeck({ userId: 1, deck: fixture, format, outDir: dir });
      // eslint-disable-next-line no-await-in-loop
      const bytes = await fs.readFile(out.filePath);
      assert.ok(bytes.length > 500, `${format} produced a real file`);
      if (format === 'pptx') assert.equal(bytes.slice(0, 2).toString(), 'PK', 'PPTX is a zip package');
      if (format === 'pdf') assert.equal(bytes.slice(0, 4).toString(), '%PDF');
      if (format === 'png') assert.equal(bytes.slice(0, 2).toString(), 'PK', 'PNGs are packed in a zip');
    }
    assert.ok((await fs.readdir(dir)).some((f) => f.endsWith('-slide-06.png')), 'per-slide files were made before zipping');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

run().then(() => console.log('presentations export tests passed')).catch((err) => { console.error(err); process.exitCode = 1; });
