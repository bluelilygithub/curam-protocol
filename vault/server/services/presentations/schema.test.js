'use strict';

// node server/services/presentations/schema.test.js

const assert = require('node:assert/strict');
const s = require('./schema');

{
  const theme = s.resolveTheme('ocean');
  assert.equal(theme.id, 'ocean');
  assert.equal(theme.bg, '#f0f9ff');
  assert.equal(s.resolveTheme('no-such-theme').id, 'paper');
  const custom = s.resolveTheme({ id: 'paper', bg: 'javascript:alert(1)', titleSize: 999, label: 'Mine' });
  assert.equal(custom.bg, '#ffffff', 'bad colours are ignored');
  assert.equal(custom.titleSize, 72, 'sizes are clamped');
  assert.equal(custom.label, 'Mine');
}

{
  const deck = s.normalizeDeck({
    title: '  Hello  ', aspect: 'wide', themeId: '',
    slides: [
      { layout: 'magic', title: 'A', bullets: ['one', '', 'two', 'three', 'four', 'five', 'six', 'seven'], body: 'x'.repeat(900) },
    ],
  });
  assert.equal(deck.schemaVersion, 2);
  assert.equal(deck.title, 'Hello');
  assert.equal(deck.aspect, '16:9');
  assert.equal(deck.themeId, 'paper');
  assert.equal(deck.slides[0].layout, 'bullets');
  assert.equal(deck.slides[0].bullets.length, 6);
  assert.equal(deck.slides[0].body.length, 700);
}

assert.throws(() => s.normalizeDeck({ slides: [] }), /at least one slide/);
assert.throws(() => s.normalizeDeck({ slides: Array.from({ length: 21 }, () => ({})) }), /at most 20 slides/);

{
  const deck = s.deckFromOutline({ title: 'Plan', subtitle: 'Sub', slides: [{ title: 'One', bullets: ['a'] }, { title: 'Two', imageRef: '/api/presentations/assets/1/a.png' }] }, 'ink');
  assert.equal(deck.themeId, 'ink');
  assert.equal(deck.slides.length, 2);
  assert.equal(deck.slides[0].layout, 'title');
  assert.equal(deck.slides[1].layout, 'picture');
}

{
  const outline = s.normalizeOutline({ title: 'Plan', nSlides: 99, slides: [{ title: 'Only one' }] });
  assert.equal(outline.nSlides, 20);
  assert.equal(outline.slides.length, 20);
  assert.equal(outline.slides[0].layout, 'title');
  assert.equal(outline.slides[19].title, 'Slide 20');
}

{
  // design, transition and columns are kept; unknown values fall back
  const { normalizeDeck: norm, TRANSITIONS } = require('./schema');
  const one = { slides: [{ layout: 'stats', title: 'N', columns: [{ heading: '42%', bullets: ['Growth', ''] }, { heading: '', bullets: [] }] }] };
  const deck = norm({ ...one, designId: 'banded', transition: 'push' });
  assert.equal(deck.designId, 'banded');
  assert.equal(deck.transition, 'push');
  assert.deepEqual(deck.slides[0].columns, [{ heading: '42%', bullets: ['Growth'] }]);
  const odd = norm({ ...one, designId: 'nope', transition: 'spin' });
  assert.equal(odd.designId, 'clean');
  assert.equal(odd.transition, 'fade');
  assert.ok(TRANSITIONS.includes('none') && TRANSITIONS.includes('fade'));
}

{
  // v2 keeps the richer editing model and the planning controls through every round trip.
  const deck = s.normalizeDeck({
    title: 'Plan', audience: 'Board', tone: 'calm', duration: 18, nSlides: 8,
    outline: [{ title: 'One', bullets: ['a'] }],
    slides: [{
      layout: 'picture', title: 'A', notes: 'Say this', background: '#123456', imagePrompt: 'a calm map',
      images: [{ ref: '/api/presentations/assets/1/a.png', x: 10, y: 20, w: 30, h: 40 }],
      shapes: [{ kind: 'triangle', fill: 'primary', alpha: 0.4 }],
      chart: { type: 'bar', labels: ['A', 'B'], series: [{ name: 'Score', values: [3, 7] }] },
      table: { rows: [['Head', 'Value'], ['A', '3']] },
      rich: { title: 'A <b>bold</b> title', body: 'Line<br>two', bullets: ['<i>first</i>'] },
    }],
  });
  assert.equal(deck.audience, 'Board');
  assert.equal(deck.tone, 'calm');
  assert.equal(deck.duration, 18);
  assert.equal(deck.nSlides, 8);
  assert.equal(deck.outline.length, 1);
  assert.equal(deck.slides[0].background, '#123456');
  assert.equal(deck.slides[0].images.length, 1);
  assert.equal(deck.slides[0].shapes[0].kind, 'triangle');
  assert.equal(deck.slides[0].chart.type, 'bar');
  assert.equal(deck.slides[0].table.rows.length, 2);
  assert.match(deck.slides[0].rich.title, /<b>/);
  assert.equal(deck.slides[0].notes, 'Say this');
  const again = s.normalizeDeck(JSON.parse(JSON.stringify(deck)));
  assert.deepEqual(again, deck, 'normalising twice is stable');

  const cleaned = s.normalizeDeck({
    slides: [{ title: 'x', rich: { title: '<script>alert(1)</script><b>Kept</b>' }, chart: { series: [{ values: ['bad', 4] }] } }],
  });
  assert.ok(!/script/.test(cleaned.slides[0].rich.title));
  assert.deepEqual(cleaned.slides[0].chart.series[0].values, [0, 4]);
}

console.log('presentations schema tests passed');
