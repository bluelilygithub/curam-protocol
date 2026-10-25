'use strict';

// Topic Research: the list of sources for one search, built from the person's settings and the server's keys, and a plain-words status for
// each (on, or off and exactly why) for the Sources box in Settings. Sources that spend money or are rate limited are wrapped in the
// 24 hour cache. Adding a source: write the adapter (see base.js), then add one line in `describe` below.

const { createRssSource } = require('./rss');
const { createHackerNewsSource } = require('./hackernews');
const { createGdeltSource } = require('./gdelt');
const { createRedditSource, redditStatus } = require('./reddit');
const { createBraveSource, braveStatus } = require('./brave');
const { createSerperSource, serperStatus } = require('./serper');
const { withCache } = require('../cache');

const PAUSED = 'Paused: this month\'s spending limit has been reached. Raise it in Settings -> Topic Research.';

/**
 * @param settings the person's Topic Research settings (feeds, serpProvider)
 * @param deps     { env, fetchFn, getConfig, now, budgetOver } so tests need no network, keys or database; budgetOver pauses the paid sources
 * @returns {Promise<{ sources: object[], status: Array<{ id, label, enabled, reason }> }>}
 */
async function buildSources(settings, deps = {}) {
  const { env = process.env, fetchFn = fetch, getConfig, now = Date.now } = deps;
  const cfg = getConfig ? { getConfig } : {};
  const feeds = settings?.feeds || [];

  const defs = [
    { make: () => createRssSource({ feeds }), status: feeds.length ? { enabled: true } : { enabled: false, reason: 'No feeds yet. Add some above.' }, label: 'RSS feeds', id: 'rss' },
    { make: () => createHackerNewsSource({ fetchFn, now }), status: { enabled: true }, label: 'Hacker News', id: 'hackernews' },
    { make: () => createGdeltSource({ fetchFn, now, ...(deps.throttle ? { throttle: deps.throttle } : {}) }), status: { enabled: true }, label: 'GDELT news', id: 'gdelt', cache: true },
    { make: () => createRedditSource({ env, fetchFn, now }), status: redditStatus(env), label: 'Reddit', id: 'reddit' },
    { make: () => createBraveSource({ fetchFn, now, env, ...cfg }), status: await braveStatus(getConfig), label: 'Brave Search', id: 'brave', cache: true, paid: true },
    { make: () => createSerperSource({ fetchFn, env, settings, ...cfg }), status: await serperStatus({ env, settings, ...cfg }), label: 'Google results (Serper)', id: 'serper', cache: true, paid: true },
  ];

  const sources = [];
  const status = [];
  for (const d of defs) {
    // a paid source that would otherwise run is paused while this month's spending limit is reached (the free ones carry on)
    const st = d.paid && d.status.enabled && deps.budgetOver ? { enabled: false, reason: PAUSED } : d.status;
    status.push({ id: d.id, label: d.label, enabled: !!st.enabled, reason: st.enabled ? null : (st.reason || null) });
    if (!st.enabled) continue;
    const src = d.make();
    sources.push(d.cache ? withCache(src, { now }) : src);
  }
  return { sources, status };
}

module.exports = { buildSources, PAUSED };
