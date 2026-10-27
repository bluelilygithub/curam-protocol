import React, { useState, useEffect, useCallback } from 'react';
import api from '../utils/apiClient';
import { relativeTime } from '../utils/relativeTime';

const KINDS = ['all', 'login', 'view', 'export', 'denied'];
const KIND_COLOUR = { login: 'var(--color-primary)', view: 'var(--color-muted)', export: '#f59e0b', denied: '#ef4444' };

export default function AccountantAccessPanel() {
  const [accountants, setAccountants] = useState([]);
  const [log, setLog] = useState([]);
  const [kind, setKind] = useState('all');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', expiresAt: '' });
  const [copied, setCopied] = useState(false);

  const link = `${window.location.origin}/login?next=/finance`;

  const load = useCallback(async () => {
    try {
      const [a, l] = await Promise.all([
        api.get('/api/admin/accountants').then((r) => r.json()),
        api.get(`/api/admin/accountants/log?limit=200${kind === 'all' ? '' : `&kind=${kind}`}`).then((r) => r.json()),
      ]);
      setAccountants(a.accountants || []);
      setLog(l.log || []);
    } catch (err) {
      setError(err.message || 'Failed to load');
    }
  }, [kind]);

  useEffect(() => { load(); }, [load]);

  const call = async (fn) => {
    setError('');
    setBusy(true);
    try {
      const res = await fn();
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      await load();
      return true;
    } catch (err) {
      setError(err.message || 'Request failed');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const create = async (e) => {
    e.preventDefault();
    const ok = await call(() => api.post('/api/admin/accountants', {
      email: form.email.trim(),
      password: form.password,
      expiresAt: form.expiresAt ? new Date(`${form.expiresAt}T23:59:59`).toISOString() : undefined,
    }));
    if (ok) setForm({ email: '', password: '', expiresAt: '' });
  };

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  };

  const inputStyle = { borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' };
  const btn = 'px-2.5 py-1 rounded-md text-xs border hover:opacity-70 transition-opacity disabled:opacity-50';
  const btnStyle = { borderColor: 'var(--color-border)', color: 'var(--color-muted)' };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Accountant access</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
          Read-only view of your Finance, and of your Shares if you turn that on for them, nothing else. Every sign-in, page view, export and refused attempt is recorded below and cannot be edited or deleted.
        </p>
      </div>

      <div className="rounded-2xl border p-4 space-y-2" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <div className="text-xs" style={{ color: 'var(--color-muted)' }}>Direct link for your accountant (signs in, then opens Finance)</div>
        <div className="flex items-center gap-2 flex-wrap">
          <code className="text-xs px-2 py-1 rounded border break-all" style={inputStyle}>{link}</code>
          <button onClick={copyLink} className={btn} style={btnStyle}>{copied ? 'Copied' : 'Copy'}</button>
        </div>
      </div>

      <form onSubmit={create} className="rounded-2xl border p-4 space-y-3" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <div className="grid sm:grid-cols-3 gap-3">
          <input type="email" required placeholder="accountant@example.com" value={form.email}
            onChange={(e) => setForm((v) => ({ ...v, email: e.target.value }))}
            className="px-3 py-2 rounded-lg border text-sm outline-none" style={inputStyle} />
          <input type="password" required minLength={12} placeholder="Password (min 12 chars)" value={form.password}
            onChange={(e) => setForm((v) => ({ ...v, password: e.target.value }))}
            className="px-3 py-2 rounded-lg border text-sm outline-none" style={inputStyle} />
          <input type="date" title="Access ends on (optional)" value={form.expiresAt}
            onChange={(e) => setForm((v) => ({ ...v, expiresAt: e.target.value }))}
            className="px-3 py-2 rounded-lg border text-sm outline-none" style={inputStyle} />
        </div>
        <button type="submit" disabled={busy}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 hover:opacity-80 transition-opacity"
          style={{ background: 'var(--color-primary)' }}>
          Create accountant login
        </button>
      </form>

      {error && <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>}

      {accountants.length > 0 && (
        <div className="rounded-2xl border divide-y" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          {accountants.map((a) => {
            const ended = a.disabledAt || (a.accessExpiresAt && new Date(a.accessExpiresAt) < new Date());
            return (
              <div key={a.id} className="p-3 flex items-center justify-between gap-3 flex-wrap" style={{ borderColor: 'var(--color-border)' }}>
                <div>
                  <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{a.email}</div>
                  <div className="text-xs" style={{ color: ended ? '#ef4444' : 'var(--color-muted)' }}>
                    {a.disabledAt ? 'Disabled' : ended ? 'Expired' : a.accessExpiresAt ? `Ends ${new Date(a.accessExpiresAt).toLocaleDateString()}` : 'No end date'}
                    {' · '}can see: Finance{a.sharesAccess ? ' and Shares' : ' only'}, read-only{' · '}last sign-in {a.lastLoginAt ? relativeTime(a.lastLoginAt) : 'never'}
                    {a.activeSessions > 0 && ` · ${a.activeSessions} active session${a.activeSessions === 1 ? '' : 's'}`}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button disabled={busy} className={btn} style={btnStyle}
                    title="Read-only view of your Shares: portfolio, trades, cash and dividends, CGT, statements. Your Questions history stays private."
                    onClick={() => call(() => api.put(`/api/admin/accountants/${a.id}`, { shares: !a.sharesAccess }))}>
                    {a.sharesAccess ? 'Shares: on (turn off)' : 'Shares: off (turn on)'}
                  </button>
                  <button disabled={busy} className={btn} style={btnStyle}
                    onClick={() => call(() => api.put(`/api/admin/accountants/${a.id}`, { disabled: !a.disabledAt }))}>
                    {a.disabledAt ? 'Re-enable' : 'Disable now'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="rounded-2xl border overflow-x-auto" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        <div className="p-3 flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Activity log</span>
          {KINDS.map((k) => (
            <button key={k} onClick={() => setKind(k)} className={btn}
              style={{ ...btnStyle, ...(kind === k ? { color: 'var(--color-text)', borderColor: 'var(--color-text)' } : {}) }}>{k}</button>
          ))}
          <button onClick={load} className={btn} style={btnStyle}>Refresh</button>
        </div>
        {log.length === 0 ? (
          <p className="px-3 pb-3 text-sm" style={{ color: 'var(--color-muted)' }}>Nothing recorded yet.</p>
        ) : (
          <table className="w-full text-xs min-w-[640px]" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderTop: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' }}>
                {['When', 'Who', 'What', 'Where', 'Result', 'IP'].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {log.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td className="px-3 py-1.5 whitespace-nowrap" style={{ color: 'var(--color-muted)' }}>{new Date(r.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-1.5" style={{ color: 'var(--color-text)' }}>{r.actorEmail}</td>
                  <td className="px-3 py-1.5 font-medium" style={{ color: KIND_COLOUR[r.kind] }}>{r.kind}</td>
                  <td className="px-3 py-1.5 break-all" style={{ color: 'var(--color-text)' }}>
                    {r.method} {r.path}{r.query ? `?${r.query}` : ''}
                  </td>
                  <td className="px-3 py-1.5" style={{ color: 'var(--color-muted)' }}>{r.status}</td>
                  <td className="px-3 py-1.5" style={{ color: 'var(--color-muted)' }}>{r.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
