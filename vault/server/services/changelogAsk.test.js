#!/usr/bin/env node
/**
 * "Ask the changelog": entry selection (Brisbane date ranges, area and file matching, concerns, keywords, the 40 cap), citation checks,
 * and POST /api/changelog/ask through the real router with a fake model. No database, no model.
 * Run: node server/services/changelogAsk.test.js
 */
'use strict';

const assert = require('assert');
const http = require('http');
const express = require('express');
const { selectEntries, parseDateRange, checkCitations, askChangelog, fileTerms, MAX_ENTRIES } = require('./changelogAsk');
const { createChangelogRouter } = require('../routes/changelog');

let passed = 0;
const t = async (name, fn) => { try { await fn(); passed++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };

// Wednesday 18 Nov 2026, 9am in Brisbane (= Tue 17 Nov 23:00 UTC)
const NOW = new Date('2026-11-17T23:00:00Z');
const bris = (s) => new Date(`${s}+10:00`).toISOString();
const E = (commit, at, extra = {}) => ({ commit, committedAt: bris(at), subject: `Update ${commit}`, area: 'Notes', goal: '', whatChanged: '', benefit: '', concerns: 'None noted.', filesImpacted: [], ...extra });

const entries = [
  E('aaaaaa1', '2026-11-18T08:00:00', { area: 'Finance', subject: 'Finance: GST rounding', concerns: 'Untested against a real BAS.', filesImpacted: ['server/routes/finance.js', 'server/db.js'] }),
  E('aaaaaa2', '2026-11-16T00:30:00', { area: 'Usage & Cost', subject: 'Opus prices updated', whatChanged: 'Pricing table now has the new Opus prices.', filesImpacted: ['server/services/costCalculator.js'] }),
  E('aaaaaa3', '2026-11-15T23:30:00', { area: 'Finance', subject: 'Finance: receipts', filesImpacted: ['client/src/pages/FinancePage.jsx'] }), // Sunday night: last week
  E('aaaaaa4', '2026-11-10T12:00:00', { area: 'Graphics, Video Tools', subject: 'Shared export', concerns: 'Costs money per call.', filesImpacted: ['server/db.js'] }),
  E('aaaaaa5', '2026-10-30T12:00:00', { area: 'Memory and SERP Tracker', subject: 'Memory search' }),
  E('aaaaaa6', '2026-11-17T12:00:00', { area: 'Usage', subject: 'Usage page tidy' }),
];
const commits = (sel) => sel.entries.map((e) => e.commit);

(async () => {
  await t('date ranges are read in Brisbane time, weeks start Monday', async () => {
    const r = (q) => { const x = parseDateRange(q, NOW); return x && [x.from.toISOString(), x.to.toISOString(), x.label]; };
    assert.deepStrictEqual(r('what changed today'), ['2026-11-17T14:00:00.000Z', '2026-11-18T14:00:00.000Z', 'today']);
    assert.deepStrictEqual(r('this week')?.slice(0, 2), ['2026-11-15T14:00:00.000Z', '2026-11-18T14:00:00.000Z'], 'Mon 16 Nov Brisbane midnight');
    assert.deepStrictEqual(r('last week')?.slice(0, 2), ['2026-11-08T14:00:00.000Z', '2026-11-15T14:00:00.000Z']);
    assert.deepStrictEqual(r('since Monday')?.slice(0, 2), ['2026-11-15T14:00:00.000Z', '2026-11-18T14:00:00.000Z']);
    assert.deepStrictEqual(r('since wednesday')?.slice(0, 2), ['2026-11-17T14:00:00.000Z', '2026-11-18T14:00:00.000Z'], 'today is Wednesday');
    assert.deepStrictEqual(r('since 10 Nov')?.[0], '2026-11-09T14:00:00.000Z');
    assert.deepStrictEqual(r('changes since Nov 10')?.[0], '2026-11-09T14:00:00.000Z');
    assert.deepStrictEqual(r('since 2026-11-10')?.[0], '2026-11-09T14:00:00.000Z');
    assert.deepStrictEqual(r('what happened on 10 Nov')?.slice(0, 2), ['2026-11-09T14:00:00.000Z', '2026-11-10T14:00:00.000Z']);
    assert.deepStrictEqual(r('since 20 Dec')?.[0], '2025-12-19T14:00:00.000Z', 'a date later this year means last year');
    assert.deepStrictEqual(r('in October')?.slice(0, 2), ['2026-09-30T14:00:00.000Z', '2026-10-31T14:00:00.000Z']);
    assert.deepStrictEqual(r('last 3 days')?.slice(0, 2), ['2026-11-15T14:00:00.000Z', '2026-11-18T14:00:00.000Z']);
    assert.deepStrictEqual(r('this month')?.[0], '2026-10-31T14:00:00.000Z');
    assert.strictEqual(r('When did the Opus prices change?'), null);
  });

  await t('this week + area: only Finance entries from Monday on (Sunday night belongs to last week)', async () => {
    const sel = selectEntries(entries, 'What changed in Finance this week?', { now: NOW });
    assert.deepStrictEqual(commits(sel), ['aaaaaa1']);
    assert.deepStrictEqual(sel.areas, ['Finance']);
    assert.strictEqual(sel.range.label, 'this week');
  });

  await t('area names match whole words and the parts of a combined area', async () => {
    assert.deepStrictEqual(commits(selectEntries(entries, 'anything about video tools?', { now: NOW })), ['aaaaaa4']);
    assert.deepStrictEqual(commits(selectEntries(entries, 'What happened to SERP Tracker', { now: NOW })), ['aaaaaa5']);
    const uc = selectEntries(entries, 'Usage & Cost changes', { now: NOW });
    assert.deepStrictEqual(uc.areas, ['Usage & Cost'], 'the longer area wins over "Usage"');
    assert.deepStrictEqual(commits(uc), ['aaaaaa2']);
  });

  await t('file names match filesImpacted by partial path', async () => {
    assert.deepStrictEqual(fileTerms('everything that touched db.js'), ['db.js']);
    assert.deepStrictEqual(commits(selectEntries(entries, 'everything that touched db.js', { now: NOW })), ['aaaaaa1', 'aaaaaa4']);
    assert.deepStrictEqual(commits(selectEntries(entries, 'what touched client/src/pages/', { now: NOW })), ['aaaaaa3']);
  });

  await t('concern questions keep only entries with a real concern; keywords rank the rest', async () => {
    const sel = selectEntries(entries, 'Which updates had untested concerns?', { now: NOW });
    assert.strictEqual(sel.concernsOnly, true);
    assert.deepStrictEqual(commits(sel), ['aaaaaa1'], '"untested" ranks among the two with concerns');
    assert.deepStrictEqual(commits(selectEntries(entries, 'Which updates had concerns?', { now: NOW })), ['aaaaaa1', 'aaaaaa4']);
    const opus = selectEntries(entries, 'When did the Opus prices change?', { now: NOW });
    assert.deepStrictEqual(commits(opus), ['aaaaaa2']);
    assert.ok(opus.keywords.includes('opu') && opus.keywords.includes('pric'));
  });

  await t('no match on keywords: the newest entries, capped at 40, newest first', async () => {
    const many = Array.from({ length: 60 }, (_, i) => E(`b${String(i).padStart(6, '0')}`, `2026-11-${String(1 + (i % 17)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00:00`));
    const sel = selectEntries(many, 'zzqx nothing matches this', { now: NOW });
    assert.strictEqual(MAX_ENTRIES, 40);
    assert.strictEqual(sel.entries.length, 40);
    const times = sel.entries.map((e) => new Date(e.committedAt).getTime());
    assert.deepStrictEqual(times, [...times].sort((a, b) => b - a), 'newest first');
    assert.strictEqual(Math.min(...times), [...many.map((e) => new Date(e.committedAt).getTime())].sort((a, b) => b - a)[39], 'the 40 newest');
    const big = selectEntries(many, 'this month', { now: NOW });
    assert.strictEqual(big.entries.length, 40);
    assert.strictEqual(big.matched, 60, 'reports how many matched before the cap');
  });

  await t('citations: known hashes kept (prefix or full), unknown ones reported', async () => {
    const c = checkCitations('A [aaaaaa1] and [AAAAAA2bcdef] then [deadbee] and [aaaaaa1].', ['aaaaaa1', 'aaaaaa2']);
    assert.deepStrictEqual(c, { cited: ['aaaaaa1', 'aaaaaa2'], unknown: ['deadbee'] });
  });

  await t('askChangelog sends only the selected entries to the standard model and logs usage', async () => {
    const calls = [];
    const logged = [];
    const out = await askChangelog(7, 'What changed in Finance this week?', {
      now: () => NOW,
      listEntries: async () => entries,
      getModels: async () => ({ standard: 'model-from-settings', light: 'x' }),
      callModel: async (model, prompt, opts) => { calls.push({ model, prompt, opts }); return { text: 'GST rounding changed [aaaaaa1]; see also [ffffff9].', inputTokens: 100, outputTokens: 20 }; },
      logUsage: (u) => logged.push(u),
    });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].model, 'model-from-settings');
    assert.match(calls[0].opts.system, /ONLY from the entries/);
    assert.match(calls[0].opts.system, /never describe a concern as resolved/i);
    assert.match(calls[0].prompt, /\[aaaaaa1\] 2026-11-18 · Finance/);
    assert.doesNotMatch(calls[0].prompt, /aaaaaa3/, 'last week\'s entry is not sent');
    assert.match(calls[0].prompt, /Today in Brisbane: 2026-11-18/);
    assert.deepStrictEqual(out.basedOn, ['aaaaaa1']);
    assert.deepStrictEqual(out.cited, ['aaaaaa1']);
    assert.deepStrictEqual(out.unknownCitations, ['ffffff9']);
    assert.deepStrictEqual(logged, [{ userId: 7, model: 'model-from-settings', inputTokens: 100, outputTokens: 20, feature: 'changelog_ask' }]);
  });

  await t('askChangelog: no match answers without a model call; no model is a 503; bad question is a 400', async () => {
    let called = 0;
    const deps = { now: () => NOW, listEntries: async () => entries, getModels: async () => ({ standard: 'm' }), callModel: async () => { called++; return { text: 'x' }; }, logUsage: () => {} };
    const none = await askChangelog(1, 'What changed in Finance yesterday?', deps);
    assert.strictEqual(called, 0);
    assert.deepStrictEqual(none.basedOn, []);
    assert.match(none.answer, /No changelog entries match/);
    await assert.rejects(askChangelog(1, 'Finance this week', { ...deps, getModels: async () => ({}) }), (e) => e.status === 503);
    await assert.rejects(askChangelog(1, ' ', deps), (e) => e.status === 400);
    await assert.rejects(askChangelog(1, 'x'.repeat(501), deps), (e) => e.status === 400);
    await assert.rejects(askChangelog(1, { not: 'text' }, deps), (e) => e.status === 400);
  });

  await t('POST /api/changelog/ask through the router with a fake model', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = { id: 3, isAdmin: true }; next(); }); // requireAdmin runs before this router in server/index.js
    const fakeModel = { now: () => NOW, listEntries: async () => entries, getModels: async () => ({ standard: 'fake' }), callModel: async () => ({ text: 'Opus prices changed [aaaaaa2].' }), logUsage: () => {} };
    app.use('/api/changelog', createChangelogRouter({
      list: async () => entries,
      ask: (userId, q) => (q === 'boom' ? Promise.reject(new Error('db password in here')) : askChangelog(userId, q, fakeModel)),
    }));
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = async (body) => { const res = await fetch(`${base}/api/changelog/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: res.status, body: await res.json() }; };
    try {
      const ok = await post({ question: 'When did the Opus prices change?' });
      assert.strictEqual(ok.status, 200);
      assert.deepStrictEqual(ok.body.cited, ['aaaaaa2']);
      assert.deepStrictEqual(ok.body.basedOn, ['aaaaaa2']);
      assert.strictEqual(ok.body.model, 'fake');
      const bad = await post({});
      assert.strictEqual(bad.status, 400);
      assert.match(bad.body.error, /question/);
      const boom = await post({ question: 'boom' });
      assert.strictEqual(boom.status, 500);
      assert.doesNotMatch(boom.body.error, /password/, 'an unexpected error is hidden');
      const list = await (await fetch(`${base}/api/changelog`)).json();
      assert.strictEqual(list.entries.length, entries.length, 'GET / still lists every entry');
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  console.log(`changelogAsk: ${passed} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
