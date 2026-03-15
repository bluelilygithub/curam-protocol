import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../utils/apiClient';

const DRAFT_KEY = 'wizardDraft';
const RENEWAL_DIMS = [
  { key: 'physical', label: 'Physical', emoji: '🏃', desc: 'Body, health, exercise, nutrition', color: '#3b82f6' },
  { key: 'mental', label: 'Mental', emoji: '📚', desc: 'Learning, reading, creativity, skills', color: '#22c55e' },
  { key: 'social', label: 'Social', emoji: '🤝', desc: 'Relationships, empathy, service, community', color: '#f59e0b' },
  { key: 'spiritual', label: 'Spiritual', emoji: '🌱', desc: 'Mission, values, meditation, purpose', color: '#8b5cf6' },
];

const PRESET_COLORS = ['#6366f1', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6'];

function saveDraft(data) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(data)); } catch {}
}
function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { return null; }
}
function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch {}
}

async function streamSSE(res, onToken) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let accumulated = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6);
      if (payload === '[DONE]') return accumulated;
      try { const token = JSON.parse(payload); accumulated += token; onToken(accumulated); } catch {}
    }
  }
  return accumulated;
}

// Progress bar
function StepDots({ step, total }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          style={{
            width: i + 1 === step ? 20 : 8,
            height: 8,
            borderRadius: 4,
            background: i + 1 <= step ? 'var(--color-primary)' : 'var(--color-border)',
            transition: 'all 0.25s',
          }}
        />
      ))}
    </div>
  );
}

// ── Step 1: Personal Context ───────────────────────────────────────────────────
function Step1({ data, onChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <div style={{ fontSize: 24, marginBottom: 4 }}>✨</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text)', margin: '0 0 6px' }}>
          Let's start with you
        </h2>
        <p style={{ fontSize: 13, color: 'var(--color-muted)', margin: 0, lineHeight: 1.6 }}>
          Three quick questions to help Claude understand your world. There are no right answers — be honest with yourself.
        </p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Field
          label="What matters most to you right now in life?"
          placeholder="e.g. Being present for my family, growing my business, staying healthy…"
          value={data.mattersMost}
          onChange={v => onChange({ ...data, mattersMost: v })}
          rows={2}
        />
        <Field
          label="What are you actively working to get better at?"
          placeholder="e.g. Public speaking, deep focus, cooking, being more patient…"
          value={data.betterAt}
          onChange={v => onChange({ ...data, betterAt: v })}
          rows={2}
        />
        <Field
          label="What stage of life are you in? (optional)"
          placeholder="e.g. Early career, new parent, mid-life transition, approaching retirement…"
          value={data.lifeStage}
          onChange={v => onChange({ ...data, lifeStage: v })}
          rows={1}
        />
      </div>
    </div>
  );
}

// ── Step 2: Mission Statement ──────────────────────────────────────────────────
function Step2({ data, onChange }) {
  const [generating, setGenerating] = useState(false);
  const [done, setDone] = useState(false);
  const generated = data.missionGenerated || '';

  const handleGenerate = async () => {
    setGenerating(true);
    setDone(false);
    onChange({ ...data, missionGenerated: '', missionFinal: '' });
    try {
      const res = await api.post('/api/goals/wizard/generate-mission', {
        mattersMost: data.mattersMost,
        betterAt: data.betterAt,
        lifeStage: data.lifeStage,
      });
      const text = await streamSSE(res, (acc) => {
        onChange({ ...data, missionGenerated: acc, missionFinal: acc });
      });
      onChange(prev => ({ ...prev, missionGenerated: text, missionFinal: prev.missionFinal || text }));
      setDone(true);
    } catch { setDone(true); } finally { setGenerating(false); }
  };

  useEffect(() => {
    if (!generated) handleGenerate();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <div style={{ fontSize: 24, marginBottom: 4 }}>🧭</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text)', margin: '0 0 6px' }}>
          Your Mission Statement
        </h2>
        <p style={{ fontSize: 13, color: 'var(--color-muted)', margin: 0, lineHeight: 1.6 }}>
          Claude has drafted a personal mission statement from your answers. Edit it until it feels true to you — this is your north star.
        </p>
      </div>

      {/* Generated preview */}
      <div
        style={{
          padding: '14px 16px',
          borderRadius: 10,
          borderLeft: '3px solid var(--color-primary)',
          background: 'var(--color-bg)',
          fontStyle: 'italic',
          fontSize: 14,
          lineHeight: 1.7,
          color: 'var(--color-text)',
          minHeight: 60,
        }}
      >
        {generating && !generated
          ? <span style={{ color: 'var(--color-muted)' }}>Writing your mission statement…</span>
          : <span>{data.missionGenerated}</span>}
        {generating && <span style={{ color: 'var(--color-primary)', marginLeft: 2 }}>▊</span>}
      </div>

      {(done || generated) && (
        <>
          <div>
            <label style={{ fontSize: 11, color: 'var(--color-muted)', display: 'block', marginBottom: 6 }}>
              Edit to make it yours
            </label>
            <textarea
              value={data.missionFinal || ''}
              onChange={e => onChange({ ...data, missionFinal: e.target.value })}
              rows={4}
              style={{
                width: '100%', fontSize: 14, padding: '10px 12px', borderRadius: 8,
                border: '1px solid var(--color-border)', background: 'var(--color-surface)',
                color: 'var(--color-text)', outline: 'none', resize: 'vertical',
                fontStyle: 'italic', lineHeight: 1.65, boxSizing: 'border-box',
              }}
            />
          </div>
          <button
            onClick={handleGenerate}
            disabled={generating}
            style={{
              alignSelf: 'flex-start', fontSize: 12, padding: '5px 12px', borderRadius: 7,
              border: '1px solid var(--color-border)', background: 'none', color: 'var(--color-muted)',
              cursor: 'pointer', opacity: generating ? 0.5 : 1,
            }}
          >
            ↻ Regenerate
          </button>
        </>
      )}
    </div>
  );
}

// ── Step 3: First Objective ────────────────────────────────────────────────────
function Step3({ data, onChange }) {
  const [suggesting, setSuggesting] = useState(false);
  const [suggested, setSuggested] = useState(false);

  const handleSuggest = async () => {
    setSuggesting(true);
    try {
      const res = await api.post('/api/goals/wizard/suggest-objective', {
        mission: data.missionFinal,
        mattersMost: data.mattersMost,
      });
      const suggestion = await res.json();
      onChange({
        ...data,
        objective: {
          title: suggestion.title || '',
          description: suggestion.description || '',
          timeframe: suggestion.timeframe || '',
          color: suggestion.color || '#6366f1',
        },
      });
      setSuggested(true);
    } catch {} finally { setSuggesting(false); }
  };

  useEffect(() => {
    if (!data.objective?.title) handleSuggest();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const obj = data.objective || {};
  const setObj = (patch) => onChange({ ...data, objective: { ...obj, ...patch } });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <div style={{ fontSize: 24, marginBottom: 4 }}>🎯</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text)', margin: '0 0 6px' }}>
          Your first objective
        </h2>
        <p style={{ fontSize: 13, color: 'var(--color-muted)', margin: 0, lineHeight: 1.6 }}>
          An objective is a meaningful goal to pursue in the next 60–90 days. Claude has suggested one — adjust it to fit your life.
        </p>
      </div>

      {suggesting && !obj.title && (
        <p style={{ fontSize: 13, color: 'var(--color-muted)' }}>Suggesting an objective…</p>
      )}

      {(obj.title || suggested) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Objective title *" value={obj.title || ''} onChange={v => setObj({ title: v })} rows={1} />
          <Field label="Description (optional)" value={obj.description || ''} onChange={v => setObj({ description: v })} rows={2} />
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <Field label="Timeframe" value={obj.timeframe || ''} onChange={v => setObj({ timeframe: v })} rows={1} placeholder="Q2 2026" />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--color-muted)', display: 'block', marginBottom: 6 }}>Colour</label>
              <div style={{ display: 'flex', gap: 5, paddingTop: 4 }}>
                {PRESET_COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setObj({ color: c })}
                    style={{
                      width: 22, height: 22, borderRadius: '50%', background: c,
                      border: obj.color === c ? '2px solid var(--color-text)' : '2px solid transparent',
                      cursor: 'pointer', padding: 0,
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {(suggested || obj.title) && (
        <button
          onClick={handleSuggest}
          disabled={suggesting}
          style={{
            alignSelf: 'flex-start', fontSize: 12, padding: '5px 12px', borderRadius: 7,
            border: '1px solid var(--color-border)', background: 'none', color: 'var(--color-muted)',
            cursor: 'pointer', opacity: suggesting ? 0.5 : 1,
          }}
        >
          ↻ Suggest a different one
        </button>
      )}
    </div>
  );
}

// ── Step 4: Key Results ────────────────────────────────────────────────────────
function Step4({ data, onChange }) {
  const [loading, setLoading] = useState(false);

  const handleSuggest = async () => {
    setLoading(true);
    try {
      const res = await api.post('/api/goals/wizard/suggest-krs', {
        objectiveTitle: data.objective?.title,
        objectiveDescription: data.objective?.description,
      });
      const suggestions = await res.json();
      onChange({
        ...data,
        keyResults: suggestions.map(s => ({ ...s, selected: true })),
      });
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => {
    if (!data.keyResults?.length) handleSuggest();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const krs = data.keyResults || [];
  const setKr = (i, patch) => {
    const updated = krs.map((kr, idx) => idx === i ? { ...kr, ...patch } : kr);
    onChange({ ...data, keyResults: updated });
  };
  const removeKr = (i) => onChange({ ...data, keyResults: krs.filter((_, idx) => idx !== i) });
  const addKr = () => onChange({ ...data, keyResults: [...krs, { title: '', targetValue: 100, unit: '%', selected: true }] });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <div style={{ fontSize: 24, marginBottom: 4 }}>📊</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text)', margin: '0 0 6px' }}>
          Key Results
        </h2>
        <p style={{ fontSize: 13, color: 'var(--color-muted)', margin: 0, lineHeight: 1.6 }}>
          Key Results are measurable milestones that show you're making progress. Select the ones that resonate and edit them freely.
        </p>
      </div>

      {loading && <p style={{ fontSize: 13, color: 'var(--color-muted)' }}>Suggesting key results…</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {krs.map((kr, i) => (
          <div
            key={i}
            style={{
              padding: '12px 14px', borderRadius: 10,
              border: `1px solid ${kr.selected ? 'var(--color-primary)' : 'var(--color-border)'}`,
              background: kr.selected ? 'var(--color-primary)0d' : 'var(--color-surface)',
              display: 'flex', flexDirection: 'column', gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <input
                type="checkbox"
                checked={!!kr.selected}
                onChange={e => setKr(i, { selected: e.target.checked })}
                style={{ marginTop: 3, accentColor: 'var(--color-primary)', cursor: 'pointer', flexShrink: 0 }}
              />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input
                  value={kr.title}
                  onChange={e => setKr(i, { title: e.target.value })}
                  placeholder="Key result title…"
                  style={{
                    width: '100%', fontSize: 13, padding: '6px 10px', borderRadius: 7,
                    border: '1px solid var(--color-border)', background: 'var(--color-bg)',
                    color: 'var(--color-text)', outline: 'none', boxSizing: 'border-box',
                  }}
                />
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="number"
                    value={kr.targetValue}
                    onChange={e => setKr(i, { targetValue: Number(e.target.value) })}
                    style={{
                      width: 80, fontSize: 12, padding: '4px 8px', borderRadius: 6,
                      border: '1px solid var(--color-border)', background: 'var(--color-bg)',
                      color: 'var(--color-text)', outline: 'none',
                    }}
                  />
                  <input
                    value={kr.unit}
                    onChange={e => setKr(i, { unit: e.target.value })}
                    placeholder="unit"
                    style={{
                      width: 70, fontSize: 12, padding: '4px 8px', borderRadius: 6,
                      border: '1px solid var(--color-border)', background: 'var(--color-bg)',
                      color: 'var(--color-text)', outline: 'none',
                    }}
                  />
                  <button
                    onClick={() => removeKr(i)}
                    style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: 'none', background: 'none', color: 'var(--color-muted)', cursor: 'pointer' }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={addKr}
          style={{
            fontSize: 12, padding: '5px 12px', borderRadius: 7,
            border: '1px solid var(--color-border)', background: 'none', color: 'var(--color-muted)', cursor: 'pointer',
          }}
        >
          + Add another
        </button>
        <button
          onClick={handleSuggest}
          disabled={loading}
          style={{
            fontSize: 12, padding: '5px 12px', borderRadius: 7,
            border: '1px solid var(--color-border)', background: 'none', color: 'var(--color-muted)',
            cursor: 'pointer', opacity: loading ? 0.5 : 1,
          }}
        >
          ↻ Re-suggest
        </button>
      </div>
    </div>
  );
}

// ── Step 5: Connect Tasks ──────────────────────────────────────────────────────
function Step5({ data, onChange }) {
  const [tasks, setTasks] = useState([]);
  const [loadingTasks, setLoadingTasks] = useState(true);

  useEffect(() => {
    api.get('/api/tasks?status=todo')
      .then(r => r.json())
      .then(d => setTasks(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoadingTasks(false));
  }, []);

  const linkedTaskIds = new Set(data.linkedTaskIds || []);
  const toggle = (id) => {
    const next = new Set(linkedTaskIds);
    next.has(id) ? next.delete(id) : next.add(id);
    onChange({ ...data, linkedTaskIds: [...next] });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <div style={{ fontSize: 24, marginBottom: 4 }}>🔗</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text)', margin: '0 0 6px' }}>
          Connect your tasks
        </h2>
        <p style={{ fontSize: 13, color: 'var(--color-muted)', margin: 0, lineHeight: 1.6 }}>
          Which of your existing tasks support your new objective? Linking them shows the connection between daily work and your bigger goals.
        </p>
      </div>

      {loadingTasks && <p style={{ fontSize: 13, color: 'var(--color-muted)' }}>Loading tasks…</p>}

      {!loadingTasks && tasks.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--color-muted)', padding: '16px 0' }}>
          No open tasks found. You can connect tasks later from the Tasks page.
        </p>
      )}

      {tasks.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
          {tasks.map(task => (
            <label
              key={task.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
                border: `1px solid ${linkedTaskIds.has(task.id) ? 'var(--color-primary)' : 'var(--color-border)'}`,
                background: linkedTaskIds.has(task.id) ? 'var(--color-primary)0d' : 'var(--color-surface)',
                transition: 'all 0.12s',
              }}
            >
              <input
                type="checkbox"
                checked={linkedTaskIds.has(task.id)}
                onChange={() => toggle(task.id)}
                style={{ accentColor: 'var(--color-primary)', cursor: 'pointer', flexShrink: 0 }}
              />
              <span style={{ fontSize: 13, color: 'var(--color-text)', flex: 1 }}>{task.title}</span>
            </label>
          ))}
        </div>
      )}

      <p style={{ fontSize: 11, color: 'var(--color-muted)', margin: 0 }}>
        {linkedTaskIds.size > 0
          ? `${linkedTaskIds.size} task${linkedTaskIds.size !== 1 ? 's' : ''} selected`
          : 'Tip: you can also skip this and connect tasks later.'}
      </p>
    </div>
  );
}

// ── Step 6: Renewal Balance ────────────────────────────────────────────────────
function Step6({ data, onChange }) {
  const [observing, setObserving] = useState(false);
  const [observationDone, setObservationDone] = useState(false);

  const scores = data.renewalScores || { physical: 5, mental: 5, social: 5, spiritual: 5 };
  const setScore = (key, val) => {
    const updated = { ...scores, [key]: val };
    onChange({ ...data, renewalScores: updated, renewalObservation: '' });
    setObservationDone(false);
  };

  const handleObserve = async () => {
    setObserving(true);
    setObservationDone(false);
    onChange({ ...data, renewalObservation: '' });
    try {
      const res = await api.post('/api/goals/wizard/renewal-observation', scores);
      const text = await streamSSE(res, (acc) => {
        onChange(prev => ({ ...prev, renewalObservation: acc }));
      });
      onChange(prev => ({ ...prev, renewalObservation: text }));
      setObservationDone(true);
    } catch { setObservationDone(true); } finally { setObserving(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <div style={{ fontSize: 24, marginBottom: 4 }}>🌱</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text)', margin: '0 0 6px' }}>
          Renewal Balance
        </h2>
        <p style={{ fontSize: 13, color: 'var(--color-muted)', margin: 0, lineHeight: 1.6 }}>
          Habit 7 — Sharpen the Saw. Rate how well you're currently renewing yourself in each dimension. Honest ratings make the AI insight more useful.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {RENEWAL_DIMS.map(d => (
          <div key={d.key}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div>
                <span style={{ fontSize: 13, fontWeight: 600, color: d.color }}>{d.emoji} {d.label}</span>
                <span style={{ fontSize: 11, color: 'var(--color-muted)', marginLeft: 8 }}>{d.desc}</span>
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: d.color, minWidth: 24, textAlign: 'right' }}>
                {scores[d.key]}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={10}
              step={1}
              value={scores[d.key]}
              onChange={e => setScore(d.key, Number(e.target.value))}
              style={{ width: '100%', accentColor: d.color, cursor: 'pointer' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--color-muted)', marginTop: 2 }}>
              <span>Neglected</span><span>Thriving</span>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={handleObserve}
        disabled={observing}
        style={{
          alignSelf: 'flex-start', fontSize: 12, fontWeight: 500, padding: '6px 14px', borderRadius: 8,
          background: 'var(--color-primary)', color: '#fff', border: 'none',
          cursor: 'pointer', opacity: observing ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: 6,
        }}
      >
        ✨ {observing ? 'Analysing…' : 'Get AI observation'}
      </button>

      {(data.renewalObservation || observing) && (
        <div style={{
          padding: '12px 14px', borderRadius: 10, borderLeft: '3px solid var(--color-primary)',
          background: 'var(--color-bg)', fontSize: 13, lineHeight: 1.65, color: 'var(--color-text)',
        }}>
          {data.renewalObservation}
          {observing && !observationDone && <span style={{ color: 'var(--color-primary)' }}>▊</span>}
        </div>
      )}
    </div>
  );
}

// ── Step 7: Review & Save ──────────────────────────────────────────────────────
function Step7({ data, onSave, saving, saved }) {
  const obj = data.objective || {};
  const krs = (data.keyResults || []).filter(kr => kr.selected && kr.title);
  const linked = data.linkedTaskIds?.length || 0;

  if (saved) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, paddingTop: 20, textAlign: 'center' }}>
        <div style={{ fontSize: 56 }}>🎉</div>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', margin: '0 0 8px' }}>
            Your foundation is set.
          </h2>
          <p style={{ fontSize: 14, color: 'var(--color-muted)', lineHeight: 1.7, margin: 0, maxWidth: 400 }}>
            Your mission, objective, and key results are saved. Head to the Goals page any time to track your progress.
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, width: '100%', maxWidth: 360 }}>
          {[
            { emoji: '🧭', label: 'Mission statement', ok: !!data.missionFinal },
            { emoji: '🎯', label: `Objective: ${obj.title || '—'}`, ok: !!obj.title },
            { emoji: '📊', label: `${krs.length} Key Result${krs.length !== 1 ? 's' : ''}`, ok: krs.length > 0 },
            { emoji: '🔗', label: `${linked} task${linked !== 1 ? 's' : ''} connected`, ok: linked > 0 },
          ].map((item, i) => (
            <div
              key={i}
              style={{
                padding: '12px 14px', borderRadius: 10,
                border: `1px solid ${item.ok ? '#22c55e44' : 'var(--color-border)'}`,
                background: item.ok ? '#22c55e0d' : 'var(--color-bg)',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              <span style={{ fontSize: 18 }}>{item.ok ? '✅' : item.emoji}</span>
              <span style={{ fontSize: 11, color: 'var(--color-text)' }}>{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <div style={{ fontSize: 24, marginBottom: 4 }}>🚀</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text)', margin: '0 0 6px' }}>
          Review & save
        </h2>
        <p style={{ fontSize: 13, color: 'var(--color-muted)', margin: 0, lineHeight: 1.6 }}>
          Everything looks good. Confirm below to save your foundation to Curam Vault.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Mission */}
        <SummaryCard emoji="🧭" label="Mission" content={data.missionFinal || '(skipped)'} />
        {/* Objective */}
        <SummaryCard
          emoji="🎯"
          label="Objective"
          content={obj.title || '(none)'}
          sub={obj.timeframe ? `Timeframe: ${obj.timeframe}` : null}
          color={obj.color}
        />
        {/* Key Results */}
        <div style={{ padding: '12px 14px', borderRadius: 10, border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)', marginBottom: krs.length ? 8 : 0 }}>
            📊 Key Results ({krs.length})
          </div>
          {krs.map((kr, i) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--color-muted)', paddingTop: 4 }}>
              · {kr.title} — target {kr.targetValue} {kr.unit}
            </div>
          ))}
          {krs.length === 0 && <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>None selected</div>}
        </div>
        {/* Tasks */}
        <SummaryCard
          emoji="🔗"
          label="Tasks connected"
          content={linked > 0 ? `${linked} task${linked !== 1 ? 's' : ''} will be linked to your objective` : 'No tasks linked — you can do this later'}
        />
        {/* Renewal */}
        {data.renewalObservation && (
          <div style={{ padding: '12px 14px', borderRadius: 10, border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)', marginBottom: 6 }}>🌱 Renewal observation</div>
            <div style={{ fontSize: 12, color: 'var(--color-muted)', lineHeight: 1.6 }}>{data.renewalObservation}</div>
          </div>
        )}
      </div>

      <button
        onClick={onSave}
        disabled={saving || !obj.title}
        style={{
          fontSize: 14, fontWeight: 600, padding: '12px 24px', borderRadius: 10,
          background: 'var(--color-primary)', color: '#fff', border: 'none',
          cursor: saving || !obj.title ? 'not-allowed' : 'pointer',
          opacity: saving || !obj.title ? 0.5 : 1,
          display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center',
        }}
      >
        {saving ? 'Saving…' : '✓ Save and finish setup'}
      </button>
    </div>
  );
}

function SummaryCard({ emoji, label, content, sub, color }) {
  return (
    <div style={{ padding: '12px 14px', borderRadius: 10, border: '1px solid var(--color-border)', background: 'var(--color-surface)', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      {color && <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, marginTop: 3, flexShrink: 0 }} />}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)', marginBottom: 2 }}>{emoji} {label}</div>
        <div style={{ fontSize: 12, color: 'var(--color-muted)', lineHeight: 1.5 }}>{content}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, rows, placeholder }) {
  return (
    <div>
      <label style={{ fontSize: 11, color: 'var(--color-muted)', display: 'block', marginBottom: 5 }}>{label}</label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={rows || 2}
        placeholder={placeholder}
        style={{
          width: '100%', fontSize: 13, padding: '8px 12px', borderRadius: 8,
          border: '1px solid var(--color-border)', background: 'var(--color-surface)',
          color: 'var(--color-text)', outline: 'none', resize: 'vertical', boxSizing: 'border-box',
          lineHeight: 1.5,
        }}
      />
    </div>
  );
}

// ── Main Wizard ────────────────────────────────────────────────────────────────
const TOTAL_STEPS = 7;
const STEP_LABELS = [
  'Personal Context',
  'Mission Statement',
  'First Objective',
  'Key Results',
  'Connect Tasks',
  'Renewal Balance',
  'Review & Save',
];

export default function GettingStartedWizard({ onClose, onComplete }) {
  const [step, setStep] = useState(1);
  const [data, setDataRaw] = useState(() => loadDraft() || {});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const setData = useCallback((updater) => {
    setDataRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      saveDraft(next);
      return next;
    });
  }, []);

  const canAdvance = () => {
    if (step === 1) return !!(data.mattersMost?.trim() && data.betterAt?.trim());
    if (step === 2) return !!(data.missionFinal?.trim());
    if (step === 3) return !!(data.objective?.title?.trim());
    if (step === 4) return (data.keyResults || []).some(kr => kr.selected && kr.title?.trim());
    return true;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // 1. Save mission
      if (data.missionFinal?.trim()) {
        await api.put('/api/goals/mission', { statement: data.missionFinal.trim() });
      }

      // 2. Create objective
      let objectiveId = null;
      if (data.objective?.title?.trim()) {
        const objRes = await api.post('/api/goals', {
          title: data.objective.title.trim(),
          description: data.objective.description?.trim() || null,
          timeframe: data.objective.timeframe?.trim() || null,
          color: data.objective.color || '#6366f1',
        });
        const obj = await objRes.json();
        objectiveId = obj.id;
      }

      // 3. Create key results
      const selectedKrs = (data.keyResults || []).filter(kr => kr.selected && kr.title?.trim());
      let firstKrId = null;
      if (objectiveId && selectedKrs.length) {
        for (const kr of selectedKrs) {
          const krRes = await api.post(`/api/goals/${objectiveId}/key-results`, {
            title: kr.title.trim(),
            targetValue: kr.targetValue || 100,
            unit: kr.unit || '%',
          });
          const saved = await krRes.json();
          if (!firstKrId) firstKrId = saved.id;
        }
      }

      // 4. Link tasks to objective's first key result
      if (firstKrId && data.linkedTaskIds?.length) {
        for (const taskId of data.linkedTaskIds) {
          await api.put(`/api/tasks/${taskId}`, { keyResultId: firstKrId }).catch(() => {});
        }
      }

      // 5. Mark wizard complete
      await api.post('/api/goals/wizard/complete');

      clearDraft();
      setSaved(true);
      if (onComplete) onComplete();
    } catch (err) {
      console.error('[wizard save]', err);
    } finally {
      setSaving(false);
    }
  };

  const steps = [Step1, Step2, Step3, Step4, Step5, Step6, Step7];
  const StepComponent = steps[step - 1];

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)',
        padding: 16,
      }}
    >
      <div
        style={{
          width: '100%', maxWidth: 560, maxHeight: '90dvh',
          background: 'var(--color-surface)', border: '1px solid var(--color-border)',
          borderRadius: 20, overflow: 'hidden', boxShadow: '0 32px 64px rgba(0,0,0,0.4)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid var(--color-border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-muted)', marginBottom: 4 }}>
              Getting Started · Step {step} of {TOTAL_STEPS}
            </div>
            <StepDots step={step} total={TOTAL_STEPS} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--color-muted)' }}>{STEP_LABELS[step - 1]}</span>
            {!saved && (
              <button
                onClick={onClose}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', fontSize: 18, padding: '2px 6px', lineHeight: 1 }}
                title="Close (progress saved)"
              >
                ×
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 24px' }}>
          {step === 7 ? (
            <Step7 data={data} onSave={handleSave} saving={saving} saved={saved} />
          ) : (
            <StepComponent data={data} onChange={setData} />
          )}
        </div>

        {/* Footer nav */}
        {!saved && (
          <div style={{
            padding: '14px 20px', borderTop: '1px solid var(--color-border)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
            background: 'var(--color-surface)',
          }}>
            <button
              onClick={() => step > 1 && setStep(s => s - 1)}
              disabled={step === 1}
              style={{
                fontSize: 13, padding: '7px 16px', borderRadius: 8,
                border: '1px solid var(--color-border)', background: 'none',
                color: step === 1 ? 'var(--color-border)' : 'var(--color-muted)',
                cursor: step === 1 ? 'default' : 'pointer',
              }}
            >
              ← Back
            </button>

            {step < TOTAL_STEPS && (
              <button
                onClick={() => setStep(s => s + 1)}
                disabled={!canAdvance()}
                style={{
                  fontSize: 13, fontWeight: 500, padding: '7px 20px', borderRadius: 8,
                  background: canAdvance() ? 'var(--color-primary)' : 'var(--color-border)',
                  color: canAdvance() ? '#fff' : 'var(--color-muted)',
                  border: 'none', cursor: canAdvance() ? 'pointer' : 'default',
                  transition: 'all 0.15s',
                }}
              >
                {step === 5 || step === 6 ? 'Skip →' : 'Next →'}
              </button>
            )}
          </div>
        )}

        {/* Close button on success */}
        {saved && (
          <div style={{ padding: '14px 20px', borderTop: '1px solid var(--color-border)', textAlign: 'center', flexShrink: 0 }}>
            <button
              onClick={onClose}
              style={{
                fontSize: 13, fontWeight: 500, padding: '8px 24px', borderRadius: 10,
                background: 'var(--color-primary)', color: '#fff', border: 'none', cursor: 'pointer',
              }}
            >
              Go to Goals →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
