import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useIcon } from '../providers/IconProvider';
import api from '../utils/apiClient';
import Tooltip from '../components/Tooltip';

const PROFILE_FIELDS = [
  { key: 'user_name', label: 'Name', autoComplete: 'name' },
  { key: 'user_city', label: 'City', autoComplete: 'address-level2' },
  { key: 'user_state', label: 'State / Region', autoComplete: 'address-level1' },
  { key: 'browser_agent_phone', label: 'Phone', type: 'tel', autoComplete: 'tel' },
  { key: 'browser_agent_email', label: 'Email', type: 'email', autoComplete: 'email' },
  { key: 'browser_agent_address', label: 'Street address', autoComplete: 'street-address', wide: true },
];

export default function BrowserAgentSettingsPage() {
  const getIcon = useIcon();
  const [profile, setProfile] = useState(null);
  const [savedField, setSavedField] = useState('');

  const [credentials, setCredentials] = useState(null);
  const [showAddCred, setShowAddCred] = useState(false);
  const [credLabel, setCredLabel] = useState('');
  const [credDomain, setCredDomain] = useState('');
  const [credUsername, setCredUsername] = useState('');
  const [credPassword, setCredPassword] = useState('');
  const [credError, setCredError] = useState('');
  const [savingCred, setSavingCred] = useState(false);

  useEffect(() => {
    api.get('/api/settings').then((res) => (res.ok ? res.json() : {})).then(setProfile).catch(() => setProfile({}));
  }, []);

  const loadCredentials = useCallback(() => {
    api.get('/api/browser-agent/credentials').then((res) => (res.ok ? res.json() : [])).then(setCredentials).catch(() => setCredentials([]));
  }, []);
  useEffect(() => { loadCredentials(); }, [loadCredentials]);

  function saveField(key, value) {
    setProfile((p) => ({ ...p, [key]: value }));
  }

  function commitField(key, value) {
    api.post('/api/settings', { key, value }).then(() => {
      setSavedField(key);
      setTimeout(() => setSavedField((f) => (f === key ? '' : f)), 1200);
    }).catch(() => {});
  }

  async function addCredential(e) {
    e.preventDefault();
    setCredError('');
    if (!credLabel.trim() || !credDomain.trim() || !credUsername.trim() || !credPassword) {
      setCredError('Label, site, username and password are all required.');
      return;
    }
    setSavingCred(true);
    try {
      const res = await api.post('/api/browser-agent/credentials', {
        label: credLabel.trim(), domain: credDomain.trim(), username: credUsername.trim(), password: credPassword,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Could not save.');
      }
      setCredLabel(''); setCredDomain(''); setCredUsername(''); setCredPassword('');
      setShowAddCred(false);
      loadCredentials();
    } catch (err) {
      setCredError(err.message);
    } finally {
      setSavingCred(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-5">
      <Link to="/browser-agent" className="text-sm hover:opacity-60 flex items-center gap-1 mb-4" style={{ color: 'var(--color-muted)' }}>
        {getIcon('arrow-left', { size: 15 })} Browser Agent
      </Link>

      <h1 className="text-lg font-semibold mb-1">Browser Agent Settings</h1>
      <p className="text-sm mb-5" style={{ color: 'var(--color-muted)' }}>
        Details the agent uses to fill out forms, and saved logins for sites you control.
      </p>

      <section className="rounded-2xl border p-4 mb-5" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <h2 className="text-sm font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--color-muted)' }}>Your details</h2>
        {!profile ? (
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {PROFILE_FIELDS.map((f) => (
              <div key={f.key} className={f.wide ? 'col-span-2' : ''}>
                <label className="block text-xs mb-1 flex items-center gap-1.5" style={{ color: 'var(--color-muted)' }}>
                  {f.label}
                  {savedField === f.key && <span style={{ color: '#166534' }}>Saved</span>}
                </label>
                <input
                  type={f.type || 'text'}
                  autoComplete={f.autoComplete}
                  value={profile[f.key] || ''}
                  onChange={(e) => saveField(f.key, e.target.value)}
                  onBlur={(e) => commitField(f.key, e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />
              </div>
            ))}
          </div>
        )}
        <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>
          Never invented by the agent — a missing required field is asked for live, during a run.
        </p>
      </section>

      <section className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold uppercase tracking-widest" style={{ color: 'var(--color-muted)' }}>Saved site logins</h2>
          <button
            type="button"
            className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-60"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={() => setShowAddCred((s) => !s)}
          >
            {showAddCred ? 'Cancel' : '+ Add'}
          </button>
        </div>
        <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>
          Only add logins for sites you control. Passwords are encrypted at rest and never shown again here, and are never sent to the AI model — the agent fills them directly into the login form when asked to sign in, then still hands control back to you before anything is submitted.
        </p>

        {showAddCred && (
          <form onSubmit={addCredential} className="rounded-lg border p-3 mb-3 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <div className="grid grid-cols-2 gap-2">
              <input
                placeholder="Label (e.g. My WordPress site)"
                value={credLabel}
                onChange={(e) => setCredLabel(e.target.value)}
                className="px-3 py-2 rounded-lg border text-sm outline-none"
                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
              <input
                placeholder="Site (e.g. example.com.au)"
                value={credDomain}
                onChange={(e) => setCredDomain(e.target.value)}
                className="px-3 py-2 rounded-lg border text-sm outline-none"
                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
              <input
                placeholder="Username"
                autoComplete="off"
                value={credUsername}
                onChange={(e) => setCredUsername(e.target.value)}
                className="px-3 py-2 rounded-lg border text-sm outline-none"
                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
              <input
                type="password"
                placeholder="Password"
                autoComplete="new-password"
                value={credPassword}
                onChange={(e) => setCredPassword(e.target.value)}
                className="px-3 py-2 rounded-lg border text-sm outline-none"
                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
            </div>
            {credError && <p className="text-xs" style={{ color: '#ef4444' }}>{credError}</p>}
            <button
              type="submit"
              disabled={savingCred}
              className="w-full rounded-lg px-3 py-2 text-sm font-medium hover:opacity-70 disabled:opacity-40"
              style={{ background: 'var(--color-text)', color: 'var(--color-bg)' }}
            >
              Save login
            </button>
          </form>
        )}

        {credentials === null ? (
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>
        ) : credentials.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No saved logins yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {credentials.map((c) => (
              <li key={c.id} className="flex items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--color-border)' }}>
                <Tooltip text={c.pinned ? 'Unpin' : 'Pin to top'}>
                  <button
                    type="button"
                    className="flex-none hover:opacity-60"
                    style={{ color: c.pinned ? '#d9892b' : 'var(--color-muted)' }}
                    onClick={async () => {
                      await api.post(`/api/browser-agent/credentials/${c.id}/pin`, { pinned: !c.pinned });
                      loadCredentials();
                    }}
                  >
                    {getIcon('star', { size: 14 })}
                  </button>
                </Tooltip>
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{c.label}</p>
                  <p className="text-xs truncate" style={{ color: 'var(--color-muted)' }}>{c.domain} · {c.username}</p>
                </div>
                <CredentialDeleteButton id={c.id} onDeleted={loadCredentials} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CredentialDeleteButton({ id, onDeleted }) {
  const getIcon = useIcon();
  async function handleDelete() {
    await api.delete(`/api/browser-agent/credentials/${id}`).catch(() => {});
    onDeleted();
  }
  return (
    <Tooltip text="Delete">
      <button
        type="button"
        className="flex-none text-xs px-2 py-1 rounded-lg hover:opacity-60"
        style={{ color: '#ef4444' }}
        onClick={handleDelete}
      >
        {getIcon('trash', { size: 14 })}
      </button>
    </Tooltip>
  );
}
