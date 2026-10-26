import React, { useEffect, useState } from 'react';
import api from '../../utils/apiClient';

// "Who is this for?": a client and/or a project of the person's own, picked from the lists the rest of Vault already keeps. Both are optional.
// Reports { clientId, projectId } (numbers or null). A project that belongs to a client says so in its label, and when no client is picked the topic shows that one.
export default function LinkPicker({ clientId, projectId, onChange, idPrefix = 'tr-link' }) {
  const [clients, setClients] = useState([]);
  const [projects, setProjects] = useState([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [c, p] = await Promise.all([api.get('/api/clients'), api.get('/api/projects')]);
        const cd = c.ok ? await c.json() : [];
        const pd = p.ok ? await p.json() : [];
        if (!live) return;
        setClients(Array.isArray(cd) ? cd : []);
        setProjects(Array.isArray(pd) ? pd : []);
      } catch { if (live) setFailed(true); }
    })();
    return () => { live = false; };
  }, []);

  const field = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
  const cls = 'w-full px-3 py-2 rounded-xl border text-sm outline-none';
  const lbl = 'block text-xs mb-1';
  const num = (v) => (v === '' ? null : Number(v));

  if (failed) return <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Your clients and projects could not be loaded. You can link this later.</p>;
  if (!clients.length && !projects.length) return null;
  return (
    <div className="grid sm:grid-cols-2 gap-2" data-guide="linkpicker">
      <div>
        <label htmlFor={`${idPrefix}-client`} className={lbl} style={{ color: 'var(--color-muted)' }}>For client (optional)</label>
        <select id={`${idPrefix}-client`} value={clientId ?? ''} onChange={(e) => onChange({ clientId: num(e.target.value), projectId: projectId ?? null })} className={cls} style={field}>
          <option value="">No client</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.company ? ` — ${c.company}` : ''}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-project`} className={lbl} style={{ color: 'var(--color-muted)' }}>For project (optional)</label>
        <select id={`${idPrefix}-project`} value={projectId ?? ''} onChange={(e) => onChange({ clientId: clientId ?? null, projectId: num(e.target.value) })} className={cls} style={field}>
          <option value="">No project</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.clientName ? ` — ${p.clientName}` : ''}</option>)}
        </select>
      </div>
    </div>
  );
}
