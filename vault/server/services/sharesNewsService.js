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
const { logUsage } = require('../utils/logUsage');
const { parseModelJson } = require('../utils/parseModelJson');
const sharesPortfolio = require('./sharesPortfolio');
const metalsPortfolio = require('./metalsPortfolio');
const marketData = require('./marketData');
const sendEmail = require('../utils/sendEmail');
const { runtimeConfig } = require('../config/runtime');
const {
  ALERT_PEAK_TRIGGER_OFF_PCT,
  ALERT_AVG_COST_TRIGGER_OFF_PCT,
  ALERT_PROXIMITY_PP,
  formatPctOffDisplay,
  refreshHighWaterMarksAndAlerts,
} = require('./portfolioAlerts');

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

function sourceFromUrl(url) {
  if (!url) return 'Web';
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return 'Web';
  }
}

async function webSearch(query) {
  if (runtimeConfig.disableWebSearch) return [];

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
      return (data.web?.results || []).slice(0, 4).map((r) => ({
        title: r.title,
        snippet: r.description || '',
        url: r.url || null,
        source: r.profile?.name || sourceFromUrl(r.url),
      }));
    }
    if (provider === 'serper') {
      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query.trim(), num: 5 }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const data = await res.json();
      return (data.organic || []).slice(0, 4).map((r) => ({
        title: r.title,
        snippet: r.snippet || '',
        url: r.link || null,
        source: sourceFromUrl(r.link),
      }));
    }
    // serpapi
    const res = await fetch(
      `https://serpapi.com/search.json?q=${q}&api_key=${apiKey}&num=5&engine=google`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
    );
    const data = await res.json();
    return (data.organic_results || []).slice(0, 4).map((r) => ({
      title: r.title,
      snippet: r.snippet || '',
      url: r.link || null,
      source: sourceFromUrl(r.link),
    }));
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
      .map((n) => ({
        title: n.headline,
        snippet: n.summary || '',
        url: n.url || null,
        source: n.source || 'Finnhub',
      }));
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

async function fetchMetalsNews() {
  const [goldNews, miningNews] = await Promise.all([
    webSearch('gold price XAU precious metals news today site:reuters.com OR site:bloomberg.com'),
    webSearch('gold mining commodities Federal Reserve USD news today Reuters Bloomberg'),
  ]);
  return [...goldNews, ...miningNews];
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

async function generateBriefings(userId, holdings, newsMap, marketNews, modelId, today) {
  const prompt = buildDailyPrompt(holdings, newsMap, marketNews, today);
  const maxTokens = Math.min(8000, 2000 + holdings.length * 250);

  async function callOnce(userPrompt, system) {
    const result = await callModel(modelId, userPrompt, { maxTokens, system, returnUsage: true });
    logUsage({
      userId,
      model: modelId,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      feature: 'shares_news',
    });
    return String(result.text || '').trim();
  }

  let raw = await callOnce(prompt, DAILY_SYSTEM_PROMPT);
  let parsed = parseModelJson(raw);

  if (!parsed || typeof parsed !== 'object') {
    raw = await callOnce(
      `The previous response was not valid JSON. Return ONLY valid JSON matching this shape (no markdown, no commentary):\n{\n  "stocks": [{ "symbol": "NVDA", "exchange": "NYSE", "paragraph": "...", "signal": "bullish" }],\n  "market": { "paragraph": "...", "signal": "neutral" }\n}\n\nPrevious output:\n${raw.slice(0, 6000)}`,
      'You fix malformed JSON for portfolio news briefings. Output valid JSON only.'
    );
    parsed = parseModelJson(raw);
  }

  if (!parsed || typeof parsed !== 'object') {
    console.error('[sharesNews] daily briefing JSON parse failed', { preview: raw.slice(0, 400) });
    throw new Error('AI returned invalid JSON for daily briefings — try again');
  }
  return parsed;
}

// ─── generateDailyBriefing ────────────────────────────────────────────────────

async function generateDailyBriefing(userId) {
  const tz = await getWorkspaceTimezone();
  const today = getDateInTz(tz);

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

  // Generate first — only replace stored rows after a successful parse so a failed
  // run does not wipe today's briefing.
  const briefings = await generateBriefings(userId, holdings, newsMap, marketNews, modelId, today);
  const stockBriefings = Array.isArray(briefings.stocks) ? briefings.stocks : [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM share_news_briefings WHERE "userId"=$1 AND date=$2 AND type='daily'`,
      [userId, today]
    );

    for (const b of stockBriefings) {
      const holding = holdings.find((h) => h.symbol === b.symbol && h.exchange === b.exchange);
      const headlines = (newsMap[`${b.symbol}:${b.exchange}`] || []).map((n) => n.title);
      await client.query(
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

    if (briefings.market?.paragraph) {
      await client.query(
        `INSERT INTO share_news_briefings
          ("userId", date, symbol, exchange, content, signal, headlines, type)
         VALUES ($1,$2,NULL,NULL,$3,$4,'[]','daily')`,
        [userId, today, briefings.market.paragraph, briefings.market.signal || 'neutral']
      );
    }

    const cutoff = getDateInTz(tz, 45);
    await client.query(
      `DELETE FROM share_news_briefings WHERE "userId"=$1 AND type='daily' AND date < $2`,
      [userId, cutoff]
    );
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }

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
  const maxTokens = 4000;

  async function callOnce(userPrompt, system) {
    const result = await callModel(modelId, userPrompt, { maxTokens, system, returnUsage: true });
    logUsage({
      userId,
      model: modelId,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      feature: 'shares_news',
    });
    return String(result.text || '').trim();
  }

  let raw = await callOnce(promptText, SUMMARY_SYSTEM_PROMPT);
  let summaryData = parseModelJson(raw);

  if (!summaryData || typeof summaryData !== 'object') {
    raw = await callOnce(
      `The previous response was not valid JSON. Return ONLY valid JSON with no markdown fences.\n\nPrevious output:\n${raw.slice(0, 6000)}`,
      'You fix malformed JSON for a 30-day portfolio summary. Output valid JSON only.'
    );
    summaryData = parseModelJson(raw);
  }

  if (!summaryData || typeof summaryData !== 'object') {
    console.error('[sharesNews] monthly summary JSON parse failed', { preview: raw.slice(0, 400) });
    throw new Error('AI returned invalid JSON for monthly summary — try again');
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

// ─── Portfolio observation agent ──────────────────────────────────────────────
//
// A separate, holistic daily narrative (distinct from the per-stock briefings
// above). It blends the portfolio, today's price moves, 24h news, and broad
// market context into one concise briefing, then emails the portfolio owner.
//
// Index context: the free Finnhub / Alpha Vantage quote endpoints don't cover
// raw indices, so we use liquid ETF proxies (overridable via env). When a proxy
// can't be fetched we pass null and the prompt rules tell the model to say so.

const INDEX_PROXIES = {
  nasdaq: { symbol: String(process.env.OBS_INDEX_NASDAQ || 'QQQ').toUpperCase(), exchange: 'NASDAQ', label: 'Nasdaq' },
  sox:    { symbol: String(process.env.OBS_INDEX_SOX || 'SOXX').toUpperCase(),    exchange: 'NASDAQ', label: 'SOX' },
  asx:    { symbol: String(process.env.OBS_INDEX_ASX || 'STW').toUpperCase(),     exchange: 'ASX',    label: 'ASX 200' },
};

// Holdings mapped to the benchmark used for beat/lag analysis in MOVERS & CAUSALITY.
const SEMI_SYMBOLS = new Set([
  'TSM', 'NVDA', 'ASML', 'AMD', 'AVGO', 'INTC', 'MU', 'QCOM', 'ARM', 'SMCI', 'LRCX', 'KLAC', 'AMAT',
]);

function sectorBenchmarkFor(symbol, exchange) {
  const sym = String(symbol || '').toUpperCase();
  const ex = String(exchange || '').toUpperCase();
  if (ex === 'ASX') return { label: 'ASX 200', key: 'asx' };
  if (SEMI_SYMBOLS.has(sym)) return { label: 'SOX', key: 'sox' };
  return { label: 'Nasdaq', key: 'nasdaq' };
}

function fmtAud(n) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(Number(n) || 0);
}

function signedPct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function computePortfolioDayMovement(positions) {
  let startValueAud = 0;
  let currentValueAud = 0;
  let priced = 0;
  for (const p of positions || []) {
    if (p.priceAud == null || p.previousCloseAud == null) continue;
    const qty = Number(p.quantity) || 0;
    startValueAud += Number(p.previousCloseAud) * qty;
    currentValueAud += Number(p.priceAud) * qty;
    priced += 1;
  }
  if (priced === 0 || startValueAud <= 0) return null;
  const changeAud = currentValueAud - startValueAud;
  return {
    startValueAud: round2(startValueAud),
    currentValueAud: round2(currentValueAud),
    changeAud: round2(changeAud),
    changePct: round2((changeAud / startValueAud) * 100),
    priced,
  };
}

function enrichHoldingsForObservation(dash, indexPcts) {
  const holdingsValue = dash.holdingsValueAud || 0;
  return dash.positions.map((p) => {
    const qty = Number(p.quantity) || 0;
    const sector = sectorBenchmarkFor(p.symbol, p.exchange);
    const sectorPct = indexPcts[sector.key] ?? null;
    const dayChangePct = p.dayChangePct != null ? round2(p.dayChangePct) : null;
    const dayChangeAud = p.dayChangeAud != null
      ? round2(p.dayChangeAud)
      : (p.priceAud != null && p.previousCloseAud != null
        ? round2((Number(p.priceAud) - Number(p.previousCloseAud)) * qty)
        : null);
    const vsSector = (dayChangePct != null && sectorPct != null)
      ? round2(dayChangePct - sectorPct)
      : null;
    let relative = 'unknown';
    if (vsSector != null) {
      if (Math.abs(vsSector) < 0.25) relative = 'matched';
      else relative = vsSector > 0 ? 'beat' : 'lagged';
    }
    return {
      symbol: p.symbol,
      exchange: p.exchange,
      quantity: qty,
      priceAud: p.priceAud != null ? round2(p.priceAud) : null,
      previousCloseAud: p.previousCloseAud != null ? round2(p.previousCloseAud) : null,
      avgCostAud: p.avgCostAud != null ? round2(p.avgCostAud) : null,
      costBasisAud: p.costBasisAud != null ? round2(p.costBasisAud) : null,
      dayChangePct,
      dayChangeAud,
      valueAud: p.valueAud != null ? round2(p.valueAud) : null,
      weightPct: p.valueAud != null && holdingsValue > 0 ? round2((p.valueAud / holdingsValue) * 100) : null,
      totalReturnPct: p.pnlPct != null ? round2(p.pnlPct) : null,
      sectorBenchmark: sector.label,
      sectorBenchmarkPct: sectorPct,
      vsSectorPct: vsSector,
      relativeToSector: relative,
    };
  });
}

function enrichMetalsForObservation(metalsDash) {
  const holdingsValue = metalsDash.holdingsValueAud || 0;
  return (metalsDash.positions || []).map((p) => ({
    ...p,
    label: p.label,
    weightPct: p.valueAud != null && holdingsValue > 0 ? round2((p.valueAud / holdingsValue) * 100) : null,
  }));
}

function selectMoversForReport(holdings) {
  const ABS_MOVE_PCT = 1;
  const BENCHMARK_DIVERGENCE_PCT = 2;

  const qualifies = (h) => {
    if (h.dayChangePct == null) return false;
    const absMove = Math.abs(h.dayChangePct);
    const absDiv = h.vsSectorPct != null ? Math.abs(h.vsSectorPct) : 0;
    return absMove >= ABS_MOVE_PCT || absDiv >= BENCHMARK_DIVERGENCE_PCT;
  };

  const moverScore = (h) =>
    Math.max(Math.abs(h.dayChangePct || 0), Math.abs(h.vsSectorPct || 0));

  const ranked = [...holdings]
    .filter((h) => h.dayChangePct != null)
    .sort((a, b) => moverScore(b) - moverScore(a));

  const qualified = ranked.filter(qualifies);
  const selected = qualified.length ? qualified : ranked.slice(0, 3);

  return selected.map((h) => ({
    ...h,
    inclusionReason: moverInclusionReason(h, ABS_MOVE_PCT, BENCHMARK_DIVERGENCE_PCT),
  }));
}

function moverInclusionReason(h, absMovePct, divergencePct) {
  const absMove = Math.abs(h.dayChangePct ?? 0);
  const absDiv = Math.abs(h.vsSectorPct ?? 0);
  const reasons = [];
  if (absMove >= absMovePct) reasons.push('absolute_move');
  if (absDiv >= divergencePct) reasons.push('benchmark_divergence');
  return reasons.length ? reasons.join('+') : 'fallback_top_mover';
}

/** Earliest snapshot price in window → current price. No benchmark trailing (not stored). */
async function loadTrailingHoldingMetrics(userId, holdings, windowDays = 5) {
  const symbols = [...new Set(holdings.map((h) => h.symbol).filter(Boolean))];
  if (!symbols.length) return {};

  // Extra calendar days so a Mon run still finds Fri's snapshot after a weekend.
  const cutoff = new Date(Date.now() - (windowDays + 3) * 24 * 60 * 60 * 1000);

  const { rows } = await pool.query(
    `SELECT DISTINCT ON (symbol) symbol, "priceAud", "recordedAt"
     FROM share_symbol_snapshots
     WHERE "userId"=$1 AND symbol = ANY($2::text[]) AND "recordedAt" >= $3
     ORDER BY symbol, "recordedAt" ASC`,
    [userId, symbols, cutoff]
  );

  const startBySym = Object.fromEntries(
    rows.map((r) => [r.symbol, { priceAud: Number(r.priceAud), recordedAt: r.recordedAt }])
  );

  const out = {};
  for (const h of holdings) {
    const start = startBySym[h.symbol];
    const current = h.priceAud;
    if (!start?.priceAud || !current || start.priceAud <= 0) {
      out[h.symbol] = {
        dataAvailable: false,
        windowDays,
        reason: 'insufficient_snapshot_history',
      };
      continue;
    }
    out[h.symbol] = {
      dataAvailable: true,
      windowDays,
      trailingPct: round2(((current - start.priceAud) / start.priceAud) * 100),
      startPriceAud: round2(start.priceAud),
      startRecordedAt: start.recordedAt,
      currentPriceAud: current,
    };
  }
  return out;
}

/** Finnhub earnings calendar for US holdings — next ~90 days. ASX dates not supplied. */
async function loadUpcomingEarnings(holdings, today, tz, windowDays = 90) {
  const to = getDateInTz(tz, windowDays);
  const bySymbol = {};
  const seen = new Set();
  const tasks = [];
  for (const h of holdings || []) {
    const ex = String(h.exchange || '').toUpperCase();
    if (ex !== 'NYSE' && ex !== 'NASDAQ') continue;
    if (!h.symbol || seen.has(h.symbol)) continue;
    seen.add(h.symbol);
    tasks.push(
      marketData.getEarningsCalendar(h.symbol, today, to).then((events) => {
        if (events.length) bySymbol[h.symbol] = events;
      })
    );
  }
  await Promise.all(tasks);
  return {
    bySymbol,
    windowDays,
    from: today,
    to,
    policy: 'Own-report dates from Finnhub for US symbols only. Read-through events: carry forward from priorPortfolioNote UPCOMING CATALYSTS unless today\'s news confirms a new date. Never invent dates.',
  };
}

// ─── Alert status (high-water mark + trigger proximity) ───────────────────────
// Shared logic: server/services/portfolioAlerts.js

function parseObservationHeadlines(val) {
  if (!val) return {};
  if (typeof val === 'object' && !Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return {}; }
  }
  return {};
}

function isMaterialMove(h) {
  return Math.abs(h.dayChangePct ?? 0) >= 1 || Math.abs(h.vsSectorPct ?? 0) >= 2;
}

function hasTickerNews(symbol, newsItems) {
  return (newsItems || []).some((n) => n.symbol === symbol);
}

function updateUnexplainedHistory(priorHistory, holdings, newsItems, today) {
  const history = JSON.parse(JSON.stringify(priorHistory || {}));
  for (const h of holdings || []) {
    if (!isMaterialMove(h)) continue;
    if (hasTickerNews(h.symbol, newsItems)) continue;
    const sym = h.symbol;
    if (!history[sym]) history[sym] = [];
    if (history[sym].some((e) => e.date === today)) continue;
    history[sym].push({
      date: today,
      dayChangePct: h.dayChangePct,
      vsSectorPct: h.vsSectorPct,
      direction: (h.dayChangePct ?? 0) >= 0 ? 'up' : 'down',
    });
    if (history[sym].length > 14) history[sym] = history[sym].slice(-14);
  }
  return history;
}

function buildPatternHints(holdings, newsItems, unexplainedHistory) {
  const material = (holdings || []).filter(isMaterialMove);
  const noNewsMovers = material.filter((h) => !hasTickerNews(h.symbol, newsItems));
  const up = noNewsMovers.filter((h) => (h.dayChangePct ?? 0) > 0);
  const down = noNewsMovers.filter((h) => (h.dayChangePct ?? 0) < 0);

  const lagging = holdings.filter(
    (h) => h.relativeToSector === 'lagged' && (h.vsSectorPct ?? 0) < -0.25
  );
  const laggingNoNews = lagging.filter((h) => !hasTickerNews(h.symbol, newsItems));

  const recurringUnexplained = [];
  for (const [sym, entries] of Object.entries(unexplainedHistory || {})) {
    const recent = (entries || []).slice(-5);
    if (recent.length >= 2) {
      recurringUnexplained.push({ symbol: sym, recentDays: recent.length, entries: recent });
    }
  }

  return {
    alertThresholds: {
      peakOffPct: ALERT_PEAK_TRIGGER_OFF_PCT,
      avgCostOffPct: ALERT_AVG_COST_TRIGGER_OFF_PCT,
      proximityPp: ALERT_PROXIMITY_PP,
    },
    sameDirectionNoNews: {
      upSymbols: up.map((h) => h.symbol),
      downSymbols: down.map((h) => h.symbol),
      upCount: up.length,
      downCount: down.length,
      totalMaterialNoNews: noNewsMovers.length,
      note: 'If ≥3 names share direction with no ticker news in feed, treat as correlation/concentration — not independent anecdotes.',
    },
    laggingCluster: {
      laggingSymbols: lagging.map((h) => h.symbol),
      laggingNoNews: laggingNoNews.map((h) => ({
        symbol: h.symbol,
        dayChangePct: h.dayChangePct,
        vsSectorPct: h.vsSectorPct,
      })),
      note: 'Multiple laggers with no negative catalyst may share a macro factor.',
    },
    recurringUnexplained,
  };
}

function buildAlertStatusHtml(alertRows) {
  if (!alertRows?.length) {
    return '<p style="font-size:13px;color:#888;margin:0 0 20px;">No priced positions for alert table.</p>';
  }
  const rows = alertRows.map((r) => {
    const flagCell = r.flag
      ? `<span style="font-size:16px;">${r.flag}</span>`
      : '<span style="color:#ccc;">—</span>';
    const flagStyle = r.flag === '🔴' ? 'background:#fef2f2;' : r.flag === '⚠️' ? 'background:#fffbeb;' : '';
    return `<tr style="${flagStyle}">
      <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;font-weight:600;">${escapeHtml(r.label)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;color:#888;font-size:12px;">${escapeHtml(r.exchange || '')}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;">${fmtAud(r.currentAud)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;">${fmtAud(r.peakAud)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;">${formatPctOffDisplay(r.pctOffPeak)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;">${formatPctOffDisplay(r.pctOffAvgCost)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;text-align:center;">${flagCell}</td>
    </tr>`;
  }).join('');

  return `
  <h3 style="margin:0 0 10px;font-size:12px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid #e8e8e4;padding-bottom:6px;">Alert status</h3>
  <p style="margin:0 0 10px;font-size:12px;color:#888;">Peak = rolling high-water mark since purchase (carried forward). Triggers: ${ALERT_PEAK_TRIGGER_OFF_PCT}% off peak · ${ALERT_AVG_COST_TRIGGER_OFF_PCT}% off avg cost. ⚠️ = within ${ALERT_PROXIMITY_PP}pp of a trigger.</p>
  <div style="overflow-x:auto;margin:0 0 24px;">
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="background:#f0f0ec;">
          <th style="padding:8px 10px;text-align:left;font-size:11px;color:#888;">Position</th>
          <th style="padding:8px 10px;text-align:left;font-size:11px;color:#888;">Exch</th>
          <th style="padding:8px 10px;text-align:left;font-size:11px;color:#888;">Current</th>
          <th style="padding:8px 10px;text-align:left;font-size:11px;color:#888;">Peak</th>
          <th style="padding:8px 10px;text-align:left;font-size:11px;color:#888;">Off peak</th>
          <th style="padding:8px 10px;text-align:left;font-size:11px;color:#888;">Off avg cost</th>
          <th style="padding:8px 10px;text-align:center;font-size:11px;color:#888;">Flag</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

const OBSERVATION_OUTPUT_TEMPLATE = `Write ONLY the narrative body (ALERT STATUS table is rendered separately in the email — do NOT duplicate it). Use ## section headings exactly as below. No markdown tables.

## CROSS-POSITION PATTERNS
Lead with portfolio-level patterns — not single-stock vs benchmark anecdotes:
- **Correlation / concentration:** Use patternHints.sameDirectionNoNews — if multiple positions moved the same direction with no ticker news in feed, state count and names as one correlation signal (not N separate unexplained stories).
- **Recurring unexplained:** Use patternHints.recurringUnexplained + unexplainedMoveHistory — flag names with back-to-back material moves without news (e.g. NVDA ±4pp swings); carry forward from prior note.
- **Shared macro lag:** Use patternHints.laggingCluster — if multiple "no negative catalyst" names lag together (TSM/ASML-type), frame as possible shared macro factor.
Label inference explicitly. No buy/sell recommendations.

## MOVERS & CAUSALITY
Cover every holding in moversToCover (included if |day %| ≥ 1 OR |vs sector| ≥ 2pp divergence). One bullet each:
- **TICKER** [±X.XX%] vs **sectorBenchmark** [±X.XX%] → **beat/lagged/matched** (±X.XX pp) — [cause: connect move to a specific news claim with [Source, ≤8-word headline], OR "no company-specific catalyst; move tracks sector (beta not alpha)"]
  Thesis: **reinforces / weakens / neutral** — [one clause]

## POSITION CHECK
One line per holding in positionsNotInMovers (every other position — complete audit trail):
- **TICKER** [±X.XX%] vs sector → **beat/lagged/matched** — [no notable move / no news / one-line status]

## SECTOR & MACRO CONTEXT
Sector-wide drivers today (not stock-specific). Cite macro/sector items. Estimate how much of portfolio day move is sector beta vs stock-specific.

## NEWS WORTH ACTING ON
Max 4 bullets. Only items that could change position size or thesis. Extract the actual claim/number from the article — not a headline paste. Format: **TICKER** — [what it says] · [why it matters] · [Source, ≤8-word headline]

## RISK WATCH
2–4 bullets. Background risks not fully in today's price (regulatory, supply chain, valuation). Scale claim strength to sample size (rule 13): one day's move is an observation, not a pattern — no "decoupling"/"breakdown" without multi-session evidence; if no catalyst, say "no specific catalyst identified" rather than inventing one. Distinct from UPCOMING CATALYSTS — no dated event calendar here.

## UPCOMING CATALYSTS
Forward-looking calendar (rules 14–15). One line per held ticker in allHoldings:
- **TICKER**: next own report [date or "not in upcomingEarnings — carry from prior note or state unconfirmed"] · before that: [read-through event, date] — why it matters for this holding

Carry forward the catalyst calendar from priorPortfolioNote verbatim; only add/revise when upcomingEarnings or today's news confirms a date, or mark passed events as "passed — see Movers." Include supplier/customer/competitor earnings as read-throughs where relevant to semis/AI names. Do not regenerate the full calendar from scratch daily.

## DECISION TRIGGERS
2–4 bullets. Concrete, falsifiable tripwires — level, event, or comparison. Carry forward prior triggers verbatim unless revising with explicit reason (see priorPortfolioNote). State baseline explicitly (% off peak, % off avg cost, vs sector, AUD price). No "monitor closely" without a level. Multi-day % only if in trailingMetrics with dataAvailable:true.

## INTERNAL CONSISTENCY CHECK
Before finishing, audit this note:
- Any DECISION TRIGGER whose reference baseline contradicts alertStatus or alert table (% off peak vs % off avg cost vs AUD price — must not mix silently).
- Any figure mixing USD and AUD without conversion shown.
- Any trigger that contradicts another figure in the same report.
If none found: one line "No internal contradictions flagged." If found: bullet each with location and conflicting baselines. No recommendations.

## ONE-LINER
Portfolio value (AUD), position count, one sentence the client would repeat if asked "how's the book doing."

---

If hasMetals is true, add after shares ONE-LINER:

## METALS & MINERALS

### CROSS-POSITION PATTERNS
Metals/macro correlation only — spot beta vs macro news.

### MOVERS & CAUSALITY
Cover every holding in metalsMoversToCover (same inclusion rule as shares). Use label for display name. Benchmark is gold spot (XAU/AUD) — all lots move with spot unless a future metal type differs.
- **LABEL** [±X.XX%] vs **Gold spot** [±X.XX%] → **beat/lagged/matched** — [cause with citation, or "no metal-specific catalyst; move tracks spot (beta not alpha)"]
  Thesis: **reinforces / weakens / neutral** — [one clause]

### POSITION CHECK
One line per holding in metalsPositionsNotInMovers.

### SECTOR & MACRO CONTEXT
Gold/precious-metals macro drivers (USD, rates, geopolitics, mining supply). Tie metals portfolio day move to spot beta vs metal-specific news.

### NEWS WORTH ACTING ON
Max 4 bullets — thesis-changing for the metals book only.

### RISK WATCH
Background risks for precious metals / mining exposure. Rule 13 applies. Not the event calendar.

### UPCOMING CATALYSTS
Macro/metals read-throughs (Fed, CPI, USD, geopolitical summits) — carry forward from prior note; one line per lot or book-level if events affect all holdings equally.

### DECISION TRIGGERS
Falsifiable tripwires for the metals book. Carry forward metals triggers from priorPortfolioNote verbatim unless revising with explicit reason.

### DECISION TRIGGERS
Falsifiable tripwires for metals book. State baseline (spot AUD/oz, off peak, off avg cost). Carry forward from priorPortfolioNote.

### INTERNAL CONSISTENCY CHECK
Same audit rules for metals triggers vs alert table.

### ONE-LINER
Metals book value (AUD), lot count, one sentence on how physical gold/minerals did today.`;

const OBSERVATION_SYSTEM_PROMPT = `# Daily Portfolio Analyst — System Prompt

## Role
You are a senior sell-side equity research analyst covering semiconductors, AI infrastructure, and mega-cap tech. The **alert status table is pre-rendered** — your job is cross-position pattern recognition, causality where it exists, and consistency auditing. Write like a broker note: causal relationships, decision points, risks. No buy/sell/hold recommendations.

## Inputs you will receive
- **alertStatus** — pre-computed per position (current, peak HWM, % off peak, % off avg cost, flag). Do NOT recalculate or duplicate in prose.
- **patternHints** — correlation clusters, lagging groups, recurring unexplained movers
- **unexplainedMoveHistory** — cross-day log of material moves without ticker news (carry forward patterns)
- hasShares / hasMetals, holdings, movers, priorPortfolioNote, upcomingEarnings, NEWS

## Hard rules
1. **Lead with CROSS-POSITION PATTERNS** — correlation, recurring unexplained divergence, shared macro lag clusters. Not six separate unexplained anecdotes when the same direction + no news affects multiple names.
2. **Every price move needs a stated cause** in MOVERS (news linked or explicit beta-not-alpha).
3. **Benchmark relative performance** on movers (beat/lag vs sector, pp).
4. **Read news substance** — not headline paste. Citations: [Source, ≤8-word headline].
5. **Never say unavailable without workaround.**
6. **Decision triggers** — falsifiable; carry forward; state baseline (% off peak / % off avg cost / AUD / vs sector) explicitly.
7. **INTERNAL CONSISTENCY CHECK** — flag mixed baselines (e.g. trigger vs "% off cost" in alert table vs "% off peak") and USD/AUD without conversion.
8. **No recommendations** — surface patterns, trigger proximity, contradictions only.

## Continuity (cross-day)
9. Decision triggers = standing tripwires (carry forward verbatim unless revised with reason).
10. Same facts described consistently; flag conflicts with prior note.
11. Label inference as inference.
12. No holding disappears (POSITION CHECK).
13. Risk Watch: one-day = observation not pattern; no invented catalysts.
14–15. UPCOMING CATALYSTS: carry forward calendar; mark passed events.

## Alert flags (pre-computed — do not override)
🔴 = ≥${ALERT_PEAK_TRIGGER_OFF_PCT}% off peak OR ≥${ALERT_AVG_COST_TRIGGER_OFF_PCT}% off avg cost. ⚠️ = within ${ALERT_PROXIMITY_PP}pp of either trigger.

${OBSERVATION_OUTPUT_TEMPLATE}`;

const OBSERVATION_REVIEW_SYSTEM_PROMPT = `You are a senior sell-side editor reviewing a daily PORTFOLIO NOTE before it goes to the client.

The ALERT STATUS table is pre-rendered — do NOT add a duplicate table.

Enforce:
- CROSS-POSITION PATTERNS leads: correlation clusters, recurring unexplained, shared macro lag — not isolated anecdotes.
- MOVERS: cause or beta-not-alpha; beat/lag; POSITION CHECK complete.
- DECISION TRIGGERS: explicit baseline (% off peak / avg cost / AUD); carry forward from prior note.
- INTERNAL CONSISTENCY CHECK present; flag baseline/currency contradictions.
- No buy/sell recommendations. METALS block when hasMetals.

Return the improved full note body only.`;

const OBSERVATION_FINAL_SYSTEM_PROMPT = `You are the lead analyst sending the final PORTFOLIO NOTE. Merge draft + reviewer.

Verify numbers against PRE-COMPUTED SUMMARY and alertStatus. Do NOT duplicate the alert table.

Sections: CROSS-POSITION PATTERNS, MOVERS & CAUSALITY, POSITION CHECK, SECTOR & MACRO, NEWS WORTH ACTING ON, RISK WATCH, UPCOMING CATALYSTS, DECISION TRIGGERS, INTERNAL CONSISTENCY CHECK, ONE-LINER (+ METALS when hasMetals).

No recommendations. Return ONLY the final note body.`;

function pickSecondaryModel(tiers, primaryModel) {
  const candidates = [tiers.gemini, tiers.light, tiers.deepseek, tiers.standard].filter(Boolean);
  return candidates.find((m) => m && m !== primaryModel) || primaryModel;
}

function buildReflectionPrompt(dataPrompt, draft) {
  return [
    'Source data the briefing must be based on:',
    '<DATA>',
    dataPrompt,
    '</DATA>',
    '',
    'Draft briefing to review:',
    '<DRAFT>',
    draft,
    '</DRAFT>',
    '',
    'Reflect, correct, and augment per your instructions. Return the improved full briefing only.',
  ].join('\n');
}

function buildFinalPrompt(dataPrompt, draft, revised) {
  return [
    'Source data:',
    '<DATA>',
    dataPrompt,
    '</DATA>',
    '',
    'Original draft:',
    '<DRAFT>',
    draft,
    '</DRAFT>',
    "Reviewer's revised version:",
    '<REVISED>',
    revised,
    '</REVISED>',
    '',
    'Produce the final briefing for emailing. Return only the final briefing.',
  ].join('\n');
}

function round2(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
}

function pctOrNa(v) {
  return v == null ? 'unavailable (no data)' : `${v}%`;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function fetchIndexPct(proxy) {
  try {
    if (!marketData.canFetchExchange(proxy.exchange)) return null;
    const q = await marketData.getQuote(proxy.symbol, proxy.exchange);
    if (!q || !q.current || !q.previousClose) return null;
    return round2(((q.current - q.previousClose) / q.previousClose) * 100);
  } catch (err) {
    console.warn(`[sharesNews] index proxy ${proxy.symbol} fetch failed:`, err.message);
    return null;
  }
}

function buildFallbackReport({
  hasShares,
  hasMetals,
  portfolio,
  holdings,
  movers,
  portfolioMove,
  metalsSummary,
  metalsMovers,
  metalsHoldings,
  patternHints,
  alertRows,
  nasdaqPct,
  soxPct,
  asxPct,
  asxNote,
}) {
  const bench = [
    `Nasdaq ${signedPct(nasdaqPct)}`,
    `SOX ${signedPct(soxPct)}`,
    asxPct != null ? `ASX 200 ${signedPct(asxPct)}` : `ASX 200 (${asxNote || 'proxy unavailable'})`,
  ].join(' · ');

  const parts = ['_AI narrative unavailable — data-only portfolio note._', ''];

  if (hasShares) {
    const moverSymbols = new Set(movers.map((m) => m.symbol));
    const nonMovers = holdings.filter((h) => !moverSymbols.has(h.symbol));
    const moverLines = movers.length
      ? movers.map((p) => {
        const rel = p.relativeToSector !== 'unknown' ? p.relativeToSector : 'matched';
        return `- **${p.symbol}** ${signedPct(p.dayChangePct)} vs ${p.sectorBenchmark} ${signedPct(p.sectorBenchmarkPct)} → **${rel}** — no identified catalyst, beta move (AI unavailable)\n  Thesis: **neutral** — automated summary only`;
      }).join('\n')
      : '- No material movers on latest data.';
    const positionCheckLines = nonMovers.length
      ? nonMovers.map((p) => {
        const rel = p.relativeToSector !== 'unknown' ? p.relativeToSector : 'matched';
        return `- **${p.symbol}** ${signedPct(p.dayChangePct)} vs sector → **${rel}** — no notable move; no news screened (AI unavailable)`;
      }).join('\n')
      : '- All positions covered in movers.';
    const portLine = portfolioMove
      ? `${signedPct(portfolioMove.changePct)} (${fmtAud(portfolioMove.changeAud)} on holdings)`
      : 'day move unavailable';

    const corr = patternHints?.sameDirectionNoNews;
    const corrLine = corr && (corr.upCount >= 2 || corr.downCount >= 2)
      ? `- ${corr.upCount} names up / ${corr.downCount} down on no ticker news — possible correlation (see alert table).`
      : '- Insufficient cross-position pattern data in fallback mode.';

    parts.push(
      '## CROSS-POSITION PATTERNS',
      corrLine,
      patternHints?.recurringUnexplained?.length
        ? `- Recurring unexplained: ${patternHints.recurringUnexplained.map((r) => r.symbol).join(', ')}.`
        : '- No recurring unexplained pattern in history.',
      '',
      '## MOVERS & CAUSALITY',
      moverLines,
      '',
      '## POSITION CHECK',
      positionCheckLines,
      '',
      '## SECTOR & MACRO CONTEXT',
      `Macro backdrop from index proxies: ${bench}. Full sector vs stock-specific attribution requires AI analysis.`,
      '',
      '## NEWS WORTH ACTING ON',
      '- None flagged automatically — review holdings manually.',
      '',
      '## RISK WATCH',
      '- AI analysis unavailable; check upcoming earnings and macro calendar manually.',
      '',
      '## UPCOMING CATALYSTS',
      '- Carry forward from prior note when available; Finnhub dates not loaded in fallback mode.',
      '',
      '## DECISION TRIGGERS',
      `- Re-run note when portfolio day move exceeds ±2% (${portfolioMove ? signedPct(portfolioMove.changePct) : 'n/a'} today). Reference alert table baselines (% off peak / avg cost).`,
      '',
      '## INTERNAL CONSISTENCY CHECK',
      alertRows?.some((r) => r.flag)
        ? `- Alert flags present (${alertRows.filter((r) => r.flag).map((r) => r.label).join(', ')}) — verify triggers use same baseline as alert table.`
        : '- No alert flags; no baseline conflicts detected in fallback mode.',
      '',
      '## ONE-LINER',
      `${fmtAud(portfolio.totalValueAud)} book, ${portfolio.holdings.length} positions — ${portLine}.`,
      ''
    );
  }

  if (hasMetals && metalsSummary) {
    const metalsMoverSymbols = new Set((metalsMovers || []).map((m) => m.symbol));
    const metalsNonMovers = (metalsHoldings || []).filter((h) => !metalsMoverSymbols.has(h.symbol));
    const metalPortLine = metalsSummary.portfolioDay
      ? `${signedPct(metalsSummary.portfolioDay.changePct)} (${fmtAud(metalsSummary.portfolioDay.changeAud)})`
      : 'day move unavailable';
    const metalsMoverLines = (metalsMovers || []).length
      ? metalsMovers.map((p) =>
        `- **${p.label}** ${signedPct(p.dayChangePct)} vs Gold spot ${signedPct(p.sectorBenchmarkPct)} → **matched** — spot move (AI unavailable)\n  Thesis: **neutral** — automated summary only`
      ).join('\n')
      : '- No material movers on latest data.';
    const metalsCheckLines = metalsNonMovers.length
      ? metalsNonMovers.map((p) =>
        `- **${p.label}** ${signedPct(p.dayChangePct)} vs spot → **matched** — no notable move (AI unavailable)`
      ).join('\n')
      : '- All lots covered in movers.';

    parts.push(
      '## METALS & MINERALS',
      '',
      '### CROSS-POSITION PATTERNS',
      '- Spot-driven; see alert table for off-peak / off-cost flags.',
      '',
      '### MOVERS & CAUSALITY',
      metalsMoverLines,
      '',
      '### POSITION CHECK',
      metalsCheckLines,
      '',
      '### SECTOR & MACRO CONTEXT',
      `Gold spot ${signedPct(metalsSummary.spot?.dayChangePct)} — macro attribution requires AI analysis.`,
      '',
      '### NEWS WORTH ACTING ON',
      '- None flagged automatically — review gold/macro headlines manually.',
      '',
      '### RISK WATCH',
      '- AI analysis unavailable.',
      '',
      '### UPCOMING CATALYSTS',
      '- Carry forward macro/metals calendar from prior note.',
      '',
      '### DECISION TRIGGERS',
      `- Re-run when metals day move exceeds ±2% (${metalsSummary.portfolioDay ? signedPct(metalsSummary.portfolioDay.changePct) : 'n/a'} today).`,
      '',
      '### INTERNAL CONSISTENCY CHECK',
      '- Verify metals triggers use AUD/oz baselines consistent with alert table.',
      '',
      '### ONE-LINER',
      `${fmtAud(metalsSummary.portfolio.holdingsValueAud)} metals book, ${metalsSummary.portfolio.lotCount} lots — ${metalPortLine}.`
    );
  }

  return parts.join('\n');
}

function buildObservationPrompt({
  hasShares,
  hasMetals,
  portfolio,
  holdings,
  movers,
  positionsNotInMovers,
  portfolioMove,
  trailingMetrics,
  metalsSummary,
  upcomingEarnings,
  alertStatus,
  patternHints,
  unexplainedMoveHistory,
  priorPortfolioNote,
  newsItems,
  nasdaqPct,
  soxPct,
  asxPct,
  asxProxy,
}) {
  const asxLine = asxPct != null
    ? `${asxPct}% (${asxProxy.symbol} proxy)`
    : `${asxProxy.symbol} proxy unavailable — say "ASX 200 proxy unavailable" in macro text`;

  const lines = [
    'Write the PORTFOLIO NOTE narrative body. ALERT STATUS table is pre-rendered in email — do NOT duplicate it.',
    hasShares ? 'Start at ## CROSS-POSITION PATTERNS for shares.' : 'No share holdings — skip share ## sections.',
    hasMetals ? 'Add ## METALS & MINERALS after shares ONE-LINER.' : 'Omit METALS block.',
    '',
    '## FLAGS',
    JSON.stringify({ hasShares, hasMetals }, null, 2),
    '',
    '## alertStatus (pre-computed — authoritative for peak, off-peak, off-cost, flags)',
    JSON.stringify(alertStatus, null, 2),
    '',
    '## patternHints (use for CROSS-POSITION PATTERNS)',
    JSON.stringify(patternHints, null, 2),
    '',
    '## unexplainedMoveHistory (cross-day — recurring unexplained pattern detection)',
    JSON.stringify(unexplainedMoveHistory, null, 2),
  ];

  if (hasShares) {
    lines.push(
      '',
      '## SHARES — PRE-COMPUTED SUMMARY',
      JSON.stringify({
        portfolioDay: portfolioMove,
        portfolio: {
          totalValueAud: portfolio.totalValueAud,
          holdingsValueAud: portfolio.holdingsValueAud,
          cashAud: portfolio.cashAud,
          positionCount: portfolio.holdings.length,
          unrealizedPnlPct: portfolio.unrealizedPnlPct,
          asOf: portfolio.asOf,
        },
        benchmarks: {
          nasdaqPct,
          soxPct,
          asx200Pct: asxPct,
          asx200Note: asxLine,
        },
        moverInclusionRule: '|dayChangePct| >= 1% OR |vsSectorPct| >= 2 percentage points vs sector benchmark',
        moversToCover: movers.map((m) => ({
          symbol: m.symbol,
          inclusionReason: m.inclusionReason,
          dayChangePct: m.dayChangePct,
          vsSectorPct: m.vsSectorPct,
          sectorBenchmark: m.sectorBenchmark,
          sectorBenchmarkPct: m.sectorBenchmarkPct,
          relativeToSector: m.relativeToSector,
        })),
        positionsNotInMovers,
        trailingMetrics,
        trailingMetricsPolicy: 'Stock-only trailing % from share_symbol_snapshots (earliest in ~5d window → current). No trailing vs-sector data. Use trailingPct only when dataAvailable:true; never invent multi-day figures.',
        allHoldings: holdings,
      }, null, 2)
    );
  }

  if (hasMetals) {
    lines.push('', '## METALS — PRE-COMPUTED SUMMARY', JSON.stringify(metalsSummary, null, 2));
  }

  if (hasShares) {
    lines.push('', '## upcomingEarnings (Finnhub — US own-report dates only)', JSON.stringify(upcomingEarnings, null, 2));
  }

  lines.push(
    '',
    '## priorPortfolioNote (carry forward DECISION TRIGGERS verbatim; flag fact conflicts)',
    priorPortfolioNote
      ? `Date: ${priorPortfolioNote.date}\n\n${priorPortfolioNote.content}`
      : 'null — first note; set standing triggers fresh.',
    '',
    '## NEWS (last 24h — title, source, url, snippet; cite as [Source, ≤8-word headline])',
    JSON.stringify(newsItems, null, 2)
  );

  return lines.join('\n');
}

// Convert inline markdown (**bold**, *italic*) to HTML.
// escapeHtml first so raw text is safe, then apply formatting.
function inlineMd(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
}

// Section headings that get distinct email styling.
const OBS_CALLOUT_SECTIONS = new Set([]);
const OBS_SECTION_LABELS = {
  'CROSS-POSITION PATTERNS': 'Cross-position patterns',
  'MOVERS & CAUSALITY': 'Movers & causality',
  'POSITION CHECK': 'Position check',
  'SECTOR & MACRO CONTEXT': 'Sector & macro context',
  'NEWS WORTH ACTING ON': 'News worth acting on',
  'RISK WATCH': 'Risk watch',
  'UPCOMING CATALYSTS': 'Upcoming catalysts',
  'DECISION TRIGGERS': 'Decision triggers',
  'INTERNAL CONSISTENCY CHECK': 'Internal consistency check',
  'ONE-LINER': 'One-liner',
  'METALS & MINERALS': 'Metals & minerals',
};

// Convert markdown observation text to styled HTML.
function markdownToObservationHtml(text) {
  const lines = text.split('\n');
  const parts = [];
  let inList = false;
  let listContainer = null;
  let tableBuffer = [];
  let inCallout = false;
  let calloutParts = [];

  const closeList = () => {
    if (!inList) return;
    if (listContainer === 'callout') calloutParts.push('</ul>');
    else parts.push('</ul>');
    inList = false;
    listContainer = null;
  };

  const closeCallout = () => {
    if (!inCallout) return;
    parts.push(
      `<div style="background:#f9f9f7;border-left:4px solid #cc785c;padding:14px 16px;margin:0 0 20px;border-radius:4px;line-height:1.65;">${
        calloutParts.join('\n')
      }</div>`
    );
    calloutParts = [];
    inCallout = false;
  };

  const flushTable = () => {
    if (!tableBuffer.length) return;
    const parseCells = (row) =>
      row.split('|').filter((_, i, a) => i > 0 && i < a.length - 1).map((c) => c.trim());
    const isSeparator = (row) => /^\|[\s\-:| ]+\|$/.test(row);
    const dataRows = tableBuffer.filter((r) => !isSeparator(r));
    if (!dataRows.length) { tableBuffer = []; return; }
    const [header, ...body] = dataRows;
    const thCells = parseCells(header)
      .map((c) => `<th style="padding:7px 10px;text-align:left;font-size:12px;font-weight:700;color:#555;border-bottom:2px solid #e8e8e4;">${inlineMd(c)}</th>`)
      .join('');
    const tdRows = body.map((row, ri) =>
      `<tr style="${ri % 2 === 1 ? 'background:#f9f9f7;' : ''}">${
        parseCells(row).map((c) => `<td style="padding:7px 10px;font-size:13px;border-bottom:1px solid #f0f0f0;">${inlineMd(c)}</td>`).join('')
      }</tr>`
    ).join('');
    const tableHtml = `<div style="overflow-x:auto;margin:8px 0 16px;"><table style="width:100%;border-collapse:collapse;"><thead><tr>${thCells}</tr></thead>${tdRows ? `<tbody>${tdRows}</tbody>` : ''}</table></div>`;
    if (inCallout) calloutParts.push(tableHtml);
    else parts.push(tableHtml);
    tableBuffer = [];
  };

  const pushBlock = (html) => {
    if (inCallout) calloutParts.push(html);
    else parts.push(html);
  };

  const renderSectionHeading = (rawTitle) => {
    const key = rawTitle.toUpperCase();
    const label = OBS_SECTION_LABELS[key] || rawTitle;
    return (
      `<h3 style="margin:26px 0 10px;font-size:12px;font-weight:700;color:#888;` +
      `text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid #e8e8e4;padding-bottom:6px;">${inlineMd(label)}</h3>`
    );
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (trimmed.startsWith('## ')) {
      flushTable(); closeList(); closeCallout();
      const rawTitle = trimmed.slice(3).trim();
      const key = rawTitle.toUpperCase();
      pushBlock(renderSectionHeading(rawTitle));
      if (OBS_CALLOUT_SECTIONS.has(key)) inCallout = true;
    } else if (trimmed.startsWith('### ')) {
      flushTable(); closeList();
      const heading = inlineMd(trimmed.slice(4));
      pushBlock(
        `<h4 style="margin:12px 0 4px;font-size:14px;font-weight:700;color:#1a1a1a;` +
        `background:#f5f5f0;padding:6px 10px;border-left:3px solid #cc785c;border-radius:3px;">${heading}</h4>`
      );
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      flushTable();
      if (!inList) {
        const ul = '<ul style="margin:4px 0 10px;padding-left:20px;line-height:1.65;">';
        if (inCallout) { calloutParts.push(ul); listContainer = 'callout'; }
        else { parts.push(ul); listContainer = 'parts'; }
        inList = true;
      }
      const li = `<li style="margin:4px 0;">${inlineMd(trimmed.slice(2))}</li>`;
      if (listContainer === 'callout') calloutParts.push(li);
      else parts.push(li);
    } else if (trimmed.startsWith('|')) {
      closeList();
      tableBuffer.push(trimmed);
    } else if (/^\d+\.\s/.test(trimmed)) {
      flushTable(); closeList();
      pushBlock(`<p style="margin:4px 0;line-height:1.65;">${inlineMd(trimmed)}</p>`);
    } else if (trimmed === '') {
      flushTable(); closeList();
    } else if (trimmed.startsWith('_') && trimmed.endsWith('_') && trimmed.length > 2) {
      flushTable(); closeList();
      pushBlock(`<p style="color:#888;font-size:12px;font-style:italic;margin:8px 0;">${escapeHtml(trimmed.slice(1, -1))}</p>`);
    } else {
      flushTable(); closeList();
      pushBlock(`<p style="margin:6px 0;line-height:1.65;">${inlineMd(trimmed)}</p>`);
    }
  }
  flushTable();
  closeList();
  closeCallout();
  return parts.join('\n');
}

function formatBenchmark(label, pct) {
  if (pct == null) return `${label} —`;
  const colour = pct >= 0 ? '#16a34a' : '#dc2626';
  return `${label} <strong style="color:${colour}">${signedPct(pct)}</strong>`;
}

function observationHtml(text, { nasdaqPct, soxPct, asxPct, asxProxy, today, portfolioMove, goldSpotPct, metalsPortfolioMove, alertRows }) {
  const asxBench = asxPct != null
    ? formatBenchmark('ASX 200', asxPct)
    : `ASX 200 <span style="color:#888;">— (${asxProxy?.symbol || 'STW'} proxy n/a)</span>`;
  const benchmarks = [
    formatBenchmark('Nasdaq', nasdaqPct),
    formatBenchmark('SOX', soxPct),
    asxBench,
    goldSpotPct != null ? formatBenchmark('Gold (XAU/AUD)', goldSpotPct) : null,
  ].filter(Boolean).join(' &nbsp;·&nbsp; ');

  const portChip = portfolioMove
    ? `<span style="margin-left:12px;color:${portfolioMove.changePct >= 0 ? '#16a34a' : '#dc2626'};font-weight:600;">Shares ${signedPct(portfolioMove.changePct)} (${fmtAud(portfolioMove.changeAud)})</span>`
    : '';
  const metalsChip = metalsPortfolioMove
    ? `<span style="margin-left:12px;color:${metalsPortfolioMove.changePct >= 0 ? '#16a34a' : '#dc2626'};font-weight:600;">Metals ${signedPct(metalsPortfolioMove.changePct)} (${fmtAud(metalsPortfolioMove.changeAud)})</span>`
    : '';

  return `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:680px;color:#1a1a1a;">

  <div style="border-bottom:3px solid #1a1a1a;padding-bottom:12px;margin-bottom:8px;">
    <h1 style="margin:0;font-size:20px;font-weight:700;letter-spacing:.02em;">PORTFOLIO NOTE — ${today}</h1>
    <p style="margin:8px 0 0;font-size:13px;color:#555;">
      <span style="color:#888;">Benchmarks:</span> ${benchmarks}${portChip}${metalsChip}
    </p>
  </div>

  <div style="font-size:14px;line-height:1.6;">
    ${buildAlertStatusHtml(alertRows)}
    ${markdownToObservationHtml(text)}
  </div>

  <p style="margin-top:28px;font-size:11px;color:#bbb;border-top:1px solid #e8e8e4;padding-top:12px;">
    Observations and decision framing only — not financial advice.
  </p>
</div>`;
}

async function generateObservation(userId) {
  const tz = await getWorkspaceTimezone();
  const today = getDateInTz(tz);

  await metalsPortfolio.recordSpotSnapshot('XAU');

  const [dash, metalsDash] = await Promise.all([
    sharesPortfolio.buildDashboard(userId),
    metalsPortfolio.buildMetalsDashboard(userId, tz),
  ]);

  const hasShares = dash.positions.length > 0;
  const hasMetals = metalsDash.positions.length > 0;
  if (!hasShares && !hasMetals) return { skipped: true, reason: 'No holdings' };

  let portfolio = null;
  let holdings = [];
  let movers = [];
  let positionsNotInMovers = [];
  let portfolioMove = null;
  let trailingMetrics = {};

  if (hasShares) {
    const holdingsValue = dash.holdingsValueAud || 0;
    portfolio = {
      asOf: dash.quotedAt,
      totalValueAud: round2(dash.totalValueAud),
      holdingsValueAud: round2(dash.holdingsValueAud),
      cashAud: round2(dash.cashAud),
      unrealizedPnlPct: dash.unrealizedPnlPct != null ? round2(dash.unrealizedPnlPct) : null,
      holdings: dash.positions.map((p) => ({
        symbol: p.symbol,
        exchange: p.exchange,
        quantity: p.quantity,
        valueAud: p.valueAud != null ? round2(p.valueAud) : null,
        weightPct: p.valueAud != null && holdingsValue > 0 ? round2((p.valueAud / holdingsValue) * 100) : null,
        avgCostAud: round2(p.avgCostAud),
        totalReturnPct: p.pnlPct != null ? round2(p.pnlPct) : null,
      })),
    };
    portfolioMove = computePortfolioDayMovement(dash.positions);
  }

  const [nasdaqPct, soxPct, asxPct] = await Promise.all([
    fetchIndexPct(INDEX_PROXIES.nasdaq),
    fetchIndexPct(INDEX_PROXIES.sox),
    fetchIndexPct(INDEX_PROXIES.asx),
  ]);

  if (hasShares) {
    const indexPcts = { nasdaq: nasdaqPct, sox: soxPct, asx: asxPct };
    holdings = enrichHoldingsForObservation(dash, indexPcts);
    movers = selectMoversForReport(holdings);
    const moverSymbols = new Set(movers.map((m) => m.symbol));
    positionsNotInMovers = holdings
      .filter((h) => !moverSymbols.has(h.symbol))
      .map((h) => ({
        symbol: h.symbol,
        exchange: h.exchange,
        dayChangePct: h.dayChangePct,
        vsSectorPct: h.vsSectorPct,
        sectorBenchmark: h.sectorBenchmark,
        sectorBenchmarkPct: h.sectorBenchmarkPct,
        relativeToSector: h.relativeToSector,
        valueAud: h.valueAud,
        weightPct: h.weightPct,
      }));
    trailingMetrics = await loadTrailingHoldingMetrics(userId, holdings, 5);
  }

  let metalsHoldings = [];
  let metalsMovers = [];
  let metalsPositionsNotInMovers = [];
  let metalsSummary = null;

  if (hasMetals) {
    metalsHoldings = enrichMetalsForObservation(metalsDash);
    metalsMovers = selectMoversForReport(metalsHoldings);
    const metalsMoverSymbols = new Set(metalsMovers.map((m) => m.symbol));
    metalsPositionsNotInMovers = metalsHoldings
      .filter((h) => !metalsMoverSymbols.has(h.symbol))
      .map((h) => ({
        symbol: h.symbol,
        label: h.label,
        metal: h.metal,
        dayChangePct: h.dayChangePct,
        vsSectorPct: h.vsSectorPct,
        sectorBenchmark: h.sectorBenchmark,
        sectorBenchmarkPct: h.sectorBenchmarkPct,
        relativeToSector: h.relativeToSector,
        valueAud: h.valueAud,
        weightPct: h.weightPct,
        weightOz: h.weightOz,
      }));
    metalsSummary = {
      portfolioDay: metalsDash.portfolioMove,
      spot: {
        audPerOz: metalsDash.spot?.audPerOz ?? null,
        previousCloseAudPerOz: metalsDash.previousCloseAudPerOz,
        dayChangePct: metalsDash.spotDayChangePct,
        baselineNote: metalsDash.baselineSource
          ? `Day % vs ${metalsDash.baselineSource}`
          : 'No prior spot snapshot — day % unavailable until a second calendar day with snapshots',
        spotError: metalsDash.spotError,
      },
      portfolio: {
        totalOz: metalsDash.totalOz,
        totalCostAud: metalsDash.totalCostAud,
        holdingsValueAud: metalsDash.holdingsValueAud,
        unrealizedPnlPct: metalsDash.unrealizedPnlPct,
        lotCount: metalsDash.positions.length,
        asOf: metalsDash.quotedAt,
      },
      metalsMoversToCover: metalsMovers.map((m) => ({
        symbol: m.symbol,
        label: m.label,
        metal: m.metal,
        inclusionReason: m.inclusionReason,
        dayChangePct: m.dayChangePct,
        vsSectorPct: m.vsSectorPct,
        sectorBenchmark: m.sectorBenchmark,
        sectorBenchmarkPct: m.sectorBenchmarkPct,
        relativeToSector: m.relativeToSector,
        weightOz: m.weightOz,
        valueAud: m.valueAud,
      })),
      metalsPositionsNotInMovers,
      allHoldings: metalsHoldings,
    };
  }

  const [priorPortfolioNote, upcomingEarnings] = await Promise.all([
    getPriorObservationNote(userId, today),
    hasShares ? loadUpcomingEarnings(holdings, today, tz) : Promise.resolve(null),
  ]);

  const newsItems = [];
  if (hasShares) {
    await Promise.all(
      dash.positions.map(async (p) => {
        const news = await fetchHoldingNews(p.symbol, p.exchange);
        news.slice(0, 4).forEach((n) =>
          newsItems.push({
            symbol: p.symbol,
            exchange: p.exchange,
            title: n.title,
            source: n.source || 'Unknown',
            url: n.url || null,
            snippet: (n.snippet || '').slice(0, 280),
          })
        );
      })
    );
  }
  const searchPromises = [
    webSearch('stock market macro news today Federal Reserve rates Reuters Bloomberg'),
    webSearch('semiconductor chip sector news today SOX Nasdaq Reuters'),
  ];
  if (hasMetals) {
    searchPromises.push(fetchMetalsNews());
  }
  const searchResults = await Promise.all(searchPromises);
  const [macroNews, semiNews, metalsNews = []] = searchResults;
  macroNews.slice(0, 3).forEach((n) =>
    newsItems.push({
      symbol: 'MACRO',
      title: n.title,
      source: n.source || 'Web',
      url: n.url || null,
      snippet: (n.snippet || '').slice(0, 280),
    })
  );
  semiNews.slice(0, 3).forEach((n) =>
    newsItems.push({
      symbol: 'SECTOR_SEMIS',
      title: n.title,
      source: n.source || 'Web',
      url: n.url || null,
      snippet: (n.snippet || '').slice(0, 280),
    })
  );
  metalsNews.slice(0, 6).forEach((n) =>
    newsItems.push({
      symbol: 'METALS',
      title: n.title,
      source: n.source || 'Web',
      url: n.url || null,
      snippet: (n.snippet || '').slice(0, 280),
    })
  );

  const {
    highWaterMarks,
    shareAlerts: shareAlertRows,
    metalsAlerts: metalsAlertRows,
  } = await refreshHighWaterMarksAndAlerts(userId, {
    sharePositions: holdings,
    metalsPositions: metalsHoldings,
    metalsSpotAud: metalsDash.spot?.audPerOz ?? null,
    asOfDate: today,
  });
  const alertRows = [...shareAlertRows, ...metalsAlertRows];
  const priorUnexplained = priorPortfolioNote?.headlines?.unexplainedMoveHistory || {};
  const unexplainedMoveHistory = hasShares
    ? updateUnexplainedHistory(priorUnexplained, holdings, newsItems, today)
    : priorUnexplained;
  const patternHints = hasShares
    ? buildPatternHints(holdings, newsItems, unexplainedMoveHistory)
    : { note: 'No share holdings' };
  const alertStatus = {
    rows: alertRows,
    thresholds: {
      peakOffPct: ALERT_PEAK_TRIGGER_OFF_PCT,
      avgCostOffPct: ALERT_AVG_COST_TRIGGER_OFF_PCT,
      proximityPp: ALERT_PROXIMITY_PP,
    },
  };

  const asxNote = asxPct == null ? `${INDEX_PROXIES.asx.symbol} proxy unavailable` : null;
  const userPrompt = buildObservationPrompt({
    hasShares,
    hasMetals,
    portfolio,
    holdings,
    movers,
    positionsNotInMovers,
    portfolioMove,
    trailingMetrics,
    metalsSummary,
    upcomingEarnings,
    alertStatus,
    patternHints,
    unexplainedMoveHistory,
    priorPortfolioNote,
    newsItems,
    nasdaqPct,
    soxPct,
    asxPct,
    asxProxy: INDEX_PROXIES.asx,
  });

  const tiers = await getModelsForUser(userId);
  const primaryModel = tiers.standard || tiers.light || tiers.gemini;
  if (!primaryModel) throw new Error('No model configured for user — check vault_models in Settings');
  const secondaryModel = pickSecondaryModel(tiers, primaryModel);

  let draft = '';
  try {
    const draftRes = await callModel(primaryModel, userPrompt, {
      maxTokens: 5200,
      system: OBSERVATION_SYSTEM_PROMPT,
      returnUsage: true,
    });
    logUsage({ userId, model: primaryModel, inputTokens: draftRes.inputTokens, outputTokens: draftRes.outputTokens, feature: 'shares_observation' });
    draft = (draftRes.text || '').trim();
  } catch (err) {
    console.error(`[sharesNews] observation primary draft failed for user ${userId}:`, err.message);
  }

  let text;
  let aiUnavailable = false;
  if (!draft) {
    aiUnavailable = true;
    text = buildFallbackReport({
      hasShares,
      hasMetals,
      portfolio,
      holdings,
      movers,
      portfolioMove,
      metalsSummary,
      metalsMovers,
      metalsHoldings,
      patternHints,
      alertRows,
      nasdaqPct,
      soxPct,
      asxPct,
      asxNote,
    });
  } else {
    let revised = draft;
    try {
      const revRes = await callModel(secondaryModel, buildReflectionPrompt(userPrompt, draft), {
        maxTokens: 5500,
        system: OBSERVATION_REVIEW_SYSTEM_PROMPT,
        returnUsage: true,
      });
      logUsage({ userId, model: secondaryModel, inputTokens: revRes.inputTokens, outputTokens: revRes.outputTokens, feature: 'shares_observation_review' });
      const t = (revRes.text || '').trim();
      if (t) revised = t;
    } catch (err) {
      console.warn(`[sharesNews] observation secondary pass failed for user ${userId}:`, err.message);
    }

    text = revised;
    try {
      const finRes = await callModel(primaryModel, buildFinalPrompt(userPrompt, draft, revised), {
        maxTokens: 5200,
        system: OBSERVATION_FINAL_SYSTEM_PROMPT,
        returnUsage: true,
      });
      logUsage({ userId, model: primaryModel, inputTokens: finRes.inputTokens, outputTokens: finRes.outputTokens, feature: 'shares_observation_final' });
      const t = (finRes.text || '').trim();
      if (t) text = t;
    } catch (err) {
      console.warn(`[sharesNews] observation final pass failed for user ${userId}:`, err.message);
    }
  }

  // One observation per user per day — replace any existing for today.
  await pool.query(
    `DELETE FROM share_news_briefings WHERE "userId"=$1 AND date=$2 AND type='observation'`,
    [userId, today]
  );
  await pool.query(
    `INSERT INTO share_news_briefings ("userId", date, symbol, exchange, content, signal, headlines, type)
     VALUES ($1,$2,NULL,NULL,$3,NULL,$4,'observation')`,
    [userId, today, text, JSON.stringify({
      nasdaqPct, soxPct, asxPct,
      portfolioMove,
      metalsPortfolioMove: metalsDash.portfolioMove,
      hasShares,
      hasMetals,
      movers: movers.map((m) => m.symbol),
      metalsLots: metalsDash.positions.length,
      holdings: holdings.length,
      newsCount: newsItems.length,
      aiUnavailable,
      highWaterMarks,
      unexplainedMoveHistory,
      alertSnapshot: alertRows,
    })]
  );

  const cutoff = getDateInTz(tz, 45);
  await pool.query(
    `DELETE FROM share_news_briefings WHERE "userId"=$1 AND type='observation' AND date < $2`,
    [userId, cutoff]
  );

  let emailed = false;
  try {
    const { rows: u } = await pool.query('SELECT email FROM users WHERE id=$1', [userId]);
    const to = u[0]?.email;
    if (to) {
      await sendEmail({
        to,
        subject: `Portfolio note — ${today}`,
        html: observationHtml(text, {
          nasdaqPct,
          soxPct,
          asxPct,
          asxProxy: INDEX_PROXIES.asx,
          today,
          portfolioMove,
          goldSpotPct: metalsDash.spotDayChangePct,
          metalsPortfolioMove: metalsDash.portfolioMove,
          alertRows,
        }),
      });
      emailed = true;
    }
  } catch (err) {
    console.warn(`[sharesNews] observation email failed for user ${userId}:`, err.message);
  }

  console.log(`[sharesNews] Generated observation for user ${userId} on ${today} (emailed: ${emailed}, aiUnavailable: ${aiUnavailable})`);
  return { date: today, text, emailed, aiUnavailable, context: { nasdaqPct, soxPct, asxPct } };
}

async function getPriorObservationNote(userId, today) {
  const { rows } = await pool.query(
    `SELECT date, content, headlines FROM share_news_briefings
     WHERE "userId"=$1 AND type='observation' AND date < $2
     ORDER BY date DESC, "createdAt" DESC LIMIT 1`,
    [userId, today]
  );
  if (!rows[0]?.content) return null;
  const content = String(rows[0].content);
  const maxLen = 10000;
  return {
    date: String(rows[0].date).slice(0, 10),
    content: content.length > maxLen ? `${content.slice(0, maxLen)}\n\n[…prior note truncated]` : content,
    headlines: parseObservationHeadlines(rows[0].headlines),
  };
}

async function getLatestObservation(userId) {
  const { rows } = await pool.query(
    `SELECT id, date, content, headlines, "createdAt"
     FROM share_news_briefings
     WHERE "userId"=$1 AND type='observation'
     ORDER BY date DESC, "createdAt" DESC LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

// ─── Query ────────────────────────────────────────────────────────────────────

async function getBriefingsForUser(userId) {
  // Daily: last 45 days. Monthly summaries: all (never deleted).
  // Observations are excluded here — they have their own endpoint.
  const tz = await getWorkspaceTimezone();
  const cutoff = getDateInTz(tz, 45);
  const { rows } = await pool.query(
    `SELECT id, date, symbol, exchange, content, signal, headlines, "priceChangePct", "createdAt", type
     FROM share_news_briefings
     WHERE "userId"=$1 AND type IN ('daily','monthly_summary')
       AND (type='monthly_summary' OR date >= $2)
     ORDER BY date DESC, (type='monthly_summary')::int DESC, symbol NULLS FIRST`,
    [userId, cutoff]
  );
  return rows;
}

module.exports = {
  generateDailyBriefing,
  generateMonthlySummary,
  getBriefingsForUser,
  generateObservation,
  getLatestObservation,
};
