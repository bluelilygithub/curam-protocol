'use strict';

/**
 * Market quotes & FX for Shares.
 * Finnhub free tier: US quotes only; /forex/rates and ASX often return 403.
 * Fallbacks: Frankfurter (USD/AUD), Yahoo chart API (ASX + US when Finnhub blocks).
 */

const FINNHUB_BASE = 'https://finnhub.io/api/v1';
const YAHOO_CHART_HOSTS = [
  'https://query1.finance.yahoo.com/v8/finance/chart',
  'https://query2.finance.yahoo.com/v8/finance/chart',
];

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  Accept: 'application/json,text/plain,*/*',
  'Accept-Language': 'en-AU,en;q=0.9',
};

const FETCH_TIMEOUT_MS = 20000;

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

function toStooqSymbol(symbol) {
  const base = String(symbol || '').trim().toUpperCase().replace(/\.AX$/i, '');
  if (!base) return '';
  return `${base.toLowerCase()}.au`;
}

function stooqDateCompact(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

async function fetchText(url, options = {}) {
  let res;
  try {
    res = await fetch(url, {
      ...options,
      headers: { ...BROWSER_HEADERS, ...(options.headers || {}) },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(err.cause?.message || err.message || 'fetch failed');
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
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
  let lastErr;
  for (const host of YAHOO_CHART_HOSTS) {
    try {
      const url = `${host}/${encodeURIComponent(sym)}?interval=1d&range=5d`;
      const text = await fetchText(url);
      const data = JSON.parse(text);
      const meta = data?.chart?.result?.[0]?.meta;
      const current = Number(meta?.regularMarketPrice);
      const previousClose = Number(
        meta?.chartPreviousClose ?? meta?.previousClose ?? meta?.regularMarketPreviousClose
      );
      if (!current || current <= 0) throw new Error(`No price in response`);
      const ex = normalizeExchange(exchange);
      const currency = isUsExchange(ex) ? 'USD' : 'AUD';
      return {
        symbol: sym,
        current,
        previousClose: previousClose > 0 ? previousClose : current,
        currency,
        source: 'yahoo',
      };
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`Yahoo quote failed for ${sym}: ${lastErr?.message || 'unknown'}`);
}

/** Stooq — reliable for ASX from server environments (e.g. Railway) */
async function getStooqAsxQuote(symbol) {
  const stooqSym = toStooqSymbol(symbol);
  const yahooSym = toYahooSymbol(symbol, 'ASX');
  if (!stooqSym) throw new Error('Invalid ASX symbol');

  const now = new Date();
  const d2 = stooqDateCompact(now);
  const d1 = stooqDateCompact(new Date(now.getTime() - 10 * 86400000));
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSym)}&i=d&d1=${d1}&d2=${d2}`;

  const text = await fetchText(url);
  const lines = text.trim().split(/\r?\n/).filter((line) => {
    const t = line.trim();
    return t && !/^date/i.test(t) && !/^symbol/i.test(t);
  });

  if (!lines.length) throw new Error(`No Stooq history for ${stooqSym}`);

  const parseClose = (line) => {
    const cols = line.split(',');
    const close = Number(cols[4] ?? cols[cols.length - 2]);
    return close;
  };

  const current = parseClose(lines[lines.length - 1]);
  const previousClose = lines.length > 1 ? parseClose(lines[lines.length - 2]) : current;

  if (!current || current <= 0) throw new Error(`No Stooq close for ${stooqSym}`);

  return {
    symbol: yahooSym,
    current,
    previousClose: previousClose > 0 ? previousClose : current,
    currency: 'AUD',
    source: 'stooq',
  };
}

async function getAsxQuote(symbol) {
  const errors = [];
  try {
    return await getStooqAsxQuote(symbol);
  } catch (err) {
    errors.push(`Stooq: ${err.message}`);
  }
  try {
    return await getYahooQuote(symbol, 'ASX');
  } catch (err) {
    errors.push(`Yahoo: ${err.message}`);
  }
  throw new Error(errors.join('; '));
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

/** ASX: Stooq → Yahoo. US: Finnhub → Yahoo. Never Finnhub for ASX (free tier 403). */
async function getQuote(symbol, exchange) {
  const ex = normalizeExchange(exchange);
  if (ex === 'ASX') {
    return getAsxQuote(symbol);
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
