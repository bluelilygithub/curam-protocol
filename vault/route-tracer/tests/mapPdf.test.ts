import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { buildMapPdf, captureSize, chooseOrientation, makeProjector, mapArea, niceScale, pageSize, safeText, tint, wrapText } from '../src/mapPdf';

// a 2x2 white PNG
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4EIwDiqEF8AAEY4Bf8d7F8lAAAAAElFTkSuQmCC', 'base64'));
const line = (n: number): [number, number][] => Array.from({ length: n }, (_, i) => [153.0 + i * 0.002, -27.5 + Math.sin(i / 5) * 0.004] as [number, number]);
const base = { title: 'Morning loop', notes: 'Park at the gate.\nWatch for bikes.', dateLabel: '12 Oct 2026', lines: [line(120)], color: '#E4572E', units: 'km' as const, orientation: 'landscape' as const, image: { bytes: PNG, type: 'png' as const }, center: [153.12, -27.5] as [number, number], zoom: 13 };
const profile = { km: [0, 1, 2, 3], ele: [10, 40, 25, 30], totalKm: 3, ascent: 45, descent: 20, min: 10, max: 40 };
const has = (cp: number): boolean => cp >= 32 && cp < 127;

describe('page shape', () => {
  it('a wide route gets a landscape page, a tall one portrait', () => {
    expect(chooseOrientation([153.0, -27.5, 153.3, -27.49])).toBe('landscape');
    expect(chooseOrientation([153.0, -27.5, 153.01, -27.2])).toBe('portrait');
    expect(['landscape', 'portrait']).toContain(chooseOrientation([153.0, -27.5, 153.1, -27.4]));
  });
  it('the map picture is the size of its place on the page', () => {
    for (const o of ['landscape', 'portrait'] as const) {
      const a = mapArea(o); const c = captureSize(o); const p = pageSize(o);
      expect(a.x + a.w).toBeLessThanOrEqual(p.w);
      expect(a.top + a.h).toBeLessThan(p.h - 100); // room under it for the numbers
      expect(Math.abs(c.width / c.height - a.w / a.h)).toBeLessThan(0.01);
    }
  });
});

describe('where things land', () => {
  it('the centre of the map is the middle of the picture, east is right and north is up', () => {
    const p = makeProjector([153, -27], 10, 800, 600);
    expect(p([153, -27])).toEqual({ x: 400, y: 300 });
    expect(p([153.01, -27]).x).toBeGreaterThan(400);
    expect(p([153, -26.99]).y).toBeLessThan(300);
  });
  it('one degree of longitude is 512 x 2^zoom / 360 pixels', () => {
    const p = makeProjector([0, 0], 3, 100, 100);
    expect(p([1, 0]).x - 50).toBeCloseTo((512 * 8) / 360, 6);
  });
});

describe('scale bar', () => {
  it('is a round number that fits', () => {
    for (const mPerPt of [0.5, 3, 40, 900]) {
      const s = niceScale(mPerPt, 130, 'km');
      expect(s.pt).toBeLessThanOrEqual(130);
      expect(s.pt).toBeGreaterThan(130 / 5);
      expect(s.label).toMatch(/^\d+ (m|km)$/);
    }
    expect(niceScale(10, 130, 'km').label).toBe('1 km');
  });
  it('speaks miles when asked', () => {
    expect(niceScale(10, 130, 'mi').label).toMatch(/ mi$/);
  });
});

describe('text', () => {
  it('replaces what the font cannot show, and control characters', () => {
    expect(safeText('Café → 漢', has)).toBe('Caf? ? ?');
    expect(safeText('a\u0000b\tc', has)).toBe('a b c');
    expect(safeText('line\nbreak', has)).toBe('line\nbreak');
  });
  it('wraps on words, cuts a word wider than the line, and ends in dots when cut short', () => {
    const m = (s: string): number => s.length;
    expect(wrapText('one two three four', 9, m, 5)).toEqual(['one two', 'three', 'four']);
    expect(wrapText('abcdefghijkl', 5, m, 5)).toEqual(['abcde', 'fghij', 'kl']);
    expect(wrapText('a\nb', 10, m, 5)).toEqual(['a', 'b']);
    const cut = wrapText('one two three four five six', 9, m, 2);
    expect(cut).toHaveLength(2);
    expect(cut[1].endsWith('...')).toBe(true);
    expect(cut[1].length).toBeLessThanOrEqual(9);
    expect(wrapText('', 10, m, 3)).toEqual([]);
  });
  it('a tint is the colour moved towards white', () => {
    expect(tint('#000000', 0)).toEqual([0, 0, 0]);
    expect(tint('#000000', 1)).toEqual([1, 1, 1]);
    expect(tint('nonsense', 0.5)).toHaveLength(3);
  });
});

describe('the PDF', () => {
  it('is one A4 page in the chosen orientation, with the title set', async () => {
    const bytes = await buildMapPdf({ ...base, profile });
    expect(Buffer.from(bytes).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const land = await PDFDocument.load(bytes);
    expect(land.getPageCount()).toBe(1);
    const { width, height } = land.getPage(0).getSize();
    expect(Math.round(width)).toBe(842); expect(Math.round(height)).toBe(595);
    expect(land.getTitle()).toBe('Morning loop');
    expect(land.getCreator()).toBe('Route Tracer in Vault');
    const port = await PDFDocument.load(await buildMapPdf({ ...base, orientation: 'portrait', profile }));
    expect(Math.round(port.getPage(0).getSize().width)).toBe(595);
  });
  it('works without heights, without notes, with a loop, with miles, with two strokes and with a very long route', async () => {
    const loop = line(40); loop.push(loop[0]);
    for (const input of [
      { ...base, profile: null, profileNote: 'Heights not included (offline).' },
      { ...base, notes: null, profile },
      { ...base, lines: [loop], profile },
      { ...base, units: 'mi' as const, profile },
      { ...base, lines: [line(20000)], profile },
      { ...base, lines: [line(30), line(30).map(([x, y]) => [x + 0.2, y] as [number, number])], profile },
    ]) {
      expect((await PDFDocument.load(await buildMapPdf(input))).getPageCount()).toBe(1);
    }
  });
  it('survives a title and notes the font cannot show, very long ones, and a flat route', async () => {
    const weird = await buildMapPdf({
      ...base,
      title: '漢字 → Run '.repeat(30),
      notes: 'x'.repeat(5000) + '\n\n' + 'word '.repeat(500),
      profile: { ...profile, ele: [5, 5, 5, 5], min: 5, max: 5, ascent: 0, descent: 0 },
    });
    expect((await PDFDocument.load(weird)).getPageCount()).toBe(1);
  });
  it('a single-point route still makes a page', async () => {
    expect((await PDFDocument.load(await buildMapPdf({ ...base, lines: [[[153, -27.5], [153, -27.5]]], profile: null }))).getPageCount()).toBe(1);
  });
});
