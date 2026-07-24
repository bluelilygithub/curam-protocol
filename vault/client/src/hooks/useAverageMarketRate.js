import { useEffect, useRef, useState } from 'react';
import api from '../utils/apiClient';
import { formatNumberForInput } from '../utils/numericInput';

/** Shared across forms so Qualify / Proforma / Calculators / Refinance don't each hit CDR. */
let cachedRate = null;
let cachedMeta = null;
let inflight = null;

/** Matches server FALLBACK_MARKET_RATE_PCT — used so fields are never empty while loading. */
export const FALLBACK_MARKET_RATE_PCT = 6.1;

export function formatMarketRateInput(rate) {
  if (rate == null || !Number.isFinite(Number(rate))) return '';
  return formatNumberForInput(Number(rate), { allowDecimals: true });
}

/** Synchronous initial value for interest-rate inputs (cached live rate or 6.1%). */
export function getInitialMarketRateInput() {
  return formatMarketRateInput(cachedRate ?? FALLBACK_MARKET_RATE_PCT);
}

async function loadAverageMarketRate() {
  if (cachedRate != null) return { rate: cachedRate, meta: cachedMeta };
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await api.get('/api/property-scenario/market-rate');
      const data = await res.json();
      const rate = Number(data?.rate_pct);
      if (Number.isFinite(rate) && rate > 0) {
        cachedRate = Math.round(rate * 100) / 100;
        cachedMeta = {
          source: data.source || null,
          sampleSize: data.sample_size || 0,
          note: data.note || null,
        };
        return { rate: cachedRate, meta: cachedMeta };
      }
    } catch {
      // fall through to static default
    } finally {
      inflight = null;
    }
    cachedRate = FALLBACK_MARKET_RATE_PCT;
    cachedMeta = { source: 'fallback', sampleSize: 0, note: 'Using static fallback rate.' };
    return { rate: cachedRate, meta: cachedMeta };
  })();

  return inflight;
}

/**
 * Live (or fallback) average AU owner-occupier variable mortgage rate for form defaults.
 * Always resolves to a number — never leaves callers waiting on null.
 * @returns {{ rate: number|null, meta: object|null, loading: boolean, formatted: string }}
 */
export function useAverageMarketRate() {
  const [rate, setRate] = useState(() => cachedRate ?? FALLBACK_MARKET_RATE_PCT);
  const [meta, setMeta] = useState(cachedMeta);
  const [loading, setLoading] = useState(cachedRate == null);

  useEffect(() => {
    let cancelled = false;
    if (cachedRate != null) {
      setRate(cachedRate);
      setMeta(cachedMeta);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    loadAverageMarketRate().then(({ rate: next, meta: nextMeta }) => {
      if (cancelled) return;
      setRate(next ?? FALLBACK_MARKET_RATE_PCT);
      setMeta(nextMeta);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const resolved = rate ?? FALLBACK_MARKET_RATE_PCT;
  return {
    rate: resolved,
    meta,
    loading,
    formatted: formatMarketRateInput(resolved),
  };
}

/**
 * Prefill a string state setter with the market average.
 * Starts from cached/fallback immediately; upgrades to live API rate if the user hasn't edited.
 * @param {(updater: string | ((prev: string) => string)) => void} setValue
 * @param {{ skip?: boolean }} [opts] — set skip when a seeded/prefilled value already exists
 */
export function useMarketRateDefault(setValue, { skip = false } = {}) {
  const { rate, meta, loading, formatted } = useAverageMarketRate();
  const autoValueRef = useRef(skip ? null : getInitialMarketRateInput());

  useEffect(() => {
    if (skip) {
      autoValueRef.current = null;
      return;
    }
    const next = formatMarketRateInput(rate ?? FALLBACK_MARKET_RATE_PCT);
    setValue((prev) => {
      // Empty, or still showing our previous auto-default → apply / upgrade
      if (prev === '' || prev == null || prev === autoValueRef.current) {
        autoValueRef.current = next;
        return next;
      }
      return prev;
    });
  }, [rate, setValue, skip]);

  return { rate, meta, loading, formatted };
}

/** True for clarify-form rows that ask for a loan / interest / comparison rate (%). */
export function isInterestRateClarifyField(row) {
  if (!row) return false;
  const path = String(row.field_path || '');
  const leaf = path.replace(/\[\d+\]/g, '').split('.').filter(Boolean).pop() || '';
  if (leaf === 'rate' || leaf === 'comparison_rate') return true;
  const label = `${row.label || ''} ${row.message || ''}`;
  return /interest\s*rate/i.test(label);
}
