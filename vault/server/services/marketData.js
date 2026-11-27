'use strict';

/**
 * Shares market data.
 *
 * US stocks (NYSE / NASDAQ) → Finnhub   (FINNHUB_API_KEY, free tier: 60 req/min, no daily cap)
 * ASX stocks               → Alpha Vantage (ALPHA_VANTAGE_API_KEY, free tier: 25 req/day)
 * USD/AUD rate             → Frankfurter  (no key required)
 */

const FETCH_TIMEOUT_MS = 20000;

function envInt(name, fallback) {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function normalizeExchange(exchange) {
  const u = String(exchange || '').toUpperCase();
  if (u === 'NYSE' || u === 'NYE' || u === 'NY') return 'NYSE';
  if (u === 'NASDAQ') return 'NASDAQ';
  return 'ASX';
}

function isUsExchange(ex) {
  return ex === 'NYSE' || ex === 'NASDAQ';
}

function toUsSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase().replace(/\.AX$/i, '');
}

function toAsxSymbol(symbol) {
  const base = String(symbol || '').trim().toUpperCase().replace(/\.AX$/i, '');
  return `${base}.AX`;
}

// ─── Finnhub (US) ────────────────────────────────────────────────────────────

function getFinnhubToken() {
  return String(process.env.FINNHUB_API_KEY || '').trim();
}

async function getFinnhubQuote(symbol) {
  const token = getFinnhubToken();
  if (!token) throw new Error('FINNHUB_API_KEY not set');
  const sym = toUsSymbol(symbol);
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Finnhub HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`Finnhub: ${data.error}`);
  const current = Number(data.c);
  const previousClose = Number(data.pc);
  if (!current || current <= 0) throw new Error(`Finnhub: no price for ${sym}`);
  // tradingDay: the session the quote belongs to, in New York time (Finnhub `t` is unix seconds).
  const tradingDay = Number(data.t) > 0
    ? new Date(Number(data.t) * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
    : null;
  return { symbol: sym, current, previousClose: previousClose > 0 ? previousClose : current, currency: 'USD', source: 'finnhub', tradingDay };
}

async function getEarningsCalendar(symbol, fromDate, toDate) {
  const token = getFinnhubToken();
  if (!token) return [];
  const sym = toUsSymbol(symbol);
  const from = String(fromDate).slice(0, 10);
  const to = String(toDate).slice(0, 10);
  try {
    const url = `https://finnhub.io/api/v1/calendar/earnings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&symbol=${encodeURIComponent(sym)}&token=${encodeURIComponent(token)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return [];
    const body = await res.json();
    return (body.earningsCalendar || [])
      .filter((e) => String(e.symbol || sym).toUpperCase() === sym)
      .map((e) => ({
        symbol: sym,
        date: String(e.date).slice(0, 10),
        hour: e.hour || null,
        quarter: e.quarter,
        year: e.year,
        epsEstimate: e.epsEstimate != null ? Number(e.epsEstimate) : null,
        source: 'Finnhub',
      }));
  } catch (err) {
    console.warn(`[marketData] earnings calendar ${sym}:`, err.message);
    return [];
  }
}

// Reported figures from Finnhub /stock/metric (free tier, US only). Each entry: label, candidate keys (first present wins), unit.
// Finnhub's metric block gives margins and growth as percentages (69.4 = 69.4%).
const FUNDAMENTAL_FIELDS = [
  ['P/E (TTM)', ['peTTM', 'peBasicExclExtraTTM', 'peExclExtraTTM'], 'x'],
  ['P/S (TTM)', ['psTTM', 'psAnnual'], 'x'],
  ['P/B', ['pbQuarterly', 'pbAnnual'], 'x'],
  ['Gross margin (TTM)', ['grossMarginTTM', 'grossMarginAnnual'], '%'],
  ['Operating margin (TTM)', ['operatingMarginTTM', 'operatingMarginAnnual'], '%'],
  ['Net margin (TTM)', ['netProfitMarginTTM', 'netProfitMarginAnnual'], '%'],
  ['Return on equity (TTM)', ['roeTTM', 'roeRfy'], '%'],
  ['Revenue growth, latest quarter YoY', ['revenueGrowthQuarterlyYoy'], '%'],
  ['Revenue growth (TTM YoY)', ['revenueGrowthTTMYoy'], '%'],
  ['Revenue growth, 5-year', ['revenueGrowth5Y'], '%'],
  ['EPS growth, latest quarter YoY', ['epsGrowthQuarterlyYoy'], '%'],
  ['EPS growth (TTM YoY)', ['epsGrowthTTMYoy'], '%'],
  ['Debt/equity', ['totalDebt/totalEquityQuarterly', 'totalDebt/totalEquityAnnual'], 'x'],
  ['Current ratio', ['currentRatioQuarterly', 'currentRatioAnnual'], 'x'],
  ['Dividend yield', ['dividendYieldIndicatedAnnual', 'currentDividendYieldTTM'], '%'],
  ['Market cap (USD m)', ['marketCapitalization'], 'm'],
];
const TREND_SERIES = [['Gross margin', 'grossMargin'], ['Operating margin', 'operatingMargin'], ['Net margin', 'netMargin']];

/** Finnhub /stock/metric body → { figures:[{label,value,unit}], trends:[{label, points:[{period, pct}]}] }. Pure; missing keys are skipped. */
function parseFinnhubMetrics(body) {
  const m = body?.metric || {};
  const figures = [];
  for (const [label, keys, unit] of FUNDAMENTAL_FIELDS) {
    const key = keys.find((k) => m[k] != null && Number.isFinite(Number(m[k])));
    if (key) figures.push({ label, value: Number(m[key]), unit });
  }
  const q = body?.series?.quarterly || {};
  const trends = [];
  for (const [label, key] of TREND_SERIES) {
    const points = (Array.isArray(q[key]) ? q[key] : [])
      .filter((p) => p?.period && Number.isFinite(Number(p.v)))
      .slice(0, 4) // newest first in Finnhub's series
      // Series margins are fractions (0.69); show them as percentages like the metric block.
      .map((p) => ({ period: String(p.period).slice(0, 10), pct: Math.abs(Number(p.v)) <= 1.5 ? Number(p.v) * 100 : Number(p.v) }));
    if (points.length) trends.push({ label, points });
  }
  // The 1-year high, for the watchlist report's "distance from the peak" bar. Kept out of `figures` so the Thesis pack is unchanged.
  const hi = Number(m['52WeekHigh']);
  return m['52WeekHigh'] != null && Number.isFinite(hi) && hi > 0
    ? { figures, trends, yearHigh: { value: hi, date: m['52WeekHighDate'] ? String(m['52WeekHighDate']).slice(0, 10) : null } }
    : { figures, trends };
}

/** Reported figures for a US share, or null (no key, ASX, or the call failed). Never throws. */
async function getFundamentals(symbol, exchange) {
  const token = getFinnhubToken();
  // shortcut: US only (Finnhub free tier); ASX would need Alpha Vantage OVERVIEW, which shares the 25/day quote budget.
  if (!token || !isUsExchange(normalizeExchange(exchange))) return null;
  const sym = toUsSymbol(symbol);
  try {
    const url = `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(sym)}&metric=all&token=${encodeURIComponent(token)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = parseFinnhubMetrics(await res.json());
    return parsed.figures.length || parsed.trends.length ? { symbol: sym, source: 'Finnhub', ...parsed } : null;
  } catch (err) {
    console.warn(`[marketData] fundamentals ${sym}:`, err.message);
    return null;
  }
}

// ─── Alpha Vantage (ASX) ────────────────────────────────────────────────────

function getAlphaVantageKey() {
  return String(process.env.ALPHA_VANTAGE_API_KEY || '').trim();
}

async function getAlphaVantageQuote(symbol) {
  const key = getAlphaVantageKey();
  if (!key) throw new Error('ALPHA_VANTAGE_API_KEY not set');
  const sym = toAsxSymbol(symbol);
  const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(sym)}&apikey=${encodeURIComponent(key)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Alpha Vantage HTTP ${res.status}`);
  const data = await res.json();
  if (data.Note || data.Information) throw new Error(`Alpha Vantage rate limit: ${data.Note || data.Information}`);
  const gq = data['Global Quote'];
  if (!gq || !gq['05. price']) {
    // Log the raw response to Railway logs so we can diagnose coverage/symbol issues
    console.warn(`[marketData] Alpha Vantage raw response for ${sym}:`, JSON.stringify(data).slice(0, 300));
    throw new Error(`Alpha Vantage: no quote returned for ${sym} (check Railway logs for raw response)`);
  }
  const current = Number(gq['05. price']);
  const previousClose = Number(gq['08. previous close']);
  if (!current || current <= 0) throw new Error(`Alpha Vantage: zero price for ${sym}`);
  const tradingDay = /^\d{4}-\d{2}-\d{2}$/.test(gq['07. latest trading day'] || '') ? gq['07. latest trading day'] : null;
  return { symbol: sym, current, previousClose: previousClose > 0 ? previousClose : current, currency: 'AUD', source: 'alphavantage', tradingDay };
}

// ─── Gold spot (metalpriceapi.com — 100 req/month free tier) ─────────────────
// 12-hour cache = max ~62 calls/month. METAL_PRICE_API_KEY env var required.

let goldSpotCache = { data: null, at: 0 };
const GOLD_CACHE_MS = envInt('GOLD_CACHE_MS', 24 * 60 * 60 * 1000); // default 24 hours

async function getGoldSpotAud({ force = false } = {}) {
  if (!force && goldSpotCache.data && Date.now() - goldSpotCache.at < GOLD_CACHE_MS) {
    return goldSpotCache.data;
  }
  const key = String(process.env.METAL_PRICE_API_KEY || '').trim();
  if (!key) throw new Error('METAL_PRICE_API_KEY not set');
  // base=USD, currencies=XAU → rates.XAU = troy oz per USD → invert for USD/oz
  // Then convert USD→AUD via Frankfurter to avoid ambiguity in XAU-based rates
  const res = await fetch(
    `https://api.metalpriceapi.com/v1/latest?api_key=${encodeURIComponent(key)}&base=USD&currencies=XAU`,
    { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
  );
  if (!res.ok) throw new Error(`metalpriceapi HTTP ${res.status}`);
  const body = await res.json();
  if (!body.success) throw new Error(`metalpriceapi: ${body.error?.message || 'request failed'}`);
  const xauPerUsd = Number(body.rates?.XAU);
  if (!xauPerUsd || xauPerUsd <= 0) {
    console.warn('[marketData] metalpriceapi raw:', JSON.stringify(body).slice(0, 300));
    throw new Error('metalpriceapi: no XAU/USD rate returned');
  }
  const usdPerOz = 1 / xauPerUsd;
  const usdAud = await getUsdToAudRate();
  const audPerOz = usdPerOz * usdAud;
  // body.timestamp = Unix seconds when the rate was last set by the provider (EOD on free tier)
  const priceAt = body.timestamp ? new Date(body.timestamp * 1000).toISOString() : new Date().toISOString();
  const result = { audPerOz, usdPerOz, usdAud, priceAt };
  goldSpotCache = { data: result, at: Date.now() };
  return result;
}

function canFetchGoldSpot() {
  return Boolean(String(process.env.METAL_PRICE_API_KEY || '').trim());
}

// ─── public API ─────────────────────────────────────────────────────────────

async function getQuote(symbol, exchange) {
  const ex = normalizeExchange(exchange);
  if (ex === 'ASX') return getAlphaVantageQuote(symbol);
  return getFinnhubQuote(symbol);
}

function canFetchQuotes() {
  return Boolean(getFinnhubToken()) || Boolean(getAlphaVantageKey());
}

function canFetchExchange(exchange) {
  const ex = normalizeExchange(exchange);
  if (ex === 'ASX') return Boolean(getAlphaVantageKey());
  return Boolean(getFinnhubToken());
}

// ─── FX ──────────────────────────────────────────────────────────────────────

let usdAudCache = { rate: null, at: 0 };
const FX_CACHE_MS = 5 * 60 * 1000;

async function getUsdToAudRate() {
  if (usdAudCache.rate && Date.now() - usdAudCache.at < FX_CACHE_MS) {
    return usdAudCache.rate;
  }
  const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=AUD', {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`FX API failed (${res.status})`);
  const data = await res.json();
  const rate = Number(data?.rates?.AUD);
  if (!rate || rate <= 0) throw new Error('Invalid USD/AUD rate');
  usdAudCache = { rate, at: Date.now() };
  return rate;
}

function priceToAud(price, currency, usdAud) {
  if (currency === 'AUD') return price;
  return price * usdAud;
}

module.exports = {
  getQuote,
  getUsdToAudRate,
  getGoldSpotAud,
  getEarningsCalendar,
  getFundamentals,
  parseFinnhubMetrics,
  priceToAud,
  normalizeExchange,
  isUsExchange,
  canFetchQuotes,
  canFetchExchange,
  canFetchGoldSpot,
};
