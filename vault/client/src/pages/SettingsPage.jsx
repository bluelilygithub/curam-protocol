import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import useSettingsStore from '../store/settingsStore';
import useAuthStore from '../store/authStore';
import { themes, fontOptions, iconPackOptions } from '../themes';
import { useIcon } from '../providers/IconProvider';
import { MODELS as DEFAULT_MODELS } from '../utils/models';
import api from '../utils/apiClient';
import { useModels } from '../hooks/useModels';
import GmailConnect from '../components/GmailConnect';
import { startGoalsTour, TOUR_KEY } from '../utils/tours/goalsTour';
import { startTasksTour, TOUR_KEY as TASKS_TOUR_KEY } from '../utils/tours/tasksTour';

function SettingsPage() {
  const navigate = useNavigate();
  const { font, theme, iconPack, setFont, setTheme, setIconPack, sessionBudget, setSessionBudget, allowedFileTypes, setAllowedFileTypes } = useSettingsStore();
  const [customBudget, setCustomBudget] = useState(
    sessionBudget && ![0.10, 0.25, 0.50, 1.00, 5.00].includes(sessionBudget)
      ? String(sessionBudget)
      : ''
  );

  const BUDGET_PRESETS = [0.10, 0.25, 0.50, 1.00, 5.00];
  const { token } = useAuthStore();
  const getIcon = useIcon();
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [pwStatus, setPwStatus] = useState(null);
  const [fileTypesSaved, setFileTypesSaved] = useState(false);
  const [showPwFields, setShowPwFields] = useState({ current: false, next: false, confirm: false });
  const [modelStatus, setModelStatus] = useState(null);
  const { models, saveModels } = useModels();
  const [editingModel, setEditingModel] = useState(null); // model object being edited, or 'new'
  const [modelForm, setModelForm] = useState({});

  useEffect(() => {
    api.get('/api/chat/model-status').then(r => r.json()).then(setModelStatus).catch(() => {});
    // Load allowedFileTypes from DB. If no DB value exists yet, seed it with the
    // current comprehensive default (also fixes stale localStorage values from older builds).
    const DEFAULT_FILE_TYPES = '.pdf,.txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.php,.py,.css,.html,.sql,.sh,.env.example,image/*';
    api.get('/api/settings').then(r => r.json()).then(data => {
      if (data.allowedFileTypes) {
        setAllowedFileTypes(data.allowedFileTypes);
      } else {
        setAllowedFileTypes(DEFAULT_FILE_TYPES);
        api.post('/api/settings', { key: 'allowedFileTypes', value: DEFAULT_FILE_TYPES }).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  const EMPTY_MODEL = { emoji: '🤖', name: '', label: '', id: '', provider: 'anthropic', tagline: '', desc: '' };

  function openAdd() { setModelForm(EMPTY_MODEL); setEditingModel('new'); }
  function openEdit(m) { setModelForm({ ...m }); setEditingModel(m.id); }
  function cancelEdit() { setEditingModel(null); setModelForm({}); }

  async function saveModel() {
    if (!modelForm.id.trim() || !modelForm.name.trim()) return;
    let updated;
    if (editingModel === 'new') {
      updated = [...models, { ...modelForm, id: modelForm.id.trim() }];
    } else {
      updated = models.map(m => m.id === editingModel ? { ...modelForm, id: modelForm.id.trim() } : m);
    }
    await saveModels(updated);
    cancelEdit();
  }

  async function deleteModel(id) {
    await saveModels(models.filter(m => m.id !== id));
  }

  async function resetModels() {
    await saveModels(DEFAULT_MODELS);
  }

  const [testResults, setTestResults] = useState({}); // { [modelId]: { status: 'testing'|'ok'|'error', message } }

  async function testModel(modelId) {
    setTestResults(r => ({ ...r, [modelId]: { status: 'testing' } }));
    try {
      const res = await api.post('/api/chat/test-model', { modelId });
      const data = await res.json();
      if (data.ok) {
        setTestResults(r => ({ ...r, [modelId]: { status: 'ok', message: data.response } }));
      } else {
        setTestResults(r => ({ ...r, [modelId]: { status: 'error', message: data.error, hint: data.hint } }));
      }
    } catch {
      setTestResults(r => ({ ...r, [modelId]: { status: 'error', message: 'Connection error.' } }));
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    setPwStatus(null);
    if (pwForm.next !== pwForm.confirm) return setPwStatus({ ok: false, msg: 'New passwords do not match' });
    try {
      const res = await fetch('/api/user/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPassword: pwForm.current, newPassword: pwForm.next }),
      });
      const data = await res.json();
      if (!res.ok) return setPwStatus({ ok: false, msg: data.error });
      setPwStatus({ ok: true, msg: 'Password updated' });
      setPwForm({ current: '', next: '', confirm: '' });
    } catch {
      setPwStatus({ ok: false, msg: 'Network error' });
    }
  }

  const DEFAULT_FILE_TYPES = '.pdf,.txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.php,.py,.css,.html,.sql,.sh,.env.example,image/*';

  async function saveFileTypes() {
    await api.post('/api/settings', { key: 'allowedFileTypes', value: allowedFileTypes }).catch(() => {});
    setFileTypesSaved(true);
    setTimeout(() => setFileTypesSaved(false), 2000);
  }

  async function resetFileTypes() {
    setAllowedFileTypes(DEFAULT_FILE_TYPES);
    await api.post('/api/settings', { key: 'allowedFileTypes', value: DEFAULT_FILE_TYPES }).catch(() => {});
    setFileTypesSaved(true);
    setTimeout(() => setFileTypesSaved(false), 2000);
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-10">
      <h1 className="text-2xl font-semibold" style={{ color: 'var(--color-text)' }}>
        Settings
      </h1>

      {/* Theme Section */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest mb-4" style={{ color: 'var(--color-muted)' }}>
          Theme
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Object.entries(themes).map(([key, t]) => (
            <button
              key={key}
              onClick={() => setTheme(key)}
              className="p-3 rounded-lg border-2 text-left transition-all"
              style={{
                background: t.bg,
                borderColor: theme === key ? t.primary : t.border,
                boxShadow: theme === key ? `0 0 0 2px ${t.primary}33` : 'none',
              }}
            >
              <div className="flex gap-1 mb-2">
                {[t.bg, t.surface, t.primary, t.text].map((c, i) => (
                  <div
                    key={i}
                    className="w-4 h-4 rounded-full border"
                    style={{ background: c, borderColor: t.border }}
                  />
                ))}
              </div>
              <span className="text-xs font-medium" style={{ color: t.text }}>
                {t.label}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Font Section */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest mb-4" style={{ color: 'var(--color-muted)' }}>
          Font
        </h2>
        <div className="space-y-2">
          {fontOptions.map((f) => (
            <button
              key={f.value}
              onClick={() => setFont(f.value)}
              className="w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-all"
              style={{
                background: font === f.value ? 'var(--color-surface)' : 'transparent',
                borderColor: font === f.value ? 'var(--color-primary)' : 'var(--color-border)',
                color: 'var(--color-text)',
              }}
            >
              <span style={{ fontFamily: f.style, fontSize: '1rem' }}>{f.label}</span>
              <span className="text-xs" style={{ fontFamily: f.style, color: 'var(--color-muted)' }}>
                The quick brown fox
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Icon Pack Section */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest mb-4" style={{ color: 'var(--color-muted)' }}>
          Icon Pack
        </h2>
        <div className="flex gap-3">
          {iconPackOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setIconPack(opt.value)}
              className="flex-1 px-4 py-3 rounded-lg border text-sm font-medium transition-all"
              style={{
                background: iconPack === opt.value ? 'var(--color-surface)' : 'transparent',
                borderColor: iconPack === opt.value ? 'var(--color-primary)' : 'var(--color-border)',
                color: 'var(--color-text)',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      {/* Session Budget */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--color-muted)' }}>
          Session Budget
        </h2>
        <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
          Show a warning when a single chat session approaches or exceeds a cost limit.
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          <button
            onClick={() => { setSessionBudget(null); setCustomBudget(''); }}
            className="px-3 py-1.5 rounded-lg border text-xs font-medium transition-all"
            style={{
              background: sessionBudget === null ? 'var(--color-primary)' : 'var(--color-surface)',
              borderColor: sessionBudget === null ? 'var(--color-primary)' : 'var(--color-border)',
              color: sessionBudget === null ? '#fff' : 'var(--color-text)',
            }}
          >
            Off
          </button>
          {BUDGET_PRESETS.map(v => (
            <button
              key={v}
              onClick={() => { setSessionBudget(v); setCustomBudget(''); }}
              className="px-3 py-1.5 rounded-lg border text-xs font-medium transition-all"
              style={{
                background: sessionBudget === v ? 'var(--color-primary)' : 'var(--color-surface)',
                borderColor: sessionBudget === v ? 'var(--color-primary)' : 'var(--color-border)',
                color: sessionBudget === v ? '#fff' : 'var(--color-text)',
              }}
            >
              ${v.toFixed(2)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Custom ($)</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            placeholder="e.g. 2.50"
            value={customBudget}
            onChange={e => {
              setCustomBudget(e.target.value);
              const v = parseFloat(e.target.value);
              if (v > 0) setSessionBudget(v);
            }}
            className="w-28 px-3 py-1.5 rounded-lg border text-xs outline-none"
            style={{
              background: 'var(--color-surface)',
              borderColor: customBudget && !BUDGET_PRESETS.includes(sessionBudget) && sessionBudget !== null
                ? 'var(--color-primary)'
                : 'var(--color-border)',
              color: 'var(--color-text)',
            }}
          />
          {sessionBudget !== null && (
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Warn at ${(sessionBudget * 0.8).toFixed(3)} (80%) and ${sessionBudget.toFixed(2)} (100%)
            </span>
          )}
        </div>
      </section>

      {/* Upload File Types */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--color-muted)' }}>
          Upload File Types
        </h2>
        <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>
          Comma-separated list of accepted file extensions and MIME types for all file upload inputs.
        </p>
        <input
          type="text"
          value={allowedFileTypes}
          onChange={(e) => setAllowedFileTypes(e.target.value)}
          className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none font-mono"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          placeholder=".pdf,.txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.php,.py,.css,.html,.sql,.sh,.env.example,image/*"
        />
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={saveFileTypes}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-80"
            style={{ background: 'var(--color-primary)' }}
          >
            Save
          </button>
          <button
            onClick={resetFileTypes}
            className="px-3 py-1.5 rounded-lg text-xs border transition-opacity hover:opacity-70"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-surface)' }}
          >
            Reset to defaults
          </button>
          {fileTypesSaved && (
            <span className="text-xs" style={{ color: 'var(--color-primary)' }}>Saved ✓</span>
          )}
        </div>
        <p className="text-xs mt-1.5" style={{ color: 'var(--color-muted)', opacity: 0.7 }}>
          Examples: <code>.pdf,.docx,.xlsx</code> or <code>image/*</code> or <code>.pdf,image/*,.txt</code>
        </p>
      </section>

      {/* AI Models */}
      <section>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold uppercase tracking-widest" style={{ color: 'var(--color-muted)' }}>
            AI Models
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={resetModels}
              className="text-xs px-2 py-1 rounded-lg border transition-opacity hover:opacity-70"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-surface)' }}
              title="Reset to defaults"
            >
              Reset defaults
            </button>
            <button
              onClick={openAdd}
              className="text-xs px-2 py-1 rounded-lg text-white transition-opacity hover:opacity-80"
              style={{ background: 'var(--color-primary)' }}
            >
              + Add model
            </button>
          </div>
        </div>
        <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
          Add, edit, or remove models. The model ID must match the exact API identifier (e.g. <code>claude-sonnet-4-6</code>).
        </p>

        {/* Add / Edit form */}
        {editingModel && (
          <div className="rounded-xl border p-4 mb-4 space-y-3" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-primary)' }}>
            <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-primary)' }}>
              {editingModel === 'new' ? 'Add model' : 'Edit model'}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Model API ID *</label>
                <input
                  className="w-full px-3 py-2 rounded-lg border text-xs outline-none font-mono"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  placeholder="e.g. claude-haiku-4-5-20251001"
                  value={modelForm.id}
                  onChange={e => setModelForm(f => ({ ...f, id: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Display name *</label>
                <input
                  className="w-full px-3 py-2 rounded-lg border text-xs outline-none"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  placeholder="e.g. Haiku 4.5"
                  value={modelForm.name}
                  onChange={e => setModelForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Label</label>
                <input
                  className="w-full px-3 py-2 rounded-lg border text-xs outline-none"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  placeholder="e.g. Economy"
                  value={modelForm.label}
                  onChange={e => setModelForm(f => ({ ...f, label: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Provider</label>
                <select
                  className="w-full px-3 py-2 rounded-lg border text-xs outline-none"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  value={modelForm.provider}
                  onChange={e => setModelForm(f => ({ ...f, provider: e.target.value }))}
                >
                  <option value="anthropic">Anthropic</option>
                  <option value="gemini">Google Gemini</option>
                </select>
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Emoji</label>
                <input
                  className="w-full px-3 py-2 rounded-lg border text-xs outline-none"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  placeholder="⚡"
                  value={modelForm.emoji}
                  onChange={e => setModelForm(f => ({ ...f, emoji: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Tagline</label>
                <input
                  className="w-full px-3 py-2 rounded-lg border text-xs outline-none"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  placeholder="e.g. Fast & affordable"
                  value={modelForm.tagline}
                  onChange={e => setModelForm(f => ({ ...f, tagline: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Description</label>
              <input
                className="w-full px-3 py-2 rounded-lg border text-xs outline-none"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                placeholder="e.g. Best for quick tasks, drafts, and simple Q&A"
                value={modelForm.desc}
                onChange={e => setModelForm(f => ({ ...f, desc: e.target.value }))}
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={saveModel}
                disabled={!modelForm.id.trim() || !modelForm.name.trim()}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-80 disabled:opacity-40"
                style={{ background: 'var(--color-primary)' }}
              >
                {editingModel === 'new' ? 'Add' : 'Save'}
              </button>
              <button
                onClick={cancelEdit}
                className="px-3 py-1.5 rounded-lg text-xs border transition-opacity hover:opacity-70"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Model list */}
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          {models.map((m, i) => {
            const configured = modelStatus ? modelStatus[m.provider] : null;
            return (
              <div
                key={m.id}
                className="flex flex-col px-4 py-3"
                style={{
                  background: 'var(--color-surface)',
                  borderBottom: i < models.length - 1 ? '1px solid var(--color-border)' : 'none',
                }}
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl flex-shrink-0">{m.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{m.name}</span>
                      {m.label && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}>{m.label}</span>}
                    </div>
                    <div className="text-xs font-mono mt-0.5 truncate" style={{ color: 'var(--color-muted)', opacity: 0.7 }}>{m.id}</div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {configured === true && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#dcfce7', color: '#16a34a' }}>✓ Key set</span>
                    )}
                    {configured === false && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full" title={m.provider === 'gemini' ? 'GEMINI_API_KEY not set' : 'ANTHROPIC_API_KEY not set'} style={{ background: '#fef3c7', color: '#b45309' }}>⚠️ Key missing</span>
                    )}
                    <button
                      onClick={() => testModel(m.id)}
                      disabled={testResults[m.id]?.status === 'testing'}
                      className="text-xs px-2 py-1 rounded border transition-opacity hover:opacity-70 disabled:opacity-50"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
                    >
                      {testResults[m.id]?.status === 'testing' ? 'Testing…' : 'Test'}
                    </button>
                    <button
                      onClick={() => openEdit(m)}
                      className="text-xs px-2 py-1 rounded border transition-opacity hover:opacity-70"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteModel(m.id)}
                      className="text-xs px-2 py-1 rounded border transition-opacity hover:opacity-70"
                      style={{ borderColor: '#fca5a5', color: '#991b1b' }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {testResults[m.id] && testResults[m.id].status !== 'testing' && (
                  <div
                    className="mt-2 px-3 py-2 rounded-lg text-xs flex items-start gap-2"
                    style={{
                      background: testResults[m.id].status === 'ok' ? '#f0fdf4' : '#fff1f2',
                      color: testResults[m.id].status === 'ok' ? '#16a34a' : '#991b1b',
                    }}
                  >
                    <span className="flex-shrink-0">{testResults[m.id].status === 'ok' ? '✓' : '✗'}</span>
                    <span className="flex-1">{testResults[m.id].message}{testResults[m.id].hint ? ` — ${testResults[m.id].hint}` : ''}</span>
                    <button onClick={() => setTestResults(r => { const n = { ...r }; delete n[m.id]; return n; })} className="flex-shrink-0 opacity-50 hover:opacity-100">✕</button>
                  </div>
                )}
              </div>
            );
          })}
          {models.length === 0 && (
            <div className="px-4 py-6 text-center text-xs" style={{ color: 'var(--color-muted)' }}>
              No models configured. Add one above or reset to defaults.
            </div>
          )}
        </div>
      </section>

      {/* Change Password */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest mb-4" style={{ color: 'var(--color-muted)' }}>
          Change Password
        </h2>
        <form
          onSubmit={handleChangePassword}
          className="rounded-2xl border p-6 space-y-4"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
        >
          {[
            { label: 'Current Password', key: 'current' },
            { label: 'New Password', key: 'next' },
            { label: 'Confirm New Password', key: 'confirm' },
          ].map(({ label, key }) => (
            <div key={key}>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
                {label}
              </label>
              <div className="relative">
                <input
                  type={showPwFields[key] ? 'text' : 'password'}
                  value={pwForm[key]}
                  onChange={e => setPwForm(f => ({ ...f, [key]: e.target.value }))}
                  required
                  placeholder="••••••••"
                  className="w-full px-3 py-2.5 pr-10 rounded-xl border text-sm outline-none"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPwFields((prev) => ({ ...prev, [key]: !prev[key] }))}
                  className="absolute right-3 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100 transition-opacity"
                  style={{ color: 'var(--color-muted)' }}
                >
                  {getIcon(showPwFields[key] ? 'eye-off' : 'eye', { size: 14 })}
                </button>
              </div>
            </div>
          ))}
          {pwStatus && (
            <p className="text-xs" style={{ color: pwStatus.ok ? 'var(--color-primary)' : '#ef4444' }}>
              {pwStatus.msg}
            </p>
          )}
          <button
            type="submit"
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-80"
            style={{ background: 'var(--color-primary)' }}
          >
            Update Password
          </button>
        </form>
      </section>

      {/* Live Preview */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest mb-4" style={{ color: 'var(--color-muted)' }}>
          Preview
        </h2>
        <div
          className="p-4 rounded-lg border space-y-3"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
        >
          <div className="flex items-center gap-2">
            {getIcon('folder', { size: 16 })}
            <span className="text-sm">Sample Project</span>
          </div>
          <div className="flex items-center gap-2">
            {getIcon('chat', { size: 16 })}
            <span className="text-sm">Chat Session</span>
          </div>
          <div className="flex items-center gap-2">
            {getIcon('settings', { size: 16 })}
            <span className="text-sm">Settings & Preferences</span>
          </div>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            The quick brown fox jumps over the lazy dog
          </p>
          <button
            className="px-3 py-1 rounded text-xs text-white font-medium"
            style={{ background: 'var(--color-primary)' }}
          >
            Primary Action
          </button>
        </div>
      </section>

      {/* Integrations */}
      <section>
        <h2 className="text-base font-semibold mb-4" style={{ color: 'var(--color-text)' }}>Integrations</h2>
        <GmailConnect />
      </section>

      {/* Product Tours */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest mb-4" style={{ color: 'var(--color-muted)' }}>
          Product Tours
        </h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-4 rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Goals &amp; 7 Habits Tour</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                8-step walkthrough of Mission Statement, Renewal Balance, OKRs, and Eisenhower Matrix
              </p>
            </div>
            <button
              onClick={() => {
                localStorage.removeItem(TOUR_KEY);
                navigate('/goals');
                setTimeout(() => startGoalsTour(navigate), 800);
              }}
              className="flex-shrink-0 ml-4 px-4 py-2 rounded-lg border text-sm font-medium transition-all hover:opacity-80"
              style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)', background: 'transparent' }}
            >
              Retake Tour
            </button>
          </div>
          <div className="flex items-center justify-between p-4 rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Task Manager Tour</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                10-step walkthrough of views, Quick Capture, Focus Mode, templates, and Weekly Review
              </p>
            </div>
            <button
              onClick={() => {
                localStorage.removeItem(TASKS_TOUR_KEY);
                navigate('/tasks');
                setTimeout(() => startTasksTour(navigate), 800);
              }}
              className="flex-shrink-0 ml-4 px-4 py-2 rounded-lg border text-sm font-medium transition-all hover:opacity-80"
              style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)', background: 'transparent' }}
            >
              Retake Tour
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export default SettingsPage;
