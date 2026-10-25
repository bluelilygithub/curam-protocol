#!/usr/bin/env node
/**
 * Topic Research (milestone 2): the Hacker News, GDELT, Reddit, Brave and Serper sources, the HTTP helper and throttle, the 24 hour cache, the
 * source registry and a run that mixes working, failing and switched-off sources. Every outside service is a mock (a stand-in `fetch`
 * returning real Response objects), so it needs no network and no keys. Reddit and Serper are tested against mocks only: they have not been
 * run against the live services (docs/topic-research.md).
 *
 * Run: node server/services/topicResearch/sources.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';

const assert = require('assert');
const { SourceError, getJson, postJson, failed, createThrottle } = require('./sources/http');
const { createHackerNewsSource } = require('./sources/hackernews');
const { createGdeltSource, parseSeenDate, buildQuery } = require('./sources/gdelt');
const { createRedditSource, redditStatus } = require('./sources/reddit');
const { createBraveSource, braveStatus, freshnessFor } = require('./sources/brave');
const { createSerperSource, serperStatus } = require('./sources/serper');
const { cached, withCache, cacheKey } = require('./cache');
const { buildSources } = require('./sources');
const { runCollect, mergeItems, mergeExtras } = require('./collect');
const { makeItem } = require('./sources/base');

const NOW = Date.UTC(2026, 9, 25, 0, 0, 0);
const DAY = 86400000;
const SINCE_30 = new Date(NOW - 30 * DAY);
const SECRET = 'KEYSECRET-123456';

// a stand-in fetch: handler(url, opts) returns a Response (or throws); every call is recorded
function mockFetch(handler) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    const out = await handler(String(url), opts, calls.length);
    return out;
  };
  fn.calls = calls;
  return fn;
}
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status });
const text = (body, status = 200) => new Response(body, { status });
const noLeak = (value) => assert.ok(!JSON.stringify(value).includes(SECRET), 'a key must never appear in a result or an error');

async function main() {
  // ------------------------------------------------------------ the HTTP helper
  {
    const f429 = mockFetch(() => text('slow down', 429));
    await assert.rejects(() => getJson(f429, 'Thing', `https://x.example/?key=${SECRET}`, { headers: { 'X-Key': SECRET } }), (e) => e instanceof SourceError && e.status === 429 && /busy/.test(e.message) && !e.message.includes(SECRET) && !e.message.includes('x.example'));
    await assert.rejects(() => getJson(mockFetch(() => text('no', 401)), 'Thing', 'https://x.example/'), (e) => /did not accept the key/.test(e.message));
    await assert.rejects(() => getJson(mockFetch(() => text('no', 500)), 'Thing', 'https://x.example/'), (e) => /error \(500\)/.test(e.message));
    await assert.rejects(() => getJson(mockFetch(() => { throw new TypeError('fetch failed: ECONNREFUSED 10.1.2.3:443'); }), 'Thing', 'https://x.example/'), (e) => /could not be reached/.test(e.message) && !/10\.1\.2\.3/.test(e.message), 'a network detail is not passed on');
    const timeout = Object.assign(new Error('x'), { name: 'TimeoutError' });
    await assert.rejects(() => getJson(mockFetch(() => { throw timeout; }), 'Thing', 'https://x.example/'), (e) => /too long/.test(e.message));
    await assert.rejects(() => getJson(mockFetch(() => text('<html>oops</html>')), 'Thing', 'https://x.example/'), (e) => /could not be read/.test(e.message) && e.text.includes('oops'));
    const seen = mockFetch(() => json({ ok: 1 }));
    const r = await postJson(seen, 'Thing', 'https://x.example/', { q: 1 }, { headers: { 'X-Key': 'k' } });
    assert.deepStrictEqual(r.data, { ok: 1 });
    assert.strictEqual(seen.calls[0].opts.method, 'POST');
    assert.strictEqual(seen.calls[0].opts.redirect, 'error', 'a redirect is never followed');
    assert.strictEqual(seen.calls[0].opts.headers['Content-Type'], 'application/json');
    assert.strictEqual(seen.calls[0].opts.body, '{"q":1}');
    assert.deepStrictEqual(failed('Thing', new Error('internal secret detail')), { items: [], errors: [{ source: 'Thing', message: 'Thing failed unexpectedly' }], answered: 0 });
  }

  // ------------------------------------------------------------ the throttle
  {
    let clock = 1000;
    const sleeps = [];
    const throttle = createThrottle({ gapMs: 5000, now: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms; } });
    const order = [];
    const results = await Promise.allSettled([
      throttle(async () => { order.push('a'); return 1; }),
      throttle(async () => { order.push('b'); throw new Error('boom'); }),
      throttle(async () => { order.push('c'); return 3; }),
    ]);
    assert.deepStrictEqual(order, ['a', 'b', 'c'], 'calls run one at a time, in order');
    assert.strictEqual(results[1].status, 'rejected');
    assert.strictEqual(results[2].value, 3, 'a failed call does not block the ones behind it');
    assert.deepStrictEqual(sleeps, [5000, 5000], 'the first call goes at once; each later one waits out the gap');
  }

  // ------------------------------------------------------------ Hacker News
  {
    const f = mockFetch(() => json({ hits: [
      { objectID: '1', title: 'Heat pumps are great', url: 'https://example.com/hp?utm_source=hn', points: 708, num_comments: 340, created_at: '2026-10-20T01:00:00.000Z' },
      { objectID: '2', title: 'Ask HN: heat pump advice', url: null, points: 12, num_comments: 3, created_at: '2026-10-21T01:00:00.000Z' },
      { objectID: '3', title: '', url: 'https://example.com/untitled', points: 1 },
      { objectID: '4', title: 'No numbers on heat pumps yet', url: 'https://example.com/n', created_at: '2026-10-22T00:00:00.000Z' },
    ] }));
    const out = await createHackerNewsSource({ fetchFn: f, now: () => NOW }).search('heat pump', SINCE_30);
    assert.strictEqual(out.answered, 1);
    assert.deepStrictEqual(out.items.map((i) => i.title), ['Heat pumps are great', 'No numbers on heat pumps yet'], 'posts with no link or no title are skipped');
    assert.deepStrictEqual(out.items[0].signals, { hn_points: 708, hn_comments: 340, hn_id: '1' });
    assert.strictEqual(out.items[0].url, 'https://example.com/hp');
    assert.deepStrictEqual([out.items[1].signals.hn_points, out.items[1].signals.hn_comments], [0, 0]);
    const u = new URL(f.calls[0].url);
    assert.strictEqual(u.hostname, 'hn.algolia.com');
    assert.strictEqual(u.searchParams.get('query'), 'heat pump');
    assert.strictEqual(u.searchParams.get('tags'), 'story');
    assert.strictEqual(u.searchParams.get('numericFilters'), `created_at_i>${Math.floor(SINCE_30.getTime() / 1000)}`);
    // Algolia forgives typos ("storm" finds "story"): only a headline or address that really has every topic word is kept
    const fuzzy = await createHackerNewsSource({ fetchFn: mockFetch(() => json({ hits: [
      { objectID: '10', title: 'The Origin Story of Kid Pix', url: 'https://example.com/kidpix', points: 300, num_comments: 40, created_at: '2026-10-20T00:00:00.000Z' },
      { objectID: '11', title: 'Storm batters the coast', url: 'https://example.com/storm', points: 5, num_comments: 1, created_at: '2026-10-20T00:00:00.000Z' },
      { objectID: '12', title: 'Weather news', url: 'https://example.com/big-storm-tonight', points: 2, num_comments: 0, created_at: '2026-10-20T00:00:00.000Z' },
      { objectID: '13', title: 'Storms and floods hit two states', url: 'https://example.com/a', points: 9, num_comments: 2, created_at: '2026-10-20T00:00:00.000Z' },
    ] })) }).search('storm', SINCE_30);
    assert.deepStrictEqual(fuzzy.items.map((i) => i.title), ['Storm batters the coast', 'Weather news', 'Storms and floods hit two states'], 'the address counts too, and a plural matches; "story" is not "storm"');
    const twoWords = await createHackerNewsSource({ fetchFn: mockFetch(() => json({ hits: [{ objectID: '14', title: 'Heat waves ahead', url: 'https://example.com/h', points: 1, num_comments: 0, created_at: '2026-10-20T00:00:00.000Z' }] })) }).search('heat pump', SINCE_30);
    assert.strictEqual(twoWords.items.length, 0, 'every word of the topic, not just one');
    const bad = await createHackerNewsSource({ fetchFn: mockFetch(() => text('x', 503)) }).search('x', SINCE_30);
    assert.strictEqual(bad.answered, 0);
    assert.strictEqual(bad.errors[0].source, 'Hacker News');
    const empty = await createHackerNewsSource({ fetchFn: mockFetch(() => json({})) }).search('x', SINCE_30);
    assert.deepStrictEqual([empty.items.length, empty.answered], [0, 1], 'an empty answer is still an answer');
  }

  // ------------------------------------------------------------ GDELT
  {
    assert.deepStrictEqual(parseSeenDate('20261025T053000Z'), new Date(Date.UTC(2026, 9, 25, 5, 30, 0)));
    assert.strictEqual(parseSeenDate('garbage'), null);
    assert.strictEqual(parseSeenDate(undefined), null);
    assert.strictEqual(buildQuery('The heat pumps in QLD', 'en'), 'heat pumps qld sourcelang:english');
    assert.strictEqual(buildQuery('heat pumps', 'fr'), 'heat pumps', 'no English filter for another language');
    assert.strictEqual(buildQuery('a of it', 'en'), null, 'nothing GDELT can search');
    const passThrough = (fn) => fn();
    const f = mockFetch(() => json({ articles: [
      { url: 'https://abc.net.au/a?utm_medium=x', title: 'Heat pump rebates', seendate: '20261024T120000Z', domain: 'abc.net.au' },
      { url: 'not a url', title: 'Bad' },
      { url: 'https://x.com/b', title: 'No date', seendate: 'nope' },
    ] }));
    const out = await createGdeltSource({ fetchFn: f, now: () => NOW, throttle: passThrough }).search('heat pumps', SINCE_30, { language: 'en' });
    assert.strictEqual(out.answered, 1);
    assert.deepStrictEqual(out.items.map((i) => i.url), ['https://abc.net.au/a', 'https://x.com/b']);
    assert.deepStrictEqual(out.items[0].publishedAt, new Date(Date.UTC(2026, 9, 24, 12, 0, 0)));
    assert.strictEqual(out.items[1].publishedAt, null);
    const u = new URL(f.calls[0].url);
    assert.strictEqual(u.searchParams.get('mode'), 'artlist');
    assert.strictEqual(u.searchParams.get('format'), 'json');
    assert.strictEqual(u.searchParams.get('timespan'), '30d');
    assert.strictEqual(u.searchParams.get('query'), 'heat pumps sourcelang:english');

    const busy = await createGdeltSource({ fetchFn: mockFetch(() => text('Too many requests', 429)), throttle: passThrough, state: { coolUntil: 0 } }).search('heat pumps', SINCE_30);
    assert.strictEqual(busy.answered, 0);
    assert.ok(/busy/.test(busy.errors[0].message), 'a 429 is reported, not thrown');

    // after a 429 GDELT is left alone for a minute (it is slow to say no), then asked again
    let clock = NOW;
    const state = { coolUntil: 0 };
    let hits = 0;
    const gd = createGdeltSource({ fetchFn: mockFetch(() => { hits += 1; return hits === 1 ? text('Please limit requests to one every 5 seconds', 429) : json({ articles: [] }); }), now: () => clock, throttle: passThrough, state });
    await gd.search('heat pumps', SINCE_30);
    assert.strictEqual(hits, 1);
    clock += 30 * 1000;
    const during = await gd.search('heat pumps', SINCE_30);
    assert.strictEqual(hits, 1, 'no request during the cool-down');
    assert.ok(during.answered === 0 && /busy/.test(during.errors[0].message));
    clock += 31 * 1000;
    const after = await gd.search('heat pumps', SINCE_30);
    assert.deepStrictEqual([hits, after.answered], [2, 1], 'asked again once the minute is up');
    const complaint = await createGdeltSource({ fetchFn: mockFetch(() => text('The specified phrase is too short.')), throttle: passThrough }).search('heat pumps', SINCE_30);
    assert.ok(/GDELT said: The specified phrase is too short/.test(complaint.errors[0].message), "GDELT's own plain-text complaint is passed on");
    const none = await createGdeltSource({ fetchFn: mockFetch(() => { throw new Error('must not be called'); }), throttle: passThrough }).search('a of', SINCE_30);
    assert.strictEqual(none.answered, 0);
    assert.ok(/no words GDELT can search/.test(none.errors[0].message));
  }

  // ------------------------------------------------------------ Reddit
  {
    assert.strictEqual(redditStatus({}).enabled, false);
    assert.ok(/apply to Reddit/.test(redditStatus({}).reason));
    assert.strictEqual(redditStatus({ REDDIT_CLIENT_ID: 'id' }).enabled, false, 'both are needed');
    assert.strictEqual(redditStatus({ REDDIT_CLIENT_ID: 'id', REDDIT_CLIENT_SECRET: SECRET }).enabled, true);

    let clock = NOW;
    let tokenCalls = 0;
    const listing = { data: { children: [
      { data: { title: 'Rebates explained', url: 'https://www.abc.net.au/news/hp', score: 420, num_comments: 88, created_utc: NOW / 1000 - 3600, permalink: '/r/australia/comments/x/rebates/', subreddit: 'australia', is_self: false } },
      { data: { title: 'A self post', url: 'https://www.reddit.com/r/x/comments/y', score: 5, num_comments: 1, is_self: true } },
      { data: { title: 'Self post with an outside-looking address', url: 'https://example.com/odd', score: 5, num_comments: 1, is_self: true } },
      { data: { title: 'A picture', url: 'https://i.redd.it/pic.jpg', score: 9, num_comments: 0, is_self: false } },
      { data: { title: 'Another reddit post', url: 'https://old.reddit.com/r/z', score: 9, num_comments: 0, is_self: false } },
      { data: { title: 'Broken', url: 'nonsense', is_self: false } },
    ] } };
    const f = mockFetch((url) => {
      if (url.startsWith('https://www.reddit.com/api/v1/access_token')) { tokenCalls += 1; return json({ access_token: 'tok-1', expires_in: 3600 }); }
      return json(listing);
    });
    const env = { REDDIT_CLIENT_ID: 'my-id', REDDIT_CLIENT_SECRET: SECRET, REDDIT_USER_AGENT: 'topic-research/0.1 by someone' };
    const src = createRedditSource({ env, fetchFn: f, now: () => clock });
    const out = await src.search('heat pumps', SINCE_30);
    assert.strictEqual(out.answered, 1);
    assert.strictEqual(out.items.length, 1, 'self posts, reddit-hosted links and broken addresses are left out');
    assert.deepStrictEqual([out.items[0].url, out.items[0].signals.reddit_score, out.items[0].signals.reddit_comments], ['https://www.abc.net.au/news/hp', 420, 88]);
    assert.strictEqual(out.items[0].signals.reddit_permalink, 'https://www.reddit.com/r/australia/comments/x/rebates/');
    const tokenCall = f.calls[0];
    assert.strictEqual(tokenCall.opts.method, 'POST');
    assert.strictEqual(tokenCall.opts.headers.Authorization, `Basic ${Buffer.from(`my-id:${SECRET}`).toString('base64')}`);
    assert.strictEqual(tokenCall.opts.body, 'grant_type=client_credentials');
    assert.strictEqual(tokenCall.opts.headers['User-Agent'], 'topic-research/0.1 by someone');
    const searchCall = f.calls[1];
    assert.strictEqual(searchCall.opts.headers.Authorization, 'Bearer tok-1');
    assert.strictEqual(searchCall.opts.headers['User-Agent'], 'topic-research/0.1 by someone');
    assert.strictEqual(new URL(searchCall.url).searchParams.get('t'), 'month');
    assert.strictEqual(new URL(searchCall.url).searchParams.get('q'), 'heat pumps');

    await src.search('heat pumps', SINCE_30);
    assert.strictEqual(tokenCalls, 1, 'the token is reused while it is valid');
    clock += 2 * 3600 * 1000;
    await src.search('heat pumps', SINCE_30);
    assert.strictEqual(tokenCalls, 2, 'and fetched again once it has expired');

    // a rejected search clears the token; a rejected key is said plainly and never echoed
    let n = 0;
    const g = mockFetch((url) => {
      if (url.includes('access_token')) { n += 1; return json({ access_token: `t${n}`, expires_in: 3600 }); }
      return n === 1 ? text('unauthorised', 401) : json(listing);
    });
    const s2 = createRedditSource({ env, fetchFn: g, now: () => clock });
    const first = await s2.search('x', SINCE_30);
    assert.strictEqual(first.answered, 0);
    assert.ok(/did not accept the key/.test(first.errors[0].message));
    const second = await s2.search('x', SINCE_30);
    assert.strictEqual(second.answered, 1, 'it asked for a fresh token and carried on');
    const denied = await createRedditSource({ env, fetchFn: mockFetch(() => text('forbidden', 403)), now: () => clock }).search('x', SINCE_30);
    assert.strictEqual(denied.answered, 0);
    noLeak(denied); noLeak(first);
    assert.ok(!JSON.stringify(denied).includes('my-id'));
  }

  // ------------------------------------------------------------ Brave
  {
    assert.deepStrictEqual([1, 7, 30, 60].map(freshnessFor), ['pd', 'pw', 'pm', 'py']);
    const cfg = async () => ({ provider: 'brave', apiKey: SECRET });
    const f = mockFetch(() => json({ web: { results: [
      { url: 'https://a.com/1', title: 'One', description: 'First result', page_age: '2026-10-20T05:00:00' },
      { url: 'https://b.com/2', title: 'Two', description: 'Second' },
      { url: '', title: 'Dead' },
    ] } }));
    const out = await createBraveSource({ fetchFn: f, getConfig: cfg, now: () => NOW, env: { BRAVE_PRICE_PER_QUERY_USD: '0.005' } }).search('heat pumps', new Date(NOW - 7 * DAY), { region: 'au', language: 'en' });
    assert.strictEqual(out.answered, 1);
    assert.deepStrictEqual(out.items.map((i) => [i.url, i.signals.serp_rank]), [['https://a.com/1', 1], ['https://b.com/2', 2]]);
    assert.ok(out.items[0].publishedAt instanceof Date && out.items[1].publishedAt === null);
    assert.strictEqual(out.items[0].snippet, 'First result');
    assert.strictEqual(out.costUsd, 0.005);
    const call = f.calls[0];
    assert.strictEqual(call.opts.headers['X-Subscription-Token'], SECRET);
    assert.ok(!call.url.includes(SECRET), 'the key is a header, never in the address');
    const u = new URL(call.url);
    assert.deepStrictEqual([u.searchParams.get('count'), u.searchParams.get('freshness'), u.searchParams.get('country'), u.searchParams.get('q')], ['20', 'pw', 'AU', 'heat pumps']);

    const wrong = await createBraveSource({ fetchFn: f, getConfig: async () => ({ provider: 'serper', apiKey: SECRET }) }).search('x', SINCE_30);
    assert.ok(wrong.answered === 0 && /not a Brave key/.test(wrong.errors[0].message));
    noLeak(wrong);
    const off = await braveStatus(async () => { throw new Error('SEARCH_API_KEY not configured — add on Railway.'); });
    assert.deepStrictEqual([off.enabled, /No web search key/.test(off.reason)], [false, true]);
    assert.ok(/switched off/.test((await braveStatus(async () => { throw new Error('Web search is disabled (DISABLE_WEB_SEARCH).'); })).reason));
    assert.strictEqual((await braveStatus(cfg)).enabled, true);
    const denied = await createBraveSource({ fetchFn: mockFetch(() => text('bad', 401)), getConfig: cfg }).search('x', SINCE_30);
    assert.ok(/did not accept the key/.test(denied.errors[0].message));
    noLeak(denied);
    // Brave answers a bad key with 422 (seen live), which must read as a refused key, not a mystery error
    const brave422 = '{"type":"ErrorResponse","error":{"id":"e6bd69b0-d06c-461e-858d-e84b5e7ddbf5","status":422,"detail":"The provided API key is invalid.","meta":{"component":"authentication"},"code":"SUBSCRIPTION_TOKEN_INVALID"},"time":1792925858}';
    const badKey = await createBraveSource({ fetchFn: mockFetch(() => text(brave422, 422)), getConfig: cfg }).search('x', SINCE_30);
    assert.strictEqual(badKey.errors[0].message, 'Brave Search did not accept the key');
    const otherUnprocessable = await createBraveSource({ fetchFn: mockFetch(() => text('{"error":{"detail":"freshness is not valid"}}', 422)), getConfig: cfg }).search('x', SINCE_30);
    assert.strictEqual(otherUnprocessable.errors[0].message, 'Brave Search answered with an error (422)', 'a different 422 is not blamed on the key');
    noLeak(badKey);
  }

  // ------------------------------------------------------------ Serper
  {
    const env = { SERP_PROVIDER: 'serper', SERP_API_KEY: SECRET };
    const noWorkspaceKey = async () => { throw new Error('SEARCH_API_KEY not configured'); };
    const body = {
      organic: [
        { title: 'Heat pump guide', link: 'https://guide.com/hp', snippet: 'A guide', position: 1, date: 'Oct 20, 2026' },
        { title: 'Costs', link: 'https://costs.com/hp', snippet: 'Costs', position: 2, date: '3 days ago' },
        { title: 'No position', link: 'https://third.com/hp' },
      ],
      topStories: [{ title: 'Heat pumps in the news', link: 'https://news.com/hp', source: 'News', date: '1 hour ago' }],
      peopleAlsoAsk: [{ question: 'Are heat pumps worth it?', snippet: 'Often yes.', link: 'https://q.com/1' }, { question: '' }, { question: 'Do they work in winter?', snippet: 'Yes.' }],
      relatedSearches: [{ query: 'heat pump rebate qld' }, { query: '' }, 'heat pump vs aircon'],
    };
    const f = mockFetch(() => json(body));
    const out = await createSerperSource({ fetchFn: f, env, getConfig: noWorkspaceKey }).search('heat pumps', SINCE_30, { region: 'AU', language: 'en' });
    assert.strictEqual(out.answered, 1);
    const rank = Object.fromEntries(out.items.map((i) => [i.url, i.signals.serp_rank]));
    assert.deepStrictEqual(rank, { 'https://guide.com/hp': 1, 'https://costs.com/hp': 2, 'https://third.com/hp': 3, 'https://news.com/hp': undefined });
    assert.strictEqual(out.items.find((i) => i.url === 'https://news.com/hp').signals.serp_top_story, true);
    assert.ok(out.items.find((i) => i.url === 'https://guide.com/hp').publishedAt instanceof Date);
    assert.strictEqual(out.items.find((i) => i.url === 'https://costs.com/hp').publishedAt, null, '"3 days ago" is not a date');
    assert.deepStrictEqual(out.extras.peopleAlsoAsk.map((q) => q.question), ['Are heat pumps worth it?', 'Do they work in winter?']);
    assert.deepStrictEqual(out.extras.relatedSearches, ['heat pump rebate qld', 'heat pump vs aircon']);
    const call = f.calls[0];
    assert.strictEqual(call.url, 'https://google.serper.dev/search');
    assert.strictEqual(call.opts.method, 'POST');
    assert.strictEqual(call.opts.headers['X-API-KEY'], SECRET);
    assert.deepStrictEqual(JSON.parse(call.opts.body), { q: 'heat pumps', hl: 'en', num: 10, gl: 'au' });
    assert.ok(!call.opts.body.includes(SECRET));

    assert.strictEqual((await serperStatus({ env: {}, getConfig: noWorkspaceKey })).enabled, false);
    assert.ok(/SERP_API_KEY/.test((await serperStatus({ env: {}, getConfig: noWorkspaceKey })).reason));
    assert.ok(/not built yet/.test((await serperStatus({ env: { SERP_PROVIDER: 'dataforseo', SERP_API_KEY: 'k' }, getConfig: noWorkspaceKey })).reason));
    assert.ok(/not Serper/.test((await serperStatus({ env: { SERP_API_KEY: 'k' }, getConfig: noWorkspaceKey })).reason));
    assert.strictEqual((await serperStatus({ env, getConfig: noWorkspaceKey })).enabled, true);
    assert.strictEqual((await serperStatus({ env: { SERP_API_KEY: 'k' }, settings: { serpProvider: 'serper' }, getConfig: noWorkspaceKey })).enabled, true, 'the provider chosen in Settings counts');
    assert.strictEqual((await serperStatus({ env: {}, getConfig: async () => ({ provider: 'serper', apiKey: 'k' }) })).enabled, true, 'the workspace search key counts when it is a Serper key');
    assert.strictEqual((await serperStatus({ env: {}, getConfig: async () => ({ provider: 'brave', apiKey: 'k' }) })).enabled, false);

    const denied = await createSerperSource({ fetchFn: mockFetch(() => text('unauthorised', 401)), env, getConfig: noWorkspaceKey }).search('x', SINCE_30);
    assert.ok(/did not accept the key/.test(denied.errors[0].message));
    noLeak(denied);
    const offline = await createSerperSource({ fetchFn: f, env: {}, getConfig: noWorkspaceKey }).search('x', SINCE_30);
    assert.strictEqual(offline.answered, 0);
  }

  // ------------------------------------------------------------ the cache
  {
    const store = new Map();
    const pool = {
      store,
      async query(sql, p) {
        const s = sql.replace(/\s+/g, ' ');
        if (/^SELECT payload/.test(s)) { const r = store.get(`${p[0]}|${p[1]}`); return { rows: r ? [r] : [] }; }
        if (/^INSERT INTO topic_research_cache/.test(s)) { store.set(`${p[0]}|${p[1]}`, { payload: p[2], createdAt: p[3] }); return { rows: [] }; }
        if (/^DELETE FROM topic_research_cache/.test(s)) { for (const [k, v] of store) if (v.createdAt < p[1]) store.delete(k); return { rows: [] }; }
        throw new Error(`unhandled: ${s}`);
      },
    };
    let clock = NOW;
    let asked = 0;
    const answer = { items: [makeItem({ url: 'https://a.com/1', title: 'One', publishedAt: '2026-10-20T00:00:00Z' })], errors: [], answered: 1, costUsd: 0.01, extras: { relatedSearches: ['x'] } };
    const run = async () => { asked += 1; return answer; };
    const base = { pool, userId: 1, key: 'k1', now: () => clock, run };

    let r = await cached(base);
    assert.deepStrictEqual([r.cached, r.costUsd, asked], [false, 0.01, 1]);
    r = await cached(base);
    assert.deepStrictEqual([r.cached, r.costUsd, asked], [true, 0, 1], 'served from the saved answer, at no cost');
    assert.ok(r.items[0].publishedAt instanceof Date && r.items[0].publishedAt.toISOString() === '2026-10-20T00:00:00.000Z', 'dates survive being saved');
    assert.deepStrictEqual(r.extras, { relatedSearches: ['x'] });
    r = await cached({ ...base, refresh: true });
    assert.deepStrictEqual([r.cached, asked], [false, 2], '"Search again" skips the saved answer');
    clock += 25 * 3600 * 1000;
    r = await cached(base);
    assert.deepStrictEqual([r.cached, asked], [false, 3], 'a day later it asks again');
    assert.notStrictEqual(await cached({ ...base, userId: 2, key: 'k1' }).then((x) => x.cached), true, 'one person never reads another person\'s saved answer');

    // an answer that got nothing back is not saved
    const dead = async () => ({ items: [], errors: [{ source: 'x', message: 'down' }], answered: 0 });
    await cached({ ...base, key: 'dead', run: dead });
    assert.ok(!store.has('1|dead'), 'a total failure is never saved');
    // old rows are tidied away
    store.set('1|ancient', { payload: '{}', createdAt: new Date(clock - 10 * 24 * 3600 * 1000) });
    await cached({ ...base, key: 'k9' });
    assert.ok(!store.has('1|ancient'));

    assert.strictEqual(cacheKey('gdelt', ' Heat Pumps ', { region: 'au', language: 'EN', days: 30 }), 'gdelt:heat pumps:AU:en:30');
    // wrapped source: asks once, then reads the saved answer; the source itself is unchanged
    let calls = 0;
    const src = { id: 'fake', name: 'fake', label: 'Fake', search: async () => { calls += 1; return answer; } };
    const wrapped = withCache(src, { now: () => clock });
    const ctx = { pool, userId: 1, region: 'AU', language: 'en', days: 30 };
    await wrapped.search('Heat pumps', SINCE_30, ctx);
    const again = await wrapped.search('heat pumps', SINCE_30, ctx);
    assert.deepStrictEqual([calls, again.cached, wrapped.id, wrapped.label], [1, true, 'fake', 'Fake'], 'the key ignores case');
    await wrapped.search('heat pumps', SINCE_30, { ...ctx, refresh: true });
    assert.strictEqual(calls, 2);
    assert.strictEqual((await wrapped.search('heat pumps', SINCE_30, {})).cached, undefined, 'with no database to hand it simply asks');
  }

  // ------------------------------------------------------------ the registry
  {
    const none = await buildSources({ feeds: [] }, { env: {}, getConfig: async () => { throw new Error('SEARCH_API_KEY not configured'); }, fetchFn: mockFetch(() => json({})) });
    const by = Object.fromEntries(none.status.map((s) => [s.id, s]));
    assert.deepStrictEqual(none.status.map((s) => s.id), ['rss', 'hackernews', 'gdelt', 'reddit', 'brave', 'serper']);
    assert.deepStrictEqual(Object.values(by).map((s) => s.enabled), [false, true, true, false, false, false]);
    assert.ok(Object.values(by).filter((s) => !s.enabled).every((s) => s.reason && s.reason.length > 10), 'every source that is off says why');
    assert.ok(Object.values(by).filter((s) => s.enabled).every((s) => s.reason === null));
    assert.deepStrictEqual(none.sources.map((s) => s.id), ['hackernews', 'gdelt']);

    const all = await buildSources({ feeds: [{ url: 'https://a.com/f' }] }, {
      env: { REDDIT_CLIENT_ID: 'i', REDDIT_CLIENT_SECRET: 's', SERP_PROVIDER: 'serper', SERP_API_KEY: 'k' },
      getConfig: async () => ({ provider: 'brave', apiKey: 'BSAx' }), fetchFn: mockFetch(() => json({})),
    });
    assert.deepStrictEqual(all.status.map((s) => s.enabled), [true, true, true, true, true, true]);
    assert.deepStrictEqual(all.sources.map((s) => s.id), ['rss', 'hackernews', 'gdelt', 'reddit', 'brave', 'serper']);
    noLeak(all.status);
  }

  // ------------------------------------------------------------ a run that mixes sources
  {
    const db = { runs: [], articles: [], links: [] };
    const pool = {
      db,
      async query(sql, p = []) {
        const s = sql.replace(/\s+/g, ' ').trim();
        if (/^INSERT INTO topic_research_runs/.test(s)) { db.runs.push({ id: db.runs.length + 1 }); return { rows: [{ id: db.runs.length }] }; }
        if (/^INSERT INTO topic_research_articles/.test(s)) {
          let a = db.articles.find((x) => x.url === p[1]);
          if (!a) { a = { id: db.articles.length + 1, url: p[1], title: p[2] }; db.articles.push(a); }
          return { rows: [{ id: a.id }] };
        }
        if (/^INSERT INTO topic_research_run_articles/.test(s)) { db.links.push({ articleId: p[1], signals: JSON.parse(p[2]) }); return { rows: [] }; }
        if (/^UPDATE topic_research_runs SET status = \$1/.test(s)) { Object.assign(db.runs[p[5] - 1], { status: p[0], errors: JSON.parse(p[1]), sources: JSON.parse(p[2]), extras: JSON.parse(p[3]), cost: p[4] }); return { rows: [] }; }
        throw new Error(`unhandled: ${s.slice(0, 80)}`);
      },
    };
    const item = (url, title, signals) => makeItem({ url, title, publishedAt: '2026-10-20T00:00:00Z', signals });
    const sources = [
      { id: 'hackernews', name: 'hackernews', label: 'Hacker News', search: async () => ({ items: [item('https://shared.com/a', 'Shared', { hn_points: 50, hn_comments: 9 }), item('https://hn.com/only', 'HN only', {})], errors: [], answered: 1 }) },
      { id: 'serper', name: 'serper', label: 'Google results (Serper)', search: async () => ({ items: [item('https://shared.com/a/', 'Shared', { serp_rank: 2 })], errors: [], answered: 1, costUsd: 0.002, extras: { peopleAlsoAsk: [{ question: 'Is it worth it?', snippet: '', url: null }], relatedSearches: ['a', 'b'] } }) },
      { id: 'brave', name: 'brave', label: 'Brave Search', search: async () => ({ items: [item('https://brave.com/x', 'Brave', { serp_rank: 1 })], errors: [], answered: 1, cached: true, costUsd: 0.01, extras: { peopleAlsoAsk: [{ question: 'is it worth it?', snippet: '' }, { question: 'Another?', snippet: '' }], relatedSearches: ['b', 'c'] } }) },
      { id: 'gdelt', name: 'gdelt', label: 'GDELT news', search: async () => { throw new Error('GDELT exploded'); } },
      { id: 'reddit', name: 'reddit', label: 'Reddit', search: async () => ({ items: [], errors: [{ source: 'Reddit', message: 'Reddit did not accept the key' }], answered: 0 }) },
    ];
    let t = NOW;
    const out = await runCollect({ pool, userId: 1, topic: { id: 5, keyword: 'heat pumps', region: 'AU', language: 'en' }, sources, days: 30, now: () => (t += 10) });
    assert.strictEqual(out.status, 'partial', 'some answered, some did not');
    assert.deepStrictEqual(out.sources.map((s) => [s.id, s.count, s.cached, s.answered]), [['hackernews', 2, false, 1], ['serper', 1, false, 1], ['brave', 1, true, 1], ['gdelt', 0, false, 0], ['reddit', 0, false, 0]]);
    assert.ok(out.sources.every((s) => s.ms > 0), 'time taken is recorded');
    assert.strictEqual(out.costUsd, 0.002, 'a saved (cached) answer costs nothing');
    assert.deepStrictEqual(out.errors.map((e) => e.source).sort(), ['GDELT news', 'Reddit']);
    assert.strictEqual(out.count, 3, 'the shared address is one article');
    const shared = db.links.find((l) => l.articleId === db.articles.find((a) => a.url === 'https://shared.com/a').id);
    assert.deepStrictEqual([shared.signals.hn_points, shared.signals.serp_rank], [50, 2], 'each source\'s numbers are kept on the one article');
    assert.deepStrictEqual(shared.signals.seenIn.sort(), ['hackernews', 'serper'], 'and which sources saw it');
    assert.deepStrictEqual(out.extras.peopleAlsoAsk.map((q) => q.question), ['Is it worth it?', 'Another?'], 'a question two sources both give appears once');
    assert.deepStrictEqual(out.extras.relatedSearches, ['a', 'b', 'c']);
    assert.strictEqual(db.runs[0].status, 'partial');
    assert.strictEqual(db.runs[0].cost, 0.002);

    // everything answered -> ok; nothing answered -> failed
    const fine = await runCollect({ pool, userId: 1, topic: { id: 5, keyword: 'x', region: 'AU', language: 'en' }, sources: [sources[0]], days: 30, now: () => NOW });
    assert.strictEqual(fine.status, 'ok');
    const dead = await runCollect({ pool, userId: 1, topic: { id: 5, keyword: 'x', region: 'AU', language: 'en' }, sources: [sources[3], sources[4]], days: 30, now: () => NOW });
    assert.strictEqual(dead.status, 'failed');
    assert.strictEqual(dead.count, 0);

    // the source gets what it needs to cache and to localise
    let seen = null;
    await runCollect({ pool, userId: 7, topic: { id: 5, keyword: 'x', region: 'NZ', language: 'en' }, sources: [{ id: 's', name: 's', search: async (k, since, ctx) => { seen = ctx; return { items: [], errors: [], answered: 1 }; } }], days: 7, refresh: true, now: () => NOW });
    assert.deepStrictEqual([seen.refresh, seen.region, seen.language, seen.userId, seen.days, seen.pool === pool], [true, 'NZ', 'en', 7, 7, true]);

    // each source is timed on its own, not all at the time the slowest finished (a real run showed 10 s against every source)
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    const timed = await runCollect({
      pool, userId: 1, topic: { id: 5, keyword: 'x', region: 'AU', language: 'en' }, days: 30,
      sources: [
        { id: 'fast', name: 'fast', label: 'Fast', search: async () => { await pause(5); return { items: [], errors: [], answered: 1 }; } },
        { id: 'slow', name: 'slow', label: 'Slow', search: async () => { await pause(120); return { items: [], errors: [], answered: 1 }; } },
      ],
    });
    const ms = Object.fromEntries(timed.sources.map((s) => [s.id, s.ms]));
    assert.ok(ms.slow >= 100 && ms.fast < 80, `fast ${ms.fast}ms, slow ${ms.slow}ms: each is its own time`);

    // merge helpers directly
    const merged = mergeItems([item('https://x.com/1', 'One', { seenIn: ['a'], hn_points: 1 }), item('https://x.com/1', 'One', { seenIn: ['b'], reddit_score: 2 })]);
    assert.deepStrictEqual([merged.length, merged[0].signals.seenIn, merged[0].signals.hn_points, merged[0].signals.reddit_score], [1, ['a', 'b'], 1, 2]);
    // two sources' numbers for one article: the BEST position, the HIGHEST engagement, Top stories if either said so
    const url = 'https://same.com/a';
    const both = mergeItems([
      item(url, 'A', { serp_rank: 5, serp_provider: 'brave', hn_points: 10, hn_comments: 90, seenIn: ['brave'] }),
      item(url, 'A', { serp_rank: 2, serp_provider: 'serper', hn_points: 50, hn_comments: 3, serp_top_story: true, seenIn: ['serper'] }),
    ]);
    assert.deepStrictEqual([both[0].signals.serp_rank, both[0].signals.serp_provider], [2, 'serper'], 'the better position, and whose it was');
    assert.deepStrictEqual([both[0].signals.hn_points, both[0].signals.hn_comments], [50, 90], 'the higher of each number');
    assert.strictEqual(both[0].signals.serp_top_story, true);
    assert.deepStrictEqual(both[0].signals.seenIn, ['brave', 'serper']);
    const reversed = mergeItems([item(url, 'A', { serp_rank: 2, serp_provider: 'serper' }), item(url, 'A', { serp_rank: 5, serp_provider: 'brave' })]);
    assert.deepStrictEqual([reversed[0].signals.serp_rank, reversed[0].signals.serp_provider], [2, 'serper'], 'whichever order they arrive in');
    const oneHasRank = mergeItems([item(url, 'A', { hn_points: 4 }), item(url, 'A', { serp_rank: 7, serp_provider: 'brave' })]);
    assert.deepStrictEqual([oneHasRank[0].signals.serp_rank, oneHasRank[0].signals.serp_provider, oneHasRank[0].signals.hn_points], [7, 'brave', 4], 'a number only one source had is kept');
    assert.strictEqual(mergeItems([item(url, 'A', { hn_points: 'lots' }), item(url, 'A', { hn_points: 5 })])[0].signals.hn_points, 'lots', 'a non-number is not compared');
    assert.deepStrictEqual(mergeExtras([]), { peopleAlsoAsk: [], relatedSearches: [] });
    assert.deepStrictEqual(mergeExtras([undefined, {}]), { peopleAlsoAsk: [], relatedSearches: [] });
  }

  console.log('topicResearch sources: all passed');
}

main().catch((err) => { console.error(err); process.exit(1); });
