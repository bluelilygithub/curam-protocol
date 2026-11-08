import { useCallback, useEffect, useState } from 'react';
import api from '../../utils/apiClient';

/** The styles, pen colours and shapes Sketchbook offers (from the server, so the page and the rules cannot drift apart). */
export function useSketchOptions() {
  const [options, setOptions] = useState(null);
  useEffect(() => {
    let live = true;
    api.get('/api/sketchbook/options').then((r) => r.json()).then((d) => { if (live && d && d.styles) setOptions(d); }).catch(() => {});
    return () => { live = false; };
  }, []);
  return options;
}

/** What one picture (kind 'draw') or one change (kind 'change') costs and how much of today's image limit is left. Call refresh() after spending. */
export function useSketchCost(kind) {
  const [cost, setCost] = useState(null);
  const refresh = useCallback(() => {
    api.get(`/api/sketchbook/cost?kind=${kind}`).then((r) => r.json()).then((d) => { if (d && 'usd' in d) setCost(d); }).catch(() => {});
  }, [kind]);
  useEffect(() => { refresh(); }, [refresh]);
  return [cost, refresh];
}
