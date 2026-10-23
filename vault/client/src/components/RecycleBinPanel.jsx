import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import Tooltip from './Tooltip';
import useToastStore from '../store/toastStore';
import { daysLeftText, deletedAgoText, kindsIn } from '../utils/recycleBin.mjs';

/**
 * The 30-day recycle bin, for any tool. `types` (e.g. ['note', 'note-template']) limits it to some kinds of thing; leave it out
 * for everything (Settings -> Recycle bin). `onRestored(item, result)` lets the caller refresh its own list.
 * To make a new tool's deletes show up here, see docs/recycle-bin.md.
 */
export default function RecycleBinPanel({ types, onRestored, emptyHint }) {
  const getIcon = useIcon();
  const addToast = useToastStore((s) => s.addToast);
  const [items, setItems] = useState([]);
  const [retention, setRetention] = useState(30);
  const [state, setState] = useState('loading'); // loading | ready | error
  const [kind, setKind] = useState(''); // filter chip
  const [confirmId, setConfirmId] = useState(null); // "Delete for good? Yes / No" on one row
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const typesQuery = Array.isArray(types) && types.length ? `?types=${encodeURIComponent(types.join(','))}` : '';

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/api/recycle-bin${typesQuery}`);
      if (!res.ok) throw new Error('load failed');
      const data = await res.json();
      setItems(data.items || []);
      setRetention(data.retentionDays || 30);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [typesQuery]);

  useEffect(() => { load(); }, [load]);

  const kinds = useMemo(() => kindsIn(items), [items]);
  const shown = kind ? items.filter((i) => i.entityType === kind) : items;
  const border = { borderColor: 'var(--color-border)' };
  const btn = { background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)', minHeight: 40 };

  async function restore(item) {
    setBusyId(item.id);
    try {
      const res = await api.post(`/api/recycle-bin/${item.id}/restore`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { addToast(data.error || 'That item could not be restored.', 'error'); if (res.status === 404 || res.status === 410) load(); return; }
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      addToast(`"${item.title || item.label}" restored ✓`, 'success');
      onRestored?.(item, data);
    } catch {
      addToast('That item could not be restored. It is still in the recycle bin.', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function removeForever(item) {
    setBusyId(item.id);
    try {
      const res = await api.delete(`/api/recycle-bin/${item.id}`);
      if (!res.ok && res.status !== 404) throw new Error('delete failed');
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setConfirmId(null);
    } catch {
      addToast('That item could not be deleted. Try again.', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function emptyAll() {
    try {
      const res = await api.delete(`/api/recycle-bin${typesQuery}`);
      if (!res.ok) throw new Error('empty failed');
      setConfirmEmpty(false);
      setKind('');
      load();
    } catch {
      addToast('The recycle bin could not be emptied. Try again.', 'error');
    }
  }

  return (
    <div>
      <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>
        Things you delete are kept here for {retention} days, then removed for good. Restoring puts an item back as it was.
      </p>

      {state === 'loading' && <p className="text-sm py-6 text-center" style={{ color: 'var(--color-muted)' }} aria-busy="true">Loading…</p>}
      {state === 'error' && (
        <p className="text-sm py-4" style={{ color: '#ef4444' }} role="alert">
          The recycle bin could not be loaded. <button type="button" onClick={load} className="underline hover:opacity-70 transition-opacity duration-200">Try again</button>
        </p>
      )}

      {state === 'ready' && items.length === 0 && (
        <div className="py-10 text-center">
          <div className="flex justify-center mb-2" style={{ color: 'var(--color-muted)', opacity: 0.5 }}>{getIcon('trash', { size: 28 })}</div>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{emptyHint || 'Nothing here. Deleted items wait here before they are removed for good.'}</p>
        </div>
      )}

      {state === 'ready' && items.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
              {kinds.length > 1 && (
                <>
                  <button type="button" onClick={() => setKind('')} aria-pressed={!kind} className="text-xs px-2.5 rounded-full transition-opacity duration-200 hover:opacity-80" style={{ ...btn, minHeight: 32, background: !kind ? 'var(--color-primary)' : 'var(--color-bg)', color: !kind ? '#fff' : 'var(--color-text)' }}>All {items.length}</button>
                  {kinds.map((k) => (
                    <button key={k.type} type="button" onClick={() => setKind(k.type)} aria-pressed={kind === k.type} className="text-xs px-2.5 rounded-full transition-opacity duration-200 hover:opacity-80" style={{ ...btn, minHeight: 32, background: kind === k.type ? 'var(--color-primary)' : 'var(--color-bg)', color: kind === k.type ? '#fff' : 'var(--color-text)' }}>{k.label} {k.count}</button>
                  ))}
                </>
              )}
            </div>
            {confirmEmpty ? (
              <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text)' }}>
                Delete all {items.length} for good?
                <button type="button" onClick={emptyAll} className="px-3 rounded-lg font-medium hover:opacity-80 transition-opacity duration-200" style={{ background: '#ef4444', color: '#fff', minHeight: 36 }}>Yes</button>
                <button type="button" onClick={() => setConfirmEmpty(false)} className="px-3 rounded-lg hover:opacity-70 transition-opacity duration-200" style={{ ...btn, minHeight: 36 }}>No</button>
              </span>
            ) : (
              <Tooltip text="Delete everything shown here for good.">
                <button type="button" onClick={() => setConfirmEmpty(true)} className="text-xs hover:opacity-70 transition-opacity duration-200" style={{ color: '#ef4444', minHeight: 36 }}>Empty recycle bin</button>
              </Tooltip>
            )}
          </div>

          <ul className="rounded-xl border overflow-hidden" style={{ ...border, background: 'var(--color-surface)' }}>
            {shown.map((item) => (
              <li key={item.id} className="px-3 py-3 border-b last:border-b-0" style={border}>
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs rounded-full px-2 py-0.5 flex-shrink-0" style={{ border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>{item.label}</span>
                      <span className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>{item.title || '(untitled)'}</span>
                    </div>
                    {item.detail && <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--color-muted)' }}>{item.detail}</p>}
                    <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                      Deleted {deletedAgoText(item.deletedAt)} · <span style={{ color: item.daysLeft <= 3 ? '#f59e0b' : undefined }}>{daysLeftText(item.daysLeft)}</span>
                    </p>
                  </div>
                  {confirmId === item.id ? (
                    <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end text-xs" style={{ color: 'var(--color-text)' }}>
                      Delete for good?
                      <button type="button" disabled={busyId === item.id} onClick={() => removeForever(item)} className="px-3 rounded-lg font-medium hover:opacity-80 transition-opacity duration-200 disabled:opacity-40" style={{ background: '#ef4444', color: '#fff', minHeight: 36 }}>Yes</button>
                      <button type="button" onClick={() => setConfirmId(null)} className="px-3 rounded-lg hover:opacity-70 transition-opacity duration-200" style={{ ...btn, minHeight: 36 }}>No</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <Tooltip text="Put this back as it was.">
                      <button type="button" disabled={busyId === item.id} onClick={() => restore(item)} className="flex items-center gap-1.5 text-xs font-medium px-3 rounded-lg hover:opacity-80 transition-opacity duration-200 disabled:opacity-40" style={{ background: 'var(--color-primary)', color: '#fff', minHeight: 40 }}>
                        {getIcon('rotate-ccw', { size: 13 })} Restore
                      </button>
                      </Tooltip>
                      <Tooltip text="Delete this for good. It cannot be restored afterwards.">
                      <button type="button" onClick={() => setConfirmId(item.id)} aria-label={`Delete ${item.title || 'item'} for good`} className="flex items-center justify-center rounded-lg hover:opacity-70 transition-opacity duration-200" style={{ ...btn, color: '#ef4444', minWidth: 40 }}>
                        {getIcon('trash', { size: 14 })}
                      </button>
                      </Tooltip>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
