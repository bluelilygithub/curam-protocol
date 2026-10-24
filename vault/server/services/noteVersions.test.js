'use strict';

// node server/services/noteVersions.test.js   (part of npm run test:notes)
// When the text a note had before a save is kept as an earlier version.

const assert = require('assert');
const V = require('./noteVersions');

const at = (min) => new Date(Date.UTC(2026, 9, 24, 2, min));
const prev = (body, min = 10, title = 'Plan') => ({ title, body, savedAt: at(min) });
const next = (body, title = 'Plan') => ({ title, body });
const text = (n) => 'word '.repeat(n).trim();

// nothing changed, nothing to keep; an empty note has nothing to go back to
assert.strictEqual(V.shouldKeep({ prev: prev('same'), next: next('same'), lastKeptAt: null }), false);
assert.strictEqual(V.shouldKeep({ prev: prev(''), next: next('first words'), lastKeptAt: null }), false);
assert.strictEqual(V.shouldKeep({ prev: { title: '', body: '   ', savedAt: at(1) }, next: next('x'), lastKeptAt: null }), false);

// the first change to a note keeps what it was
assert.strictEqual(V.shouldKeep({ prev: prev('hello there'), next: next('hello there again'), lastKeptAt: null }), true);

// typing: one version per five minutes, not one per autosave
assert.strictEqual(V.shouldKeep({ prev: prev('abc def', 10), next: next('abc def g'), lastKeptAt: at(8) }), false, 'two minutes after the last one');
assert.strictEqual(V.shouldKeep({ prev: prev('abc def', 14), next: next('abc def g'), lastKeptAt: at(8) }), true, 'six minutes after the last one');
assert.strictEqual(V.shouldKeep({ prev: prev('abc def', 13), next: next('abc def g'), lastKeptAt: at(8) }), true, 'exactly five minutes counts');

// a big change is kept even a second after the last version: this is the "I deleted half of it" case
const long = text(300); // about 1,500 characters
assert.strictEqual(V.shouldKeep({ prev: prev(long, 10), next: next(text(100)), lastKeptAt: at(10) }), true, 'cut down to a third');
assert.strictEqual(V.shouldKeep({ prev: prev(long, 10), next: next(''), lastKeptAt: at(10) }), true, 'wiped');
assert.strictEqual(V.shouldKeep({ prev: prev(long, 10), next: next(`${long} ${text(10)}`), lastKeptAt: at(10) }), false, 'a few words added is not big');
assert.strictEqual(V.shouldKeep({ prev: prev('short note', 10), next: next(`short note ${text(60)}`), lastKeptAt: at(10) }), true, 'a short note that grew a lot');
assert.strictEqual(V.shouldKeep({ prev: prev(text(1000), 10), next: next(text(1000).slice(0, -150)), lastKeptAt: at(10) }), false, '150 characters off a long note is small');

// AI changes and restores are always kept, so each can be undone
assert.strictEqual(V.shouldKeep({ prev: prev('abc def', 10), next: next('abc def g'), lastKeptAt: at(10), reason: 'ai' }), true);
assert.strictEqual(V.shouldKeep({ prev: prev('abc def', 10), next: next('abc'), lastKeptAt: at(10), reason: 'restore' }), true);
assert.strictEqual(V.shouldKeep({ prev: prev('abc def', 10), next: next('abc def'), lastKeptAt: at(10), reason: 'ai' }), false, 'but only if something changed');

// a renamed note counts as a change
assert.strictEqual(V.shouldKeep({ prev: prev('body', 10, 'Old title'), next: next('body', 'New title'), lastKeptAt: null }), true);

// housekeeping
assert.strictEqual(V.cleanReason('ai'), 'ai');
assert.strictEqual(V.cleanReason('delete everything'), 'edit', 'only known reasons');
assert.strictEqual(V.previewOf('  # Title\n\nsome   words \n here '), '# Title some words here');
assert.strictEqual(V.previewOf(null), '');

console.log('noteVersions tests passed');
