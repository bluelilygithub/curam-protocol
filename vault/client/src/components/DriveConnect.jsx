import React, { useEffect, useState } from 'react';
import api from '../utils/apiClient';
import ConfirmModal from './ConfirmModal';

function DriveConnect() {
  const [status, setStatus] = useState(null); // null = loading
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const load = async () => {
    try {
      const res  = await api.get('/api/gmail/status');
      const data = await res.json();
      setStatus(data);
    } catch {
      setStatus({ connected: false, configured: false, hasDriveScope: false });
    }
  };

  useEffect(() => {
    load();
    const params = new URLSearchParams(window.location.search);
    if (params.get('gmailConnected')) load();
  }, []);

  const handleDisconnect = async () => {
    setConfirmOpen(false);
    setDisconnecting(true);
    setError('');
    try {
      await api.post('/api/gmail/disconnect');
      await load();
    } catch (err) {
      setError(err.message || 'Failed to disconnect Google Drive');
    } finally {
      setDisconnecting(false);
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    setError('');
    try {
      const res  = await api.get('/api/gmail/auth');
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      if (data.authUrl) window.location.href = data.authUrl;
    } catch (err) {
      setError(err.message || 'Failed to start Google connection');
    } finally {
      setConnecting(false);
    }
  };

  if (status === null) {
    return <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Loading…</p>;
  }

  if (!status.configured) {
    return (
      <div className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
        <p className="font-medium mb-1" style={{ color: 'var(--color-text)' }}>Google Drive not configured</p>
        <p className="text-xs">Add <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>, and <code>GOOGLE_REDIRECT_URI</code> to your environment variables to enable Drive backup.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border px-4 py-3" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span style={{ fontSize: 22 }}>☁️</span>
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Google Drive Backup</p>
            {status.hasDriveScope
              ? <p className="text-xs mt-0.5" style={{ color: '#22c55e' }}>Connected as {status.email} · Backup available in Admin</p>
              : status.connected
              ? <p className="text-xs mt-0.5" style={{ color: '#f59e0b' }}>Reconnect Google to grant Drive access</p>
              : <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>Not connected · Required for Admin → Backups</p>
            }
          </div>
        </div>
        {confirmOpen && (
          <ConfirmModal
            title="Disconnect Google Drive"
            message="This also disconnects Gmail and Calendar as they share the same Google account. You can reconnect at any time."
            confirmLabel="Disconnect"
            danger
            onConfirm={handleDisconnect}
            onCancel={() => setConfirmOpen(false)}
          />
        )}
        {status.hasDriveScope ? (
          <button
            onClick={() => setConfirmOpen(true)}
            disabled={disconnecting}
            className="flex-shrink-0 text-xs px-3 py-1.5 rounded-lg border transition-opacity"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', opacity: disconnecting ? 0.5 : 1 }}
          >
            {disconnecting ? 'Disconnecting…' : 'Disconnect'}
          </button>
        ) : (
          <button
            onClick={handleConnect}
            disabled={connecting}
            className="flex-shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg transition-opacity"
            style={{ background: 'var(--color-primary)', color: '#fff', opacity: connecting ? 0.5 : 1 }}
          >
            {connecting ? 'Redirecting…' : status.connected ? 'Reconnect Google' : 'Connect Google'}
          </button>
        )}
      </div>
      {!status.hasDriveScope && (
        <p className="mt-2 text-xs" style={{ color: 'var(--color-muted)' }}>
          Grants read/write access only to files Vault creates — it cannot see any other files in your Drive.
        </p>
      )}
      {error && (
        <p className="mt-2 text-xs px-1" style={{ color: '#ef4444' }}>{error}</p>
      )}
    </div>
  );
}

export default DriveConnect;
