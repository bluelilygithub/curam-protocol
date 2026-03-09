import React, { useEffect, useState } from 'react';
import api from '../utils/apiClient';

function GmailConnect() {
  const [status, setStatus] = useState(null); // null = loading
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const res = await api.get('/api/gmail/status');
      const data = await res.json();
      setStatus(data);
    } catch {
      setStatus({ connected: false, configured: false, email: null });
    }
  };

  useEffect(() => {
    load();
    // Check for OAuth result in URL on mount
    const params = new URLSearchParams(window.location.search);
    const gmailConnected = params.get('gmailConnected');
    const gmailError = params.get('gmailError');
    if (gmailConnected) {
      // Clean up URL and reload status
      window.history.replaceState({}, '', window.location.pathname);
      load();
    }
    if (gmailError) {
      setError(decodeURIComponent(gmailError));
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleConnect = async () => {
    setConnecting(true);
    setError('');
    try {
      const res = await api.get('/api/gmail/auth');
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      if (data.authUrl) {
        window.location.href = data.authUrl;
      }
    } catch (err) {
      setError(err.message || 'Failed to start Gmail connection');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect Gmail? You can reconnect at any time.')) return;
    setDisconnecting(true);
    setError('');
    try {
      await api.post('/api/gmail/disconnect');
      await load();
    } catch (err) {
      setError(err.message || 'Failed to disconnect Gmail');
    } finally {
      setDisconnecting(false);
    }
  };

  if (status === null) {
    return <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Loading…</p>;
  }

  if (!status.configured) {
    return (
      <div className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
        <p className="font-medium mb-1" style={{ color: 'var(--color-text)' }}>Gmail not configured</p>
        <p className="text-xs">Add <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>, and <code>GOOGLE_REDIRECT_URI</code> to your environment variables to enable Gmail integration.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border px-4 py-3" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span style={{ fontSize: 22 }}>✉️</span>
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Gmail</p>
            {status.connected
              ? <p className="text-xs mt-0.5" style={{ color: '#22c55e' }}>Connected as {status.email}</p>
              : <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>Not connected · Use <code>@gmail</code> in chat to search emails</p>
            }
          </div>
        </div>
        {status.connected ? (
          <button
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="text-xs px-3 py-1.5 rounded-lg border transition-opacity"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', opacity: disconnecting ? 0.5 : 1 }}
          >
            {disconnecting ? 'Disconnecting…' : 'Disconnect'}
          </button>
        ) : (
          <button
            onClick={handleConnect}
            disabled={connecting}
            className="text-xs font-medium px-3 py-1.5 rounded-lg transition-opacity"
            style={{ background: 'var(--color-primary)', color: '#fff', opacity: connecting ? 0.5 : 1 }}
          >
            {connecting ? 'Redirecting…' : 'Connect Gmail'}
          </button>
        )}
      </div>
      {error && (
        <p className="mt-2 text-xs px-1" style={{ color: '#ef4444' }}>{error}</p>
      )}
    </div>
  );
}

export default GmailConnect;
