'use strict';
// node server/services/youtubeLabels.test.js   (part of npm run test:youtube). No database.
const assert = require('node:assert/strict');
const L = require('./youtubeLabels');

// category
assert.equal(L.normalizeCategory('  Home   Cooking '), 'Home Cooking');
assert.equal(L.normalizeCategory('<b>Tech</b>, news;'), 'Tech news');
assert.equal(L.normalizeCategory(null), '');
assert.equal(L.normalizeCategory('x'.repeat(100)).length, 40);

// reading a change: only the fields sent, bad shapes refused
assert.deepEqual(L.readLabels({}), {});
assert.deepEqual(L.readLabels({ category: ' Recipes ' }), { category: 'Recipes' });
assert.deepEqual(L.readLabels({ category: null }), { category: '' }, 'null clears the category');
assert.deepEqual(L.readLabels({ tags: ['#Budget', 'budget', ' Home  Loan ', ''] }), { tags: ['budget', 'home loan'] }, 'tags follow the note-tag rule');
assert.equal(L.readLabels({ tags: 'budget' }), null);
assert.equal(L.readLabels({ category: 5 }), null);
assert.equal(L.readLabels({ tags: Array.from({ length: 40 }, (_, i) => `t${i}`) }).tags.length, 20);

// the tags a note carries
assert.deepEqual(L.noteTagsFor({ category: 'Home Cooking', tags: ['bread', 'Home cooking'] }), ['bread', 'home cooking'], 'category joins the tags without a repeat');
assert.deepEqual(L.noteTagsFor({ category: '', tags: null }), []);

// the note
const md = L.buildVideoNote({
  videoId: 'abc123DEF45', title: 'Sourdough <b>basics</b>', channel: 'Baker Bob', duration: 'PT12M30S', publishedAt: '2026-03-04T10:00:00Z',
  category: 'Recipes', tags: ['bread', 'home cooking'], points: ['Starter: feed it daily.', ''], overview: 'A short guide.',
});
assert.ok(!/^# /m.test(md), 'the title is the note title, not a heading in the text');
assert.match(md, /^\[Watch on YouTube\]/);
assert.match(md, /\[Watch on YouTube\]\(https:\/\/www\.youtube\.com\/watch\?v=abc123DEF45\)/);
assert.match(md, /Baker Bob · 13 minutes · published 2026-03-04/);
assert.match(md, /\*\*Category:\*\* Recipes/);
assert.match(md, /\*\*Tags:\*\* #bread #home-cooking/);
assert.match(md, /## Main points\n\n- Starter: feed it daily\.\n/);
assert.match(md, /## Summary\n\nA short guide\./);
assert.match(md, /## My notes\n$/);
const bare = L.buildVideoNote({ videoId: 'abc123DEF45', title: '', tags: [] });
assert.match(bare, /^\[Watch on YouTube\]/);
assert.ok(!/Category|Tags|Main points|Summary/.test(bare), 'nothing is invented when nothing was saved');
assert.ok(!/\n\n\n/.test(md), 'no stacked blank lines');

// transcript paragraphs and the transcript in the note
const lines = [];
for (let i = 0; i < 20; i++) lines.push({ start: i * 10, text: i % 4 === 3 ? `Line ${i}.` : `Line ${i}` });
const paras = L.transcriptParagraphs(lines);
assert.ok(paras.length > 1 && paras.length < 20 && paras[0].start === 0);
assert.equal(L.transcriptParagraphs(null).length, 0);
const withT = L.buildVideoNote({ videoId: 'abc123DEF45', title: 'T', paragraphs: [{ start: 65, text: 'Hello there.' }] });
assert.match(withT, /## Transcript\n\n\[1:05\]\(https:\/\/www\.youtube\.com\/watch\?v=abc123DEF45&t=65s\) Hello there\./);
assert.ok(withT.indexOf('## Transcript') < withT.indexOf('## My notes'));
const noT = L.buildVideoNote({ videoId: 'abc123DEF45', title: 'T', paragraphs: [], transcriptMissing: true });
assert.match(noT, /No transcript could be read/);
assert.ok(!/## Transcript/.test(L.buildVideoNote({ videoId: 'abc123DEF45', title: 'T' })), 'no transcript section unless asked');

// searching inside transcripts
assert.deepEqual(L.searchPatterns('Bread dough'), ['%bread%', '%dough%']);
assert.deepEqual(L.searchPatterns('a'), []);
assert.deepEqual(L.searchPatterns('100%_x'), ['%100\\%\\_x%'], 'LIKE characters are escaped');
assert.equal(L.searchPatterns('aa bb cc dd ee ff gg hh').length, 6);
assert.deepEqual(L.snippetFor([{ start: 5, text: 'nothing' }, { start: 12.7, text: 'Feed the Starter daily' }], 'starter'), { at: 12, text: 'Feed the Starter daily' });
assert.equal(L.snippetFor([{ start: 5, text: 'nothing' }], 'zzz'), null);

console.log('youtubeLabels: ok');
