import { useEffect, useRef, useState } from 'react';
import api from '../utils/apiClient';
import { formatNumberForInput } from '../utils/numericInput';

/** Shared across forms so Qualify / Proforma / Calculators / Refinance don't each hit CDR. */
let cachedRate = null;
let cachedMeta = null;
let inflight = null;

export function formatMarketRateInput(rate) {
  if (rate == null || !Number.isFinite(Number(rate))) return '';
  return formatNumberForInput(Number(rate), { allowDecimals: true });
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
      // leave null — forms keep empty until user types
    } finally {
      inflight = null;
    }
    return { rate: null, meta: null };
  })();

  return inflight;
}

/**
 * Live (or fallback) average AU owner-occupier variable mortgage rate for form defaults.
 * @returns {{ rate: number|null, meta: object|null, loading: boolean, formatted: string }}
 */
export function useAverageMarketRate() {
  const [rate, setRate] = useState(cachedRate);
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
      setRate(next);
      setMeta(nextMeta);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  return {
    rate,
    meta,
    loading,
    formatted: formatMarketRateInput(rate),
  };
}

/**
 * Prefill a string state setter once with the market average when the field is still empty.
 * @param {(updater: string | ((prev: string) => string)) => void} setValue
 * @param {{ skip?: boolean }} [opts] — set skip when a seeded/prefilled value already exists
 */
export function useMarketRateDefault(setValue, { skip = false } = {}) {
  const { rate, meta, loading, formatted } = useAverageMarketRate();
  const applied = useRef(skip);

  useEffect(() => {
    if (skip) applied.current = true;
  }, [skip]);

  useEffect(() => {
    if (applied.current || rate == null) return;
    applied.current = true;
    setValue((prev) => (prev === '' || prev == null ? formatMarketRateInput(rate) : prev));
  }, [rate, setValue]);

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
