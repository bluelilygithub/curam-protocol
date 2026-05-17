import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Plus, Trash2, Copy, Check, Play } from 'lucide-react';
import api from '../utils/apiClient';
import PromptVariableModal from '../components/PromptVariableModal';
import { extractVariables } from '../utils/promptVariables';
import useProjectStore from '../store/projectStore';
import useToastStore from '../store/toastStore';

function PromptsPage() {
  const navigate = useNavigate();
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const [prompts, setPrompts] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', content: '', tags: '' });
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [search, setSearch] = useState('');
  const [varModal, setVarModal] = useState(null); // { content } or null

  const load = async () => {
    const res = await api.get('/api/prompts');
    setPrompts(await res.json());
  };

  useEffect(() => { load(); }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || !form.content.trim() || saving) return;
    setSaving(true);
    await api.post('/api/prompts', form);
    setForm({ title: '', content: '', tags: '' });
    setShowForm(false);
    setSaving(false);
    load();
  };

  const handleDelete = async (id) => {
    await api.delete(`/api/prompts/${id}`);
    setPrompts(prev => prev.filter(p => p.id !== id));
  };

  const handleCopy = async (id, content) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      useToastStore.getState().addToast('Could not copy to clipboard', 'error');
    }
  };

  const openInChat = (filled) => {
    if (activeProjectId) {
      navigate(`/projects/${activeProjectId}/chat`, { state: { draft: filled } });
    } else {
      navigate('/chat', { state: { draft: filled } });
    }
    useToastStore.getState().addToast('Prompt loaded in chat — review and send when ready', 'success');
  };

  const handleUse = (content) => {
    if (extractVariables(content).length > 0) {
      setVarModal({ content });
    } else {
      openInChat(content);
    }
  };

  const filtered = search
    ? prompts.filter(p =>
        p.title.toLowerCase().includes(search.toLowerCase()) ||
        p.content.toLowerCase().includes(search.toLowerCase()) ||
        p.tags?.toLowerCase().includes(search.toLowerCase())
      )
    : prompts;

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <div className="flex items-center gap-3 mb-6">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--color-surface)', color: 'var(--color-primary)' }}
        >
          <BookOpen size={18} />
        </div>
        <div className="flex-1">
          <h1 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Prompt Library</h1>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Save and reuse your favourite prompts</p>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-white"
          style={{ background: 'var(--color-primary)' }}
        >
          <Plus size={14} />
          New Prompt
        </button>
      </div>

      {/* New prompt form */}
      {showForm && (
        <form
          onSubmit={handleSave}
          className="mb-6 p-4 rounded-2xl border space-y-3"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
        >
          <input
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            placeholder="Title"
            required
            className="w-full px-3 py-2 rounded-xl border text-sm outline-none"
            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          />
          <textarea
            value={form.content}
            onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
            placeholder="Prompt text…"
            required
            rows={4}
            className="w-full px-3 py-2 rounded-xl border text-sm resize-none outline-none"
            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          />
          <input
            value={form.tags}
            onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
            placeholder="Tags (comma separated)"
            className="w-full px-3 py-2 rounded-xl border text-sm outline-none"
            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          />
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-40" style={{ background: 'var(--color-primary)' }}>
              {saving ? 'Saving…' : 'Save Prompt'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 rounded-xl text-sm border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Search */}
      {prompts.length > 0 && (
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search prompts…"
          className="w-full px-3 py-2 rounded-xl border text-sm outline-none mb-4"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        />
      )}

      {/* Prompt list */}
      {filtered.length === 0 ? (
        <div
          className="text-center py-16 rounded-2xl border"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
        >
          <BookOpen size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">{prompts.length === 0 ? 'No saved prompts yet.' : 'No prompts match your search.'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(p => (
            <div
              key={p.id}
              className="p-4 rounded-2xl border group"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
            >
              <div className="flex items-start gap-2 mb-2">
                <span className="flex-1 text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  {p.title}
                  {extractVariables(p.content).length > 0 && (
                    <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>
                      template
                    </span>
                  )}
                </span>
                <button type="button" onClick={() => handleUse(p.content)} className="hover:opacity-70 transition-opacity flex-shrink-0 p-1" style={{ color: 'var(--color-primary)' }} title="Open in chat">
                  <Play size={14} />
                </button>
                <button type="button" onClick={() => handleCopy(p.id, p.content)} className="hover:opacity-70 transition-opacity flex-shrink-0 p-1" style={{ color: 'var(--color-muted)' }} title="Copy to clipboard">
                  {copiedId === p.id ? <Check size={14} style={{ color: 'var(--color-primary)' }} /> : <Copy size={14} />}
                </button>
                <button type="button" onClick={() => handleDelete(p.id)} className="hover:opacity-70 transition-opacity flex-shrink-0 p-1" style={{ color: 'var(--color-muted)' }} title="Delete">
                  <Trash2 size={14} />
                </button>
              </div>
              <p className="text-xs leading-relaxed line-clamp-3" style={{ color: 'var(--color-muted)' }}>{p.content}</p>
              {p.tags && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {p.tags.split(',').map(t => t.trim()).filter(Boolean).map(tag => (
                    <span key={tag} className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {varModal && (
        <PromptVariableModal
          content={varModal.content}
          onInsert={(filled) => { openInChat(filled); setVarModal(null); }}
          onClose={() => setVarModal(null)}
        />
      )}
    </div>
  );
}

export default PromptsPage;
