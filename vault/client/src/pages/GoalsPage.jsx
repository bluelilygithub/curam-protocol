import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import { startGoalsTour, TOUR_KEY } from '../utils/tours/goalsTour';
import GettingStartedWizard from '../components/GettingStartedWizard';

const PRESET_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#22c55e', '#3b82f6', '#ef4444'];

const TODAY = new Date().toISOString().slice(0, 10);

function milestoneStatus(m) {
  if (m.status === 'done') return 'done';
  if (m.dueDate && m.dueDate.slice(0, 10) < TODAY) return 'overdue';
  if (m.status === 'in-progress') return 'in-progress';
  return 'todo';
}

function MilestoneTimeline({ milestones }) {
  const [open, setOpen] = useState(false);
  const overdue = milestones.filter(m => milestoneStatus(m) === 'overdue');
  const label = overdue.length > 0
    ? `Milestones (${overdue.length} overdue)`
    : `Milestones (${milestones.length})`;

  return (
    <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: overdue.length > 0 ? '#ef4444' : 'var(--color-muted)' }}>
          🏁 {label}
        </span>
        <span style={{ fontSize: 12, color: 'var(--color-muted)', transform: open ? 'rotate(180deg)' : 'rotate(0deg)', display: 'inline-block', transition: 'transform 0.15s' }}>▾</span>
      </button>

      {open && (
        <div style={{ marginTop: 10 }}>
          {milestones.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--color-muted)', fontStyle: 'italic' }}>
              No milestones yet. Mark any task as 🏁 Milestone and link it to this objective to see it here.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {milestones.map(m => {
                const ms = milestoneStatus(m);
                const isDone = ms === 'done';
                const isOverdue = ms === 'overdue';
                const dateLabel = m.dueDate ? new Date(m.dueDate.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
                return (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12 }}>{isDone ? '✓' : '🏁'}</span>
                    <span style={{ fontSize: 13, flex: 1, textDecoration: isDone ? 'line-through' : 'none', color: isOverdue ? '#ef4444' : isDone ? 'var(--color-muted)' : 'var(--color-text)', opacity: isDone ? 0.6 : 1 }}>
                      {m.title}
                    </span>
                    {dateLabel && (
                      <span style={{ fontSize: 11, color: isOverdue ? '#ef4444' : 'var(--color-muted)', whiteSpace: 'nowrap' }}>
                        {isOverdue ? 'Overdue · ' : ''}{dateLabel}
                      </span>
                    )}
                    <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: isDone ? '#22c55e22' : isOverdue ? '#ef444422' : 'var(--color-border)', color: isDone ? '#22c55e' : isOverdue ? '#ef4444' : 'var(--color-muted)', whiteSpace: 'nowrap' }}>
                      {isDone ? 'Done' : isOverdue ? 'Overdue' : ms === 'in-progress' ? 'In Progress' : 'To Do'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function progressColor(pct) {
  if (pct >= 70) return '#22c55e';
  if (pct >= 30) return '#f59e0b';
  return '#ef4444';
}

function KrProgressBar({ current, target, unit, color }) {
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--color-border)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color || progressColor(pct), borderRadius: 3, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: 11, color: 'var(--color-muted)', whiteSpace: 'nowrap', minWidth: 60, textAlign: 'right' }}>
        {current}/{target} {unit}
      </span>
    </div>
  );
}

function KeyResultRow({ kr, objectiveId, onUpdate, onDelete, accentColor }) {
  const getIcon = useIcon();
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(String(kr.currentValue));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editTitle, setEditTitle] = useState(false);
  const [titleVal, setTitleVal] = useState(kr.title);
  const pct = kr.progress;

  const saveCurrentValue = async () => {
    const num = parseFloat(editVal);
    if (!isNaN(num) && num !== kr.currentValue) {
      await api.put(`/api/goals/key-results/${kr.id}`, { currentValue: num }).then(r => r.json()).then(onUpdate);
    }
    setEditing(false);
  };

  const saveTitle = async () => {
    if (titleVal.trim() && titleVal !== kr.title) {
      await api.put(`/api/goals/key-results/${kr.id}`, { title: titleVal.trim() }).then(r => r.json()).then(onUpdate);
    }
    setEditTitle(false);
  };

  return (
    <div style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--color-bg)', border: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1 }}>
          {editTitle ? (
            <input
              autoFocus
              value={titleVal}
              onChange={e => setTitleVal(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') { setTitleVal(kr.title); setEditTitle(false); } }}
              style={{ width: '100%', fontSize: 13, fontWeight: 500, color: 'var(--color-text)', background: 'transparent', border: 'none', borderBottom: '1px solid var(--color-primary)', outline: 'none', paddingBottom: 2 }}
            />
          ) : (
            <span
              style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)', cursor: 'text', textDecoration: kr.status === 'completed' ? 'line-through' : 'none', opacity: kr.status === 'completed' ? 0.6 : 1 }}
              onClick={() => setEditTitle(true)}
            >
              {kr.title}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: progressColor(pct) + '22', color: progressColor(pct) }}>{pct}%</span>
          {confirmDelete ? (
            <>
              <button onClick={() => onDelete(kr.id)} style={{ fontSize: 10, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}>Delete?</button>
              <button onClick={() => setConfirmDelete(false)} style={{ fontSize: 10, color: 'var(--color-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}>No</button>
            </>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="hover:opacity-60 transition-opacity" style={{ color: 'var(--color-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}>
              {getIcon('trash', { size: 12 })}
            </button>
          )}
        </div>
      </div>
      <KrProgressBar current={kr.currentValue} target={kr.targetValue} unit={kr.unit} color={accentColor} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--color-muted)' }}>Progress:</span>
        {editing ? (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              autoFocus
              type="number"
              value={editVal}
              onChange={e => setEditVal(e.target.value)}
              onBlur={saveCurrentValue}
              onKeyDown={e => { if (e.key === 'Enter') saveCurrentValue(); if (e.key === 'Escape') setEditing(false); }}
              style={{ width: 60, fontSize: 12, padding: '2px 6px', borderRadius: 6, border: '1px solid var(--color-primary)', background: 'var(--color-surface)', color: 'var(--color-text)', outline: 'none' }}
            />
            <span style={{ fontSize: 11, color: 'var(--color-muted)' }}>/ {kr.targetValue} {kr.unit}</span>
          </div>
        ) : (
          <button
            onClick={() => { setEditVal(String(kr.currentValue)); setEditing(true); }}
            style={{ fontSize: 12, color: accentColor || 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500, padding: 0 }}
          >
            {kr.currentValue} {kr.unit}
          </button>
        )}
        {kr.linkedTaskCount > 0 && (
          <span style={{ fontSize: 11, color: 'var(--color-muted)', marginLeft: 'auto' }}>
            {kr.completedTaskCount}/{kr.linkedTaskCount} tasks
          </span>
        )}
        {kr.dueDate && (
          <span style={{ fontSize: 11, color: 'var(--color-muted)' }}>
            Due {new Date(kr.dueDate + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </span>
        )}
      </div>
    </div>
  );
}

function AddKrForm({ objectiveId, onAdded, onCancel }) {
  const [title, setTitle] = useState('');
  const [targetValue, setTargetValue] = useState('100');
  const [unit, setUnit] = useState('%');
  const [dueDate, setDueDate] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      const kr = await api.post(`/api/goals/${objectiveId}/key-results`, {
        title: title.trim(),
        targetValue: parseFloat(targetValue) || 100,
        currentValue: 0,
        unit: unit.trim() || '%',
        dueDate: dueDate || null,
      }).then(r => r.json());
      onAdded(kr);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px', borderRadius: 10, border: '1px dashed var(--color-border)', background: 'var(--color-bg)' }}>
      <input
        autoFocus
        placeholder="Key Result title (e.g. Increase MRR)"
        value={title}
        onChange={e => setTitle(e.target.value)}
        style={{ fontSize: 13, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', outline: 'none', width: '100%' }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="number"
          placeholder="Target"
          value={targetValue}
          onChange={e => setTargetValue(e.target.value)}
          style={{ flex: 1, fontSize: 12, padding: '5px 8px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', outline: 'none' }}
        />
        <input
          placeholder="Unit (%)"
          value={unit}
          onChange={e => setUnit(e.target.value)}
          style={{ width: 70, fontSize: 12, padding: '5px 8px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', outline: 'none' }}
        />
        <input
          type="date"
          value={dueDate}
          onChange={e => setDueDate(e.target.value)}
          style={{ flex: 1, fontSize: 12, padding: '5px 8px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', outline: 'none' }}
        />
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="submit" disabled={saving || !title.trim()} style={{ fontSize: 12, fontWeight: 500, padding: '5px 12px', borderRadius: 8, background: 'var(--color-primary)', color: '#fff', border: 'none', cursor: 'pointer', opacity: saving || !title.trim() ? 0.5 : 1 }}>
          {saving ? 'Saving…' : 'Add'}
        </button>
        <button type="button" onClick={onCancel} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, background: 'none', border: '1px solid var(--color-border)', color: 'var(--color-muted)', cursor: 'pointer' }}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function AiSuggestPanel({ objective, onAddKr }) {
  const [streaming, setStreaming] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [buffer, setBuffer] = useState('');
  const [added, setAdded] = useState(new Set());

  const handleGenerate = async () => {
    setSuggestions([]);
    setBuffer('');
    setAdded(new Set());
    setStreaming(true);
    try {
      const res = await api.post('/api/goals/ai-suggest', {
        title: objective.title,
        description: objective.description,
        timeframe: objective.timeframe,
      });
      if (!res.ok) { setStreaming(false); return; }
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
          const data = line.slice(6);
          if (data === '[DONE]') break;
          try {
            const token = JSON.parse(data);
            accumulated += token;
          } catch { }
        }
        // Try to parse JSON lines from accumulated
        const jsonLines = accumulated.split('\n').filter(l => l.trim().startsWith('{'));
        const parsed = [];
        for (const jl of jsonLines) {
          try { parsed.push(JSON.parse(jl)); } catch { }
        }
        setSuggestions(parsed);
      }
    } catch { }
    setStreaming(false);
  };

  const handleAdd = async (s) => {
    const kr = await api.post(`/api/goals/${objective.id}/key-results`, {
      title: s.title,
      targetValue: s.targetValue || 100,
      currentValue: 0,
      unit: s.unit || '%',
    }).then(r => r.json());
    onAddKr(kr);
    setAdded(prev => new Set([...prev, s.title]));
  };

  return (
    <div style={{ marginTop: 16, padding: '14px 16px', borderRadius: 12, border: '1px solid var(--color-border)', background: 'var(--color-bg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)' }}>AI Suggest Key Results</span>
        <button
          onClick={handleGenerate}
          disabled={streaming}
          style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, background: 'var(--color-primary)', color: '#fff', border: 'none', cursor: 'pointer', opacity: streaming ? 0.6 : 1 }}
        >
          {streaming ? 'Generating…' : 'Generate'}
        </button>
      </div>
      {suggestions.length === 0 && !streaming && (
        <p style={{ fontSize: 12, color: 'var(--color-muted)' }}>Click "Generate" to get SMART Key Result suggestions for this objective.</p>
      )}
      {streaming && suggestions.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--color-muted)' }}>Generating suggestions…</p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {suggestions.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text)', margin: 0 }}>{s.title}</p>
              <p style={{ fontSize: 11, color: 'var(--color-muted)', margin: 0 }}>Target: {s.targetValue} {s.unit}</p>
            </div>
            <button
              onClick={() => handleAdd(s)}
              disabled={added.has(s.title)}
              style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, background: added.has(s.title) ? 'var(--color-border)' : 'var(--color-primary)', color: added.has(s.title) ? 'var(--color-muted)' : '#fff', border: 'none', cursor: 'pointer' }}
            >
              {added.has(s.title) ? 'Added' : 'Add'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

const RENEWAL_DIMS_GOALS = [
  { key: 'physical', label: '🏃 Physical', color: '#3b82f6' },
  { key: 'mental', label: '📚 Mental', color: '#22c55e' },
  { key: 'social', label: '🤝 Social', color: '#f59e0b' },
  { key: 'spiritual', label: '🌱 Spiritual', color: '#8b5cf6' },
];

function NewObjectiveModal({ onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [timeframe, setTimeframe] = useState('');
  const [color, setColor] = useState('#6366f1');
  const [renewalDimension, setRenewalDimension] = useState(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      const obj = await api.post('/api/goals', { title: title.trim(), description: description.trim() || null, timeframe: timeframe.trim() || null, color, renewalDimension: renewalDimension || null }).then(r => r.json());
      onCreated(obj);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: '100%', maxWidth: 440, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, overflow: 'hidden', boxShadow: '0 25px 50px rgba(0,0,0,0.4)' }}>
        <div style={{ padding: '20px 20px 0', borderBottom: '1px solid var(--color-border)', paddingBottom: 16 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>New Objective</h2>
        </div>
        <form onSubmit={handleSubmit} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--color-muted)', display: 'block', marginBottom: 4 }}>Title *</label>
            <input
              autoFocus
              placeholder="e.g. Launch new product line"
              value={title}
              onChange={e => setTitle(e.target.value)}
              style={{ width: '100%', fontSize: 13, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--color-muted)', display: 'block', marginBottom: 4 }}>Description</label>
            <textarea
              placeholder="What does success look like?"
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              style={{ width: '100%', fontSize: 13, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: 'var(--color-muted)', display: 'block', marginBottom: 4 }}>Timeframe</label>
              <input
                placeholder="Q2 2026"
                value={timeframe}
                onChange={e => setTimeframe(e.target.value)}
                style={{ width: '100%', fontSize: 13, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--color-muted)', display: 'block', marginBottom: 4 }}>Color</label>
              <div style={{ display: 'flex', gap: 4, paddingTop: 6 }}>
                {PRESET_COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    style={{ width: 20, height: 20, borderRadius: '50%', background: c, border: color === c ? '2px solid var(--color-text)' : '2px solid transparent', cursor: 'pointer', padding: 0 }}
                  />
                ))}
              </div>
            </div>
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--color-muted)', display: 'block', marginBottom: 6 }}>Renewal Dimension (Habit 7)</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {RENEWAL_DIMS_GOALS.map(d => (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => setRenewalDimension(renewalDimension === d.key ? null : d.key)}
                  style={{ flex: 1, fontSize: 11, padding: '5px 4px', borderRadius: 7, border: `1px solid ${renewalDimension === d.key ? d.color : 'var(--color-border)'}`, background: renewalDimension === d.key ? d.color + '22' : 'transparent', color: renewalDimension === d.key ? d.color : 'var(--color-muted)', cursor: 'pointer', transition: 'all 0.12s', textAlign: 'center' }}
                >{d.label}</button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" onClick={onClose} style={{ fontSize: 13, padding: '7px 14px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'none', color: 'var(--color-muted)', cursor: 'pointer' }}>Cancel</button>
            <button type="submit" disabled={saving || !title.trim()} style={{ fontSize: 13, fontWeight: 500, padding: '7px 16px', borderRadius: 8, background: 'var(--color-primary)', color: '#fff', border: 'none', cursor: 'pointer', opacity: saving || !title.trim() ? 0.5 : 1 }}>
              {saving ? 'Creating…' : 'Create Objective'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const WIZARD_QUESTIONS = [
  "What are your most important roles in life? (e.g. parent, professional, community member)",
  "What do you want to be known for — what character traits matter most to you?",
  "What do you want to achieve or contribute in your lifetime?",
  "What principles or values guide your decisions?",
];

function MissionStatementCard() {
  const getIcon = useIcon();
  const [statement, setStatement] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardAnswers, setWizardAnswers] = useState(['', '', '', '']);
  const [generating, setGenerating] = useState(false);
  const [generatedText, setGeneratedText] = useState('');
  const [generationDone, setGenerationDone] = useState(false);

  useEffect(() => {
    api.get('/api/goals/mission').then(r => r.json()).then(data => {
      setStatement(data.statement || null);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const data = await api.put('/api/goals/mission', { statement: editText }).then(r => r.json());
      setStatement(data.statement || null);
      setEditMode(false);
    } catch (err) { console.error(err); }
    finally { setSaving(false); }
  };

  const handleOpenWizard = (rewrite = false) => {
    if (rewrite) {
      try {
        const saved = JSON.parse(localStorage.getItem('missionWizardAnswers') || '[]');
        if (Array.isArray(saved) && saved.length === 4) setWizardAnswers(saved);
      } catch {}
    } else {
      setWizardAnswers(['', '', '', '']);
    }
    setWizardStep(1);
    setGeneratedText('');
    setGenerationDone(false);
    setShowWizard(true);
  };

  const handleGenerate = async () => {
    localStorage.setItem('missionWizardAnswers', JSON.stringify(wizardAnswers));
    setGenerating(true);
    setGeneratedText('');
    setGenerationDone(false);
    try {
      const res = await api.post('/api/goals/mission/generate', { answers: wizardAnswers });
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
          if (payload === '[DONE]') { setGenerationDone(true); break; }
          try {
            const token = JSON.parse(payload);
            accumulated += token;
            setGeneratedText(accumulated);
          } catch {}
        }
      }
      setGenerationDone(true);
    } catch (err) { console.error(err); }
    finally { setGenerating(false); }
  };

  const handleUseStatement = async () => {
    setSaving(true);
    try {
      const data = await api.put('/api/goals/mission', { statement: generatedText }).then(r => r.json());
      setStatement(data.statement || null);
      setShowWizard(false);
      setGeneratedText('');
      setGenerationDone(false);
    } catch (err) { console.error(err); }
    finally { setSaving(false); }
  };

  if (loading) return null;

  const s = { background: 'var(--color-surface)', borderColor: 'var(--color-border)' };

  return (
    <div style={{ flexShrink: 0, borderBottom: '1px solid var(--color-border)' }}>
      {/* Main card row */}
      <div
        style={{ padding: '14px 20px', background: s.background, position: 'relative' }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Empty state */}
        {!statement && !editMode && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: 10, background: 'var(--color-primary)22', flexShrink: 0 }}>
              {getIcon('compass', { size: 18, style: { color: 'var(--color-primary)' } })}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 2 }}>Personal Mission Statement</div>
              <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>Your north star — what do you want to be and do in your life?</div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button
                onClick={() => handleOpenWizard(false)}
                style={{ fontSize: 12, fontWeight: 500, padding: '6px 14px', borderRadius: 8, background: 'var(--color-primary)', color: '#fff', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                {getIcon('sparkles', { size: 12 })} Write with Claude
              </button>
              <button
                onClick={() => { setEditText(''); setEditMode(true); setShowWizard(false); }}
                style={{ fontSize: 12, padding: '6px 12px', borderRadius: 8, background: 'none', border: '1px solid var(--color-border)', color: 'var(--color-muted)', cursor: 'pointer' }}
              >
                Add manually
              </button>
            </div>
          </div>
        )}

        {/* Display state */}
        {statement && !editMode && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 8, background: 'var(--color-primary)22', flexShrink: 0, marginTop: 2 }}>
              {getIcon('compass', { size: 14, style: { color: 'var(--color-primary)' } })}
            </div>
            <blockquote style={{ flex: 1, margin: 0, paddingLeft: 14, borderLeft: '3px solid var(--color-primary)', fontStyle: 'italic', fontSize: 14, lineHeight: 1.65, color: 'var(--color-text)' }}>
              {statement}
            </blockquote>
            {hovered && (
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                <button
                  onClick={() => { setEditText(statement); setEditMode(true); setShowWizard(false); }}
                  title="Edit"
                  style={{ padding: '4px 7px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                >
                  {getIcon('edit', { size: 13 })}
                </button>
                <button
                  onClick={() => handleOpenWizard(true)}
                  title="Rewrite with Claude"
                  style={{ padding: '4px 7px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                >
                  {getIcon('sparkles', { size: 13 })}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Edit state */}
        {editMode && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              {getIcon('compass', { size: 14, style: { color: 'var(--color-primary)' } })}
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)' }}>Personal Mission Statement</span>
            </div>
            <textarea
              autoFocus
              value={editText}
              onChange={e => setEditText(e.target.value)}
              rows={3}
              placeholder="Write your personal mission statement…"
              style={{ width: '100%', fontSize: 14, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--color-primary)', background: 'var(--color-bg)', color: 'var(--color-text)', outline: 'none', resize: 'vertical', fontStyle: 'italic', lineHeight: 1.65, boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleSave}
                disabled={saving || !editText.trim()}
                style={{ fontSize: 12, fontWeight: 500, padding: '6px 14px', borderRadius: 8, background: 'var(--color-primary)', color: '#fff', border: 'none', cursor: 'pointer', opacity: saving || !editText.trim() ? 0.5 : 1 }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => setEditMode(false)}
                style={{ fontSize: 12, padding: '6px 12px', borderRadius: 8, background: 'none', border: '1px solid var(--color-border)', color: 'var(--color-muted)', cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Claude wizard panel (inline collapsible) */}
      {showWizard && (
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--color-border)', background: 'var(--color-bg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {getIcon('sparkles', { size: 13, style: { color: 'var(--color-primary)' } })}
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)' }}>Write with Claude</span>
              {!generating && !generatedText && (
                <span style={{ fontSize: 11, color: 'var(--color-muted)' }}>— Step {wizardStep} of 4</span>
              )}
            </div>
            <button onClick={() => setShowWizard(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', display: 'flex', alignItems: 'center' }}>
              {getIcon('x', { size: 14 })}
            </button>
          </div>

          {/* Wizard steps */}
          {!generating && !generatedText ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 620 }}>
              <label style={{ fontSize: 13, color: 'var(--color-text)', fontWeight: 500 }}>
                {WIZARD_QUESTIONS[wizardStep - 1]}
              </label>
              <textarea
                autoFocus
                value={wizardAnswers[wizardStep - 1]}
                onChange={e => {
                  const updated = [...wizardAnswers];
                  updated[wizardStep - 1] = e.target.value;
                  setWizardAnswers(updated);
                }}
                rows={2}
                placeholder="Your answer…"
                style={{ width: '100%', fontSize: 13, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                {wizardStep > 1 && (
                  <button
                    onClick={() => setWizardStep(s => s - 1)}
                    style={{ fontSize: 12, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'none', color: 'var(--color-muted)', cursor: 'pointer' }}
                  >
                    ← Back
                  </button>
                )}
                {wizardStep < 4 ? (
                  <button
                    onClick={() => setWizardStep(s => s + 1)}
                    disabled={!wizardAnswers[wizardStep - 1].trim()}
                    style={{ fontSize: 12, fontWeight: 500, padding: '6px 14px', borderRadius: 8, background: 'var(--color-primary)', color: '#fff', border: 'none', cursor: 'pointer', opacity: !wizardAnswers[wizardStep - 1].trim() ? 0.5 : 1 }}
                  >
                    Next →
                  </button>
                ) : (
                  <button
                    onClick={handleGenerate}
                    disabled={!wizardAnswers[3].trim()}
                    style={{ fontSize: 12, fontWeight: 500, padding: '6px 14px', borderRadius: 8, background: 'var(--color-primary)', color: '#fff', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, opacity: !wizardAnswers[3].trim() ? 0.5 : 1 }}
                  >
                    {getIcon('sparkles', { size: 12 })} Generate
                  </button>
                )}
              </div>
            </div>
          ) : (
            /* Result panel */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 620 }}>
              <div style={{ padding: '12px 16px', borderRadius: 10, borderLeft: '3px solid var(--color-primary)', background: 'var(--color-surface)', fontStyle: 'italic', fontSize: 14, lineHeight: 1.65, color: 'var(--color-text)', minHeight: 60 }}>
                {generating && !generatedText
                  ? <span style={{ color: 'var(--color-muted)' }}>Generating…</span>
                  : <span>{generatedText}</span>
                }
                {generating && <span style={{ color: 'var(--color-primary)', marginLeft: 2 }}>▊</span>}
              </div>
              {generationDone && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    onClick={handleUseStatement}
                    disabled={saving}
                    style={{ fontSize: 12, fontWeight: 500, padding: '6px 14px', borderRadius: 8, background: 'var(--color-primary)', color: '#fff', border: 'none', cursor: 'pointer', opacity: saving ? 0.5 : 1 }}
                  >
                    Use this statement
                  </button>
                  <button
                    onClick={handleGenerate}
                    style={{ fontSize: 12, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'none', color: 'var(--color-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                  >
                    {getIcon('refresh-cw', { size: 11 })} Regenerate
                  </button>
                  <button
                    onClick={() => { setGeneratedText(''); setGenerationDone(false); }}
                    style={{ fontSize: 12, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'none', color: 'var(--color-muted)', cursor: 'pointer' }}
                  >
                    ← Edit answers
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function GoalsPage() {
  const getIcon = useIcon();
  const navigate = useNavigate();
  const [objectives, setObjectives] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [wizardCompleted, setWizardCompleted] = useState(null); // null=loading, true/false
  const [showAddKr, setShowAddKr] = useState(false);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [editingObjective, setEditingObjective] = useState(null); // field being edited
  const [editVal, setEditVal] = useState('');
  const [confirmDeleteObj, setConfirmDeleteObj] = useState(false);
  const [showRenewalBalance, setShowRenewalBalance] = useState(() => {
    try { return JSON.parse(localStorage.getItem('goalsRenewalOpen') ?? 'true'); } catch { return true; }
  });
  const [renewalTasks, setRenewalTasks] = useState([]);
  const [assessmentText, setAssessmentText] = useState('');
  const [assessing, setAssessing] = useState(false);
  const [assessmentDone, setAssessmentDone] = useState(false);
  const missionRef = useRef(null);
  const renewalRef = useRef(null);

  const loadObjectives = useCallback(async () => {
    try {
      const data = await api.get('/api/goals').then(r => r.json());
      setObjectives(data);
      // Update selected if it was already set
      setSelected(prev => prev ? data.find(o => o.id === prev.id) || null : null);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadObjectives(); }, [loadObjectives]);

  useEffect(() => {
    api.get('/api/goals/wizard/status').then(r => r.json()).then(d => setWizardCompleted(d.completed)).catch(() => setWizardCompleted(true));
  }, []);

  useEffect(() => {
    api.get('/api/tasks').then(r => r.json()).then(data => setRenewalTasks(Array.isArray(data) ? data : [])).catch(() => {});
  }, []);

  // Open wizard immediately when navigated to /goals?wizard=true
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('wizard') === 'true') {
      setShowWizard(true);
      // Clean the query param from the URL without a re-render
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const section = params.get('section');
    if (!section) return;
    const scrollTo = (ref) => {
      if (!ref.current) return;
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      ref.current.style.transition = 'outline 0.3s';
      ref.current.style.outline = '2px solid var(--color-primary)';
      ref.current.style.borderRadius = '8px';
      setTimeout(() => { if (ref.current) { ref.current.style.outline = 'none'; } }, 2500);
    };
    if (section === 'mission') { setTimeout(() => scrollTo(missionRef), 100); }
    if (section === 'renewal') { setShowRenewalBalance(true); setTimeout(() => scrollTo(renewalRef), 150); }
  }, []);

  // Tour: expand Renewal Balance on request
  useEffect(() => {
    const handler = () => {
      setShowRenewalBalance(true);
      localStorage.setItem('goalsRenewalOpen', 'true');
    };
    document.addEventListener('vault:expand-renewal-balance', handler);
    return () => document.removeEventListener('vault:expand-renewal-balance', handler);
  }, []);

  // Auto-start tour on first visit
  useEffect(() => {
    if (localStorage.getItem(TOUR_KEY)) return;
    const timer = setTimeout(() => startGoalsTour(navigate), 1500);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedObj = selected ? objectives.find(o => o.id === selected.id) || null : null;

  const handleObjectiveField = async (field, value) => {
    if (!selectedObj) return;
    const updated = await api.put(`/api/goals/${selectedObj.id}`, { [field]: value }).then(r => r.json());
    setObjectives(prev => prev.map(o => o.id === updated.id ? updated : o));
    setEditingObjective(null);
  };

  const handleKrUpdate = (updatedKr) => {
    setObjectives(prev => prev.map(obj => ({
      ...obj,
      keyResults: obj.keyResults.map(kr => kr.id === updatedKr.id ? updatedKr : kr),
    })));
  };

  const handleKrDelete = async (krId) => {
    await api.delete(`/api/goals/key-results/${krId}`);
    setObjectives(prev => prev.map(obj => ({
      ...obj,
      keyResults: obj.keyResults.filter(kr => kr.id !== krId),
    })));
  };

  const handleKrAdded = (kr) => {
    setObjectives(prev => prev.map(obj =>
      obj.id === selectedObj.id ? { ...obj, keyResults: [...obj.keyResults, { ...kr, linkedTaskCount: 0, completedTaskCount: 0, progress: 0 }] } : obj
    ));
    setShowAddKr(false);
  };

  const handleDeleteObjective = async () => {
    if (!selectedObj) return;
    await api.delete(`/api/goals/${selectedObj.id}`);
    setObjectives(prev => prev.filter(o => o.id !== selectedObj.id));
    setSelected(null);
    setConfirmDeleteObj(false);
  };

  const dimData = RENEWAL_DIMS_GOALS.map(d => {
    const matchingTasks = renewalTasks.filter(t => t.renewalDimension === d.key && t.status !== 'done');
    const matchingObjs = objectives.filter(o => o.renewalDimension === d.key && o.status === 'active');
    const avgProgress = matchingObjs.length ? Math.round(matchingObjs.reduce((s, o) => s + o.overallProgress, 0) / matchingObjs.length) : 0;
    return { ...d, taskCount: matchingTasks.length, objectiveCount: matchingObjs.length, avgProgress };
  });
  const totalTagged = dimData.reduce((s, d) => s + d.taskCount + d.objectiveCount, 0);
  const dominantDim = totalTagged > 0 ? dimData.reduce((best, d) => (d.taskCount + d.objectiveCount > best.taskCount + best.objectiveCount ? d : best), dimData[0]) : null;
  const nudge = dominantDim && (dominantDim.taskCount + dominantDim.objectiveCount) / totalTagged > 0.5;

  const handleAssessment = async () => {
    setAssessmentText('');
    setAssessing(true);
    setAssessmentDone(false);
    const dimensions = {};
    dimData.forEach(d => { dimensions[d.key] = { taskCount: d.taskCount, objectiveCount: d.objectiveCount }; });
    try {
      const res = await api.post('/api/goals/renewal-assessment', { dimensions });
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
          if (payload === '[DONE]') { setAssessmentDone(true); break; }
          try { accumulated += JSON.parse(payload); setAssessmentText(accumulated); } catch {}
        }
      }
      setAssessmentDone(true);
    } catch (err) { console.error(err); }
    finally { setAssessing(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {showWizard && (
        <GettingStartedWizard
          onClose={() => setShowWizard(false)}
          onComplete={() => {
            setWizardCompleted(true);
            loadObjectives();
            setShowWizard(false);
          }}
        />
      )}
      <div ref={missionRef} data-tour="mission-card"><MissionStatementCard /></div>

      {/* Renewal Balance Dashboard */}
      <div ref={renewalRef} data-tour="renewal-balance" style={{ flexShrink: 0, borderBottom: '1px solid var(--color-border)' }}>
        <button
          onClick={() => {
            const next = !showRenewalBalance;
            setShowRenewalBalance(next);
            localStorage.setItem('goalsRenewalOpen', JSON.stringify(next));
          }}
          style={{ width: '100%', padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
        >
          {getIcon(showRenewalBalance ? 'chevron-down' : 'chevron-right', { size: 12, style: { color: 'var(--color-muted)' } })}
          <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-muted)' }}>🌱 Renewal Balance (Habit 7)</span>
          {totalTagged === 0 && <span style={{ fontSize: 11, color: 'var(--color-muted)', marginLeft: 4 }}>— No items tagged yet</span>}
        </button>
        {showRenewalBalance && (
          <div style={{ padding: '0 20px 16px' }}>
            {/* 4 dimension cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 12 }}>
              {dimData.map(d => (
                <div key={d.key} style={{ padding: '10px 12px', borderRadius: 10, border: `1px solid ${d.taskCount + d.objectiveCount > 0 ? d.color + '44' : 'var(--color-border)'}`, background: d.taskCount + d.objectiveCount > 0 ? d.color + '0d' : 'var(--color-bg)' }}>
                  <div style={{ fontSize: 16, marginBottom: 4 }}>{d.label.split(' ')[0]}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: d.color, marginBottom: 2 }}>{d.label.split(' ')[1]}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-muted)', marginBottom: 6 }}>
                    {d.taskCount} task{d.taskCount !== 1 ? 's' : ''} · {d.objectiveCount} goal{d.objectiveCount !== 1 ? 's' : ''}
                  </div>
                  {d.objectiveCount > 0 && (
                    <div style={{ height: 4, borderRadius: 2, background: 'var(--color-border)', overflow: 'hidden' }}>
                      <div style={{ width: `${d.avgProgress}%`, height: '100%', background: d.color, borderRadius: 2 }} />
                    </div>
                  )}
                </div>
              ))}
            </div>
            {/* Balance bar */}
            {totalTagged > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', gap: 1 }}>
                  {dimData.map(d => {
                    const pct = ((d.taskCount + d.objectiveCount) / totalTagged) * 100;
                    return pct > 0 ? <div key={d.key} style={{ width: `${pct}%`, background: d.color, transition: 'width 0.3s' }} title={`${d.label}: ${Math.round(pct)}%`} /> : null;
                  })}
                </div>
                {nudge && dominantDim && (
                  <p style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 6 }}>
                    💡 {dominantDim.label} is dominant ({Math.round((dominantDim.taskCount + dominantDim.objectiveCount) / totalTagged * 100)}%). Consider adding tasks or goals in other dimensions to balance your renewal.
                  </p>
                )}
              </div>
            )}
            {/* AI Assessment */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <button
                onClick={handleAssessment}
                disabled={assessing}
                style={{ fontSize: 11, padding: '5px 12px', borderRadius: 7, background: 'var(--color-primary)', color: '#fff', border: 'none', cursor: 'pointer', opacity: assessing ? 0.6 : 1, flexShrink: 0 }}
              >
                {getIcon('sparkles', { size: 11 })} {assessing ? 'Assessing…' : 'AI Assessment'}
              </button>
              {(assessmentText || assessing) && (
                <p style={{ fontSize: 12, color: 'var(--color-muted)', lineHeight: 1.6, margin: 0, flex: 1 }}>
                  {assessmentText}{assessing && !assessmentDone && <span style={{ color: 'var(--color-primary)' }}>▊</span>}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {/* Left panel — objective list */}
      <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {getIcon('target', { size: 14, style: { color: 'var(--color-primary)' } })}
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>Goals</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {wizardCompleted && (
              <button
                onClick={async () => {
                  await api.post('/api/goals/reset-setup', { deleteObjectives: false }).catch(() => {});
                  setWizardCompleted(false);
                  setShowWizard(true);
                }}
                title="Reopen Setup Wizard"
                style={{ display: 'flex', alignItems: 'center', fontSize: 11, padding: '4px 8px', borderRadius: 6, background: 'none', border: '1px solid var(--color-border)', color: 'var(--color-muted)', cursor: 'pointer' }}
              >
                ✨
              </button>
            )}
            <button
              onClick={() => setShowNew(true)}
              data-tour="new-objective"
              title="New Objective"
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '4px 10px', borderRadius: 6, background: 'var(--color-primary)', color: '#fff', border: 'none', cursor: 'pointer' }}
            >
              {getIcon('plus', { size: 12 })} New
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
          {loading && <p style={{ fontSize: 12, color: 'var(--color-muted)', textAlign: 'center', padding: 16 }}>Loading…</p>}
          {!loading && objectives.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px 16px' }}>
              {wizardCompleted === false ? (
                <>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>🧭</div>
                  <p style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 12 }}>
                    Build your life foundation in 7 guided steps — mission, objectives, key results, and more.
                  </p>
                  <button
                    onClick={() => setShowWizard(true)}
                    data-tour="getting-started-trigger"
                    style={{ fontSize: 12, fontWeight: 500, padding: '7px 16px', borderRadius: 8, background: 'var(--color-primary)', color: '#fff', border: 'none', cursor: 'pointer', marginBottom: 8, width: '100%' }}
                  >
                    ✨ Get Started
                  </button>
                  <button onClick={() => setShowNew(true)} style={{ fontSize: 11, padding: '5px 12px', borderRadius: 7, background: 'none', border: '1px solid var(--color-border)', color: 'var(--color-muted)', cursor: 'pointer', width: '100%' }}>
                    Or create manually
                  </button>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>🎯</div>
                  <p style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 12 }}>No objectives yet. Create one to start tracking your goals.</p>
                  <button onClick={() => setShowNew(true)} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 8, background: 'var(--color-primary)', color: '#fff', border: 'none', cursor: 'pointer' }}>
                    Create Objective
                  </button>
                </>
              )}
            </div>
          )}
          {objectives.map(obj => {
            const isSelected = selectedObj?.id === obj.id;
            const pct = obj.overallProgress;
            return (
              <button
                key={obj.id}
                onClick={() => { setSelected(obj); setShowAiPanel(false); setShowAddKr(false); setConfirmDeleteObj(false); }}
                style={{
                  width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: 10, marginBottom: 4, cursor: 'pointer',
                  border: `1px solid ${isSelected ? obj.color : 'transparent'}`,
                  background: isSelected ? obj.color + '18' : 'transparent',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: obj.color, flexShrink: 0, marginTop: 2 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{obj.title}</p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      {obj.timeframe && <span style={{ fontSize: 10, color: 'var(--color-muted)', background: 'var(--color-border)', padding: '1px 5px', borderRadius: 4 }}>{obj.timeframe}</span>}
                      {obj.renewalDimension && (() => {
                        const dm = RENEWAL_DIMS_GOALS.find(d => d.key === obj.renewalDimension);
                        return dm ? <span style={{ fontSize: 10, color: dm.color }}>{dm.label}</span> : null;
                      })()}
                      <span style={{ fontSize: 10, color: obj.status === 'active' ? progressColor(pct) : 'var(--color-muted)', fontWeight: 600 }}>{pct}%</span>
                    </div>
                    {obj.keyResults.length > 0 && (
                      <div style={{ marginTop: 6, height: 4, borderRadius: 2, background: 'var(--color-border)', overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: obj.color, borderRadius: 2, transition: 'width 0.3s' }} />
                      </div>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right panel — objective detail */}
      <div data-tour="objectives-panel" style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
        {!selectedObj ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12 }}>
            <div style={{ fontSize: 48 }}>🎯</div>
            <p style={{ fontSize: 14, color: 'var(--color-muted)', textAlign: 'center' }}>Select an objective or create a new one to get started.</p>
          </div>
        ) : (
          <div style={{ maxWidth: 680 }}>
            {/* Objective header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 20 }}>
              <div style={{ width: 12, height: 12, borderRadius: '50%', background: selectedObj.color, flexShrink: 0, marginTop: 4 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                {editingObjective === 'title' ? (
                  <input
                    autoFocus
                    value={editVal}
                    onChange={e => setEditVal(e.target.value)}
                    onBlur={() => handleObjectiveField('title', editVal)}
                    onKeyDown={e => { if (e.key === 'Enter') handleObjectiveField('title', editVal); if (e.key === 'Escape') setEditingObjective(null); }}
                    style={{ width: '100%', fontSize: 20, fontWeight: 700, color: 'var(--color-text)', background: 'transparent', border: 'none', borderBottom: '2px solid var(--color-primary)', outline: 'none', paddingBottom: 2 }}
                  />
                ) : (
                  <h1
                    onClick={() => { setEditingObjective('title'); setEditVal(selectedObj.title); }}
                    style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text)', margin: 0, cursor: 'text' }}
                  >
                    {selectedObj.title}
                  </h1>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                  {editingObjective === 'timeframe' ? (
                    <input
                      autoFocus
                      value={editVal}
                      onChange={e => setEditVal(e.target.value)}
                      onBlur={() => handleObjectiveField('timeframe', editVal)}
                      onKeyDown={e => { if (e.key === 'Enter') handleObjectiveField('timeframe', editVal); if (e.key === 'Escape') setEditingObjective(null); }}
                      placeholder="Q2 2026"
                      style={{ fontSize: 12, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--color-primary)', background: 'var(--color-surface)', color: 'var(--color-text)', outline: 'none' }}
                    />
                  ) : (
                    <span
                      onClick={() => { setEditingObjective('timeframe'); setEditVal(selectedObj.timeframe || ''); }}
                      style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: 'var(--color-border)', color: 'var(--color-muted)', cursor: 'pointer' }}
                    >
                      {selectedObj.timeframe || '+ Add timeframe'}
                    </span>
                  )}
                  <select
                    value={selectedObj.status}
                    onChange={e => handleObjectiveField('status', e.target.value)}
                    style={{ fontSize: 11, padding: '2px 6px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-muted)', cursor: 'pointer' }}
                  >
                    <option value="active">Active</option>
                    <option value="completed">Completed</option>
                    <option value="paused">Paused</option>
                  </select>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {PRESET_COLORS.map(c => (
                      <button
                        key={c}
                        onClick={() => handleObjectiveField('color', c)}
                        style={{ width: 14, height: 14, borderRadius: '50%', background: c, border: selectedObj.color === c ? '2px solid var(--color-text)' : '2px solid transparent', cursor: 'pointer', padding: 0 }}
                      />
                    ))}
                  </div>
                  {/* Renewal dimension inline selector */}
                  <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                    {RENEWAL_DIMS_GOALS.map(d => (
                      <button
                        key={d.key}
                        onClick={() => handleObjectiveField('renewalDimension', selectedObj.renewalDimension === d.key ? null : d.key)}
                        title={d.label}
                        style={{ fontSize: 12, padding: '1px 5px', borderRadius: 5, border: `1px solid ${selectedObj.renewalDimension === d.key ? d.color : 'var(--color-border)'}`, background: selectedObj.renewalDimension === d.key ? d.color + '22' : 'transparent', color: selectedObj.renewalDimension === d.key ? d.color : 'var(--color-muted)', cursor: 'pointer' }}
                      >{d.label.split(' ')[0]}</button>
                    ))}
                  </div>
                </div>
                {editingObjective === 'description' ? (
                  <textarea
                    autoFocus
                    value={editVal}
                    onChange={e => setEditVal(e.target.value)}
                    onBlur={() => handleObjectiveField('description', editVal)}
                    onKeyDown={e => { if (e.key === 'Escape') setEditingObjective(null); }}
                    rows={2}
                    style={{ width: '100%', marginTop: 8, fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--color-primary)', background: 'var(--color-bg)', color: 'var(--color-text)', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }}
                  />
                ) : (
                  <p
                    onClick={() => { setEditingObjective('description'); setEditVal(selectedObj.description || ''); }}
                    style={{ marginTop: 8, fontSize: 13, color: selectedObj.description ? 'var(--color-muted)' : 'var(--color-border)', cursor: 'text' }}
                  >
                    {selectedObj.description || 'Click to add description…'}
                  </p>
                )}
              </div>
              {/* Overall progress */}
              <div style={{ flexShrink: 0, textAlign: 'center', minWidth: 60 }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: progressColor(selectedObj.overallProgress) }}>{selectedObj.overallProgress}%</div>
                <div style={{ fontSize: 10, color: 'var(--color-muted)' }}>overall</div>
              </div>
            </div>

            {/* Key Results */}
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-muted)', margin: 0 }}>
                  Key Results ({selectedObj.keyResults.length})
                </p>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => setShowAiPanel(v => !v)}
                    style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: `1px solid ${showAiPanel ? 'var(--color-primary)' : 'var(--color-border)'}`, color: showAiPanel ? 'var(--color-primary)' : 'var(--color-muted)', background: 'none', cursor: 'pointer' }}
                  >
                    {getIcon('wand', { size: 11 })} AI Suggest
                  </button>
                  <button
                    onClick={() => setShowAddKr(v => !v)}
                    style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, background: showAddKr ? 'var(--color-primary)' : 'none', color: showAddKr ? '#fff' : 'var(--color-muted)', border: `1px solid ${showAddKr ? 'var(--color-primary)' : 'var(--color-border)'}`, cursor: 'pointer' }}
                  >
                    {getIcon('plus', { size: 11 })} Add KR
                  </button>
                </div>
              </div>

              {showAiPanel && <AiSuggestPanel objective={selectedObj} onAddKr={handleKrAdded} />}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: showAiPanel ? 12 : 0 }}>
                {selectedObj.keyResults.length === 0 && !showAddKr && (
                  <p style={{ fontSize: 13, color: 'var(--color-muted)', textAlign: 'center', padding: '20px 0' }}>No Key Results yet. Add one below or use AI Suggest.</p>
                )}
                {selectedObj.keyResults.map(kr => (
                  <KeyResultRow
                    key={kr.id}
                    kr={kr}
                    objectiveId={selectedObj.id}
                    accentColor={selectedObj.color}
                    onUpdate={(updated) => {
                      handleKrUpdate(updated);
                      // Refresh to recalculate overallProgress
                      loadObjectives();
                    }}
                    onDelete={handleKrDelete}
                  />
                ))}
                {showAddKr && (
                  <AddKrForm
                    objectiveId={selectedObj.id}
                    onAdded={(kr) => { handleKrAdded(kr); loadObjectives(); }}
                    onCancel={() => setShowAddKr(false)}
                  />
                )}
              </div>
            </div>

            {/* Milestone Timeline */}
            <div data-tour="milestone-timeline">
              <MilestoneTimeline milestones={selectedObj.milestones || []} />
            </div>

            {/* Delete objective */}
            <div style={{ marginTop: 32, paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
              {confirmDeleteObj ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>Delete this objective and all its Key Results?</span>
                  <button onClick={handleDeleteObjective} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, background: '#ef4444', color: '#fff', border: 'none', cursor: 'pointer' }}>Delete</button>
                  <button onClick={() => setConfirmDeleteObj(false)} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'none', color: 'var(--color-muted)', cursor: 'pointer' }}>Cancel</button>
                </div>
              ) : (
                <button onClick={() => setConfirmDeleteObj(true)} style={{ fontSize: 12, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                  Delete objective…
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      </div>
      {showNew && <NewObjectiveModal onClose={() => setShowNew(false)} onCreated={(obj) => { setObjectives(prev => [obj, ...prev]); setSelected(obj); setShowNew(false); }} />}
    </div>
  );
}
