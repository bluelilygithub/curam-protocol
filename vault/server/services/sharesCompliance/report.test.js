'use strict';

const assert = require('assert');
const { buildReport, markdownFor, DISCLAIMER } = require('./report');

const snapshots = [
  {
    sourceId: 'advice-guidance', label: 'ATO advice and guidance', url: 'https://www.ato.gov.au/about-ato/ato-advice-and-guidance',
    finalUrl: 'https://www.ato.gov.au/about-ato/ato-advice-and-guidance', status: 'ok', reason: '', hash: 'abc',
    title: 'Advice and guidance', excerpt: 'A short excerpt.', fetchedAt: '2026-11-24T00:00:00.000Z',
  },
  {
    sourceId: 'small-business-newsroom', label: 'Newsroom', url: 'https://www.ato.gov.au/businesses-and-organisations/small-business-newsroom',
    finalUrl: '', status: 'unavailable', reason: 'The ATO page returned HTTP 403.', hash: '',
    title: '', excerpt: '', fetchedAt: '2026-11-24T00:00:00.000Z',
  },
];

const ai = {
  summary: 'One guidance page mentioned a change to record keeping. Check the exact wording.',
  updates: [{
    title: 'Record keeping guidance', sourceId: 'advice-guidance', detail: 'The page describes a change.',
    sharesImpact: 'It may affect what is kept with a trade.', action: 'Confirm the date with your accountant.',
    confidence: 'medium',
  }, {
    title: 'Invented update', sourceId: 'made-up-source', detail: 'Not from an allow-listed page.',
    sharesImpact: 'Ignore me', action: 'Do not show this', confidence: 'high',
  }],
  actions: ['Read the linked ATO page.'],
  limits: [],
};

const report = buildReport({ snapshots, ai, modelId: 'configured-model', generatedAt: '2026-11-24T00:00:00.000Z' });
assert.strictEqual(report.status, 'done');
assert.strictEqual(report.updates.length, 1, 'the model cannot invent a source');
assert.strictEqual(report.updates[0].sourceId, 'advice-guidance');
assert.strictEqual(report.modelId, 'configured-model');
assert.ok(report.limits.some((line) => line.includes('1 source could not be read')));
assert.strictEqual(report.disclaimer, DISCLAIMER);

const md = markdownFor(report);
assert.ok(md.startsWith('# Shares Compliance Advisory'));
assert.ok(md.includes(DISCLAIMER));
assert.ok(md.includes('[ATO advice and guidance](https://www.ato.gov.au/about-ato/ato-advice-and-guidance)'));
assert.ok(md.includes('Source unavailable — verify manually'));
assert.ok(!md.includes('Invented update'));
assert.ok(!md.includes('made-up-source'));

const offline = buildReport({ snapshots: snapshots.map((s) => ({ ...s, status: 'unavailable', reason: 'HTTP 403' })), ai: null });
assert.strictEqual(offline.status, 'unavailable');
assert.match(offline.summary, /ATO sources unavailable — verify manually/);
assert.deepStrictEqual(offline.updates, []);
assert.ok(offline.actions.some((a) => /accountant/.test(a)));

const partial = buildReport({ snapshots, ai: null, aiError: 'Model timeout' });
assert.strictEqual(partial.status, 'partial');
assert.ok(partial.limits.some((l) => l.includes('Model timeout')));

console.log('sharesCompliance/report: ok');
