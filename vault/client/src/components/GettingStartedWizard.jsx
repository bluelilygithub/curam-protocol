import React, { useState, useEffect, useCallback } from 'react';
import api from '../utils/apiClient';

const DRAFT_KEY = 'wizardDraft';
const RENEWAL_DIMS = [
  { key: 'physical',  label: 'Physical',  emoji: '🏃', desc: 'Body, health, exercise, nutrition',         color: '#3b82f6' },
  { key: 'mental',   label: 'Mental',    emoji: '📚', desc: 'Learning, reading, creativity, skills',     color: '#22c55e' },
  { key: 'social',   label: 'Social',    emoji: '🤝', desc: 'Relationships, empathy, service, community', color: '#f59e0b' },
  { key: 'spiritual',label: 'Spiritual', emoji: '🌱', desc: 'Mission, values, meditation, purpose',      color: '#8b5cf6' },
];
const PRESET_COLORS = ['#6366f1', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6'];

// ── Step 1 chip options ────────────────────────────────────────────────────────
const Q1_CHIPS = [
  'Family & relationships',
  'Health & wellbeing',
  'Building something meaningful',
  'Financial security & freedom',
];
const Q2_CHIPS = [
  'My craft / technical skills',
  'Being more present & mindful',
  'Leading or building a business',
  'My health & fitness',
];
const Q3_CHIPS = [
  'Early career & finding my path',
  'Mid-life — building & balancing',
  'Established — refining & giving back',
  'Transition — reinventing myself',
];

// ── Step 3 objective options ───────────────────────────────────────────────────
const OBJ_AREAS = [
  { label: 'Health & body',           emoji: '💪' },
  { label: 'Career & craft',          emoji: '🛠️' },
  { label: 'Finance & business',      emoji: '💰' },
  { label: 'Relationships & family',  emoji: '❤️' },
  { label: 'Mind & personal growth',  emoji: '🧠' },
  { label: 'Something else',          emoji: '✦'  },
];
const OBJ_EXAMPLES = {
  'Health & body':          ['Run a 5K without stopping', 'Build a consistent sleep routine', 'Lose 5 kg and maintain it'],
  'Career & craft':         ['Ship a side project to real users', 'Take on a leadership role', 'Publish 10 pieces of work publicly'],
  'Finance & business':     ['Hit a new monthly revenue target', 'Pay off a specific debt completely', 'Build 3 months of business runway'],
  'Relationships & family': ['Be fully present at dinner every night', 'Invest in a neglected relationship', 'Establish a weekly ritual with family'],
  'Mind & personal growth': ['Read 10 books on a focused topic', 'Establish a daily contemplation practice', 'Learn a skill to working-level proficiency'],
  'Something else':         ['Define and pursue what matters most', 'Build one new habit for 90 days', "Finish a project I've been putting off"],
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function saveDraft(data) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(data)); } catch {} }
function loadDraft()     { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { return null; } }
function clearDraft()    { try { localStorage.removeItem(DRAFT_KEY); } catch {} }

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

// ── Shared UI primitives ───────────────────────────────────────────────────────
function StepDots({ step, total }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      {Array.from({ length: total }, (_, i) => (
        <div key={i} style={{
          width: i + 1 === step ? 20 : 8, height: 8, borderRadius: 4,
          background: i + 1 <= step ? 'var(--color-primary)' : 'var(--color-border)',
          transition: 'all 0.25s',
        }} />
      ))}
    </div>
  );
}

function SubProgress({ current, total }) {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      {Array.from({ length: total }, (_, i) => (
        <div key={i} style={{
          width: i === current ? 18 : 6, height: 6, borderRadius: 3,
          background: i <= current ? 'var(--color-primary)' : 'var(--color-border)',
          transition: 'all 0.2s',
        }} />
      ))}
    </div>
  );
}

// Fade + slide-up on mount — wrap each sub-step content to animate transitions
function AnimatedStep({ children }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { const id = setTimeout(() => setVisible(true), 20); return () => clearTimeout(id); }, []);
  return (
    <div style={{
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateY(0)' : 'translateY(10px)',
      transition: 'opacity 0.22s ease, transform 0.22s ease',
    }}>
      {children}
    </div>
  );
}

function Chip({ label, selected, onClick, radio = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '8px 16px', borderRadius: 999, cursor: 'pointer',
        border: `1.5px solid ${selected ? 'var(--color-primary)' : 'var(--color-border)'}`,
        background: selected ? 'var(--color-primary)' : 'transparent',
        color: selected ? '#fff' : 'var(--color-text)',
        fontSize: 13, fontWeight: selected ? 600 : 400,
        transition: 'all 0.15s', lineHeight: 1.4, textAlign: 'left',
      }}
    >
      {label}
    </button>
  );
}

function WizardTextarea({ value, onChange, rows = 2, placeholder }) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      style={{
        width: '100%', fontSize: 13, padding: '10px 12px', borderRadius: 10,
        border: '1px solid var(--color-border)', background: 'var(--color-bg)',
        color: 'var(--color-text)', outline: 'none', resize: 'vertical',
        lineHeight: 1.6, boxSizing: 'border-box', fontFamily: 'inherit',
      }}
    />
  );
}

function WizardInput({ value, onChange, placeholder, style = {} }) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: '100%', fontSize: 13, padding: '9px 12px', borderRadius: 10,
        border: '1px solid var(--color-border)', background: 'var(--color-bg)',
        color: 'var(--color-text)', outline: 'none', boxSizing: 'border-box',
        fontFamily: 'inherit', ...style,
      }}
    />
  );
}

function ConfirmBtn({ onClick, disabled, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        alignSelf: 'flex-end', fontSize: 13, fontWeight: 600,
        padding: '9px 22px', borderRadius: 10, border: 'none',
        background: disabled ? 'var(--color-border)' : 'var(--color-primary)',
        color: disabled ? 'var(--color-muted)' : '#fff',
        cursor: disabled ? 'default' : 'pointer', transition: 'all 0.15s',
      }}
    >
      {children}
    </button>
  );
}

function GhostBtn({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontSize: 12, padding: '5px 12px', borderRadius: 8,
        border: '1px solid var(--color-border)', background: 'none',
        color: 'var(--color-muted)', cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

// ── Step 1: Personal Context (conversational sub-wizard) ───────────────────────
function Step1({ data, onChange }) {
  const hasDraft = !!(data.mattersMost?.trim() || data.betterAt?.trim());
  const [subStep, setSubStep] = useState(hasDraft ? 3 : 0);

  // Chip selections (transient — compiled to strings on summary)
  const [q1Sel, setQ1Sel]       = useState(new Set());
  const [q1Custom, setQ1Custom] = useState('');
  const [q2Sel, setQ2Sel]       = useState(new Set());
  const [q2Custom, setQ2Custom] = useState('');
  const [q3Sel, setQ3Sel]       = useState('');

  // Summary editables — initialised from draft or compiled chips
  const [editQ1, setEditQ1] = useState(data.mattersMost || '');
  const [editQ2, setEditQ2] = useState(data.betterAt    || '');
  const [editQ3, setEditQ3] = useState(data.lifeStage   || '');

  function toggleQ1(label) {
    setQ1Sel(prev => { const n = new Set(prev); n.has(label) ? n.delete(label) : n.add(label); return n; });
  }
  function toggleQ2(label) {
    setQ2Sel(prev => { const n = new Set(prev); n.has(label) ? n.delete(label) : n.add(label); return n; });
  }

  function compileItems(sel, custom) {
    const items = [...sel];
    const extra = custom.split(',').map(s => s.trim()).filter(Boolean);
    return [...items, ...extra].join(', ');
  }

  function advanceToQ2() { setSubStep(1); }
  function advanceToQ3() { setSubStep(2); }

  function advanceToSummary(q3Value) {
    const c1 = compileItems(q1Sel, q1Custom);
    const c2 = compileItems(q2Sel, q2Custom);
    const c3 = q3Value ?? q3Sel;
    setEditQ1(c1); setEditQ2(c2); setEditQ3(c3 || '');
    onChange(prev => ({ ...prev, mattersMost: c1, betterAt: c2, lifeStage: c3 || '' }));
    setSubStep(3);
  }

  function startOver() {
    setQ1Sel(new Set()); setQ1Custom('');
    setQ2Sel(new Set()); setQ2Custom('');
    setQ3Sel('');
    setEditQ1(''); setEditQ2(''); setEditQ3('');
    onChange(prev => ({ ...prev, mattersMost: '', betterAt: '', lifeStage: '' }));
    setSubStep(0);
  }

  const q1Ready = q1Sel.size > 0 || q1Custom.trim().length > 0;
  const q2Ready = q2Sel.size > 0 || q2Custom.trim().length > 0;

  const subLabels = ['What matters most', 'What you\'re improving', 'Life stage', 'Review'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div>
        <div style={{ fontSize: 24, marginBottom: 4 }}>✨</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text)', margin: '0 0 8px' }}>
          Let's start with you
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {subStep < 3
            ? <SubProgress current={subStep} total={3} />
            : <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>Review your answers</span>
          }
          {subStep > 0 && subStep < 3 && (
            <button
              onClick={() => setSubStep(s => s - 1)}
              style={{ fontSize: 12, color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              ← Back
            </button>
          )}
        </div>
      </div>

      {/* Sub-step content */}
      <AnimatedStep key={subStep}>
        {/* Q1 */}
        {subStep === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--color-text)', lineHeight: 1.5 }}>
              What matters most to you right now in life?
            </p>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--color-muted)' }}>Select all that apply.</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {Q1_CHIPS.map(c => (
                <Chip key={c} label={c} selected={q1Sel.has(c)} onClick={() => toggleQ1(c)} />
              ))}
            </div>
            <WizardInput
              value={q1Custom}
              onChange={setQ1Custom}
              placeholder="Something else… (optional)"
            />
            <ConfirmBtn onClick={advanceToQ2} disabled={!q1Ready}>
              Confirm →
            </ConfirmBtn>
          </div>
        )}

        {/* Q2 */}
        {subStep === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--color-text)', lineHeight: 1.5 }}>
              What are you actively working to get better at?
            </p>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--color-muted)' }}>Select all that apply.</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {Q2_CHIPS.map(c => (
                <Chip key={c} label={c} selected={q2Sel.has(c)} onClick={() => toggleQ2(c)} />
              ))}
            </div>
            <WizardInput
              value={q2Custom}
              onChange={setQ2Custom}
              placeholder="Something else… (optional)"
            />
            <ConfirmBtn onClick={advanceToQ3} disabled={!q2Ready}>
              Confirm →
            </ConfirmBtn>
          </div>
        )}

        {/* Q3 */}
        {subStep === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--color-text)', lineHeight: 1.5 }}>
              What stage of life are you in?
            </p>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--color-muted)' }}>Optional — helps Claude speak to your situation.</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {Q3_CHIPS.map(c => (
                <Chip key={c} label={c} selected={q3Sel === c} onClick={() => setQ3Sel(q3Sel === c ? '' : c)} radio />
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <GhostBtn onClick={() => advanceToSummary(null)}>Skip this question</GhostBtn>
              <ConfirmBtn onClick={() => advanceToSummary(q3Sel || null)} disabled={false}>
                {q3Sel ? 'Confirm →' : 'Skip →'}
              </ConfirmBtn>
            </div>
          </div>
        )}

        {/* Summary */}
        {subStep === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text)', lineHeight: 1.5 }}>
              Here's what you've shared. Edit anything before continuing — Claude will use these to write your mission statement.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--color-muted)', display: 'block', marginBottom: 5 }}>
                  What matters most
                </label>
                <WizardTextarea
                  value={editQ1}
                  onChange={v => { setEditQ1(v); onChange(prev => ({ ...prev, mattersMost: v })); }}
                  rows={2}
                  placeholder="Family & relationships, health & wellbeing…"
                />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--color-muted)', display: 'block', marginBottom: 5 }}>
                  What I'm working to improve
                </label>
                <WizardTextarea
                  value={editQ2}
                  onChange={v => { setEditQ2(v); onChange(prev => ({ ...prev, betterAt: v })); }}
                  rows={2}
                  placeholder="My craft / technical skills, being more present…"
                />
              </div>
              {(editQ3 || data.lifeStage) && (
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--color-muted)', display: 'block', marginBottom: 5 }}>
                    Life stage
                  </label>
                  <WizardInput
                    value={editQ3}
                    onChange={v => { setEditQ3(v); onChange(prev => ({ ...prev, lifeStage: v })); }}
                    placeholder="Optional"
                  />
                </div>
              )}
            </div>

            <button
              onClick={startOver}
              style={{ fontSize: 12, color: 'var(--color-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, alignSelf: 'flex-start', textDecoration: 'underline' }}
            >
              Start over
            </button>
          </div>
        )}
      </AnimatedStep>
    </div>
  );
}

// ── Step 2: Mission Statement ──────────────────────────────────────────────────
function Step2({ data, onChange, onBack }) {
  const [generating, setGenerating] = useState(false);
  const [done, setDone] = useState(false);

  const hasContext = !!(data.mattersMost?.trim() || data.betterAt?.trim());

  const handleGenerate = async () => {
    setGenerating(true);
    setDone(false);
    onChange(prev => ({ ...prev, missionGenerated: '', missionFinal: '' }));
    try {
      const res = await api.post('/api/goals/wizard/generate-mission', {
        mattersMost: data.mattersMost || '',
        betterAt:    data.betterAt    || '',
        lifeStage:   data.lifeStage   || '',
      });
      const text = await streamSSE(res, (acc) => {
        onChange(prev => ({ ...prev, missionGenerated: acc, missionFinal: acc }));
      });
      onChange(prev => ({ ...prev, missionGenerated: text, missionFinal: prev.missionFinal || text }));
      setDone(true);
    } catch { setDone(true); } finally { setGenerating(false); }
  };

  useEffect(() => {
    if (hasContext && !data.missionGenerated) handleGenerate();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!hasContext) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '12px 0' }}>
        <div style={{ fontSize: 24, marginBottom: 4 }}>⚠️</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text)', margin: '0 0 6px' }}>
          Context needed
        </h2>
        <p style={{ fontSize: 14, color: 'var(--color-text)', lineHeight: 1.6, margin: 0 }}>
          To write a meaningful mission statement, Claude needs to know a little about you first. Head back and answer the questions in Step 1.
        </p>
        <button
          onClick={onBack}
          style={{
            alignSelf: 'flex-start', fontSize: 13, fontWeight: 500, padding: '8px 18px',
            borderRadius: 10, border: '1.5px solid var(--color-primary)',
            background: 'transparent', color: 'var(--color-primary)', cursor: 'pointer',
          }}
        >
          ← Go back and fill in your context
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <div style={{ fontSize: 24, marginBottom: 4 }}>🧭</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text)', margin: '0 0 6px' }}>
          Your Mission Statement
        </h2>
        <p style={{ fontSize: 13, color: 'var(--color-text)', margin: 0, lineHeight: 1.6 }}>
          Claude has drafted a personal mission statement from your answers. Edit it until it feels true to you — this is your north star.
        </p>
      </div>

      <div style={{
        padding: '14px 16px', borderRadius: 10,
        borderLeft: '3px solid var(--color-primary)',
        background: 'var(--color-bg)',
        fontStyle: 'italic', fontSize: 14, lineHeight: 1.7,
        color: 'var(--color-text)', minHeight: 60,
      }}>
        {generating && !data.missionGenerated
          ? <span style={{ color: 'var(--color-muted)' }}>Writing your mission statement…</span>
          : <span>{data.missionGenerated}</span>}
        {generating && <span style={{ color: 'var(--color-primary)', marginLeft: 2 }}>▊</span>}
      </div>

      {(done || data.missionGenerated) && (
        <>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--color-muted)', display: 'block', marginBottom: 6 }}>
              Edit to make it yours
            </label>
            <textarea
              value={data.missionFinal || ''}
              onChange={e => onChange(prev => ({ ...prev, missionFinal: e.target.value }))}
              rows={4}
              style={{
                width: '100%', fontSize: 14, padding: '10px 12px', borderRadius: 10,
                border: '1px solid var(--color-border)', background: 'var(--color-bg)',
                color: 'var(--color-text)', outline: 'none', resize: 'vertical',
                fontStyle: 'italic', lineHeight: 1.65, boxSizing: 'border-box', fontFamily: 'inherit',
              }}
            />
          </div>
          <GhostBtn onClick={handleGenerate} disabled={generating}>
            ↻ Regenerate
          </GhostBtn>
        </>
      )}
    </div>
  );
}

// ── Step 3: First Objective (conversational sub-wizard) ────────────────────────
function Step3({ data, onChange }) {
  const obj = data.objective || {};
  const hasDraft = !!obj.title;

  const [subStep, setSubStep] = useState(hasDraft ? 3 : 0);
  const [area, setArea]       = useState(obj._area    || '');
  const [success, setSuccess] = useState(obj._success || '');
  const [color, setColor]     = useState(obj.color    || PRESET_COLORS[0]);
  const [editTitle, setEditTitle]         = useState(obj.title    || '');
  const [editTimeframe, setEditTimeframe] = useState(obj.timeframe || '90 days');
  const [suggesting, setSuggesting] = useState(false);

  const examples = OBJ_EXAMPLES[area] || OBJ_EXAMPLES['Something else'];

  function advanceToSuccess(selectedArea) {
    setArea(selectedArea);
    setSubStep(1);
  }

  function advanceToColor() {
    setSubStep(2);
  }

  function advanceToSummary() {
    const title = success.trim() || area;
    setEditTitle(title);
    onChange(prev => ({
      ...prev,
      objective: {
        ...(prev.objective || {}),
        title,
        timeframe: editTimeframe,
        color,
        description: prev.objective?.description || '',
        _area: area,
        _success: success,
      },
    }));
    setSubStep(3);
  }

  function startOver() {
    setArea(''); setSuccess(''); setColor(PRESET_COLORS[0]);
    setEditTitle(''); setEditTimeframe('90 days');
    onChange(prev => ({ ...prev, objective: {} }));
    setSubStep(0);
  }

  const handleAiSuggest = async () => {
    setSuggesting(true);
    try {
      const res = await api.post('/api/goals/wizard/suggest-objective', {
        mission:     data.missionFinal || '',
        mattersMost: data.mattersMost  || '',
      });
      const suggestion = await res.json();
      const newTitle = suggestion.title || editTitle;
      setEditTitle(newTitle);
      setEditTimeframe(suggestion.timeframe || '90 days');
      if (suggestion.color) setColor(suggestion.color);
      onChange(prev => ({
        ...prev,
        objective: {
          ...(prev.objective || {}),
          title: newTitle,
          description: suggestion.description || '',
          timeframe: suggestion.timeframe || '90 days',
          color: suggestion.color || color,
        },
      }));
    } catch {} finally { setSuggesting(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <div style={{ fontSize: 24, marginBottom: 4 }}>🎯</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text)', margin: '0 0 8px' }}>
          Your first objective
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {subStep < 3
            ? <SubProgress current={subStep} total={3} />
            : <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>Review your objective</span>
          }
          {subStep > 0 && subStep < 3 && (
            <button
              onClick={() => setSubStep(s => s - 1)}
              style={{ fontSize: 12, color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              ← Back
            </button>
          )}
        </div>
      </div>

      <AnimatedStep key={subStep}>
        {/* Q1 — area */}
        {subStep === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--color-text)', lineHeight: 1.5 }}>
              What area of your life does this objective focus on?
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {OBJ_AREAS.map(({ label, emoji }) => (
                <Chip
                  key={label}
                  label={`${emoji} ${label}`}
                  selected={area === label}
                  onClick={() => setArea(area === label ? '' : label)}
                  radio
                />
              ))}
            </div>
            <ConfirmBtn onClick={() => advanceToSuccess(area || 'Something else')} disabled={!area}>
              Confirm →
            </ConfirmBtn>
          </div>
        )}

        {/* Q2 — success description */}
        {subStep === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--color-text)', lineHeight: 1.5 }}>
              What does success look like in the next 90 days?
            </p>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--color-muted)' }}>
              Write your own or tap an example to start.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {examples.map(ex => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setSuccess(ex)}
                  style={{
                    padding: '6px 14px', borderRadius: 999, fontSize: 12, cursor: 'pointer',
                    border: `1px solid ${success === ex ? 'var(--color-primary)' : 'var(--color-border)'}`,
                    background: success === ex ? 'var(--color-primary)' : 'var(--color-bg)',
                    color: success === ex ? '#fff' : 'var(--color-muted)',
                    transition: 'all 0.15s',
                  }}
                >
                  {ex}
                </button>
              ))}
            </div>
            <WizardTextarea
              value={success}
              onChange={setSuccess}
              rows={2}
              placeholder="Describe what success looks like…"
            />
            <ConfirmBtn onClick={advanceToColor} disabled={!success.trim()}>
              Confirm →
            </ConfirmBtn>
          </div>
        )}

        {/* Q3 — colour */}
        {subStep === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--color-text)', lineHeight: 1.5 }}>
              Choose a colour to represent this objective
            </p>
            <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  style={{
                    width: 32, height: 32, borderRadius: '50%', background: c,
                    border: color === c ? '3px solid var(--color-text)' : '3px solid transparent',
                    cursor: 'pointer', padding: 0, transition: 'border 0.15s',
                    outline: color === c ? `2px solid ${c}` : 'none', outlineOffset: 2,
                  }}
                />
              ))}
            </div>
            <ConfirmBtn onClick={advanceToSummary} disabled={false}>
              Confirm →
            </ConfirmBtn>
          </div>
        )}

        {/* Summary */}
        {subStep === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text)', lineHeight: 1.5 }}>
              Here's your objective. Edit the title until it feels right, then continue.
            </p>

            <div>
              <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--color-muted)', display: 'block', marginBottom: 5 }}>
                Objective title *
              </label>
              <WizardTextarea
                value={editTitle}
                onChange={v => {
                  setEditTitle(v);
                  onChange(prev => ({ ...prev, objective: { ...(prev.objective || {}), title: v } }));
                }}
                rows={2}
                placeholder="My first objective…"
              />
            </div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--color-muted)', display: 'block', marginBottom: 5 }}>
                  Timeframe
                </label>
                <WizardInput
                  value={editTimeframe}
                  onChange={v => {
                    setEditTimeframe(v);
                    onChange(prev => ({ ...prev, objective: { ...(prev.objective || {}), timeframe: v } }));
                  }}
                  placeholder="90 days"
                />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--color-muted)', display: 'block', marginBottom: 5 }}>
                  Colour
                </label>
                <div style={{ display: 'flex', gap: 6, paddingTop: 2 }}>
                  {PRESET_COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => {
                        setColor(c);
                        onChange(prev => ({ ...prev, objective: { ...(prev.objective || {}), color: c } }));
                      }}
                      style={{
                        width: 22, height: 22, borderRadius: '50%', background: c,
                        border: (obj.color || color) === c ? '2px solid var(--color-text)' : '2px solid transparent',
                        cursor: 'pointer', padding: 0,
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                onClick={startOver}
                style={{ fontSize: 12, color: 'var(--color-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
              >
                Start over
              </button>
              <GhostBtn onClick={handleAiSuggest} disabled={suggesting}>
                {suggesting ? '✨ Suggesting…' : '✨ Let AI refine this'}
              </GhostBtn>
            </div>
          </div>
        )}
      </AnimatedStep>
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
        objectiveTitle:       data.objective?.title,
        objectiveDescription: data.objective?.description,
      });
      const suggestions = await res.json();
      onChange(prev => ({ ...prev, keyResults: suggestions.map(s => ({ ...s, selected: true })) }));
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => {
    if (!data.keyResults?.length) handleSuggest();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const krs = data.keyResults || [];
  const setKr = (i, patch) => onChange(prev => ({
    ...prev,
    keyResults: (prev.keyResults || []).map((kr, idx) => idx === i ? { ...kr, ...patch } : kr),
  }));
  const removeKr = (i) => onChange(prev => ({ ...prev, keyResults: (prev.keyResults || []).filter((_, idx) => idx !== i) }));
  const addKr = () => onChange(prev => ({ ...prev, keyResults: [...(prev.keyResults || []), { title: '', targetValue: 100, unit: '%', selected: true }] }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <div style={{ fontSize: 24, marginBottom: 4 }}>📊</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text)', margin: '0 0 6px' }}>Key Results</h2>
        <p style={{ fontSize: 13, color: 'var(--color-text)', margin: 0, lineHeight: 1.6 }}>
          Key Results are measurable milestones that show you're making progress. Select the ones that resonate and edit them freely.
        </p>
      </div>

      {loading && <p style={{ fontSize: 13, color: 'var(--color-muted)' }}>Suggesting key results…</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {krs.map((kr, i) => (
          <div key={i} style={{
            padding: '12px 14px', borderRadius: 10,
            border: `1px solid ${kr.selected ? 'var(--color-primary)' : 'var(--color-border)'}`,
            background: kr.selected ? 'rgba(99,102,241,0.06)' : 'var(--color-surface)',
          }}>
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
                    width: '100%', fontSize: 13, padding: '6px 10px', borderRadius: 8,
                    border: '1px solid var(--color-border)', background: 'var(--color-bg)',
                    color: 'var(--color-text)', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
                  }}
                />
                <div style={{ display: 'flex', gap: 6 }}>
                  <input type="number" value={kr.targetValue} onChange={e => setKr(i, { targetValue: Number(e.target.value) })}
                    style={{ width: 80, fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', outline: 'none', fontFamily: 'inherit' }}
                  />
                  <input value={kr.unit} onChange={e => setKr(i, { unit: e.target.value })} placeholder="unit"
                    style={{ width: 70, fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', outline: 'none', fontFamily: 'inherit' }}
                  />
                  <button onClick={() => removeKr(i)} style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: 'none', background: 'none', color: 'var(--color-muted)', cursor: 'pointer' }}>✕</button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <GhostBtn onClick={addKr}>+ Add another</GhostBtn>
        <GhostBtn onClick={handleSuggest} disabled={loading}>↻ Re-suggest</GhostBtn>
      </div>
    </div>
  );
}

// ── Step 5: Connect Tasks ──────────────────────────────────────────────────────
function Step5({ data, onChange }) {
  const [tasks, setTasks]             = useState([]);
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
    onChange(prev => ({ ...prev, linkedTaskIds: [...next] }));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <div style={{ fontSize: 24, marginBottom: 4 }}>🔗</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text)', margin: '0 0 6px' }}>Connect your tasks</h2>
        <p style={{ fontSize: 13, color: 'var(--color-text)', margin: 0, lineHeight: 1.6 }}>
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
            <label key={task.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
              border: `1px solid ${linkedTaskIds.has(task.id) ? 'var(--color-primary)' : 'var(--color-border)'}`,
              background: linkedTaskIds.has(task.id) ? 'rgba(99,102,241,0.06)' : 'var(--color-surface)',
              transition: 'all 0.12s',
            }}>
              <input type="checkbox" checked={linkedTaskIds.has(task.id)} onChange={() => toggle(task.id)}
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
  const [observing, setObserving]           = useState(false);
  const [observationDone, setObservationDone] = useState(false);

  const scores = data.renewalScores || { physical: 5, mental: 5, social: 5, spiritual: 5 };
  const setScore = (key, val) => {
    onChange(prev => ({ ...prev, renewalScores: { ...scores, [key]: val }, renewalObservation: '' }));
    setObservationDone(false);
  };

  const handleObserve = async () => {
    setObserving(true);
    setObservationDone(false);
    onChange(prev => ({ ...prev, renewalObservation: '' }));
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
        <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text)', margin: '0 0 6px' }}>Renewal Balance</h2>
        <p style={{ fontSize: 13, color: 'var(--color-text)', margin: 0, lineHeight: 1.6 }}>
          Habit 7 — Sharpen the Saw. Rate how well you're renewing yourself in each dimension. Honest ratings make the AI insight more useful.
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
              <span style={{ fontSize: 13, fontWeight: 700, color: d.color, minWidth: 24, textAlign: 'right' }}>{scores[d.key]}</span>
            </div>
            <input
              type="range" min={0} max={10} step={1}
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
  const obj  = data.objective || {};
  const krs  = (data.keyResults || []).filter(kr => kr.selected && kr.title);
  const linked = data.linkedTaskIds?.length || 0;

  if (saved) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, paddingTop: 20, textAlign: 'center' }}>
        <div style={{ fontSize: 56 }}>🎉</div>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', margin: '0 0 8px' }}>Your foundation is set.</h2>
          <p style={{ fontSize: 14, color: 'var(--color-text)', lineHeight: 1.7, margin: 0, maxWidth: 400 }}>
            Your mission, objective, and key results are saved. Head to the Goals page any time to track your progress.
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, width: '100%', maxWidth: 360 }}>
          {[
            { emoji: '🧭', label: 'Mission statement',                                ok: !!data.missionFinal },
            { emoji: '🎯', label: `Objective: ${obj.title || '—'}`,                  ok: !!obj.title },
            { emoji: '📊', label: `${krs.length} Key Result${krs.length !== 1 ? 's' : ''}`, ok: krs.length > 0 },
            { emoji: '🔗', label: `${linked} task${linked !== 1 ? 's' : ''} connected`, ok: linked > 0 },
          ].map((item, i) => (
            <div key={i} style={{
              padding: '12px 14px', borderRadius: 10,
              border: `1px solid ${item.ok ? '#22c55e44' : 'var(--color-border)'}`,
              background: item.ok ? '#22c55e0d' : 'var(--color-bg)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
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
        <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text)', margin: '0 0 6px' }}>Review & save</h2>
        <p style={{ fontSize: 13, color: 'var(--color-text)', margin: 0, lineHeight: 1.6 }}>
          Everything looks good. Confirm below to save your foundation to Curam Vault.
        </p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <SummaryCard emoji="🧭" label="Mission" content={data.missionFinal || '(skipped)'} />
        <SummaryCard emoji="🎯" label="Objective" content={obj.title || '(none)'} sub={obj.timeframe ? `Timeframe: ${obj.timeframe}` : null} color={obj.color} />
        <div style={{ padding: '12px 14px', borderRadius: 10, border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)', marginBottom: krs.length ? 8 : 0 }}>📊 Key Results ({krs.length})</div>
          {krs.map((kr, i) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--color-muted)', paddingTop: 4 }}>
              · {kr.title} — target {kr.targetValue} {kr.unit}
            </div>
          ))}
          {krs.length === 0 && <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>None selected</div>}
        </div>
        <SummaryCard emoji="🔗" label="Tasks connected" content={linked > 0 ? `${linked} task${linked !== 1 ? 's' : ''} will be linked to your objective` : 'No tasks linked — you can do this later'} />
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

// ── Main Wizard ────────────────────────────────────────────────────────────────
const TOTAL_STEPS = 7;
const STEP_LABELS = ['Personal Context', 'Mission Statement', 'First Objective', 'Key Results', 'Connect Tasks', 'Renewal Balance', 'Review & Save'];

export default function GettingStartedWizard({ onClose, onComplete }) {
  const [step, setStep]       = useState(1);
  const [data, setDataRaw]    = useState(() => loadDraft() || {});
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);

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

  // Step 6: show "Next →" if user has moved any slider from default (5)
  const step6Interacted = step === 6 && data.renewalScores &&
    Object.values(data.renewalScores).some(v => v !== 5);

  const nextLabel = (step === 5 || (step === 6 && !step6Interacted)) ? 'Skip →' : 'Next →';

  const handleSave = async () => {
    setSaving(true);
    try {
      if (data.missionFinal?.trim()) {
        await api.post('/api/mission', {
          statementText: data.missionFinal.trim(),
          wizardData: {
            mattersMost: data.mattersMost || '',
            betterAt: data.betterAt || '',
            lifeStage: data.lifeStage || '',
            missionGenerated: data.missionGenerated || '',
          },
        });
      }
      let objectiveId = null;
      if (data.objective?.title?.trim()) {
        const objRes = await api.post('/api/goals', {
          title:       data.objective.title.trim(),
          description: data.objective.description?.trim() || null,
          timeframe:   data.objective.timeframe?.trim()   || null,
          color:       data.objective.color               || '#6366f1',
        });
        const obj = await objRes.json();
        objectiveId = obj.id;
      }
      const selectedKrs = (data.keyResults || []).filter(kr => kr.selected && kr.title?.trim());
      let firstKrId = null;
      if (objectiveId && selectedKrs.length) {
        for (const kr of selectedKrs) {
          const krRes = await api.post(`/api/goals/${objectiveId}/key-results`, {
            title:       kr.title.trim(),
            targetValue: kr.targetValue || 100,
            unit:        kr.unit || '%',
          });
          const saved = await krRes.json();
          if (!firstKrId) firstKrId = saved.id;
        }
      }
      if (firstKrId && data.linkedTaskIds?.length) {
        for (const taskId of data.linkedTaskIds) {
          await api.put(`/api/tasks/${taskId}`, { keyResultId: firstKrId }).catch(() => {});
        }
      }
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

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)', padding: 16,
    }}>
      <div style={{
        width: '100%', maxWidth: 560, maxHeight: '90dvh',
        background: 'var(--color-surface)', border: '1px solid var(--color-border)',
        borderRadius: 20, overflow: 'hidden', boxShadow: '0 32px 64px rgba(0,0,0,0.4)',
        display: 'flex', flexDirection: 'column',
      }}>
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
          {step === 1 && <Step1 data={data} onChange={setData} />}
          {step === 2 && <Step2 data={data} onChange={setData} onBack={() => setStep(1)} />}
          {step === 3 && <Step3 data={data} onChange={setData} />}
          {step === 4 && <Step4 data={data} onChange={setData} />}
          {step === 5 && <Step5 data={data} onChange={setData} />}
          {step === 6 && <Step6 data={data} onChange={setData} />}
          {step === 7 && <Step7 data={data} onSave={handleSave} saving={saving} saved={saved} />}
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
                cursor: step === 1 ? 'default' : 'pointer', fontFamily: 'inherit',
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
                  transition: 'all 0.15s', fontFamily: 'inherit',
                }}
              >
                {nextLabel}
              </button>
            )}
          </div>
        )}

        {/* Close on success */}
        {saved && (
          <div style={{ padding: '14px 20px', borderTop: '1px solid var(--color-border)', textAlign: 'center', flexShrink: 0 }}>
            <button
              onClick={onClose}
              style={{
                fontSize: 13, fontWeight: 500, padding: '8px 24px', borderRadius: 10,
                background: 'var(--color-primary)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
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
