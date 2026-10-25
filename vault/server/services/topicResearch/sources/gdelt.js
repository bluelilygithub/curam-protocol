'use strict';

// Topic Research source: GDELT DOC 2.0, a free news index (no key). One request at a time and one every five seconds across the whole
// server, because GDELT answers 429 to anything faster (it did on the first live check). A 429 or an unreadable answer is reported,
// never thrown. GDELT sends a plain-text message with status 200 when it dislikes a query: that text is shown, since it is GDELT's own
// words about the query, not a secret. See docs/topic-research.md.

const { makeItem } = require('./base');
const { getJson, failed, createThrottle, SourceError } = require('./http');

const LABEL = 'GDELT news';
const ENDPOINT = 'https://api.gdeltproject.org/api/v2/doc/doc';
const MAX_RECORDS = 100;
const STOP = new Set(['the', 'and', 'for', 'with', 'are']);

const sharedThrottle = createThrottle({ gapMs: 5000 });
// After a 429 (seen on the first live check, even for a single well-spaced call) GDELT is not asked again for a minute: it is slow to say no
// (about 12 seconds), so asking on every search would only make each search wait for nothing. Shared by every search on this server.
const COOL_DOWN_MS = 60 * 1000;
const sharedState = { coolUntil: 0 };

/** "20261025T053000Z" -> Date, or null. */
function parseSeenDate(s) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(String(s || ''));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The query GDELT is sent: the topic's words (GDELT needs 3+ letters each), English-language outlets. Null when nothing usable is left. */
function buildQuery(keyword, language) {
  const words = String(keyword || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !STOP.has(w));
  if (!words.length) return null;
  return `${words.join(' ')}${!language || language === 'en' ? ' sourcelang:english' : ''}`;
}

function createGdeltSource({ fetchFn = fetch, now = Date.now, throttle = sharedThrottle, state = sharedState } = {}) {
  return {
    id: 'gdelt', name: 'gdelt', label: LABEL, cacheable: true,
    async search(keyword, since, ctx = {}) {
      const query = buildQuery(keyword, ctx.language);
      if (!query) return { items: [], errors: [{ source: LABEL, message: 'The topic has no words GDELT can search (it needs words of three letters or more).' }], answered: 0 };
      if (now() < state.coolUntil) return failed(LABEL, new SourceError('GDELT is busy. It is not asked again for about a minute'));
      const days = Math.max(1, Math.ceil((now() - (since instanceof Date ? since.getTime() : now() - 30 * 86400000)) / 86400000));
      const url = `${ENDPOINT}?${new URLSearchParams({ query, mode: 'artlist', format: 'json', maxrecords: String(MAX_RECORDS), timespan: `${Math.min(days, 90)}d`, sort: 'datedesc' })}`;
      try {
        const { data } = await throttle(() => getJson(fetchFn, LABEL, url));
        const items = [];
        for (const a of Array.isArray(data?.articles) ? data.articles : []) {
          const item = makeItem({ url: a?.url, title: a?.title, publishedAt: parseSeenDate(a?.seendate), signals: {} });
          if (item) items.push(item);
        }
        return { items, errors: [], answered: 1 };
      } catch (err) {
        if (err instanceof SourceError && err.status === 429) state.coolUntil = now() + COOL_DOWN_MS;
        // GDELT's own refusal text for a query it did not like comes back as an unreadable answer
        if (err instanceof SourceError && err.status === 200 && err.text) return failed(LABEL, new SourceError(`GDELT said: ${err.text}`));
        return failed(LABEL, err);
      }
    },
  };
}

module.exports = { createGdeltSource, parseSeenDate, buildQuery, LABEL };
