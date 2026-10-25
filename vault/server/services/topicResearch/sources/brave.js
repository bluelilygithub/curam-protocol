'use strict';

// Topic Research source: Brave Search results, using the web-search key Vault already has (SEARCH_API_KEY, when it is a Brave key). Stands in
// for a Google results provider until one is chosen: each result's position is the "search rank" signal. Brave has no People-also-ask.
// See docs/topic-research.md.

const { makeItem } = require('./base');
const { getJson, failed, SourceError } = require('./http');

const LABEL = 'Brave Search';
const ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';

const freshnessFor = (days) => (days <= 1 ? 'pd' : days <= 7 ? 'pw' : days <= 31 ? 'pm' : 'py');

const defaultGetConfig = () => require('../../webSearchService').getSearchConfig();

/** Reads the shared search config; { apiKey } only when it is a Brave key, else { reason }. Never throws. */
async function braveConfig(getConfig = defaultGetConfig) {
  try {
    const cfg = await getConfig();
    if (cfg?.provider === 'brave' && cfg.apiKey) return { apiKey: cfg.apiKey };
    return { reason: 'The workspace search key is not a Brave key.' };
  } catch (err) {
    return { reason: /disabled/i.test(String(err?.message)) ? 'Web search is switched off for this workspace.' : 'No web search key is set (SEARCH_API_KEY).' };
  }
}

function createBraveSource({ fetchFn = fetch, getConfig = defaultGetConfig, now = Date.now, env = process.env } = {}) {
  const price = Number(env.BRAVE_PRICE_PER_QUERY_USD) || 0;
  return {
    id: 'brave', name: 'brave', label: LABEL, cacheable: true,
    async search(keyword, since, ctx = {}) {
      const cfg = await braveConfig(getConfig);
      if (!cfg.apiKey) return failed(LABEL, new SourceError(cfg.reason));
      const days = Math.max(1, Math.ceil((now() - (since instanceof Date ? since.getTime() : now() - 30 * 86400000)) / 86400000));
      const params = { q: keyword, count: '20', freshness: freshnessFor(days), search_lang: ctx.language || 'en' };
      if (/^[A-Za-z]{2}$/.test(ctx.region || '')) params.country = ctx.region.toUpperCase();
      try {
        const { data } = await getJson(fetchFn, LABEL, `${ENDPOINT}?${new URLSearchParams(params)}`, { headers: { Accept: 'application/json', 'X-Subscription-Token': cfg.apiKey } });
        const items = [];
        (Array.isArray(data?.web?.results) ? data.web.results : []).forEach((r, i) => {
          const item = makeItem({ url: r?.url, title: r?.title, publishedAt: r?.page_age || null, snippet: r?.description, signals: { serp_rank: i + 1, serp_provider: 'brave' } });
          if (item) items.push(item);
        });
        return { items, errors: [], answered: 1, costUsd: price };
      } catch (err) { return failed(LABEL, err); }
    },
  };
}

/** { enabled, reason } for the Sources box. */
async function braveStatus(getConfig = defaultGetConfig) {
  const cfg = await braveConfig(getConfig);
  return cfg.apiKey ? { enabled: true, reason: null } : { enabled: false, reason: cfg.reason };
}

module.exports = { createBraveSource, braveStatus, braveConfig, freshnessFor, LABEL };
