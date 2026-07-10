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
const sharesPortfolio = require('./sharesPortfolio');
const metalsPortfolio = require('./metalsPortfolio');
const marketData = require('./marketData');
const sendEmail = require('../utils/sendEmail');
const { runtimeConfig } = require('../config/runtime');

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
  const result = await callModel(modelId, prompt, { maxTokens: 1500, system: DAILY_SYSTEM_PROMPT, returnUsage: true });
  logUsage({ userId, model: modelId, inputTokens: result.inputTokens, outputTokens: result.outputTokens, feature: 'shares_news' });
  const raw = result.text;

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

  const briefings = await generateBriefings(userId, holdings, newsMap, marketNews, modelId, today);

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
  const result = await callModel(modelId, promptText, { maxTokens: 2000, system: SUMMARY_SYSTEM_PROMPT, returnUsage: true });
  logUsage({ userId, model: modelId, inputTokens: result.inputTokens, outputTokens: result.outputTokens, feature: 'shares_news' });
  const raw = result.text;

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

const OBSERVATION_OUTPUT_TEMPLATE = `Write ONLY the body (email header and benchmarks line are added separately). Use ## section headings exactly as below. No markdown tables.

## TOP LINE
2–3 sentences max. The single most important thing for this portfolio today and why it matters — as if this is the only paragraph the client reads.

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
2–4 bullets. Background risks not fully in today's price (regulatory, supply chain, valuation, upcoming events). Scale claim strength to sample size (rule 13): one day's move is an observation, not a pattern — no "decoupling"/"breakdown" without multi-session evidence; if no catalyst, say "no specific catalyst identified" rather than inventing one.

## DECISION TRIGGERS
2–4 bullets. Concrete, falsifiable tripwires — level, event, or comparison. Carry forward prior triggers verbatim unless revising with explicit reason (see priorPortfolioNote). No "monitor closely" without a level. Multi-day % only if in trailingMetrics with dataAvailable:true.

## ONE-LINER
Portfolio value (AUD), position count, one sentence the client would repeat if asked "how's the book doing."

---

If hasMetals is true in PRE-COMPUTED SUMMARY, add this block after the shares ONE-LINER. If hasMetals is false, omit it entirely.

## METALS & MINERALS

### TOP LINE
2–3 sentences: the single most important thing for the gold/minerals book today.

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
Background risks for precious metals / mining exposure. Rule 13 applies.

### DECISION TRIGGERS
Falsifiable tripwires for the metals book. Carry forward metals triggers from priorPortfolioNote verbatim unless revising with explicit reason.

### ONE-LINER
Metals book value (AUD), lot count, one sentence on how physical gold/minerals did today.`;

const OBSERVATION_SYSTEM_PROMPT = `# Daily Portfolio Analyst — System Prompt

## Role
You are a senior sell-side equity research analyst covering semiconductors, AI infrastructure, and mega-cap tech. You are writing a daily portfolio note for a sophisticated client who holds a concentrated AI/semis book. Write like a broker note, not a data recap: every sentence should either explain a causal relationship, flag a decision point, or state a risk. Do not restate data the client can already see without adding interpretation.

Observations and decision framing only — never explicit buy/sell/hold recommendations.

## Inputs you will receive (in the user message)
- hasShares / hasMetals flags — omit share sections or entire METALS & MINERALS block when false
- SHARES PRE-COMPUTED SUMMARY: holdings, benchmarks, moversToCover, positionsNotInMovers, trailingMetrics, portfolio day move
- METALS PRE-COMPUTED SUMMARY: spot (XAU/AUD), lots, metalsMoversToCover, metalsPositionsNotInMovers, metals portfolio day move
- priorPortfolioNote: yesterday's note (for trigger continuity and fact consistency) — may be null on first run
- NEWS: per-ticker items; METALS / MACRO / SECTOR_SEMIS for context

## Hard rules
1. **Every price move needs a stated cause.** For each mover, identify which news item (if any) plausibly explains it: "ASML +2.0% — consistent with [Bernstein PT raise, cite source]" or, if no news explains it, "no company-specific catalyst found; move tracks SOX (+3.5%), i.e. beta not alpha." Never present a move and headlines side by side without connecting them.
2. **Always benchmark relative performance.** For each mover, state beat/matched/lagged vs sectorBenchmark and vsSectorPct — by roughly how much. This is the single most important thing a broker adds that a data feed doesn't.
3. **Read the news, don't just cite the headline.** Extract the actual claim or number (PT, deal size, analyst, catalyst) from snippet/title. A headline pasted verbatim is not analysis.
4. **Never say "unavailable" without a workaround.** If ASX 200 (or another benchmark) is missing, state the proxy from benchmarks.asx200Note, flag stale data, or explain what cannot be assessed today (e.g. cannot assess ASX-relative performance). If narrative cannot be produced, state which inputs were missing — not generic boilerplate.
5. **Inline citations:** [Source Name, ≤8-word headline] — only from supplied articles. Do not fabricate figures, PTs, or attributions.
6. **Give a view, not just facts.** State whether today's news reinforces, weakens, or is neutral to the thesis. Flag conflicts (e.g. bullish supply-chain read-through vs bearish sector risk noted separately).
7. **Decision triggers must be falsifiable** — reference a level, event, or comparison (e.g. "break below $X or second consecutive day underperforming SOX"). Never just "keep an eye on this" or "monitor closely" without a level.
8. **Quiet days are valid.** Say plainly why it was quiet — don't pad (no earnings, no analyst actions, sector in line with broad tech, etc.).

## Continuity rules (cross-day)
9. **Decision triggers are standing tripwires.** Carry forward triggers from priorPortfolioNote verbatim until they fire or you explicitly revise: "Revising NVDA trigger from [old] to [new] because [reason]." Never silently redraw thresholds from yesterday's close.
10. **Same disclosed fact, same description.** If today's sources conflict with priorPortfolioNote, flag the discrepancy — do not silently overwrite.
11. **Label inference as inference.** Causal claims about why money moved must cite evidence or be hedged ("no direct evidence in today's sources; inferred from the pattern of gains").
12. **No holding disappears.** moversToCover get full treatment; positionsNotInMovers get one line each in POSITION CHECK. Same for metals lots in METALS & MINERALS.
13. **Scale claim strength to sample size, especially in Risk Watch.** A single day's divergence, drop, or lag is one data point — describe it as an observation ("today's largest gap," "one-day divergence") not an established pattern ("decoupling," "momentum loss," "breakdown"). Reserve pattern-language for multiple consecutive sessions showing the same thing. When flagging risk with no identified cause, say "no specific catalyst identified" — never supply a plausible-sounding explanation (e.g. "likely pricing in geopolitical risk") without a cited source.

## Data integrity (system-enforced)
- Use ONLY numbers from PRE-COMPUTED SUMMARY — never invent prices, index levels, or % moves.
- moversToCover inclusion: |dayChangePct| ≥ 1% OR |vsSectorPct| ≥ 2pp (see inclusionReason on each mover).
- trailingMetrics: use trailingPct only when dataAvailable:true. No trailing vs-sector figures (not supplied).

## Tone
Direct, specific, numerate. No hedging filler ("could potentially"). No AI-disclosure boilerplate. If data is thin, say so once and move on.

${OBSERVATION_OUTPUT_TEMPLATE}`;

const OBSERVATION_REVIEW_SYSTEM_PROMPT = `You are a senior sell-side editor reviewing a daily PORTFOLIO NOTE before it goes to the client.

Enforce the analyst rules:
- Every mover: cause linked to news OR explicit beta-not-alpha; beat/lag with correct vsSectorPct; thesis line present.
- POSITION CHECK: every symbol in positionsNotInMovers appears with one line.
- METALS & MINERALS: if hasMetals, all ### subsections present with same rigour as shares; every metals lot accounted for.
- News claims extract substance from snippets — not headline reposts. Citations as [Source, ≤8-word headline].
- NEWS WORTH ACTING ON: ≤4 items, thesis-changing only.
- SECTOR & MACRO: beta vs stock-specific split for today's portfolio move.
- DECISION TRIGGERS: falsifiable; carry forward prior triggers from priorPortfolioNote unless explicitly revised; strip fabricated trailing % not in trailingMetrics.
- RISK WATCH: rule 13 — no pattern-language ("decoupling," "breakdown") from one day's data; no invented catalysts; say "no specific catalyst identified" when unknown.
- Drop wrong-company news. Label unconfirmed causal inference.
- All eight ## sections present.

Return the improved full note body only. No buy/sell advice.`;

const OBSERVATION_FINAL_SYSTEM_PROMPT = `You are the lead analyst sending the final PORTFOLIO NOTE to the client. Merge the strongest draft and reviewer version.

Verify every number against PRE-COMPUTED SUMMARY. Broker-note voice: causal, numerate, no data recap filler.

Sections required: TOP LINE, MOVERS & CAUSALITY, POSITION CHECK, SECTOR & MACRO CONTEXT, NEWS WORTH ACTING ON, RISK WATCH, DECISION TRIGGERS, ONE-LINER — plus METALS & MINERALS (all ### subsections) when hasMetals.

Citations: [Source, ≤8-word headline]. Triggers: standing tripwires with continuity from priorPortfolioNote. ≤4 news items. RISK WATCH: observation-language only unless multi-day evidence; no fabricated catalysts.

Return ONLY the final note body.`;

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

    parts.push(
      '## TOP LINE',
      `Portfolio ${portLine} with ${portfolio.holdings.length} positions (${fmtAud(portfolio.holdingsValueAud)} holdings value). Benchmarks: ${bench}.`,
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
      '## DECISION TRIGGERS',
      `- Re-run note when portfolio day move exceeds ±2% (${portfolioMove ? signedPct(portfolioMove.changePct) : 'n/a'} today).`,
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
      '### TOP LINE',
      `Metals book ${metalPortLine} — ${metalsSummary.portfolio.lotCount} lots, ${metalsSummary.portfolio.totalOz} oz (${fmtAud(metalsSummary.portfolio.holdingsValueAud)} at spot).`,
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
      '### DECISION TRIGGERS',
      `- Re-run when metals day move exceeds ±2% (${metalsSummary.portfolioDay ? signedPct(metalsSummary.portfolioDay.changePct) : 'n/a'} today).`,
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
    'Write the PORTFOLIO NOTE body. Header and benchmarks are added by email template.',
    hasShares ? 'Start at ## TOP LINE for shares.' : 'No share holdings — skip all share ## sections (TOP LINE through ONE-LINER).',
    hasMetals ? 'Then add ## METALS & MINERALS with all ### subsections.' : 'No metal holdings — omit ## METALS & MINERALS entirely.',
    '',
    '## FLAGS',
    JSON.stringify({ hasShares, hasMetals }, null, 2),
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
const OBS_CALLOUT_SECTIONS = new Set(['TOP LINE']);
const OBS_SECTION_LABELS = {
  'TOP LINE': 'Top line',
  'MOVERS & CAUSALITY': 'Movers & causality',
  'POSITION CHECK': 'Position check',
  'SECTOR & MACRO CONTEXT': 'Sector & macro context',
  'NEWS WORTH ACTING ON': 'News worth acting on',
  'RISK WATCH': 'Risk watch',
  'DECISION TRIGGERS': 'Decision triggers',
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

function observationHtml(text, { nasdaqPct, soxPct, asxPct, asxProxy, today, portfolioMove, goldSpotPct, metalsPortfolioMove }) {
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

  const priorPortfolioNote = await getPriorObservationNote(userId, today);

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
    `SELECT date, content FROM share_news_briefings
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
