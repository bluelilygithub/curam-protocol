'use strict';

const Parser = require('rss-parser');
const parser = new Parser({ timeout: 10000 });

// Default RSS feeds, grouped for the Settings UI (server/routes/newsDigest.js,
// client/src/pages/SettingsPage.jsx) — grouping is purely organizational (lets the user
// toggle "Sports" off as a block, say) and does NOT map topics to groups; every enabled
// source across every group is still checked against every topic's keywords, same as before.
// The special url '__google_news__' triggers keyword-based Google News search.
// `isSystem: true` marks a built-in default (mirrors fin_accounts."isSystem") so the UI can
// tell those apart from user-added custom feeds without a hardcoded name list.
const DEFAULT_SOURCE_GROUPS = {
  'General': [
    { name: 'Google News', url: '__google_news__', enabled: true, isSystem: true },
    { name: 'ABC News', url: 'https://www.abc.net.au/news/feed/51120/rss.xml', enabled: true, isSystem: true },
  ],
  'Australia': [
    { name: 'Guardian Australia', url: 'https://www.theguardian.com/australia-news/rss', enabled: true, isSystem: true },
    { name: 'SBS News — Australia', url: 'https://www.sbs.com.au/news/topic/australia/feed', enabled: true, isSystem: true },
    { name: 'Guardian Australia — Politics', url: 'https://www.theguardian.com/australia-news/australian-politics/rss', enabled: true, isSystem: true },
  ],
  'Ireland': [
    { name: 'RTÉ News', url: 'https://www.rte.ie/feeds/rss/?index=/news', enabled: true, isSystem: true },
    { name: 'Guardian — Ireland', url: 'https://www.theguardian.com/world/ireland/rss', enabled: true, isSystem: true },
  ],
  'Current Affairs / World': [
    { name: 'BBC World News', url: 'http://feeds.bbci.co.uk/news/world/rss.xml', enabled: true, isSystem: true },
    { name: 'Al Jazeera English', url: 'https://www.aljazeera.com/xml/rss/all.xml', enabled: true, isSystem: true },
    { name: 'NPR News', url: 'https://feeds.npr.org/1001/rss.xml', enabled: true, isSystem: true },
  ],
  'Politics': [
    { name: 'BBC Politics', url: 'http://feeds.bbci.co.uk/news/politics/rss.xml', enabled: true, isSystem: true },
    { name: 'Guardian Politics', url: 'https://www.theguardian.com/politics/rss', enabled: true, isSystem: true },
  ],
  'Shares / Finance': [
    { name: 'MarketWatch Top Stories', url: 'http://feeds.marketwatch.com/marketwatch/topstories/', enabled: true, isSystem: true },
    { name: 'Yahoo Finance', url: 'https://finance.yahoo.com/news/rssindex', enabled: true, isSystem: true },
    { name: 'CNBC Markets', url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html', enabled: true, isSystem: true },
    { name: 'Sky News Business', url: 'https://feeds.skynews.com/feeds/rss/business.xml', enabled: true, isSystem: true },
  ],
  'Sports (general)': [
    { name: 'BBC Sport', url: 'http://feeds.bbci.co.uk/sport/rss.xml', enabled: true, isSystem: true },
    { name: 'ESPN Top Headlines', url: 'https://www.espn.com/espn/rss/news', enabled: true, isSystem: true },
  ],
  'Soccer': [
    { name: 'BBC Football', url: 'http://feeds.bbci.co.uk/sport/football/rss.xml', enabled: true, isSystem: true },
    { name: 'Guardian Football', url: 'https://www.theguardian.com/football/rss', enabled: true, isSystem: true },
  ],
  'AI (LLM & Robotics)': [
    { name: 'TechCrunch AI', url: 'https://techcrunch.com/category/artificial-intelligence/feed/', enabled: true, isSystem: true },
    { name: 'The Verge AI', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', enabled: true, isSystem: true },
    { name: 'IEEE Spectrum Robotics', url: 'https://spectrum.ieee.org/feeds/topic/robotics.rss', enabled: true, isSystem: true },
  ],
};

// Flattens {groupName: [source,...]} into a single array, the shape fetchArticlesForTopic
// actually consumes — grouping only exists for the Settings UI/storage layer.
function flattenSourceGroups(groups) {
  if (!groups || typeof groups !== 'object') return [];
  return Object.values(groups).flat().filter(Boolean);
}

/**
 * Fetch and parse a single RSS feed, returning normalised article objects.
 * Returns [] on error so one bad feed never breaks a digest run.
 */
async function fetchFeed(feed) {
  try {
    const result = await parser.parseURL(feed.url);
    return (result.items || []).map(item => ({
      title:     item.title   || '',
      summary:   item.contentSnippet || item.summary || item.content || '',
      link:      item.link    || item.guid || '',
      pubDate:   item.pubDate || item.isoDate || '',
      source:    feed.name,
    }));
  } catch (err) {
    console.warn(`[news] Failed to fetch ${feed.name}: ${err.message}`);
    return [];
  }
}

/**
 * One-shot liveness check for a flat source list — HTTP fetch + parse, and "live" requires at
 * least one <item> back, not just a 200. Used once per cron run (not per-topic, sources don't
 * vary by topic) so a dead feed gets flagged as a suggestion-inbox alert instead of silently
 * looking like "no news today" for every topic that happens to rely on it (see
 * server/cron/newsDigestCron.js runDailyDigest). Google News is skipped — it's a keyword search,
 * not a fixed feed, so "no results for this exact probe query" isn't a meaningful health signal.
 */
async function checkSourceHealth(sources) {
  const feeds = (sources || []).filter(s => s.url !== '__google_news__' && s.enabled !== false);
  return Promise.all(feeds.map(async (feed) => {
    try {
      const result = await parser.parseURL(feed.url);
      const itemCount = (result.items || []).length;
      return { name: feed.name, url: feed.url, ok: itemCount > 0, itemCount, error: itemCount > 0 ? null : 'Feed parsed but returned zero items' };
    } catch (err) {
      return { name: feed.name, url: feed.url, ok: false, itemCount: 0, error: err.message };
    }
  }));
}

/**
 * Fetch Google News RSS for a keyword query.
 */
async function fetchGoogleNews(keywords) {
  if (!keywords || !keywords.trim()) return [];
  const q = encodeURIComponent(keywords.trim());
  const url = `https://news.google.com/rss/search?q=${q}&hl=en-AU&gl=AU&ceid=AU:en`;
  try {
    const result = await parser.parseURL(url);
    return (result.items || []).slice(0, 15).map(item => ({
      title:   item.title   || '',
      summary: item.contentSnippet || item.summary || '',
      link:    item.link    || item.guid || '',
      pubDate: item.pubDate || item.isoDate || '',
      source:  'Google News',
    }));
  } catch (err) {
    console.warn(`[news] Google News fetch failed for "${keywords}": ${err.message}`);
    return [];
  }
}

/**
 * Score an article's relevance to a topic by keyword match.
 * Returns a score >= 0; higher = more relevant.
 */
function relevanceScore(article, keywords) {
  if (!keywords || !keywords.trim()) return 1;
  const terms = keywords.toLowerCase().split(/[\s,]+/).filter(Boolean);
  const haystack = `${article.title} ${article.summary}`.toLowerCase();
  return terms.reduce((score, term) => {
    if (haystack.includes(term)) score += 1;
    return score;
  }, 0);
}

/**
 * Return true if the article's pubDate is within the last `maxAgeHours` hours.
 * Articles with no parseable date are kept (we can't exclude what we can't date).
 */
function isRecent(article, maxAgeHours = 48) {
  if (!article.pubDate) return true;
  try {
    const pub = new Date(article.pubDate);
    if (isNaN(pub.getTime())) return true; // unparseable — keep
    const ageMs = Date.now() - pub.getTime();
    return ageMs <= maxAgeHours * 60 * 60 * 1000;
  } catch {
    return true;
  }
}

/**
 * Fetch articles relevant to a topic from configured RSS feeds + Google News.
 * Only articles published within the last 48 hours are returned.
 * @param {string} topicTitle   - e.g. "Climate policy Australia"
 * @param {string} keywords     - optional extra keywords
 * @param {number} maxArticles  - max results to return
 * @param {Array}  activeSources - flat source list (use flattenSourceGroups on the grouped
 *                                 settings value) — falls back to the flattened defaults if omitted.
 * @returns {Promise<Array>}
 */
async function fetchArticlesForTopic(topicTitle, keywords, maxArticles = 20, activeSources = null) {
  const sources = activeSources || flattenSourceGroups(DEFAULT_SOURCE_GROUPS);
  const searchTerms = keywords || topicTitle;

  const useGoogleNews = sources.some(s => s.url === '__google_news__' && s.enabled !== false);
  const rssFeeds = sources.filter(s => s.url !== '__google_news__' && s.enabled !== false);

  // Run all feeds in parallel
  const results = await Promise.all([
    useGoogleNews ? fetchGoogleNews(searchTerms) : Promise.resolve([]),
    ...rssFeeds.map(fetchFeed),
  ]);
  const [googleArticles, ...feedResults] = results;

  const all = [...googleArticles, ...feedResults.flat()];

  // Filter: recent articles only, must have title, must keyword-match.
  // Start at 72h; if fewer than 3 results, widen to 96h so slow-moving topics still get coverage.
  const filterAndScore = (maxAgeHours) => all
    .filter(a => a.title && a.title.length > 5 && isRecent(a, maxAgeHours))
    .map(a => ({ ...a, _score: relevanceScore(a, searchTerms) }))
    .filter(a => a._score > 0);

  let scored = filterAndScore(72);
  if (scored.length < 3) scored = filterAndScore(96);

  // Deduplicate by title similarity (simple prefix match)
  const seen = new Set();
  const deduped = scored.filter(a => {
    const key = a.title.toLowerCase().slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort by recency first, then by relevance score within same recency band
  deduped.sort((a, b) => {
    const dateA = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const dateB = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    if (dateB !== dateA) return dateB - dateA; // newer first
    return b._score - a._score;
  });

  return deduped.slice(0, maxArticles).map(({ _score, ...a }) => a);
}

module.exports = { fetchArticlesForTopic, DEFAULT_SOURCE_GROUPS, flattenSourceGroups, checkSourceHealth };
