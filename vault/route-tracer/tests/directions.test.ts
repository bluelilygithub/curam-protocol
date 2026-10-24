import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import type { Cue } from '../src/api';
import { buildCuePdf } from '../src/cuePdf';
import { fromLines, finish } from '../src/drawing';
import { sameLines, type Lines } from '../src/geo';

const cue = (i: number, text = `Turn left onto Park Road ${i}`): Cue => ({ text, distanceM: 120 + i, durationS: 90, type: 0, pos: [153.03 + i * 0.0001, -27.47] });
const base = { title: 'Sunday loop', notes: 'Park at the gate.\nWatch for bikes.', dateLabel: '12 Oct 2026', color: '#E4572E', units: 'km' as const, totalM: 5200 };

describe('directions PDF', () => {
  it('is a real A4 portrait PDF with one page for a short list', async () => {
    const bytes = await buildCuePdf({ ...base, cues: [cue(1), cue(2), cue(3)] });
    expect(Buffer.from(bytes.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBe(595);
    expect(Math.round(height)).toBe(842);
    expect(doc.getTitle()).toContain('Sunday loop');
  });

  it('runs on to more pages when there are many steps, and never fails on a full list', async () => {
    const many = Array.from({ length: 400 }, (_, i) => cue(i, 'Continue straight onto the shared path beside the river and keep going past the footbridge'));
    const doc = await PDFDocument.load(await buildCuePdf({ ...base, cues: many }));
    expect(doc.getPageCount()).toBeGreaterThan(3);
    expect(doc.getPageCount()).toBeLessThanOrEqual(12);
  });

  it('copes with characters the standard font does not have, blank notes and miles', async () => {
    const bytes = await buildCuePdf({ ...base, units: 'mi', notes: null, title: 'Café → 東京 loop', cues: [cue(1, 'Head toward 東京駅 — then “turn” right')] });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it('is fine with no steps at all', async () => {
    expect((await PDFDocument.load(await buildCuePdf({ ...base, cues: [] }))).getPageCount()).toBe(1);
  });
});

describe('are the directions still for this line?', () => {
  const line: Lines = [[[153.0, -27.5], [153.001, -27.501], [153.002, -27.502]]];
  it('the same line is the same', () => { expect(sameLines(line, line.map((l) => l.map((p) => [...p] as [number, number])))).toBe(true); });
  it('opening a line in the drawing tools and finishing it without a change gives the same line back', () => {
    expect(sameLines(line, finish(fromLines(line)))).toBe(true);
  });
  it('a moved point, an extra point or a new stroke is a different line', () => {
    expect(sameLines(line, [[[153.0, -27.5], [153.0011, -27.501], [153.002, -27.502]]])).toBe(false);
    expect(sameLines(line, [[[153.0, -27.5], [153.001, -27.501]]])).toBe(false);
    expect(sameLines(line, [...line, [[153.1, -27.5], [153.101, -27.5]]])).toBe(false);
  });
  it('a difference smaller than about a tenth of a metre does not count (rounding on the way to the server and back)', () => {
    expect(sameLines(line, [[[153.0000004, -27.5], [153.001, -27.501], [153.002, -27.502]]])).toBe(true);
  });
});
