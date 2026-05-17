'use strict';

/**
 * Shares market data.
 * Quotes: Yahoo Finance chart API (same data source as Python yfinance).
 * The Origin + Referer headers are required — without them Railway gets blocked.
 * FX: Frankfurter (no key needed).
 */

const YAHOO_HOSTS = [
  'https://query2.finance.yahoo.com/v8/finance/chart',
  'https://query1.finance.yahoo.com/v8/finance/chart',
];

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  Accept: 'application/json,text/plain,*/*',
  'Accept-Language': 'en-AU,en;q=0.9',
  Origin: 'https://finance.yahoo.com',
  Referer: 'https://finance.yahoo.com/',
};

const FETCH_TIMEOUT_MS = 20000;

function normalizeExchange(exchange) {
  const u = String(exchange || '').toUpperCase();
  if (u === 'NYSE' || u === 'NYE' || u === 'NY') return 'NYSE';
  if (u === 'NASDAQ') return 'NASDAQ';
  return 'ASX';
}

function isUsExchange(ex) {
  return ex === 'NYSE' || ex === 'NASDAQ';
}

/** Yahoo/yfinance symbol: COH → COH.AX for ASX, AAPL stays AAPL */
function toYahooSymbol(symbol, exchange) {
  const s = String(symbol || '').trim().toUpperCase();
  const ex = normalizeExchange(exchange);
  if (!s) return '';
  if (ex === 'ASX') {
    return s.endsWith('.AX') ? s : `${s.replace(/\.AX$/i, '')}.AX`;
  }
  return s.replace(/\.AX$/i, '');
}

async function getQuote(symbol, exchange) {
  const ex = normalizeExchange(exchange);
  const sym = toYahooSymbol(symbol, ex);
  let lastErr;

  for (const host of YAHOO_HOSTS) {
    try {
      const url = `${host}/${encodeURIComponent(sym)}?interval=1d&range=1mo`;
      const res = await fetch(url, {
        headers: YAHOO_HEADERS,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Yahoo returned ${res.status}`);

      const data = await res.json();
      const result = data?.chart?.result?.[0];
      if (!result) throw new Error('empty chart result');

      const meta = result.meta || {};
      let current = Number(meta.regularMarketPrice);
      let previousClose = Number(
        meta.chartPreviousClose ?? meta.previousClose ?? meta.regularMarketPreviousClose
      );

      if (!current || current <= 0) {
        const closes = result.indicators?.quote?.[0]?.close?.filter(Boolean) ?? [];
        if (closes.length) {
          current = Number(closes[closes.length - 1]);
          previousClose = closes.length > 1 ? Number(closes[closes.length - 2]) : current;
        }
      }

      if (!current || current <= 0) throw new Error('no price in response');

      const currency = isUsExchange(ex) ? 'USD' : (meta.currency || 'AUD');

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
