import { useEffect, useRef, useState } from 'react';
import api from '../utils/apiClient';
import { formatNumberForInput } from '../utils/numericInput';

/** Module cache so all forms share one /market-rate fetch. */
let cachedRates = { variable: null, fixed: null };
let cachedMeta = null;
let inflight = null;

/** Matches server fallbacks — fields never start empty. */
export const FALLBACK_VARIABLE_RATE_PCT = 6.1;
export const FALLBACK_FIXED_RATE_PCT = 5.5;
/** @deprecated use FALLBACK_VARIABLE_RATE_PCT */
export const FALLBACK_MARKET_RATE_PCT = FALLBACK_VARIABLE_RATE_PCT;

export function normalizeRateType(rateType) {
  return String(rateType || 'variable').toLowerCase() === 'fixed' ? 'fixed' : 'variable';
}

export function fallbackRateForType(rateType) {
  return normalizeRateType(rateType) === 'fixed'
    ? FALLBACK_FIXED_RATE_PCT
    : FALLBACK_VARIABLE_RATE_PCT;
}

export function formatMarketRateInput(rate) {
  if (rate == null || !Number.isFinite(Number(rate))) return '';
  return formatNumberForInput(Number(rate), { allowDecimals: true });
}

/** Synchronous initial value for a given rate type (cached or fallback). */
export function getInitialMarketRateInput(rateType = 'variable') {
  const kind = normalizeRateType(rateType);
  const cached = cachedRates[kind];
  return formatMarketRateInput(cached ?? fallbackRateForType(kind));
}

function resolveRate(kind, apiPayload) {
  const key = kind === 'fixed' ? 'fixed_rate_pct' : 'variable_rate_pct';
  const fromTyped = Number(apiPayload?.[key]);
  if (Number.isFinite(fromTyped) && fromTyped > 0) return Math.round(fromTyped * 100) / 100;
  if (kind === 'variable') {
    const legacy = Number(apiPayload?.rate_pct);
    if (Number.isFinite(legacy) && legacy > 0) return Math.round(legacy * 100) / 100;
  }
  return fallbackRateForType(kind);
}

async function loadAverageMarketRates() {
  if (cachedRates.variable != null && cachedRates.fixed != null) {
    return { rates: { ...cachedRates }, meta: cachedMeta };
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await api.get('/api/property-scenario/market-rate');
      const data = await res.json();
      cachedRates = {
        variable: resolveRate('variable', data),
        fixed: resolveRate('fixed', data),
      };
      cachedMeta = {
        source: data.source || null,
        note: data.note || null,
        variableSampleSize: data.variable_sample_size || data.sample_size || 0,
        fixedSampleSize: data.fixed_sample_size || 0,
      };
      return { rates: { ...cachedRates }, meta: cachedMeta };
    } catch {
      // fall through
    } finally {
      inflight = null;
    }
    cachedRates = {
      variable: FALLBACK_VARIABLE_RATE_PCT,
      fixed: FALLBACK_FIXED_RATE_PCT,
    };
    cachedMeta = { source: 'fallback', note: 'Using static fallback rates.' };
    return { rates: { ...cachedRates }, meta: cachedMeta };
  })();

  return inflight;
}

/**
 * Average AU OO mortgage rate for a rate type (variable|fixed).
 * @param {'variable'|'fixed'} [rateType='variable']
 */
export function useAverageMarketRate(rateType = 'variable') {
  const kind = normalizeRateType(rateType);
  const [rates, setRates] = useState(() => ({
    variable: cachedRates.variable ?? FALLBACK_VARIABLE_RATE_PCT,
    fixed: cachedRates.fixed ?? FALLBACK_FIXED_RATE_PCT,
  }));
  const [meta, setMeta] = useState(cachedMeta);
  const [loading, setLoading] = useState(
    cachedRates.variable == null || cachedRates.fixed == null
  );

  useEffect(() => {
    let cancelled = false;
    if (cachedRates.variable != null && cachedRates.fixed != null) {
      setRates({ ...cachedRates });
      setMeta(cachedMeta);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    loadAverageMarketRates().then(({ rates: next, meta: nextMeta }) => {
      if (cancelled) return;
      setRates(next);
      setMeta(nextMeta);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const rate = rates[kind] ?? fallbackRateForType(kind);
  return {
    rate,
    rates,
    meta,
    loading,
    rateType: kind,
    formatted: formatMarketRateInput(rate),
  };
}

/**
 * Prefill a rate field from the market average for the given rate type.
 * When rateType changes, updates the field if it still holds the previous auto-default.
 *
 * @param {(updater: string | ((prev: string) => string)) => void} setValue
 * @param {{ rateType?: 'variable'|'fixed', skip?: boolean }} [opts]
 */
export function useMarketRateDefault(setValue, { rateType = 'variable', skip = false } = {}) {
  const kind = normalizeRateType(rateType);
  const { rate, rates, meta, loading, formatted } = useAverageMarketRate(kind);
  const autoValueRef = useRef(skip ? null : getInitialMarketRateInput(kind));

  useEffect(() => {
    if (skip) {
      autoValueRef.current = null;
      return;
    }
    const next = formatMarketRateInput(rate ?? fallbackRateForType(kind));
    setValue((prev) => {
      if (prev === '' || prev == null || prev === autoValueRef.current) {
        autoValueRef.current = next;
        return next;
      }
      return prev;
    });
  }, [rate, kind, setValue, skip]);

  return { rate, rates, meta, loading, formatted, rateType: kind };
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

export function isRateTypeClarifyField(row) {
  if (!row) return false;
  const path = String(row.field_path || '');
  const leaf = path.replace(/\[\d+\]/g, '').split('.').filter(Boolean).pop() || '';
  if (leaf === 'fixed_or_variable') return true;
  return /rate\s*type|fixed\s*or\s*variable/i.test(`${row.label || ''} ${row.message || ''}`);
}
