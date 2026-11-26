'use strict';
// node server/services/htmlContentCheck/diff.speed.test.js
// How long reading and comparing take on a page near the 500,000-character cap: a few edits, and very many. Prints the timings; fails
// only if something is far too slow for a request (the diff runs while a round is kept, inside the request).
const assert = require('node:assert/strict');
const { buildSnapshot } = require('./extract');
const { diffSnapshots } = require('./diff');
const { planBatches } = require('./match');
const { MAX_SNAPSHOT_CHARS } = require('./config');

const WORDS = 'painting gallery studio exhibition colour canvas portrait landscape collection artist light still life drawing print sketch'.split(' ');
const sentence = (seed, n) => Array.from({ length: n }, (_, i) => WORDS[(seed * 7 + i * 13) % WORDS.length]).join(' ');
const para = (i) => `Paragraph ${i}: ${sentence(i, 60)}.`;
const AVG = Array.from({ length: 200 }, (_, i) => para(i).length).reduce((x, y) => x + y, 0) / 200;
const N = Math.floor((MAX_SNAPSHOT_CHARS * 0.93) / (AVG + 8)); // just under the cap, room for the edited page's extra words
const section = (i) => (i % 40 === 0 ? `<h2>Section ${i / 40}</h2>` : '');
const page = (paras) => `<html><body>${paras.map((p, i) => `${section(i)}<p>${p}</p>`).join('')}</body></html>`;
const base = Array.from({ length: N }, (_, i) => para(i));

// a few edits: 2% of paragraphs reworded
const few = base.map((p, i) => (i % 50 === 7 ? p.replace('gallery', 'museum') : p));
// very many: a third reworded, one in twenty removed, one in twenty new ones added, and a block of 30 moved to the end
let many = base.map((p, i) => (i % 3 === 0 ? `${p.slice(0, 200)} reworded here ${p.slice(200)}` : p)).filter((_, i) => i % 20 !== 5);
many = many.flatMap((p, i) => (i % 20 === 11 ? [p, `A new paragraph ${i} ${sentence(i + 3, 40)}.`] : [p]));
const moved = many.splice(500, 30);
many.push(...moved);

const time = (fn) => { const t = process.hrtime.bigint(); const out = fn(); return [out, Number(process.hrtime.bigint() - t) / 1e6]; };
const [a, tA] = time(() => buildSnapshot(page(base), { finalUrl: 'https://x.example/', fetchedVia: 'plain' }).snapshot);
assert.ok(a.meta.chars > MAX_SNAPSHOT_CHARS * 0.9 && a.meta.chars <= MAX_SNAPSHOT_CHARS, `near the cap: ${a.meta.chars}`);
const [b1] = time(() => buildSnapshot(page(few), { finalUrl: 'https://x.example/', fetchedVia: 'plain' }).snapshot);
const [b2] = time(() => buildSnapshot(page(many), { finalUrl: 'https://x.example/', fetchedVia: 'plain' }).snapshot);
const [d1, t1] = time(() => diffSnapshots(a, b1));
const [d2, t2] = time(() => diffSnapshots(a, b2));
const json = Buffer.byteLength(JSON.stringify(a));

console.log(`page: ${a.meta.chars.toLocaleString('en-AU')} characters, ${a.blocks.length} blocks, snapshot ${(json / 1024 / 1024).toFixed(1)} MB as JSON`);
console.log(`read into a snapshot: ${tA.toFixed(0)} ms`);
console.log(`diff, a few edits:    ${t1.toFixed(0)} ms, ${JSON.stringify(d1.stats)}`);
console.log(`diff, very many:      ${t2.toFixed(0)} ms, ${JSON.stringify(d2.stats)}`);
const plan = planBatches(d2.changes);
console.log(`matching that page:   ${plan.batches.length} model calls, ${plan.leftOut} changes left out`);

assert.equal(d1.stats.changed, Math.ceil((N - 7) / 50));
assert.ok(d2.stats.moved >= 30, 'the moved block (section headings placed by position can shift too)');
assert.ok(t1 < 5000, `a few edits took ${t1} ms`);
assert.ok(t2 < 15000, `very many took ${t2} ms`);
// ---- the worst case: 20,000 short list items, every one different. Before milestone 4 reading took about 50 s a page (jsdom's
// HTMLCollection in the reader) and lining up 110 s; now the reader uses childNodes and the line-up has a time limit (marked rough).
const list = (tag) => `<html><body><ul>${Array.from({ length: 20000 }, (_, i) => `<li>${tag} item ${i} x</li>`).join('')}</ul></body></html>`;
const [la, tl] = time(() => buildSnapshot(list('alpha'), { finalUrl: 'https://x.example/', fetchedVia: 'plain' }).snapshot);
const lb = buildSnapshot(list('beta'), { finalUrl: 'https://x.example/', fetchedVia: 'plain' }).snapshot;
const [dl, tdl] = time(() => diffSnapshots(la, lb));
console.log(`20,000 list items: read ${tl.toFixed(0)} ms, all different ${tdl.toFixed(0)} ms, ${JSON.stringify(dl.stats)}`);
assert.equal(la.blocks.length, 20000);
assert.ok(tl < 8000, `reading 20,000 list items took ${tl} ms`);
assert.ok(tdl < 8000, `the worst-case diff took ${tdl} ms`);
assert.equal(dl.stats.rough, true, 'a line-up that ran out of time says so');
assert.equal(dl.stats.changed, 20000, 'and still pairs the blocks in order');
assert.equal(diffSnapshots(a, b1).stats.rough, undefined, 'an ordinary page is never rough');
console.log('diff.speed.test.js: passed');
