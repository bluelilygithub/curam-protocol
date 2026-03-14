import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useIcon } from '../providers/IconProvider';
import api from '../utils/apiClient';
import useAuthStore from '../store/authStore';

// ── Constants ─────────────────────────────────────────────────────────────────

const MODELS = [
  { value: 'claude-sonnet-4-6',          label: 'Claude Sonnet 4.6' },
  { value: 'claude-opus-4-6',            label: 'Claude Opus 4.6' },
  { value: 'claude-haiku-4-5-20251001',  label: 'Claude Haiku 4.5' },
  { value: 'gemini-2.0-flash',           label: 'Gemini 2.0 Flash' },
  { value: 'gemini-1.5-pro',             label: 'Gemini 1.5 Pro' },
];

const STARTER_CHAINS = [
  {
    name: 'Blog Post Generator',
    description: 'Turn a topic into a polished blog post in three stages.',
    steps: [
      {
        id: 's1', label: 'Research & Outline',
        prompt: 'Create a detailed outline for a blog post about: {{input}}\n\nInclude an introduction hook, 4-5 main sections with key points, and a conclusion.',
        model: 'claude-sonnet-4-6',
      },
      {
        id: 's2', label: 'Write Draft',
        prompt: 'Using this outline:\n\n{{output}}\n\nWrite a full, engaging blog post. Use a conversational tone, concrete examples, and clear headings.',
        model: 'claude-sonnet-4-6',
      },
      {
        id: 's3', label: 'Polish & SEO',
        prompt: 'Review and improve this blog post:\n\n{{output}}\n\nFix any awkward phrasing, strengthen the opening hook, add a compelling meta description, and suggest 5 relevant SEO keywords.',
        model: 'claude-haiku-4-5-20251001',
      },
    ],
  },
  {
    name: 'Code Review Pipeline',
    description: 'Analyse code, suggest improvements, then write a summary report.',
    steps: [
      {
        id: 's1', label: 'Analyse Code',
        prompt: 'Analyse the following code for bugs, security issues, performance problems, and style violations:\n\n```\n{{input}}\n```\n\nList each issue with its severity (High / Medium / Low) and location.',
        model: 'claude-sonnet-4-6',
      },
      {
        id: 's2', label: 'Suggest Fixes',
        prompt: 'Based on these issues:\n\n{{output}}\n\nProvide concrete code fixes for each High and Medium severity issue. Show the before and after for each change.',
        model: 'claude-sonnet-4-6',
      },
      {
        id: 's3', label: 'Review Summary',
        prompt: 'Write a concise code review summary based on:\n\nIssues found:\n{{step_1}}\n\nProposed fixes:\n{{step_2}}\n\nFormat it as an actionable report a developer can act on immediately.',
        model: 'claude-haiku-4-5-20251001',
      },
    ],
  },
  {
    name: 'Meeting Notes Processor',
    description: 'Extract action items, prioritise them, and draft a follow-up email.',
    steps: [
      {
        id: 's1', label: 'Extract Action Items',
        prompt: 'Extract all action items, decisions, and open questions from these meeting notes:\n\n{{input}}\n\nFormat as a numbered list with owner and deadline (if mentioned).',
        model: 'claude-sonnet-4-6',
      },
      {
        id: 's2', label: 'Prioritise',
        prompt: 'Prioritise these action items by urgency and impact:\n\n{{output}}\n\nGroup them as: Must Do This Week / Should Do Soon / Can Wait. Add a one-line reason for each grouping.',
        model: 'claude-haiku-4-5-20251001',
      },
      {
        id: 's3', label: 'Draft Follow-up Email',
        prompt: 'Write a professional follow-up email to meeting attendees based on:\n\nAction items: {{step_1}}\n\nPrioritised plan: {{step_2}}\n\nKeep it concise, clear, and action-oriented.',
        model: 'claude-sonnet-4-6',
      },
    ],
  },
];

function newStep() {
  return {
    id: `s${Date.now()}`,
    label: '',
    prompt: '',
    model: 'claude-sonnet-4-6',
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StepCard({ step, index, total, onChange, onRemove, onMoveUp, onMoveDown }) {
  return (
    <div
      className="rounded-lg border p-4"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
    >
      <div className="flex items-center gap-2 mb-3">
        <span
          className="text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--color-primary)', color: '#fff' }}
        >
          {index + 1}
        </span>
        <input
          className="flex-1 text-sm font-medium bg-transparent border-none outline-none"
          style={{ color: 'var(--color-text)' }}
          placeholder={`Step ${index + 1} label (optional)`}
          value={step.label}
          onChange={e => onChange({ ...step, label: e.target.value })}
        />
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            disabled={index === 0}
            onClick={onMoveUp}
            className="w-6 h-6 flex items-center justify-center rounded hover:opacity-60 disabled:opacity-20"
            style={{ color: 'var(--color-muted)' }}
            title="Move up"
          >↑</button>
          <button
            disabled={index === total - 1}
            onClick={onMoveDown}
            className="w-6 h-6 flex items-center justify-center rounded hover:opacity-60 disabled:opacity-20"
            style={{ color: 'var(--color-muted)' }}
            title="Move down"
          >↓</button>
          <button
            onClick={onRemove}
            className="w-6 h-6 flex items-center justify-center rounded hover:opacity-60"
            style={{ color: 'var(--color-danger, #ef4444)' }}
            title="Remove step"
          >✕</button>
        </div>
      </div>

      <textarea
        className="w-full text-sm rounded-md border px-3 py-2 resize-none"
        style={{
          borderColor: 'var(--color-border)',
          background: 'var(--color-surface)',
          color: 'var(--color-text)',
          minHeight: '100px',
          fontFamily: 'inherit',
        }}
        placeholder={'Prompt for this step.\n\nUse {{input}} for the initial input, {{output}} for the previous step\'s output, or {{step_N}} for a specific step.'}
        value={step.prompt}
        onChange={e => onChange({ ...step, prompt: e.target.value })}
      />

      <div className="mt-2">
        <select
          className="text-xs rounded border px-2 py-1"
          style={{
            borderColor: 'var(--color-border)',
            background: 'var(--color-surface)',
            color: 'var(--color-text)',
          }}
          value={step.model}
          onChange={e => onChange({ ...step, model: e.target.value })}
        >
          {MODELS.map(m => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

function RunModal({ chain, onClose, token }) {
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [stepOutputs, setStepOutputs] = useState([]);
  const [stepChunks, setStepChunks] = useState([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);
  const outputRefs = useRef([]);
  const steps = JSON.parse(chain.steps || '[]');

  const handleRun = useCallback(async () => {
    if (!input.trim()) return;
    setRunning(true);
    setStarted(true);
    setCurrentStep(0);
    setStepOutputs(Array(steps.length).fill(''));
    setStepChunks(Array(steps.length).fill(''));
    setDone(false);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const resp = await fetch(`/api/chains/${chain.id}/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ input }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const json = await resp.json().catch(() => ({}));
        throw new Error(json.error || 'Run failed');
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done: readerDone, value } = await reader.read();
        if (readerDone) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        let eventType = null;
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ') && eventType) {
            try {
              const data = JSON.parse(line.slice(6));
              if (eventType === 'step_start') {
                setCurrentStep(data.stepIndex);
              } else if (eventType === 'step_chunk') {
                setStepChunks(prev => {
                  const next = [...prev];
                  next[data.stepIndex] = (next[data.stepIndex] || '') + data.chunk;
                  return next;
                });
                // Auto-scroll
                const ref = outputRefs.current[data.stepIndex];
                if (ref) ref.scrollTop = ref.scrollHeight;
              } else if (eventType === 'step_done') {
                setStepOutputs(prev => {
                  const next = [...prev];
                  next[data.stepIndex] = data.output;
                  return next;
                });
              } else if (eventType === 'chain_done') {
                setDone(true);
                setRunning(false);
              } else if (eventType === 'error') {
                throw new Error(data.message || 'Step failed');
              }
            } catch (parseErr) {
              if (eventType === 'error') throw parseErr;
            }
            eventType = null;
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message);
      }
      setRunning(false);
    }
  }, [input, chain.id, steps.length, token]);

  const handleStop = () => {
    abortRef.current?.abort();
    setRunning(false);
  };

  const copyOutput = (text) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div
        className="flex flex-col rounded-xl shadow-2xl w-full max-w-2xl mx-4"
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          maxHeight: '90vh',
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b flex-shrink-0" style={{ borderColor: 'var(--color-border)' }}>
          <span className="text-lg">⛓</span>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>{chain.name}</h2>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{steps.length} step{steps.length !== 1 ? 's' : ''}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-md hover:opacity-60" style={{ color: 'var(--color-muted)' }}>✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Input */}
          {!started && (
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-muted)' }}>
                Initial Input <span style={{ color: 'var(--color-muted)', fontWeight: 400 }}>(available as <code>{'{{input}}'}</code> in each step)</span>
              </label>
              <textarea
                className="w-full text-sm rounded-lg border px-3 py-2 resize-none"
                style={{
                  borderColor: 'var(--color-border)',
                  background: 'var(--color-bg)',
                  color: 'var(--color-text)',
                  minHeight: '80px',
                  fontFamily: 'inherit',
                }}
                placeholder="Paste your content or describe your topic here…"
                value={input}
                onChange={e => setInput(e.target.value)}
                autoFocus
              />
            </div>
          )}

          {/* Steps progress */}
          {started && steps.map((step, i) => {
            const isActive = i === currentStep && running;
            const isComplete = done || i < currentStep || (i === currentStep && !running && stepOutputs[i]);
            const output = stepChunks[i] || stepOutputs[i] || '';

            return (
              <div key={step.id || i} className="rounded-lg border overflow-hidden" style={{ borderColor: isActive ? 'var(--color-primary)' : 'var(--color-border)' }}>
                <div
                  className="flex items-center gap-2 px-3 py-2"
                  style={{
                    background: isActive ? 'color-mix(in srgb, var(--color-primary) 10%, transparent)' : 'var(--color-bg)',
                    borderBottom: output ? '1px solid var(--color-border)' : 'none',
                  }}
                >
                  <span
                    className="text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0"
                    style={{
                      background: isComplete ? '#22c55e' : isActive ? 'var(--color-primary)' : 'var(--color-border)',
                      color: isComplete || isActive ? '#fff' : 'var(--color-muted)',
                    }}
                  >
                    {isComplete ? '✓' : i + 1}
                  </span>
                  <span className="text-sm font-medium flex-1" style={{ color: 'var(--color-text)' }}>
                    {step.label || `Step ${i + 1}`}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    {MODELS.find(m => m.value === step.model)?.label?.split(' ').slice(-1)[0] || step.model}
                  </span>
                  {isActive && (
                    <span className="text-xs animate-pulse" style={{ color: 'var(--color-primary)' }}>Running…</span>
                  )}
                  {isComplete && output && (
                    <button
                      onClick={() => copyOutput(output)}
                      className="text-xs px-2 py-0.5 rounded border hover:opacity-70"
                      style={{ color: 'var(--color-muted)', borderColor: 'var(--color-border)' }}
                    >
                      Copy
                    </button>
                  )}
                </div>
                {output && (
                  <div
                    ref={el => outputRefs.current[i] = el}
                    className="px-3 py-2 text-sm overflow-y-auto"
                    style={{
                      color: 'var(--color-text)',
                      background: 'var(--color-surface)',
                      maxHeight: '200px',
                      whiteSpace: 'pre-wrap',
                      fontFamily: 'inherit',
                    }}
                  >
                    {output}
                    {isActive && <span className="animate-pulse" style={{ color: 'var(--color-primary)' }}>▊</span>}
                  </div>
                )}
              </div>
            );
          })}

          {error && (
            <div className="rounded-lg px-4 py-3 text-sm" style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
              {error}
            </div>
          )}

          {done && (
            <div className="rounded-lg px-4 py-3 text-sm text-center" style={{ background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }}>
              Chain complete ✓
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-5 py-4 border-t flex-shrink-0" style={{ borderColor: 'var(--color-border)' }}>
          {!started && (
            <>
              <button
                onClick={handleRun}
                disabled={!input.trim()}
                className="flex-1 py-2 rounded-lg text-sm font-medium transition-opacity disabled:opacity-40"
                style={{ background: 'var(--color-primary)', color: '#fff' }}
              >
                Run Chain
              </button>
              <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
                Cancel
              </button>
            </>
          )}
          {started && running && (
            <button
              onClick={handleStop}
              className="px-4 py-2 rounded-lg text-sm font-medium border"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
            >
              Stop
            </button>
          )}
          {started && !running && (
            <>
              <button
                onClick={() => { setStarted(false); setStepChunks(Array(steps.length).fill('')); setStepOutputs(Array(steps.length).fill('')); setDone(false); setError(null); }}
                className="px-4 py-2 rounded-lg text-sm border"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                Run Again
              </button>
              <div className="flex-1" />
              <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
                Close
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ChainsPage() {
  const getIcon = useIcon();
  const { token } = useAuthStore();

  const [chains, setChains] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null); // chain being edited
  const [saving, setSaving] = useState(false);
  const [runTarget, setRunTarget] = useState(null); // chain to run

  // Edited state
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editSteps, setEditSteps] = useState([]);
  const [dirty, setDirty] = useState(false);

  const fetchChains = useCallback(async () => {
    try {
      const res = await api.get('/api/chains');
      const data = await res.json();
      setChains(Array.isArray(data) ? data : []);
    } catch (_) {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchChains(); }, [fetchChains]);

  const loadChain = useCallback((chain) => {
    setSelected(chain);
    setEditName(chain.name);
    setEditDesc(chain.description || '');
    setEditSteps(JSON.parse(chain.steps || '[]'));
    setDirty(false);
  }, []);

  const handleNew = () => {
    const blank = { id: null, name: 'Untitled Chain', description: '', steps: '[]' };
    setSelected(blank);
    setEditName('Untitled Chain');
    setEditDesc('');
    setEditSteps([newStep()]);
    setDirty(true);
  };

  const handleFromStarter = async (starter) => {
    setSaving(true);
    try {
      const res = await api.post('/api/chains', starter);
      const created = await res.json();
      await fetchChains();
      loadChain({ ...created, steps: JSON.stringify(starter.steps) });
    } catch (_) {}
    setSaving(false);
  };

  const handleSave = async () => {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      if (selected?.id) {
        const res = await api.put(`/api/chains/${selected.id}`, {
          name: editName,
          description: editDesc,
          steps: editSteps,
        });
        const updated = await res.json();
        await fetchChains();
        setSelected(updated);
        setDirty(false);
      } else {
        const res = await api.post('/api/chains', {
          name: editName,
          description: editDesc,
          steps: editSteps,
        });
        const created = await res.json();
        await fetchChains();
        loadChain({ ...created, steps: JSON.stringify(editSteps) });
      }
    } catch (_) {}
    setSaving(false);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this chain?')) return;
    await api.delete(`/api/chains/${id}`);
    await fetchChains();
    if (selected?.id === id) {
      setSelected(null);
    }
  };

  const updateStep = (index, updated) => {
    const next = editSteps.map((s, i) => i === index ? updated : s);
    setEditSteps(next);
    setDirty(true);
  };

  const removeStep = (index) => {
    setEditSteps(editSteps.filter((_, i) => i !== index));
    setDirty(true);
  };

  const moveStep = (index, dir) => {
    const next = [...editSteps];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setEditSteps(next);
    setDirty(true);
  };

  const addStep = () => {
    setEditSteps([...editSteps, newStep()]);
    setDirty(true);
  };

  return (
    <div className="flex h-full" style={{ color: 'var(--color-text)' }}>
      {/* Left panel — chain list */}
      <div
        className="flex flex-col flex-shrink-0 border-r"
        style={{ width: '260px', borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <span className="text-base font-semibold flex-1" style={{ color: 'var(--color-text)' }}>Prompt Chains</span>
          <button
            onClick={handleNew}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:opacity-70"
            style={{ background: 'var(--color-primary)', color: '#fff' }}
            title="New chain"
          >
            {getIcon('plus', { size: 14 })}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {loading && (
            <p className="px-4 py-8 text-center text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>
          )}

          {!loading && chains.length === 0 && (
            <div className="px-4 py-4 space-y-2">
              <p className="text-xs font-medium mb-3" style={{ color: 'var(--color-muted)' }}>Starter templates</p>
              {STARTER_CHAINS.map((s, i) => (
                <button
                  key={i}
                  onClick={() => handleFromStarter(s)}
                  disabled={saving}
                  className="w-full text-left rounded-lg p-3 border hover:opacity-80 transition-opacity"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
                >
                  <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{s.name}</p>
                  <p className="text-xs mt-0.5 leading-snug" style={{ color: 'var(--color-muted)' }}>{s.description}</p>
                </button>
              ))}
            </div>
          )}

          {chains.map(c => (
            <div
              key={c.id}
              className="group flex items-center gap-2 px-3 py-2.5 cursor-pointer mx-2 rounded-lg"
              style={{
                background: selected?.id === c.id ? 'color-mix(in srgb, var(--color-primary) 12%, transparent)' : 'transparent',
              }}
              onClick={() => loadChain(c)}
            >
              <span className="text-base flex-shrink-0">⛓</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>{c.name}</p>
                <p className="text-xs truncate" style={{ color: 'var(--color-muted)' }}>
                  {JSON.parse(c.steps || '[]').length} steps
                </p>
              </div>
              <button
                onClick={e => { e.stopPropagation(); handleDelete(c.id); }}
                className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center rounded hover:opacity-60 transition-opacity flex-shrink-0"
                style={{ color: 'var(--color-muted)' }}
                title="Delete"
              >
                {getIcon('trash', { size: 13 })}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel — editor */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {!selected ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
            <div className="text-5xl">⛓</div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Prompt Chains</h2>
            <p className="text-sm text-center max-w-sm" style={{ color: 'var(--color-muted)' }}>
              Build reusable multi-step AI pipelines. Each step's output becomes the input for the next.
              Use <code style={{ fontSize: '0.75rem' }}>{'{{input}}'}</code>, <code style={{ fontSize: '0.75rem' }}>{'{{output}}'}</code>, or <code style={{ fontSize: '0.75rem' }}>{'{{step_N}}'}</code> in prompts.
            </p>
            <button
              onClick={handleNew}
              className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{ background: 'var(--color-primary)', color: '#fff' }}
            >
              Create your first chain
            </button>
          </div>
        ) : (
          <>
            {/* Editor toolbar */}
            <div className="flex items-center gap-2 px-5 py-3 border-b flex-shrink-0" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
              <div className="flex-1 min-w-0">
                <input
                  className="w-full text-base font-semibold bg-transparent border-none outline-none"
                  style={{ color: 'var(--color-text)' }}
                  placeholder="Chain name"
                  value={editName}
                  onChange={e => { setEditName(e.target.value); setDirty(true); }}
                />
                <input
                  className="w-full text-xs bg-transparent border-none outline-none mt-0.5"
                  style={{ color: 'var(--color-muted)' }}
                  placeholder="Description (optional)"
                  value={editDesc}
                  onChange={e => { setEditDesc(e.target.value); setDirty(true); }}
                />
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {dirty && (
                  <button
                    onClick={handleSave}
                    disabled={saving || !editName.trim()}
                    className="px-3 py-1.5 rounded-md text-xs font-medium disabled:opacity-50"
                    style={{ background: 'var(--color-primary)', color: '#fff' }}
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                )}
                {selected?.id && (
                  <button
                    onClick={() => setRunTarget(selected)}
                    disabled={editSteps.length === 0}
                    className="px-3 py-1.5 rounded-md text-xs font-medium border disabled:opacity-40"
                    style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
                  >
                    ▶ Run
                  </button>
                )}
              </div>
            </div>

            {/* Steps editor */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {editSteps.map((step, i) => (
                <StepCard
                  key={step.id || i}
                  step={step}
                  index={i}
                  total={editSteps.length}
                  onChange={updated => updateStep(i, updated)}
                  onRemove={() => removeStep(i)}
                  onMoveUp={() => moveStep(i, -1)}
                  onMoveDown={() => moveStep(i, 1)}
                />
              ))}

              <button
                onClick={addStep}
                className="w-full py-2.5 rounded-lg border border-dashed text-sm flex items-center justify-center gap-2 hover:opacity-70 transition-opacity"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                {getIcon('plus', { size: 14 })}
                Add step
              </button>

              {/* Template hints */}
              <div className="rounded-lg p-4 text-xs space-y-1" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                <p className="font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Template variables</p>
                <p style={{ color: 'var(--color-muted)' }}><code>{'{{input}}'}</code> — the initial input provided when the chain is run</p>
                <p style={{ color: 'var(--color-muted)' }}><code>{'{{output}}'}</code> — the output of the previous step</p>
                <p style={{ color: 'var(--color-muted)' }}><code>{'{{step_1}}'}</code>, <code>{'{{step_2}}'}</code>… — output of a specific step by number</p>
              </div>

              <div className="h-4" />
            </div>
          </>
        )}
      </div>

      {/* Run modal */}
      {runTarget && (
        <RunModal
          chain={{ ...runTarget, steps: JSON.stringify(editSteps) }}
          onClose={() => setRunTarget(null)}
          token={token}
        />
      )}
    </div>
  );
}
