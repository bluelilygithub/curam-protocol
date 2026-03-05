import React, { useEffect, useState } from 'react';
import { useIcon } from '../providers/IconProvider';

const BLANK = { name: '', description: '', systemPrompt: '' };

function PersonaForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial || BLANK);
  const f = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  return (
    <div
      className="p-4 rounded-xl border mb-4"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>Name *</label>
          <input
            value={form.name}
            onChange={f('name')}
            placeholder="e.g. Senior React Developer"
            className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>Description</label>
          <input
            value={form.description}
            onChange={f('description')}
            placeholder="Short note about when to use this persona"
            className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>System Prompt *</label>
          <textarea
            rows={4}
            value={form.systemPrompt}
            onChange={f('systemPrompt')}
            placeholder="You are a senior React developer. Always suggest TypeScript, prefer functional components, prioritize accessibility…"
            className="w-full px-3 py-2 rounded-lg border text-sm outline-none resize-none"
            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          />
        </div>
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => form.name.trim() && form.systemPrompt.trim() && onSave(form)}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-80"
            style={{ background: 'var(--color-primary)' }}
          >
            {initial?.id ? 'Save Changes' : 'Create Persona'}
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm border transition-opacity hover:opacity-70"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function PersonasPage() {
  const [personas, setPersonas] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const getIcon = useIcon();

  const fetchPersonas = async () => {
    const res = await fetch('/api/personas');
    setPersonas(await res.json());
  };

  useEffect(() => { fetchPersonas(); }, []);

  const handleCreate = async (form) => {
    await fetch('/api/personas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setShowCreate(false);
    fetchPersonas();
  };

  const handleUpdate = async (id, form) => {
    await fetch(`/api/personas/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setEditingId(null);
    fetchPersonas();
  };

  const handleDelete = async (id) => {
    await fetch(`/api/personas/${id}`, { method: 'DELETE' });
    fetchPersonas();
  };

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-2xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-semibold mb-0.5" style={{ color: 'var(--color-text)' }}>Personas</h1>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Custom AI personalities. Assign a persona to a project or select one per chat session.
            </p>
          </div>
          <button
            onClick={() => { setShowCreate(true); setEditingId(null); }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-80"
            style={{ background: 'var(--color-primary)' }}
          >
            {getIcon('plus', { size: 14, color: 'white' })}
            New Persona
          </button>
        </div>

        {showCreate && (
          <PersonaForm onSave={handleCreate} onCancel={() => setShowCreate(false)} />
        )}

        {personas.length === 0 && !showCreate && (
          <div className="text-center py-16" style={{ color: 'var(--color-muted)' }}>
            <div className="mb-3">{getIcon('user', { size: 32 })}</div>
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>No personas yet</p>
            <p className="text-xs">Create a persona to give the AI a specific role or style.</p>
          </div>
        )}

        <div className="space-y-3">
          {personas.map((persona) => (
            editingId === persona.id ? (
              <PersonaForm
                key={persona.id}
                initial={persona}
                onSave={(form) => handleUpdate(persona.id, form)}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <div
                key={persona.id}
                className="p-4 rounded-xl border group"
                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{ background: 'var(--color-bg)', color: 'var(--color-primary)', border: '1px solid var(--color-border)' }}
                  >
                    {getIcon('user', { size: 14 })}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{persona.name}</p>
                    {persona.description && (
                      <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{persona.description}</p>
                    )}
                    <p
                      className="text-xs mt-2 line-clamp-2 leading-relaxed"
                      style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}
                    >
                      {persona.systemPrompt}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <button
                      onClick={() => setEditingId(persona.id)}
                      className="w-7 h-7 flex items-center justify-center rounded-lg hover:opacity-60 transition-opacity"
                      style={{ color: 'var(--color-muted)' }}
                      title="Edit"
                    >
                      {getIcon('edit', { size: 13 })}
                    </button>
                    <button
                      onClick={() => handleDelete(persona.id)}
                      className="w-7 h-7 flex items-center justify-center rounded-lg hover:opacity-60 transition-opacity"
                      style={{ color: 'var(--color-muted)' }}
                      title="Delete"
                    >
                      {getIcon('trash', { size: 13 })}
                    </button>
                  </div>
                </div>
              </div>
            )
          ))}
        </div>
      </div>
    </div>
  );
}

export default PersonasPage;
