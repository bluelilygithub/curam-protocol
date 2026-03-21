'use strict';

const Parser = require('rss-parser');
const parser = new Parser({ timeout: 10000 });

// Default RSS feeds — each returns recent articles regardless of topic;
// we filter by keyword relevance after fetching.
// The special url '__google_news__' triggers keyword-based Google News search.
const DEFAULT_SOURCES = [
  { name: 'ABC News',           url: 'https://www.abc.net.au/news/feed/51120/rss.xml',    enabled: true },
  { name: 'Guardian Australia', url: 'https://www.theguardian.com/australia-news/rss',    enabled: true },
  { name: 'Reuters',            url: 'https://feeds.reuters.com/reuters/topNews',          enabled: true },
  { name: 'Sky News',           url: 'https://feeds.skynews.com/feeds/rss/world.xml',     enabled: true },
  { name: 'Google News',        url: '__google_news__',                                    enabled: true },
];

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
 * @param {Array}  activeSources - override source list (uses DEFAULT_SOURCES if omitted)
 * @returns {Promise<Array>}
 */
async function fetchArticlesForTopic(topicTitle, keywords, maxArticles = 20, activeSources = null) {
  const sources = activeSources || DEFAULT_SOURCES;
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

module.exports = { fetchArticlesForTopic, DEFAULT_SOURCES };
