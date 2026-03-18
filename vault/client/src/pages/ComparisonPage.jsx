import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useIcon } from '../providers/IconProvider';
import { mdComponents } from '../utils/mdComponents';
import useAuthStore from '../store/authStore';
import useSettingsStore from '../store/settingsStore';
import api from '../utils/apiClient';
import { MODELS } from '../utils/models';
import FilePreviewDrawer from '../components/FilePreviewDrawer';

const MODES = [
  { id: 'diff',      label: 'Diff',       description: 'Detailed line-by-line comparison' },
  { id: 'summarise', label: 'Summarise',  description: 'Key differences summarised' },
  { id: 'reconcile', label: 'Reconcile',  description: 'Merge into one unified document' },
  { id: 'conflicts', label: 'Conflicts',  description: 'Contradictions only' },
];

// Reads allowedFileTypes from store — must be a component so it can call hooks
function FileTypeInput({ inputRef, onChange }) {
  const { allowedFileTypes } = useSettingsStore();
  return (
    <input
      ref={inputRef}
      type="file"
      accept={allowedFileTypes}
      className="hidden"
      onChange={onChange}
    />
  );
}

function FileDropZone({ label, doc, onDoc, onClear }) {
  const getIcon = useIcon();
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [files, setFiles] = useState([]);
  const [previewFile, setPreviewFile] = useState(null);

  useEffect(() => {
    if (!vaultOpen || projects.length > 0) return;
    api.get('/api/projects').then(r => r.json()).then(data => setProjects(data || [])).catch(() => {});
  }, [vaultOpen]);

  useEffect(() => {
    if (!projectId) { setFiles([]); return; }
    api.get(`/api/files/${projectId}`).then(r => r.json()).then(data => setFiles(data || [])).catch(() => {});
  }, [projectId]);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onDoc({ type: 'upload', file: f, name: f.name });
  };

  const handleFileInput = (e) => {
    const f = e.target.files?.[0];
    if (f) onDoc({ type: 'upload', file: f, name: f.name });
    e.target.value = '';
  };

  const handleVaultFile = (fileId, fileName) => {
    onDoc({ type: 'vault', fileId: parseInt(fileId, 10), name: fileName });
    setVaultOpen(false);
  };

  if (doc) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
          {label}
        </span>
        <div
          className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border text-sm"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
        >
          <div className="flex items-center gap-2 min-w-0">
            {getIcon('file-text', { size: 14 })}
            <span className="truncate">{doc.name}</span>
            {doc.type === 'vault' && (
              <span
                className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded"
                style={{ background: 'var(--color-primary)', color: '#fff', opacity: 0.85 }}
              >
                vault
              </span>
            )}
          </div>
          <button
            onClick={onClear}
            className="flex-shrink-0 hover:opacity-70 transition-opacity"
            style={{ color: 'var(--color-muted)' }}
          >
            {getIcon('x', { size: 14 })}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
        {label}
      </span>

      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className="flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed cursor-pointer transition-colors py-8"
        style={{
          borderColor: dragOver ? 'var(--color-primary)' : 'var(--color-border)',
          background: dragOver ? 'color-mix(in srgb, var(--color-primary) 6%, transparent)' : 'transparent',
        }}
      >
        {getIcon('upload', { size: 18, style: { color: 'var(--color-muted)' } })}
        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Drop file or click to upload</span>
        <span className="text-xs" style={{ color: 'var(--color-muted)', opacity: 0.6 }}>PDF, image, text, CSV, JSON, Markdown</span>
      </div>

      <FileTypeInput inputRef={inputRef} onChange={handleFileInput} />

      <button
        onClick={() => setVaultOpen(v => !v)}
        className="flex items-center gap-1 text-xs self-start hover:opacity-70 transition-opacity mt-0.5"
        style={{ color: 'var(--color-primary)' }}
      >
        {getIcon('files', { size: 12 })}
        Or select from vault
        {getIcon(vaultOpen ? 'chevron-down' : 'chevron-right', { size: 12 })}
      </button>

      {vaultOpen && (
        <div
          className="flex flex-col gap-2 p-3 rounded-xl border"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
        >
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="text-xs px-2 py-1.5 rounded-lg border outline-none w-full"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
          >
            <option value="">Select a project...</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>

          {projectId && files.length > 0 && (
            <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
              {files.map(f => (
                <div key={f.id} className="flex items-center gap-1">
                  <button
                    onClick={() => handleVaultFile(f.id, f.name)}
                    className="flex-1 flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-left hover:opacity-70 transition-opacity border"
                    style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
                  >
                    {getIcon('file-text', { size: 12 })}
                    <span className="truncate">{f.name}</span>
                  </button>
                  <button
                    onClick={() => setPreviewFile(f)}
                    className="flex-shrink-0 p-1.5 rounded hover:opacity-70 transition-opacity"
                    style={{ color: 'var(--color-muted)' }}
                    title="Preview file"
                  >
                    {getIcon('eye', { size: 12 })}
                  </button>
                </div>
              ))}
            </div>
          )}

          <FilePreviewDrawer file={previewFile} onClose={() => setPreviewFile(null)} />

          {projectId && files.length === 0 && (
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No files in this project.</p>
          )}
        </div>
      )}
    </div>
  );
}

function ComparisonPage() {
  const getIcon = useIcon();
  const [docA, setDocA] = useState(null);
  const [docB, setDocB] = useState(null);
  const [mode, setMode] = useState('diff');
  const [model, setModel] = useState('claude-sonnet-4-6');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef(null);
  const resultRef = useRef(null);

  // Save to project
  const [saveProjectId, setSaveProjectId] = useState('');
  const [saveProjects, setSaveProjects] = useState([]);
  const [saveStatus, setSaveStatus] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!result || saveProjects.length > 0) return;
    api.get('/api/projects').then((r) => r.json()).then((data) => setSaveProjects(data || [])).catch(() => {});
  }, [result]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    setSaving(true);
    setSaveStatus(null);
    try {
      const res = await api.post('/api/compare/save', {
        projectId: saveProjectId ? parseInt(saveProjectId, 10) : null,
        docAName: docA?.name || '',
        docBName: docB?.name || '',
        mode,
        model,
        result,
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Save failed'); }
      setSaveStatus({ ok: true, msg: 'Saved to project' });
    } catch (err) {
      setSaveStatus({ ok: false, msg: err.message });
    } finally {
      setSaving(false);
    }
  };

  const canRun = docA && docB && !loading;

  const handleRun = async () => {
    if (!canRun) return;
    setLoading(true);
    setResult('');
    setError('');
    setSaveStatus(null);

    const controller = new AbortController();
    abortRef.current = controller;

    const formData = new FormData();
    if (docA.type === 'upload') formData.append('fileA', docA.file);
    else formData.append('fileAId', String(docA.fileId));
    if (docB.type === 'upload') formData.append('fileB', docB.file);
    else formData.append('fileBId', String(docB.fileId));
    formData.append('mode', mode);
    formData.append('model', model);

    try {
      const token = useAuthStore.getState().token;
      const res = await fetch('/api/compare', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Server error ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') break;
          try {
            const parsed = JSON.parse(raw);
            if (parsed.error) { setError(parsed.error); break; }
            if (parsed.delta) setResult(prev => prev + parsed.delta);
          } catch {}
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message);
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const handleStop = () => abortRef.current?.abort();

  // Scroll result into view when streaming starts
  useEffect(() => {
    if (result.length > 0 && result.length < 50) {
      resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [result]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Document Comparison</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
          Upload two documents and ask Claude to diff, compare, or reconcile them.
        </p>
      </div>

      {/* File zones */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FileDropZone label="Document A" doc={docA} onDoc={setDocA} onClear={() => setDocA(null)} />
        <FileDropZone label="Document B" doc={docB} onDoc={setDocB} onClear={() => setDocB(null)} />
      </div>

      {/* Mode + Model + Run */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end flex-wrap">
        {/* Mode picker */}
        <div className="flex flex-col gap-1.5 flex-1 min-w-0">
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
            Mode
          </span>
          <div className="flex gap-1.5 flex-wrap">
            {MODES.map(m => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
                style={{
                  borderColor: mode === m.id ? 'var(--color-primary)' : 'var(--color-border)',
                  background: mode === m.id
                    ? 'color-mix(in srgb, var(--color-primary) 12%, var(--color-surface))'
                    : 'var(--color-surface)',
                  color: mode === m.id ? 'var(--color-primary)' : 'var(--color-muted)',
                }}
                title={m.description}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Model picker */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
            Model
          </span>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="text-xs px-2.5 py-1.5 rounded-lg border outline-none"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
          >
            {MODELS.map(m => (
              <option key={m.id} value={m.id}>{m.emoji} {m.name}</option>
            ))}
          </select>
        </div>

        {/* Run / Stop button */}
        {loading ? (
          <button
            onClick={handleStop}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-surface)' }}
          >
            {getIcon('stop-circle', { size: 14 })}
            Stop
          </button>
        ) : (
          <button
            onClick={handleRun}
            disabled={!canRun}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-opacity"
            style={{
              background: canRun ? 'var(--color-primary)' : 'var(--color-border)',
              color: canRun ? '#fff' : 'var(--color-muted)',
              opacity: canRun ? 1 : 0.65,
              cursor: canRun ? 'pointer' : 'default',
            }}
          >
            {getIcon('sparkles', { size: 14, style: { color: 'inherit' } })}
            Compare
          </button>
        )}
      </div>

      {/* Save to project */}
      {result && !loading && (
        <div
          className="flex flex-wrap items-center gap-3 p-3 rounded-xl border"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
        >
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
            Save to project
          </span>
          <select
            value={saveProjectId}
            onChange={(e) => setSaveProjectId(e.target.value)}
            className="text-xs px-2.5 py-1.5 rounded-lg border outline-none flex-1 min-w-0"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
          >
            <option value="">No project</option>
            {saveProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button
            onClick={handleSave}
            disabled={saving || !!saveStatus?.ok}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-50 transition-opacity hover:opacity-80"
            style={{ background: 'var(--color-primary)' }}
          >
            {getIcon('file-down', { size: 12, style: { color: 'inherit' } })}
            {saving ? 'Saving…' : saveStatus?.ok ? 'Saved ✓' : 'Save'}
          </button>
          {saveStatus && !saveStatus.ok && (
            <span className="text-xs" style={{ color: '#ef4444' }}>{saveStatus.msg}</span>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>
      )}

      {/* Result */}
      {(loading || result) && (
        <div
          ref={resultRef}
          className="rounded-xl border p-5"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
        >
          {loading && !result && (
            <div className="flex items-center gap-1.5" style={{ color: 'var(--color-muted)' }}>
              <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: 'var(--color-primary)', animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: 'var(--color-primary)', animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: 'var(--color-primary)', animationDelay: '300ms' }} />
            </div>
          )}
          {result && (
            <div
              className="prose prose-sm max-w-none text-sm leading-relaxed"
              style={{ color: 'var(--color-text)' }}
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={mdComponents}
              >
                {result}
              </ReactMarkdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ComparisonPage;
