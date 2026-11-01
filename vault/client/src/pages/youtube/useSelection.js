import { useState, useCallback } from 'react';

// "Select several" for a list of videos: a mode switch plus the set of ticked ids. One instance per list.
export default function useSelection() {
  const [mode, setMode] = useState(false);
  const [ids, setIds] = useState(() => new Set());

  const toggle = useCallback((id) => setIds((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);
  const setAll = useCallback((all) => setIds(new Set(all)), []);
  const clear = useCallback(() => setIds(new Set()), []);
  const stop = useCallback(() => { setMode(false); setIds(new Set()); }, []);

  return { mode, start: () => setMode(true), stop, ids, count: ids.size, has: (id) => ids.has(id), toggle, setAll, clear };
}
