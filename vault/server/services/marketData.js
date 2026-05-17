'use strict';

/**
 * Market quotes & FX for Shares.
 * Finnhub free tier: US quotes only; /forex/rates and ASX often return 403.
 * Fallbacks: Frankfurter (USD/AUD), Yahoo chart API (ASX + US when Finnhub blocks).
 */

const FINNHUB_BASE = 'https://finnhub.io/api/v1';
const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';

function getFinnhubToken() {
  return String(process.env.FINNHUB_API_KEY || '').trim();
}

function hasFinnhubKey() {
  return Boolean(getFinnhubToken());
}

function isUsExchange(exchange) {
  return exchange === 'NYSE' || exchange === 'NASDAQ';
}

function normalizeExchange(exchange) {
  const u = String(exchange || '').toUpperCase();
  if (u === 'NYE' || u === 'NY') return 'NYSE';
  if (u === 'ASX') return 'ASX';
  if (u === 'NASDAQ') return 'NASDAQ';
  if (u === 'NYSE') return 'NYSE';
  return 'ASX';
}

function toYahooSymbol(symbol, exchange) {
  const s = String(symbol || '').trim().toUpperCase();
  const ex = normalizeExchange(exchange);
  if (!s) return '';
  if (ex === 'ASX') {
    if (s.endsWith('.AX')) return s;
    return `${s.replace(/\.AX$/i, '')}.AX`;
  }
  return s.replace(/\.AX$/i, '');
}

function toFinnhubSymbol(symbol, exchange) {
  return toYahooSymbol(symbol, exchange);
}

async function finnhubGet(path, params = {}) {
  const token = getFinnhubToken();
  if (!token) {
    const err = new Error('FINNHUB_API_KEY is not configured');
    err.code = 'NO_API_KEY';
    throw err;
  }
  const qs = new URLSearchParams({ ...params, token });
  const url = `${FINNHUB_BASE}${path}?${qs}`;
  const res = await fetch(url);
  const bodyText = await res.text();
  let body;
  try {
    body = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    body = { raw: bodyText };
  }
  if (!res.ok) {
    const msg = body?.error || body?.message || bodyText?.slice(0, 120) || res.statusText;
    const err = new Error(
      res.status === 403
        ? `Finnhub denied access (403) — ${msg}. US symbols work on free tier; ASX/forex often need a paid plan.`
        : `Finnhub ${path} failed (${res.status}): ${msg}`
    );
    err.status = res.status;
    err.code = res.status === 403 ? 'FINNHUB_FORBIDDEN' : 'FINNHUB_ERROR';
    throw err;
  }
  return body;
}

async function getYahooQuote(symbol, exchange) {
  const sym = toYahooSymbol(symbol, exchange);
  const url = `${YAHOO_CHART}/${encodeURIComponent(sym)}?interval=1d&range=5d`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CuramVault/1.0)' },
  });
  if (!res.ok) {
    throw new Error(`Yahoo quote failed for ${sym} (${res.status})`);
  }
  const data = await res.json();
  const meta = data?.chart?.result?.[0]?.meta;
  const current = Number(meta?.regularMarketPrice);
  const previousClose = Number(
    meta?.chartPreviousClose ?? meta?.previousClose ?? meta?.regularMarketPreviousClose
  );
  if (!current || current <= 0) {
    throw new Error(`No Yahoo quote for ${sym}`);
  }
  const ex = normalizeExchange(exchange);
  const currency = isUsExchange(ex) ? 'USD' : 'AUD';
  return { symbol: sym, current, previousClose: previousClose > 0 ? previousClose : current, currency, source: 'yahoo' };
}

async function getFinnhubQuote(symbol, exchange) {
  const sym = toFinnhubSymbol(symbol, exchange);
  const data = await finnhubGet('/quote', { symbol: sym });
  const current = Number(data.c);
  const previousClose = Number(data.pc);
  if (!current || current <= 0) {
    const err = new Error(`No Finnhub quote for ${sym}`);
    err.code = 'NO_QUOTE';
    throw err;
  }
  const ex = normalizeExchange(exchange);
  const currency = isUsExchange(ex) ? 'USD' : 'AUD';
  return { symbol: sym, current, previousClose, currency, source: 'finnhub' };
}

/** Quote with Finnhub first (US), Yahoo fallback on 403 or for ASX preference */
async function getQuote(symbol, exchange) {
  const ex = normalizeExchange(exchange);
  if (ex === 'ASX') {
    try {
      return await getYahooQuote(symbol, ex);
    } catch (yahooErr) {
      if (!hasFinnhubKey()) throw yahooErr;
      try {
        return await getFinnhubQuote(symbol, ex);
      } catch (fhErr) {
        throw new Error(`${yahooErr.message}; Finnhub: ${fhErr.message}`);
      }
    }
  }
  if (hasFinnhubKey()) {
    try {
      return await getFinnhubQuote(symbol, ex);
    } catch (err) {
      if (err.status === 403 || err.code === 'FINNHUB_FORBIDDEN') {
        return getYahooQuote(symbol, ex);
      }
      throw err;
    }
  }
  return getYahooQuote(symbol, ex);
}

let usdAudCache = { rate: null, at: 0 };
const FX_CACHE_MS = 5 * 60 * 1000;

async function getUsdToAudFromFrankfurter() {
  const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=AUD');
  if (!res.ok) throw new Error(`FX API failed (${res.status})`);
  const data = await res.json();
  const rate = Number(data?.rates?.AUD);
  if (!rate || rate <= 0) throw new Error('Invalid USD/AUD rate from Frankfurter');
  return rate;
}

/** AUD per 1 USD — does not require Finnhub */
async function getUsdToAudRate() {
  if (usdAudCache.rate && Date.now() - usdAudCache.at < FX_CACHE_MS) {
    return usdAudCache.rate;
  }

  const errors = [];
  try {
    const rate = await getUsdToAudFromFrankfurter();
    usdAudCache = { rate, at: Date.now() };
    return rate;
  } catch (e) {
    errors.push(e.message);
  }

  if (hasFinnhubKey()) {
    try {
      const data = await finnhubGet('/forex/rates', { base: 'USD' });
      const aud = data?.quote?.AUD;
      if (aud && Number(aud) > 0) {
        usdAudCache = { rate: Number(aud), at: Date.now() };
        return usdAudCache.rate;
      }
    } catch (e) {
      errors.push(e.message);
    }
    try {
      const q = await finnhubGet('/quote', { symbol: 'OANDA:USDAUD' });
      const rate = Number(q.c);
      if (rate > 0) {
        usdAudCache = { rate, at: Date.now() };
        return rate;
      }
    } catch (e) {
      errors.push(e.message);
    }
  }

  throw new Error(`Could not fetch USD/AUD (${errors.join('; ')})`);
}

function priceToAud(price, currency, usdAud) {
  if (currency === 'AUD') return price;
  return price * usdAud;
}

function isConfigured() {
  return hasFinnhubKey();
}

/** Quotes work without Finnhub (Yahoo + Frankfurter) */
function canFetchQuotes() {
  return true;
}

module.exports = {
  getQuote,
  getUsdToAudRate,
  priceToAud,
  toFinnhubSymbol: toYahooSymbol,
  normalizeExchange,
  isUsExchange,
  isConfigured,
  hasFinnhubKey,
  canFetchQuotes,
};
