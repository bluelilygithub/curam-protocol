import React, { useState } from 'react';
import Tooltip from './Tooltip';
import { filterGroups } from '../utils/settingsGroups.mjs';

/**
 * The Settings menu: a list down the left grouped by purpose, a small search box above it, and (on a phone) one dropdown instead.
 * `groups` comes from `visibleGroups()` so a member never sees an admin section. Selecting is the page's job (`onSelect`).
 */
export default function SettingsNav({ groups, active, onSelect }) {
  const [query, setQuery] = useState('');
  const shown = filterGroups(groups, query);
  const searching = query.trim() !== '';
  const showSearch = groups.reduce((n, g) => n + g.tabs.length, 0) > 6;

  return (
    <nav aria-label="Settings sections" data-testid="settings-nav">
      {/* phone: one dropdown, the same sections */}
      <div className="sm:hidden" style={{ marginBottom: 20 }}>
        <label htmlFor="settings-section" className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Settings section</label>
        <select
          id="settings-section"
          value={active}
          onChange={(e) => onSelect(e.target.value)}
          className="w-full rounded-lg px-3 py-2 text-sm"
          style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
          data-testid="settings-nav-select"
        >
          {groups.map((g) => (
            <optgroup key={g.id} label={g.label}>
              {g.tabs.map((t) => <option key={t.id} value={t.id}>{t.id}</option>)}
            </optgroup>
          ))}
        </select>
      </div>

      {/* desktop: grouped list that stays in view while the page scrolls */}
      <div className="hidden sm:block" style={{ position: 'sticky', top: 16 }}>
        {showSearch && (
          <Tooltip text="Type a word to narrow the list, for example “feature” or “gmail”.">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a setting…"
              aria-label="Find a settings section"
              className="w-full rounded-lg px-3 py-1.5 text-sm"
              style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', marginBottom: 14 }}
              data-testid="settings-nav-search"
            />
          </Tooltip>
        )}
        {shown.length === 0 && (
          <p className="text-xs" style={{ color: 'var(--color-muted)' }} role="status" data-testid="settings-nav-empty">Nothing matches “{query.trim()}”.</p>
        )}
        {shown.map((g) => (
          <div key={g.id} style={{ marginBottom: 16 }}>
            {groups.length > 1 && (
              <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--color-muted)', padding: '0 10px', marginBottom: 4 }}>{g.label}</div>
            )}
            {g.tabs.map((t) => {
              const on = active === t.id;
              return (
                <Tooltip key={t.id} text={t.tip} side="right">
                  <button
                    type="button"
                    onClick={() => { onSelect(t.id); if (searching) setQuery(''); }}
                    aria-current={on ? 'page' : undefined}
                    className="hover:opacity-70"
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '7px 10px',
                      fontSize: 13,
                      fontWeight: on ? 600 : 400,
                      color: on ? 'var(--color-primary)' : 'var(--color-text)',
                      background: on ? 'var(--color-surface)' : 'none',
                      border: 'none',
                      borderLeft: `2px solid ${on ? 'var(--color-primary)' : 'transparent'}`,
                      borderRadius: 4,
                      cursor: 'pointer',
                      transition: 'opacity 200ms',
                    }}
                    data-testid={`settings-nav-${t.id.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}`}
                  >
                    {t.id}
                  </button>
                </Tooltip>
              );
            })}
          </div>
        ))}
      </div>
    </nav>
  );
}
