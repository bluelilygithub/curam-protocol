#!/usr/bin/env node
/**
 * translatePdfFonts + Translate agent PDF pipeline — regression tests for two real incidents:
 *
 *  1. Font-selection checked target language only, missing that the SOURCE language could be
 *     the one needing an extended font (a real mi -> en job: Māori source, English target —
 *     'en' isn't in FONT_BY_LANG, so the whole page fell back to Helvetica and every macron in
 *     the ORIGINAL column silently vanished).
 *  2. react-pdf/textkit's default English-syllable hyphenation callback mangled non-English
 *     words during line-wrap width-fitting even with the correct font selected and every glyph
 *     present in that font — "Māori" -> "M ori", "Kōhanga" -> "KMhanga".
 *
 * Part 1 (font-selection matrix) runs with plain `node` — no bundler needed. Part 2 (the actual
 * render -> extract round trip) needs @react-pdf/renderer's BROWSER build specifically: Vite
 * ships that build via the package.json "browser" field, which plain `require()` does NOT
 * honour — the default/Node build resolves font loading completely differently (fontkit.open()
 * on a local path) and would pass even if the browser's fetch()-based path were broken. Run
 * with:
 *   node vault/client/src/utils/translatePdfFonts.test.js
 */

'use strict';

const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { pickPdfFontUrl, needsNotoFont, FONT_BY_LANG } = require('./translatePdfFonts');

const G = '\x1b[32m';
const R = '\x1b[31m';
const X = '\x1b[0m';

let pass = 0;
let fail = 0;

function test(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`${G}✓${X} ${name}`);
  } catch (err) {
    fail += 1;
    console.log(`${R}✗${X} ${name}`);
    console.log(`  ${err.message}`);
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log(`${G}✓${X} ${name}`);
  } catch (err) {
    fail += 1;
    console.log(`${R}✗${X} ${name}`);
    console.log(`  ${err.stack || err.message}`);
  }
}

// ── Part 1: font-selection fallback matrix (guards the exact "checked target only" regression) ──

test('mi -> en: source needs Noto, target does not — must still pick Noto', () => {
  assert.strictEqual(pickPdfFontUrl('en', 'mi'), FONT_BY_LANG.mi);
  assert.strictEqual(needsNotoFont('en', 'mi'), true);
});

test('en -> mi: target needs Noto, source does not — must pick Noto', () => {
  assert.strictEqual(pickPdfFontUrl('mi', 'en'), FONT_BY_LANG.mi);
  assert.strictEqual(needsNotoFont('mi', 'en'), true);
});

test('en -> fr: neither direction needs Noto — Helvetica stays fine', () => {
  assert.strictEqual(pickPdfFontUrl('fr', 'en'), null);
  assert.strictEqual(needsNotoFont('fr', 'en'), false);
});

test('en -> zh-CN: target-only need still resolves (regression baseline, pre-existing case)', () => {
  assert.strictEqual(pickPdfFontUrl('zh-CN', 'en'), FONT_BY_LANG['zh-CN']);
});

test('zh-CN -> en: source-only need resolves too (same class of bug as mi -> en)', () => {
  assert.strictEqual(pickPdfFontUrl('en', 'zh-CN'), FONT_BY_LANG['zh-CN']);
});

test('mi -> pl: both directions need Noto, target wins the URL pick (both map to the same file anyway)', () => {
  assert.strictEqual(pickPdfFontUrl('pl', 'mi'), FONT_BY_LANG.pl);
});

// ── Part 2: real render -> extract round trip, real sentences, real HTTP font fetch ──────────

async function renderAndExtract(testString, { targetLanguage, sourceLanguage }) {
  const PORT = 8990 + Math.floor(Math.random() * 500); // avoid clashing with a parallel run
  const fontFile = path.join(__dirname, '../../public', pickPdfFontUrl(targetLanguage, sourceLanguage));
  const server = http.createServer((req, res) => {
    fs.readFile(fontFile, (err, data) => {
      if (err) { res.writeHead(500); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'font/ttf' });
      res.end(data);
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(0, async () => {
      const port = server.address().port;
      try {
        // The BROWSER build specifically — see file header. Absolute path bypasses the
        // package's "exports" map, which doesn't expose this subpath to a plain require().
        const rendererPath = path.join(
          __dirname, '../../../node_modules/@react-pdf/renderer/lib/react-pdf.browser.cjs',
        );
        const { Document, Page, Text, Font, StyleSheet, pdf: buildPdf } = require(rendererPath);
        const React = require('react');

        Font.registerHyphenationCallback((word) => [word]);
        Font.register({ family: 'NotoTarget', src: `http://localhost:${port}/font.ttf` });

        const styles = StyleSheet.create({
          page: { fontFamily: 'NotoTarget', padding: 40 },
          p: { fontSize: 12 },
        });
        const doc = React.createElement(Document, null,
          React.createElement(Page, { size: 'A4', style: styles.page },
            React.createElement(Text, { style: styles.p }, testString),
          ),
        );

        const chunks = [];
        const stream = await buildPdf(doc).toBuffer();
        stream.on('data', (c) => chunks.push(c));
        stream.on('error', reject);
        stream.on('end', async () => {
          try {
            const full = Buffer.concat(chunks);
            const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
            const loaded = await pdfjsLib.getDocument({ data: new Uint8Array(full) }).promise;
            const page = await loaded.getPage(1);
            const tc = await page.getTextContent();
            server.close();
            resolve(tc.items.map((i) => i.str).join(''));
          } catch (err) {
            server.close();
            reject(err);
          }
        });
      } catch (err) {
        server.close();
        reject(err);
      }
    });
  });
}

(async () => {
  // Real sentences, not isolated characters — the hyphenation bug specifically triggers during
  // line-wrap width-fitting, which only runs on words long enough / a string long enough to
  // reach a wrap decision, not necessarily on 4-5 letter isolated test tokens.
  const REAL_SENTENCES = [
    'Māori, Pākehā, Kōhanga Reo, Ngā Tamatoa',
    'Kāore anō kia mōhio ngā tamariki ki te kōrero i te reo Māori i roto i ngā kāinga o Aotearoa.',
    'He taonga tuku iho te reo Māori, he mea whakahirahira ki te iwi Māori me Aotearoa whānui.',
  ];

  for (const sentence of REAL_SENTENCES) {
    await asyncTest(`round-trip survives: "${sentence.slice(0, 40)}${sentence.length > 40 ? '…' : ''}"`, async () => {
      const extracted = await renderAndExtract(sentence, { targetLanguage: 'en', sourceLanguage: 'mi' });
      assert.strictEqual(extracted, sentence, `\n  expected: ${sentence}\n  got:      ${extracted}`);
    });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
