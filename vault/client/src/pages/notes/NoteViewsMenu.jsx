import React, { useEffect, useState } from 'react';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { NOTE_TIPS } from './noteTips.mjs';

/**
 * Saved views: pick one to bring back its search, dates, project, client, tags and grouping; save the current ones under a name;
 * rename, refresh or delete a view. A phone gets a bottom sheet, a bigger screen a panel under the button.
 * `api` comes from the Notes page: { views, activeId, plain, changedView, canSave, summaryFor, apply, clear, save, update, rename, remove }.
 * save / rename return an error message (a name already used, the limit) or '' when it worked.
 */
export default function NoteViewsMenu({ api, mobile, onClose }) {
  const getIcon = useIcon();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [renaming, setRenaming] = useState(null); // { id, draft }
  const [confirmId, setConfirmId] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const border = { borderColor: 'var(--color-border)' };
  const small = { background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)', minHeight: mobile ? 40 : 28 };
  const primary = { background: 'var(--color-primary)', color: '#fff', minHeight: mobile ? 44 : 32 };

  async function guarded(fn) {
    setBusy(true); setError('');
    try { return await fn(); } finally { setBusy(false); }
  }

  async function saveNew() {
    if (!name.trim() || busy) return;
    const msg = await guarded(() => api.save(name.trim()));
    if (msg) setError(msg); else setName('');
  }

  async function saveRename() {
    if (!renaming || !renaming.draft.trim() || busy) return;
    const msg = await guarded(() => api.rename(renaming.id, renaming.draft.trim()));
    if (msg) setError(msg); else setRenaming(null);
  }

  const panelStyle = mobile
    ? { background: 'var(--color-surface)', borderTop: '1px solid var(--color-border)', maxHeight: '85dvh', paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }
    : { background: 'var(--color-surface)', border: '1px solid var(--color-border)', maxHeight: '70dvh' };

  return (
    <>
      <div className="fixed inset-0 z-40" style={mobile ? { background: 'rgba(0,0,0,0.4)' } : undefined} onClick={onClose} />
      <div
        className={mobile ? 'fixed left-0 right-0 bottom-0 z-50 rounded-t-2xl shadow-xl flex flex-col' : 'absolute left-2 right-2 top-full mt-1 z-50 rounded-xl shadow-xl flex flex-col'}
        style={panelStyle} role="dialog" aria-label="Saved views"
      >
        <div className="flex items-center justify-between px-3 pt-3 pb-1 flex-shrink-0">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Views</h3>
          {mobile && <button type="button" onClick={onClose} aria-label="Close" className="hover:opacity-60 transition-opacity duration-200" style={{ color: 'var(--color-muted)', minWidth: 40, minHeight: 40 }}>{getIcon('x', { size: 18 })}</button>}
        </div>

        <div className="overflow-y-auto min-h-0 flex-1 px-1">
          <button
            type="button" onClick={() => { api.clear(); onClose(); }}
            className="w-full text-left px-2 py-2.5 flex items-center gap-2 rounded-lg hover:opacity-70 transition-opacity duration-200"
            style={{ minHeight: mobile ? 48 : undefined }}
          >
            <span className="w-4 flex-shrink-0" style={{ color: 'var(--color-primary)' }}>{api.plain && getIcon('check', { size: 14 })}</span>
            <span className="min-w-0">
              <span className="block text-sm" style={{ color: 'var(--color-text)' }}>All notes</span>
              <span className="block text-xs" style={{ color: 'var(--color-muted)' }}>Clear search and filters</span>
            </span>
          </button>

          {api.views.length === 0 && (
            <p className="px-3 py-3 text-xs" style={{ color: 'var(--color-muted)' }}>No saved views yet. Set up a search, dates, tags or grouping you use often, then save it below.</p>
          )}

          {api.views.map((v) => (
            <div key={v.id} className="rounded-lg" style={{ background: api.activeId === v.id ? 'var(--color-surface-2)' : 'transparent' }}>
              {renaming?.id === v.id ? (
                <div className="flex items-center gap-1.5 px-2 py-2">
                  <input
                    autoFocus value={renaming.draft} maxLength={40} aria-label={`New name for ${v.name}`}
                    onChange={(e) => setRenaming({ id: v.id, draft: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setRenaming(null); }}
                    className="flex-1 min-w-0 rounded px-2 outline-none"
                    style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-primary)', fontSize: 16, minHeight: mobile ? 44 : 30 }}
                  />
                  <button type="button" disabled={busy} onClick={saveRename} className="text-xs font-medium px-3 rounded-lg hover:opacity-80 transition-opacity duration-200 disabled:opacity-40" style={{ ...primary, minHeight: mobile ? 44 : 30 }}>Save</button>
                  <button type="button" onClick={() => { setRenaming(null); setError(''); }} className="text-xs px-3 rounded-lg hover:opacity-70 transition-opacity duration-200" style={{ ...small, minHeight: mobile ? 44 : 30 }}>Cancel</button>
                </div>
              ) : confirmId === v.id ? (
                <div className="flex items-center gap-1.5 px-2 py-2 flex-wrap text-xs" style={{ color: 'var(--color-text)' }}>
                  Delete "{v.name}"? You can restore it for 30 days.
                  <button type="button" onClick={() => { setConfirmId(null); api.remove(v); }} className="px-3 rounded-lg font-medium hover:opacity-80 transition-opacity duration-200" style={{ background: '#ef4444', color: '#fff', minHeight: mobile ? 40 : 28 }}>Yes</button>
                  <button type="button" onClick={() => setConfirmId(null)} className="px-3 rounded-lg hover:opacity-70 transition-opacity duration-200" style={small}>No</button>
                </div>
              ) : (
                <div className="flex items-stretch">
                  <Tooltip text={NOTE_TIPS.viewApply} side="right">
                  <button
                    type="button" onClick={() => { api.apply(v); onClose(); }}
                    className="flex-1 min-w-0 text-left px-2 py-2.5 flex items-start gap-2 hover:opacity-70 transition-opacity duration-200"
                    style={{ minHeight: mobile ? 52 : undefined }}
                  >
                    <span className="w-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--color-primary)' }}>{api.activeId === v.id && getIcon('check', { size: 14 })}</span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>{v.name}</span>
                      <span className="block text-xs" style={{ color: 'var(--color-muted)', overflowWrap: 'anywhere' }}>{api.summaryFor(v)}</span>
                    </span>
                  </button>
                  </Tooltip>
                  <Tooltip text={NOTE_TIPS.viewRename}>
                    <button type="button" onClick={() => { setRenaming({ id: v.id, draft: v.name }); setError(''); }} aria-label={`Rename view ${v.name}`} className="flex items-center justify-center hover:opacity-60 transition-opacity duration-200 flex-shrink-0" style={{ color: 'var(--color-muted)', width: mobile ? 40 : 28 }}>{getIcon('edit', { size: 13 })}</button>
                  </Tooltip>
                  <Tooltip text={NOTE_TIPS.viewDelete}>
                    <button type="button" onClick={() => setConfirmId(v.id)} aria-label={`Delete view ${v.name}`} className="flex items-center justify-center hover:opacity-60 transition-opacity duration-200 flex-shrink-0" style={{ color: 'var(--color-muted)', width: mobile ? 40 : 28 }}>{getIcon('trash', { size: 13 })}</button>
                  </Tooltip>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="px-3 pt-2 pb-3 border-t flex-shrink-0 space-y-2" style={border}>
          {api.changedView && (
            <div className="rounded-lg px-2.5 py-2 text-xs" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
              You changed the filters since opening "{api.changedView.name}".
              <Tooltip text={NOTE_TIPS.viewUpdate}>
              <button
                type="button" disabled={busy}
                onClick={async () => { const msg = await guarded(() => api.update(api.changedView)); if (msg) setError(msg); }}
                className="block mt-1.5 text-xs font-medium px-3 rounded-lg hover:opacity-80 transition-opacity duration-200 disabled:opacity-40" style={{ ...primary, minHeight: mobile ? 40 : 28 }}
              >Update "{api.changedView.name}" with these</button>
              </Tooltip>
            </div>
          )}
          <label className="block text-xs" style={{ color: 'var(--color-muted)' }}>
            {api.changedView ? 'Or save these as a new view' : 'Save the current search, dates, tags and grouping as a view'}
          </label>
          <div className="flex items-center gap-2">
            <input
              value={name} onChange={(e) => { setName(e.target.value); setError(''); }} onKeyDown={(e) => { if (e.key === 'Enter') saveNew(); }}
              placeholder={api.canSave ? 'View name, e.g. Acme this month' : 'Set some filters first'} maxLength={40} aria-label="View name" disabled={!api.canSave}
              className="flex-1 min-w-0 rounded-lg px-3 outline-none disabled:opacity-50"
              style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)', fontSize: 16, minHeight: mobile ? 44 : 32 }}
            />
            <Tooltip text={NOTE_TIPS.viewSave}>
              <button type="button" disabled={!api.canSave || !name.trim() || busy} onClick={saveNew} className="text-sm font-medium px-4 rounded-lg hover:opacity-80 transition-opacity duration-200 disabled:opacity-40" style={primary}>Save</button>
            </Tooltip>
          </div>
          {error && <p className="text-xs" style={{ color: '#ef4444' }} role="alert">{error}</p>}
        </div>
      </div>
    </>
  );
}
