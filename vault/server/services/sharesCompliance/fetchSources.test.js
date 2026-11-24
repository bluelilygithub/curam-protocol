'use strict';

const assert = require('assert');
const { fetchSources, MAX_BYTES, sha256 } = require('./fetchSources');
const { sourcesForRun } = require('./sources');

const sources = [
  { id: 'ok', label: 'Readable page', url: 'https://www.ato.gov.au/a', focus: 'Testing' },
  { id: 'blocked', label: 'Blocked page', url: 'https://www.ato.gov.au/b', focus: 'Testing' },
  { id: 'failed', label: 'Failed page', url: 'https://ato.gov.au/c', focus: 'Testing' },
  { id: 'redirect', label: 'Redirected page', url: 'https://www.ato.gov.au/d', focus: 'Testing' },
  { id: 'not-allowed', label: 'Off-list page', url: 'https://example.com/e', focus: 'Testing' },
];

const html = `<html><head><title>ATO update</title></head><body>${'<p>Significant guidance changed on 1 January 2026. Share records may need a fresh look.</p>'.repeat(20)}</body></html>`;
const calls = [];
const robots = {
  async check(url) {
    if (url.includes('/b')) return { allowed: false, reason: 'disallowed', crawlDelayMs: null };
    if (url.includes('/d')) return { allowed: true, reason: 'allowed', crawlDelayMs: null };
    return { allowed: true, reason: 'allowed', crawlDelayMs: 500 };
  },
};
const fetcher = async (url, opts) => {
  calls.push({ url, opts });
  if (url.includes('/c')) throw new Error('Could not fetch the file (HTTP 403)');
  if (url.includes('/d')) return { buffer: Buffer.from(html), contentType: 'text/html', finalUrl: 'https://example.com/elsewhere' };
  return { buffer: Buffer.from(html), contentType: 'text/html; charset=utf-8', finalUrl: url };
};

(async () => {
  const snapshots = await fetchSources({
    sources,
    fetcher,
    robots,
    makeThrottle: ({ gapMs }) => {
      assert.strictEqual(gapMs, 2000, 'crawl-delay below the polite default does not speed us up');
      return (fn) => fn();
    },
    now: () => new Date('2026-11-24T00:00:00Z').getTime(),
  });

  assert.strictEqual(snapshots.length, sources.length);
  const ok = snapshots.find((s) => s.sourceId === 'ok');
  assert.strictEqual(ok.status, 'ok');
  assert.strictEqual(ok.title, 'ATO update');
  assert.ok(ok.excerpt.includes('Significant guidance changed'));
  assert.ok(ok.excerpt.length <= 1200, 'the stored excerpt is short');
  assert.ok(ok.promptText.length > ok.excerpt.length, 'the prompt has more text than the stored excerpt');
  assert.strictEqual(ok.hash, sha256(Buffer.from(html)));
  assert.strictEqual(ok.fetchedAt, '2026-11-24T00:00:00.000Z');

  assert.strictEqual(snapshots.find((s) => s.sourceId === 'blocked').status, 'blocked');
  assert.match(snapshots.find((s) => s.sourceId === 'blocked').reason, /robots\.txt/);
  assert.strictEqual(snapshots.find((s) => s.sourceId === 'failed').status, 'unavailable');
  assert.match(snapshots.find((s) => s.sourceId === 'failed').reason, /HTTP 403/);
  assert.strictEqual(snapshots.find((s) => s.sourceId === 'redirect').status, 'blocked');
  assert.strictEqual(snapshots.find((s) => s.sourceId === 'not-allowed').status, 'blocked');
  assert.strictEqual(calls.length, 3, 'robots-blocked and off-list pages are never downloaded');
  assert.ok(calls.every((c) => c.opts.maxBytes === MAX_BYTES), 'every fetch has the 2 MB cap');

  assert.strictEqual((await fetchSources({ sources: sourcesForRun(), fetcher: async () => { throw new Error('offline'); }, robots, makeThrottle: () => (fn) => fn() })).length, 7);
  console.log('sharesCompliance/fetchSources: ok');
})().catch((err) => { console.error(err); process.exit(1); });
