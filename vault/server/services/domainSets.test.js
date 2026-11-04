'use strict';
// node server/services/domainSets.test.js   (no database)
const assert = require('assert');
const {
  cleanSetData, upgradeSetData, cleanSetName, summarise, shapeStatus, cleanRequirements, labelOf, ownVariants, missingTlds,
  GENERATE_MAX_AGE, ENDINGS, MAX_SET_BYTES, MAX_POOL,
} = require('./domainSets');

const R = (tld, available, source = 'rdap') => ({ domain: `x.${tld}`, tld, available, source });
const card = (name, over = {}) => ({
  name, style: 'invented', syllables: 3, spell: { score: 10, notes: ['could start with a k or a c'] }, reasoning: `From ${name}.`, risks: ['Easy to misspell.'],
  domains: { checkedAt: '2026-11-05T01:00:00Z', results: [R('com', false), R('com.au', true)] }, round: 1, ...over,
});

// ── endings and how fresh a check is ──
assert.ok(ENDINGS.includes('org') && ENDINGS[0] === 'com' && ENDINGS[1] === 'com.au');
assert.ok(GENERATE_MAX_AGE > 0 && GENERATE_MAX_AGE <= 3600, 'never weeks (the old prefer_cache was a 30-day cache)');
{
  const now = new Date('2026-11-04T01:02:03Z');
  const shaped = shapeStatus('vinoire', { results: [
    { domain: 'vinoire.com', tld: 'com', available: false, source: 'cache', latency_ms: 4 },
    { domain: 'vinoire.io', tld: '.io', available: true, source: 'rdap' },
    { domain: 'vinoire.ai', tld: 'ai', available: 'maybe' },
  ] }, now);
  assert.strictEqual(shaped.checkedAt, '2026-11-04T01:02:03.000Z');
  assert.deepStrictEqual(shaped.results.map((r) => [r.tld, r.available, r.source]), [['com', false, 'cache'], ['io', true, 'rdap'], ['ai', null, '']], 'a leading dot is dropped');
  assert.ok(!('latency_ms' in shaped.results[0]));
  assert.deepStrictEqual(shapeStatus('x', null, now).results, [], 'no answer gives no endings, never "free"');
}
assert.strictEqual(labelOf('Blue Lily & Co!'), 'bluelilyco');
assert.strictEqual(labelOf('-my-brand-'), 'my-brand');
assert.strictEqual(labelOf('x'.repeat(100)).length, 63);
assert.deepStrictEqual(cleanRequirements({ tlds: ['COM.au', 'com.au', ' io '], platforms: ['Instagram', 'instagram', 'TikTok'] }), { tlds: ['com.au', 'io'], platforms: ['instagram', 'tiktok'] });
assert.deepStrictEqual(cleanRequirements(null), { tlds: [], platforms: [] });
assert.deepStrictEqual(missingTlds({ results: [{ tld: 'com' }, { tld: '.com.au' }] }, ['com', 'com.au', 'org']), ['org']);
assert.deepStrictEqual(missingTlds(null, ['org']), ['org']);

// ── names the person already has ──
assert.deepStrictEqual(ownVariants('The Staircase Suitcase\nDorothy Stoner'), [
  { name: 'thestaircasesuitcase', label: 'The Staircase Suitcase' },
  { name: 'staircasesuitcase', label: 'The Staircase Suitcase' },
  { name: 'dorothystoner', label: 'Dorothy Stoner' },
]);
assert.deepStrictEqual(ownVariants('The'), []);
assert.deepStrictEqual(ownVariants(null), []);
assert.strictEqual(ownVariants('one one one\ntwo two two\nthree three\nfour four\nfive five\nsix six six').length, 5, 'at most five names');

// ── a set (version 2) ──
{
  const d = cleanSetData({
    brief: { what: ' Wine fridges ', tone: { playfulSerious: 1 }, styles: ['invented'], required: { tlds: ['com.au'], platforms: ['instagram'] } },
    pool: [card('lumera'), card('tasmin', { own: true, label: 'Tasmin' }), card('lumera'), card('b@d name!')],
    shortlist: ['lumera', 'ghost', 'lumera'], preferred: 'lumera',
    feedback: { more: ['lumera'], less: ['Zorbo'] }, seen: ['lumera', 'tasmin'], rounds: 3,
    checks: { lumera: { verdict: 'x' }, ghost: { verdict: 'y' } },
  });
  assert.strictEqual(d.schemaVersion, 2);
  assert.strictEqual(d.brief.what, 'Wine fridges');
  assert.strictEqual(d.brief.tone.playfulSerious, 1);
  assert.deepStrictEqual(d.pool.map((c) => c.name), ['lumera', 'tasmin', 'bdname'], 'repeats are dropped and names normalised');
  assert.strictEqual(d.pool[1].label, 'Tasmin');
  assert.strictEqual(d.pool[1].own, true);
  assert.deepStrictEqual(d.shortlist, ['lumera'], 'only names the set has');
  assert.strictEqual(d.preferred, 'lumera');
  assert.deepStrictEqual(d.feedback, { more: ['lumera'], less: ['zorbo'] });
  assert.strictEqual(d.rounds, 3);
  assert.deepStrictEqual(Object.keys(d.checks), ['lumera'], 'a check for a name the set does not have is dropped');
  assert.strictEqual(d.pool[0].domains.checkedAt, '2026-11-05T01:00:00.000Z');
  assert.strictEqual(d.pool[0].domains.results[1].available, true);
  assert.strictEqual(d.pool[0].spell.notes.length, 1);
}
// a preferred name that is not in the pool is dropped; with no pool it is kept (a name typed by hand)
assert.strictEqual(cleanSetData({ pool: [card('a1b')], preferred: 'sneaky' }).preferred, '');
assert.strictEqual(cleanSetData({ preferred: 'mybrand' }).preferred, 'mybrand');
// bad shapes and over-long text are dealt with, never stored as sent
{
  const d = cleanSetData({ evil: '<script>', pool: 'no', shortlist: 'x', brief: { what: 'x'.repeat(9000) }, checks: 'no' });
  assert.ok(!('evil' in d));
  assert.deepStrictEqual(d.pool, []);
  assert.deepStrictEqual(d.shortlist, []);
  assert.strictEqual(d.brief.what.length, 1500);
  assert.doesNotThrow(() => cleanSetData(null));
}
// limits: the pool is capped, a huge check is replaced, an oversized set is refused
{
  const many = Array.from({ length: 400 }, (_, i) => card(`name${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`));
  assert.ok(cleanSetData({ pool: many }).pool.length <= MAX_POOL);
  const big = cleanSetData({ pool: [card('a1b')], checks: { a1b: { filler: 'x'.repeat(30 * 1024) } } });
  assert.deepStrictEqual(big.checks.a1b, { truncated: true });
  const pool = Array.from({ length: 150 }, (_, i) => card(`n${i}`, { reasoning: 'r'.repeat(320), risks: ['k'.repeat(200), 'k'.repeat(200), 'k'.repeat(200), 'k'.repeat(200)] }));
  const checks = Object.fromEntries(pool.slice(0, 50).map((c) => [c.name, { filler: 'y'.repeat(11 * 1024) }]));
  assert.throws(() => cleanSetData({ pool, checks, legacy: { filler: 'z'.repeat(90 * 1024) } }), /too large/);
  assert.ok(MAX_SET_BYTES >= 300 * 1024);
}

// ── version 1 sets open as version 2 ──
{
  const v1 = {
    description: 'Wine fridges for hotels', ownNames: 'The Staircase Suitcase',
    suggestions: [
      { name: 'thestaircasesuitcase', label: 'The Staircase Suitcase', own: true, checkedAt: '2026-11-03T00:00:00Z', results: [{ domain: 'a.org', tld: 'org', available: true, source: 'rdap' }] },
      { name: 'vinoire', results: [{ domain: 'vinoire.com', tld: 'com', available: false }] },
    ],
    preferred: 'vinoire', shortlist: ['vinoire', 'gone'], tableNames: ['vinoire'],
    requirements: { tlds: ['com.au'], platforms: ['instagram'] },
    results: { score: { overall_score: 82 }, handles: { vinoire: { availability: { instagram: { available: true } }, checked_at: '2026-11-03T01:00:00Z' } } },
    errors: { overview: 'free' }, runAt: '2026-11-03T02:00:00Z',
  };
  const up = upgradeSetData(v1);
  assert.strictEqual(up.schemaVersion, 2);
  assert.strictEqual(up.brief.what, 'Wine fridges for hotels');
  assert.strictEqual(up.brief.own, 'The Staircase Suitcase');
  assert.deepStrictEqual(up.brief.required, { tlds: ['com.au'], platforms: ['instagram'] });
  assert.deepStrictEqual(up.pool.map((c) => c.name), ['thestaircasesuitcase', 'vinoire']);
  assert.strictEqual(up.pool[0].own, true);
  assert.strictEqual(up.pool[0].label, 'The Staircase Suitcase');
  assert.ok(up.pool[1].syllables >= 2 && typeof up.pool[1].spell.score === 'number');
  assert.strictEqual(up.pool[0].domains.results[0].tld, 'org');
  assert.strictEqual(up.preferred, 'vinoire');
  assert.deepStrictEqual(up.shortlist, ['vinoire', 'gone'], 'the conversion keeps what it was given; saving cleans it');
  assert.ok(up.checks.vinoire.social.availability.instagram, 'handle checks carry over');
  assert.strictEqual(up.checks.vinoire.checkedAt, '2026-11-03T01:00:00Z');
  assert.strictEqual(up.legacy.results.score.overall_score, 82, 'old tool results are kept, not shown');
  assert.ok(!('handles' in up.legacy.results));
  assert.deepStrictEqual(up.seen, ['thestaircasesuitcase', 'vinoire']);
  // what the browser later saves goes back through the cleaner, which drops names the set does not have
  assert.deepStrictEqual(cleanSetData(up).shortlist, ['vinoire']);
  // already version 2: returned as it is
  const v2 = cleanSetData({ pool: [card('a1b')] });
  assert.strictEqual(upgradeSetData(v2), v2);
  // nothing stored yet
  assert.strictEqual(upgradeSetData(null).pool.length, 0);
  assert.strictEqual(upgradeSetData({}).rounds, 0);
}

// ── the talk-it-through conversation is kept with the set ──
{
  const turns = Array.from({ length: 20 }, (_, i) => ({ q: 'question ' + i, a: 'answer ' + i }));
  const d = cleanSetData({ conversation: turns.concat([{ q: '', a: 'no question' }, { q: 'no answer', a: '' }, null]) });
  assert.strictEqual(d.conversation.length, 12);
  assert.strictEqual(d.conversation[11].q, 'question 19', 'the last twelve are kept');
  assert.deepStrictEqual(cleanSetData({ conversation: 'no' }).conversation, []);
  assert.strictEqual(cleanSetData({ conversation: [{ q: 'q'.repeat(2000), a: 'a'.repeat(5000) }] }).conversation[0].a.length, 1500);
  assert.deepStrictEqual(upgradeSetData({ description: 'x' }).conversation, []);
  assert.strictEqual(cleanSetData({ brief: { notes: ' more detail ' } }).brief.notes, 'more detail');
}

// ── names ──
assert.strictEqual(cleanSetName('  Wine   fridges \n'), 'Wine fridges');
assert.throws(() => cleanSetName('   '), /Give the set a name/);
assert.strictEqual(cleanSetName('x'.repeat(300)).length, 120);

// ── the list line (either version) ──
{
  const v2 = summarise({ id: 3, name: 'N', preferred: 'lumera', data: { schemaVersion: 2, brief: { what: 'A cafe' }, pool: [1, 2, 3], shortlist: [1], checks: { a: {} } }, updatedAt: 'u', createdAt: 'c' });
  assert.deepStrictEqual(v2, { id: 3, name: 'N', preferred: 'lumera', updatedAt: 'u', createdAt: 'c', names: 3, shortlist: 1, checked: 1, what: 'A cafe' });
  const v1 = summarise({ id: 4, name: 'Old', preferred: '', data: { description: 'Wine', suggestions: [1, 2], shortlist: [], results: { handles: { a: {}, b: {} } } }, updatedAt: 'u', createdAt: 'c' });
  assert.deepStrictEqual(v1, { id: 4, name: 'Old', preferred: '', updatedAt: 'u', createdAt: 'c', names: 2, shortlist: 0, checked: 2, what: 'Wine' });
}

console.log('domainSets tests passed');
