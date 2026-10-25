import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import type { Cue } from '../src/api';
import { fromLines, finish } from '../src/drawing';
import { sameLines, type Lines } from '../src/geo';
import { buildMapPdf } from '../src/mapPdf';

// a 2x2 white PNG
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4EIwDiqEF8AAEY4Bf8d7F8lAAAAAElFTkSuQmCC', 'base64'));
const line = (n: number): [number, number][] => Array.from({ length: n }, (_, i) => [153.0 + i * 0.002, -27.5 + Math.sin(i / 5) * 0.004] as [number, number]);
const cue = (i: number, text = `Turn left onto Park Road ${i}`): Cue => ({ text, distanceM: 120 + i, durationS: 90, type: 0, pos: [153.03 + i * 0.0001, -27.47] });
const map = { title: 'Sunday loop', notes: 'Park at the gate.', dateLabel: '12 Oct 2026', lines: [line(120)], color: '#E4572E', units: 'km' as const, orientation: 'landscape' as const, image: { bytes: PNG, type: 'png' as const }, center: [153.12, -27.5] as [number, number], zoom: 13 };

describe('directions in the Map as PDF', () => {
  it('without directions the PDF is the one page it always was', async () => {
    expect((await PDFDocument.load(await buildMapPdf(map))).getPageCount()).toBe(1);
    expect((await PDFDocument.load(await buildMapPdf({ ...map, cues: [] }))).getPageCount()).toBe(1);
    expect((await PDFDocument.load(await buildMapPdf({ ...map, cues: [cue(1)] }))).getPageCount()).toBe(1);
  });

  it('with directions the map stays page one and the directions follow on A4 portrait pages', async () => {
    const doc = await PDFDocument.load(await buildMapPdf({ ...map, cues: [cue(1), cue(2), cue(3)] }));
    expect(doc.getPageCount()).toBe(2);
    const first = doc.getPage(0).getSize();
    expect(first.width).toBeGreaterThan(first.height); // the landscape map
    const second = doc.getPage(1).getSize();
    expect(Math.round(second.width)).toBe(595);
    expect(Math.round(second.height)).toBe(842);
  });

  it('a long list runs onto more pages, and never fails on a full one', async () => {
    const many = Array.from({ length: 400 }, (_, i) => cue(i, 'Continue straight onto the shared path beside the river and keep going past the footbridge'));
    const doc = await PDFDocument.load(await buildMapPdf({ ...map, cues: many }));
    expect(doc.getPageCount()).toBeGreaterThan(3);
    expect(doc.getPageCount()).toBeLessThanOrEqual(13);
  });

  it('copes with characters the standard font does not have, and with miles', async () => {
    const bytes = await buildMapPdf({ ...map, units: 'mi', title: 'Café → 東京 loop', cues: [cue(1, 'Head toward 東京駅 — then “turn” right'), cue(2)] });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
  });
});

describe('are the directions still for this line?', () => {
  const l: Lines = [[[153.0, -27.5], [153.001, -27.501], [153.002, -27.502]]];
  it('the same line is the same', () => { expect(sameLines(l, l.map((x) => x.map((p) => [...p] as [number, number])))).toBe(true); });
  it('opening a line in the drawing tools and finishing it without a change gives the same line back', () => {
    expect(sameLines(l, finish(fromLines(l)))).toBe(true);
  });
  it('a moved point, an extra point or a new stroke is a different line', () => {
    expect(sameLines(l, [[[153.0, -27.5], [153.0011, -27.501], [153.002, -27.502]]])).toBe(false);
    expect(sameLines(l, [[[153.0, -27.5], [153.001, -27.501]]])).toBe(false);
    expect(sameLines(l, [...l, [[153.1, -27.5], [153.101, -27.5]]])).toBe(false);
  });
  it('a difference smaller than about a tenth of a metre does not count (rounding on the way to the server and back)', () => {
    expect(sameLines(l, [[[153.0000004, -27.5], [153.001, -27.501], [153.002, -27.502]]])).toBe(true);
  });
});
