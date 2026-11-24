'use strict';

const assert = require('assert');
const { SOURCES, MAX_SOURCES, isAllowedAtoUrl, sourcesForRun } = require('./sources');

assert.ok(SOURCES.length > 0 && SOURCES.length <= MAX_SOURCES, 'a small fixed allow-list');
assert.strictEqual(SOURCES.length, 7, 'the same seven ATO pages as Shares');
assert.ok(SOURCES.every((s) => s.id && s.label && s.url && s.focus), 'every source has an id, label, url and purpose');
assert.ok(SOURCES.every((s) => isAllowedAtoUrl(s.url)), 'every registry URL is on the ATO host allow-list');
assert.deepStrictEqual(sourcesForRun().map((s) => s.url), SOURCES.map((s) => s.url));
assert.notStrictEqual(sourcesForRun()[0], SOURCES[0], 'callers get copies, not the frozen registry');

for (const url of [
  'https://www.ato.gov.au/about-ato',
  'https://ato.gov.au/about-ato',
]) assert.ok(isAllowedAtoUrl(url), `${url} is allowed`);

for (const url of [
  'http://www.ato.gov.au/about-ato',
  'https://evil.example.com/ato.gov.au',
  'https://www.ato.gov.au.evil.example/x',
  'https://user:pass@www.ato.gov.au/x',
  'https://www.ato.gov.au:8443/x',
  'not a url',
  '',
]) assert.ok(!isAllowedAtoUrl(url), `${url} is refused`);

console.log('financeCompliance/sources: ok');
