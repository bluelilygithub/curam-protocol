import React, { useEffect, useState } from 'react';
import api from '../utils/apiClient';

function CalendarConnect() {
  const [status, setStatus] = useState(null); // null = loading
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const res = await api.get('/api/calendar/status');
      const data = await res.json();
      setStatus(data);
    } catch {
      setStatus({ connected: false, configured: false, hasCalendarScope: false, googleConnected: false, email: null });
    }
  };

  useEffect(() => {
    load();
    // Recheck status after OAuth redirect (gmailConnected param is set by the callback)
    const params = new URLSearchParams(window.location.search);
    if (params.get('gmailConnected')) load();
  }, []);

  const handleConnect = async () => {
    setConnecting(true);
    setError('');
    try {
      const res = await api.get('/api/gmail/auth');
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
        <p className="font-medium mb-1" style={{ color: 'var(--color-text)' }}>Google Calendar not configured</p>
        <p className="text-xs">Add <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>, and <code>GOOGLE_REDIRECT_URI</code> to your environment variables to enable Calendar integration.</p>
      </div>
    );
  }

  const needsReconnect = status.googleConnected && !status.hasCalendarScope;

  return (
    <div className="rounded-lg border px-4 py-3" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span style={{ fontSize: 22 }}>📅</span>
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Google Calendar</p>
            {status.connected
              ? <p className="text-xs mt-0.5" style={{ color: '#22c55e' }}>Connected as {status.email} · Use <code>@calendar</code> in chat</p>
              : needsReconnect
              ? <p className="text-xs mt-0.5" style={{ color: '#f59e0b' }}>Reconnect Google to enable Calendar access</p>
              : <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>Not connected · Use <code>@calendar</code> in chat to search events</p>
            }
          </div>
        </div>
        {!status.connected && (
          <button
            onClick={handleConnect}
            disabled={connecting}
            className="text-xs font-medium px-3 py-1.5 rounded-lg transition-opacity"
            style={{ background: 'var(--color-primary)', color: '#fff', opacity: connecting ? 0.5 : 1 }}
          >
            {connecting ? 'Redirecting…' : needsReconnect ? 'Reconnect Google' : 'Connect Google'}
          </button>
        )}
      </div>
      {!status.connected && (
        <p className="mt-2 text-xs" style={{ color: 'var(--color-muted)' }}>
          Connecting grants read-only Calendar access alongside Gmail. Both use the same Google account and OAuth flow.
        </p>
      )}
      {error && (
        <p className="mt-2 text-xs px-1" style={{ color: '#ef4444' }}>{error}</p>
      )}
    </div>
  );
}

export default CalendarConnect;
