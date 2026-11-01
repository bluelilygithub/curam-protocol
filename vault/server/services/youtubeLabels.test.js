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
assert.match(md, /^# Sourdough basics\n/);
assert.match(md, /\[Watch on YouTube\]\(https:\/\/www\.youtube\.com\/watch\?v=abc123DEF45\)/);
assert.match(md, /Baker Bob · 13 minutes · published 2026-03-04/);
assert.match(md, /\*\*Category:\*\* Recipes/);
assert.match(md, /\*\*Tags:\*\* #bread #home-cooking/);
assert.match(md, /## Main points\n\n- Starter: feed it daily\.\n/);
assert.match(md, /## Summary\n\nA short guide\./);
assert.match(md, /## My notes\n$/);
const bare = L.buildVideoNote({ videoId: 'abc123DEF45', title: '', tags: [] });
assert.match(bare, /^# YouTube video\n/);
assert.ok(!/Category|Tags|Main points|Summary/.test(bare), 'nothing is invented when nothing was saved');
assert.ok(!/\n\n\n/.test(md), 'no stacked blank lines');

console.log('youtubeLabels: ok');
