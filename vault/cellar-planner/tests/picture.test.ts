import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { applyRackType } from '../src/app/catalogue';
import { deserializeApp, serializeApp, testCaseProject } from '../src/app/model';
import { A3_LANDSCAPE, buildSheets, placeImage, type Fonts, type Sheet } from '../src/export/drawingPackage';
import { makePackagePdf } from '../src/export/packagePdf';
import { A4_PORTRAIT, buildQuote, layoutQuote } from '../src/export/quote';
import { makeQuotePdf } from '../src/export/quotePdf';
import { DEFAULT_CONFIG, type RackType } from '../src/lite/config';
import { dataUrlBytes } from '../src/lite/thumbnail';

// a 1x1 JPEG, so the PDF code really embeds an image
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const T: RackType = { ...DEFAULT_CONFIG.rackTypes[0]!, id: 'std', name: 'Standard 600', unitDepthMm: 350, rowPitchMm: 100, postsPerUnit: 2, pricePerUnit: 900, confirmed: true };
const cat = () => ({ rackTypes: [T], defaultRackType: 'std', doors: { singleMm: 970, doubleMm: 1500 }, pricing: { ...DEFAULT_CONFIG.pricing, fixed: 2000, doorSingle: 500, rangePct: 10, roundTo: 100 }, quote: { ...DEFAULT_CONFIG.quote, businessName: 'Acme Wine Cellars', terms: 'A deposit is due.' }, cooling: { ...DEFAULT_CONFIG.cooling } });
const META = { reference: 'Q1', date: '2026-10-10', customer: 'Sam', address: '5 Vine Rd', notes: '' };
const good = () => applyRackType(testCaseProject(), T);
const fonts = async (): Promise<Fonts> => { const d = await PDFDocument.create(); return { regular: await d.embedFont(StandardFonts.Helvetica), bold: await d.embedFont(StandardFonts.HelveticaBold), italic: await d.embedFont(StandardFonts.HelveticaOblique) }; };
const hasImage = (bytes: Uint8Array): boolean => new TextDecoder('latin1').decode(bytes).includes('/Subtype /Image');

describe('reading a picture address', () => {
  it('gives the bytes of a JPEG data address', () => {
    const b = dataUrlBytes(JPEG)!;
    expect(b[0]).toBe(0xff); expect(b[1]).toBe(0xd8); expect(b.length).toBeGreaterThan(100);
  });
  it('refuses anything else, and never throws', () => {
    for (const bad of ['', 'x', 'data:image/png;base64,AAAA', 'data:image/jpeg;base64,', 'data:image/jpeg;base64,@@@@', 'http://x/y.jpg', 'data:image/jpeg;base64,AAA<script>']) expect(dataUrlBytes(bad), bad).toBeNull();
  });
});

describe('the rack finish is kept with the design', () => {
  it('round-trips, and anything else is dropped', () => {
    for (const f of ['OAK', 'WALNUT', 'BLACK'] as const) expect(deserializeApp(serializeApp({ ...testCaseProject(), finish: f })).finish).toBe(f);
    const raw = JSON.parse(serializeApp(testCaseProject()));
    for (const bad of ['PINK', 5, null, {}, 'oak']) expect(deserializeApp(JSON.stringify({ ...raw, finish: bad })).finish, String(bad)).toBeUndefined();
    expect(deserializeApp(JSON.stringify(raw)).finish).toBeUndefined();
  });
});

describe('the 3D sheet in the drawing package', () => {
  it('is placed inside the drawing area, centred, keeping the picture\'s proportions', () => {
    const s: Sheet = { id: 'A1', title: 't', scale: '', width: A3_LANDSCAPE.w, height: A3_LANDSCAPE.h, prims: [] };
    placeImage(s, JPEG, 1200 / 760);
    const im = s.image!;
    expect(im.w / im.h).toBeCloseTo(1200 / 760, 6);
    expect(im.x).toBeGreaterThanOrEqual(40); expect(im.x + im.w).toBeLessThanOrEqual(A3_LANDSCAPE.w - 40);
    expect(im.y).toBeGreaterThanOrEqual(20 + 4 + 78); expect(im.y + im.h).toBeLessThanOrEqual(A3_LANDSCAPE.h);
    expect(im.x + im.w / 2).toBeCloseTo(A3_LANDSCAPE.w / 2, 6);
  });
  it('a very wide or very tall picture still fits', () => {
    for (const aspect of [0.2, 1, 5, 20]) {
      const s: Sheet = { id: 'A1', title: 't', scale: '', width: A3_LANDSCAPE.w, height: A3_LANDSCAPE.h, prims: [] };
      placeImage(s, JPEG, aspect);
      const im = s.image!;
      expect(im.w).toBeLessThanOrEqual(A3_LANDSCAPE.w - 80 + 1e-6); expect(im.h).toBeLessThanOrEqual(A3_LANDSCAPE.h - 142 - 56 + 1e-6); expect(im.w / im.h).toBeCloseTo(aspect, 6);
    }
  });
  it('is added after the rack sheets, numbered, titled and marked not to scale; without a picture nothing changes', async () => {
    const f = await fonts();
    const without = buildSheets(good(), { company: '', client: '', address: '', projectNo: '', drawnBy: '', checkedBy: '', date: '2026-10-10' }, f);
    const withImg = buildSheets(good(), { company: '', client: '', address: '', projectNo: '', drawnBy: '', checkedBy: '', date: '2026-10-10' }, f, { insideImage: JPEG });
    expect(withImg.length).toBe(without.length + 1);
    const last = withImg.at(-1)!;
    expect(last.title).toBe('3D VIEW - INSIDE THE CELLAR'); expect(last.scale).toBe('NOT TO SCALE'); expect(last.image?.dataUrl).toBe(JPEG);
    expect(without.every((s) => !s.image)).toBe(true);
    expect(new Set(withImg.map((s) => s.id)).size).toBe(withImg.length); // every sheet number is unique
  });
  it('the package PDF has one more page and really contains the picture', async () => {
    const meta = { company: '', client: '', address: '', projectNo: '', drawnBy: '', checkedBy: '', date: '2026-10-10' };
    const plain = await makePackagePdf(good(), meta);
    const withPic = await makePackagePdf(good(), meta, { insideImage: JPEG });
    expect(withPic.sheets.length).toBe(plain.sheets.length + 1);
    expect((await PDFDocument.load(withPic.bytes)).getPageCount()).toBe(withPic.sheets.length);
    expect(hasImage(withPic.bytes)).toBe(true); expect(hasImage(plain.bytes)).toBe(false);
    expect(withPic.sheets.at(-1)!.title).toContain('3D VIEW');
  });
  it('a damaged picture address is skipped without breaking the PDF', async () => {
    const meta = { company: '', client: '', address: '', projectNo: '', drawnBy: '', checkedBy: '', date: '2026-10-10' };
    const r = await makePackagePdf(good(), meta, { insideImage: 'data:image/jpeg;base64,@@@' });
    expect(new TextDecoder().decode(r.bytes.slice(0, 5))).toBe('%PDF-');
    expect(hasImage(r.bytes)).toBe(false);
  });
});

describe('the picture on the customer quote', () => {
  const doc = (image?: string) => { const r = buildQuote(good(), cat(), { ...META, ...(image ? { image } : {}) }); if (!r.ok) throw new Error(r.blockers.join('|')); return r.doc; };
  it('is carried by the quote content only when there is one', () => {
    expect(doc(JPEG).image).toBe(JPEG); expect('image' in doc()).toBe(false);
  });
  it('sits to the right of the cellar details, inside the margins, and the price table starts below it', async () => {
    const pages = layoutQuote(doc(JPEG), await fonts());
    const im = pages[0]!.images![0]!;
    expect(im.x + im.w).toBeLessThanOrEqual(A4_PORTRAIT.w - 48 + 1e-6); expect(im.x).toBeGreaterThan(A4_PORTRAIT.w / 2 - 20);
    expect(im.w / im.h).toBeCloseTo(240 / 152, 6);
    const header = pages[0]!.prims.find((p) => p.t === 'text' && p.text === 'Description') as { y: number };
    expect(header.y).toBeLessThan(im.y); // the table header is below the picture's bottom edge
  });
  it('the details wrap in the space beside the picture and never run under it', async () => {
    const pages = layoutQuote(doc(JPEG), await fonts());
    const im = pages[0]!.images![0]!;
    const f = await fonts();
    for (const p of pages[0]!.prims) {
      if (p.t !== 'text' || p.anchor !== 'left' || p.x < 48 + 130 - 1) continue;
      if (p.y > im.y && p.y < im.y + im.h + 5) expect(p.x + f.regular.widthOfTextAtSize(p.text, p.size), p.text).toBeLessThanOrEqual(im.x - 4);
    }
  });
  it('without a picture the layout has no images and the details use the full width', async () => {
    expect(layoutQuote(doc(), await fonts())[0]!.images).toBeUndefined();
  });
  it('the quote PDF really contains the picture, and still has one page here', async () => {
    const r = await makeQuotePdf(good(), cat(), { ...META, image: JPEG });
    if (!r.ok) throw new Error(r.blockers.join('|'));
    expect(hasImage(r.bytes)).toBe(true); expect(r.pages).toBe(1);
    const plain = await makeQuotePdf(good(), cat(), META);
    if (!plain.ok) throw new Error(plain.blockers.join('|'));
    expect(hasImage(plain.bytes)).toBe(false);
  });
  it('a damaged picture address is skipped and the quote still makes', async () => {
    const r = await makeQuotePdf(good(), cat(), { ...META, image: 'data:image/jpeg;base64,@@@' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(hasImage(r.bytes)).toBe(false);
  });
});
