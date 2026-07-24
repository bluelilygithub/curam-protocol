import { useEffect, useState } from 'react';
import api from '../utils/apiClient';

/** Shared across forms so Qualify / Proforma / Calculators don't each hit CDR. */
let cachedRate = null;
let cachedMeta = null;
let inflight = null;

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
 * @returns {{ rate: number|null, meta: object|null, loading: boolean }}
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

  return { rate, meta, loading };
}
