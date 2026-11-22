'use strict';

// node server/services/presentations/layouts.test.js — pure geometry, no files, no network.

const assert = require('node:assert/strict');
const { DESIGNS, DESIGN_IDS, LAYOUTS, HERO, ASPECT_RATIO, plan, columnsFor } = require('./layouts');

const slide = (layout, extra = {}) => ({
  layout, title: 'A title', body: 'Some body text', bullets: ['One', 'Two', 'Three'],
  columns: [{ heading: 'Left', bullets: ['a', 'b'] }, { heading: 'Right', bullets: ['c'] }, { heading: 'Third', bullets: ['d'] }],
  imageRef: '', ...extra,
});
const inside = (r, what) => {
  const eps = 0.01;
  assert.ok(r.x >= -eps && r.y >= -eps && r.w > 0 && r.h > 0, `${what}: has a size and starts on the slide`);
  assert.ok(r.x + r.w <= 100 + eps && r.y + r.h <= 100 + eps, `${what}: ends on the slide (${r.x + r.w}, ${r.y + r.h})`);
};

assert.equal(new Set(DESIGN_IDS).size, DESIGNS.length, 'design ids are unique');
assert.ok(DESIGNS.every((d) => d.label && d.blurb), 'every design is described');
assert.equal(LAYOUTS.length, 13);

for (const designId of DESIGN_IDS) {
  for (const aspect of Object.keys(ASPECT_RATIO)) {
    for (const layout of LAYOUTS) {
      const p = plan(slide(layout), { designId, aspect, titleSize: 44 });
      const where = `${designId}/${aspect}/${layout}`;
      assert.equal(p.layout, layout);
      assert.equal(p.design, designId);
      for (const s of p.shapes) inside(s, `${where} shape`);
      for (const b of p.boxes) {
        inside(b, `${where} box`);
        assert.ok(b.size >= 12, `${where}: text is readable`);
        assert.ok(['text', 'muted', 'primary', 'bg'].includes(b.color), `${where}: theme colour`);
      }
      for (const s of p.shapes.filter((x) => x.round)) {
        assert.ok(Math.abs(s.w * ASPECT_RATIO[aspect] - s.h) < 0.01, `${where}: circles stay round`);
      }
      assert.ok(p.boxes.some((b) => (b.text || '').includes('A title') || (b.text || '').includes('Some body')), `${where}: the slide's words are placed`);
      assert.equal(p.number, !HERO.has(layout) && layout !== 'full-picture', `${where}: slide numbers on content slides only`);
    }
  }
}

// layout-specific promises
assert.equal(plan(slide('comparison')).boxes.filter((b) => b.bullets).length, 2, 'comparison has two columns');
assert.equal(plan(slide('three-column')).boxes.filter((b) => b.bullets).length, 3, 'three-column has three columns');
assert.equal(plan(slide('agenda')).shapes.filter((s) => s.label).map((s) => s.label).join(), '1,2,3', 'agenda numbers its items');
assert.equal(plan(slide('timeline')).shapes.filter((s) => s.kind === 'ellipse').length, 3, 'timeline has a dot per milestone');
assert.equal(plan(slide('full-picture', { imageRef: 'https://example.org/a.png' })).images[0].fit, 'cover', 'full picture fills the slide');
assert.equal(plan(slide('picture', { imageRef: 'https://example.org/a.png' })).images[0].fit, 'contain');
assert.ok(plan(slide('title'), { designId: 'bold' }).shapes.some((s) => s.w === 100 && s.h === 100), 'bold fills hero slides');
assert.ok(plan(slide('bullets'), { designId: 'banded' }).boxes[0].color === 'bg', 'banded titles sit on the band');
assert.equal(plan(slide('bullets'), { designId: 'nonsense' }).design, 'clean', 'unknown designs fall back to Clean');
assert.equal(plan(slide('nonsense')).layout, 'bullets', 'unknown layouts fall back to Bullets');

// stats and columns fall back to bullets when a slide has no columns
assert.deepEqual(columnsFor({ layout: 'stats', bullets: ['42% | Growth', '3x: Speed', 'Plain'] }, 4),
  [{ heading: '42%', bullets: ['Growth'] }, { heading: '3x', bullets: ['Speed'] }, { heading: 'Plain', bullets: [] }]);
assert.deepEqual(columnsFor({ layout: 'comparison', bullets: ['a', 'b', 'c', 'd'] }, 2).map((c) => c.bullets), [['a', 'b'], ['c', 'd']]);

console.log('presentations layouts tests passed');
