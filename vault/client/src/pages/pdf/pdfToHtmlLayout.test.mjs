// node client/src/pages/pdf/pdfToHtmlLayout.test.mjs
import assert from 'assert';
import { renderScale, planSlices, sliceBudget, textLines, linesPerSlice, MAX_SLICES } from './pdfToHtmlLayout.mjs';

// a normal A4 page stays whole; the 612 × 4535 pt website mock-up becomes readable slices
assert.deepStrictEqual(planSlices(1400, 1980), [{ top: 0, bottom: 1980 }]);
const scale = renderScale(612, 4535);
const w = Math.round(612 * scale); const h = Math.round(4535 * scale);
assert.strictEqual(w, 1400);
const sl = planSlices(w, h);
assert.strictEqual(sl.length, 8, 'about eight 1400 px slices');
assert.strictEqual(sl[0].top, 0);
assert.strictEqual(sl[sl.length - 1].bottom, h);
for (let i = 1; i < sl.length; i += 1) assert.strictEqual(sl[i].top, sl[i - 1].bottom, 'bands touch, no gaps');
assert.ok(sl.every((s) => s.bottom - s.top <= 1400));
// a very tall page is capped by the canvas limit and the slice budget
assert.ok(40000 * renderScale(612, 40000) <= 16000, 'canvas height stays under 16000 px');
assert.strictEqual(planSlices(1400, 30000, 5).length, 5);
assert.strictEqual(planSlices(1400, 30000, 1).length, 1);
assert.strictEqual(sliceBudget(0, 1), MAX_SLICES);
assert.strictEqual(sliceBudget(10, 3), 2, 'two pages still to come keep one slice each');
assert.strictEqual(sliceBudget(14, 1), 1);

// reading order: sorted by height on the page, two boxes on one row kept apart
const items = [
  { str: 'Why does Blue exist?', x: 500, y: 900, w: 300, h: 30 },
  { str: 'Client Representative', x: 100, y: 400, w: 200, h: 12 },
  { str: 'Quantity Surveyor', x: 900, y: 401, w: 150, h: 12 },
  { str: 'A new way to', x: 300, y: 100, w: 150, h: 20 },
  { str: 'design & build.', x: 455, y: 100, w: 160, h: 20 },
  { str: '   ', x: 0, y: 50, w: 10, h: 10 },
];
const lines = textLines(items);
assert.deepStrictEqual(lines.map((l) => l.text), ['A new way to design & build.', 'Client Representative │ Quantity Surveyor', 'Why does Blue exist?']);
assert.deepStrictEqual(linesPerSlice(lines, [{ top: 0, bottom: 500 }, { top: 500, bottom: 1000 }]), [
  'A new way to design & build.\nClient Representative │ Quantity Surveyor',
  'Why does Blue exist?',
]);

console.log('pdfToHtmlLayout tests passed');
