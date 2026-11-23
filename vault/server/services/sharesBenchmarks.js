'use strict';

/**
 * Daily closes for the index proxies used as benchmarks (QQQ, SOXX, STW), kept permanently in
 * share_benchmark_closes so beta, volatility and multi-day vs-index comparisons have history.
 * One row per symbol per trading day; a later poll the same day overwrites, so the last poll
 * of the session (the 16:00 ET close for US) is what stays.
 */

const { pool } = require('../db');
const marketData = require('./marketData');

// Same env overrides as INDEX_PROXIES in sharesNewsService / sharesChartData.
const BENCHMARKS = {
  nasdaq: { symbol: String(process.env.OBS_INDEX_NASDAQ || 'QQQ').toUpperCase(), exchange: 'NASDAQ' },
  sox:    { symbol: String(process.env.OBS_INDEX_SOX || 'SOXX').toUpperCase(),   exchange: 'NASDAQ' },
  asx:    { symbol: String(process.env.OBS_INDEX_ASX || 'STW').toUpperCase(),    exchange: 'ASX' },
};

/** Quote → row to store, or null when the quote can't be dated or priced (never guess a day). */
function toCloseRow(proxy, quote, usdAud) {
  if (!quote || !(quote.current > 0) || !quote.tradingDay) return null;
  const currency = quote.currency || 'USD';
  const rate = currency === 'USD' && usdAud > 0 ? usdAud : null;
  const closeAud = currency === 'AUD' ? quote.current : (rate ? quote.current * rate : null);
  return {
    symbol: proxy.symbol,
    tradingDay: quote.tradingDay,
    currency,
    closeNative: quote.current,
    prevCloseNative: quote.previousClose > 0 ? quote.previousClose : null,
    usdAud: rate,
    closeAud,
  };
}

async function recordBenchmarkCloses(keys) {
  const proxies = keys.map((k) => BENCHMARKS[k]).filter((p) => p && marketData.canFetchExchange(p.exchange));
  if (!proxies.length) return [];

  let usdAud = null;
  if (proxies.some((p) => p.exchange !== 'ASX')) {
    try { usdAud = await marketData.getUsdToAudRate(); } catch (err) {
      console.warn('[sharesBenchmarks] FX fetch failed, storing USD only:', err.message);
    }
  }

  const saved = [];
  for (const p of proxies) {
    try {
      const row = toCloseRow(p, await marketData.getQuote(p.symbol, p.exchange), usdAud);
      if (!row) { console.warn(`[sharesBenchmarks] ${p.symbol}: no dated price, skipped`); continue; }
      await pool.query(
        `INSERT INTO share_benchmark_closes
           (symbol, "tradingDay", currency, "closeNative", "prevCloseNative", "usdAud", "closeAud", "recordedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
         ON CONFLICT (symbol, "tradingDay") DO UPDATE SET
           currency=EXCLUDED.currency, "closeNative"=EXCLUDED."closeNative",
           "prevCloseNative"=EXCLUDED."prevCloseNative", "usdAud"=EXCLUDED."usdAud",
           "closeAud"=EXCLUDED."closeAud", "recordedAt"=NOW()`,
        [row.symbol, row.tradingDay, row.currency, row.closeNative, row.prevCloseNative, row.usdAud, row.closeAud]
      );
      saved.push(row);
    } catch (err) {
      console.warn(`[sharesBenchmarks] ${p.symbol} failed:`, err.message);
    }
  }
  return saved;
}

module.exports = { BENCHMARKS, toCloseRow, recordBenchmarkCloses };
