import React, { useEffect, useMemo, useState } from 'react';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { NOTE_TIPS } from './noteTips.mjs';
import { diffLines, diffStats, collapse } from './noteDiff.mjs';
import { describeWhen, describeReason, describeSize, describeLength } from './noteVersions.mjs';

/**
 * "Earlier versions" of the open note: what it said at earlier times, how each differs from now, and a button to put one back. The note is saved
 * as it is now before a restore, so a restore can be undone from this same list. Nothing here changes the note until Restore is pressed.
 * `onRestore(versionId)` does the restoring (the page saves first, then asks the server) and returns true when it worked.
 */
export default function NoteVersionsPanel({ noteId, currentTitle, currentBody, mobile, onRestore, onClose }) {
  const getIcon = useIcon();
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState(null); // { id, title, body, saved_at, reason }
  const [loadingId, setLoadingId] = useState(null);
  const [view, setView] = useState('changes'); // changes | whole
  const [restoring, setRestoring] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let alive = true;
    api.get(`/api/notes/${noteId}/versions`)
      .then(async (res) => { if (!res.ok) throw new Error('load failed'); const data = await res.json(); if (alive) setList(data); })
      .catch(() => { if (alive) setError('The earlier versions could not be loaded. Try again.'); });
    return () => { alive = false; };
  }, [noteId]);

  async function pick(v) {
    setConfirming(false);
    setLoadingId(v.id);
    setError('');
    try {
      const res = await api.get(`/api/notes/${noteId}/versions/${v.id}`);
      if (!res.ok) throw new Error('load failed');
      setPicked(await res.json());
    } catch {
      setError('That version could not be loaded. Try again.');
    } finally {
      setLoadingId(null);
    }
  }

  async function restore() {
    if (!picked) return;
    setRestoring(true);
    const ok = await onRestore(picked.id);
    setRestoring(false);
    if (ok) onClose(); else setError('That version could not be restored. Try again.');
  }

  // what restoring would do to the note as it is now: red lines go, green lines come back
  const ops = useMemo(() => (picked ? diffLines(currentBody, picked.body) : []), [picked, currentBody]);
  const stats = useMemo(() => diffStats(ops), [ops]);
  const shown = useMemo(() => collapse(ops, 2), [ops]);
  const same = picked && !stats.added && !stats.removed && picked.title === currentTitle;
  const btn = { minHeight: mobile ? 44 : 32 };

  return (
    <div className={`fixed inset-0 flex ${mobile ? 'items-end' : 'items-center'} justify-center z-50 ${mobile ? '' : 'p-4'}`} style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div
        className={`${mobile ? 'rounded-t-2xl' : 'rounded-2xl'} w-full ${mobile ? '' : 'max-w-3xl'} shadow-xl flex flex-col`}
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', maxHeight: mobile ? '92dvh' : '80vh', paddingBottom: mobile ? 'env(safe-area-inset-bottom)' : undefined }}
        role="dialog" aria-label="Earlier versions of this note"
      >
        <div className="flex items-start justify-between gap-3 p-4 pb-2 flex-shrink-0">
          <div>
            <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Earlier versions</h3>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Kept as you edit: about one every few minutes, and straight away before a big change or an AI change.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="hover:opacity-60 transition-opacity duration-200" style={{ color: 'var(--color-muted)', background: 'none', border: 'none', cursor: 'pointer', minWidth: mobile ? 40 : 24, minHeight: mobile ? 40 : 24 }}>{getIcon('x', { size: 18 })}</button>
        </div>
        {error && <p className="px-4 text-xs" style={{ color: '#ef4444' }} role="alert">{error}</p>}

        <div className={`flex-1 min-h-0 flex ${mobile ? 'flex-col' : 'flex-row'} gap-3 p-4 pt-2`}>
          <div className={`${mobile ? 'max-h-40' : 'w-64 flex-shrink-0'} overflow-y-auto space-y-1.5`} aria-label="List of earlier versions">
            {list === null && !error && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>}
            {list && !list.length && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No earlier versions yet. They are kept as you edit this note.</p>}
            {(list || []).map((v) => {
              const active = picked?.id === v.id;
              return (
                <button
                  key={v.id} type="button" onClick={() => pick(v)} aria-pressed={active}
                  className="w-full text-left rounded-lg p-2 transition-opacity duration-200 hover:opacity-80"
                  style={{ background: active ? 'var(--color-bg)' : 'transparent', border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`, minHeight: mobile ? 52 : undefined }}
                >
                  <span className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium" style={{ color: 'var(--color-text)' }}>{describeWhen(v.saved_at)}</span>
                    {loadingId === v.id && <span style={{ color: 'var(--color-muted)' }}>Opening…</span>}
                  </span>
                  {describeReason(v.reason) && <span className="block text-xs" style={{ color: 'var(--color-primary)' }}>{describeReason(v.reason)}</span>}
                  <span className="block text-xs truncate" style={{ color: 'var(--color-muted)' }}>{v.preview || '(empty)'}</span>
                  <span className="block text-xs" style={{ color: 'var(--color-muted)' }}>{describeSize(v.chars)}, {describeLength(v.chars, currentBody.length)}</span>
                </button>
              );
            })}
          </div>

          <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-2">
            {!picked && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{list && list.length ? 'Pick a version to see what is different from the note now.' : ''}</p>}
            {picked && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex rounded-lg overflow-hidden" role="group" aria-label="How to show this version" style={{ border: '1px solid var(--color-border)' }}>
                    {[['changes', 'Changes'], ['whole', 'Whole text']].map(([id, label]) => (
                      <Tooltip key={id} text={id === 'changes' ? NOTE_TIPS.versionChanges : NOTE_TIPS.versionWhole}>
                        <button type="button" onClick={() => setView(id)} aria-pressed={view === id} className="text-xs px-3 transition-opacity duration-200 hover:opacity-80" style={{ minHeight: mobile ? 36 : 26, background: view === id ? 'var(--color-primary)' : 'var(--color-bg)', color: view === id ? '#fff' : 'var(--color-text)' }}>{label}</button>
                      </Tooltip>
                    ))}
                  </div>
                  <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    {same ? 'Same as the note now.' : `Restoring brings back ${stats.added} line${stats.added === 1 ? '' : 's'} and removes ${stats.removed}.`}
                  </span>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto rounded-lg p-2 text-sm" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)', fontFamily: 'ui-monospace, monospace', fontSize: 12, lineHeight: 1.5 }} aria-label="This version">
                  {picked.title !== currentTitle && <p className="mb-1" style={{ color: 'var(--color-muted)' }}>Title: {picked.title || 'Untitled'}</p>}
                  {view === 'whole'
                    ? <pre className="whitespace-pre-wrap break-words" style={{ margin: 0, font: 'inherit' }}>{picked.body || '(empty)'}</pre>
                    : shown.map((o, i) => (o.type === 'gap'
                      ? <p key={i} style={{ color: 'var(--color-muted)', margin: '2px 0' }}>… {o.count} unchanged line{o.count === 1 ? '' : 's'}</p>
                      : (
                        <p key={i} className="whitespace-pre-wrap break-words" style={{ margin: 0, padding: '0 4px', background: o.type === 'add' ? 'rgba(34,197,94,0.15)' : o.type === 'del' ? 'rgba(239,68,68,0.15)' : 'transparent', textDecoration: o.type === 'del' ? 'line-through' : 'none' }}>
                          <span aria-hidden="true" style={{ color: 'var(--color-muted)' }}>{o.type === 'add' ? '+ ' : o.type === 'del' ? '- ' : '  '}</span>{o.text || ' '}
                        </p>
                      )))}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {confirming ? (
                    <>
                      <span className="text-xs" style={{ color: 'var(--color-text)' }}>Put this version back? The note as it is now is kept in this list first.</span>
                      <button type="button" disabled={restoring} onClick={restore} className="px-4 rounded-lg text-sm font-medium hover:opacity-80 transition-opacity duration-200 disabled:opacity-50" style={{ ...btn, background: 'var(--color-primary)', color: '#fff' }}>{restoring ? 'Restoring…' : 'Yes, restore'}</button>
                      <button type="button" disabled={restoring} onClick={() => setConfirming(false)} className="px-4 rounded-lg text-sm hover:opacity-70 transition-opacity duration-200" style={{ ...btn, border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>No</button>
                    </>
                  ) : (
                    <Tooltip text={NOTE_TIPS.versionRestore}>
                      <button type="button" disabled={same} onClick={() => setConfirming(true)} className="px-4 rounded-lg text-sm font-medium hover:opacity-80 transition-opacity duration-200 disabled:opacity-40" style={{ ...btn, background: 'var(--color-primary)', color: '#fff' }}>Restore this version</button>
                    </Tooltip>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
