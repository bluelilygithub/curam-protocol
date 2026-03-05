import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useProjectStore from '../store/projectStore';
import { useIcon } from '../providers/IconProvider';
import FileUploader from '../components/FileUploader';
import FileList from '../components/FileList';
import { downloadProjectMd } from '../utils/exportMd';
import { MODELS, TYPE_FIELDS, getModelById } from '../utils/models';

const FIELDS = [
  { key: 'name', label: 'Project Name', placeholder: 'My Project', required: true },
  { key: 'goal', label: 'Goal', placeholder: 'What are you trying to achieve?', multiline: true },
  { key: 'problem', label: 'Problem', placeholder: 'What problem does this solve?', multiline: true },
  { key: 'audience', label: 'Target Audience', placeholder: 'Who is this for?' },
  { key: 'techStack', label: 'Tech Stack', placeholder: 'React, Node.js, PostgreSQL…' },
  { key: 'constraints', label: 'Constraints', placeholder: 'Budget, time, technical limits…', multiline: true },
  { key: 'successCriteria', label: 'Success Criteria', placeholder: 'How will you know this succeeded?', multiline: true },
  { key: 'tone', label: 'Tone', placeholder: 'Professional, casual, technical…' },
  { key: 'notes', label: 'Notes', placeholder: 'Any other context…', multiline: true },
];

function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { projects, fetchProjects, update, remove, setActive } = useProjectStore();
  const getIcon = useIcon();

  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [filesKey, setFilesKey] = useState(0);
  const [folders, setFolders] = useState([]);
  const [personas, setPersonas] = useState([]);
  const [pinnedUrls, setPinnedUrls] = useState([]);
  const [urlInput, setUrlInput] = useState('');
  const [addingUrl, setAddingUrl] = useState(false);

  const project = projects.find((p) => p.id === Number(id));

  useEffect(() => {
    fetchProjects();
    setActive(Number(id));
    fetch('/api/folders').then(r => r.json()).then(setFolders).catch(() => {});
    fetch('/api/personas').then(r => r.json()).then(setPersonas).catch(() => {});
    fetch(`/api/pinned-urls/${id}`).then(r => r.json()).then(setPinnedUrls).catch(() => {});
  }, [id]);

  useEffect(() => {
    if (project) {
      const p = { ...project };
      if (typeof p.typeConfig === 'string') {
        try { p.typeConfig = JSON.parse(p.typeConfig); } catch (_) { p.typeConfig = {}; }
      }
      setForm(p);
    }
  }, [project?.id]);

  const handleAddPinnedUrl = async () => {
    if (!urlInput.trim() || addingUrl) return;
    setAddingUrl(true);
    try {
      const res = await fetch('/api/pinned-urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: Number(id), url: urlInput.trim() }),
      });
      const data = await res.json();
      if (!data.error) { setPinnedUrls(prev => [...prev, data]); setUrlInput(''); }
    } finally {
      setAddingUrl(false);
    }
  };

  const handleRemovePinnedUrl = async (urlId) => {
    await fetch(`/api/pinned-urls/${urlId}`, { method: 'DELETE' });
    setPinnedUrls(prev => prev.filter(u => u.id !== urlId));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    await update(Number(id), form);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleDelete = async () => {
    await remove(Number(id));
    navigate('/');
  };

  if (!project) {
    return <div className="flex items-center justify-center h-full text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</div>;
  }

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-2xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--color-surface)', color: 'var(--color-primary)' }}
          >
            {getIcon('folder', { size: 18 })}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold truncate" style={{ color: 'var(--color-text)' }}>{project.name}</h1>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Updated {new Date(project.updatedAt).toLocaleDateString()}
            </p>
          </div>
          <button
            onClick={() => navigate(`/projects/${id}/chat`)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-80"
            style={{ background: 'var(--color-primary)' }}
          >
            {getIcon('chat', { size: 13, color: 'white' })}
            Chat
          </button>
          <button
            onClick={() => downloadProjectMd(project)}
            className="w-8 h-8 flex items-center justify-center rounded-lg border hover:opacity-60 transition-opacity"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
            title="Export project as Markdown"
          >
            {getIcon('file-down', { size: 14 })}
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            className="w-8 h-8 flex items-center justify-center rounded-lg border hover:opacity-60 transition-opacity"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
          >
            {getIcon('trash', { size: 14 })}
          </button>
        </div>

        {confirmDelete && (
          <div className="mb-6 p-4 rounded-xl border" style={{ borderColor: '#fca5a5', background: '#fff1f2' }}>
            <p className="text-sm font-semibold text-red-700 mb-1">Delete "{project.name}"?</p>
            <p className="text-xs text-red-600 mb-3">
              This will permanently delete the project, all associated chat sessions, all uploaded files, and all messages. This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button onClick={handleDelete} className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-red-500">
                Yes, delete everything
              </button>
              <button onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 rounded-lg text-xs border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Cancel</button>
            </div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSave} className="space-y-5">
          {FIELDS.map((field) => (
            <div key={field.key}>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
                {field.label}{field.required && <span className="text-red-400 ml-1">*</span>}
              </label>
              {field.multiline ? (
                <textarea
                  rows={3}
                  value={form[field.key] || ''}
                  onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                  placeholder={field.placeholder}
                  className="w-full px-3 py-2.5 rounded-xl border text-sm resize-none outline-none transition-colors"
                  style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />
              ) : (
                <input
                  type="text"
                  value={form[field.key] || ''}
                  onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                  placeholder={field.placeholder}
                  required={field.required}
                  className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none transition-colors"
                  style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />
              )}
            </div>
          ))}

          <div className="pt-1">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80"
              style={{ background: 'var(--color-primary)' }}
            >
              {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Changes'}
            </button>
          </div>
        </form>

        {/* AI Model */}
        <div className="mt-8 pt-8 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--color-muted)' }}>AI Model</h2>
          <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>
            Default model used when chatting in this project. You can override it per chat in the chat header.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {MODELS.map(model => (
              <button
                key={model.id}
                type="button"
                onClick={() => setForm({ ...form, model: model.id })}
                className="flex flex-col gap-1 px-3 py-2.5 rounded-xl border text-left transition-all"
                style={{
                  background: (form.model || 'claude-sonnet-4-6') === model.id ? model.color + '12' : 'var(--color-surface)',
                  borderColor: (form.model || 'claude-sonnet-4-6') === model.id ? model.color : 'var(--color-border)',
                }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-base">{model.emoji}</span>
                  <span className="text-xs font-semibold" style={{ color: (form.model || 'claude-sonnet-4-6') === model.id ? model.color : 'var(--color-text)' }}>
                    {model.label}
                  </span>
                </div>
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{model.tagline}</p>
                <p className="text-xs leading-tight" style={{ color: 'var(--color-muted)', opacity: 0.7 }}>{model.name}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Organisation */}
        {(folders.length > 0 || personas.length > 0) && (
          <div className="mt-8 pt-8 border-t" style={{ borderColor: 'var(--color-border)' }}>
            <h2 className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: 'var(--color-muted)' }}>Organisation</h2>
            <div className="grid grid-cols-2 gap-4">
              {folders.length > 0 && (
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-muted)' }}>Folder</label>
                  <select
                    value={form.folderId || ''}
                    onChange={e => setForm({ ...form, folderId: e.target.value ? Number(e.target.value) : null })}
                    className="w-full px-3 py-2 rounded-xl border text-sm outline-none"
                    style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  >
                    <option value="">No folder</option>
                    {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>
              )}
              {personas.length > 0 && (
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-muted)' }}>Default Persona</label>
                  <select
                    value={form.personaId || ''}
                    onChange={e => setForm({ ...form, personaId: e.target.value ? Number(e.target.value) : null })}
                    className="w-full px-3 py-2 rounded-xl border text-sm outline-none"
                    style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  >
                    <option value="">No persona</option>
                    {personas.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Pinned URLs */}
        <div className="mt-8 pt-8 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--color-muted)' }}>Pinned Web Pages</h2>
          <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>
            These pages are fetched and included in Claude's context for every chat in this project.
          </p>
          <div className="flex gap-2 mb-3">
            <input
              type="url"
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddPinnedUrl(); } }}
              placeholder="https://docs.example.com/…"
              className="flex-1 px-3 py-2 rounded-xl border text-sm outline-none"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            />
            <button
              type="button"
              onClick={handleAddPinnedUrl}
              disabled={addingUrl || !urlInput.trim()}
              className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-50"
              style={{ background: 'var(--color-primary)' }}
            >
              {addingUrl ? 'Fetching…' : 'Pin'}
            </button>
          </div>
          <div className="space-y-2">
            {pinnedUrls.map(u => (
              <div
                key={u.id}
                className="flex items-center gap-2 px-3 py-2 rounded-xl border"
                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
              >
                {getIcon('pin', { size: 13, color: 'var(--color-primary)' })}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>{u.title || u.url}</p>
                  <p className="text-xs truncate" style={{ color: 'var(--color-muted)' }}>{u.url}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemovePinnedUrl(u.id)}
                  className="flex-shrink-0 p-1 rounded hover:opacity-60 transition-opacity"
                  style={{ color: 'var(--color-muted)' }}
                >
                  {getIcon('x', { size: 13 })}
                </button>
              </div>
            ))}
            {pinnedUrls.length === 0 && (
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No pinned pages yet.</p>
            )}
          </div>
        </div>

        {/* Behavior Settings */}
        {project.projectType && TYPE_FIELDS[project.projectType] && (
          <div className="mt-8 pt-8 border-t" style={{ borderColor: 'var(--color-border)' }}>
            <h2 className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--color-muted)' }}>Behaviour</h2>
            <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
              Fine-tune how the AI responds in this project. Save changes to apply.
            </p>
            <div className="space-y-4">
              {TYPE_FIELDS[project.projectType].map(field => {
                const cfg = form.typeConfig || {};
                const current = cfg[field.key] ?? field.default;
                const activeOpt = field.options.find(o => o.value === current);
                return (
                  <div key={field.key}>
                    <p className="text-xs font-medium mb-2" style={{ color: 'var(--color-text)' }}>{field.label}</p>
                    <div className="flex flex-wrap gap-2">
                      {field.options.map(opt => (
                        <button
                          key={opt.value}
                          type="button"
                          title={opt.desc || ''}
                          onClick={() => setForm(f => ({ ...f, typeConfig: { ...(f.typeConfig || {}), [field.key]: opt.value } }))}
                          className="px-3 py-1.5 rounded-lg border text-xs font-medium transition-all"
                          style={{
                            background: current === opt.value ? 'var(--color-primary)' : 'var(--color-surface)',
                            borderColor: current === opt.value ? 'var(--color-primary)' : 'var(--color-border)',
                            color: current === opt.value ? '#fff' : 'var(--color-text)',
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    {activeOpt?.desc && (
                      <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{activeOpt.desc}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Files */}
        <div className="mt-10">
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: 'var(--color-muted)' }}>Files</h2>
          <FileUploader projectId={id} onUpload={() => setFilesKey((k) => k + 1)} />
          <FileList key={filesKey} projectId={id} />
        </div>
      </div>
    </div>
  );
}

export default ProjectDetail;
