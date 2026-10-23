import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../../utils/apiClient';
import { rangeFor } from './noteGroups.mjs';

const VIEW_KEY = 'vault:notes:view';
const SEARCH_DELAY = 250; // ms after the last keystroke
const PAGE = 100;

function readView() {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}');
    return {
      groupMode: ['date', 'project', 'client', 'tag'].includes(v.groupMode) ? v.groupMode : 'date',
      field: v.field === 'created' ? 'created' : 'updated',
    };
  } catch { return { groupMode: 'date', field: 'updated' }; }
}

/** What a list row holds for a full note (the list never carries the whole text). */
export function toRow(note, extra = {}) {
  const { body, ...rest } = note;
  return { ...rest, preview: String(body ?? note.preview ?? '').slice(0, 240), ...extra };
}

/**
 * The Notes list: filters, search, paging. One request at a time wins (a slow, old answer never replaces a newer one), search waits
 * for a pause in typing, and a saved edit patches its row in place instead of reloading the whole list.
 */
export default function useNotesList({ initialProjectId = '' } = {}) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [preset, setPreset] = useState('all');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [projectId, setProjectId] = useState(String(initialProjectId || ''));
  const [clientId, setClientId] = useState('');
  const [tags, setTags] = useState([]); // the notes must have ALL of these
  const [{ groupMode, field }, setView] = useState(readView);

  const seq = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DELAY);
    return () => clearTimeout(t);
  }, [search]);

  const setGroupMode = useCallback((m) => setView((v) => ({ ...v, groupMode: m })), []);
  const setField = useCallback((f) => setView((v) => ({ ...v, field: f })), []);
  useEffect(() => {
    try { localStorage.setItem(VIEW_KEY, JSON.stringify({ groupMode, field })); } catch { /* private window: it just isn't remembered */ }
  }, [groupMode, field]);

  const tagsKey = tags.join(',');
  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (debouncedSearch) p.set('q', debouncedSearch);
    if (projectId) p.set('project_id', projectId);
    if (clientId) p.set('client_id', clientId);
    if (tags.length) p.set('tags', tags.join(','));
    const r = rangeFor(preset, custom);
    if (r.from) p.set('from', r.from);
    if (r.to) p.set('to', r.to);
    p.set('field', field);
    return p;
    // `preset` 'today'/'7d'... are re-read at the moment of loading, so a tab left open overnight shows the new day on the next change
  }, [debouncedSearch, projectId, clientId, tagsKey, preset, custom.from, custom.to, field]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchPage = useCallback(async (offset) => {
    const mine = ++seq.current;
    const p = new URLSearchParams(query);
    p.set('limit', String(PAGE));
    if (offset) p.set('offset', String(offset));
    const res = await api.get(`/api/notes?${p.toString()}`);
    if (!res.ok) throw new Error('load failed');
    const rows = await res.json();
    return { stale: mine !== seq.current, rows: Array.isArray(rows) ? rows : [], more: res.headers.get('X-Has-More') === '1' };
  }, [query]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { stale, rows, more } = await fetchPage(0);
      if (stale) return;
      setNotes(rows);
      setHasMore(more);
    } catch {
      setError('Your notes could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  useEffect(() => { reload(); }, [reload]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const { stale, rows, more } = await fetchPage(notes.length);
      if (stale) return;
      setNotes((prev) => {
        const have = new Set(prev.map((n) => n.id));
        return [...prev, ...rows.filter((n) => !have.has(n.id))];
      });
      setHasMore(more);
    } catch {
      setError('More notes could not be loaded.');
    } finally {
      setLoadingMore(false);
    }
  }, [fetchPage, hasMore, loadingMore, notes.length]);

  /** Put a saved or new note's row into the list (replace if there, add if not) and keep the list in date order. */
  const patchNote = useCallback((row) => {
    const dateKey = field === 'created' ? 'created_at' : 'updated_at';
    setNotes((prev) => {
      const has = prev.some((n) => n.id === row.id);
      const next = has ? prev.map((n) => (n.id === row.id ? { ...n, ...row } : n)) : [row, ...prev];
      // same order as the server: pinned first (latest pin on top), then by date
      return next.sort((a, b) => (Number(!!b.pinned_at) - Number(!!a.pinned_at))
        || (a.pinned_at && b.pinned_at ? new Date(b.pinned_at) - new Date(a.pinned_at) : 0)
        || (new Date(b[dateKey]) - new Date(a[dateKey])) || (b.id - a.id));
    });
  }, [field]);

  const removeNote = useCallback((id) => setNotes((prev) => prev.filter((n) => n.id !== id)), []);

  // Everything a saved view holds, as it is right now (the search as typed, not as last sent).
  const filters = useMemo(() => ({ search: search.trim(), preset, custom, field, projectId, clientId, tags, groupMode }),
    [search, preset, custom, field, projectId, clientId, tags, groupMode]);

  const applyFilters = useCallback((f) => {
    const text = String(f.search || '');
    setSearch(text);
    setDebouncedSearch(text.trim()); // no waiting for the typing pause: a view should appear at once
    setPreset(f.preset || 'all');
    setCustom({ from: f.custom?.from || '', to: f.custom?.to || '' });
    setProjectId(f.projectId ? String(f.projectId) : '');
    setClientId(f.clientId ? String(f.clientId) : '');
    setTags(Array.isArray(f.tags) ? f.tags : []);
    setView({ groupMode: ['date', 'project', 'client', 'tag'].includes(f.groupMode) ? f.groupMode : 'date', field: f.field === 'created' ? 'created' : 'updated' });
  }, []);

  const filtersActive = !!(debouncedSearch || projectId || clientId || tags.length || preset !== 'all');
  const clearFilters = useCallback(() => {
    setSearch(''); setDebouncedSearch(''); setPreset('all'); setCustom({ from: '', to: '' }); setProjectId(''); setClientId(''); setTags([]);
  }, []);

  return {
    notes, loading, loadingMore, hasMore, error, reload, loadMore, patchNote, removeNote,
    search, setSearch, searching: search.trim() !== debouncedSearch,
    preset, setPreset, custom, setCustom, projectId, setProjectId, clientId, setClientId, tags, setTags,
    groupMode, setGroupMode, field, setField, filtersActive, clearFilters, filters, applyFilters,
  };
}
