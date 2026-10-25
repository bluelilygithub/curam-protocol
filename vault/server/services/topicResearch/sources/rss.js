'use strict';

// Topic Research source: the RSS/Atom feeds the person listed in Settings. Each feed is downloaded through the SSRF-safe fetcher (feed
// addresses are typed by the person, so they must never reach a private address) and then parsed from text; the parser's own
// URL download is never used because it skips that check. Items are kept when they mention every word of the topic and are not older
// than `since`. One bad feed is reported and the others still count. See docs/topic-research.md.

const Parser = require('rss-parser');
const { fetchPublicFile } = require('../../../utils/safeFetch');
const { makeMatcher } = require('../matchTopic');
const { makeItem } = require('./base');

const FEED_ACCEPT = 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5';
const MAX_FEED_BYTES = 5 * 1024 * 1024;
const FEED_TIMEOUT_MS = 12000;
const CONCURRENCY = 5;

const stripTags = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** Run `fn` over `list` with at most `n` at a time, keeping the order. */
async function inBatches(list, n, fn) {
  const out = new Array(list.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(n, list.length) }, async () => {
    while (next < list.length) {
      const i = next; next += 1;
      // eslint-disable-next-line no-await-in-loop
      out[i] = await fn(list[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

const feedLabel = (feed) => {
  if (feed.name) return feed.name;
  try { return new URL(feed.url).hostname.replace(/^www\./, ''); } catch { return feed.url; }
};

/**
 * @param {{ feeds: Array<{url:string,name?:string}>, fetchFile?: Function, parser?: { parseString: Function } }} opts
 *   `fetchFile` and `parser` are injectable so tests need no network.
 */
function createRssSource({ feeds = [], fetchFile = fetchPublicFile, parser = new Parser({ timeout: FEED_TIMEOUT_MS }) } = {}) {
  return {
    id: 'rss', name: 'rss', label: 'RSS feeds',
    async search(topic, since) {
      const matches = makeMatcher(topic);
      const sinceMs = since instanceof Date ? since.getTime() : null;
      const errors = [];
      let answered = 0;
      const results = await inBatches(feeds, CONCURRENCY, async (feed) => {
        const label = feedLabel(feed);
        try {
          const file = await fetchFile(feed.url, { maxBytes: MAX_FEED_BYTES, timeoutMs: FEED_TIMEOUT_MS, accept: FEED_ACCEPT });
          const parsed = await parser.parseString(file.buffer.toString('utf8'));
          const kept = [];
          for (const entry of parsed.items || []) {
            const summary = stripTags(entry.contentSnippet || entry.summary || entry.content || '');
            if (!matches(`${entry.title || ''} ${summary}`)) continue;
            const item = makeItem({ url: entry.link || entry.guid, title: entry.title, publishedAt: entry.isoDate || entry.pubDate, snippet: summary });
            if (!item) continue;
            if (sinceMs != null && item.publishedAt && item.publishedAt.getTime() < sinceMs) continue;
            kept.push(item);
          }
          answered += 1;
          return kept;
        } catch (err) {
          // an SSRF refusal or a bad status is worth saying; a stack trace or a host name from inside is not
          errors.push({ source: `rss: ${label}`, message: String(err?.message || 'Could not read this feed').slice(0, 200) });
          return [];
        }
      });
      return { items: results.flat(), errors, answered };
    },
  };
}

module.exports = { createRssSource };
