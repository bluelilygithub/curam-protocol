import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import api from '../utils/apiClient';
import useAuthStore from '../store/authStore';
import { useIcon } from '../providers/IconProvider';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';

const FIELD = 'px-3 py-2.5 rounded-xl border text-sm outline-none';
const FIELD_STYLE = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const POLL_MS = 5000;

function formatWhen(iso) {
  if (!iso) return '';
  try { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)); } catch { return iso; }
}

function CopyButton({ value, label = 'Copy', className = '' }) {
  const getIcon = useIcon();
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked */ }
  };
  return (
    <button
      type="button" onClick={copy}
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs hover:opacity-70 transition-opacity ${className}`}
      style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
    >
      {getIcon(done ? 'check' : 'copy', { size: 12 })}{done ? 'Copied' : label}
    </button>
  );
}

function MessageCard({ message, onDelete }) {
  const getIcon = useIcon();
  const [showBody, setShowBody] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const codes = message.codes || [];
  const links = message.links || [];
  return (
    <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium break-words" style={{ color: 'var(--color-text)' }}>{message.subject || '(no subject)'}</p>
          <p className="text-xs break-all" style={{ color: 'var(--color-muted)' }}>{message.fromAddr} · {formatWhen(message.receivedAt)}</p>
        </div>
        {confirming ? (
          <span className="text-xs shrink-0" style={{ color: 'var(--color-muted)' }}>
            Delete?{' '}
            <button type="button" className="underline hover:opacity-70" style={{ color: '#ef4444' }} onClick={() => onDelete(message.id)}>Yes</button>
            {' / '}
            <button type="button" className="underline hover:opacity-70" onClick={() => setConfirming(false)}>No</button>
          </span>
        ) : (
          <button type="button" title="Delete email" onClick={() => setConfirming(true)} className="shrink-0 opacity-60 hover:opacity-100 transition-opacity" style={{ color: 'var(--color-muted)' }}>
            {getIcon('trash', { size: 14 })}
          </button>
        )}
      </div>

      {codes.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{codes.length === 1 ? 'Code' : 'Possible codes'}</span>
          {codes.map((c) => (
            <span key={c} className="inline-flex items-center gap-2 rounded-lg border px-2.5 py-1" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
              <span className="font-mono text-base font-semibold tracking-widest" style={{ color: 'var(--color-text)' }}>{c}</span>
              <CopyButton value={c} />
            </span>
          ))}
        </div>
      )}

      {links.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Links in this email. Check the site name before you open one.</span>
          {links.map((l) => (
            <div key={l.url} className="flex items-center gap-2 text-xs">
              <span className="flex-1 min-w-0 truncate" style={{ color: 'var(--color-text)' }} title={l.url}>
                {l.likely && <span className="mr-1.5 px-1.5 py-0.5 rounded" style={{ background: 'var(--color-primary)', color: '#fff' }}>confirm</span>}
                <strong>{l.host}</strong>{l.label ? ` · ${l.label}` : ''}
              </span>
              <CopyButton value={l.url} label="Copy link" />
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border hover:opacity-70 transition-opacity" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                {getIcon('external-link', { size: 12 })}Open
              </a>
            </div>
          ))}
        </div>
      )}

      {message.bodyText && (
        <div>
          <button type="button" className="text-xs underline hover:opacity-70" style={{ color: 'var(--color-primary)' }} onClick={() => setShowBody((v) => !v)}>
            {showBody ? 'Hide full text' : 'Show full text'}
          </button>
          {showBody && <pre className="mt-2 text-xs whitespace-pre-wrap break-words leading-relaxed" style={{ color: 'var(--color-text)', fontFamily: 'inherit' }}>{message.bodyText}</pre>}
        </div>
      )}
    </div>
  );
}

export default function BurnerMailPage() {
  const getIcon = useIcon();
  const isAdmin = useAuthStore((s) => s.user?.isAdmin);
  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const canUse = isAdmin || featureAccess.burnerMail !== false;
  const [status, setStatus] = useState(null);
  const [addresses, setAddresses] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [label, setLabel] = useState('');
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmId, setConfirmId] = useState(null);
  const [checkedAt, setCheckedAt] = useState(null);
  const selectedRef = useRef(null);
  selectedRef.current = selectedId;

  useEffect(() => {
    api.get('/api/settings/feature-access').then((r) => r.json()).then((d) => { if (d?.flags) setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...d.flags }); }).catch(() => {});
  }, []);

  const loadAddresses = useCallback(async () => {
    try {
      const r = await api.get('/api/burner-mail/addresses');
      if (!r.ok) return;
      const list = await r.json();
      setAddresses(list);
      setSelectedId((cur) => (cur && list.some((a) => a.id === cur) ? cur : list[0]?.id ?? null));
    } catch { /* offline: keep what is shown */ }
  }, []);

  const loadMessages = useCallback(async () => {
    const id = selectedRef.current;
    if (!id) { setMessages([]); return; }
    try {
      const r = await api.get(`/api/burner-mail/addresses/${id}/messages`);
      if (r.ok && selectedRef.current === id) { setMessages(await r.json()); setCheckedAt(new Date()); }
    } catch { /* try again on the next check */ }
  }, []);

  useEffect(() => {
    api.get('/api/burner-mail/status').then((r) => r.json()).then(setStatus).catch(() => setStatus({ configured: false }));
    loadAddresses();
  }, [loadAddresses]);

  // check for new mail every few seconds while the page is open and visible
  useEffect(() => {
    setMessages([]);
    loadMessages();
    const t = setInterval(() => { if (!document.hidden) { loadMessages(); loadAddresses(); } }, POLL_MS);
    return () => clearInterval(t);
  }, [selectedId, loadMessages, loadAddresses]);

  const create = async () => {
    setBusy(true); setError('');
    try {
      const r = await api.post('/api/burner-mail/addresses', { label, days });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Could not make an address.'); return; }
      setLabel('');
      setAddresses((a) => [d, ...a]);
      setSelectedId(d.id);
    } catch { setError('Could not reach the server.'); } finally { setBusy(false); }
  };

  const removeAddress = async (id) => {
    setConfirmId(null);
    try { await api.delete(`/api/burner-mail/addresses/${id}`); } catch { /* list reload shows the truth */ }
    loadAddresses();
  };

  const removeMessage = async (id) => {
    try { await api.delete(`/api/burner-mail/messages/${id}`); } catch { /* reload shows the truth */ }
    loadMessages();
  };

  if (!canUse) return <Navigate to="/" replace />;
  const selected = addresses.find((a) => a.id === selectedId);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto p-4 sm:p-6">
      <div className="w-full max-w-4xl mx-auto space-y-5">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Burner Mail</h1>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-muted)' }}>
            Make a throw-away email address for a web sign-up. When the site sends its verification email, the code and confirm link show up here. Nothing is opened for you.
          </p>
        </div>

        {status && !status.configured && (
          <div className="rounded-xl border p-4 text-sm leading-relaxed" style={{ borderColor: '#f59e0b', background: '#fef3c7', color: '#b45309' }}>
            Burner Mail is not set up yet. The owner needs to add a mail domain and a secret on the server. The steps are in <strong>docs/burner-mail.md</strong>.
          </div>
        )}

        <div className="rounded-2xl border p-6 space-y-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>New address</h2>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              className={`${FIELD} flex-1`} style={FIELD_STYLE} placeholder="What is it for? (optional, e.g. Spotify)"
              aria-label="What the address is for" value={label} maxLength={60}
              onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !busy && create()}
            />
            <select className={FIELD} style={FIELD_STYLE} aria-label="How long to keep it" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {(status?.lifetimes || [1, 7, 30]).map((d) => <option key={d} value={d}>{d === 1 ? 'Keep 1 day' : `Keep ${d} days`}</option>)}
            </select>
            <button
              type="button" onClick={create} disabled={busy || (status && !status.configured)}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium hover:opacity-70 transition-opacity disabled:opacity-40"
              style={{ background: 'var(--color-primary)', color: '#fff' }}
            >
              {getIcon('plus', { size: 14 })}Make address
            </button>
          </div>
          {error && <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>}
        </div>

        <div className="grid gap-5 sm:grid-cols-[18rem_1fr]">
          <div className="space-y-2">
            {addresses.length === 0 && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No addresses yet.</p>}
            {addresses.map((a) => (
              <div
                key={a.id}
                className="rounded-xl border p-3 cursor-pointer transition-all"
                style={{ borderColor: a.id === selectedId ? 'var(--color-primary)' : 'var(--color-border)', background: 'var(--color-surface)' }}
                onClick={() => setSelectedId(a.id)}
              >
                <p className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>{a.label || 'Sign-up'}</p>
                <p className="text-xs break-all font-mono" style={{ color: 'var(--color-muted)' }}>{a.address}</p>
                <div className="flex items-center justify-between mt-1.5 text-xs" style={{ color: 'var(--color-muted)' }} onClick={(e) => e.stopPropagation()}>
                  <span>{a.messageCount} email{a.messageCount === 1 ? '' : 's'}</span>
                  {confirmId === a.id ? (
                    <span>Delete? <button type="button" className="underline hover:opacity-70" style={{ color: '#ef4444' }} onClick={() => removeAddress(a.id)}>Yes</button> / <button type="button" className="underline hover:opacity-70" onClick={() => setConfirmId(null)}>No</button></span>
                  ) : (
                    <button type="button" title="Delete address and its emails" className="opacity-60 hover:opacity-100 transition-opacity" onClick={() => setConfirmId(a.id)}>{getIcon('trash', { size: 13 })}</button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-3 min-w-0">
            {selected && (
              <div className="rounded-2xl border p-4 space-y-2" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm break-all flex-1 min-w-0" style={{ color: 'var(--color-text)' }}>{selected.address}</span>
                  <CopyButton value={selected.address} label="Copy address" />
                </div>
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  Waiting for mail. Checks every few seconds{checkedAt ? `, last at ${checkedAt.toLocaleTimeString()}` : ''}. Expires {formatWhen(selected.expiresAt)}.
                </p>
              </div>
            )}
            {selected && messages.length === 0 && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Nothing has arrived yet. Use the address on the sign-up form, then wait here.</p>}
            {messages.map((m) => <MessageCard key={m.id} message={m} onDelete={removeMessage} />)}
          </div>
        </div>
      </div>
    </div>
  );
}
