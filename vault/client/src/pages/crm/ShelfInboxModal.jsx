import React, { useCallback, useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import { useIcon } from '../../providers/IconProvider';

/**
 * CRM -> "Unfiled from Shelf": things the Vault Shelf Windows app sent to the CRM with no client chosen (docs/vault-shelf.md).
 * Each one is a copy of what was on the clipboard: choose a client and it becomes a note on that client's activity (a picture is
 * attached to it), or throw it away. Text is shown as plain text; a picture is fetched with the sign-in and shown from a local copy.
 */
function Thumb({ id }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let url = null;
    let live = true;
    api.get(`/api/shelf-inbox/${id}/file`)
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => { if (b && live) { url = URL.createObjectURL(b); setSrc(url); } })
      .catch(() => {});
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [id]);
  if (!src) return <div className="w-20 h-20 rounded-lg border flex-shrink-0" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }} />;
  return <img src={src} alt="Captured picture" className="w-20 h-20 object-cover rounded-lg border flex-shrink-0" style={{ borderColor: 'var(--color-border)' }} />;
}

export default function ShelfInboxModal({ onClose, onChanged }) {
  const getIcon = useIcon();
  const addToast = useToastStore((s) => s.addToast);
  const [state, setState] = useState('loading'); // loading | ready | error
  const [items, setItems] = useState([]);
  const [clients, setClients] = useState([]);
  const [pick, setPick] = useState({}); // item id -> chosen client id
  const [busy, setBusy] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/shelf-inbox');
      if (!res.ok) throw new Error('load failed');
      const data = await res.json();
      setItems(data.items || []);
      setClients(data.clients || []);
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function file(item) {
    const clientId = Number(pick[item.id]);
    if (!clientId) { addToast('Choose a client first.', 'error'); return; }
    setBusy(item.id);
    try {
      const res = await api.post(`/api/shelf-inbox/${item.id}/assign`, { clientId });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { addToast(data.error || 'Could not file that capture.', 'error'); if (res.status === 404) load(); return; }
      const name = clients.find((c) => c.id === clientId)?.name || 'the client';
      addToast(`Filed to ${name} ✓`, 'success');
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      onChanged?.();
    } catch {
      addToast('Could not file that capture. Try again.', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function discard(item) {
    setConfirmDelete(null);
    try {
      const res = await api.delete(`/api/shelf-inbox/${item.id}`);
      if (!res.ok && res.status !== 404) throw new Error('delete failed');
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      onChanged?.();
    } catch {
      addToast('Could not delete that capture. Try again.', 'error');
    }
  }

  const border = { borderColor: 'var(--color-border)' };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Unfiled from Shelf" className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl border" style={{ ...border, background: 'var(--color-surface)' }}>
        <div className="flex items-center justify-between gap-3 p-4 border-b" style={border}>
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Unfiled from Shelf</h2>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Things you sent to the CRM from the Vault Shelf app. Pick a client to file each one.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="hover:opacity-60 transition-opacity" style={{ color: 'var(--color-muted)' }}>{getIcon('x', { size: 18 })}</button>
        </div>

        <div className="overflow-y-auto p-4 space-y-3">
          {state === 'loading' && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>}
          {state === 'error' && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Could not load them. <button type="button" className="underline hover:opacity-70 transition-opacity" onClick={load}>Try again</button></p>}
          {state === 'ready' && items.length === 0 && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Nothing waiting. Everything you sent from the Shelf has been filed.</p>}
          {state === 'ready' && clients.length === 0 && items.length > 0 && (
            <p className="text-sm" style={{ color: '#92400e' }}>You have no clients yet. Add a client first, then file these.</p>
          )}
          {items.map((item) => (
            <div key={item.id} className="rounded-xl border p-3 flex gap-3" style={{ ...border, background: 'var(--color-bg)' }}>
              {item.kind === 'image' && <Thumb id={item.id} />}
              <div className="min-w-0 flex-1 space-y-2">
                <div>
                  {item.title && <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{item.title}</div>}
                  {item.excerpt && <div className="text-sm whitespace-pre-wrap break-words" style={{ color: 'var(--color-text)' }}>{item.excerpt}{item.excerpt.length >= 400 ? '…' : ''}</div>}
                  {item.kind === 'image' && !item.excerpt && <div className="text-sm" style={{ color: 'var(--color-muted)' }}>Picture</div>}
                  <div className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                    {new Date(item.createdAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}{item.sourceApp ? ` · from ${item.sourceApp}` : ''}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={pick[item.id] || ''}
                    onChange={(e) => setPick((p) => ({ ...p, [item.id]: e.target.value }))}
                    aria-label="Client"
                    className="text-sm px-2.5 py-1.5 rounded-lg border outline-none min-w-[10rem]"
                    style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  >
                    <option value="">Choose a client…</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button
                    type="button"
                    onClick={() => file(item)}
                    disabled={busy === item.id || !pick[item.id]}
                    className="px-3 py-1.5 text-sm font-medium rounded-lg hover:opacity-70 transition-opacity disabled:opacity-40"
                    style={{ background: 'var(--color-primary)', color: '#fff' }}
                  >
                    {busy === item.id ? 'Filing…' : 'File it'}
                  </button>
                  {confirmDelete === item.id ? (
                    <span className="text-sm inline-flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                      Delete?
                      <button type="button" onClick={() => discard(item)} className="font-medium hover:opacity-70 transition-opacity" style={{ color: '#ef4444' }}>Yes</button>
                      <button type="button" onClick={() => setConfirmDelete(null)} className="hover:opacity-70 transition-opacity" style={{ color: 'var(--color-muted)' }}>No</button>
                    </span>
                  ) : (
                    <button type="button" onClick={() => setConfirmDelete(item.id)} className="px-2 py-1.5 text-sm hover:opacity-70 transition-opacity" style={{ color: 'var(--color-muted)' }}>Delete</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
