'use strict';
// node server/services/domainNaming/candidates.test.js
const assert = require('assert');
const { normalizeName, distance, brandClash, filterCandidates, rankLocal, variations, anchorsOf } = require('./candidates');

const brief = { styles: ['invented', 'metaphor'], avoid: ['wine'], include: ['cellar'] };
const names = (r) => r.kept.map((c) => c.name);

assert.strictEqual(normalizeName(' Blue-Lily! '), 'blue-lily');
assert.strictEqual(normalizeName('-x-'), 'x');
assert.strictEqual(normalizeName(null), '');

// distance
assert.strictEqual(distance('google', 'googel', 2), 1, 'a swap of neighbours is one edit');
assert.strictEqual(distance('google', 'gogle', 2), 1);
assert.strictEqual(distance('abc', 'abc', 2), 0);
assert.ok(distance('short', 'muchlongerword', 2) > 2, 'gives up quickly when the lengths differ');
assert.strictEqual(distance('kitten', 'sitting', 3), 3);

// well-known brands: the name itself and the clumsy near-misses are dropped; one that merely contains a brand is kept with a note
assert.deepStrictEqual(brandClash('google'), ['google', 'is']);
assert.deepStrictEqual(brandClash('googel'), ['google', 'near']);
assert.strictEqual(brandClash('lumio'), null);
assert.strictEqual(brandClash('applesauce')[1], 'contains');

// the filter, reason by reason
{
  const r = filterCandidates([
    { name: 'lumera', style: 'invented' },
    { name: 'harbourlight', style: 'metaphor' },
    { name: 'ab' },                        // too short / invalid
    { name: 'x'.repeat(30) },              // too long
    { name: 'getfridge' },                 // filler start
    { name: 'fridgehub' },                 // filler end
    { name: 'winecellar' },                // avoided word
    { name: 'googel' },                    // near a brand
    { name: 'phloughtique' },              // hard to spell
    { name: 'shop4u' },                    // digit
    { name: 'lumera' },                    // exact repeat, not counted
    { name: 'lumara' },                    // one letter from lumera
    { name: 'tasmin', style: 'invented' },
  ], brief);
  assert.deepStrictEqual(names(r), ['lumera', 'harbourlight', 'tasmin']);
  assert.strictEqual(r.dropped.length, 1);
  assert.strictEqual(r.dropped.filler, 2);
  assert.strictEqual(r.dropped.avoided, 1);
  assert.strictEqual(r.dropped.brand, 1);
  assert.strictEqual(r.dropped.hard_to_spell, 1);
  assert.strictEqual(r.dropped.similar, 1);
  assert.ok(r.dropped.invalid >= 2);
  const c = r.kept[0];
  assert.ok(c.syllables >= 2 && c.spell && typeof c.spell.score === 'number', 'kept names carry syllables and spelling notes');
}
// a name the brief asks for by word is not filler
assert.deepStrictEqual(names(filterCandidates([{ name: 'thecellarroom' }], { styles: ['compound'], include: ['the'] })), ['thecellarroom']);
// names seen in earlier rounds are not offered again
assert.deepStrictEqual(names(filterCandidates([{ name: 'lumera' }, { name: 'tasmin' }], brief, { seen: ['Lumera'] })), ['tasmin']);
// descriptive and compound styles allow longer names
assert.strictEqual(filterCandidates([{ name: 'harbourlightcafe' }], { styles: ['descriptive'] }).kept.length, 1);
assert.strictEqual(filterCandidates([{ name: 'harbourlightcafe' }], { styles: ['invented'] }).kept.length, 0);
// the person's own names are never dropped, even if long, avoided, filler or near a brand
{
  const r = filterCandidates([
    { name: 'thestaircasesuitcase', own: true }, { name: 'dorothystoner', own: true }, { name: 'winetime', own: true }, { name: 'appleby', own: true },
  ], brief);
  assert.strictEqual(r.kept.length, 4);
  assert.ok(r.kept.every((c) => c.own));
}

// ranking: own names first, styles mixed, easy names ahead of hard ones
{
  const kept = filterCandidates([
    { name: 'lumera', style: 'invented' }, { name: 'tasmin', style: 'invented' }, { name: 'quillon', style: 'invented' },
    { name: 'harbourlight', style: 'metaphor' }, { name: 'thestaircasesuitcase', own: true },
  ], brief).kept;
  const ranked = rankLocal(kept).map((c) => c.name);
  assert.strictEqual(ranked[0], 'thestaircasesuitcase');
  assert.notStrictEqual(ranked[1], ranked[2], 'sanity');
  const styles = rankLocal(kept).filter((c) => !c.own).slice(0, 2).map((c) => c.style);
  assert.deepStrictEqual(new Set(styles).size, 2, 'the top two come from different styles');
  assert.deepStrictEqual(rankLocal([]), []);
}

// variations of a favourite
{
  const v = variations('Lumera', { include: ['cellar'] }).map((x) => x.name);
  for (const want of ['getlumera', 'lumeraly', 'lumerahq', 'lumeracellar', 'cellarlumera']) assert.ok(v.includes(want), `${want} in ${v.join(',')}`);
  assert.ok(!v.includes('lumera'), 'not the favourite itself');
  assert.ok(variations('kafe', {}).some((x) => x.name === 'cafe'), 'k and c');
  assert.ok(variations('phlox', {}).some((x) => x.name === 'flox'), 'ph and f');
  assert.ok(variations('sunny', {}).some((x) => x.name === 'sunni'), 'final y');
  assert.ok(variations('zenith', {}).length <= 24);
  assert.deepStrictEqual(variations('ab', {}), []);
  assert.ok(variations('lumera', {}).every((x) => x.style === 'variation'));
}

// names built on the person's own names are intentional, not filler: they may be longer, start with "the", and are ranked first
{
  const own = { styles: ['invented'], own: 'The Suitcase\nDorothy Stoner' };
  assert.deepStrictEqual(anchorsOf(own).sort(), ['dorothy', 'dorothystoner', 'stoner', 'suitcase', 'thesuitcase'].sort(), 'whole names and their key words');
  const r = filterCandidates([
    { name: 'thesuitcasegallery' },          // filler start and a long name: kept because it is built on the title
    { name: 'dorothystonerexhibitions' },    // long: kept
    { name: 'stonerhub' },                   // filler end but built on the surname
    { name: 'getfridge' },                   // still filler
    { name: 'pretzel' },                     // not built on anything
  ], own);
  assert.deepStrictEqual(r.kept.map((c) => c.name), ['thesuitcasegallery', 'dorothystonerexhibitions', 'stonerhub', 'pretzel']);
  assert.ok(r.kept.slice(0, 3).every((c) => c.anchored) && !r.kept[3].anchored);
  assert.strictEqual(r.dropped.filler, 1);
  const ranked = rankLocal(r.kept).map((c) => c.name);
  assert.ok(ranked.indexOf('pretzel') > ranked.indexOf('thesuitcasegallery'), 'built-on-your-name names come before ordinary ones');
  // a brief with no own names changes nothing
  assert.deepStrictEqual(anchorsOf({ styles: [] }), []);
  assert.strictEqual(filterCandidates([{ name: 'thesuitcasegallery' }], { styles: ['invented'] }).kept.length, 0);
}

console.log('candidates tests passed');
