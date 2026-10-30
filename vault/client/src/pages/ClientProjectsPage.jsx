import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../utils/apiClient';
import useToastStore from '../store/toastStore';

// One list of every client project: client, status, next due task.
// A client project is a project with type "client" (server/routes/clientProjects.js).

export const STATUS_LABELS = { active: 'Active', waiting: 'Waiting', done: 'Done' };

const FIELD = { background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };

function fmtDue(d) {
  if (!d) return '';
  const s = String(d).slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const label = new Date(`${s}T12:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  return s < today ? `${label} (overdue)` : label;
}

export function StatusSelect({ value, onChange, disabled }) {
  return (
    <select
      value={value || 'active'}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
      onClick={e => e.stopPropagation()}
      className="text-xs px-2 py-1 rounded-lg border outline-none transition-opacity"
      style={FIELD}
      aria-label="Project status"
    >
      {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

function NewProjectForm({ clients, convertible, onDone, onCancel }) {
  const navigate = useNavigate();
  const addToast = useToastStore(s => s.addToast);
  const [mode, setMode] = useState('new'); // 'new' | 'convert'
  const [name, setName] = useState('');
  const [clientId, setClientId] = useState('');
  const [goal, setGoal] = useState('');
  const [existingId, setExistingId] = useState('');
  const [busy, setBusy] = useState(false);

  const chosen = convertible.find(p => String(p.id) === String(existingId));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      let res; let id;
      if (mode === 'new') {
        res = await api.post('/api/client-projects', { name, clientId: Number(clientId), goal });
      } else {
        res = await api.post(`/api/client-projects/${existingId}/convert`, { clientId: Number(clientId || chosen?.clientId) });
      }
      const data = await res.json();
      if (!res.ok) { addToast(data.error || 'Could not save', 'error'); return; }
      id = data.id;
      addToast(mode === 'new' ? 'Client work created' : 'Now client work');
      onDone();
      navigate(`/client-projects/${id}`);
    } catch {
      addToast('Could not save', 'error');
    } finally {
      setBusy(false);
    }
  };

  const ready = mode === 'new' ? name.trim() && clientId : existingId && (clientId || chosen?.clientId);

  return (
    <form onSubmit={submit} className="rounded-2xl border p-5 space-y-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <div className="flex gap-2">
        {[['new', 'New client work'], ['convert', 'Use an existing project']].map(([m, label]) => (
          <button
            key={m} type="button" onClick={() => setMode(m)}
            className="px-3 py-1.5 text-sm rounded-lg font-medium transition-opacity hover:opacity-70"
            style={{ background: mode === m ? 'var(--color-primary)' : 'transparent', color: mode === m ? '#fff' : 'var(--color-text)', border: mode === m ? 'none' : '1px solid var(--color-border)' }}
          >{label}</button>
        ))}
      </div>

      {mode === 'new' ? (
        <>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Project name (e.g. Video recreation)" className="text-sm px-3 py-2.5 rounded-xl border w-full outline-none" style={FIELD} />
          <textarea value={goal} onChange={e => setGoal(e.target.value)} rows={2} placeholder="Goal, in a sentence (optional — the full brief is on the project page)" className="text-sm px-3 py-2.5 rounded-xl border w-full outline-none" style={FIELD} />
        </>
      ) : (
        <select value={existingId} onChange={e => { setExistingId(e.target.value); setClientId(''); }} className="text-sm px-3 py-2.5 rounded-xl border w-full" style={FIELD}>
          <option value="">Choose a project…</option>
          {convertible.map(p => <option key={p.id} value={p.id}>{p.name}{p.clientName ? ` — ${p.clientName}` : ''}</option>)}
        </select>
      )}

      <select value={clientId || (mode === 'convert' ? (chosen?.clientId || '') : '')} onChange={e => setClientId(e.target.value)} className="text-sm px-3 py-2.5 rounded-xl border w-full" style={FIELD}>
        <option value="">Client…</option>
        {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>

      {mode === 'convert' && (
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          Its chats, files, notes and tasks stay exactly as they are; the project just gets a client and a status.
        </p>
      )}

      <div className="flex gap-2">
        <button type="submit" disabled={busy || !ready} className="px-3.5 py-1.5 text-sm rounded-lg font-medium transition-opacity hover:opacity-80 disabled:opacity-40" style={{ background: 'var(--color-primary)', color: '#fff' }}>
          {busy ? 'Saving…' : mode === 'new' ? 'Create' : 'Make it client work'}
        </button>
        <button type="button" onClick={onCancel} className="px-3.5 py-1.5 text-sm rounded-lg transition-opacity hover:opacity-70" style={{ border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>Cancel</button>
      </div>
    </form>
  );
}

export default function ClientProjectsPage() {
  const navigate = useNavigate();
  const addToast = useToastStore(s => s.addToast);
  const [rows, setRows] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [clients, setClients] = useState([]);
  const [convertible, setConvertible] = useState([]);
  const [filter, setFilter] = useState('open'); // 'open' | 'all'

  const load = useCallback(() => {
    api.get('/api/client-projects').then(r => r.json()).then(d => setRows(Array.isArray(d) ? d : [])).catch(() => setRows([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const openForm = async () => {
    setShowForm(true);
    try {
      const [c, p] = await Promise.all([api.get('/api/clients').then(r => r.json()), api.get('/api/client-projects/convertible').then(r => r.json())]);
      setClients(Array.isArray(c) ? c.filter(x => x.status !== 'archived') : []);
      setConvertible(Array.isArray(p) ? p : []);
    } catch { addToast('Could not load clients', 'error'); }
  };

  const setStatus = async (row, clientStatus) => {
    const before = rows;
    setRows(rs => rs.map(r => r.id === row.id ? { ...r, clientStatus } : r));
    try {
      const res = await api.patch(`/api/client-projects/${row.id}/status`, { clientStatus });
      if (!res.ok) throw new Error();
    } catch {
      setRows(before);
      addToast('Could not change the status', 'error');
    }
  };

  const shown = (rows || []).filter(r => filter === 'all' || r.clientStatus !== 'done');

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto" style={{ background: 'var(--color-bg)' }}>
      <div className="max-w-5xl w-full mx-auto p-4 sm:p-6 space-y-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Client work</h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>One place per piece of client work.</p>
          </div>
          <div className="flex items-center gap-2">
            <select value={filter} onChange={e => setFilter(e.target.value)} className="text-sm px-3 py-1.5 rounded-lg border" style={FIELD} aria-label="Show">
              <option value="open">Not done</option>
              <option value="all">All</option>
            </select>
            {!showForm && (
              <button onClick={openForm} className="px-3.5 py-1.5 text-sm rounded-lg font-medium transition-opacity hover:opacity-80" style={{ background: 'var(--color-primary)', color: '#fff' }}>New client work</button>
            )}
          </div>
        </div>

        {showForm && <NewProjectForm clients={clients} convertible={convertible} onDone={() => { setShowForm(false); load(); }} onCancel={() => setShowForm(false)} />}

        {rows === null ? (
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>
        ) : shown.length === 0 ? (
          <div className="rounded-2xl border p-6 text-sm" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
            No client work yet. Create one, or turn an existing project into one with <strong>New client work → Use an existing project</strong>.
          </div>
        ) : (
          <div className="rounded-2xl border overflow-hidden" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <div className="hidden sm:grid grid-cols-[1.2fr_1.6fr_110px_70px_1.6fr] gap-3 px-4 py-2 text-xs font-medium" style={{ color: 'var(--color-muted)', borderBottom: '1px solid var(--color-border)' }}>
              <span>Client</span><span>Project</span><span>Status</span><span>Open</span><span>Next due task</span>
            </div>
            {shown.map(r => (
              <div
                key={r.id}
                onClick={() => navigate(`/client-projects/${r.id}`)}
                className="grid grid-cols-1 sm:grid-cols-[1.2fr_1.6fr_110px_70px_1.6fr] gap-1 sm:gap-3 px-4 py-3 text-sm cursor-pointer transition-opacity hover:opacity-70 items-center"
                style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              >
                <span className="truncate">{r.clientName || '—'}</span>
                <Link to={`/client-projects/${r.id}`} onClick={e => e.stopPropagation()} className="font-medium truncate" style={{ color: 'var(--color-text)' }}>{r.name}</Link>
                <span><StatusSelect value={r.clientStatus} onChange={v => setStatus(r, v)} /></span>
                <span style={{ color: 'var(--color-muted)' }}>{r.openTasks}</span>
                <span className="truncate" style={{ color: 'var(--color-muted)' }}>
                  {r.nextTaskTitle ? `${r.nextTaskTitle} · ${fmtDue(r.nextTaskDue)}` : (r.openTasks ? 'No dates set' : 'No open tasks')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
