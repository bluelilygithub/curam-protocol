'use strict';

/**
 * Shares news briefing service.
 *
 * Daily briefings: fetches news per holding (Finnhub for US, web search for ASX),
 * fetches Nasdaq market context, then makes one AI call producing a paragraph +
 * signal (bullish/bearish/watch/neutral) per stock. Stored in share_news_briefings
 * with type='daily'. Retained for 45 days, then auto-pruned.
 *
 * Monthly summaries: reviews 30 days of daily briefings, assesses market sentiment
 * trends and signal accuracy. Stored with type='monthly_summary'. Never auto-deleted.
 *
 * Date handling: all dates stored in Australia/Sydney timezone to avoid the UTC
 * mismatch that caused 4 AM Sydney cron entries to land on the previous UTC date.
 */

const { pool } = require('../db');
const { callModel } = require('./callModel');
const { getModelsForUser } = require('./modelResolver');
const sharesPortfolio = require('./sharesPortfolio');

const FETCH_TIMEOUT_MS = 15000;

// Returns 'YYYY-MM-DD' in the given IANA timezone.
// toISOString() is UTC — at 4 AM Sydney (= ~6 PM UTC prev day) it returns yesterday's date,
// which caused manual re-runs to overwrite the cron's entry. Always use workspace timezone.
function getDateInTz(tz, offsetDays = 0) {
  const d = offsetDays
    ? new Date(Date.now() - offsetDays * 24 * 60 * 60 * 1000)
    : new Date();
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
}

// Reads the admin user's timezone from their Profile settings.
// Falls back to Australia/Sydney if not set.
async function getWorkspaceTimezone() {
  try {
    const { rows } = await pool.query(
      `SELECT s.value FROM settings s
       JOIN users u ON u.id = s."userId"
       WHERE s.key = 'user_timezone' AND u."isAdmin" = TRUE
       ORDER BY u.id ASC LIMIT 1`
    );
    return rows[0]?.value?.trim() || 'Australia/Sydney';
  } catch {
    return 'Australia/Sydney';
  }
}

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
  // Date range for Finnhub API query — UTC is fine here (not stored, just a query window)
  const to   = new Date().toISOString().slice(0, 10);
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
  }
  return webSearch(`${symbol} stock news today site:reuters.com OR site:bloomberg.com OR site:afr.com OR site:abc.net.au`);
}

// ─── Daily briefing AI generation ────────────────────────────────────────────

const DAILY_SYSTEM_PROMPT = `You are a concise financial analyst assistant. Given news snippets and price movements for a stock portfolio, generate brief, factual briefings.

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

function buildDailyPrompt(holdings, newsMap, marketNews, today) {
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

async function generateBriefings(holdings, newsMap, marketNews, modelId, today) {
  const prompt = buildDailyPrompt(holdings, newsMap, marketNews, today);
  const raw = await callModel(modelId, prompt, { maxTokens: 1500, system: DAILY_SYSTEM_PROMPT });

  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('AI returned invalid JSON for daily briefings');
  }
}

// ─── generateDailyBriefing ────────────────────────────────────────────────────

async function generateDailyBriefing(userId) {
  const tz = await getWorkspaceTimezone();
  const today = getDateInTz(tz);

  // Always delete today's daily entries first — allows re-generation from cron or manual trigger
  await pool.query(
    `DELETE FROM share_news_briefings WHERE "userId"=$1 AND date=$2 AND type='daily'`,
    [userId, today]
  );

  const dash = await sharesPortfolio.buildDashboard(userId);
  if (!dash.positions.length) return { skipped: true, reason: 'No holdings' };

  const holdings = dash.positions.map((p) => ({
    symbol: p.symbol,
    exchange: p.exchange,
    dayChangePct: p.dayChangePct,
  }));

  // Fetch news for each holding (parallel)
  const newsMap = {};
  await Promise.all(
    holdings.map(async (h) => {
      const news = await fetchHoldingNews(h.symbol, h.exchange);
      newsMap[`${h.symbol}:${h.exchange}`] = news;
    })
  );

  const marketNews = await webSearch('Nasdaq stock market news today technology stocks');

  const tiers = await getModelsForUser(userId);
  const modelId = tiers.standard || tiers.light || tiers.gemini;
  if (!modelId) throw new Error('No model configured for user — check vault_models in Settings');

  const briefings = await generateBriefings(holdings, newsMap, marketNews, modelId, today);

  // Store per-stock briefings
  const stockBriefings = Array.isArray(briefings.stocks) ? briefings.stocks : [];
  for (const b of stockBriefings) {
    const holding = holdings.find((h) => h.symbol === b.symbol && h.exchange === b.exchange);
    const headlines = (newsMap[`${b.symbol}:${b.exchange}`] || []).map((n) => n.title);
    await pool.query(
      `INSERT INTO share_news_briefings
        ("userId", date, symbol, exchange, content, signal, headlines, "priceChangePct", type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'daily')`,
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
        ("userId", date, symbol, exchange, content, signal, headlines, type)
       VALUES ($1,$2,NULL,NULL,$3,$4,'[]','daily')`,
      [userId, today, briefings.market.paragraph, briefings.market.signal || 'neutral']
    );
  }

  // Prune daily entries older than 45 days (monthly_summary rows are never deleted)
  const cutoff = getDateInTz(tz, 45);
  await pool.query(
    `DELETE FROM share_news_briefings WHERE "userId"=$1 AND type='daily' AND date < $2`,
    [userId, cutoff]
  );

  console.log(`[sharesNews] Generated daily briefing for user ${userId} on ${today}: ${stockBriefings.length} stock(s)`);
  return { date: today, stockCount: stockBriefings.length };
}

// ─── Monthly summary ──────────────────────────────────────────────────────────

const SUMMARY_SYSTEM_PROMPT = `You are a financial analyst reviewing 30 days of daily market briefings for a personal portfolio. Assess overall market trends, evaluate whether the daily signals were accurate relative to the reported price movements, and provide honest commentary on the quality of the analysis. Be concise and direct — if signals were mixed or inaccurate, say so.`;

function buildSummaryPrompt(dailyBriefings, today) {
  const byStock = {};
  const marketEntries = [];

  for (const b of dailyBriefings) {
    if (!b.symbol) {
      marketEntries.push(`${String(b.date).slice(0, 10)}: [${b.signal}] ${String(b.content || '').slice(0, 150)}`);
    } else {
      const key = `${b.symbol}:${b.exchange}`;
      if (!byStock[key]) byStock[key] = { symbol: b.symbol, exchange: b.exchange, entries: [] };
      const move = b.priceChangePct != null ? `${Number(b.priceChangePct).toFixed(2)}%` : 'n/a';
      byStock[key].entries.push(
        `${String(b.date).slice(0, 10)}: signal=${b.signal}, move=${move} — ${String(b.content || '').slice(0, 100)}`
      );
    }
  }

  const lines = [`30-DAY PORTFOLIO REVIEW — period ending ${today}\n`];

  if (marketEntries.length) {
    lines.push('DAILY MARKET SUMMARIES (most recent 10):');
    marketEntries.slice(-10).forEach((e) => lines.push('  ' + e));
  }

  lines.push('\nPER-STOCK SIGNALS & PRICE MOVES (chronological):');
  for (const data of Object.values(byStock)) {
    lines.push(`\n[${data.symbol} / ${data.exchange}]`);
    data.entries.forEach((e) => lines.push('  ' + e));
  }

  const periodStart = String(dailyBriefings[0]?.date || '').slice(0, 10) || today;
  lines.push(`\nRespond with ONLY this JSON (no markdown):
{
  "overview": "3–5 sentence summary of market conditions, portfolio highlights, and key events over the period",
  "stocks": [
    {
      "symbol": "TICKER",
      "exchange": "EXCHANGE",
      "trend": "Overall trend for this stock during the 30-day period",
      "signalAccuracy": "Were the signals aligned with actual price movements? Cite examples."
    }
  ],
  "adviceQuality": "Overall assessment of the 30-day briefing accuracy and usefulness",
  "period": "${periodStart} to ${today}"
}`);

  return lines.join('\n');
}

async function generateMonthlySummary(userId) {
  const tz = await getWorkspaceTimezone();
  const today = getDateInTz(tz);
  const thirtyDaysAgo = getDateInTz(tz, 30);

  const { rows: dailyBriefings } = await pool.query(
    `SELECT date, symbol, exchange, content, signal, "priceChangePct"
     FROM share_news_briefings
     WHERE "userId"=$1 AND type='daily' AND date >= $2
     ORDER BY date ASC, symbol NULLS FIRST`,
    [userId, thirtyDaysAgo]
  );

  if (!dailyBriefings.length) {
    return { skipped: true, reason: 'No daily briefings in the past 30 days' };
  }

  const tiers = await getModelsForUser(userId);
  const modelId = tiers.standard || tiers.light || tiers.gemini;
  if (!modelId) throw new Error('No model configured for user');

  const promptText = buildSummaryPrompt(dailyBriefings, today);
  const raw = await callModel(modelId, promptText, { maxTokens: 2000, system: SUMMARY_SYSTEM_PROMPT });

  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let summaryData;
  try {
    summaryData = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) summaryData = JSON.parse(match[0]);
    else throw new Error('AI returned invalid JSON for monthly summary');
  }

  // Delete any existing monthly summary for today before replacing
  await pool.query(
    `DELETE FROM share_news_briefings WHERE "userId"=$1 AND date=$2 AND type='monthly_summary'`,
    [userId, today]
  );

  // overview → content field; structured data → headlines (JSONB)
  await pool.query(
    `INSERT INTO share_news_briefings
      ("userId", date, symbol, exchange, content, signal, headlines, type)
     VALUES ($1,$2,NULL,NULL,$3,'neutral',$4,'monthly_summary')`,
    [
      userId, today,
      summaryData.overview || '',
      JSON.stringify({
        stocks: summaryData.stocks || [],
        adviceQuality: summaryData.adviceQuality || '',
        period: summaryData.period || `ending ${today}`,
      }),
    ]
  );

  console.log(`[sharesNews] Generated monthly summary for user ${userId} on ${today}`);
  return { date: today, generated: true };
}

// ─── Query ────────────────────────────────────────────────────────────────────

async function getBriefingsForUser(userId) {
  // Daily: last 45 days. Monthly summaries: all (never deleted).
  const tz = await getWorkspaceTimezone();
  const cutoff = getDateInTz(tz, 45);
  const { rows } = await pool.query(
    `SELECT id, date, symbol, exchange, content, signal, headlines, "priceChangePct", "createdAt", type
     FROM share_news_briefings
     WHERE "userId"=$1 AND (type='monthly_summary' OR date >= $2)
     ORDER BY date DESC, (type='monthly_summary')::int DESC, symbol NULLS FIRST`,
    [userId, cutoff]
  );
  return rows;
}

module.exports = { generateDailyBriefing, generateMonthlySummary, getBriefingsForUser };
