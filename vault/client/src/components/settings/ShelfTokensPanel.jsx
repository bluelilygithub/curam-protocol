import React, { useCallback, useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../Tooltip';
import { statusWord, whenText, EXPIRY_CHOICES } from '../../utils/shelfKeys.mjs';

/**
 * Settings -> Vault Shelf: the keys that connect the Vault Shelf Windows clipboard app to this Vault (docs/vault-shelf.md).
 * A key is shown once, when it is made; Vault keeps only a fingerprint of it. Each key is limited to the things ticked, and can
 * never do more than the person's own account may do. Revoking a key stops the app using it at once.
 */
export default function ShelfTokensPanel() {
  const getIcon = useIcon();
  const addToast = useToastStore((s) => s.addToast);
  const [state, setState] = useState('loading'); // loading | ready | off | error
  const [keys, setKeys] = useState([]);
  const [scopes, setScopes] = useState([]);
  const [maxActive, setMaxActive] = useState(5);
  const [label, setLabel] = useState('');
  const [picked, setPicked] = useState({});
  const [expiry, setExpiry] = useState('');
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(null); // the key just made: { token, label }, shown once
  const [confirmRevoke, setConfirmRevoke] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/shelf-tokens');
      if (res.status === 403) { setState('off'); return; }
      if (!res.ok) throw new Error('load failed');
      const data = await res.json();
      setKeys(data.tokens || []);
      setScopes(data.scopes || []);
      setMaxActive(data.maxActive || 5);
      setPicked((prev) => {
        if (Object.keys(prev).length) return prev;
        return Object.fromEntries((data.scopes || []).filter((s) => s.available).map((s) => [s.name, true]));
      });
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const border = { borderColor: 'var(--color-border)' };
  const field = { background: 'var(--color-bg)', color: 'var(--color-text)', borderColor: 'var(--color-border)' };
  const chosen = scopes.filter((s) => picked[s.name] && s.available).map((s) => s.name);
  const activeCount = keys.filter((k) => k.status === 'active').length;

  async function make(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const res = await api.post('/api/shelf-tokens', { label, scopes: chosen, expiresInDays: expiry || undefined });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { addToast(data.error || 'Could not make the key.', 'error'); return; }
      setFresh({ token: data.token, label: data.label });
      setLabel('');
      await load();
    } catch {
      addToast('Could not make the key. Try again.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(k) {
    setConfirmRevoke(null);
    try {
      const res = await api.post(`/api/shelf-tokens/${k.id}/revoke`, {});
      if (!res.ok) { const d = await res.json().catch(() => ({})); addToast(d.error || 'Could not revoke the key.', 'error'); return; }
      addToast(`"${k.label}" revoked. The app can no longer use it.`, 'success');
      await load();
    } catch {
      addToast('Could not revoke the key. Try again.', 'error');
    }
  }

  async function remove(k) {
    try {
      const res = await api.delete(`/api/shelf-tokens/${k.id}`);
      if (!res.ok) { const d = await res.json().catch(() => ({})); addToast(d.error || 'Could not remove the key.', 'error'); return; }
      await load();
    } catch {
      addToast('Could not remove the key. Try again.', 'error');
    }
  }

  async function copy(text, what) {
    try { await navigator.clipboard.writeText(text); addToast(`${what} copied ✓`, 'success'); }
    catch { addToast('Copy was blocked by the browser. Select the text and copy it by hand.', 'error'); }
  }

  if (state === 'loading') return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>;
  if (state === 'off') {
    return (
      <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
        Vault Shelf is switched off for your account. Ask the workspace admin to turn it on.
      </p>
    );
  }
  if (state === 'error') {
    return (
      <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
        Could not load your keys. <button type="button" className="underline hover:opacity-70 transition-opacity" onClick={load}>Try again</button>
      </p>
    );
  }

  return (
    <div className="space-y-5" data-tour="shelf-keys">
      <p className="text-sm leading-relaxed" style={{ color: 'var(--color-muted)' }}>
        Vault Shelf is a Windows app that keeps what you copy and sends the bits you choose into Vault: a note, the Invoice Review queue,
        the CRM inbox, or a check for sensitive details. It needs a key to prove it is you. Make one here and paste it into the app, with this
        Vault address.
      </p>

      <div className="rounded-xl border p-4 flex flex-wrap items-center gap-3" style={{ ...border, background: 'var(--color-bg)' }}>
        <div className="min-w-0">
          <div className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Vault address</div>
          <div className="text-sm font-mono break-all" style={{ color: 'var(--color-text)' }}>{window.location.origin}</div>
        </div>
        <Tooltip text="Copy the Vault address to paste into the Shelf app.">
          <button type="button" onClick={() => copy(window.location.origin, 'Address')} className="px-3 py-1.5 text-sm rounded-lg border hover:opacity-70 transition-opacity inline-flex items-center gap-1.5" style={{ ...border, color: 'var(--color-text)' }}>
            {getIcon('copy', { size: 14 })} Copy
          </button>
        </Tooltip>
      </div>

      {fresh && (
        <div className="rounded-xl border p-4 space-y-2" style={{ borderColor: '#f59e0b', background: '#fef3c7' }} role="status">
          <div className="text-sm font-semibold" style={{ color: '#92400e' }}>Copy your new key now: "{fresh.label}"</div>
          <p className="text-xs" style={{ color: '#92400e' }}>
            This is the only time it is shown. Vault keeps only a fingerprint, so a lost key cannot be looked up: revoke it and make a new one.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="text-xs font-mono break-all px-2 py-1.5 rounded-lg flex-1 min-w-0" style={{ background: '#fff', color: '#1a1a1a', border: '1px solid #fcd34d' }}>{fresh.token}</code>
            <button type="button" onClick={() => copy(fresh.token, 'Key')} className="px-3 py-1.5 text-sm rounded-lg font-medium hover:opacity-70 transition-opacity inline-flex items-center gap-1.5" style={{ background: 'var(--color-primary)', color: '#fff' }}>
              {getIcon('copy', { size: 14 })} Copy key
            </button>
            <button type="button" onClick={() => setFresh(null)} className="px-3 py-1.5 text-sm rounded-lg border hover:opacity-70 transition-opacity" style={{ borderColor: '#fcd34d', color: '#92400e' }}>I have saved it</button>
          </div>
        </div>
      )}

      <form onSubmit={make} className="rounded-xl border p-4 space-y-3" style={{ ...border, background: 'var(--color-bg)' }}>
        <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Make a key</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Name (which computer is it for?)</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="Work laptop" className="px-3 py-2.5 rounded-xl border text-sm outline-none" style={field} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Lasts</span>
            <select value={expiry} onChange={(e) => setExpiry(e.target.value)} className="px-3 py-2.5 rounded-xl border text-sm outline-none" style={field}>
              {EXPIRY_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </label>
        </div>
        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>This key may</legend>
          {scopes.map((s) => (
            <label key={s.name} className="flex items-start gap-2 text-sm" style={{ color: s.available ? 'var(--color-text)' : 'var(--color-muted)' }}>
              <input
                type="checkbox"
                className="mt-0.5"
                disabled={!s.available}
                checked={!!picked[s.name] && s.available}
                onChange={(e) => setPicked((p) => ({ ...p, [s.name]: e.target.checked }))}
              />
              <span>{s.label}{!s.available && <span className="text-xs"> (switched off for your account)</span>}</span>
            </label>
          ))}
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={busy || !label.trim() || !chosen.length || activeCount >= maxActive}
            className="px-3.5 py-1.5 text-sm font-medium rounded-lg hover:opacity-70 transition-opacity disabled:opacity-40"
            style={{ background: 'var(--color-primary)', color: '#fff' }}
          >
            {busy ? 'Making…' : 'Make key'}
          </button>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
            {activeCount >= maxActive ? `You have ${maxActive} active keys. Revoke one to make another.` : `${activeCount} of ${maxActive} active keys used.`}
          </span>
        </div>
      </form>

      <div className="space-y-2">
        <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Your keys</div>
        {keys.length === 0 && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No keys yet.</p>}
        {keys.map((k) => {
          const dead = k.status !== 'active';
          return (
            <div key={k.id} className="rounded-xl border p-4 flex flex-wrap items-center gap-3" style={{ ...border, background: 'var(--color-bg)', opacity: dead ? 0.7 : 1 }}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{k.label}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={dead ? { background: '#fee2e2', color: '#991b1b' } : { background: '#dcfce7', color: '#166534' }}>{statusWord(k.status)}</span>
                  <span className="text-xs font-mono" style={{ color: 'var(--color-muted)' }}>{k.hint}</span>
                </div>
                <div className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                  {k.scopes.map((n) => scopes.find((s) => s.name === n)?.label || n).join(' · ')}
                </div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                  Made {whenText(k.createdAt)} · Last used {k.lastUsedAt ? whenText(k.lastUsedAt) : 'never'}{k.expiresAt && k.status === 'active' ? ` · Expires ${whenText(k.expiresAt, true)}` : ''}
                </div>
              </div>
              {k.status === 'active' ? (
                confirmRevoke === k.id ? (
                  <span className="text-sm inline-flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                    Revoke?
                    <button type="button" onClick={() => revoke(k)} className="font-medium hover:opacity-70 transition-opacity" style={{ color: '#ef4444' }}>Yes</button>
                    <button type="button" onClick={() => setConfirmRevoke(null)} className="hover:opacity-70 transition-opacity" style={{ color: 'var(--color-muted)' }}>No</button>
                  </span>
                ) : (
                  <Tooltip text="Stop the app using this key straight away.">
                    <button type="button" onClick={() => setConfirmRevoke(k.id)} className="px-3 py-1.5 text-sm rounded-lg border hover:opacity-70 transition-opacity" style={{ ...border, color: 'var(--color-text)' }}>Revoke</button>
                  </Tooltip>
                )
              ) : (
                <Tooltip text="Take this key off the list.">
                  <button type="button" onClick={() => remove(k)} className="px-3 py-1.5 text-sm rounded-lg border hover:opacity-70 transition-opacity inline-flex items-center gap-1.5" style={{ ...border, color: 'var(--color-muted)' }}>
                    {getIcon('trash', { size: 14 })} Remove
                  </button>
                </Tooltip>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
