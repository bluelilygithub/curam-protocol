#!/usr/bin/env node
/**
 * Topic Research (milestone 4): did the brief copy a source? Pure code: no model, no database, no network.
 *
 * Run: node server/services/topicResearch/brief/overlap.test.js
 */
'use strict';

const assert = require('assert');
const { findOverlaps, normaliseWords, RUN } = require('./overlap');

const ARTICLE_TEXT = [
  'Residents in the Gympie region are keeping a close eye on a major flood warning for the Mary River as south-east Queensland braces for severe storms this weekend.',
  'The Bureau of Meteorology says the river at Tiaro could reach the major flood level by Monday morning and that further rain is expected across the catchment.',
].join(' ');
const SOURCES = [
  { url: 'https://abc.net.au/a', title: 'Flood warnings', texts: ['Flood warnings as Queensland braces', 'A short snippet.', ARTICLE_TEXT] },
  { url: 'https://theguardian.com/b', title: 'Storm coverage', texts: ['Unusually large storm', 'Another snippet here.', 'The storm is unusually large and slow moving, forecasters said on Sunday, with damaging winds and hail expected from the Gold Coast to the Hunter.'] },
];
const brief = (text, field = 'fact 1') => [{ field, text }];

// ------------------------------------------------------------ the milestone's test: a planted 15-word copied sentence
{
  const copied = 'major flood warning for the Mary River as south-east Queensland braces for severe storms';
  assert.strictEqual(normaliseWords(copied).length, 15, 'the planted sentence is exactly 15 words');
  const planted = `Locals are watching closely, and ${copied}, according to local reports.`;
  const f = findOverlaps(brief(planted), SOURCES);
  assert.strictEqual(f.length, 1, 'one copied stretch');
  assert.strictEqual(f[0].sourceUrl, 'https://abc.net.au/a');
  assert.strictEqual(f[0].sourceTitle, 'Flood warnings');
  assert.strictEqual(f[0].field, 'fact 1');
  assert.ok(f[0].words >= 15, `the whole copied stretch is reported (got ${f[0].words} words)`);
  assert.ok(f[0].excerpt.split(' ').length <= 14, 'only a short excerpt is kept');
  assert.strictEqual(f[0].words, 15, 'reported as the 15 copied words');
  assert.ok(f[0].excerpt.startsWith('major flood warning'), 'the excerpt starts where the copying starts');
}

// ------------------------------------------------------------ the length line: 12 words is a copy, 11 is not
{
  const w = normaliseWords(ARTICLE_TEXT);
  const take = (n, from = 0) => w.slice(from, from + n).join(' ');
  assert.strictEqual(RUN, 12);
  assert.strictEqual(findOverlaps(brief(`Totally new words ${take(12, 5)} and more new words.`), SOURCES).length, 1, 'exactly 12 words in a row');
  assert.strictEqual(findOverlaps(brief(`Totally new words ${take(11, 5)} and more new words.`), SOURCES).length, 0, 'only 11');
  // two 11-word pieces of the same article, separated by the brief's own words, are not a copy
  assert.strictEqual(findOverlaps(brief(`${take(11, 0)} but then something different ${take(11, 30)}`), SOURCES).length, 0);
  // a custom line
  assert.strictEqual(findOverlaps(brief(take(8, 5)), SOURCES, { run: 8 }).length, 1);
}

// ------------------------------------------------------------ what does not count as different
{
  const original = 'could reach the major flood level by Monday morning and that further rain is expected across the catchment';
  const variants = [
    original.toUpperCase(),
    original.replace(/ /g, '   '),
    original.replace('flood level', 'flood-level,').replace('Monday morning', '"Monday morning"'),
    `\n${original}\n`,
    original.replace(/,/g, ';'),
  ];
  for (const v of variants) assert.strictEqual(findOverlaps(brief(v), SOURCES).length, 1, `still a copy: ${v.slice(0, 40)}`);
  // a changed word breaks it
  const changed = original.replace('Monday', 'Tuesday');
  assert.strictEqual(findOverlaps(brief(changed), SOURCES).length, 0, 'changing one word in the middle of 19 leaves runs of 9 and 8');
}

// ------------------------------------------------------------ a short quotation is allowed
{
  const quote = 'The storm is unusually large and slow moving, forecasters said'; // 10 words
  assert.strictEqual(findOverlaps(brief(`One forecaster put it this way: "${quote}" and that was that.`), SOURCES).length, 0);
}

// ------------------------------------------------------------ several findings, several sources, several places
{
  const w1 = normaliseWords(ARTICLE_TEXT).slice(0, 14).join(' ');
  const w2 = normaliseWords(SOURCES[1].texts[2]).slice(0, 13).join(' ');
  const fields = [
    { field: 'summary', text: `${w1} then something original in the middle of this long sentence before ${w2}` },
    { field: 'fact 2', text: 'Nothing copied here at all, just ordinary words that were written fresh by the model.' },
    { field: 'outline note 1.1', text: w2 },
  ];
  const f = findOverlaps(fields, SOURCES);
  assert.deepStrictEqual(f.map((x) => [x.field, x.sourceUrl]), [['summary', 'https://abc.net.au/a'], ['summary', 'https://theguardian.com/b'], ['outline note 1.1', 'https://theguardian.com/b']]);
  assert.ok(f.every((x) => x.words >= 12));
}

// ------------------------------------------------------------ each text is compared on its own
{
  // the end of the headline and the start of the snippet would make 12 words if joined; they must not be
  const headTail = normaliseWords('one two three four five six').join(' ');
  const snipHead = normaliseWords('seven eight nine ten eleven twelve').join(' ');
  const s = [{ url: 'https://x.com/1', title: 't', texts: [headTail, snipHead] }];
  assert.strictEqual(findOverlaps(brief('one two three four five six seven eight nine ten eleven twelve'), s).length, 0, 'two separate texts are not one run');
  // and the brief's own fields are not joined to each other either
  const s2 = [{ url: 'https://x.com/1', title: 't', texts: ['one two three four five six seven eight nine ten eleven twelve'] }];
  const split = [{ field: 'a', text: 'one two three four five six' }, { field: 'b', text: 'seven eight nine ten eleven twelve' }];
  assert.strictEqual(findOverlaps(split, s2).length, 0);
}

// ------------------------------------------------------------ the quiet cases
{
  assert.deepStrictEqual(findOverlaps(brief('anything at all'), []), []);
  assert.deepStrictEqual(findOverlaps([], SOURCES), []);
  assert.deepStrictEqual(findOverlaps(brief(''), SOURCES), []);
  assert.deepStrictEqual(findOverlaps(brief('short'), [{ url: 'u', title: 't', texts: ['also short', null, undefined, ''] }]), []);
  assert.deepStrictEqual(findOverlaps(brief('x'), [{ url: 'u', title: 't' }]), [], 'a source with no texts');
  // words from other languages and numbers are words too
  const accents = 'le café crème est servi à la terrasse avec des croissants frais chaque matin dès sept heures';
  assert.strictEqual(findOverlaps(brief(accents), [{ url: 'u', title: 't', texts: [accents.toUpperCase()] }]).length, 1);
  assert.deepStrictEqual(normaliseWords('Rebate: $1,000 (up to) 2026!'), ['rebate', '1', '000', 'up', 'to', '2026']);
}

// ------------------------------------------------------------ speed: twelve long articles and a full brief
{
  // seeded pseudo-random words: runs of 12 never repeat by accident, so the only copy is the planted one
  const filler = (seed, n) => { let x = seed * 2654435761 % 4294967296; return Array.from({ length: n }, () => { x = (x * 1664525 + 1013904223) % 4294967296; return `w${x % 200000}`; }).join(' '); };
  const sources = Array.from({ length: 12 }, (_, i) => ({ url: `https://s${i}.com/a`, title: `S${i}`, texts: [`Headline ${i}`, 'snippet words here', filler(i, 1500)] }));
  const fields = Array.from({ length: 60 }, (_, i) => ({ field: `fact ${i}`, text: filler(i + 100, 40) }));
  fields.push({ field: 'planted', text: `before ${sources[7].texts[2].split(' ').slice(300, 330).join(' ')} after` });
  const t0 = Date.now();
  const f = findOverlaps(fields, sources);
  const ms = Date.now() - t0;
  assert.ok(ms < 1500, `took ${ms}ms`);
  const hit = f.find((x) => x.field === 'planted');
  assert.ok(hit && hit.sourceUrl === 'https://s7.com/a' && hit.words === 30, 'the planted 30-word copy is found among 18,000 words of other text');
}

console.log('topicResearch brief overlap: all passed');
