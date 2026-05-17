'use strict';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

function getToken() {
  return process.env.FINNHUB_API_KEY || '';
}

async function finnhubGet(path, params = {}) {
  const token = getToken();
  if (!token) {
    const err = new Error('FINNHUB_API_KEY is not configured');
    err.code = 'NO_API_KEY';
    throw err;
  }
  const qs = new URLSearchParams({ ...params, token });
  const url = `${FINNHUB_BASE}${path}?${qs}`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error(`Finnhub ${path} failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** ASX: CBA → CBA.AX; NYSE: AAPL as-is */
function toFinnhubSymbol(symbol, exchange) {
  const s = String(symbol || '').trim().toUpperCase();
  if (!s) return '';
  if (exchange === 'ASX') {
    if (s.endsWith('.AX')) return s;
    return `${s.replace(/\.AX$/i, '')}.AX`;
  }
  return s.replace(/\.AX$/i, '');
}

/** @returns {{ current: number, previousClose: number, currency: 'AUD'|'USD' }} */
async function getQuote(symbol, exchange) {
  const sym = toFinnhubSymbol(symbol, exchange);
  const data = await finnhubGet('/quote', { symbol: sym });
  const current = Number(data.c);
  const previousClose = Number(data.pc);
  if (!current || current <= 0) {
    const err = new Error(`No quote for ${sym}`);
    err.code = 'NO_QUOTE';
    throw err;
  }
  const currency = exchange === 'NYSE' ? 'USD' : 'AUD';
  return { symbol: sym, current, previousClose, currency };
}

let usdAudCache = { rate: null, at: 0 };
const FX_CACHE_MS = 5 * 60 * 1000;

/** AUD per 1 USD */
async function getUsdToAudRate() {
  if (usdAudCache.rate && Date.now() - usdAudCache.at < FX_CACHE_MS) {
    return usdAudCache.rate;
  }
  try {
    const data = await finnhubGet('/forex/rates', { base: 'USD' });
    const aud = data?.quote?.AUD;
    if (aud && Number(aud) > 0) {
      usdAudCache = { rate: Number(aud), at: Date.now() };
      return usdAudCache.rate;
    }
  } catch {
    /* fallback below */
  }
  const q = await finnhubGet('/quote', { symbol: 'OANDA:USDAUD' });
  const rate = Number(q.c);
  if (rate > 0) {
    usdAudCache = { rate, at: Date.now() };
    return rate;
  }
  throw new Error('Could not fetch USD/AUD rate');
}

function priceToAud(price, currency, usdAud) {
  if (currency === 'AUD') return price;
  return price * usdAud;
}

function isConfigured() {
  return Boolean(getToken());
}

module.exports = {
  getQuote,
  getUsdToAudRate,
  priceToAud,
  toFinnhubSymbol,
  isConfigured,
};
