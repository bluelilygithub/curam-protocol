import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';

const PRESET_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#22c55e', '#3b82f6', '#ef4444'];

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

function NewObjectiveModal({ onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [timeframe, setTimeframe] = useState('');
  const [color, setColor] = useState('#6366f1');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      const obj = await api.post('/api/goals', { title: title.trim(), description: description.trim() || null, timeframe: timeframe.trim() || null, color }).then(r => r.json());
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

export default function GoalsPage() {
  const getIcon = useIcon();
  const [objectives, setObjectives] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [showAddKr, setShowAddKr] = useState(false);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [editingObjective, setEditingObjective] = useState(null); // field being edited
  const [editVal, setEditVal] = useState('');
  const [confirmDeleteObj, setConfirmDeleteObj] = useState(false);

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

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Left panel — objective list */}
      <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {getIcon('target', { size: 14, style: { color: 'var(--color-primary)' } })}
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>Goals</span>
          </div>
          <button
            onClick={() => setShowNew(true)}
            title="New Objective"
            style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '4px 10px', borderRadius: 6, background: 'var(--color-primary)', color: '#fff', border: 'none', cursor: 'pointer' }}
          >
            {getIcon('plus', { size: 12 })} New
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
          {loading && <p style={{ fontSize: 12, color: 'var(--color-muted)', textAlign: 'center', padding: 16 }}>Loading…</p>}
          {!loading && objectives.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px 16px' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🎯</div>
              <p style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 12 }}>No objectives yet. Create one to start tracking your goals.</p>
              <button onClick={() => setShowNew(true)} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 8, background: 'var(--color-primary)', color: '#fff', border: 'none', cursor: 'pointer' }}>
                Create Objective
              </button>
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {obj.timeframe && <span style={{ fontSize: 10, color: 'var(--color-muted)', background: 'var(--color-border)', padding: '1px 5px', borderRadius: 4 }}>{obj.timeframe}</span>}
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
      <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
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

      {showNew && <NewObjectiveModal onClose={() => setShowNew(false)} onCreated={(obj) => { setObjectives(prev => [obj, ...prev]); setSelected(obj); setShowNew(false); }} />}
    </div>
  );
}
