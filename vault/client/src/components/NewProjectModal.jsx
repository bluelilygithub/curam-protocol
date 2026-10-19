import React, { useState, useEffect, useRef } from 'react';
import api from '../utils/apiClient';

function NewProjectModal({ onClose, onCreate }) {
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [clientId, setClientId] = useState('');
  const [clients, setClients] = useState([]);
  const [creating, setCreating] = useState(false);
  const nameRef = useRef(null);

  useEffect(() => {
    api.get('/api/clients?status=active').then(r => r.json()).then(d => setClients(Array.isArray(d) ? d : [])).catch(() => {});
    nameRef.current?.focus();
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      await onCreate({
        name: name.trim(),
        ...(goal.trim() ? { goal: goal.trim() } : {}),
        clientId: clientId ? Number(clientId) : null,
      });
    } finally {
      setCreating(false);
    }
  };

  const labelClass = 'block text-xs font-semibold uppercase tracking-wider mb-1.5';
  const fieldStyle = { background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-md rounded-2xl shadow-2xl"
        style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div className="px-6 pt-6 pb-4">
          <h2 className="text-base font-semibold mb-1" style={{ color: 'var(--color-text)' }}>New Project</h2>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Add files, a brief and pinned links afterwards from the project page.
          </p>
        </div>

        <form onSubmit={handleCreate}>
          <div className="px-6 space-y-5 pb-5">
            <div>
              <label className={labelClass} style={{ color: 'var(--color-muted)' }}>Project Name</label>
              <input
                ref={nameRef}
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="My Project"
                required
                className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
                style={fieldStyle}
              />
            </div>

            <div>
              <label className={labelClass} style={{ color: 'var(--color-muted)' }}>
                Goal <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
              </label>
              <input
                value={goal}
                onChange={e => setGoal(e.target.value)}
                placeholder="What are you trying to get done?"
                className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
                style={fieldStyle}
              />
            </div>

            {clients.length > 0 && (
              <div>
                <label className={labelClass} style={{ color: 'var(--color-muted)' }}>
                  Client <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
                </label>
                <select
                  value={clientId}
                  onChange={e => setClientId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
                  style={fieldStyle}
                >
                  <option value="">No client</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}{c.company ? ` — ${c.company}` : ''}</option>)}
                </select>
              </div>
            )}
          </div>

          <div
            className="flex items-center justify-end gap-2 px-6 py-4 border-t"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
          >
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm border"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || creating}
              className="px-5 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
              style={{ background: 'var(--color-primary)' }}
            >
              {creating ? 'Creating…' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default NewProjectModal;
