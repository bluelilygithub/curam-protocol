'use strict';

/**
 * Shares market data.
 *
 * US stocks (NYSE / NASDAQ) → Finnhub   (FINNHUB_API_KEY, free tier: 60 req/min, no daily cap)
 * ASX stocks               → Alpha Vantage (ALPHA_VANTAGE_API_KEY, free tier: 25 req/day)
 * USD/AUD rate             → Frankfurter  (no key required)
 */

const FETCH_TIMEOUT_MS = 20000;

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
  return { symbol: sym, current, previousClose: previousClose > 0 ? previousClose : current, currency: 'USD', source: 'finnhub' };
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
  return { symbol: sym, current, previousClose: previousClose > 0 ? previousClose : current, currency: 'AUD', source: 'alphavantage' };
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
  priceToAud,
  normalizeExchange,
  isUsExchange,
  canFetchQuotes,
  canFetchExchange,
};
