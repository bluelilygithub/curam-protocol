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
assert.equal(p.mine.bestPage, 1); // position 3 is on page 1
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

// ---- shapes seen in a REAL Live answer (6 Nov 2026): Google redirect links, the real site only in `breadcrumb`, pins with no address
const goto = (g, a, breadcrumb, site, extra = {}) => ({ type: 'organic', rank_group: g, rank_absolute: a, domain: 'google.com', url: `https://google.com/goto?url=CAES${g}opaque`, title: 't', breadcrumb, website_name: site, ...extra });
const real = {
  keyword: 'walk in wine cabinets', se_domain: 'google.com', location_code: 2036, language_code: 'en',
  items: [
    { type: 'ai_overview', rank_group: 1, rank_absolute: 1, references: [{ url: 'https://www.instagram.com/reel/x', domain: 'www.instagram.com', title: 'i' }] },
    goto(1, 2, 'https://www.pinterest.com › pin', 'Pinterest'),
    goto(2, 3, 'Pinterest · sgatling | 1 week ago', 'Pinterest · sgatling'), // no web address at all
    { type: 'images', rank_group: 1, rank_absolute: 4 },
    goto(3, 5, 'https://www.wiwc.com.au › cabinets › walk-in-wine-cabinet', 'Walk In Wine Cabinets'),
    goto(4, 6, 'https://www.retravision.com.au › liebherr-single-zone-f...', 'Retravision'),
  ],
};
let rp = parseSerp(real, { myDomain: 'wiwc.com.au', competitors: ['retravision.com.au'], depth: 10 });
assert.deepEqual(rp.top10.map((r) => r.domain), ['pinterest.com', '', 'wiwc.com.au', 'retravision.com.au']); // google.com is never reported as a result's website
assert.equal(rp.top10[1].site, 'Pinterest · sgatling'); // the site name is kept when there is no address
assert.equal(rp.unknownDomainCount, 1);
assert.equal(rp.mine.status, 'ranked'); // found through the breadcrumb, although `domain` said google.com
assert.equal(rp.mine.bestPosition, 3);
assert.equal(rp.mine.bestUrl, 'https://www.wiwc.com.au/cabinets/walk-in-wine-cabinet'); // the breadcrumb's arrows become slashes
assert.equal(rp.mine.uncertain, false);
assert.equal(rp.top10[2].isMine, true);
assert.equal(rp.top10[0].url.startsWith('https://google.com/goto?'), true); // the redirect link is kept for opening
assert.deepEqual(rp.searched, { seDomain: 'google.com', locationCode: 2036, languageCode: 'en' });
assert.deepEqual(rp.ads, []); // no paid items: an empty list, shown to the person as "no ads returned"

// not found while a result hides its website: not ranked, but flagged as uncertain, never silently "not ranked"
rp = parseSerp({ ...real, items: real.items.filter((i) => !(i.breadcrumb || '').includes('wiwc')) }, { myDomain: 'wiwc.com.au', depth: 10 });
assert.equal(rp.mine.status, 'not_in_top_10');
assert.equal(rp.mine.bestPosition, null);
assert.equal(rp.mine.uncertain, true);
// and when every result's website is known, not found is certain
rp = parseSerp({ keyword: 'k', items: [goto(1, 1, 'https://a.com › x', 'A'), goto(2, 2, 'https://b.com', 'B')] }, { myDomain: 'wiwc.com.au', depth: 10 });
assert.equal(rp.mine.uncertain, false);
assert.equal(rp.unknownDomainCount, 0);

// a result genuinely on a Google property (not a redirect link) keeps its own domain
rp = parseSerp({ keyword: 'k', items: [organic(1, 1, 'https://maps.google.com/place/x', 'maps.google.com')] }, { myDomain: 'wiwc.com.au', depth: 10 });
assert.equal(rp.top10[0].domain, 'maps.google.com');
assert.equal(rp.unknownDomainCount, 0);

// ads: listed with their position, advertiser and text; my own ad is flagged; at most ten
const withAds = { keyword: 'k', items: [
  { type: 'paid', rank_group: 1, rank_absolute: 1, domain: 'www.wiwc.com.au', title: 'Wine cabinets', url: 'https://www.wiwc.com.au/ad', description: 'Buy now' },
  { type: 'paid', rank_group: 2, rank_absolute: 2, domain: 'rival.com.au', title: 'Rival', url: 'https://rival.com.au/', description: 'Also buy' },
  organic(1, 3, 'https://a.com/', 'a.com'),
] };
rp = parseSerp(withAds, { myDomain: 'wiwc.com.au', depth: 10 });
assert.equal(rp.ads.length, 2);
assert.deepEqual(rp.ads.map((a) => [a.position, a.domain, a.isMine]), [[1, 'wiwc.com.au', true], [2, 'rival.com.au', false]]);
assert.equal(rp.ads[0].description, 'Buy now');
assert.equal(rp.mine.itemsAboveMe, null); // I am not in the organic results, so there is nothing "above my first result"
assert.equal(parseSerp({ keyword: 'k', items: [...Array.from({ length: 14 }, (_, i) => ({ type: 'paid', rank_group: i + 1, rank_absolute: i + 1, domain: 'x.com', url: 'https://x.com/' })), organic(1, 15, 'https://a.com/', 'a.com')] }, { depth: 10 }).ads.length, 10);

// ---- the REAL Live answer saved on 6 Nov 2026 (fixtures/live-walk-in-wine-cabinets-desktop-australia.json), expected values read off it by hand
const realAnswer = require('./fixtures/live-walk-in-wine-cabinets-desktop-australia.json').tasks[0].result[0];
const rr = parseSerp(realAnswer, { myDomain: 'wiwc.com.au', competitors: ['retravision.com.au', 'vintec.com'], depth: 10 });
assert.equal(rr.organicCount, 8);
assert.deepEqual(rr.top10.map((r) => r.domain), ['pinterest.com', '', '', 'retravision.com.au', 'appliancesonline.com.au', '', '', 'winnings.com.au']);
assert.equal(rr.unknownDomainCount, 4); // four Pinterest pins show no web address
assert.deepEqual(rr.searched, { seDomain: 'google.com', locationCode: 2036, languageCode: 'en' });
assert.deepEqual(rr.ads, []); // this answer had no paid items
assert.equal(rr.mine.status, 'not_in_top_10');
assert.equal(rr.mine.bestPosition, null);
assert.equal(rr.mine.uncertain, true); // not found, but four results hide their website
assert.equal(rr.aiOverview.present, true);
assert.deepEqual(rr.aiOverview.citations.map((c) => c.domain), ['instagram.com', 'youtube.com', 'captivatingcabinets.com']);
assert.equal(rr.aiOverview.mineCited, false);
assert.deepEqual(rr.layout.map((l) => l.type), ['ai_overview', 'organic', 'organic', 'images', 'organic', 'organic', 'organic', 'organic', 'organic', 'organic']);
assert.equal(rr.mine.itemsAboveMe, null);
// and if the owner's site had been one of the results, it would be found despite the redirect links
const asIfMine = JSON.parse(JSON.stringify(realAnswer));
asIfMine.items.find((i) => i.website_name === 'Winning Appliances').breadcrumb = 'https://www.wiwc.com.au › walk-in-wine-cabinets';
const found = parseSerp(asIfMine, { myDomain: 'wiwc.com.au', depth: 10 });
assert.equal(found.mine.status, 'ranked');
assert.equal(found.mine.bestPosition, 8);

// deep positions: about which page of results. 10 per page: 10 -> page 1, 11 -> page 2, 118 -> page 12, 120 -> page 12
const deepItems = (pos) => ({ keyword: 'k', items: [...Array.from({ length: 130 }, (_, i) => organic(i + 1, i + 1, i + 1 === pos ? 'https://www.wiwc.com.au/x' : `https://s${i}.com/`, i + 1 === pos ? 'www.wiwc.com.au' : `s${i}.com`))] });
for (const [pos, page] of [[10, 1], [11, 2], [118, 12], [120, 12], [121, 13]]) {
  const d = parseSerp(deepItems(pos), { myDomain: 'wiwc.com.au', depth: 130 });
  assert.equal(d.mine.bestPosition, pos);
  assert.equal(d.mine.bestPage, page, `position ${pos} is page ${page}`);
  assert.equal(d.top10.length, 10); // only ten are kept as "top 10"; the position is read from all of them
}
assert.equal(parseSerp(deepItems(0), { myDomain: 'wiwc.com.au', depth: 130 }).mine.bestPage, null); // not found: no page

// coverage: how much of what was asked for came back (a short answer must never be reported as "checked the top 100")
assert.deepEqual(rr.coverage, { asked: 10, returned: 8, complete: true }); // asking for 10 and getting 8 ordinary results is a normal page
const cov = (n, depth) => parseSerp({ keyword: 'k', items: Array.from({ length: n }, (_, i) => organic(i + 1, i + 1, `https://s${i}.com/`, `s${i}.com`)) }, { myDomain: 'wiwc.com.au', depth }).coverage;
assert.deepEqual(cov(13, 100), { asked: 100, returned: 13, complete: false }); // the real short answer
assert.deepEqual(cov(97, 100), { asked: 100, returned: 97, complete: true }); // the real full answer
assert.deepEqual(cov(90, 100), { asked: 100, returned: 90, complete: true }); // 90% counts as complete
assert.deepEqual(cov(89, 100), { asked: 100, returned: 89, complete: false });
assert.deepEqual(cov(14, 20), { asked: 20, returned: 14, complete: false });
assert.deepEqual(cov(8, 10), { asked: 10, returned: 8, complete: true });

console.log('serpParse.test.js: all passed');
