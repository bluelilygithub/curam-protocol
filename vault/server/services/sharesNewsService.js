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
  nasdaq: { symbol: String(process.env.OBS_INDEX_NASDAQ || 'QQQ').toUpperCase(), exchange: 'NASDAQ' },
  sox:    { symbol: String(process.env.OBS_INDEX_SOX || 'SOXX').toUpperCase(),    exchange: 'NASDAQ' },
  asx:    { symbol: String(process.env.OBS_INDEX_ASX || 'STW').toUpperCase(),     exchange: 'ASX' },
};

const OBSERVATION_SYSTEM_PROMPT = `You are a senior portfolio observation agent producing a detailed daily briefing for a sophisticated investor. Your job is to analyse data and deliver sharp, well-evidenced observations — not financial advice.

## Your Task
Produce a daily briefing with these five sections:

1. **Portfolio Movement** — cover EVERY holding. For each: state today's price, day change %, day change in AUD, and current position value. Group into movers (>±1%) and flat (<±1%). For movers, explain WHY if the news supports it, or flag "no clear catalyst" if it doesn't.

2. **Sector Pulse** — analyse the macro backdrop. Compare portfolio holdings against Nasdaq, SOX (semiconductors), and ASX 200 data provided. If the portfolio outperformed or underperformed the index, say so with numbers. Identify any sector-wide themes (AI momentum, chip cycle, rates, AUD/USD impact on US holdings).

3. **News That Matters** — for every news item relevant to a holding, cite the source headline explicitly (e.g. "Reuters reports: [headline]"). Summarise its significance in one or two sentences. Only include news that has a plausible direct impact on holdings. If a news item contradicts the day's price move, flag that tension.

4. **Watch List** — list upcoming catalysts that could affect the portfolio: earnings dates, macro data releases, product announcements, regulatory events. Be specific with timing where it is known. Flag any holding that has recently moved sharply and may be setting up for a reversal or continuation.

5. **One Liner** — a single sentence capturing the single most important development for this portfolio today.

## Rules
- Reference actual numbers from the data at all times (prices, percentages, AUD values, index moves).
- Cite news sources by name and headline — do not paraphrase without attribution.
- Do not invent data. If data is missing or stale, say so explicitly.
- Do not give buy/sell recommendations.
- Use professional financial language. This briefing is for a sophisticated investor who does not need basic concepts explained.
- Format as clean Markdown using ## for the five section headings.
- There is no word limit — be as thorough as the data supports.`;

// Stage 2 — a second model reflects on and augments the primary draft.
const OBSERVATION_REVIEW_SYSTEM_PROMPT = `You are a senior markets analyst reviewing a colleague's draft portfolio observation before it is sent to the portfolio owner.

Critically review the draft against the source data provided:
- Correct any number that does not match the source data — do not let inaccuracies through.
- Ensure EVERY holding from the price data appears in Portfolio Movement. If any are missing, add them.
- Fill genuine gaps: significant moves the draft glossed over, sector themes not addressed, or relevant news not cited.
- Verify every news citation: the headline should be quoted or closely paraphrased, not invented.
- Remove filler, vague generalisations, or commentary not supported by the data.
- Sharpen language to be precise and professional.

Return the improved FULL briefing in the same five-section Markdown structure (## Portfolio Movement, ## Sector Pulse, ## News That Matters, ## Watch List, ## One Liner). Observations only — no buy/sell advice. No word limit. Do NOT invent data not present in the inputs. Return only the briefing text.`;

// Stage 3 — the primary model does a final review and produces what gets emailed.
const OBSERVATION_FINAL_SYSTEM_PROMPT = `You are the lead analyst producing the final version of a portfolio observation that will be emailed to the owner. You have the source data, the original draft, and a reviewer's revised version.

Produce the FINAL briefing:
- Merge the strongest, best-evidenced observations from both versions.
- Verify every number against the source data; drop or correct anything that doesn't match.
- Ensure every news citation names its source headline explicitly.
- Ensure all five ## sections are present and substantive.
- No word limit — cover the portfolio comprehensively.
- Observations only — no buy/sell recommendations.
- Return ONLY the final briefing text, ready to send.`;

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

// Deterministic report used only when the AI pipeline is unavailable, so the
// owner always receives something rather than silence.
function buildFallbackReport({ portfolio, priceData, newsItems, nasdaqPct, soxPct, asxPct }) {
  const movers = priceData
    .filter((p) => p.dayChangePct != null && Math.abs(p.dayChangePct) >= 2)
    .sort((a, b) => Math.abs(b.dayChangePct) - Math.abs(a.dayChangePct));
  const moverLines = movers.length
    ? movers.map((p) => `- **${p.symbol}** (${p.exchange}): ${p.dayChangePct >= 0 ? '+' : ''}${p.dayChangePct}%`).join('\n')
    : '- No holding moved more than 2% on the latest data.';
  const news = newsItems.slice(0, 6);
  const newsLines = news.length
    ? news.map((n) => `- ${n.symbol === 'SECTOR' ? '[Sector] ' : `[${n.symbol}] `}${n.title}`).join('\n')
    : '- No relevant news collected.';
  return [
    '_AI narrative was unavailable on this run — automated data-only summary._',
    '',
    '## Portfolio Movement',
    moverLines,
    '',
    '## Sector Pulse',
    `- Nasdaq ${pctOrNa(nasdaqPct)} · SOX ${pctOrNa(soxPct)} · ASX 200 ${pctOrNa(asxPct)}`,
    '',
    '## News That Matters',
    newsLines,
    '',
    '## Watch List',
    '- AI analysis unavailable — review the movers and news above manually.',
    '',
    '## One Liner',
    `- Holdings value ${portfolio.holdingsValueAud} AUD across ${portfolio.holdings.length} positions; ${movers.length} moved >2%.`,
  ].join('\n');
}

function buildObservationPrompt({ portfolio, priceData, newsItems, nasdaqPct, soxPct, asxPct }) {
  return [
    '## Portfolio',
    JSON.stringify(portfolio, null, 2),
    '',
    "## Today's Price Data",
    JSON.stringify(priceData, null, 2),
    '',
    '## Recent News (last 24 hours)',
    JSON.stringify(newsItems, null, 2),
    '',
    '## Market Context',
    `- Nasdaq change today: ${pctOrNa(nasdaqPct)}`,
    `- SOX (semiconductor index) change today: ${pctOrNa(soxPct)}`,
    `- ASX 200 change today: ${pctOrNa(asxPct)}`,
  ].join('\n');
}

// Convert inline markdown (**bold**, *italic*) to HTML.
// escapeHtml first so raw text is safe, then apply formatting.
function inlineMd(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
}

// Convert markdown observation text to styled HTML.
function markdownToObservationHtml(text) {
  const lines = text.split('\n');
  const parts = [];
  let inList = false;

  const closeList = () => {
    if (inList) { parts.push('</ul>'); inList = false; }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (trimmed.startsWith('## ')) {
      closeList();
      const heading = inlineMd(trimmed.slice(3));
      parts.push(
        `<h3 style="margin:28px 0 10px;font-size:15px;font-weight:700;color:#1a1a1a;` +
        `border-bottom:2px solid #e8e8e4;padding-bottom:6px;">${heading}</h3>`
      );
    } else if (trimmed.startsWith('### ')) {
      closeList();
      const heading = inlineMd(trimmed.slice(4));
      parts.push(`<h4 style="margin:16px 0 6px;font-size:14px;font-weight:600;color:#333;">${heading}</h4>`);
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (!inList) {
        parts.push('<ul style="margin:4px 0 8px;padding-left:22px;line-height:1.7;">');
        inList = true;
      }
      parts.push(`<li style="margin:2px 0;">${inlineMd(trimmed.slice(2))}</li>`);
    } else if (/^\d+\.\s/.test(trimmed)) {
      closeList();
      parts.push(`<p style="margin:4px 0;line-height:1.7;">${inlineMd(trimmed)}</p>`);
    } else if (trimmed === '') {
      closeList();
    } else if (trimmed.startsWith('_') && trimmed.endsWith('_') && trimmed.length > 2) {
      closeList();
      parts.push(
        `<p style="color:#888;font-size:12px;font-style:italic;margin:8px 0;">${escapeHtml(trimmed.slice(1, -1))}</p>`
      );
    } else {
      closeList();
      parts.push(`<p style="margin:6px 0;line-height:1.7;">${inlineMd(trimmed)}</p>`);
    }
  }
  closeList();
  return parts.join('\n');
}

// Build a grouped sources section from newsItems.
function buildSourcesHtml(newsItems) {
  if (!newsItems || !newsItems.length) return '';
  const bySymbol = {};
  for (const n of newsItems) {
    const key = n.symbol === 'SECTOR' ? 'Market / Sector' : `${n.symbol} (${n.exchange || ''})`;
    if (!bySymbol[key]) bySymbol[key] = [];
    bySymbol[key].push(n.title);
  }
  const rows = Object.entries(bySymbol).map(([label, titles]) => {
    const items = titles.map((t) => `<li style="margin:2px 0;color:#555;">${escapeHtml(t)}</li>`).join('');
    return `
      <tr>
        <td style="padding:8px 12px;vertical-align:top;font-weight:600;font-size:13px;white-space:nowrap;color:#333;">${escapeHtml(label)}</td>
        <td style="padding:8px 12px;"><ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.6;">${items}</ul></td>
      </tr>`;
  }).join('');
  return `
    <div style="margin-top:32px;border-top:1px solid #e8e8e4;padding-top:16px;">
      <h3 style="margin:0 0 10px;font-size:13px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.06em;">
        Sources collected
      </h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        ${rows}
      </table>
    </div>`;
}

function observationHtml(text, { nasdaqPct, soxPct, asxPct, today, newsItems }) {
  const indexRow = [
    nasdaqPct != null ? `Nasdaq <strong style="color:${nasdaqPct >= 0 ? '#16a34a' : '#dc2626'}">${nasdaqPct >= 0 ? '+' : ''}${nasdaqPct}%</strong>` : 'Nasdaq —',
    soxPct   != null ? `SOX <strong style="color:${soxPct   >= 0 ? '#16a34a' : '#dc2626'}">${soxPct   >= 0 ? '+' : ''}${soxPct}%</strong>`   : 'SOX —',
    asxPct   != null ? `ASX 200 <strong style="color:${asxPct >= 0 ? '#16a34a' : '#dc2626'}">${asxPct >= 0 ? '+' : ''}${asxPct}%</strong>`  : 'ASX 200 —',
  ].join(' &nbsp;·&nbsp; ');

  return `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:680px;color:#1a1a1a;">

  <!-- Header -->
  <div style="border-bottom:3px solid #1a1a1a;padding-bottom:12px;margin-bottom:4px;">
    <h1 style="margin:0;font-size:22px;font-weight:700;">Portfolio Observation</h1>
    <p style="margin:4px 0 0;font-size:13px;color:#888;">${today}</p>
  </div>

  <!-- Index bar -->
  <div style="background:#f9f9f7;padding:10px 14px;margin:12px 0 20px;border-radius:6px;font-size:13px;">
    ${indexRow}
  </div>

  <!-- Body -->
  <div style="font-size:14px;line-height:1.6;">
    ${markdownToObservationHtml(text)}
  </div>

  ${buildSourcesHtml(newsItems)}

  <p style="margin-top:24px;font-size:11px;color:#bbb;border-top:1px solid #e8e8e4;padding-top:12px;">
    Observations only — not financial advice.
  </p>
</div>`;

async function generateObservation(userId) {
  const tz = await getWorkspaceTimezone();
  const today = getDateInTz(tz);

  const dash = await sharesPortfolio.buildDashboard(userId);
  if (!dash.positions.length) return { skipped: true, reason: 'No holdings' };

  const holdingsValue = dash.holdingsValueAud || 0;

  const portfolio = {
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

  const priceData = dash.positions.map((p) => ({
    symbol: p.symbol,
    exchange: p.exchange,
    priceAud: p.priceAud != null ? round2(p.priceAud) : null,
    previousCloseAud: p.previousCloseAud != null ? round2(p.previousCloseAud) : null,
    dayChangePct: p.dayChangePct != null ? round2(p.dayChangePct) : null,
  }));

  // News per holding (top holdings by value to keep the prompt bounded) + sector news.
  const ranked = [...dash.positions]
    .filter((p) => p.valueAud != null)
    .sort((a, b) => (b.valueAud || 0) - (a.valueAud || 0))
    .slice(0, 12);
  const newsItems = [];
  await Promise.all(
    ranked.map(async (p) => {
      const news = await fetchHoldingNews(p.symbol, p.exchange);
      news.slice(0, 3).forEach((n) =>
        newsItems.push({ symbol: p.symbol, exchange: p.exchange, title: n.title, snippet: (n.snippet || '').slice(0, 160) })
      );
    })
  );
  const sectorNews = await webSearch('AI semiconductor chip stocks Nvidia AMD Broadcom news today');
  sectorNews.slice(0, 4).forEach((n) =>
    newsItems.push({ symbol: 'SECTOR', title: n.title, snippet: (n.snippet || '').slice(0, 160) })
  );

  const [nasdaqPct, soxPct, asxPct] = await Promise.all([
    fetchIndexPct(INDEX_PROXIES.nasdaq),
    fetchIndexPct(INDEX_PROXIES.sox),
    fetchIndexPct(INDEX_PROXIES.asx),
  ]);

  const userPrompt = buildObservationPrompt({ portfolio, priceData, newsItems, nasdaqPct, soxPct, asxPct });

  const tiers = await getModelsForUser(userId);
  const primaryModel = tiers.standard || tiers.light || tiers.gemini;
  if (!primaryModel) throw new Error('No model configured for user — check vault_models in Settings');
  const secondaryModel = pickSecondaryModel(tiers, primaryModel);

  // Stage 1 — primary draft (fail-open: a data-only fallback is emailed if it fails).
  let draft = '';
  try {
    const draftRes = await callModel(primaryModel, userPrompt, {
      maxTokens: 2500,
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
    text = buildFallbackReport({ portfolio, priceData, newsItems, nasdaqPct, soxPct, asxPct });
  } else {
    // Stage 2 — secondary model reflects/augments (fail-open: keep the draft on error).
    let revised = draft;
    try {
      const revRes = await callModel(secondaryModel, buildReflectionPrompt(userPrompt, draft), {
        maxTokens: 2800,
        system: OBSERVATION_REVIEW_SYSTEM_PROMPT,
        returnUsage: true,
      });
      logUsage({ userId, model: secondaryModel, inputTokens: revRes.inputTokens, outputTokens: revRes.outputTokens, feature: 'shares_observation_review' });
      const t = (revRes.text || '').trim();
      if (t) revised = t;
    } catch (err) {
      console.warn(`[sharesNews] observation secondary pass failed for user ${userId}:`, err.message);
    }

    // Stage 3 — primary model final review (fail-open: keep the revised text on error).
    text = revised;
    try {
      const finRes = await callModel(primaryModel, buildFinalPrompt(userPrompt, draft, revised), {
        maxTokens: 2500,
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
    [userId, today, text, JSON.stringify({ nasdaqPct, soxPct, asxPct, holdings: priceData.length, newsCount: newsItems.length, aiUnavailable })]
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
        subject: `Portfolio observation — ${today}`,
        html: observationHtml(text, { nasdaqPct, soxPct, asxPct, today, newsItems }),
      });
      emailed = true;
    }
  } catch (err) {
    console.warn(`[sharesNews] observation email failed for user ${userId}:`, err.message);
  }

  console.log(`[sharesNews] Generated observation for user ${userId} on ${today} (emailed: ${emailed}, aiUnavailable: ${aiUnavailable})`);
  return { date: today, text, emailed, aiUnavailable, context: { nasdaqPct, soxPct, asxPct } };
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
