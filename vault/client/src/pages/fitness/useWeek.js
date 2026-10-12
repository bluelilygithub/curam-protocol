import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../utils/apiClient';

export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const SLOTS = [
  { id: 'morning', label: 'Morning', icon: 'sunrise' },
  { id: 'midday', label: 'Midday', icon: 'sun' },
  { id: 'evening', label: 'Evening', icon: 'sunset' },
];

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function dayLabel(weekStart, dayIndex) {
  const [y, m, d] = addDays(weekStart, dayIndex).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/**
 * Loads the week at `offset` (-1 last week, 0 this week, 1 next week). A week that does not exist yet is created
 * automatically when it is this week or next; past weeks are only shown if they exist. Mutations return the whole week.
 */
export default function useWeek(offset = 0) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const base = useRef(null);
  const seq = useRef(0);

  const startFor = (off) => (base.current ? addDays(base.current, 7 * off) : undefined);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setError('');
    try {
      let d;
      if (!base.current) {
        const r0 = await api.get('/api/fitness/week');
        const d0 = await r0.json();
        if (!r0.ok) throw new Error(d0.error || 'Could not load your week');
        base.current = d0.currentWeekStart || d0.weekStart;
        if (offset === 0) d = d0;
      }
      const start = startFor(offset);
      if (!d) {
        const r = await api.get(`/api/fitness/week?start=${start}`);
        d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Could not load your week');
      }
      if (!d.exists && d.canGenerate) {
        const r = await api.post('/api/fitness/week/generate', { start });
        d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Could not put your week together');
      }
      if (mine === seq.current) setData(d);
    } catch (err) {
      if (mine === seq.current) setError(err.message);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [offset]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const mutate = useCallback(async (fn) => {
    setBusy(true);
    setError('');
    try {
      const r = await fn();
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'That did not work');
      setData(d);
      return d;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    data, loading, busy, error, reload: load,
    move: (id, day, slot) => mutate(() => api.patch(`/api/fitness/sessions/${id}`, { day, slot })),
    rest: (day) => mutate(() => api.post('/api/fitness/week/rest-day', { weekStart: data.week.weekStart, day })),
    undoRest: (day) => mutate(() => api.post('/api/fitness/week/rest-day/undo', { weekStart: data.week.weekStart, day })),
    regenerate: () => mutate(() => api.post('/api/fitness/week/generate', { start: data.week.weekStart, refresh: true })),
  };
}
