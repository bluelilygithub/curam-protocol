import React, { useEffect, useMemo, useRef, useState } from 'react';
import api from '../../utils/apiClient';

let catalogCache = null; // module-level — shared across mounts within this tab session, avoids refetch on every open

async function loadCatalog() {
  if (catalogCache) return catalogCache;
  const res = await api.get('/api/fonts/catalog');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not load font catalog.');
  catalogCache = data;
  return data;
}

const MAX_RESULTS = 20;

/**
 * Search/autocomplete over the server-cached, OFL-filtered Google Fonts
 * catalog (see server/services/fontGoogleCatalog.js). Selecting a result
 * just sets the family name text — the actual fetch/freeze/license-check
 * still runs for real at export time via the existing Phase 1 pipeline,
 * unchanged; this is a discovery layer in front of it, not a new source
 * of truth. Free-text entry (not just picking a suggestion) still works,
 * since this cache is a convenience, not authoritative — a font added to
 * google/fonts after the cache was last built just won't autocomplete.
 */
export default function FontPicker({ value, onChange, placeholder = 'e.g. PT Serif' }) {
  const [catalog, setCatalog] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    loadCatalog().then(setCatalog).catch((err) => setLoadErr(err.message));
  }, []);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const matches = useMemo(() => {
    if (!catalog || !value.trim()) return [];
    const q = value.trim().toLowerCase();
    return catalog.families
      .filter((f) => f.family.toLowerCase().includes(q))
      .sort((a, b) => {
        const aStarts = a.family.toLowerCase().startsWith(q) ? 0 : 1;
        const bStarts = b.family.toLowerCase().startsWith(q) ? 0 : 1;
        return aStarts - bStarts || a.family.localeCompare(b.family);
      })
      .slice(0, MAX_RESULTS);
  }, [catalog, value]);

  const select = (family) => {
    onChange(family);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="w-full rounded px-2 py-1.5 text-sm"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
      />
      {loadErr && (
        <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
          Search unavailable ({loadErr}) — you can still type an exact family name.
        </p>
      )}
      {!catalog && !loadErr && (
        <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Loading font catalog…</p>
      )}
      {open && matches.length > 0 && (
        <ul
          className="absolute z-20 left-0 right-0 mt-1 rounded overflow-y-auto"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', maxHeight: 260 }}
        >
          {matches.map((f) => (
            <li key={f.slug}>
              <button
                onClick={() => select(f.family)}
                className="w-full text-left px-3 py-2 text-sm hover:opacity-70 transition-all duration-200 flex items-center justify-between gap-2"
                style={{ color: 'var(--color-text)' }}
              >
                <span>{f.family}</span>
                <span className="flex items-center gap-1.5 flex-shrink-0">
                  <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{f.category}</span>
                  <span
                    className="text-xs px-1.5 py-0.5 rounded"
                    style={{
                      background: f.isVariable ? 'var(--color-primary)' : 'var(--color-bg)',
                      color: f.isVariable ? '#fff' : 'var(--color-muted)',
                      border: f.isVariable ? 'none' : '1px solid var(--color-border)',
                    }}
                  >
                    {f.isVariable ? 'Variable' : 'Static'}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && catalog && value.trim() && matches.length === 0 && (
        <div className="absolute z-20 left-0 right-0 mt-1 rounded px-3 py-2 text-xs" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
          No OFL match in the cached catalog — you can still try this exact name; the real check runs at export time.
        </div>
      )}
    </div>
  );
}
