import React, { useMemo } from 'react';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { TOOL_GROUPS, TOOL_TIPS, GROUP_TIPS, filterGroups } from './musicTools.mjs';

// Left-hand tool list, laid out like Video Tools' sidebar: title + tour/info buttons, a search box,
// collapsible groups, a hover tip on every item.
export default function MusicSidebar({ tool, onSelect, search, onSearch, openGroup, onOpenGroup, onTour, onInfo }) {
  const getIcon = useIcon();
  const groups = useMemo(() => filterGroups(TOOL_GROUPS, search), [search]);
  const iconBtn = { color: 'var(--color-muted)', lineHeight: 1, background: 'none', border: 'none', padding: 0, cursor: 'pointer' };

  return (
    <aside
      className="w-full sm:w-56 shrink-0 border-b sm:border-b-0 sm:border-r overflow-y-auto p-4 space-y-3"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      data-tour="music-sidebar"
    >
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-bg)', color: 'var(--color-primary)' }}>
          {getIcon('music', { size: 16 })}
        </div>
        <h1 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Music</h1>
        <Tooltip text="Take a short guided tour of this page.">
          <button type="button" aria-label="Take the Music tour" onClick={onTour} className="hover:opacity-60 transition-opacity duration-200" style={iconBtn}>
            {getIcon('compass', { size: 13 })}
          </button>
        </Tooltip>
        <Tooltip text="How Music works.">
          <button type="button" aria-label="How Music works" onClick={onInfo} className="hover:opacity-60 transition-opacity duration-200" style={iconBtn}>
            {getIcon('info', { size: 13 })}
          </button>
        </Tooltip>
      </div>

      <Tooltip text="Filter the tool list below by name or description.">
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search tools…"
          aria-label="Search tools"
          className="w-full px-2.5 py-1.5 rounded-lg border text-xs outline-none"
          style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        />
      </Tooltip>

      {groups.map((group) => (
        <div key={group.id}>
          <Tooltip text={GROUP_TIPS[group.id]} side="right">
            <button
              type="button"
              onClick={() => onOpenGroup(openGroup === group.id ? null : group.id)}
              className="text-xs font-semibold w-full text-left py-1 transition-opacity duration-200 hover:opacity-70"
              style={{ color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              {openGroup === group.id ? '▼' : '▶'} {group.label}
            </button>
          </Tooltip>
          {(openGroup === group.id || search.trim()) && (
            <ul className="pl-2 border-l ml-1 space-y-0.5 mt-1" style={{ borderColor: 'var(--color-border)' }}>
              {group.tools.map((t) => (
                <li key={t.id}>
                  <Tooltip text={TOOL_TIPS[t.id] || t.desc} side="right">
                    <button
                      type="button"
                      onClick={() => onSelect(t.id)}
                      className="w-full text-left px-2 py-1.5 rounded-lg text-xs transition-opacity duration-200 hover:opacity-70"
                      style={{
                        background: tool === t.id ? 'var(--color-bg)' : 'transparent',
                        color: tool === t.id ? 'var(--color-text)' : 'var(--color-muted)',
                        border: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      {t.label}
                    </button>
                  </Tooltip>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {groups.length === 0 && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No tool matches that.</p>}
    </aside>
  );
}
