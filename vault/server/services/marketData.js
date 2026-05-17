'use strict';

/**
 * Shares market data — Twelve Data API (twelvedata.com, free tier: 800 req/day).
 * Set TWELVE_DATA_API_KEY in Railway environment variables.
 * FX: Frankfurter (no key required).
 */

const TWELVE_DATA_BASE = 'https://api.twelvedata.com';
const FETCH_TIMEOUT_MS = 20000;

function getApiKey() {
  return String(process.env.TWELVE_DATA_API_KEY || '').trim();
}

function canFetchQuotes() {
  return Boolean(getApiKey());
}

function normalizeExchange(exchange) {
  const u = String(exchange || '').toUpperCase();
  if (u === 'NYSE' || u === 'NYE' || u === 'NY') return 'NYSE';
  if (u === 'NASDAQ') return 'NASDAQ';
  return 'ASX';
}

function isUsExchange(ex) {
  return ex === 'NYSE' || ex === 'NASDAQ';
}

/** Strip .AX suffix if present — Twelve Data uses bare symbols with exchange param */
function toTwelveDataSymbol(symbol, exchange) {
  const s = String(symbol || '').trim().toUpperCase();
  const ex = normalizeExchange(exchange);
  if (ex === 'ASX') return s.replace(/\.AX$/i, '');
  return s.replace(/\.AX$/i, '');
}

async function getQuote(symbol, exchange) {
  const key = getApiKey();
  if (!key) throw new Error('TWELVE_DATA_API_KEY not set — add it to Railway environment variables');

  const ex = normalizeExchange(exchange);
  const sym = toTwelveDataSymbol(symbol, ex);

  const params = new URLSearchParams({ symbol: sym, apikey: key });
  if (ex === 'ASX') params.set('exchange', 'ASX');
  // NYSE/NASDAQ: Twelve Data defaults to US markets, no exchange param needed

  const url = `${TWELVE_DATA_BASE}/quote?${params}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`);

  const data = await res.json();

  if (data.status === 'error' || data.code) {
    throw new Error(`Twelve Data: ${data.message || JSON.stringify(data)}`);
  }

  const current = Number(data.close);
  const previousClose = Number(data.previous_close);

  if (!current || current <= 0) throw new Error(`No price returned for ${sym}`);

  const currency = isUsExchange(ex) ? 'USD' : (data.currency || 'AUD');

  return {
    symbol: sym,
    current,
    previousClose: previousClose > 0 ? previousClose : current,
    currency,
    source: 'twelvedata',
  };
}

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
  toTwelveDataSymbol,
  normalizeExchange,
  isUsExchange,
  canFetchQuotes,
};
