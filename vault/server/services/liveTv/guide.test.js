'use strict';

// node server/services/liveTv/guide.test.js   (no npm script on purpose: it would change package.json). No network, no database.

const assert = require('assert');
const g = require('./guide');

// ---- times and text ----
assert.strictEqual(g.parseXmltvTime('20261117193000 +1100').toISOString(), '2026-11-17T08:30:00.000Z', 'offset applied');
assert.strictEqual(g.parseXmltvTime('20261117193000 -0500').toISOString(), '2026-11-18T00:30:00.000Z');
assert.strictEqual(g.parseXmltvTime('202611171930').toISOString(), '2026-11-17T19:30:00.000Z', 'no seconds, no offset = UTC');
assert.strictEqual(g.parseXmltvTime('soon'), null);
assert.strictEqual(g.decodeXml('Tom &amp; Jerry &#8211; &#x2019;s &lt;b&gt; &unknown;'), 'Tom & Jerry – ’s <b> &unknown;');
assert.strictEqual(g.decodeXml('<![CDATA[A & B]]>'), 'A & B');
assert.strictEqual(g.titleKey('Doctor Who!'), g.titleKey('doctor  who'));
assert.strictEqual(g.titleKey('Māori Television & Friends'), 'maori television and friends');

// ---- XMLTV ----
const xml = `<?xml version="1.0"?><tv>
<channel id="mjh-abc-nsw"><display-name>ABC</display-name></channel>
<programme start="20261117190000 +1100" stop="20261117193000 +1100" channel="mjh-abc-nsw">
  <title lang="en">ABC News</title><desc>The day&apos;s news &amp; weather.</desc><category>News</category>
  <episode-num system="onscreen">S1 E5</episode-num><episode-num system="xmltv_ns">0.4.</episode-num>
</programme>
<programme start="20261117193000 +1100" stop="20261117203000 +1100" channel="mjh-abc-nsw"><title>Gardening Australia</title><sub-title>Spring</sub-title></programme>
<programme start="20261117193000 +1100" stop="20261117203000 +1100" channel="mjh-other"><title>Not wanted</title></programme>
<programme start="20261101000000 +1100" stop="20261101010000 +1100" channel="mjh-abc-nsw"><title>Too old</title></programme>
<programme start="20261117203000 +1100" stop="20261117210000 +1100" channel="mjh-abc-nsw"><title></title></programme>
</tv>`;
const from = new Date('2026-11-17T00:00:00Z');
const to = new Date('2026-11-25T00:00:00Z');
const progs = g.parseXmltv(xml, new Set(['mjh-abc-nsw']), from, to);
assert.deepStrictEqual(progs.map((p) => p.title), ['ABC News', 'Gardening Australia'], 'wanted channel, inside the window, with a title');
assert.strictEqual(progs[0].description, "The day's news & weather.");
assert.strictEqual(progs[0].episode, 'S1 E5', 'on-screen episode number only');
assert.strictEqual(progs[0].category, 'News');
assert.strictEqual(progs[1].subTitle, 'Spring');
assert.strictEqual(progs[0].start.toISOString(), '2026-11-17T08:00:00.000Z');

// ---- guides.json entries ----
const guidesText = JSON.stringify([
  { channel: 'ABC.au', site: 'i.mjh.nz', site_id: 'au/Sydney/epg#mjh-abc-nsw' },
  { channel: 'ABC.au', site: 'i.mjh.nz', site_id: 'au/Perth/epg#mjh-abc-wa' },
  { channel: 'ABC.au', site: 'abc.net.au', site_id: 'x' },
  { channel: 'Pluto1.us', site: 'i.mjh.nz', site_id: 'PlutoTV/us#pluto-1' },
  { channel: 'Perth9.au', site: 'i.mjh.nz', site_id: 'au/Perth/epg#mjh-9-wa' },
  { channel: null, site: 'i.mjh.nz', site_id: 'au/Sydney/epg#mjh-loose' },
  { channel: 'Bad.xx', site: 'i.mjh.nz', site_id: '../etc/passwd#x' },
]);
const map = g.guideMapFromText(guidesText);
assert.deepStrictEqual([...map.keys()].sort(), ['ABC.au', 'Perth9.au', 'Pluto1.us'], 'only i.mjh.nz entries with a channel and a safe file name');
assert.strictEqual(map.get('ABC.au').length, 2);

assert.deepStrictEqual(g.chooseEntry(map.get('ABC.au'), 'Perth'), { file: 'au/Perth/epg', xmltvId: 'mjh-abc-wa' }, 'the chosen city first');
assert.deepStrictEqual(g.chooseEntry(map.get('ABC.au'), 'Darwin'), { file: 'au/Sydney/epg', xmltvId: 'mjh-abc-nsw' }, 'otherwise the first city');
assert.strictEqual(g.chooseEntry([], 'Sydney'), null);

const plan = g.planFetch(map, ['Pluto1.us', 'ABC.au', 'Perth9.au', 'Unknown.xx'], 'Sydney', 2);
assert.deepStrictEqual(plan.files, ['au/Sydney/epg', 'PlutoTV/us'], 'the region file first, then the cap');
assert.deepStrictEqual(plan.skipped, ['au/Perth/epg']);
assert.deepStrictEqual(plan.byFile.get('au/Sydney/epg').get('mjh-abc-nsw'), ['ABC.au']);
assert.strictEqual(g.fileUrl('au/Sydney/epg'), 'https://i.mjh.nz/au/Sydney/epg.xml.gz');

console.log('liveTv guide tests passed');
