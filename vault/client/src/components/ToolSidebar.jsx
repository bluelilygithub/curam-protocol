import React, { useEffect, useRef, useState } from 'react';
import { useIcon } from '../providers/IconProvider';
import Tooltip from './Tooltip';
import { VoiceInput } from './voiceInput/VoiceInput';

/**
 * The left-hand menu used by the tool pages (same look as Graphics and Video Tools): a title with an (i) and optional tour button,
 * a tool search box with a microphone (press / to jump to it, Esc clears it), then the tools in groups that open and close, a hover
 * tip on every group and tool, and the open tool highlighted. Must sit inside a VoiceInputProvider.
 *
 *   groups: [{ label, tip, tools: [{ id, label, icon, tip, hint }] }]
 *   `hint` is a short line shown under the label while the tool is not yet usable (for example "Load a font first").
 *   `children` render between the search box and the groups (a primary action, a status).
 *
 * New tool pages should use this rather than copying the markup (see client/DESIGN.md "Shared components").
 */
export default function ToolSidebar({
  title, icon, groups, current, onSelect, onInfo, infoTip = 'How this works.', onTour, tourTip = 'Take the guided tour.', children,
}) {
  const getIcon = useIcon();
  const [search, setSearch] = useState('');
  const [closed, setClosed] = useState(() => new Set());
  const searchRef = useRef(null);

  // "/" jumps to the search box, Esc clears it (the same keys as Graphics).
  useEffect(() => {
    const onKey = (e) => {
      const el = e.target;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'Escape' && typing && el === searchRef.current) {
        setSearch('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const q = search.trim().toLowerCase();
  const matches = (t) => !q || t.label.toLowerCase().includes(q) || String(t.tip || '').toLowerCase().includes(q);
  const anyMatch = groups.some((g) => g.tools.some(matches));
  const toggle = (label) => setClosed((prev) => {
    const next = new Set(prev);
    if (next.has(label)) next.delete(label); else next.add(label);
    return next;
  });

  return (
    <aside
      className="w-full sm:w-56 shrink-0 border-b sm:border-b-0 sm:border-r overflow-y-auto p-4 space-y-3"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
    >
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-bg)', color: 'var(--color-primary)' }}>
          {getIcon(icon, { size: 16 })}
        </div>
        <h1 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h1>
        {onInfo && (
          <Tooltip text={infoTip}>
            <button
              type="button"
              onClick={onInfo}
              aria-label={`How ${title} works`}
              className="transition-opacity duration-200 hover:opacity-60"
              style={{ color: 'var(--color-muted)', lineHeight: 1, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
            >
              {getIcon('info', { size: 13 })}
            </button>
          </Tooltip>
        )}
        {onTour && (
          <Tooltip text={tourTip}>
            <button
              type="button"
              onClick={onTour}
              aria-label={`Take the ${title} tour`}
              className="transition-opacity duration-200 hover:opacity-60"
              style={{ color: 'var(--color-muted)', lineHeight: 1, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
            >
              {getIcon('compass', { size: 13 })}
            </button>
          </Tooltip>
        )}
      </div>

      <Tooltip text="Filter the tool list below by name or description. Press / to jump here. The microphone lets you say it instead.">
        <div className="w-full">
          <VoiceInput
            inputRef={searchRef}
            value={search}
            onChange={setSearch}
            placeholder="Search tools…"
            label="Search tools"
            className="!py-1.5 !text-xs !rounded-lg"
          />
        </div>
      </Tooltip>

      {children}

      <nav aria-label={`${title} tools`} data-tour={`${String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-menu`}>
        {groups.map((group) => {
          const tools = group.tools.filter(matches);
          if (!tools.length) return null;
          const open = !closed.has(group.label);
          return (
            <div key={group.label} className="mb-1">
              <Tooltip text={group.tip || group.label} side="right">
                <button
                  type="button"
                  onClick={() => toggle(group.label)}
                  aria-expanded={open || !!q}
                  className="text-xs font-semibold w-full text-left py-1 transition-opacity duration-200 hover:opacity-70"
                  style={{ color: 'var(--color-primary)' }}
                >
                  {open ? '▼' : '▶'} {group.label}
                </button>
              </Tooltip>
              {(open || q) && (
                <ul className="pl-2 border-l ml-1 space-y-0.5 mt-1" style={{ borderColor: 'var(--color-border)' }}>
                  {tools.map((t) => (
                    <li key={t.id}>
                      <Tooltip text={t.tip || t.label} side="right">
                        <button
                          type="button"
                          onClick={() => onSelect(t.id)}
                          aria-current={current === t.id ? 'page' : undefined}
                          data-tour={t.tour}
                          className="w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-lg text-xs transition-opacity duration-200 hover:opacity-70"
                          style={{
                            background: current === t.id ? 'var(--color-bg)' : 'transparent',
                            color: current === t.id ? 'var(--color-text)' : 'var(--color-muted)',
                          }}
                        >
                          {t.icon ? getIcon(t.icon, { size: 13 }) : null}
                          <span className="min-w-0">
                            {t.label}
                            {t.hint ? <span className="block text-[11px] opacity-80">{t.hint}</span> : null}
                          </span>
                        </button>
                      </Tooltip>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        {q && !anyMatch && <p className="px-2 text-xs" style={{ color: 'var(--color-muted)' }}>No tools match “{search}”.</p>}
      </nav>
    </aside>
  );
}
