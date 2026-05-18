'use strict';

/**
 * Shares daily news briefing service.
 *
 * Fetches news for each holding (Finnhub for US, web search for ASX),
 * fetches Nasdaq market context, then makes a single AI call to produce
 * a paragraph + signal (bullish/bearish/watch/neutral) per stock.
 * Results are stored in share_news_briefings and de-duplicated by date.
 */

const { pool } = require('../db');
const { callModel } = require('./callModel');
const { getModelsForUser } = require('./modelResolver'); // returns { light, standard, gemini, deepseek }
const sharesPortfolio = require('./sharesPortfolio');

const FETCH_TIMEOUT_MS = 15000;

// ─── web search (same providers as webSearch.js route) ────────────────────────

async function getSearchConfig() {
  let apiKey = String(process.env.SEARCH_API_KEY || '').trim();
  let provider = String(process.env.SEARCH_PROVIDER || '').toLowerCase();
  try {
    const { rows: k } = await pool.query("SELECT value FROM settings WHERE key='SEARCH_API_KEY' AND \"userId\" IS NULL");
    if (k[0]?.value) apiKey = k[0].value;
    const { rows: p } = await pool.query("SELECT value FROM settings WHERE key='SEARCH_PROVIDER' AND \"userId\" IS NULL");
    if (p[0]?.value) provider = p[0].value.toLowerCase();
  } catch (_) {}
  if (!provider && apiKey) {
    if (apiKey.startsWith('BSA')) provider = 'brave';
    else if (/^[a-f0-9]{40}$/i.test(apiKey)) provider = 'serper';
    else provider = 'serpapi';
  }
  return { apiKey, provider };
}

async function webSearch(query) {
  const { apiKey, provider } = await getSearchConfig();
  if (!apiKey) return [];

  const q = encodeURIComponent(query.trim());
  try {
    if (provider === 'brave') {
      const res = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${q}&count=5`,
        { headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
      );
      const data = await res.json();
      return (data.web?.results || []).slice(0, 4).map((r) => ({ title: r.title, snippet: r.description || '' }));
    }
    if (provider === 'serper') {
      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query.trim(), num: 5 }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const data = await res.json();
      return (data.organic || []).slice(0, 4).map((r) => ({ title: r.title, snippet: r.snippet || '' }));
    }
    // serpapi
    const res = await fetch(
      `https://serpapi.com/search.json?q=${q}&api_key=${apiKey}&num=5&engine=google`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
    );
    const data = await res.json();
    return (data.organic_results || []).slice(0, 4).map((r) => ({ title: r.title, snippet: r.snippet || '' }));
  } catch (err) {
    console.warn('[sharesNews] webSearch error:', err.message);
    return [];
  }
}

// ─── Finnhub company news (US stocks) ────────────────────────────────────────

async function getFinnhubNews(symbol) {
  const token = String(process.env.FINNHUB_API_KEY || '').trim();
  if (!token) return [];
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (Array.isArray(data) ? data : [])
      .slice(0, 5)
      .map((n) => ({ title: n.headline, snippet: n.summary || '' }));
  } catch (err) {
    console.warn(`[sharesNews] Finnhub news error for ${symbol}:`, err.message);
    return [];
  }
}

// ─── fetch news per holding ───────────────────────────────────────────────────

async function fetchHoldingNews(symbol, exchange) {
  const ex = String(exchange || '').toUpperCase();
  if (ex === 'NYSE' || ex === 'NASDAQ') {
    const news = await getFinnhubNews(symbol);
    if (news.length) return news;
    // fall back to web search if Finnhub returns nothing
  }
  return webSearch(`${symbol} stock news today site:reuters.com OR site:bloomberg.com OR site:afr.com OR site:abc.net.au`);
}

// ─── AI generation ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a concise financial analyst assistant. Given news snippets and price movements for a stock portfolio, generate brief, factual briefings.

Rules:
- Only include a stock entry if there is genuinely noteworthy news or a significant price movement (>1%).
- Paragraphs must be 2–3 sentences maximum. No fluff or padding.
- signal must be exactly one of: bullish, bearish, watch, neutral
  - bullish: clearly positive news or strong upward move
  - bearish: clearly negative news or significant decline
  - watch: mixed or ambiguous signals worth monitoring
  - neutral: nothing significant
- The market summary covers broad Nasdaq/ASX conditions relevant to the portfolio.
- Return ONLY valid JSON — no markdown, no explanation outside the JSON.`;

function buildPrompt(holdings, newsMap, marketNews) {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [`Date: ${today}\n\nPORTFOLIO HOLDINGS:`];

  for (const h of holdings) {
    const key = `${h.symbol}:${h.exchange}`;
    const news = newsMap[key] || [];
    const move = h.dayChangePct != null ? `${h.dayChangePct >= 0 ? '+' : ''}${h.dayChangePct.toFixed(2)}%` : 'unknown';
    lines.push(`\n[${h.symbol} / ${h.exchange}]  Price move today: ${move}`);
    if (news.length) {
      news.forEach((n, i) => lines.push(`  ${i + 1}. ${n.title}${n.snippet ? ' — ' + n.snippet.slice(0, 120) : ''}`));
    } else {
      lines.push('  (no news found)');
    }
  }

  lines.push('\nMARKET / NASDAQ NEWS:');
  if (marketNews.length) {
    marketNews.forEach((n, i) => lines.push(`  ${i + 1}. ${n.title}${n.snippet ? ' — ' + n.snippet.slice(0, 120) : ''}`));
  } else {
    lines.push('  (no market news found)');
  }

  lines.push(`\nReturn JSON in this exact shape:
{
  "stocks": [
    { "symbol": "NVDA", "exchange": "NYSE", "paragraph": "...", "signal": "bullish" }
  ],
  "market": { "paragraph": "...", "signal": "neutral" }
}
Only include stocks with something noteworthy. Omit stocks with no significant news or movement.`);

  return lines.join('\n');
}

async function generateBriefings(holdings, newsMap, marketNews, modelId) {
  const prompt = buildPrompt(holdings, newsMap, marketNews);
  const raw = await callModel(modelId, prompt, { maxTokens: 1500, system: SYSTEM_PROMPT });

  // strip possible markdown code fences
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to extract JSON object from the response
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('AI returned invalid JSON for briefings');
  }
}

// ─── main entry point ─────────────────────────────────────────────────────────

async function generateDailyBriefing(userId) {
  const today = new Date().toISOString().slice(0, 10);

  // Check if already generated for today
  const { rowCount: existing } = await pool.query(
    `SELECT 1 FROM share_news_briefings WHERE "userId"=$1 AND date=$2 LIMIT 1`,
    [userId, today]
  );
  if (existing) {
    // Allow re-generation (manual trigger overwrites)
    await pool.query(
      `DELETE FROM share_news_briefings WHERE "userId"=$1 AND date=$2`,
      [userId, today]
    );
  }

  // Get holdings with today's price movement
  const dash = await sharesPortfolio.buildDashboard(userId);
  if (!dash.positions.length) return { skipped: true, reason: 'No holdings' };

  const holdings = dash.positions.map((p) => ({
    symbol: p.symbol,
    exchange: p.exchange,
    dayChangePct: p.dayChangePct,
  }));

  // Fetch news for each holding (in parallel, limit concurrency)
  const newsMap = {};
  await Promise.all(
    holdings.map(async (h) => {
      const news = await fetchHoldingNews(h.symbol, h.exchange);
      newsMap[`${h.symbol}:${h.exchange}`] = news;
    })
  );

  // Fetch Nasdaq market news
  const marketNews = await webSearch('Nasdaq stock market news today technology stocks');

  // Resolve model — use standard tier, fall back to light
  const tiers = await getModelsForUser(userId);
  const modelId = tiers.standard || tiers.light || tiers.gemini;
  if (!modelId) throw new Error('No model configured for user — check vault_models in Settings');

  // Generate briefings via AI
  const briefings = await generateBriefings(holdings, newsMap, marketNews, modelId);

  // Store stock briefings
  const stockBriefings = Array.isArray(briefings.stocks) ? briefings.stocks : [];
  for (const b of stockBriefings) {
    const holding = holdings.find(
      (h) => h.symbol === b.symbol && h.exchange === b.exchange
    );
    const headlines = (newsMap[`${b.symbol}:${b.exchange}`] || []).map((n) => n.title);
    await pool.query(
      `INSERT INTO share_news_briefings
        ("userId", date, symbol, exchange, content, signal, headlines, "priceChangePct")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT ("userId", date, COALESCE(symbol,''), COALESCE(exchange,''))
       DO UPDATE SET content=EXCLUDED.content, signal=EXCLUDED.signal,
                     headlines=EXCLUDED.headlines, "priceChangePct"=EXCLUDED."priceChangePct"`,
      [
        userId, today, b.symbol, b.exchange,
        b.paragraph || '', b.signal || 'neutral',
        JSON.stringify(headlines),
        holding?.dayChangePct ?? null,
      ]
    );
  }

  // Store market summary
  if (briefings.market?.paragraph) {
    await pool.query(
      `INSERT INTO share_news_briefings
        ("userId", date, symbol, exchange, content, signal, headlines)
       VALUES ($1,$2,NULL,NULL,$3,$4,'[]')
       ON CONFLICT ("userId", date, COALESCE(symbol,''), COALESCE(exchange,''))
       DO UPDATE SET content=EXCLUDED.content, signal=EXCLUDED.signal`,
      [userId, today, briefings.market.paragraph, briefings.market.signal || 'neutral']
    );
  }

  console.log(`[sharesNews] Generated briefing for user ${userId} on ${today}: ${stockBriefings.length} stocks`);
  return { date: today, stockCount: stockBriefings.length };
}

async function getBriefingsForUser(userId, days = 30) {
  const { rows } = await pool.query(
    `SELECT id, date, symbol, exchange, content, signal, headlines, "priceChangePct", "createdAt"
     FROM share_news_briefings
     WHERE "userId"=$1 AND date >= CURRENT_DATE - INTERVAL '${days} days'
     ORDER BY date DESC, symbol NULLS FIRST`,
    [userId]
  );
  return rows;
}

module.exports = { generateDailyBriefing, getBriefingsForUser };
