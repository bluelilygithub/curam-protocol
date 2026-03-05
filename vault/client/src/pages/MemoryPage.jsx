import React, { useEffect, useState } from 'react';
import { Brain, Trash2, Plus } from 'lucide-react';
import api from '../utils/apiClient';

function MemoryPage() {
  const [memories, setMemories] = useState([]);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const res = await api.get('/api/memory');
    setMemories(await res.json());
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!input.trim() || saving) return;
    setSaving(true);
    await api.post('/api/memory', { content: input.trim() });
    setInput('');
    setSaving(false);
    load();
  };

  const handleDelete = async (id) => {
    await api.delete(`/api/memory/${id}`);
    setMemories(prev => prev.filter(m => m.id !== id));
  };

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <div className="flex items-center gap-3 mb-8">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--color-surface)', color: 'var(--color-primary)' }}
        >
          <Brain size={18} />
        </div>
        <div>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Memory</h1>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Facts Claude remembers across every conversation
          </p>
        </div>
      </div>

      {/* Add memory */}
      <form onSubmit={handleAdd} className="flex gap-2 mb-6">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Add a fact (e.g. I prefer TypeScript, My timezone is GMT+1)"
          className="flex-1 px-3 py-2.5 rounded-xl border text-sm outline-none"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        />
        <button
          type="submit"
          disabled={!input.trim() || saving}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium text-white disabled:opacity-40"
          style={{ background: 'var(--color-primary)' }}
        >
          <Plus size={14} />
          Add
        </button>
      </form>

      {/* Memory list */}
      {memories.length === 0 ? (
        <div
          className="text-center py-16 rounded-2xl border"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
        >
          <Brain size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No memories yet.</p>
          <p className="text-xs mt-1 opacity-60">Add facts above to help Claude know you better.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {memories.map(m => (
            <div
              key={m.id}
              className="flex items-start gap-3 px-4 py-3 rounded-xl border group"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
            >
              <span className="flex-1 text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>
                {m.content}
              </span>
              <button
                onClick={() => handleDelete(m.id)}
                className="flex-shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
                style={{ color: 'var(--color-muted)' }}
                title="Delete memory"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default MemoryPage;
