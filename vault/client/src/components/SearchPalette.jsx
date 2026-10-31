import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSearch } from '../hooks/useSearch';
import Dialog from './Dialog';
import { useIcon } from '../providers/IconProvider';
import useAuthStore from '../store/authStore';
import api from '../utils/apiClient';
import { getAppsNavGroups, SIDEBAR_WORKSPACE_LINKS } from '../config/appNavigation';
import { SETTINGS_GROUPS, visibleGroups } from '../utils/settingsGroups.mjs';
import {
  actionItems, appItems, settingItems, rankLocal, buildSections, readRecents, rememberChoice, asRecent,
} from '../utils/paletteItems.mjs';

// Command palette. Ctrl/Cmd+K (or the 'vault:open-search' event) opens it. Empty box: recent choices and actions.
// Typing: actions, apps and Settings sections (instant, on this device) plus notes, clients, invoices, projects, files, chats and tasks (from the server).
function SearchPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [flags, setFlags] = useState({});
  const [recents, setRecents] = useState([]);
  const { results, loading, search, clear } = useSearch();
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const navigate = useNavigate();
  const getIcon = useIcon();
  const token = useAuthStore((s) => s.token);
  const isAdmin = !!useAuthStore((s) => s.user?.isAdmin);

  useEffect(() => {
    const toggle = () => setOpen((o) => !o);
    const handler = (e) => {
      if (!token) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && String(e.key).toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', handler);
    document.addEventListener('vault:open-search', toggle);
    return () => {
      document.removeEventListener('keydown', handler);
      document.removeEventListener('vault:open-search', toggle);
    };
  }, [token]);

  useEffect(() => {
    if (open) {
      setRecents(readRecents(window.localStorage));
      api.get('/api/settings/feature-access')
        .then((r) => (r.ok ? r.json() : { flags: {} }))
        .then((d) => setFlags(d.flags || {}))
        .catch(() => {});
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
    setQuery('');
    clear();
    setSelectedIdx(0);
    return undefined;
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    search(query);
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  // What can be reached without asking the server: only what this person may open (same rule as the Apps menu and Settings).
  const localItems = useMemo(() => {
    const canUse = (key) => isAdmin || flags[key] !== false;
    const workspace = { label: 'Workspace', items: SIDEBAR_WORKSPACE_LINKS.filter((l) => !l.featureKey || canUse(l.featureKey)) };
    const apps = appItems([workspace, { label: 'Chat', items: [{ id: 'chat', label: 'Chat', path: '/chat', icon: 'chat' }] }, ...getAppsNavGroups({ canUseFeature: canUse, isAdmin })]);
    return [...actionItems(), ...apps, ...settingItems(visibleGroups(isAdmin, SETTINGS_GROUPS, flags))];
  }, [isAdmin, flags]);

  const q = query.trim();
  const { sections, flat } = useMemo(() => {
    if (!q) return buildSections([...recents.map(asRecent), ...actionItems()]);
    const local = rankLocal(localItems, q);
    const remote = q.length >= 2 ? results : [];
    return buildSections([...local, ...remote]);
  }, [q, recents, localItems, results]);

  useEffect(() => { setSelectedIdx(0); }, [flat.length, q]);

  useEffect(() => {
    listRef.current?.querySelector(`#palette-opt-${selectedIdx}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedIdx]);

  const choose = (item) => {
    if (!item) return;
    rememberChoice(window.localStorage, item);
    setOpen(false);
    if (item.to) navigate(item.to);
    if (item.event) {
      const { name, detail, delay = 0 } = item.event;
      setTimeout(() => document.dispatchEvent(new CustomEvent(name, detail !== undefined ? { detail } : undefined)), delay);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((s) => Math.min(s + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(flat[selectedIdx]);
    }
  };

  if (!open) return null;

  const searching = q.length >= 2 && loading;
  const noMatches = q.length > 0 && flat.length === 0 && !searching;
  let optionIndex = -1;

  return (
    <Dialog bare size="xl" surface="surface" position="top" label="Search and commands" onClose={() => setOpen(false)}>
        <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
          {getIcon('search', { size: 18, style: { color: 'var(--color-muted)', flexShrink: 0 } })}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={flat.length ? `palette-opt-${selectedIdx}` : undefined}
            aria-label="Search notes, clients, invoices, chats and tasks, or type a command"
            placeholder="Search everything, or type a command..."
            autoComplete="off"
            spellCheck={false}
            className="flex-1 bg-transparent outline-none text-sm"
            style={{ color: 'var(--color-text)' }}
          />
          {searching && <span style={{ color: 'var(--color-muted)' }}>{getIcon('loader', { size: 14 })}</span>}
          <kbd className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}>ESC</kbd>
        </div>

        <div id="palette-list" role="listbox" ref={listRef} className="max-h-[60vh] sm:max-h-96 overflow-y-auto">
          {noMatches && (
            <p className="px-4 py-6 text-center text-sm" style={{ color: 'var(--color-muted)' }}>
              Nothing found for "{q}"
            </p>
          )}

          {sections.map((section) => (
            <div key={section.kind} role="group" aria-label={section.label}>
              <div className="px-4 pt-2 pb-1 text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--color-muted)' }}>
                {section.label}
              </div>
              {section.items.map((item) => {
                optionIndex += 1;
                const idx = optionIndex;
                const selected = idx === selectedIdx;
                return (
                  <button
                    key={`${item.kind}:${item.key}`}
                    id={`palette-opt-${idx}`}
                    role="option"
                    aria-selected={selected}
                    tabIndex={-1}
                    onClick={() => choose(item)}
                    onMouseMove={() => { if (!selected) setSelectedIdx(idx); }}
                    className="w-full text-left px-4 py-2.5 min-h-[44px] flex items-start gap-3 transition-colors duration-200"
                    style={{ background: selected ? 'var(--color-bg)' : 'transparent', color: 'var(--color-text)' }}
                  >
                    <span style={{ color: 'var(--color-muted)', flexShrink: 0, marginTop: 2 }}>
                      {getIcon(item.icon || 'file', { size: 14 })}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium truncate">{item.title}</span>
                      {item.subtitle && (
                        <span className="block text-xs mt-0.5 truncate" style={{ color: 'var(--color-muted)' }}>{item.subtitle}</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="hidden sm:flex items-center gap-4 px-4 py-2 border-t text-xs" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
          <span>Up and down to move</span>
          <span>Enter to open</span>
          <span className="ml-auto">{q ? '' : 'Type 2 letters to search notes, clients, invoices and chats'}</span>
        </div>

        <div className="sr-only" role="status" aria-live="polite">
          {searching ? 'Searching' : q ? `${flat.length} results` : ''}
        </div>
    </Dialog>
  );
}

export default SearchPalette;
