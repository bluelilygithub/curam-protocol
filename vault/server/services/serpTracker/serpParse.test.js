'use strict';
// node server/services/serpTracker/serpParse.test.js   (hand-made fixture; expected values worked out by hand)
const assert = require('node:assert/strict');
const { parseSerp, SerpParseError } = require('./serpParse');

// A page: ad (abs 1), AI Overview (abs 2), organic rivals at group 1-2 (abs 3,4), People Also Ask (abs 5), mine at group 3 (abs 6),
// another of mine at group 6 (abs 9), local pack after.
const organic = (g, a, url, domain, title = 't') => ({ type: 'organic', rank_group: g, rank_absolute: a, url, domain, title });
const result = {
  keyword: 'walk in wine cabinets', check_url: 'https://www.google.com/search?q=x',
  items: [
    { type: 'paid', rank_group: 1, rank_absolute: 1, url: 'https://ad.example/', domain: 'ad.example' },
    { type: 'ai_overview', rank_group: 1, rank_absolute: 2, references: [
      { url: 'https://www.rival.com.au/guide', domain: 'www.rival.com.au', title: 'Guide' },
      { url: 'https://www.wiwc.com.au/cabinets/', domain: 'www.wiwc.com.au', title: 'Cabinets' },
      { url: 'https://www.rival.com.au/guide', domain: 'www.rival.com.au', title: 'dup' },
      { url: 'https://other.org/x', domain: 'other.org', title: 'Other' },
    ] },
    organic(1, 3, 'https://www.rival.com.au/', 'www.rival.com.au'),
    organic(2, 4, 'https://vintec.com/', 'vintec.com'),
    { type: 'people_also_ask', rank_group: 1, rank_absolute: 5 },
    organic(3, 6, 'https://www.wiwc.com.au/cabinets/', 'www.wiwc.com.au', 'Cabinets'),
    organic(4, 7, 'https://a.com/', 'a.com'), organic(5, 8, 'https://b.com/', 'b.com'),
    organic(6, 9, 'https://shop.wiwc.com.au/x', 'shop.wiwc.com.au'),
    organic(7, 10, 'https://c.com/', 'c.com'), organic(8, 11, 'https://d.com/', 'd.com'),
    organic(9, 12, 'https://e.com/', 'e.com'), organic(10, 13, 'https://f.com/', 'f.com'),
    organic(11, 14, 'https://g.com/', 'g.com'),
    { type: 'local_pack', rank_group: 1, rank_absolute: 15 },
  ],
};

const p = parseSerp(result, { myDomain: 'wiwc.com.au', competitors: ['rival.com.au', 'vintec.com'], depth: 100 });
assert.equal(p.keyword, 'walk in wine cabinets');
assert.equal(p.itemsCount, 15); // 1 ad + 1 AI overview + 11 organic + 1 PAA + 1 local pack = 15
assert.equal(p.organicCount, 11);
assert.equal(p.top10.length, 10); // position 11 is not in the top 10
assert.deepEqual(p.top10.slice(0, 3).map((r) => [r.position, r.domain, r.isMine]), [[1, 'rival.com.au', false], [2, 'vintec.com', false], [3, 'wiwc.com.au', true]]);
assert.equal(p.mine.status, 'ranked');
assert.equal(p.mine.bestPosition, 3);
assert.equal(p.mine.bestAbsolute, 6);
assert.equal(p.mine.bestUrl, 'https://www.wiwc.com.au/cabinets/');
assert.deepEqual(p.mine.urls.map((u) => u.position), [3, 6]); // every URL of mine, subdomain included
assert.equal(p.mine.itemsAboveMe, 3); // ad (1), AI overview (2), People Also Ask (5); the local pack is below
assert.deepEqual(p.layout.slice(0, 3), [{ type: 'paid', absolute: 1 }, { type: 'ai_overview', absolute: 2 }, { type: 'organic', absolute: 3 }]);

// AI Overview: duplicates collapse, mine and competitors flagged
assert.equal(p.aiOverview.present, true);
assert.equal(p.aiOverview.citations.length, 3);
assert.equal(p.aiOverview.mineCited, true);
assert.deepEqual(p.aiOverview.competitorsCited, ['rival.com.au']);
assert.equal(p.aiOverview.citations[0].domain, 'rival.com.au'); // www. dropped

// not ranked: NULL and a status, never 0; excluded from "items above"
const none = parseSerp({ keyword: 'k', items: [organic(1, 1, 'https://a.com/', 'a.com'), organic(2, 2, 'https://notwiwc.com.au/', 'notwiwc.com.au')] }, { myDomain: 'wiwc.com.au', depth: 100 });
assert.equal(none.mine.status, 'not_in_top_100');
assert.equal(none.mine.bestPosition, null);
assert.equal(none.mine.bestAbsolute, null);
assert.equal(none.mine.itemsAboveMe, null);
assert.deepEqual(none.mine.urls, []);
assert.equal(none.aiOverview.present, false);
assert.equal(none.aiOverview.mineCited, false);
assert.equal(parseSerp({ items: [organic(1, 1, 'https://a.com/', 'a.com')] }, { depth: 10 }).mine, null); // no site given: no "mine"

// zero organic results is an error, never "not ranked"
for (const bad of [{ keyword: 'k', items: [] }, { keyword: 'k', items: [{ type: 'paid', rank_group: 1, rank_absolute: 1 }] }, { keyword: 'k' }]) {
  assert.throws(() => parseSerp(bad, { myDomain: 'wiwc.com.au' }), SerpParseError);
}
assert.throws(() => parseSerp(null), SerpParseError);

// junk fields never break it
const messy = parseSerp({ keyword: 'k', items: [null, { type: 'organic' }, organic(1, 'x', 'https://a.com/', 'a.com'), organic(2, 2, 'https://b.com/', undefined)] }, { myDomain: 'b.com' });
assert.equal(messy.organicCount, 2); // two have a numeric rank_group and a url (a text rank_absolute is simply left null); the bare {type:'organic'} has neither and is skipped
assert.equal(messy.top10.find((r) => r.url === 'https://a.com/').absolute, null);
assert.equal(messy.mine.bestPosition, 2); // b.com has no domain field: it is read from its url
assert.equal(messy.layout.length, 3);

console.log('serpParse.test.js: all passed');
