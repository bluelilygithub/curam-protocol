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
        const res = await api.get(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setResults(data);
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
