'use strict';

// Topic Research source: Reddit posts that link out to an article, with their score and comment count as the engagement signal.
// Uses Reddit's own app-only OAuth (client credentials) and nothing else: no scraping of reddit.com pages or its unauthenticated
// .json addresses. Reddit now requires approval before it issues keys, so this stays OFF until REDDIT_CLIENT_ID and
// REDDIT_CLIENT_SECRET are set. Written against Reddit's standard OAuth flow and tested against mocks only; it has not been run against
// the live service. See docs/topic-research.md.

const { makeItem } = require('./base');
const { getJson, postForm, failed, SourceError } = require('./http');

const LABEL = 'Reddit';
const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const SEARCH_URL = 'https://oauth.reddit.com/search';
const DEFAULT_AGENT = 'topic-research/0.1 (Curam Vault)';
const REDDIT_HOST = /(^|\.)(reddit\.com|redd\.it|redditmedia\.com|redditstatic\.com)$/i;

const windowFor = (days) => (days <= 1 ? 'day' : days <= 7 ? 'week' : days <= 31 ? 'month' : 'year');

function createRedditSource({ env = process.env, fetchFn = fetch, now = Date.now } = {}) {
  const clientId = (env.REDDIT_CLIENT_ID || '').trim();
  const clientSecret = (env.REDDIT_CLIENT_SECRET || '').trim();
  const userAgent = (env.REDDIT_USER_AGENT || '').trim() || DEFAULT_AGENT;
  let token = null; // { value, expiresAt }

  async function getToken() {
    if (token && token.expiresAt > now()) return token.value;
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const { data } = await postForm(fetchFn, LABEL, TOKEN_URL, { grant_type: 'client_credentials' }, { headers: { Authorization: `Basic ${basic}`, 'User-Agent': userAgent } });
    if (!data?.access_token) throw new SourceError('Reddit did not accept the key');
    token = { value: data.access_token, expiresAt: now() + Math.max(60, Number(data.expires_in) || 3600) * 1000 - 60000 };
    return token.value;
  }

  return {
    id: 'reddit', name: 'reddit', label: LABEL,
    async search(keyword, since) {
      const days = Math.max(1, Math.ceil((now() - (since instanceof Date ? since.getTime() : now() - 30 * 86400000)) / 86400000));
      try {
        const bearer = await getToken();
        const url = `${SEARCH_URL}?${new URLSearchParams({ q: keyword, sort: 'relevance', t: windowFor(days), limit: '50', type: 'link', raw_json: '1' })}`;
        let data;
        try {
          ({ data } = await getJson(fetchFn, LABEL, url, { headers: { Authorization: `Bearer ${bearer}`, 'User-Agent': userAgent } }));
        } catch (err) {
          if (err instanceof SourceError && err.status === 401) token = null; // the next search asks for a fresh token
          throw err;
        }
        const items = [];
        for (const child of Array.isArray(data?.data?.children) ? data.data.children : []) {
          const p = child?.data;
          if (!p || p.is_self) continue;
          let host = '';
          try { host = new URL(p.url).hostname; } catch { continue; }
          if (REDDIT_HOST.test(host)) continue; // a picture, gallery or another post, not an article
          const item = makeItem({
            url: p.url, title: p.title, publishedAt: Number.isFinite(p.created_utc) ? new Date(p.created_utc * 1000) : null,
            signals: { reddit_score: Number(p.score) || 0, reddit_comments: Number(p.num_comments) || 0, reddit_permalink: p.permalink ? `https://www.reddit.com${p.permalink}` : null, reddit_sub: p.subreddit || null },
          });
          if (item) items.push(item);
        }
        return { items, errors: [], answered: 1 };
      } catch (err) { return failed(LABEL, err); }
    },
  };
}

/** { enabled, reason } for the Sources box. */
function redditStatus(env = process.env) {
  if ((env.REDDIT_CLIENT_ID || '').trim() && (env.REDDIT_CLIENT_SECRET || '').trim()) return { enabled: true, reason: null };
  return { enabled: false, reason: 'Needs REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET. Reddit now approves access before it issues keys, so apply to Reddit first.' };
}

module.exports = { createRedditSource, redditStatus, LABEL };
