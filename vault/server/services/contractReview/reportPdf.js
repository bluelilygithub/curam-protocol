'use strict';

// Contract Review — PDF report export. Server-side pdf-lib, same builder
// shape as propertyScenarioPdf.js (this codebase's established pattern for
// an agent-generated report) — a plain page/text/section builder, not
// @react-pdf/renderer, so there's no client-side rendering dependency.
// Stateless: takes the already-loaded contract/review/obligations objects
// (as ContractService.getContract/getReview/listObligations already
// return them) and returns a PDF buffer — no new persistence.

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const C = {
  primary: rgb(0.80, 0.47, 0.36), // #CC785C
  text: rgb(0.10, 0.10, 0.10),
  muted: rgb(0.53, 0.53, 0.53),
  border: rgb(0.85, 0.85, 0.81),
  bgAlt: rgb(0.96, 0.96, 0.94),
  green: rgb(0.08, 0.60, 0.24),
  red: rgb(0.73, 0.11, 0.11),
  amber: rgb(0.57, 0.25, 0.04),
  white: rgb(1, 1, 1),
};

const RISK_COLOR = { risky: C.red, unclear: C.amber, standard: C.green };
const RISK_LABEL = { risky: 'Risky', unclear: 'Unclear', standard: 'Standard' };

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
  const PAGE_W = 595, PAGE_H = 842;
  const MARGIN = 44;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const { reg, bold, italic } = fonts;

  let page;
  let y;

  function addFooter() {
    page.drawText(clean('Contract Review Report · Curam Vault · Informational only, not legal advice. Always confirm important decisions with a qualified lawyer.'), {
      x: MARGIN, y: 22, size: 6.5, font: reg, color: C.muted,
    });
  }

  function newPage() {
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
    addFooter();
  }

  function ensureSpace(needed) {
    if (y - needed < MARGIN + 24) newPage();
  }

  function text(str, { x = MARGIN, size = 9, font: f = reg, color = C.text, indent = 0, gap: g = 3 } = {}) {
    const lines = wordWrap(str, f, size, CONTENT_W - indent);
    for (const line of lines) {
      ensureSpace(size + g);
      if (line) page.drawText(line, { x: x + indent, y, size, font: f, color });
      y -= size + g;
    }
  }

  function hline() {
    ensureSpace(4);
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + CONTENT_W, y }, thickness: 0.5, color: C.border });
    y -= 4;
  }

  function gap(n = 6) { y -= n; }

  function sectionTitle(str) {
    ensureSpace(24);
    gap(6);
    text(str, { size: 12, font: bold, color: C.text });
    hline();
    gap(2);
  }

  function row(label, value) {
    const lw = CONTENT_W * 0.32;
    const lLines = wordWrap(label, reg, 8.5, lw - 6);
    const vLines = wordWrap(String(value ?? '-'), bold, 8.5, CONTENT_W - lw);
    const n = Math.max(lLines.length, vLines.length);
    ensureSpace(n * 11 + 2);
    for (let i = 0; i < n; i++) {
      if (lLines[i]) page.drawText(lLines[i], { x: MARGIN, y, size: 8.5, font: reg, color: C.muted });
      if (vLines[i]) page.drawText(vLines[i], { x: MARGIN + lw, y, size: 8.5, font: bold, color: C.text });
      y -= 11;
    }
  }

  // A flag/obligation card with a coloured left bar — same visual language
  // as propertyScenarioPdf.js's highlight()/warn(), generalized to any
  // accent colour.
  function card(lines, { accent = C.border } = {}) {
    const rendered = lines.filter(Boolean);
    const heights = rendered.map((l) => wordWrap(l.str, l.font || reg, l.size || 8.5, CONTENT_W - 14).length * ((l.size || 8.5) + 2));
    const totalH = heights.reduce((a, b) => a + b, 0) + 8;
    ensureSpace(totalH + 6);
    const top = y;
    page.drawLine({ start: { x: MARGIN, y: top - totalH }, end: { x: MARGIN, y: top + 2 }, thickness: 2.5, color: accent });
    y -= 4;
    for (const l of rendered) {
      text(l.str, { indent: 10, size: l.size || 8.5, font: l.font || reg, color: l.color || C.text, gap: 2 });
    }
    gap(6);
  }

  function note(str) {
    text(str, { size: 7.5, font: italic || reg, color: C.muted });
    gap(2);
  }

  newPage();
  return { newPage, text, hline, gap, sectionTitle, row, card, note };
}

function formatObligationTiming(o) {
  if (o.absoluteDate) return new Date(o.absoluteDate).toLocaleDateString('en-AU');
  if (o.rrule) return `Recurring (${o.rrule})`;
  if (o.anchorEvent) {
    const anchorLabel = {
      effective_date: 'the effective date', renewal_date: 'renewal', invoice_date: 'invoice date',
      termination: 'termination', custom: o.anchorCustomLabel || 'a custom event',
    }[o.anchorEvent] || o.anchorEvent;
    if (o.offsetDays != null) {
      const days = Math.abs(o.offsetDays);
      const direction = o.offsetDays < 0 ? 'before' : 'after';
      return `${days} day${days === 1 ? '' : 's'} ${direction} ${anchorLabel}`;
    }
    return anchorLabel;
  }
  return 'No fixed date';
}

/**
 * @param {object} contract - ContractService.getContract result (has .parties)
 * @param {object} review - ContractService.getReview result (has .clauses/.definitions)
 * @param {Array} obligations - ContractService.listObligations result
 * @param {number|null} reviewingAsPartyId - review.userPartyId
 */
async function buildContractReviewPdfBuffer(contract, review, obligations, reviewingAsPartyId) {
  const pdfDoc = await PDFDocument.create();
  const CREATION_DATE = new Date('2024-01-01T00:00:00Z');
  pdfDoc.setCreationDate(CREATION_DATE);
  pdfDoc.setModificationDate(CREATION_DATE);
  const reg = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const b = makeBuilder(pdfDoc, { reg, bold, italic });

  // ── Header / not-legal-advice banner ────────────────────────────────────
  b.text('Contract Review Report', { size: 18, font: bold, color: C.primary });
  b.text(clean(contract.title || 'Untitled contract'), { size: 11, font: bold });
  const generatedAt = new Date().toLocaleString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  b.text(`Generated ${generatedAt} · ${contract.contractType || 'other'} · ${contract.status || 'draft'}`, { size: 8, color: C.muted });
  b.gap(4);
  b.card([{ str: 'Informational only — not legal advice. Always confirm important decisions with a qualified lawyer.', font: bold, color: C.amber }], { accent: C.amber });

  // ── Parties + role ───────────────────────────────────────────────────────
  b.sectionTitle('Parties');
  for (const p of contract.parties || []) {
    const isReviewer = reviewingAsPartyId && p.id === reviewingAsPartyId;
    b.row(p.name + (isReviewer ? '  (reviewing as)' : ''), `${p.role}${p.confirmedByUser ? '' : ' · unconfirmed'}`);
  }
  if (!contract.parties?.length) b.note('No parties recorded.');

  // ── Flags ────────────────────────────────────────────────────────────────
  const clauses = (review?.clauses || []).filter((c) => !c.isContextOnly);
  const risky = clauses.filter((c) => c.riskLevel === 'risky');
  const unclear = clauses.filter((c) => c.riskLevel === 'unclear');
  const standardCount = clauses.filter((c) => c.riskLevel === 'standard').length;

  b.sectionTitle('Flags');
  b.text(`${clauses.length} clause${clauses.length === 1 ? '' : 's'} assessed — ${risky.length} risky, ${unclear.length} unclear, ${standardCount} standard.`, { size: 8.5, color: C.muted });
  b.gap(4);
  for (const c of [...risky, ...unclear]) {
    const lines = [
      { str: `${c.numberLabel ? c.numberLabel + ' — ' : ''}${RISK_LABEL[c.riskLevel] || c.riskLevel}`, font: bold, color: RISK_COLOR[c.riskLevel] || C.text },
      c.whyItMatters ? { str: c.whyItMatters, size: 8 } : null,
      c.suggestedRedline ? { str: `Suggested redline (advisory): ${c.suggestedRedline}`, size: 7.5, font: italic, color: C.muted } : null,
    ];
    b.card(lines, { accent: RISK_COLOR[c.riskLevel] || C.border });
  }
  if (!risky.length && !unclear.length) b.note('No risky or unclear clauses flagged.');

  // ── Obligations ──────────────────────────────────────────────────────────
  b.sectionTitle('What you need to do');
  const partyById = new Map((contract.parties || []).map((p) => [p.id, p]));
  for (const o of obligations || []) {
    const obligor = o.obligorPartyId ? partyById.get(o.obligorPartyId)?.name : null;
    const lines = [
      { str: o.description, font: bold },
      { str: `Owed by: ${obligor || 'Unresolved'}  ·  Due: ${formatObligationTiming(o)}  ·  Status: ${(o.derivedStatus || '').replace(/_/g, ' ')}`, size: 8, color: C.muted },
    ];
    b.card(lines, { accent: o.derivedStatus === 'overdue' ? C.red : C.border });
  }
  if (!obligations?.length) b.note('No obligations extracted for an active (executed) document.');

  return pdfDoc.save();
}

module.exports = { buildContractReviewPdfBuffer, formatObligationTiming };
