import { useState, useCallback, useRef } from 'react';
import api from '../utils/apiClient';
import { remoteItems } from '../utils/paletteItems.mjs';

// Command palette search: notes, clients and invoices (/api/search/global), projects / files / chats (/api/search) and tasks, all at once.
// Returns palette items (see utils/paletteItems.mjs). A slow answer to an older query never replaces a newer one.
export function useSearch() {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);
  const runRef = useRef(0);

  const search = useCallback((query) => {
    clearTimeout(timerRef.current);
    const run = ++runRef.current;
    if (!query || query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      const q = encodeURIComponent(query.trim());
      const json = (path, fallback) => api.get(path).then((r) => (r.ok ? r.json() : fallback)).catch(() => fallback);
      const [global, search, tasks] = await Promise.all([
        json(`/api/search/global?q=${q}`, {}),
        json(`/api/search?q=${q}`, []),
        json(`/api/tasks?search=${q}&limit=5`, []),
      ]);
      if (run !== runRef.current) return;
      setResults(remoteItems({
        global: global && typeof global === 'object' ? global : {},
        search: Array.isArray(search) ? search : [],
        tasks: Array.isArray(tasks) ? tasks : [],
      }));
      setLoading(false);
    }, 250);
  }, []);

  const clear = useCallback(() => {
    clearTimeout(timerRef.current);
    runRef.current += 1;
    setResults([]);
    setLoading(false);
  }, []);

  return { results, loading, search, clear };
}
