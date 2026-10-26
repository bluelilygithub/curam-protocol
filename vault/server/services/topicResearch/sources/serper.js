'use strict';

// Topic Research source: Google results through Serper (a licensed results API: nothing here ever fetches a Google page). Gives each
// result's position (the search rank signal), the Top stories box, and the "People also ask" and "Related searches" lists the brief uses
// later. OFF until a key exists. Written from Serper's documented response key names (organic, peopleAlsoAsk, relatedSearches) and tested
// against mocks only: it has not been run against the live service, and the Top stories key name is unconfirmed. See docs/topic-research.md.
//
// A key comes from SERP_API_KEY (with SERP_PROVIDER=serper, or the provider chosen in Topic Research Settings), or from the workspace
// search key when that one is a Serper key, or from SERPER_SEARCH_API_KEY (the key the rest of Vault already uses for Serper) BUT ONLY when the
// person has chosen Serper in Topic Research Settings: a key that merely exists must not start spending on every search.

const { makeItem } = require('./base');
const { postJson, failed, SourceError } = require('./http');

const LABEL = 'Google results (Serper)';
const ENDPOINT = 'https://google.serper.dev/search';
const MAX_EXTRAS = 12;

const defaultGetConfig = () => require('../../webSearchService').getSearchConfig();

/** { apiKey } or { reason }. Never throws. */
async function serperConfig({ env = process.env, settings = {}, getConfig = defaultGetConfig } = {}) {
  const provider = (settings.serpProvider && settings.serpProvider !== 'none' ? settings.serpProvider : (env.SERP_PROVIDER || '')).toLowerCase();
  const own = (env.SERP_API_KEY || '').trim();
  if (own && provider === 'serper') return { apiKey: own };
  // the key Vault already has for Serper, used only on an explicit choice in Settings (not because it exists)
  const shared = (env.SERPER_SEARCH_API_KEY || '').trim();
  if (shared && !own && String(settings.serpProvider || '').toLowerCase() === 'serper') return { apiKey: shared, viaWorkspaceKey: true };
  try {
    const cfg = await getConfig();
    if (cfg?.provider === 'serper' && cfg.apiKey) return { apiKey: cfg.apiKey };
  } catch { /* no workspace key */ }
  if (provider && provider !== 'serper' && provider !== 'none') return { reason: `The ${provider} provider is not built yet. Only Serper is.` };
  if (own) return { reason: 'SERP_API_KEY is set but the search provider is not Serper. Set SERP_PROVIDER=serper or choose it in Settings.' };
  if (shared) return { reason: 'The workspace has a Serper key. Choose Serper as the Google results provider in Settings to use it (each search then costs a little).' };
  return { reason: 'Needs SERP_API_KEY and SERP_PROVIDER=serper (no Google results provider chosen yet).' };
}

const cleanText = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

function createSerperSource({ fetchFn = fetch, env = process.env, settings = {}, getConfig = defaultGetConfig } = {}) {
  const price = Number(env.SERP_PRICE_PER_QUERY_USD) || 0;
  return {
    id: 'serper', name: 'serper', label: LABEL, cacheable: true,
    async search(keyword, _since, ctx = {}) {
      const cfg = await serperConfig({ env, settings, getConfig });
      if (!cfg.apiKey) return failed(LABEL, new SourceError(cfg.reason));
      const body = { q: keyword, hl: ctx.language || 'en', num: 10 };
      if (/^[A-Za-z]{2}$/.test(ctx.region || '')) body.gl = ctx.region.toLowerCase();
      try {
        const { data } = await postJson(fetchFn, LABEL, ENDPOINT, body, { headers: { 'X-API-KEY': cfg.apiKey } });
        const items = [];
        (Array.isArray(data?.organic) ? data.organic : []).forEach((r, i) => {
          const rank = Number.isInteger(r?.position) && r.position > 0 ? r.position : i + 1;
          const published = r?.date && !Number.isNaN(Date.parse(r.date)) ? new Date(r.date) : null; // "2 days ago" is not a date: left empty
          const item = makeItem({ url: r?.link, title: r?.title, publishedAt: published, snippet: r?.snippet, signals: { serp_rank: rank, serp_provider: 'serper' } });
          if (item) items.push(item);
        });
        for (const s of Array.isArray(data?.topStories) ? data.topStories : []) {
          const item = makeItem({ url: s?.link, title: s?.title, signals: { serp_top_story: true, serp_provider: 'serper' } });
          if (item) items.push(item);
        }
        const peopleAlsoAsk = (Array.isArray(data?.peopleAlsoAsk) ? data.peopleAlsoAsk : [])
          .map((q) => ({ question: cleanText(q?.question, 200), snippet: cleanText(q?.snippet, 300), url: typeof q?.link === 'string' ? q.link : null }))
          .filter((q) => q.question).slice(0, MAX_EXTRAS);
        const relatedSearches = (Array.isArray(data?.relatedSearches) ? data.relatedSearches : [])
          .map((r) => cleanText(typeof r === 'string' ? r : r?.query, 120)).filter(Boolean).slice(0, MAX_EXTRAS);
        return { items, errors: [], answered: 1, costUsd: price, extras: { peopleAlsoAsk, relatedSearches } };
      } catch (err) { return failed(LABEL, err); }
    },
  };
}

/** { enabled, reason } for the Sources box. */
async function serperStatus(opts) {
  const cfg = await serperConfig(opts);
  return cfg.apiKey ? { enabled: true, reason: null } : { enabled: false, reason: cfg.reason };
}

module.exports = { createSerperSource, serperStatus, serperConfig, LABEL };
