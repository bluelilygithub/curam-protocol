'use strict';

// node server/services/presentations/export.test.js — writes only to a temp folder.

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { exportDeck } = require('./export');
const { renderDeckHtml } = require('./render');
const { normalizeDeck } = require('./schema');
const { LAYOUTS, DESIGN_IDS } = require('./layouts');

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
  assert.equal((html.match(/<section class="slide\b/g) || []).length, 6);

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

    // every slide layout on one deck, in every design style and aspect: the HTML shows the words and the PPTX builds
    const everyLayout = normalizeDeck({
      title: 'All layouts', aspect: '16:9',
      slides: LAYOUTS.map((layout, i) => ({
        id: `s${i + 1}`, layout, title: `Title ${layout}`, body: `Body ${layout}`,
        bullets: ['2019 — Founded', '2022 — Grew', '2024 — Expanded'],
        columns: [{ heading: '42%', bullets: ['Growth'] }, { heading: 'Plan B', bullets: ['Cheaper', 'Slower'] }, { heading: 'C', bullets: ['Third'] }],
      })),
    });
    for (const designId of DESIGN_IDS) {
      for (const aspect of ['16:9', '4:3', '1:1']) {
        const deck = { ...everyLayout, designId, aspect };
        const page = renderDeckHtml(deck, 'ocean');
        assert.equal((page.match(/<section class="slide\b/g) || []).length, LAYOUTS.length, `${designId} ${aspect}: one section per slide`);
        for (const layout of LAYOUTS) assert.ok(page.includes(`layout-${layout} design-${designId}`), `${designId}: ${layout} rendered`);
        assert.ok(page.includes('Title comparison') && page.includes('Plan B') && page.includes('Founded'), `${designId}: text from titles, columns and timeline reaches the page`);
      }
      // eslint-disable-next-line no-await-in-loop
      const out = await exportDeck({ userId: 1, deck: { ...everyLayout, designId }, format: 'pptx', outDir: dir });
      // eslint-disable-next-line no-await-in-loop
      assert.equal((await fs.readFile(out.filePath)).slice(0, 2).toString(), 'PK', `${designId}: PPTX with every layout builds`);
    }
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

run().then(() => console.log('presentations export tests passed')).catch((err) => { console.error(err); process.exitCode = 1; });
