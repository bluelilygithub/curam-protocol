import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import useToastStore from '../../store/toastStore';
import { ACADEMIC_LEVELS, QUESTION_TYPE_OPTIONS } from '../../utils/quizConstants';
import { useQuizBuild } from './quizBuildContext';

const EMPTY_FORM = {
  title: '',
  category: '',
  topic: '',
  level: '1st year',
  questionCount: 10,
  questionTypes: ['true_false', 'multiple_choice', 'short_answer'],
  passmark: 80,
  tags: '',
};

export default function QuizLibrary() {
  const getIcon = useIcon();
  const navigate = useNavigate();
  const { buildState, startQuizBuild, endQuizBuild } = useQuizBuild();
  const generating = !!buildState;
  const [rows, setRows] = useState([]);
  const [categories, setCategories] = useState([]);
  const [load, setLoad] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [deleteId, setDeleteId] = useState(null);
  const [draggingId, setDraggingId] = useState(null);

  const refresh = useCallback(async () => {
    setLoad(true);
    try {
      const [listRes, catRes] = await Promise.all([
        api.get('/api/student-quizzes'),
        api.get('/api/student-quizzes/categories'),
      ]);
      const list = await listRes.json();
      const cats = await catRes.json();
      setRows(Array.isArray(list) ? list : []);
      setCategories(cats.categories || []);
    } catch {
      setRows([]);
    } finally {
      setLoad(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const persistOrder = useCallback(async (ordered) => {
    try {
      const res = await api.post('/api/student-quizzes/reorder', { ids: ordered.map((r) => r.id) });
      if (!res.ok) throw new Error('reorder failed');
    } catch {
      useToastStore.getState().addToast('Could not save order', 'error');
      refresh();
    }
  }, [refresh]);

  const onDragStart = useCallback((e, id) => {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(id));
  }, []);

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((e, targetId) => {
    e.preventDefault();
    const fromId = Number(e.dataTransfer.getData('text/plain'));
    setDraggingId(null);
    if (!Number.isFinite(fromId) || fromId <= 0 || fromId === targetId) return;
    setRows((prev) => {
      const fromIx = prev.findIndex((r) => r.id === fromId);
      const toIx = prev.findIndex((r) => r.id === targetId);
      if (fromIx === -1 || toIx === -1) return prev;
      const next = [...prev];
      const [removed] = next.splice(fromIx, 1);
      next.splice(toIx, 0, removed);
      persistOrder(next);
      return next;
    });
  }, [persistOrder]);

  const onDragEnd = useCallback(() => {
    setDraggingId(null);
  }, []);

  const toggleType = (value) => {
    setForm((f) => {
      const has = f.questionTypes.includes(value);
      const next = has ? f.questionTypes.filter((t) => t !== value) : [...f.questionTypes, value];
      return { ...f, questionTypes: next.length ? next : [value] };
    });
  };

  const handleCreate = (e) => {
    e.preventDefault();
    if (!form.title.trim() || !form.topic.trim() || generating) return;
    if (!form.questionTypes.length) {
      setError('Select at least one question type.');
      return;
    }
    const payload = { ...form };
    const title = form.title.trim();
    setError('');
    startQuizBuild(title);

    (async () => {
      try {
        const res = await api.post('/api/student-quizzes', payload);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create quiz');
        useToastStore.getState().addToast('Quiz created', 'success');
        setForm(EMPTY_FORM);
        setShowForm(false);
        await refresh();
        navigate(`/student/quiz/take/${data.id}`);
      } catch (err) {
        setError(err.message || 'Generation failed');
      } finally {
        endQuizBuild();
      }
    })();
  };

  const handleDelete = async (id) => {
    try {
      const res = await api.delete(`/api/student-quizzes/${id}`);
      if (!res.ok) throw new Error('Delete failed');
      setDeleteId(null);
      refresh();
    } catch {
      useToastStore.getState().addToast('Could not delete quiz', 'error');
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Quiz Library</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
            Create quizzes with AI-generated question pools. Drag cards to reorder.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setShowForm((v) => !v); setError(''); }}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white hover:opacity-80 transition-opacity"
          style={{ background: 'var(--color-primary)' }}
        >
          {showForm ? 'Cancel' : 'New quiz'}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="rounded-2xl border p-4 space-y-4"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
        >
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Title</label>
            <input
              required
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
            />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Category</label>
            <input
              list="quiz-categories"
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
            />
            <datalist id="quiz-categories">
              {categories.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Topic description</label>
            <textarea
              required
              rows={3}
              value={form.topic}
              onChange={(e) => setForm((f) => ({ ...f, topic: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none resize-y"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Academic level</label>
              <select
                value={form.level}
                onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
              >
                {ACADEMIC_LEVELS.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Questions per attempt</label>
              <input
                type="number"
                min={1}
                max={30}
                value={form.questionCount}
                onChange={(e) => setForm((f) => ({ ...f, questionCount: Number(e.target.value) }))}
                className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs mb-2" style={{ color: 'var(--color-muted)' }}>Question types</label>
            <div className="flex flex-wrap gap-3">
              {QUESTION_TYPE_OPTIONS.map((opt) => (
                <label key={opt.value} className="text-xs flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                  <input
                    type="checkbox"
                    checked={form.questionTypes.includes(opt.value)}
                    onChange={() => toggleType(opt.value)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Pass mark %</label>
              <input
                type="number"
                min={0}
                max={100}
                value={form.passmark}
                onChange={(e) => setForm((f) => ({ ...f, passmark: Number(e.target.value) }))}
                className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
              />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Tags (optional)</label>
              <input
                value={form.tags}
                onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                placeholder="comma-separated"
                className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
              />
            </div>
          </div>
          {error && <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>}
          <button
            type="submit"
            disabled={generating}
            className="w-full py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-50 hover:opacity-80 transition-opacity"
            style={{ background: 'var(--color-primary)' }}
          >
            {generating ? 'Generating…' : 'Save & generate questions'}
          </button>
        </form>
      )}

      {load ? (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-center py-8" style={{ color: 'var(--color-muted)' }}>
          No quizzes yet. Create your first quiz above.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((q) => (
            <li
              key={q.id}
              draggable
              onDragStart={(e) => onDragStart(e, q.id)}
              onDragOver={onDragOver}
              onDrop={(e) => onDrop(e, q.id)}
              onDragEnd={onDragEnd}
              className="rounded-2xl border px-2 py-2 sm:px-3 sm:py-3 flex flex-wrap items-center gap-2 sm:gap-3 transition-opacity"
              style={{
                background: 'var(--color-surface)',
                borderColor: 'var(--color-border)',
                opacity: draggingId === q.id ? 0.55 : 1,
                cursor: 'grab',
              }}
            >
              <span
                className="flex-shrink-0 px-1 cursor-grab active:cursor-grabbing"
                style={{ color: 'var(--color-muted)' }}
                title="Drag to reorder"
                aria-hidden
              >
                {getIcon('grip-vertical', { size: 16 })}
              </span>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{q.title}</h3>
                {q.category ? (
                  <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--color-primary)' }}>{q.category}</p>
                ) : (
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>Uncategorised</p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 w-full sm:w-auto justify-end">
                <Link
                  to={`/student/quiz/take/${q.id}`}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-white hover:opacity-80 transition-opacity"
                  style={{ background: 'var(--color-primary)' }}
                >
                  Take quiz
                </Link>
                {deleteId === q.id ? (
                  <>
                    <button
                      type="button"
                      onClick={() => handleDelete(q.id)}
                      className="px-3 py-1.5 rounded-lg text-xs text-white hover:opacity-80 transition-opacity"
                      style={{ background: '#ef4444' }}
                    >
                      Confirm delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteId(null)}
                      className="px-3 py-1.5 rounded-lg text-xs border hover:opacity-70 transition-opacity"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setDeleteId(q.id)}
                    className="px-3 py-1.5 rounded-lg text-xs border hover:opacity-70 transition-opacity"
                    style={{ borderColor: 'var(--color-border)', color: '#ef4444' }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
