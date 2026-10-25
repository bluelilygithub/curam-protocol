import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import {
  HISTORY_MAX_ITEMS, listHistory, getHistoryImage, removeHistory, clearHistory, addHistory, makeThumb,
  blobToDataUrl, setHistoryEnabled, timeAgo, signatureOf,
} from './historyStore.mjs';

// Renders nothing. Put one beside a tool's result: when the result changes and history is switched on, the result is
// kept on this device (see historyStore.mjs). A tool that shows "Use in…" gets this automatically.
export function HistoryRecorder({ enabled, tool, name, dataUrl, onRecorded }) {
  const last = useRef('');
  useEffect(() => {
    if (!enabled || !dataUrl || !/^data:image\//i.test(dataUrl)) return undefined;
    const sig = signatureOf(dataUrl);
    if (last.current === sig) return undefined;
    last.current = sig;
    let off = false;
    (async () => {
      try {
        const thumb = await makeThumb(dataUrl);
        const kept = await addHistory({ tool, name, dataUrl, thumb });
        if (kept && !off) onRecorded?.();
      } catch { /* storage full or blocked (private window): history just skips this one */ }
    })();
    return () => { off = true; };
  }, [enabled, tool, name, dataUrl, onRecorded]);
  return null;
}

// The "Recent results" window: on/off switch, the kept pictures, and what to do with each.
export function HistoryPanel({ open, onClose, enabled, onToggle, tick, labelFor, canOpenIn, sendTargets, onSend }) {
  const getIcon = useIcon();
  const [items, setItems] = useState(null); // null = loading
  const [error, setError] = useState('');
  const [confirmId, setConfirmId] = useState(null);
  const [confirmAll, setConfirmAll] = useState(false);

  const reload = useCallback(async () => {
    try {
      setItems(await listHistory());
      setError('');
    } catch {
      setItems([]);
      setError('This browser would not let Graphics keep pictures here (a private window can do that).');
    }
  }, []);

  useEffect(() => { if (open) reload(); }, [open, tick, reload]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const fullDataUrl = async (item) => {
    const blob = await getHistoryImage(item.id);
    return blob ? blobToDataUrl(blob) : null;
  };
  const extFor = (item) => (item.name?.match(/\.([a-z0-9]+)$/i)?.[1] || 'png');
  const download = async (item) => {
    const url = await fullDataUrl(item);
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = item.name || `${item.tool}.${extFor(item)}`;
    a.click();
  };
  const send = async (target, item) => {
    const url = await fullDataUrl(item);
    if (url) { onSend(target, url, item.name || `${item.tool}.png`); onClose(); }
  };
  const del = async (id) => { setConfirmId(null); await removeHistory(id); reload(); };
  const clearAll = async () => { setConfirmAll(false); await clearHistory(); reload(); };

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 overflow-y-auto" style={{ background: 'rgba(0,0,0,0.4)' }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-3xl rounded-2xl border p-5 space-y-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Recent results</h2>
          <Tooltip text="Close this window."><button type="button" onClick={onClose} className="hover:opacity-60" style={{ color: 'var(--color-muted)' }}>{getIcon('x', { size: 16 })}</button></Tooltip>
        </div>

        <label className="flex items-start gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
          <Tooltip text="When on, each finished picture is also kept in this browser so you can come back to it. Nothing is sent to the server."><input
            type="checkbox"
            checked={enabled}
            onChange={(e) => { setHistoryEnabled(e.target.checked); onToggle(e.target.checked); }}
            className="mt-1"
          /></Tooltip>
          <span>
            Keep my recent results on this device
            <span className="block text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
              The last {HISTORY_MAX_ITEMS} finished pictures are kept in this browser only: nothing is uploaded. Clearing your browser data, or using another device, removes or hides them. Tools that only show a number or a colour are not kept.
            </span>
          </span>
        </label>

        {error && <p className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{error}</p>}

        {items === null ? (
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm rounded-xl border px-4 py-6 text-center" style={{ color: 'var(--color-muted)', borderColor: 'var(--color-border)' }}>
            {enabled ? 'Nothing kept yet. Finish a picture in a tool and it will appear here.' : 'Switch the box above on, then finish a picture in a tool, and it will appear here.'}
          </p>
        ) : (
          <>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {items.map((item) => (
                <li key={item.id} className="flex gap-3 rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                  <div className="w-20 h-20 flex-none rounded-lg overflow-hidden flex items-center justify-center border" style={{ borderColor: 'var(--color-border)', background: '#fff' }}>
                    {item.thumb ? <img src={item.thumb} alt="" className="max-w-full max-h-full" /> : <span style={{ color: 'var(--color-muted)' }}>{getIcon('image', { size: 18 })}</span>}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>{labelFor(item.tool)}</p>
                    <p className="text-xs truncate" style={{ color: 'var(--color-muted)' }}>{timeAgo(item.createdAt)}{item.name ? ` · ${item.name}` : ''}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      {canOpenIn(item.tool) && (
                        <Tooltip text={`Open this picture in ${labelFor(item.tool)} to change it again.`}><button type="button" onClick={() => send(item.tool, item)} className="text-xs hover:opacity-60" style={{ color: 'var(--color-primary)' }}>Open in {labelFor(item.tool)}</button></Tooltip>
                      )}
                      <Tooltip text="Carry this picture into another tool."><select
                        value=""
                        onChange={(e) => { if (e.target.value) send(e.target.value, item); e.target.value = ''; }}
                        className="text-xs px-1.5 py-0.5 rounded border cursor-pointer"
                        style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)', background: 'transparent' }}
                      >
                        <option value="">Use in…</option>
                        {sendTargets.map((t) => <option key={t.mode} value={t.mode}>{t.label}</option>)}
                      </select></Tooltip>
                      <Tooltip text="Save this picture to your device."><button type="button" onClick={() => download(item)} className="text-xs hover:opacity-60" style={{ color: 'var(--color-primary)' }}>Download</button></Tooltip>
                      {confirmId === item.id ? (
                        <span className="text-xs flex items-center gap-1.5" style={{ color: 'var(--color-muted)' }}>
                          Delete?
                          <button type="button" className="font-medium hover:opacity-60" style={{ color: '#ef4444' }} onClick={() => del(item.id)}>Yes</button>
                          <button type="button" className="font-medium hover:opacity-60" onClick={() => setConfirmId(null)}>No</button>
                        </span>
                      ) : (
                        <Tooltip text="Remove this picture from your history."><button type="button" onClick={() => setConfirmId(item.id)} className="text-xs hover:opacity-60" style={{ color: '#ef4444' }}>Delete</button></Tooltip>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between text-xs" style={{ color: 'var(--color-muted)' }}>
              <span>{items.length} kept</span>
              {confirmAll ? (
                <span className="flex items-center gap-2">
                  Delete all {items.length}?
                  <button type="button" className="font-medium hover:opacity-60" style={{ color: '#ef4444' }} onClick={clearAll}>Yes</button>
                  <button type="button" className="font-medium hover:opacity-60" onClick={() => setConfirmAll(false)}>No</button>
                </span>
              ) : (
                <Tooltip text="Remove every picture from your history."><button type="button" onClick={() => setConfirmAll(true)} className="hover:opacity-60" style={{ color: '#ef4444' }}>Clear all</button></Tooltip>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
