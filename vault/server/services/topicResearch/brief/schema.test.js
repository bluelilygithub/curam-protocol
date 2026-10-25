#!/usr/bin/env node
/**
 * Topic Research (milestone 4): the check every answer from the model goes through. Pure code: no model, no database, no network.
 *
 * Run: node server/services/topicResearch/brief/schema.test.js
 */
'use strict';

const assert = require('assert');
const { validateBrief, textFields, clean, LIMITS } = require('./schema');
const { normaliseUrl } = require('../urlNormalise');

// the three articles the owner ticked
const ARTICLES = [
  { url: 'https://abc.net.au/news/a', domain: 'abc.net.au' },
  { url: 'https://theguardian.com/b', domain: 'theguardian.com' },
  { url: 'https://www.smh.com.au/c?id=7', domain: 'smh.com.au' },
  { url: 'https://abc.net.au/news/d', domain: 'abc.net.au' }, // a second ABC article
];
const allowed = new Map(ARTICLES.map((a) => [normaliseUrl(a.url), { url: normaliseUrl(a.url), domain: a.domain }]));
const A = normaliseUrl(ARTICLES[0].url); const B = normaliseUrl(ARTICLES[1].url); const C = normaliseUrl(ARTICLES[2].url); const D = normaliseUrl(ARTICLES[3].url);

const good = () => ({
  summary: 'Queensland has opened a rebate scheme for heat pump hot water systems. Installers say demand is outrunning supply.',
  keyFacts: [
    { fact: 'The rebate is available to homeowners from this month.', sources: [A.replace('https://', 'https://www.') && ARTICLES[0].url, ARTICLES[1].url] },
    { fact: 'Installers are booked out for months.', sources: [ARTICLES[2].url] },
  ],
  anglesTaken: [{ outlet: 'ABC', framing: 'Focuses on household savings.' }, { outlet: 'Guardian', framing: 'Frames it as a climate policy.' }],
  gaps: ['Nobody explains how renters can claim.'],
  suggestedAngles: [{ title: 'A renter\'s guide', why: 'Your readers rent.' }, { title: 'Is it worth it?', why: 'Costs are unclear.' }, { title: 'Installer shortage', why: 'Under-covered.' }],
  chosenAngle: 'A renter\'s guide',
  outline: [{ level: 2, heading: 'Who can claim', notes: ['Owners first', 'Renters need a landlord'] }, { level: 3, heading: 'Landlord consent', notes: [] }],
  keywords: { primary: 'heat pump rebate queensland', related: ['heat pump cost', 'hot water rebate'] },
});
const check = (raw, opts = {}) => validateBrief(raw, { allowed, ...opts });

// ------------------------------------------------------------ a good answer
{
  const r = check(good());
  assert.deepStrictEqual(r.problems, []);
  assert.deepStrictEqual(r.dropped, { facts: 0, sources: 0 });
  const v = r.value;
  assert.strictEqual(v.keyFacts.length, 2);
  assert.deepStrictEqual(v.keyFacts[0].sources, [A, B], 'sources are written back as the article addresses');
  assert.deepStrictEqual([v.keyFacts[0].outletCount, v.keyFacts[0].singleSource], [2, false]);
  assert.deepStrictEqual([v.keyFacts[1].outletCount, v.keyFacts[1].singleSource], [1, true]);
  assert.strictEqual(v.suggestedAngles.length, 3);
  assert.strictEqual(v.chosenAngle, 'A renter\'s guide');
  assert.deepStrictEqual(v.outline.map((o) => o.level), [2, 3]);
  assert.strictEqual(v.keywords.primary, 'heat pump rebate queensland');
}

// ------------------------------------------------------------ every fact must be backed by an article the owner ticked
{
  const raw = good();
  raw.keyFacts = [
    { fact: 'Backed by a ticked article.', sources: [ARTICLES[0].url] },
    { fact: 'Backed only by a made-up address.', sources: ['https://invented.example/story'] },
    { fact: 'No sources at all.', sources: [] },
    { fact: 'Sources missing entirely.' },
    { fact: 'Sources of the wrong kind.', sources: [42, null, { url: ARTICLES[0].url }] },
    { fact: 'Half and half.', sources: ['https://invented.example/x', ARTICLES[1].url] },
    { fact: '', sources: [ARTICLES[0].url] },
    'just a string',
  ];
  const r = check(raw);
  assert.deepStrictEqual(r.problems, []);
  assert.deepStrictEqual(r.value.keyFacts.map((f) => f.fact), ['Backed by a ticked article.', 'Half and half.'], 'unsourced facts are dropped, whatever the model claims');
  assert.deepStrictEqual(r.value.keyFacts[1].sources, [B], 'the invented address is removed from a fact that has a real one too');
  assert.strictEqual(r.dropped.facts, 6);
  assert.ok(r.dropped.sources >= 2);

  // an address matches after the usual tidying (tracking parameters, www, trailing slash), not only when identical
  const tidy = good();
  tidy.keyFacts = [{ fact: 'Matched after tidying.', sources: ['https://abc.net.au/news/a/?utm_source=x#top', 'https://www.theguardian.com/b'.replace('www.', ''), 'https://smh.com.au/c?id=7'] }];
  const t = check(tidy);
  assert.deepStrictEqual(t.value.keyFacts[0].sources, [A, B], 'a tracking tail still matches; a different host (smh.com.au vs www.smh.com.au) does not');
  assert.strictEqual(t.dropped.sources, 1);

  // a fact with the same address twice has one source
  const dup = good();
  dup.keyFacts = [{ fact: 'Twice.', sources: [ARTICLES[0].url, ARTICLES[0].url + '/', ARTICLES[0].url] }];
  const d = check(dup);
  assert.deepStrictEqual(d.value.keyFacts[0].sources, [A]);

  // nothing sourced at all: the whole answer is unusable
  const none = good();
  none.keyFacts = [{ fact: 'x', sources: ['https://invented.example'] }];
  const n = check(none);
  assert.strictEqual(n.value, null);
  assert.ok(n.problems.some((p) => /No fact had a source link/.test(p)));
}

// ------------------------------------------------------------ "single source" is worked out here, per outlet
{
  const raw = good();
  raw.keyFacts = [
    { fact: 'The model claims this is single source but two outlets back it.', sources: [ARTICLES[0].url, ARTICLES[1].url], singleSource: true },
    { fact: 'The model claims this is well supported but one outlet has it.', sources: [ARTICLES[0].url], singleSource: false, outletCount: 9 },
    { fact: 'Two articles from the same outlet are still one outlet.', sources: [ARTICLES[0].url, ARTICLES[3].url] },
  ];
  const f = check(raw).value.keyFacts;
  assert.deepStrictEqual(f.map((x) => x.singleSource), [false, true, true]);
  assert.deepStrictEqual(f.map((x) => x.outletCount), [2, 1, 1]);
  assert.deepStrictEqual(f[2].sources, [A, D], 'both articles are kept as sources');
}

// ------------------------------------------------------------ what makes an answer unusable
{
  for (const bad of [null, undefined, 'text', 42, [], [good()]]) {
    const r = check(bad);
    assert.strictEqual(r.value, null);
    assert.ok(r.problems.length > 0);
  }
  const without = (key) => { const r = good(); delete r[key]; return r; };
  assert.ok(check(without('summary')).problems.some((p) => /summary/.test(p)));
  assert.ok(check(without('keyFacts')).problems.some((p) => /keyFacts/.test(p)));
  assert.ok(check(without('suggestedAngles')).problems.some((p) => /suggestedAngles/.test(p)));
  assert.ok(check(without('outline')).problems.some((p) => /outline/.test(p)));
  assert.ok(check({ ...good(), keywords: {} }).problems.some((p) => /keywords/.test(p)));
  assert.ok(check({ ...good(), summary: '   ' }).problems.some((p) => /summary/.test(p)));
  assert.ok(check({ ...good(), suggestedAngles: [{ why: 'no title' }] }).problems.some((p) => /suggestedAngles/.test(p)));
  assert.ok(check({ ...good(), outline: [{ level: 2, heading: '', notes: ['x'] }] }).problems.some((p) => /outline/.test(p)));
  assert.ok(check({ ...good(), outline: 'a string' }).problems.some((p) => /outline/.test(p)));
  assert.ok(check({ ...good(), keyFacts: 'a string' }).problems.some((p) => /keyFacts/.test(p)));
  assert.strictEqual(check(without('summary')).value, null, 'a problem means no value at all, never a half-trusted brief');
  // all the problems are listed, so the retry can name them
  const many = check({ keyFacts: [], outline: [], suggestedAngles: [] });
  assert.ok(many.problems.length >= 5);
}

// ------------------------------------------------------------ the sections that may legitimately be empty
{
  const r = check({ ...good(), anglesTaken: undefined, gaps: [], chosenAngle: undefined });
  assert.deepStrictEqual(r.problems, []);
  assert.deepStrictEqual([r.value.anglesTaken, r.value.gaps], [[], []]);
  assert.strictEqual(r.value.chosenAngle, 'A renter\'s guide', 'with no chosen angle, the first suggestion');
  assert.strictEqual(check({ ...good(), chosenAngle: undefined }, { fallbackAngle: 'What the owner asked for' }).value.chosenAngle, 'What the owner asked for', 'or what the owner asked for');
  const half = check({ ...good(), anglesTaken: [{ outlet: 'ABC' }, { framing: 'no outlet' }, { outlet: 'Guardian', framing: 'ok' }] });
  assert.deepStrictEqual(half.value.anglesTaken, [{ outlet: 'Guardian', framing: 'ok' }]);
}

// ------------------------------------------------------------ sizes are capped
{
  const big = good();
  big.summary = 'x'.repeat(5000);
  big.keyFacts = Array.from({ length: 80 }, (_, i) => ({ fact: `Fact ${i} ${'y'.repeat(900)}`, sources: [ARTICLES[i % 3].url] }));
  big.anglesTaken = Array.from({ length: 50 }, (_, i) => ({ outlet: `O${i}`, framing: 'f' }));
  big.gaps = Array.from({ length: 50 }, (_, i) => `gap ${i}`);
  big.suggestedAngles = Array.from({ length: 9 }, (_, i) => ({ title: `Angle ${i}`, why: 'w' }));
  big.outline = Array.from({ length: 200 }, (_, i) => ({ level: 2, heading: `H${i}`, notes: Array.from({ length: 30 }, (_, j) => `n${j}`) }));
  big.keywords = { primary: 'k'.repeat(500), related: Array.from({ length: 40 }, (_, i) => `r${i}`) };
  const v = check(big).value;
  assert.strictEqual(v.summary.length, LIMITS.summary);
  assert.strictEqual(v.keyFacts.length, LIMITS.facts);
  assert.ok(v.keyFacts.every((f) => f.fact.length <= LIMITS.fact));
  assert.strictEqual(v.anglesTaken.length, LIMITS.anglesTaken);
  assert.strictEqual(v.gaps.length, LIMITS.gaps);
  assert.strictEqual(v.suggestedAngles.length, 3, 'three angles, however many the model gives');
  assert.strictEqual(v.outline.length, LIMITS.outline);
  assert.ok(v.outline.every((o) => o.notes.length === LIMITS.notes));
  assert.strictEqual(v.keywords.primary.length, LIMITS.keyword);
  assert.strictEqual(v.keywords.related.length, LIMITS.relatedKeywords);
  const manySources = good();
  manySources.keyFacts = [{ fact: 'Many.', sources: ARTICLES.map((a) => a.url) }];
  assert.strictEqual(check(manySources).value.keyFacts[0].sources.length, 4);
}

// ------------------------------------------------------------ text is plain: no tags, no control characters, no other fields
{
  assert.strictEqual(clean('<script>alert(1)</script>Hello <b>world</b>', 100), 'alert(1) Hello world');
  assert.strictEqual(clean('a\u0000b\u0007c\u001bd\ne\tf', 100), 'a b c d e f');
  assert.strictEqual(clean('  lots   of   space  ', 100), 'lots of space');
  assert.strictEqual(clean(42, 10), '');
  assert.strictEqual(clean({ toString: () => 'x' }, 10), '');
  assert.strictEqual(clean('abcdef', 3), 'abc');
  const raw = good();
  raw.summary = 'Ok <img src=x onerror=alert(1)> summary.';
  raw.outline[0].heading = '<h1>Big</h1> heading';
  raw.evil = '<script>x</script>';
  raw.keyFacts[0].html = '<b>x</b>';
  raw.keyFacts[0].fact = 'A fact with <a href="javascript:x">a link</a>.';
  const v = check(raw).value;
  assert.ok(!/[<>]/.test(JSON.stringify(v)), 'no angle brackets survive anywhere');
  assert.strictEqual('evil' in v, false);
  assert.strictEqual('html' in v.keyFacts[0], false);
  assert.deepStrictEqual(Object.keys(v).sort(), ['anglesTaken', 'chosenAngle', 'gaps', 'keyFacts', 'keywords', 'outline', 'suggestedAngles', 'summary']);
  assert.deepStrictEqual(Object.keys(v.keyFacts[0]).sort(), ['fact', 'outletCount', 'singleSource', 'sources']);
  // heading levels: only 2 and 3 exist
  const lv = good();
  lv.outline = [{ level: 1, heading: 'One' }, { level: '3', heading: 'Three' }, { level: 7, heading: 'Seven' }, { heading: 'None' }];
  assert.deepStrictEqual(check(lv).value.outline.map((o) => o.level), [2, 3, 2, 2]);
}

// ------------------------------------------------------------ the text the overlap check reads
{
  const v = check(good()).value;
  const fields = textFields(v);
  const names = fields.map((f) => f.field);
  assert.ok(names.includes('summary') && names.includes('fact 1') && names.includes('gap 1') && names.includes('outline note 1.2') && names.includes('suggested angle 2 reason'));
  assert.ok(fields.every((f) => f.text));
  assert.strictEqual(fields.find((f) => f.field === 'fact 2').text, 'Installers are booked out for months.');
}

console.log('topicResearch brief schema: all passed');
