import { wrapText, type Prim, type Rgb } from '@planner-core/export/pdfDraw';
import { matchesType, staffPrice, typeById, type Catalogue, type PriceLine } from '../app/catalogue';
import { analyseApp, type Analysis, type AppProject } from '../app/model';
import { BOTTLE_PROFILES } from '../engine';
import type { Fonts } from './drawingPackage';

// The customer quote: one or more A4 pages from the staff planner's price breakdown. Built as plain content first (QuoteDoc, so tests check every word
// without a PDF reader), then laid out as drawing primitives (layoutQuote), then drawn by quotePdf.ts. A quote is only made when the numbers behind it
// can be trusted: see quoteBlockers. Prices come from the owner's catalogue (Settings -> Cellar Planner); the wording of the terms is the owner's.

export const A4_PORTRAIT = { w: 595.28, h: 841.89 };
export const QUOTE_STATEMENT = 'Prices are based on the design shown and are subject to a final site measure and confirmation of the finishes.';

export interface QuoteMeta { reference: string; date: string; customer: string; address: string; notes: string; /** The 3D picture of the inside (a JPEG data address), shown beside the cellar details. */ image?: string }

const pad = (n: number): string => String(n).padStart(2, '0');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-10-10" -> "10 October 2026". Anything else is returned as it came. */
export function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : iso;
}
/** The date `days` after an ISO date (calendar days, no time zone surprises). */
export function addDays(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
export function defaultReference(p: AppProject, date: string): string {
  return `Q${date.replace(/-/g, '')}${p.lead ? `-E${p.lead.id}` : ''}`;
}
export const money = (n: number, currency: string): string => `${currency}${n.toLocaleString('en-AU', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;

/**
 * Why a quote cannot be made yet, in plain words (empty = it can). A quote built on guessed or unconfirmed numbers must never reach a customer, so:
 * the catalogue must have loaded, the design must use a rack type from it that the supplier has confirmed, the design's rack values must still be that
 * type's, nothing may be marked estimated, there must be racks and no errors, a price must exist, and the quote needs the business's name.
 */
export function quoteBlockers(p: AppProject, cat: Catalogue | null, a: Analysis = analyseApp(p)): string[] {
  const out: string[] = [];
  if (!cat) return ['The rack catalogue could not be loaded, so there are no prices. Sign in to Vault and reload.'];
  const t = typeById(cat, p.rackType?.id);
  if (!p.rackType) out.push('Choose a rack type (Rack specification) so the design can be priced.');
  else if (!t) out.push(`The rack type "${p.rackType.name}" is no longer in the catalogue. Choose another.`);
  else {
    if (!t.confirmed) out.push(`"${t.name}" is not confirmed by the supplier. Tick "Confirmed by supplier" in Settings, Cellar Planner, once its values are real, then use the catalogue's values again.`);
    if (!matchesType(p, t)) out.push(`The rack values differ from the catalogue's "${t.name}". Use the catalogue's values again, so the quote matches what was priced.`);
  }
  if (p.estimated?.length) out.push('Some rack values are still marked estimated. Type the supplier\'s numbers over them, or use a confirmed rack type.');
  const errors = a.issues.filter((i) => i.severity === 'error').length;
  if (errors) out.push(`${errors} check${errors === 1 ? '' : 's'} in this design show${errors === 1 ? 's' : ''} an error. Fix ${errors === 1 ? 'it' : 'them'} first.`);
  if (!p.runs.length) out.push('No racks are placed yet.');
  else if (a.racks.total.status !== 'OK') out.push('The bottle count is not set yet: the rack values are incomplete.');
  const price = staffPrice(p, cat);
  if (price.status !== 'OK' && !out.some((x) => /rack type|catalogue|No racks/i.test(x))) out.push(price.reason);
  if (!cat.quote.businessName) out.push('Enter your business name in Settings, Cellar Planner, Quote details: a quote needs to say who it is from.');
  return out;
}

export interface QuoteDoc {
  business: string; details: string[];
  reference: string; date: string; validUntil: string;
  customer: string; address: string; project: string;
  cellar: Array<[string, string]>;
  lines: PriceLine[]; total: number; currency: string; gstNote: string;
  notes: string; terms: string; statement: string;
  image?: string;
}

/** The quote's content, or the reasons it cannot be made. */
export function buildQuote(p: AppProject, cat: Catalogue | null, meta: QuoteMeta): { ok: true; doc: QuoteDoc } | { ok: false; blockers: string[] } {
  const a = analyseApp(p);
  const blockers = quoteBlockers(p, cat, a);
  if (blockers.length || !cat) return { ok: false, blockers };
  const price = staffPrice(p, cat);
  if (price.status !== 'OK') return { ok: false, blockers: [price.reason] };
  const e = p.enclosure, t = typeById(cat, p.rackType?.id);
  const units = p.runs.reduce((n, r) => n + (Number.isFinite(r.units) && r.units > 0 ? Math.floor(r.units) : 0), 0);
  const bottles = a.racks.total.status === 'OK' ? a.racks.total.capacity : null;
  const cellar: Array<[string, string]> = [
    ['Cellar (inside)', `${a.enclosure.internal.widthMm} x ${a.enclosure.internal.depthMm} x ${a.enclosure.internal.heightMm} mm`],
    ['Door', `${e.door.leaves === 2 ? 'Double door' : 'Single door'}, ${e.door.widthMm} x ${e.door.heightMm} mm, on the ${e.door.wall.toLowerCase()} wall`],
    ['Racking', `${t?.name ?? p.rackType?.name ?? 'Racks'}: ${units} unit${units === 1 ? '' : 's'}`],
    ...(bottles !== null ? [['Bottle capacity', `${bottles} bottles (${BOTTLE_PROFILES[p.bottle].label})`] as [string, string]] : []),
  ];
  return {
    ok: true,
    doc: {
      business: cat.quote.businessName, details: cat.quote.details ? cat.quote.details.split('\n') : [],
      reference: meta.reference.trim(), date: meta.date, validUntil: addDays(meta.date, cat.quote.validityDays),
      customer: meta.customer.trim(), address: meta.address.trim(), project: p.name,
      cellar, lines: price.lines, total: price.total, currency: price.currency, gstNote: cat.quote.gstNote,
      notes: meta.notes.trim(), terms: cat.quote.terms, statement: QUOTE_STATEMENT,
      ...(meta.image ? { image: meta.image } : {}),
    },
  };
}

// ---------------------------------------------------------------- layout

export interface QuotePage { width: number; height: number; prims: Prim[]; images?: Array<{ dataUrl: string; x: number; y: number; w: number; h: number }> }
const INK: Rgb = [0.1, 0.1, 0.1], MUTED: Rgb = [0.4, 0.4, 0.4], RULE: Rgb = [0.78, 0.78, 0.74], BAND: Rgb = [0.93, 0.93, 0.9];
const M = 48; // margin, points

/** Lay the quote out on A4 pages as drawing primitives (y up, points). Long terms flow onto extra pages. */
export function layoutQuote(doc: QuoteDoc, f: Fonts): QuotePage[] {
  const W = A4_PORTRAIT.w, H = A4_PORTRAIT.h, R = W - M, wide = W - 2 * M;
  const pages: QuotePage[] = [];
  let page!: QuotePage; let y = 0;
  const newPage = (): void => { page = { width: W, height: H, prims: [] }; pages.push(page); y = H - M; };
  const text = (s: string, x: number, size: number, o: { bold?: boolean; italic?: boolean; color?: Rgb; anchor?: 'left' | 'centre' | 'right' } = {}): void => {
    page.prims.push({ t: 'text', x, y, size, text: s, anchor: o.anchor ?? 'left', color: o.color ?? INK, ...(o.bold ? { bold: true } : {}), ...(o.italic ? { italic: true } : {}) });
  };
  const rule = (yy: number, color: Rgb = RULE): void => { page.prims.push({ t: 'line', a: { x: M, y: yy }, b: { x: R, y: yy }, width: 0.6, color }); };
  const need = (h: number): void => { if (y - h < M + 40) newPage(); };
  const para = (s: string, size: number, o: { bold?: boolean; italic?: boolean; color?: Rgb; width?: number; x?: number } = {}): void => {
    const font = o.bold ? f.bold : o.italic ? f.italic : f.regular;
    for (const block of s.split('\n')) {
      if (!block.trim()) { y -= size * 0.8; continue; }
      for (const line of wrapText(font, block, size, o.width ?? wide)) { need(size * 1.4); text(line, o.x ?? M, size, o); y -= size * 1.4; }
    }
  };

  newPage();
  // header: who it is from, and the document title at the right
  text(doc.business, M, 20, { bold: true });
  text('QUOTATION', R, 20, { bold: true, anchor: 'right', color: MUTED });
  y -= 18;
  const meta: Array<[string, string]> = [['Reference', doc.reference], ['Date', longDate(doc.date)], ['Valid until', longDate(doc.validUntil)]].filter(([, v]) => v) as Array<[string, string]>;
  const left = doc.details.slice(0, 6);
  const rows = Math.max(left.length, meta.length);
  for (let i = 0; i < rows; i++) {
    if (left[i]) text(left[i] as string, M, 9, { color: MUTED });
    const m = meta[i];
    if (m) { text(m[1], R, 9.5, { anchor: 'right', bold: true }); text(`${m[0]}:`, R - 4 - f.bold.widthOfTextAtSize(m[1], 9.5), 9, { anchor: 'right', color: MUTED }); }
    y -= 13;
  }
  y -= 6; rule(y); y -= 22;

  // who it is for
  text('Prepared for', M, 8.5, { bold: true, color: MUTED }); y -= 14;
  if (doc.customer) { text(doc.customer, M, 12, { bold: true }); y -= 15; }
  if (doc.address) para(doc.address, 10, { color: INK });
  y -= 10;

  // the cellar
  // the 3D picture of the inside sits to the right of the details (about 240 x 152 pt), so the details wrap in the space that is left
  const PIC_W = 240, PIC_H = 152;
  need(Math.max(24 + doc.cellar.length * 16, doc.image ? PIC_H + 20 : 0));
  const sectionTop = y;
  text('Your cellar', M, 8.5, { bold: true, color: MUTED }); y -= 14;
  const valueWidth = doc.image ? wide - 130 - PIC_W - 14 : wide - 130;
  for (const [k, v] of doc.cellar) {
    need(16);
    text(k, M, 10, { color: MUTED });
    const lines = wrapText(f.regular, v, 10, valueWidth);
    lines.forEach((l, i) => { if (i) { y -= 13; need(14); } text(l, M + 130, 10); });
    y -= 16;
  }
  if (doc.image) {
    (page.images ??= []).push({ dataUrl: doc.image, x: R - PIC_W, y: sectionTop - 10 - PIC_H, w: PIC_W, h: PIC_H });
    y = Math.min(y, sectionTop - 10 - PIC_H - 6); // the table starts below the picture
  }
  y -= 8;

  // the price table
  need(60 + doc.lines.length * 20);
  page.prims.push({ t: 'poly', pts: [{ x: M, y: y + 13 }, { x: R, y: y + 13 }, { x: R, y: y - 5 }, { x: M, y: y - 5 }], fill: BAND });
  text('Description', M + 8, 9, { bold: true }); text('Amount', R - 8, 9, { bold: true, anchor: 'right' });
  y -= 30;
  for (const l of doc.lines) {
    need(22);
    text(l.label, M + 8, 10.5);
    if (l.detail) { y -= 12; text(l.detail, M + 8, 9, { color: MUTED }); }
    // the amount sits on the first line of the row
    page.prims.push({ t: 'text', x: R - 8, y: y + (l.detail ? 12 : 0), size: 10.5, text: money(l.amount, doc.currency), anchor: 'right', color: INK });
    y -= 10; rule(y); y -= 14;
  }
  need(40);
  text('Total', M + 8, 12, { bold: true }); text(money(doc.total, doc.currency), R - 8, 14, { bold: true, anchor: 'right' });
  y -= 18;
  if (doc.gstNote) { text(doc.gstNote, R - 8, 8.5, { anchor: 'right', color: MUTED }); y -= 12; }
  y -= 14;

  if (doc.notes) { need(40); text('Notes', M, 8.5, { bold: true, color: MUTED }); y -= 14; para(doc.notes, 10); y -= 8; }
  if (doc.terms) { need(40); text('Terms', M, 8.5, { bold: true, color: MUTED }); y -= 14; para(doc.terms, 9, { color: [0.2, 0.2, 0.2] }); y -= 6; }
  need(30);
  para(doc.statement, 9, { italic: true, color: MUTED });

  // footer on every page
  pages.forEach((pg, i) => {
    pg.prims.push({ t: 'line', a: { x: M, y: M + 14 }, b: { x: R, y: M + 14 }, width: 0.5, color: RULE });
    pg.prims.push({ t: 'text', x: M, y: M, size: 8, text: `${doc.business}${doc.reference ? `  |  Quote ${doc.reference}` : ''}`, anchor: 'left', color: MUTED });
    pg.prims.push({ t: 'text', x: R, y: M, size: 8, text: `Page ${i + 1} of ${pages.length}`, anchor: 'right', color: MUTED });
  });
  return pages;
}

export const quoteFileName = (project: string, reference: string): string => {
  const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug(reference) || slug(project) || 'cellar'}-quote.pdf`;
};
