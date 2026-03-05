import { useState, useCallback } from 'react';
import api from '../utils/apiClient';

export function useUrlAttachment() {
  const [urlAttachments, setUrlAttachments] = useState([]);

  const addUrl = useCallback(async (rawUrl) => {
    let url = rawUrl.trim();
    if (!url) return;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    try { new URL(url); } catch { return; }

    // Avoid duplicates
    setUrlAttachments(prev => {
      if (prev.some(u => u.url === url)) return prev;
      return [...prev, { url, title: '', content: '', status: 'fetching' }];
    });

    try {
      const res = await api.post('/api/fetch-url', { url });
      const data = await res.json();
      setUrlAttachments(prev => prev.map(u =>
        u.url === url
          ? { url, title: data.title || url, content: data.content || '', status: data.error ? 'error' : 'ready', error: data.error }
          : u
      ));
    } catch (err) {
      setUrlAttachments(prev => prev.map(u =>
        u.url === url ? { ...u, status: 'error', error: err.message } : u
      ));
    }
  }, []);

  const remove = useCallback((url) => {
    setUrlAttachments(prev => prev.filter(u => u.url !== url));
  }, []);

  const clear = useCallback(() => setUrlAttachments([]), []);

  return { urlAttachments, addUrl, remove, clear };
}
