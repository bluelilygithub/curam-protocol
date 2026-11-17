'use strict';

// The translated PDF, made on the server (it used to be made in the browser at the end of a job, so closing the page lost the job).
// Same three layouts, same fonts and the same footer as the browser version it replaced. @react-pdf/renderer runs here without JSX
// (React.createElement), and the fonts are the files the browser used, read from client/public/fonts.
//
// Font choice is the shared, tested module client/src/utils/translatePdfFonts.mjs (an ES module, loaded with import() so this works
// on every Node version the image may run). See docs/translate-agent.md "Fonts" for why source AND target language are both checked.

const path = require('path');
const { pathToFileURL } = require('url');
const React = require('react');
const { Document, Page, Text, View, StyleSheet, Font, renderToBuffer } = require('@react-pdf/renderer');
const { langName } = require('./translateLlmService');

const h = React.createElement;
const FONT_DIR = path.join(__dirname, '../../client/public/fonts');
const FONTS_MODULE = path.join(__dirname, '../../client/src/utils/translatePdfFonts.mjs');

let fontsModule = null;
async function loadFonts() {
  if (!fontsModule) fontsModule = await import(pathToFileURL(FONTS_MODULE).href);
  return fontsModule;
}

// react-pdf runs every word through a hyphenation callback that corrupts letters in languages it does not know ("Māori" came out as
// "M ori"). Every word is one unbreakable unit instead. Registered once per process.
let hyphenationOff = false;
function disableHyphenation() {
  if (hyphenationOff) return;
  hyphenationOff = true;
  try { Font.registerHyphenationCallback((word) => [word]); } catch { /* already registered */ }
}

const registered = new Set();
/** The font family to use for this pair of languages: a Noto font when either language needs characters Helvetica lacks. */
async function fontFamilyFor(targetLanguage, sourceLanguage) {
  disableHyphenation();
  const { pickPdfFontUrl } = await loadFonts();
  const url = pickPdfFontUrl(targetLanguage, sourceLanguage); // '/fonts/NotoSansJP.ttf' or null
  if (!url) return 'Helvetica';
  const file = path.join(FONT_DIR, path.basename(url));
  const family = `Noto-${path.basename(url, '.ttf')}`;
  if (!registered.has(family)) {
    Font.register({ family, src: file });
    registered.add(family);
  }
  return family;
}

const LAYOUTS = ['side-by-side', 'translation-only', 'bilingual-pages'];

/** The PDF as a Buffer. `payload` is the job's translatedTextJson (sourceByPage, translatedByPage, pageCount, pageLabels, ...). */
async function buildTranslatedPdf(payload, { sourceLanguage, targetLanguage, engine = 'llm' } = {}) {
  const {
    sourceByPage = {}, translatedByPage = {}, scannedPages = [], avgOcrConfidence = null,
    pageLabels = {}, sourceFormat = 'pdf',
  } = payload || {};
  const pageCount = Number(payload?.pageCount) || Math.max(0, ...Object.keys(translatedByPage).map(Number));
  const layout = LAYOUTS.includes(payload?.pdfLayout) ? payload.pdfLayout : 'side-by-side';
  const fontFamily = await fontFamilyFor(targetLanguage, sourceLanguage);

  const isLowConf = (pg) => scannedPages.includes(pg) && avgOcrConfidence != null && avgOcrConfidence < 0.7;
  const footerText = engine === 'google'
    ? 'Google Translate · for reference only · not legally certified'
    : 'AI-generated translation (Vault LLM) · for reference only · not legally certified';
  const styles = StyleSheet.create({
    page: { padding: 40, fontFamily },
    header: { fontSize: 9, color: '#6b7280', marginBottom: 12, paddingBottom: 6, borderBottom: '1px solid #e5e7eb', flexDirection: 'row', justifyContent: 'space-between' },
    langBadge: { fontSize: 8, backgroundColor: '#f3f4f6', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
    warning: { backgroundColor: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 4, padding: 6, marginBottom: 10, fontSize: 8, color: '#92400e' },
    para: { fontSize: 10, color: '#1f2937', marginBottom: 6, lineHeight: 1.6 },
    paraSm: { fontSize: 9, color: '#1f2937', marginBottom: 5, lineHeight: 1.5 },
    footer: { position: 'absolute', bottom: 20, left: 40, right: 40, fontSize: 7, color: '#9ca3af', textAlign: 'center', borderTop: '1px solid #e5e7eb', paddingTop: 4 },
    sourceHeader: { fontSize: 9, fontWeight: 'bold', color: '#374151' },
    transHeader: { fontSize: 9, fontWeight: 'bold', color: '#1d4ed8' },
    columns: { flexDirection: 'row', gap: 12, flexGrow: 1 },
    col: { width: '48%', paddingRight: 6 },
    colRight: { width: '48%', paddingLeft: 6, borderLeft: '1px solid #e5e7eb' },
    colTitle: { fontSize: 8, fontWeight: 'bold', marginBottom: 8, color: '#6b7280' },
    colTitleTrans: { fontSize: 8, fontWeight: 'bold', marginBottom: 8, color: '#1d4ed8' },
  });

  const langLabel = langName(targetLanguage);
  const srcLabel = sourceLanguage && sourceLanguage !== 'auto' ? langName(sourceLanguage) : 'Original';
  const sectionLabel = (pg) => pageLabels[pg] || pageLabels[String(pg)]
    || (sourceFormat === 'xlsx' || sourceFormat === 'xls' ? `Sheet ${pg}` : `Page ${pg}`);
  const paras = (list, style) => list.map((p, i) => h(Text, { key: i, style }, String(p ?? '')));
  const warning = (text) => h(View, { style: styles.warning }, h(Text, null, text));
  const header = (left, leftStyle, badge) => h(View, { style: styles.header }, h(Text, { style: leftStyle }, left), h(Text, { style: styles.langBadge }, badge));

  const pages = [];
  for (let pg = 1; pg <= pageCount; pg++) {
    const src = sourceByPage[pg] || sourceByPage[String(pg)] || [];
    const trn = translatedByPage[pg] || translatedByPage[String(pg)] || [];
    const low = isLowConf(pg);
    const label = sectionLabel(pg);

    if (layout === 'translation-only') {
      pages.push(h(Page, { key: `trn-${pg}`, size: 'A4', style: styles.page },
        header(`TRANSLATION · ${label}`, styles.transHeader, langLabel),
        low ? warning('⚠ Source page had low OCR confidence — translation may be inaccurate') : null,
        ...paras(trn, styles.para),
        h(Text, { style: styles.footer }, footerText)));
      continue;
    }
    if (layout === 'side-by-side') {
      pages.push(h(Page, { key: `sbs-${pg}`, size: 'A4', style: styles.page },
        header(`SIDE BY SIDE · ${label}`, styles.sourceHeader, `${srcLabel} → ${langLabel}`),
        low ? warning('⚠ Low OCR confidence on this page — review carefully') : null,
        h(View, { style: styles.columns },
          h(View, { style: styles.col }, h(Text, { style: styles.colTitle }, 'ORIGINAL'), ...paras(src, styles.paraSm)),
          h(View, { style: styles.colRight }, h(Text, { style: styles.colTitleTrans }, 'TRANSLATION'), ...paras(trn, styles.paraSm))),
        h(Text, { style: styles.footer }, footerText)));
      continue;
    }
    // bilingual-pages: the original page, then its translation
    pages.push(h(Page, { key: `src-${pg}`, size: 'A4', style: styles.page },
      header(`ORIGINAL · ${label}`, styles.sourceHeader, srcLabel),
      low ? warning('⚠ Low OCR confidence on this page — review carefully') : null,
      ...paras(src, styles.para),
      h(Text, { style: styles.footer }, 'AI-generated translation · for reference only · not legally certified')));
    pages.push(h(Page, { key: `trn-${pg}`, size: 'A4', style: styles.page },
      header(`TRANSLATION · ${label}`, styles.transHeader, langLabel),
      low ? warning('⚠ Source page had low OCR confidence — translation may be inaccurate') : null,
      ...paras(trn, styles.para),
      h(Text, { style: styles.footer }, 'AI-generated translation · for reference only · not legally certified')));
  }
  if (!pages.length) pages.push(h(Page, { key: 'empty', size: 'A4', style: styles.page }, h(Text, { style: styles.para }, '(No text)')));

  return renderToBuffer(h(Document, null, ...pages));
}

module.exports = { buildTranslatedPdf };
