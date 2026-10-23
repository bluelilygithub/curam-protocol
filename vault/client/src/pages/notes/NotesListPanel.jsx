import React, { useMemo, useState } from 'react';
import { useIcon } from '../../providers/IconProvider';
import MoodDot from '../../components/mood/MoodDot';
import { DATE_PRESETS, GROUP_MODES, groupNotes, filtersSummary } from './noteGroups.mjs';
import { listText } from './noteListText.mjs';

const fmtShort = (value) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString([], d.getFullYear() === now.getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
};

/**
 * The left side of Notes (the whole screen on a phone): search, view/filter controls, grouped list.
 * All data and state come from useNotesList; this only draws and reports taps.
 */
export default function NotesListPanel({
  list, projects, clients, onNeedClients, selectedId, mobile, moodMap, convertedIds,
  onSelect, onNew, onToday, onBin, onConvert, onDelete, onPin, allTags, onManageTags, searchRef, bottomPad,
}) {
  const getIcon = useIcon();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [menuId, setMenuId] = useState(null); // phone: the row whose actions are showing
  const [confirmId, setConfirmId] = useState(null); // the row asking "Delete? Yes / No"

  const {
    notes, loading, loadingMore, hasMore, error, reload, loadMore, search, setSearch, searching,
    preset, setPreset, custom, setCustom, projectId, setProjectId, clientId, setClientId,
    groupMode, setGroupMode, field, setField, filtersActive, clearFilters, tags, setTags,
  } = list;

  const sections = useMemo(() => groupNotes(notes, { mode: groupMode, field }), [notes, groupMode, field]);
  const activeCount = (preset !== 'all' ? 1 : 0) + (projectId ? 1 : 0) + (clientId ? 1 : 0) + (tags.length ? 1 : 0);
  const border = { borderColor: 'var(--color-border)' };
  const chip = (on) => ({
    background: on ? 'var(--color-primary)' : 'var(--color-bg)',
    color: on ? '#fff' : 'var(--color-text)',
    border: `1px solid ${on ? 'var(--color-primary)' : 'var(--color-border)'}`,
    minHeight: mobile ? 36 : 28,
  });
  const field_ = { background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)', minHeight: mobile ? 40 : 30, fontSize: mobile ? 16 : 12 };

  function row(note) {
    const { title, preview } = listText(note);
    const selected = selectedId === note.id;
    const confirming = confirmId === note.id;
    const showActions = mobile ? menuId === note.id : false;
    const noteTags = Array.isArray(note.tags) ? note.tags : [];
    const tag = groupMode === 'project' ? note.client_name : groupMode === 'client' ? note.project_name : (note.project_name || note.client_name);
    return (
      <div
        key={note.id}
        className="group border-b"
        style={{ ...border, background: selected ? 'var(--color-surface-2)' : 'transparent' }}
      >
        <div className="flex items-stretch">
          <button
            type="button"
            onClick={() => { setMenuId(null); setConfirmId(null); onSelect(note); }}
            className="flex-1 min-w-0 text-left px-3 transition-opacity duration-200 hover:opacity-70"
            style={{ paddingTop: mobile ? 12 : 8, paddingBottom: mobile ? 12 : 8, minHeight: mobile ? 56 : undefined }}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              {note.pinned_at && (
                <span className="flex-shrink-0" style={{ color: 'var(--color-primary)' }} title="Pinned" aria-label="Pinned">{getIcon('pin', { size: 12 })}</span>
              )}
              {note.source === 'voice' && (
                <span className="flex-shrink-0" style={{ color: 'var(--color-primary)' }} title="Voice note (made from a recording)" aria-label="Voice note">{getIcon('audio-lines', { size: 13 })}</span>
              )}
              <span className={`${mobile ? 'text-base' : 'text-sm'} font-medium truncate`} style={{ color: 'var(--color-text)' }}>{title}</span>
              <span className="ml-auto flex-shrink-0 text-xs" style={{ color: 'var(--color-muted)' }}>{fmtShort(note[field === 'created' ? 'created_at' : 'updated_at'])}</span>
            </div>
            <div className={`${mobile ? 'text-sm' : 'text-xs'} truncate mt-0.5`} style={{ color: 'var(--color-muted)' }}>
              {preview || (note.preview ? ' ' : <span className="italic">empty</span>)}
            </div>
            {(tag || noteTags.length > 0 || convertedIds.has(note.id)) && (
              <div className="flex flex-wrap items-center gap-1.5 mt-1 min-w-0">
                {tag && <span className="text-xs truncate rounded px-1.5 py-0.5" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)', maxWidth: '100%' }}>{tag}</span>}
                {noteTags.slice(0, 3).map((t) => (
                  <span key={t} className="text-xs truncate rounded-full px-2 py-0.5" style={{ color: 'var(--color-primary)', border: '1px solid var(--color-border)', maxWidth: '100%' }}>{t}</span>
                ))}
                {noteTags.length > 3 && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>+{noteTags.length - 3}</span>}
                {convertedIds.has(note.id) && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-primary)22', color: 'var(--color-primary)' }}>↳ task created</span>}
              </div>
            )}
          </button>

          {/* Actions: always reachable. Phone: a ⋯ button that opens them. Desktop: show on hover or when tabbing to the row. */}
          {mobile ? (
            <button
              type="button" aria-label="Note actions" aria-expanded={showActions}
              onClick={() => { setConfirmId(null); setMenuId(showActions ? null : note.id); }}
              className="flex-shrink-0 flex items-center justify-center hover:opacity-60 transition-opacity duration-200"
              style={{ width: 48, color: 'var(--color-muted)' }}
            >{getIcon('more-horizontal', { size: 20 })}</button>
          ) : (
            <div className="flex items-center gap-1 pr-2 flex-shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-200">
              {moodMap && <MoodDot entityType="note" entityId={note.id} entityTitle={note.title} dominantEmotion={moodMap[`note:${note.id}`]} />}
              <button type="button" onClick={() => onPin(note)} className="p-1 hover:opacity-60 transition-opacity duration-200" style={{ color: note.pinned_at ? 'var(--color-primary)' : 'var(--color-muted)' }} title={note.pinned_at ? 'Unpin' : 'Pin to the top'} aria-label={note.pinned_at ? 'Unpin note' : 'Pin note'}>{getIcon('pin', { size: 14 })}</button>
              <button type="button" onClick={() => onConvert(note)} className="p-1 hover:opacity-60 transition-opacity duration-200" style={{ color: 'var(--color-primary)' }} title="Convert to task" aria-label="Convert to task">{getIcon('list-checks', { size: 14 })}</button>
              <button type="button" onClick={() => setConfirmId(note.id)} className="p-1 hover:opacity-60 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }} title="Delete" aria-label="Delete note">{getIcon('trash', { size: 14 })}</button>
            </div>
          )}
        </div>

        {(showActions || confirming) && (
          <div className="flex flex-wrap items-center gap-2 px-3 pb-2" style={{ paddingTop: 2 }}>
            {confirming ? (
              <>
                <span className="text-xs" style={{ color: 'var(--color-text)' }}>Delete this note? You can restore it for 30 days.</span>
                <button type="button" onClick={() => { setConfirmId(null); setMenuId(null); onDelete(note); }} className="text-xs font-medium px-3 rounded-lg hover:opacity-80 transition-opacity duration-200" style={{ background: '#ef4444', color: '#fff', minHeight: mobile ? 36 : 26 }}>Yes</button>
                <button type="button" onClick={() => setConfirmId(null)} className="text-xs px-3 rounded-lg hover:opacity-70 transition-opacity duration-200" style={{ ...chip(false) }}>No</button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => { setMenuId(null); onPin(note); }} className="flex items-center gap-1.5 text-xs px-3 rounded-lg hover:opacity-70 transition-opacity duration-200" style={chip(false)}>{getIcon('pin', { size: 14 })} {note.pinned_at ? 'Unpin' : 'Pin'}</button>
                <button type="button" onClick={() => { setMenuId(null); onConvert(note); }} className="flex items-center gap-1.5 text-xs px-3 rounded-lg hover:opacity-70 transition-opacity duration-200" style={chip(false)}>{getIcon('list-checks', { size: 14 })} Make a task</button>
                <button type="button" onClick={() => setConfirmId(note.id)} className="flex items-center gap-1.5 text-xs px-3 rounded-lg hover:opacity-70 transition-opacity duration-200" style={{ ...chip(false), color: '#ef4444' }}>{getIcon('trash', { size: 14 })} Delete</button>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  const summary = filtersSummary({ preset, custom, search: search.trim(), project: projectId, client: clientId, tags });

  return (
    <div className="flex flex-col h-full min-h-0" style={{ background: 'var(--color-surface)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b flex-shrink-0" style={border}>
        <span className={`${mobile ? 'text-lg' : 'text-sm'} font-semibold`} style={{ color: 'var(--color-text)' }}>Notes</span>
        <div className="flex items-center gap-1">
        <button
          type="button" onClick={onToday}
          className="flex items-center justify-center gap-1 rounded-lg hover:opacity-70 transition-opacity duration-200"
          style={{ color: 'var(--color-primary)', minWidth: mobile ? 44 : 26, minHeight: mobile ? 44 : 26, fontSize: 12 }}
          title="Open today's note (made for you if there isn't one yet)" aria-label="Today's note"
        >{getIcon('calendar-check', { size: mobile ? 20 : 15 })}</button>
        <button
          type="button" onClick={onBin}
          className="flex items-center justify-center rounded-lg hover:opacity-70 transition-opacity duration-200"
          style={{ color: 'var(--color-muted)', minWidth: mobile ? 44 : 26, minHeight: mobile ? 44 : 26 }}
          title="Recently deleted: notes and templates you can still restore" aria-label="Recently deleted"
        >{getIcon('trash', { size: mobile ? 19 : 14 })}</button>
        <button
          type="button" onClick={onNew}
          className={mobile ? 'flex items-center justify-center gap-1.5 text-sm font-medium px-4 rounded-lg hover:opacity-80 transition-opacity duration-200' : 'w-6 h-6 flex items-center justify-center rounded hover:opacity-60 transition-opacity duration-200'}
          style={mobile ? { minHeight: 44, background: 'var(--color-primary)', color: '#fff' } : { color: 'var(--color-primary)' }}
          title="New note: write one or record your voice" aria-label="New note"
        >{getIcon('plus', { size: mobile ? 18 : 16 })}{mobile && ' New'}</button>
        </div>
      </div>

      {/* Search + view controls */}
      <div className="px-2 py-2 border-b flex-shrink-0 space-y-2" style={border}>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded px-2 flex-1 min-w-0" style={{ background: 'var(--color-surface-2)', minHeight: mobile ? 40 : 28 }}>
            <span style={{ color: 'var(--color-muted)' }}>{getIcon('search', { size: 14 })}</span>
            <input
              ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search notes…" aria-label="Search notes"
              className="bg-transparent outline-none flex-1 min-w-0" style={{ color: 'var(--color-text)', fontSize: mobile ? 16 : 12 }}
            />
            {search && <button type="button" aria-label="Clear search" onClick={() => setSearch('')} className="hover:opacity-60 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}>{getIcon('x', { size: 14 })}</button>}
          </div>
          <button
            type="button" onClick={() => { setFiltersOpen((v) => !v); onNeedClients(); }} aria-expanded={filtersOpen} aria-label="Filters"
            className="relative flex items-center justify-center gap-1 rounded text-xs hover:opacity-70 transition-opacity duration-200 flex-shrink-0"
            style={{ ...chip(filtersOpen || activeCount > 0), minWidth: mobile ? 44 : 32, paddingInline: 8 }} title="Filter by date, project or client"
          >
            {getIcon('sliders', { size: 14 })}{activeCount > 0 && <span className="font-semibold">{activeCount}</span>}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Group notes by">
          <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-muted)' }}>Group by</span>
          {GROUP_MODES.map((m) => (
            <button key={m.id} type="button" onClick={() => setGroupMode(m.id)} aria-pressed={groupMode === m.id} className="text-xs px-2.5 rounded-full flex-shrink-0 transition-opacity duration-200 hover:opacity-80" style={chip(groupMode === m.id)}>{m.label}</button>
          ))}
        </div>

        {filtersOpen && mobile && <div className="fixed inset-0 z-50" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => setFiltersOpen(false)} />}
        {filtersOpen && (
          <div
            className={mobile ? 'fixed left-0 right-0 bottom-0 z-50 space-y-3 p-4 rounded-t-2xl shadow-xl overflow-y-auto' : 'space-y-2 pt-1'}
            style={mobile ? { background: 'var(--color-surface)', borderTop: '1px solid var(--color-border)', maxHeight: '85dvh', paddingBottom: 'max(16px, env(safe-area-inset-bottom))' } : undefined}
            role={mobile ? 'dialog' : undefined} aria-label={mobile ? 'Filter notes' : undefined}
          >
            {mobile && (
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Filter notes</h3>
                <button type="button" onClick={() => setFiltersOpen(false)} aria-label="Close filters" className="hover:opacity-60 transition-opacity duration-200" style={{ color: 'var(--color-muted)', minWidth: 44, minHeight: 44 }}>{getIcon('x', { size: 20 })}</button>
              </div>
            )}
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Date range">
              {DATE_PRESETS.map((p) => (
                <button key={p.id} type="button" onClick={() => setPreset(p.id)} aria-pressed={preset === p.id} className="text-xs px-2.5 rounded-full transition-opacity duration-200 hover:opacity-80" style={chip(preset === p.id)}>{p.label}</button>
              ))}
            </div>
            {preset === 'custom' && (
              <div className="flex items-center gap-2">
                <label className="flex-1 text-xs" style={{ color: 'var(--color-muted)' }}>From
                  <input type="date" value={custom.from} max={custom.to || undefined} onChange={(e) => setCustom({ ...custom, from: e.target.value })} className="w-full rounded px-2 mt-0.5" style={field_} />
                </label>
                <label className="flex-1 text-xs" style={{ color: 'var(--color-muted)' }}>To
                  <input type="date" value={custom.to} min={custom.from || undefined} onChange={(e) => setCustom({ ...custom, to: e.target.value })} className="w-full rounded px-2 mt-0.5" style={field_} />
                </label>
              </div>
            )}
            <div className="flex items-center gap-1.5" role="group" aria-label="Which date">
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Dates mean</span>
              {[['updated', 'Last edited'], ['created', 'Created']].map(([id, label]) => (
                <button key={id} type="button" onClick={() => setField(id)} aria-pressed={field === id} className="text-xs px-2.5 rounded-full transition-opacity duration-200 hover:opacity-80" style={chip(field === id)}>{label}</button>
              ))}
            </div>
            {(allTags.length > 0 || tags.length > 0) && (
              <div role="group" aria-label="Tags">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Tags {tags.length > 1 ? '(notes with all of these)' : ''}</span>
                  <button type="button" onClick={onManageTags} className="text-xs hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-primary)', minHeight: mobile ? 32 : undefined }}>Manage tags</button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[...new Set([...tags, ...allTags.map((t) => t.tag)])].slice(0, 40).map((t) => {
                    const on = tags.includes(t);
                    const count = allTags.find((x) => x.tag === t)?.count;
                    return (
                      <button key={t} type="button" aria-pressed={on} onClick={() => setTags(on ? tags.filter((x) => x !== t) : [...tags, t])} className="text-xs px-2.5 rounded-full transition-opacity duration-200 hover:opacity-80" style={chip(on)}>
                        {t}{count != null && <span style={{ opacity: 0.6 }}> {count}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="flex items-center gap-2">
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Filter by project" className="flex-1 min-w-0 rounded px-2 outline-none" style={field_}>
                <option value="">All projects</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Filter by client" className="flex-1 min-w-0 rounded px-2 outline-none" style={field_}>
                <option value="">All clients</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            {filtersActive && (
              <button type="button" onClick={clearFilters} className="text-xs hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-primary)', minHeight: mobile ? 36 : undefined }}>Clear all filters</button>
            )}
            {mobile && (
              <button type="button" onClick={() => setFiltersOpen(false)} className="w-full text-sm font-medium rounded-xl hover:opacity-80 transition-opacity duration-200" style={{ minHeight: 48, background: 'var(--color-primary)', color: '#fff' }}>
                Show {notes.length}{hasMore ? '+' : ''} note{notes.length === 1 ? '' : 's'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto min-h-0" style={{ paddingBottom: bottomPad }}>
        {error && (
          <div className="px-3 py-3 text-xs flex items-center gap-2" style={{ color: '#ef4444' }}>
            {error}
            <button type="button" onClick={reload} className="underline hover:opacity-70 transition-opacity duration-200">Try again</button>
          </div>
        )}
        {loading && notes.length === 0 && !error && (
          <div aria-busy="true" aria-label="Loading notes">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="px-3 py-3 border-b" style={border}>
                <div className="h-3 rounded w-2/3" style={{ background: 'var(--color-surface-2)' }} />
                <div className="h-2.5 rounded w-1/2 mt-2" style={{ background: 'var(--color-surface-2)' }} />
              </div>
            ))}
          </div>
        )}
        {!loading && !error && notes.length === 0 && (
          <div className="px-4 py-8 text-center">
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
              {filtersActive ? `No notes ${summary || 'match'}.` : 'No notes yet.'}
            </p>
            {filtersActive
              ? <button type="button" onClick={clearFilters} className="text-sm mt-2 hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-primary)' }}>Clear filters</button>
              : <button type="button" onClick={onNew} className="text-sm mt-2 hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-primary)' }}>Write your first note</button>}
          </div>
        )}

        {notes.length > 0 && (
          <p className="px-3 pt-2 pb-1 text-xs" style={{ color: 'var(--color-muted)', opacity: searching || loading ? 0.5 : 1 }}>
            {notes.length}{hasMore ? '+' : ''} note{notes.length === 1 ? '' : 's'}{summary ? `, ${summary}` : ''}
          </p>
        )}
        <div style={{ opacity: loading && notes.length > 0 ? 0.5 : 1, transition: 'opacity 200ms' }}>
          {sections.map((s) => (
            <section key={s.key} aria-label={s.label}>
              <h3 className="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide sticky top-0 z-10" style={{ color: 'var(--color-muted)', background: 'var(--color-surface)' }}>
                {s.label} <span style={{ fontWeight: 400 }}>· {s.notes.length}</span>
              </h3>
              {s.notes.map(row)}
            </section>
          ))}
        </div>
        {hasMore && (
          <div className="p-3">
            <button type="button" onClick={loadMore} disabled={loadingMore} className="w-full text-sm rounded-lg hover:opacity-70 transition-opacity duration-200" style={{ ...chip(false), minHeight: 44, opacity: loadingMore ? 0.5 : 1 }}>
              {loadingMore ? 'Loading…' : 'Show more notes'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
