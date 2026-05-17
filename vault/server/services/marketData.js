'use strict';

/**
 * Shares market data — Yahoo Finance chart API (same source as Python yfinance)
 * plus Stooq fallback for ASX when Yahoo is blocked. FX via Frankfurter.
 */

const YAHOO_CHART_HOSTS = [
  'https://query1.finance.yahoo.com/v8/finance/chart',
  'https://query2.finance.yahoo.com/v8/finance/chart',
];

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  Accept: 'application/json,text/plain,*/*',
  'Accept-Language': 'en-AU,en;q=0.9',
  Referer: 'https://finance.yahoo.com/',
};

const FETCH_TIMEOUT_MS = 20000;

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

/** Yahoo / yfinance symbol: CBA → CBA.AX for ASX */
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

async function fetchText(url) {
  let res;
  try {
    res = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(err.cause?.message || err.message || 'fetch failed');
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Yahoo chart API — equivalent to yf.Ticker("BHP.AX").history() price data */
async function getYahooChartQuote(symbol, exchange) {
  const sym = toYahooSymbol(symbol, exchange);
  const ex = normalizeExchange(exchange);
  let lastErr;

  for (const host of YAHOO_CHART_HOSTS) {
    try {
      const url = `${host}/${encodeURIComponent(sym)}?interval=1d&range=1mo`;
      const text = await fetchText(url);
      const data = JSON.parse(text);
      const result = data?.chart?.result?.[0];
      if (!result) throw new Error('empty chart result');

      const meta = result.meta || {};
      let current = Number(meta.regularMarketPrice);
      let previousClose = Number(
        meta.chartPreviousClose ?? meta.previousClose ?? meta.regularMarketPreviousClose
      );

      if (!current || current <= 0) {
        const closes = result.indicators?.quote?.[0]?.close?.filter((c) => c != null) || [];
        if (closes.length) {
          current = Number(closes[closes.length - 1]);
          previousClose = closes.length > 1 ? Number(closes[closes.length - 2]) : current;
        }
      }

      if (!current || current <= 0) throw new Error('no price in chart');

      const currency = meta.currency === 'USD' || isUsExchange(ex)
        ? 'USD'
        : 'AUD';

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

  throw new Error(`Yahoo chart failed for ${sym}: ${lastErr?.message || 'unknown'}`);
}

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

  if (!lines.length) throw new Error(`No Stooq data for ${stooqSym}`);

  const parseClose = (line) => Number(line.split(',')[4]);
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
    return await getYahooChartQuote(symbol, 'ASX');
  } catch (err) {
    errors.push(`Yahoo: ${err.message}`);
  }
  try {
    return await getStooqAsxQuote(symbol);
  } catch (err) {
    errors.push(`Stooq: ${err.message}`);
  }
  throw new Error(errors.join('; '));
}

async function getQuote(symbol, exchange) {
  const ex = normalizeExchange(exchange);
  if (ex === 'ASX') return getAsxQuote(symbol);
  return getYahooChartQuote(symbol, ex);
}

let usdAudCache = { rate: null, at: 0 };
const FX_CACHE_MS = 5 * 60 * 1000;

async function getUsdToAudFromFrankfurter() {
  const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=AUD', {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`FX API failed (${res.status})`);
  const data = await res.json();
  const rate = Number(data?.rates?.AUD);
  if (!rate || rate <= 0) throw new Error('Invalid USD/AUD rate');
  return rate;
}

async function getUsdToAudRate() {
  if (usdAudCache.rate && Date.now() - usdAudCache.at < FX_CACHE_MS) {
    return usdAudCache.rate;
  }
  const rate = await getUsdToAudFromFrankfurter();
  usdAudCache = { rate, at: Date.now() };
  return rate;
}

function priceToAud(price, currency, usdAud) {
  if (currency === 'AUD') return price;
  return price * usdAud;
}

function canFetchQuotes() {
  return true;
}

module.exports = {
  getQuote,
  getUsdToAudRate,
  priceToAud,
  toYahooSymbol,
  normalizeExchange,
  isUsExchange,
  canFetchQuotes,
};
