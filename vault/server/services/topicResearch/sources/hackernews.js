'use strict';

// Topic Research source: Hacker News through Algolia's free search (no key). Stories only, and only those that link to an article: an
// Ask HN post has no address to find coverage at. Points and comments are the engagement signal. Algolia forgives typos ("storm" finds
// "story"), so a story is kept only if its headline or address really contains every word of the topic, the same rule the RSS feeds follow. See docs/topic-research.md.

const { makeItem } = require('./base');
const { makeMatcher } = require('../matchTopic');
const { getJson, failed } = require('./http');

const LABEL = 'Hacker News';
const ENDPOINT = 'https://hn.algolia.com/api/v1/search';
const PER_PAGE = 40;

function createHackerNewsSource({ fetchFn = fetch, now = Date.now } = {}) {
  return {
    id: 'hackernews', name: 'hackernews', label: LABEL,
    async search(keyword, since) {
      const sinceSec = Math.floor((since instanceof Date ? since.getTime() : now() - 30 * 86400000) / 1000);
      const url = `${ENDPOINT}?${new URLSearchParams({ query: keyword, tags: 'story', hitsPerPage: String(PER_PAGE), numericFilters: `created_at_i>${sinceSec}` })}`;
      const matches = makeMatcher(keyword);
      try {
        const { data } = await getJson(fetchFn, LABEL, url);
        const items = [];
        for (const hit of Array.isArray(data?.hits) ? data.hits : []) {
          if (!hit?.url) continue;
          if (!matches(`${hit.title || ''} ${hit.url}`)) continue;
          const item = makeItem({
            url: hit.url, title: hit.title, publishedAt: hit.created_at,
            signals: { hn_points: Number(hit.points) || 0, hn_comments: Number(hit.num_comments) || 0, hn_id: String(hit.objectID || '') },
          });
          if (item) items.push(item);
        }
        return { items, errors: [], answered: 1 };
      } catch (err) { return failed(LABEL, err); }
    },
  };
}

module.exports = { createHackerNewsSource, LABEL };
