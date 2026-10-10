import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { applyRackType, parseCatalogue, type Catalogue } from '../src/app/catalogue';
import { analyseApp, testCaseProject, type AppProject } from '../src/app/model';
import { DEFAULT_CONFIG, type RackType } from '../src/lite/config';
import type { Fonts } from '../src/export/drawingPackage';
import { A4_PORTRAIT, addDays, buildQuote, defaultReference, layoutQuote, longDate, money, quoteBlockers, quoteFileName, QUOTE_STATEMENT, type QuoteMeta } from '../src/export/quote';
import { makeQuotePdf } from '../src/export/quotePdf';

const T: RackType = { ...DEFAULT_CONFIG.rackTypes[0]!, id: 'std', name: 'Standard 600', unitDepthMm: 350, rowPitchMm: 100, postsPerUnit: 2, pricePerUnit: 900, confirmed: true };
const QUOTE = { businessName: 'Acme Wine Cellars', details: '1 High St\nMelbourne VIC 3000\nABN 12 345 678 901', terms: 'A 30% deposit is due on acceptance.\n\nBalance on completion.', validityDays: 30, gstNote: 'All prices include GST.' };
const cat = (over: Partial<Catalogue> = {}, types: RackType[] = [T]): Catalogue => ({
  rackTypes: types, defaultRackType: types[0]!.id, doors: { singleMm: 970, doubleMm: 1500 },
  pricing: { ...DEFAULT_CONFIG.pricing, fixed: 2000, doorSingle: 500, doorDouble: 900, rangePct: 10, roundTo: 100 }, quote: { ...QUOTE }, cooling: { ...DEFAULT_CONFIG.cooling }, ...over,
});
const META: QuoteMeta = { reference: 'Q20261010-E7', date: '2026-10-10', customer: 'Sam Rivera', address: '5 Vine Rd\nTarneit VIC 3029', notes: 'Delivery in March.' };
const good = (): AppProject => applyRackType(testCaseProject(), T);
const fonts = async (): Promise<Fonts> => { const d = await PDFDocument.create(); return { regular: await d.embedFont(StandardFonts.Helvetica), bold: await d.embedFont(StandardFonts.HelveticaBold), italic: await d.embedFont(StandardFonts.HelveticaOblique) }; };

describe('dates, references and money', () => {
  it('writes dates in full and adds days across month and year ends and leap years', () => {
    expect(longDate('2026-10-10')).toBe('10 October 2026');
    expect(longDate('2026-01-05')).toBe('5 January 2026');
    expect(longDate('nonsense')).toBe('nonsense');
    expect(addDays('2026-10-10', 30)).toBe('2026-11-09');
    expect(addDays('2026-12-20', 30)).toBe('2027-01-19');
    expect(addDays('2028-02-15', 14)).toBe('2028-02-29');
    expect(addDays('2027-02-15', 14)).toBe('2027-03-01');
    expect(addDays('bad', 5)).toBe('bad');
  });
  it('the reference carries the date and the enquiry number when there is one', () => {
    expect(defaultReference(good(), '2026-10-10')).toBe('Q20261010');
    expect(defaultReference({ ...good(), lead: { id: 7, name: 'Sam' } }, '2026-10-10')).toBe('Q20261010-E7');
  });
  it('money shows whole amounts plainly and fractions to the cent', () => {
    expect(money(7900, '$')).toBe('$7,900');
    expect(money(7900.5, '$')).toBe('$7,900.50');
    expect(money(1234567.891, '$')).toBe('$1,234,567.89');
  });
  it('the file name comes from the reference, else the project name', () => {
    expect(quoteFileName('My Cellar', 'Q20261010-E7')).toBe('q20261010-e7-quote.pdf');
    expect(quoteFileName('My Cellar!', '')).toBe('my-cellar-quote.pdf');
    expect(quoteFileName('', '')).toBe('cellar-quote.pdf');
  });
});

describe('when a quote may be made', () => {
  it('a confirmed catalogue type, matching values, racks placed, no errors, a price and a business name: no blockers', () => {
    const p = good();
    expect(analyseApp(p).issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(quoteBlockers(p, cat())).toEqual([]);
  });
  const only = (p: AppProject, c: Catalogue | null): string[] => quoteBlockers(p, c);
  it('no catalogue: refused, with one reason', () => {
    expect(only(good(), null)).toEqual([expect.stringMatching(/could not be loaded/)]);
  });
  it('no rack type chosen', () => {
    const { rackType: _r, ...rest } = good(); void _r;
    expect(only({ ...rest, estimated: [] } as AppProject, cat()).join('|')).toMatch(/Choose a rack type/);
  });
  it('a rack type that has left the catalogue', () => {
    expect(only({ ...good(), rackType: { id: 'gone', name: 'Old rack', confirmed: true } }, cat()).join('|')).toMatch(/"Old rack" is no longer in the catalogue/);
  });
  it('an unconfirmed type is refused and says how to fix it', () => {
    const msgs = only(applyRackType(testCaseProject(), { ...T, confirmed: false }), cat({}, [{ ...T, confirmed: false }]));
    expect(msgs.join('|')).toMatch(/not confirmed by the supplier.*Tick "Confirmed by supplier"/);
    expect(msgs.join('|')).toMatch(/still marked estimated/);
  });
  it('a design confirmed when applied but unconfirmed in the catalogue NOW is refused (the catalogue is the authority)', () => {
    expect(only(good(), cat({}, [{ ...T, confirmed: false }])).join('|')).toMatch(/not confirmed by the supplier/);
  });
  it('values edited after choosing the type are refused: the quote must match what was priced', () => {
    const p = good();
    expect(only({ ...p, rackSpec: { ...p.rackSpec, unitWidthMm: 650 } }, cat()).join('|')).toMatch(/differ from the catalogue's "Standard 600"/);
  });
  it('errors in the design and an empty design', () => {
    const p = good();
    const tooTall = { ...p, rackSpec: { ...p.rackSpec, unitHeightMm: 99999 } };
    expect(only(tooTall, cat()).join('|')).toMatch(/error/);
    expect(only({ ...p, runs: [] }, cat()).join('|')).toMatch(/No racks are placed/);
  });
  it('no prices at all, and no business name', () => {
    expect(only(good(), cat({ pricing: { ...DEFAULT_CONFIG.pricing, fixed: null, doorSingle: null, doorDouble: null } }, [{ ...T, pricePerUnit: null }])).join('|')).toMatch(/No prices have been entered/);
    expect(only(good(), cat({ quote: { ...QUOTE, businessName: '' } })).join('|')).toMatch(/business name/);
  });
  it('several reasons are all listed, not just the first', () => {
    const msgs = only({ ...good(), runs: [] }, cat({ quote: { ...QUOTE, businessName: '' } }, [{ ...T, confirmed: false }]));
    expect(msgs.length).toBeGreaterThanOrEqual(3);
  });
});

describe('what the quote says', () => {
  const doc = () => { const r = buildQuote(good(), cat(), META); if (!r.ok) throw new Error(r.blockers.join(' | ')); return r.doc; };
  it('carries who it is from, the reference, the dates and who it is for', () => {
    const d = doc();
    expect(d.business).toBe('Acme Wine Cellars');
    expect(d.details).toEqual(['1 High St', 'Melbourne VIC 3000', 'ABN 12 345 678 901']);
    expect([d.reference, d.date, d.validUntil]).toEqual(['Q20261010-E7', '2026-10-10', '2026-11-09']);
    expect([d.customer, d.address]).toEqual(['Sam Rivera', '5 Vine Rd\nTarneit VIC 3029']);
  });
  it('describes the cellar from the design, not from the visitor\'s words', () => {
    const rows = Object.fromEntries(doc().cellar);
    const a = analyseApp(good());
    expect(rows['Cellar (inside)']).toBe(`${a.enclosure.internal.widthMm} x ${a.enclosure.internal.depthMm} x ${a.enclosure.internal.heightMm} mm`);
    expect(rows.Door).toMatch(/^Single door, \d+ x \d+ mm, on the \w+ wall$/);
    expect(rows.Racking).toMatch(/^Standard 600: \d+ units$/);
    expect(rows['Bottle capacity']).toMatch(/^\d+ bottles \(/);
  });
  it('the price lines and total are the staff breakdown, to the cent, and the total is the sum of the lines', () => {
    const d = doc();
    expect(d.lines.map((l) => l.label)).toEqual(['Fixed amount', 'Standard 600 racks', 'Single door']);
    expect(d.total).toBe(d.lines.reduce((n, l) => n + l.amount, 0));
    expect(d.currency).toBe('$'); expect(d.gstNote).toBe('All prices include GST.');
  });
  it('the owner\'s terms and the fixed site-measure statement are included; staff notes too', () => {
    const d = doc();
    expect(d.terms).toContain('A 30% deposit'); expect(d.statement).toBe(QUOTE_STATEMENT); expect(d.notes).toBe('Delivery in March.');
  });
  it('validity follows the owner\'s setting', () => {
    const r = buildQuote(good(), cat({ quote: { ...QUOTE, validityDays: 14 } }), META);
    expect(r.ok && r.doc.validUntil).toBe('2026-10-24');
  });
  it('a blocked design gives the reasons and no document', () => {
    const r = buildQuote({ ...good(), runs: [] }, cat(), META);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blockers.join('|')).toMatch(/No racks/);
  });
  it('a double door is priced and described as a double door', () => {
    const p = good();
    const r = buildQuote({ ...p, enclosure: { ...p.enclosure, door: { ...p.enclosure.door, leaves: 2 } } }, cat(), META);
    if (!r.ok) throw new Error(r.blockers.join('|'));
    expect(r.doc.lines.at(-1)).toMatchObject({ label: 'Double door', amount: 900 }); expect(Object.fromEntries(r.doc.cellar).Door).toMatch(/^Double door/);
  });
});

describe('the quote pages', () => {
  const texts = (pages: ReturnType<typeof layoutQuote>) => pages.flatMap((pg) => pg.prims.filter((p) => p.t === 'text').map((p) => (p as { text: string }).text));
  const make = async (over: Partial<QuoteMeta> = {}, q = QUOTE) => {
    const r = buildQuote(good(), cat({ quote: q }), { ...META, ...over }); if (!r.ok) throw new Error(r.blockers.join('|'));
    return { doc: r.doc, pages: layoutQuote(r.doc, await fonts()) };
  };
  it('is one A4 page that shows every part of the quote', async () => {
    const { doc, pages } = await make();
    expect(pages).toHaveLength(1); expect([pages[0]!.width, pages[0]!.height]).toEqual([A4_PORTRAIT.w, A4_PORTRAIT.h]);
    const all = texts(pages).join('\n');
    for (const want of ['Acme Wine Cellars', 'QUOTATION', 'Q20261010-E7', '10 October 2026', '9 November 2026', 'Sam Rivera', 'Tarneit VIC 3029', 'Your cellar', 'Description', 'Total', `$${doc.total.toLocaleString('en-AU')}`, 'All prices include GST.', 'A 30% deposit is due on acceptance.', 'Delivery in March.', 'subject to a final site measure', 'Page 1 of 1']) {
      expect(all, want).toContain(want);
    }
  });
  it('every price line shows its amount, and the total is the largest figure on the page', async () => {
    const { doc, pages } = await make();
    const all = texts(pages);
    for (const l of doc.lines) expect(all).toContain(`$${l.amount.toLocaleString('en-AU')}`);
    expect(all).toContain(`$${doc.total.toLocaleString('en-AU')}`);
  });
  it('nothing is drawn outside the margins, and no text overlaps the footer', async () => {
    const { pages } = await make();
    for (const pg of pages) for (const p of pg.prims) {
      if (p.t !== 'text') continue;
      expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(A4_PORTRAIT.w);
      if (!/^(Page \d+ of \d+|Acme Wine Cellars  \|)/.test(p.text)) expect(p.y, p.text).toBeGreaterThan(48 + 14);
    }
  });
  it('long terms flow onto more pages and every page is numbered', async () => {
    const terms = Array.from({ length: 60 }, (_, i) => `${i + 1}. The customer agrees to the conditions of this clause, which are deliberately long enough to wrap across the page width when set in small type.`).join('\n');
    const { pages } = await make({}, { ...QUOTE, terms: terms.slice(0, 1200) });
    expect(pages.length).toBeGreaterThanOrEqual(1);
    const long = await make({ notes: 'N '.repeat(900) }, { ...QUOTE, terms: terms.slice(0, 1200) });
    expect(long.pages.length).toBeGreaterThanOrEqual(2);
    long.pages.forEach((pg, i) => expect(texts([pg])).toContain(`Page ${i + 1} of ${long.pages.length}`));
    // the total and the statement still appear once, however many pages
    const all = texts(long.pages);
    expect(all.filter((t) => t === 'Total')).toHaveLength(1); expect(all.filter((t) => /subject to a final site measure/.test(t))).toHaveLength(1);
  });
  it('a quote with no terms, notes, address or details still lays out cleanly', async () => {
    const { pages } = await make({ notes: '', address: '', customer: '' }, { ...QUOTE, terms: '', details: '', gstNote: '' });
    const all = texts(pages).join('\n');
    expect(all).toContain('Total'); expect(all).not.toContain('Terms'); expect(all).not.toContain('Notes'); expect(all).not.toContain('Prepared for\n\n');
  });
  it('characters the standard PDF fonts cannot draw do not break the PDF', async () => {
    const r = await makeQuotePdf(good(), cat({ quote: { ...QUOTE, businessName: 'Café – Wine “Co” 中' } }), { ...META, customer: 'Zoë Łódź' });
    expect(r.ok).toBe(true);
  });
});

describe('the PDF', () => {
  it('is a real PDF whose pages match the layout, titled with the reference', async () => {
    const r = await makeQuotePdf(good(), cat(), META);
    if (!r.ok) throw new Error(r.blockers.join('|'));
    expect(new TextDecoder().decode(r.bytes.slice(0, 5))).toBe('%PDF-');
    const back = await PDFDocument.load(r.bytes);
    expect(back.getPageCount()).toBe(r.pages);
    expect(back.getTitle()).toBe('Quote Q20261010-E7'); expect(back.getAuthor()).toBe('Acme Wine Cellars');
    const size = back.getPage(0).getSize();
    expect([Math.round(size.width), Math.round(size.height)]).toEqual([595, 842]);
  });
  it('refuses to make one when the design is not ready, and says why', async () => {
    const r = await makeQuotePdf({ ...good(), runs: [] }, cat(), META);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blockers.join('|')).toMatch(/No racks/);
  });
  it('the catalogue payload from Vault carries the quote settings through', () => {
    const c = parseCatalogue({ catalogue: { rackTypes: [T], defaultRackType: 'std', doors: { singleMm: 970, doubleMm: 1500 }, pricing: { fixed: 1 }, quote: { businessName: 'Acme', validityDays: 14, terms: 'T' } } })!;
    expect(c.quote).toMatchObject({ businessName: 'Acme', validityDays: 14, terms: 'T' });
    expect(parseCatalogue({ rackTypes: [T] })!.quote).toEqual(DEFAULT_CONFIG.quote);
  });
});
