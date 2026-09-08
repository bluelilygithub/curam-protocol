'use strict';

/**
 * Product Scout report PDF — server-side pdf-lib implementation.
 * Renders a saved product_scout_runs result (mode 'scout' or 'guide') as a
 * downloadable / emailable report. Standalone builder (not shared with
 * propertyScenarioPdf.js — different layout needs).
 */

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const C = {
  primary: rgb(0.80, 0.47, 0.36), // #CC785C
  text: rgb(0.10, 0.10, 0.10),
  muted: rgb(0.53, 0.53, 0.53),
  border: rgb(0.85, 0.85, 0.81),
  bgAlt: rgb(0.96, 0.96, 0.94),
};

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 44;
const CONTENT_W = PAGE_W - MARGIN * 2;

function clean(v) {
  return String(v == null ? '' : v)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/→/g, '->')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '');
}

function wordWrap(text, font, size, maxWidth) {
  const safe = clean(text);
  const lines = [];
  for (const para of safe.split(/\n+/)) {
    const words = para.split(/\s+/);
    let line = '';
    for (const word of words) {
      if (!word) continue;
      const test = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    if (!para.trim()) lines.push('');
  }
  return lines;
}

function makeBuilder(pdfDoc, fonts) {
  const { reg, bold } = fonts;
  let page;
  let y;

  function newPage() {
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  }

  function ensureSpace(h) {
    if (y - h < MARGIN) newPage();
  }

  function text(str, { size = 10.5, font = reg, color = C.text, gap = 4, maxWidth = CONTENT_W, x = MARGIN } = {}) {
    const lines = wordWrap(str, font, size, maxWidth);
    for (const line of lines) {
      ensureSpace(size + 3);
      page.drawText(line, { x, y: y - size, size, font, color });
      y -= size + 3;
    }
    y -= gap;
  }

  function heading(str, { size = 13 } = {}) {
    ensureSpace(size + 12);
    text(str, { size, font: bold, color: C.text, gap: 6 });
  }

  function hline() {
    ensureSpace(10);
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.75, color: C.border });
    y -= 10;
  }

  function card(lines) {
    // lines: array of { str, size, font, color }
    const pad = 10;
    const lineHeight = 13;
    const wrapped = [];
    for (const l of lines) {
      const size = l.size || 9.5;
      const font = l.font || reg;
      const wl = wordWrap(l.str, font, size, CONTENT_W - pad * 2);
      for (const w of wl) wrapped.push({ str: w, size, font, color: l.color || C.text });
    }
    const h = wrapped.length * lineHeight + pad * 2;
    ensureSpace(h + 8);
    page.drawRectangle({
      x: MARGIN, y: y - h, width: CONTENT_W, height: h,
      color: C.bgAlt, borderColor: C.border, borderWidth: 0.75,
    });
    let cy = y - pad - 9;
    for (const w of wrapped) {
      page.drawText(w.str, { x: MARGIN + pad, y: cy, size: w.size, font: w.font, color: w.color });
      cy -= lineHeight;
    }
    y -= h + 12;
  }

  newPage();
  return { text, heading, hline, card, get page() { return page; }, get y() { return y; } };
}

function fmtDate(d) {
  try {
    return new Date(d || Date.now()).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return String(d || '');
  }
}

function pickLines(pick, { label = null } = {}) {
  if (!pick) return [{ str: 'No pick.', size: 9.5 }];
  const lines = [];
  if (label) lines.push({ str: label, size: 9, color: C.muted });
  lines.push({ str: pick.title || 'Untitled', size: 10.5, font: undefined });
  const meta = [
    pick.price ? `Price: ${pick.price}` : null,
    pick.value_score != null ? `Value score: ${pick.value_score}` : null,
    pick.rating != null ? `Rating: ${pick.rating} (${pick.review_count ?? '—'} reviews)` : null,
  ].filter(Boolean).join('  ·  ');
  if (meta) lines.push({ str: meta, size: 9, color: C.muted });
  const features = (pick.key_features || pick.feature_bullets || []).slice(0, 4);
  if (features.length) lines.push({ str: `Key features: ${features.join('; ')}`, size: 9 });
  if (pick.value_rationale) lines.push({ str: pick.value_rationale, size: 9 });
  if (pick.link) lines.push({ str: pick.link, size: 8, color: C.primary });
  return lines;
}

function buildGuideReport(b, result, fonts) {
  const { bold } = fonts;
  b.heading(clean(result.query || 'Product Scout guide'), { size: 16 });
  b.text(`Generated ${fmtDate(result.createdAt)}${result.pipeline_version ? ` · Pipeline ${result.pipeline_version}` : ''}`, { size: 9, color: C.muted, gap: 10 });

  if (result.feature_brief?.summary) {
    b.text(result.feature_brief.summary, { size: 10, gap: 12 });
  }

  const tiers = result.tiers || [];
  const scoutedTiers = tiers.filter((t) => t?.scout?.comparison?.top3?.length);

  b.heading('Per-tier recommendations', { size: 13 });
  if (!scoutedTiers.length) {
    b.text('No tiers scouted yet.', { size: 9.5, color: C.muted });
  }
  for (const t of scoutedTiers) {
    b.text(`${t.label} (${t.price_min != null ? `$${t.price_min}` : '—'}–${t.price_max != null ? `$${t.price_max}` : '—'})`, {
      size: 11, font: bold, gap: 4,
    });
    const top = t.scout.comparison.top3[0];
    b.card(pickLines(top));
    const summary = t.scout.comparison.selection_summary;
    if (summary) b.text(summary, { size: 9, color: C.muted, gap: 10 });
  }

  b.hline();
  b.heading('Overall recommendation (across all tiers)', { size: 13 });
  const rec = result.final_recommendation;
  if (!rec || rec.error) {
    b.text(rec?.error || 'No overall recommendation generated yet.', { size: 9.5, color: C.muted });
  } else {
    if (rec.headline) b.text(rec.headline, { size: 11, font: bold, gap: 6 });
    if (rec.rationale) b.text(rec.rationale, { size: 9.5, gap: 8 });
    b.card(pickLines(rec.pick, { label: 'Recommended pick' }));
    if (rec.worth_stepping_up) b.text(`Worth stepping up: ${rec.worth_stepping_up}`, { size: 9, color: C.muted, gap: 4 });
    if (rec.worth_staying_down) b.text(`Worth staying down: ${rec.worth_staying_down}`, { size: 9, color: C.muted, gap: 4 });
  }
}

function buildScoutReport(b, result, fonts) {
  const { bold } = fonts;
  b.heading(clean(result.query || 'Product Scout result'), { size: 16 });
  b.text(`Generated ${fmtDate(result.createdAt)}${result.pipeline_version ? ` · Pipeline ${result.pipeline_version}` : ''}`, { size: 9, color: C.muted, gap: 10 });

  const comparison = result.comparison || {};
  if (comparison.selection_summary) b.text(comparison.selection_summary, { size: 10, gap: 10 });

  const top3 = comparison.top3 || [];
  b.heading('Top picks', { size: 13 });
  if (!top3.length) b.text('No picks found.', { size: 9.5, color: C.muted });
  top3.forEach((p, i) => {
    b.text(`#${p.rank || i + 1}`, { size: 9, font: bold, color: C.muted, gap: 2 });
    b.card(pickLines(p));
  });

  const stretch = comparison.stretch_suggestions || [];
  if (stretch.length) {
    b.heading('Stretch options', { size: 12 });
    stretch.forEach((p) => b.card(pickLines(p)));
  }

  const externals = result.external_alternatives || [];
  if (externals.length) {
    b.heading('External alternatives', { size: 12 });
    externals.slice(0, 8).forEach((e) => {
      b.text(`${e.title || e.link || 'Result'}${e.link ? ` — ${e.link}` : ''}`, { size: 8.5, color: C.muted, gap: 3 });
    });
  }
}

async function buildProductScoutReportPdfBuffer(result) {
  if (!result) throw new Error('result is required');
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle('Product Scout Report');
  pdfDoc.setAuthor('Curam Vault');
  pdfDoc.setCreator('Curam Vault');

  const reg = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fonts = { reg, bold };
  const b = makeBuilder(pdfDoc, fonts);

  if (result.mode === 'guide') {
    buildGuideReport(b, result, fonts);
  } else {
    buildScoutReport(b, result, fonts);
  }

  return pdfDoc.save();
}

module.exports = { buildProductScoutReportPdfBuffer };
