import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../utils/apiClient';

// Per-Vault-user storage through the existing settings API (GET /api/settings, POST { key, value }).
// Only preferences and short conversion history are stored — never document contents.
export const PREFS_KEY = 'measurements_prefs';
export const HISTORY_KEY = 'measurements_history';
const HISTORY_MAX = 30;

export const DEFAULT_MEASURE_PREFS = {
  group: 'length',
  fromId: 'length.foot',
  toId: 'length.metre',
  cupStandard: 'au', // Australian default
  region: 'imperial', // US vs imperial gallons/pints (Australia/UK = imperial)
  ingredient: 'plain-flour',
  precision: { mode: 'sig', n: 6 },
  tempMode: 'absolute',
  targetSystem: 'metric',
  scanContext: 'general',
};

function parse(raw, fallback) {
  if (!raw) return fallback;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { return fallback; }
}

export function useMeasurementPrefs() {
  const [prefs, setPrefs] = useState(DEFAULT_MEASURE_PREFS);
  const [history, setHistory] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const timers = useRef({});

  useEffect(() => {
    let cancelled = false;
    api.get('/api/settings')
      .then((r) => (r.ok ? r.json() : {}))
      .then((all) => {
        if (cancelled) return;
        const p = parse(all?.[PREFS_KEY], {});
        setPrefs({ ...DEFAULT_MEASURE_PREFS, ...p });
        setHistory(parse(all?.[HISTORY_KEY], []).slice(0, HISTORY_MAX));
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; Object.values(timers.current).forEach(clearTimeout); };
  }, []);

  const save = useCallback((key, value) => {
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => {
      api.post('/api/settings', { key, value: JSON.stringify(value) }).catch(() => {});
    }, 700);
  }, []);

  const update = useCallback((patch) => {
    setPrefs((prev) => {
      const next = { ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) };
      save(PREFS_KEY, next);
      return next;
    });
  }, [save]);

  const addHistory = useCallback((entry) => {
    setHistory((prev) => {
      if (prev[0] && prev[0].text === entry.text) return prev;
      const next = [{ ...entry, t: Date.now() }, ...prev].slice(0, HISTORY_MAX);
      save(HISTORY_KEY, next);
      return next;
    });
  }, [save]);

  const clearHistory = useCallback(() => {
    setHistory([]);
    api.post('/api/settings', { key: HISTORY_KEY, value: '' }).catch(() => {});
  }, []);

  return { prefs, update, history, addHistory, clearHistory, loaded };
}
