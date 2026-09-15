import React, { useEffect, useMemo, useRef, useState } from 'react';
import api from '../../utils/apiClient';
import { loadGoogleFontPreview } from './loadGoogleFontPreview';

let catalogCache = null; // module-level — shared across mounts within this tab session, avoids refetch on every open

async function loadCatalog() {
  if (catalogCache) return catalogCache;
  const res = await api.get('/api/fonts/catalog');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not load font catalog.');
  catalogCache = data;
  return data;
}

const MAX_RESULTS = 30;

/**
 * A visual, always-browsable dropdown over the server-cached, OFL-filtered
 * Google Fonts catalog (see server/services/fontGoogleCatalog.js) — each
 * row is rendered in its OWN typeface (lazily loaded per visible row via
 * loadGoogleFontPreview), not plain text, so you can see what a font
 * looks like before picking it. Opens on focus even with no text typed
 * (browse mode, alphabetical); typing narrows it. Selecting a result just
 * sets the family name — the actual fetch/freeze/license-check still runs
 * for real at load time via the existing fetch/freeze pipeline, unchanged;
 * this is a discovery layer in front of it, not a new source of truth.
 * Free-text entry (not just picking a suggestion) still works, since this
 * cache is a convenience, not authoritative.
 */
export default function FontPicker({ value, onChange, onSelect, placeholder = 'e.g. PT Serif' }) {
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
    if (!catalog) return [];
    const q = value.trim().toLowerCase();
    if (!q) return catalog.families.slice(0, MAX_RESULTS); // browse mode — already alphabetical from cli_catalog.py
    return catalog.families
      .filter((f) => f.family.toLowerCase().includes(q))
      .sort((a, b) => {
        const aStarts = a.family.toLowerCase().startsWith(q) ? 0 : 1;
        const bStarts = b.family.toLowerCase().startsWith(q) ? 0 : 1;
        return aStarts - bStarts || a.family.localeCompare(b.family);
      })
      .slice(0, MAX_RESULTS);
  }, [catalog, value]);

  // Lazily load the actual webfont for every row currently on screen, so each renders in its own face.
  useEffect(() => {
    if (!open) return;
    matches.forEach((f) => loadGoogleFontPreview(f.family));
  }, [open, matches]);

  const select = (family) => {
    onChange(family);
    onSelect?.(family);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value.trim()) {
            onSelect?.(value.trim());
            setOpen(false);
          }
        }}
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
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', maxHeight: 340 }}
        >
          {matches.map((f) => (
            <li key={f.slug}>
              <button
                onClick={() => select(f.family)}
                className="w-full text-left px-3 py-2.5 hover:opacity-70 transition-all duration-200 flex items-center justify-between gap-2"
                style={{ color: 'var(--color-text)', borderBottom: '1px solid var(--color-border)' }}
              >
                <span className="flex flex-col min-w-0">
                  <span className="text-lg leading-tight truncate" style={{ fontFamily: `'${f.family}', sans-serif` }}>
                    {f.family}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{f.family}</span>
                </span>
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
