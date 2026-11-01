import { useState, useCallback } from 'react';

// "Select several" for a list of videos: the set of ticked ids. Tick boxes are always showing (mode stays true), so nothing has to be switched on first. One instance per list.
export default function useSelection() {
    const [ids, setIds] = useState(() => new Set());

  const toggle = useCallback((id) => setIds((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);
  const setAll = useCallback((all) => setIds(new Set(all)), []);
  const clear = useCallback(() => setIds(new Set()), []);
  const stop = clear;

  return { mode: true, start: () => {}, stop, ids, count: ids.size, has: (id) => ids.has(id), toggle, setAll, clear };
}
