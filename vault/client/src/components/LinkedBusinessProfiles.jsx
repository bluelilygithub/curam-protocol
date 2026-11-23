import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../utils/apiClient';

// The Business Profiler profiles filed under a client, for that client's page (the "Business profiles" tab). Quiet by design, like
// LinkedResearch: null (no tab) while loading, when Business Profiler is off for the person (403) or when the request fails.

/** The linked profiles, or null while loading or when Business Profiler is not available to this person. */
export function useLinkedProfiles(clientId) {
  const [profiles, setProfiles] = useState(null);
  useEffect(() => {
    let live = true;
    setProfiles(null);
    if (!clientId) return undefined;
    api.get(`/api/bip/linked?clientId=${encodeURIComponent(clientId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d && Array.isArray(d.profiles)) setProfiles(d.profiles); })
      .catch(() => { /* the tab is a courtesy */ });
    return () => { live = false; };
  }, [clientId]);
  return profiles;
}

export function BusinessProfileList({ profiles }) {
  const muted = { color: 'var(--color-muted)' };
  const day = (d) => (d ? new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  return (
    <div className="space-y-2 pt-3" data-guide="linked-bip">
      {!profiles.length && (
        <p className="text-sm" style={muted}>No business profiles are linked here yet. In Business Profiler, open a profile and use Create client from profile or Link in its Notes & client box.</p>
      )}
      {profiles.map((p) => (
        <div key={p.id} className="text-sm">
          <Link to={`/bip/${p.id}`} className="font-medium underline hover:opacity-70 transition-opacity break-words" style={{ color: 'var(--color-primary)' }}>{p.businessName || p.domain}</Link>
          <span className="text-xs" style={muted}> · {p.domain} · {p.status === 'done' ? `profiled ${day(p.scannedAt || p.createdAt)}` : p.status}</span>
        </div>
      ))}
    </div>
  );
}
