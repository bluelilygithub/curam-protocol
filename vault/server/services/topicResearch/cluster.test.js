#!/usr/bin/env node
/**
 * Topic Research (milestone 3): grouping articles into stories. Three labelled headline sets (clusterFixtures.js) are the regression net;
 * the rest are small hand-built cases for the edges. Pure code: no database, no network.
 *
 * Run: node server/services/topicResearch/cluster.test.js
 */
'use strict';

const assert = require('assert');
const { tokenise, buildVectors, similarity, clusterArticles, DEFAULT_THRESHOLD } = require('./cluster');
const { FIXTURES, MAY_MERGE, articlesOf, gradeGrouping } = require('./clusterFixtures');

// ------------------------------------------------------------ words
assert.deepStrictEqual(tokenise('Heat pumps: the new rebate for Queensland homes!'), ['heat', 'pump', 'rebate', 'queensland', 'home']);
assert.deepStrictEqual(tokenise('see https://example.com/a-long-path?x=1 for details'), ['see', 'detail'], 'addresses are not words');
assert.deepStrictEqual(tokenise('A of in on at to'), [], 'short and filler words go');
assert.deepStrictEqual(tokenise('2026 budget'), ['2026', 'budget'], 'numbers count');
assert.deepStrictEqual(tokenise('glass and class'), ['glass', 'class'], 'a double s is not a plural');
assert.deepStrictEqual(tokenise(''), []);
assert.deepStrictEqual(tokenise(null), []);
assert.deepStrictEqual(tokenise('Pump PUMP pumps'), ['pump', 'pump', 'pump']);

// ------------------------------------------------------------ vectors
{
  const arts = [
    { id: 1, title: 'Cyclone Alfie hits Cairns', snippet: '' },
    { id: 2, title: 'Alfie cyclone batters Cairns coast', snippet: '' },
    { id: 3, title: 'Parliament passes budget', snippet: '' },
  ];
  const v = buildVectors(arts);
  for (const vec of v) {
    const len = Math.sqrt([...vec.values()].reduce((s, w) => s + w * w, 0));
    assert.ok(vec.size === 0 || Math.abs(len - 1) < 1e-9, 'every vector has length 1');
  }
  assert.ok(!v[2].has('parliament'), 'a word found in one article only is left out');
  const s = similarity(v[0], v[1]);
  assert.ok(s.cosine > 0.9 && s.shared >= 3, 'two headlines about one storm are alike');
  assert.deepStrictEqual(similarity(v[0], v[2]), { cosine: 0, shared: 0 });
  // a word in every article of a set of four or more (the topic itself) carries no weight
  const four = ['a', 'b', 'c', 'd'].map((x, i) => ({ id: i, title: `solar panels ${x}${x}${x} story${i % 2}`, snippet: '' }));
  assert.ok(buildVectors(four).every((vec) => !vec.has('solar') && !vec.has('panel')), 'the topic words are dropped');
}

// ------------------------------------------------------------ the labelled sets
for (const name of Object.keys(FIXTURES)) {
  const arts = articlesOf(name);
  const { assign } = clusterArticles(arts);
  assert.deepStrictEqual(gradeGrouping(name, assign), [], `${name}: grouped wrongly at the default threshold`);
}
// the choice of threshold is not a knife edge: the plateau found while tuning stays correct
for (const t of [0.325, 0.375, 0.425, 0.475, 0.5]) {
  for (const name of Object.keys(FIXTURES)) {
    assert.deepStrictEqual(gradeGrouping(name, clusterArticles(articlesOf(name), { threshold: t }).assign), [], `${name} at ${t}`);
  }
}
// and the grader itself can fail: far too low a threshold merges clear non-matches, far too high splits stories
assert.ok(gradeGrouping('cyclone', clusterArticles(articlesOf('cyclone'), { threshold: 0.01, minShared: 1 }).assign).length > 0, 'a threshold of ~0 must be graded as wrong');
assert.ok(gradeGrouping('heatPumps', clusterArticles(articlesOf('heatPumps'), { threshold: 0.99 }).assign).some((p) => /split/.test(p)), 'a threshold of ~1 must be graded as wrong');
assert.strictEqual(DEFAULT_THRESHOLD, 0.4);
assert.ok(Object.keys(MAY_MERGE).every((k) => k in FIXTURES));

// the apple set: one word, two unrelated meanings, kept apart
{
  const { clusters } = clusterArticles(articlesOf('apple'));
  const phones = articlesOf('apple').filter((a) => a.label === 'iphone').map((a) => a.id);
  const hail = articlesOf('apple').filter((a) => a.label === 'hail').map((a) => a.id);
  const cl = (id) => clusters.findIndex((c) => c.includes(id));
  assert.strictEqual(cl(phones[0]), cl(phones[1]));
  assert.strictEqual(cl(hail[0]), cl(hail[1]));
  assert.notStrictEqual(cl(phones[0]), cl(hail[0]), 'the company and the fruit are different stories');
}

// ------------------------------------------------------------ shape and edges
{
  assert.deepStrictEqual(clusterArticles([]), { clusters: [], assign: new Map() });
  const one = clusterArticles([{ id: 'x', title: 'Only one', snippet: '' }]);
  assert.deepStrictEqual(one.clusters, [['x']]);
  assert.strictEqual(one.assign.get('x'), 0);

  const arts = [
    { id: 'a', title: 'Cyclone Alfie hits Cairns hard', snippet: '' },
    { id: 'b', title: 'Budget day brings tax changes', snippet: '' },
    { id: 'c', title: 'Alfie cyclone hits Cairns coast hard', snippet: '' },
    { id: 'd', title: 'Tax changes arrive on budget day', snippet: '' },
  ];
  const { clusters, assign } = clusterArticles(arts);
  assert.deepStrictEqual(clusters, [['a', 'c'], ['b', 'd']], 'clusters in order of their first article, ids in input order');
  assert.strictEqual(assign.get('c'), 0);
  assert.strictEqual(assign.get('d'), 1);
  // the same input always gives the same answer
  assert.deepStrictEqual(clusterArticles(arts).clusters, clusters);

  // two articles in a set of two cannot merge on a single shared word
  const pair = clusterArticles([{ id: 1, title: 'Apple pie recipe', snippet: '' }, { id: 2, title: 'Apple stock falls', snippet: '' }]);
  assert.strictEqual(pair.clusters.length, 2, 'one shared word is not enough');
  const same = clusterArticles([{ id: 1, title: 'Cyclone Alfie crosses coast', snippet: '' }, { id: 2, title: 'Alfie cyclone crosses the coast', snippet: '' }]);
  assert.strictEqual(same.clusters.length, 1, 'but several shared words are');

  // chaining: A~B and B~C puts all three together even if A and C are not alike
  const chain = clusterArticles([
    { id: 'A', title: 'alpha bravo charlie delta', snippet: '' },
    { id: 'B', title: 'charlie delta echo foxtrot', snippet: '' },
    { id: 'C', title: 'echo foxtrot golf hotel', snippet: '' },
    { id: 'Z', title: 'unrelated words entirely here', snippet: '' },
  ], { threshold: 0.3 });
  assert.deepStrictEqual(chain.clusters, [['A', 'B', 'C'], ['Z']]);
}

// ------------------------------------------------------------ page text rescues a weak headline match
{
  const filler = [
    { id: 'f1', title: 'Parliament passes the budget', snippet: '' },
    { id: 'f2', title: 'Tax changes arrive next year', snippet: '' },
  ];
  const a = { id: 'a', title: 'Storm batters the coast', snippet: '' };
  const b = { id: 'b', title: 'Wild weather lashes shoreline', snippet: '' };
  assert.strictEqual(clusterArticles([a, b, ...filler]).clusters.length, 4, 'with no words in common the headlines stay apart');
  const body = 'Cyclone Alfie crossed the coast near Cairns overnight, cutting power to thousands of homes across Far North Queensland.';
  const withText = clusterArticles([{ ...a, text: body }, { ...b, text: body.replace('overnight', 'at dawn') }, ...filler]);
  assert.deepStrictEqual(withText.clusters[0], ['a', 'b'], 'the same story in the page text brings them together');
  // only the start of the text is used, so a long page does not drown the headline
  const long = `${'filler '.repeat(400)} Cyclone Alfie Cairns power thousands homes Queensland`;
  assert.strictEqual(clusterArticles([{ ...a, text: long }, { ...b, text: long }, ...filler]).clusters.length, 4, 'words far down a page are not read');
}

// ------------------------------------------------------------ a site's own chrome must not join unrelated stories
// A live check merged three unrelated ABC stories because every ABC page repeats a "Topic:" / "Posted ..." header and the same "related stories"
// box. The structure below is that page layout; the stories are unrelated, so they must stay apart, and the boilerplate must not get a say.
{
  const RELATED = '## Related stories\n\nAccused paedophile barrister sent disgusting message to charity, court hears\n\nMeasles outbreak spreads as vaccination rates fall in regional communities\n\nCharity boss accused over missing donations';
  const abcPage = (headline, topic, date, lead) => `# ${headline}\n\nBy A Reporter\n\nTopic:${topic}\n\nPosted ${date}\n\n## In short:\n\n${lead}\n\n${RELATED}`;
  const abc = [
    { id: 'navy', domain: 'abc.net.au', title: 'Recording device found in cabin of HMAS Leeuwin navy ship', snippet: '', text: abcPage('Investigation underway after recording device found in cabin of HMAS Leeuwin navy ship', 'Navy', 'Wed 14 Oct 2026 at 4:54pm', 'A recording device was discovered in the cabin of the Royal Australian Navy ship on October 11.\n\nMilitary police are investigating.') },
    { id: 'whales', domain: 'abc.net.au', title: 'Queensland tests acoustic alarms to ward off whales from shark nets', snippet: '', text: abcPage('Queensland tests acoustic alarms to ward off whales from shark nets', 'Marine Biology', 'Fri 11 Sep 2026 at 6:03am', 'A trial has begun of high-frequency acoustic alarms attached to shark nets off Noosa.\n\nThe nets will be monitored for effects on migratory whales.') },
    { id: 'flood', domain: 'abc.net.au', title: 'Multiple flood warnings as Queensland braces for more wild weather', snippet: 'Residents in the Gympie region are keeping a close eye on a major flood warning for the Mary River.', text: abcPage('Flood warnings as Queensland braces for more wild weather', 'Floods', 'Sun 25 Oct 2026 at 10:27am', 'The Mary River at Tiaro, north of Gympie, is rising and could reach the major flood level.\n\nA severe weather system is expected to bring heavy rain.') },
    { id: 'other1', domain: 'theguardian.com', title: 'Budget day brings tax changes for households', snippet: '', text: '' },
    { id: 'other2', domain: 'theconversation.com', title: 'Why interest rates keep falling and rising again', snippet: '', text: '' },
  ];
  const { clusters } = clusterArticles(abc);
  assert.strictEqual(clusters.length, 5, 'five unrelated stories stay five, boilerplate or not');
  // the same layout, but two of the three really are one story told twice by the same outlet
  const twice = [
    abc[2],
    { id: 'flood2', domain: 'abc.net.au', title: 'Mary River flood warning for Gympie as storms approach', snippet: 'Major flooding is possible at Tiaro on the Mary River north of Gympie.', text: abcPage('Mary River flood warning for Gympie as storms approach', 'Floods', 'Sun 25 Oct 2026 at 11:40am', 'Major flooding is possible on the Mary River at Tiaro north of Gympie.\n\nStorms are approaching.') },
    abc[0], abc[1], abc[3], abc[4],
  ];
  const grouped = clusterArticles(twice).clusters;
  assert.ok(grouped.some((c) => c.includes('flood') && c.includes('flood2')), 'two flood articles about the Mary River are one story');
  assert.strictEqual(grouped.length, 5, 'and the navy, whales and two other stories are each their own');

  // what pageTokens takes out
  const t = require('./cluster').pageTokens(abc);
  const words = (id) => t.get(id);
  assert.ok(!words('navy').includes('paedophile') && !words('whales').includes('paedophile'), 'a paragraph repeated across a site\'s pages is gone');
  assert.ok(!words('navy').includes('posted') && !words('whales').includes('topic'), 'a word on 60% or more of a site\'s pages is gone when three were read');
  assert.ok(words('navy').includes('leeuwin') && words('whales').includes('noosa'), 'the story itself stays');
  assert.ok(!t.has('other1') && !t.has('other2'), 'an article with no page text has no page words');

  // two pages of one site: only exactly repeated paragraphs can be told apart (too few to judge single words)
  const two = require('./cluster').pageTokens([
    { id: 1, domain: 's.com', text: 'Unique lead about volcanoes erupting.\n\nSubscribe to our newsletter today' },
    { id: 2, domain: 's.com', text: 'Another lead about glaciers melting.\n\nSubscribe to our newsletter today' },
  ]);
  assert.deepStrictEqual([two.get(1).includes('newsletter'), two.get(1).includes('erupting')], [false, true]);
  // the line is 60% of a site's pages: 3 of 5 is a site word and goes, 2 of 5 is not and stays
  const five = require('./cluster').pageTokens([
    { id: 1, domain: 'y.com', text: 'Lead one mentions alphaword and betaword.' },
    { id: 2, domain: 'y.com', text: 'Lead two mentions alphaword and betaword too.' },
    { id: 3, domain: 'y.com', text: 'Lead three mentions alphaword only.' },
    { id: 4, domain: 'y.com', text: 'Lead four has neither.' },
    { id: 5, domain: 'y.com', text: 'Lead five has neither either.' },
  ]);
  assert.deepStrictEqual([five.get(1).includes('alphaword'), five.get(1).includes('betaword')], [false, true], '3 of 5 pages is 60%: dropped. 2 of 5: kept');
  // no site name: nothing to compare with, nothing is removed
  const anon = require('./cluster').pageTokens([{ id: 1, text: 'Same paragraph here\n\nLead one' }, { id: 2, text: 'Same paragraph here\n\nLead two' }]);
  assert.ok(anon.get(1).includes('paragraph') && anon.get(2).includes('paragraph'));
  // chrome is taken out before the length limit, so a long boilerplate header cannot use up the room for the story
  const long = require('./cluster').pageTokens([
    { id: 1, domain: 'x.com', text: `${'Menu item.\n\n'.repeat(300)}The actual story about quokkas starts here.` },
    { id: 2, domain: 'x.com', text: `${'Menu item.\n\n'.repeat(300)}A different story about wombats.` },
  ]);
  assert.ok(long.get(1).includes('quokka') || long.get(1).includes('quokkas'), 'the story is found past 300 repeated menu lines');
}

// ------------------------------------------------------------ page text counts for less than the headline and snippet
{
  assert.strictEqual(require('./cluster').TEXT_WEIGHT, 0.5);
  const filler = [
    { id: 'f1', title: 'Parliament passes the budget', snippet: '' },
    { id: 'f2', title: 'Tax changes arrive next year', snippet: '' },
  ];
  const x = { id: 'x', title: 'Alpha bravo', snippet: '' };
  // y and z say the same words; y has "bravo" in its page text, z has it in its snippet
  const y = { id: 'y', title: 'Alpha zulu', snippet: '', text: 'bravo' };
  const z = { id: 'z', title: 'Alpha zulu', snippet: 'bravo' };
  const v = buildVectors([x, y, z, ...filler]);
  assert.ok(similarity(v[0], v[2]).cosine > similarity(v[0], v[1]).cosine, 'a shared word in the snippet says more than the same word in the page body');
}

console.log('topicResearch cluster: all passed');
