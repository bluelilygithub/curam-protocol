import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/apiClient';
import useToastStore from '../store/toastStore';

// A project's client, shown on the project's own page and changeable there (it could only be set when the project was made). The client's page
// lists its projects from the same link, so changing it here changes it there. Quiet when the person has no clients.
export default function ProjectClientControl({ project, onChanged }) {
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const [clients, setClients] = useState([]);
  const [editing, setEditing] = useState(false);
  const [pick, setPick] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await api.get('/api/clients');
        const d = r.ok ? await r.json() : [];
        if (live && Array.isArray(d)) setClients(d);
      } catch { /* no list: the control stays hidden */ }
    })();
    return () => { live = false; };
  }, []);

  if (!clients.length && !project.clientId) return null;
  const save = async (clientId) => {
    setSaving(true);
    try {
      const r = await api.put(`/api/projects/${project.id}`, { clientId });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not change the client.');
      addToast(clientId ? 'Client changed' : 'Client removed');
      setEditing(false);
      if (onChanged) await onChanged();
    } catch (e) { addToast(e.message || 'Could not change the client.', 'error'); } finally { setSaving(false); }
  };

  const field = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
  return (
    <div className="rounded-xl border p-4 flex flex-wrap items-center gap-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }} data-guide="project-client">
      <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Client</span>
      {!editing ? (
        <>
          {project.clientId && project.clientName ? (
            <button type="button" onClick={() => navigate(`/clients/${project.clientId}`)} className="text-sm hover:opacity-70 transition-opacity" style={{ color: 'var(--color-primary)' }}>{project.clientName}</button>
          ) : (
            <span className="text-sm" style={{ color: 'var(--color-muted)' }}>None yet</span>
          )}
          <button type="button" onClick={() => { setPick(project.clientId ? String(project.clientId) : ''); setEditing(true); }} className="text-xs underline hover:opacity-70 transition-opacity" style={{ color: 'var(--color-muted)' }}>{project.clientId ? 'Change' : 'Choose'}</button>
          {project.clientId && <button type="button" onClick={() => save(null)} disabled={saving} className="text-xs underline hover:opacity-70 transition-opacity disabled:opacity-40" style={{ color: 'var(--color-muted)' }}>Remove</button>}
        </>
      ) : (
        <>
          <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Client for this project" className="px-3 py-2 rounded-xl border text-sm outline-none" style={field}>
            <option value="">No client</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.company ? ` — ${c.company}` : ''}</option>)}
          </select>
          <button type="button" onClick={() => save(pick ? Number(pick) : null)} disabled={saving} className="px-3 py-1.5 rounded-lg text-sm font-medium hover:opacity-70 transition-opacity disabled:opacity-40" style={{ background: 'var(--color-primary)', color: '#fff' }}>Save</button>
          <button type="button" onClick={() => setEditing(false)} className="px-3 py-1.5 rounded-lg text-sm font-medium border hover:opacity-70 transition-opacity" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Cancel</button>
        </>
      )}
    </div>
  );
}
