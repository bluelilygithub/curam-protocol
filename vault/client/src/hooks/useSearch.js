import { useState, useCallback, useRef } from 'react';
import api from '../utils/apiClient';

export function useSearch() {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);

  const search = useCallback((query) => {
    clearTimeout(timerRef.current);
    if (!query || query.trim().length < 2) {
      setResults([]);
      return;
    }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const q = encodeURIComponent(query);
        const [searchRes, taskRes] = await Promise.all([
          api.get(`/api/search?q=${q}`).then(r => r.json()).catch(() => []),
          api.get(`/api/tasks?search=${q}&limit=5`).then(r => r.json()).catch(() => []),
        ]);
        const taskResults = Array.isArray(taskRes)
          ? taskRes.map(t => ({ type: 'task', id: t.id, title: t.title, snippet: t.notes ? t.notes.slice(0, 80) : t.status }))
          : [];
        setResults([...(Array.isArray(searchRes) ? searchRes : []), ...taskResults]);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }, []);

  const clear = useCallback(() => {
    clearTimeout(timerRef.current);
    setResults([]);
    setLoading(false);
  }, []);

  return { results, loading, search, clear };
}
