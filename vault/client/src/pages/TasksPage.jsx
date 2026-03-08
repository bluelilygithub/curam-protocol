import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import TasksCalendar from '../components/TasksCalendar';
import WeeklyReview from '../components/tasks/WeeklyReviewModal';
import TaskImport from '../components/tasks/TaskImportModal';
import FocusMode from '../components/tasks/FocusMode';
import TaskTemplatesPanel from '../components/tasks/TaskTemplatesPanel';
import TaskStatsBar from '../components/tasks/TaskStatsBar';
import TaskFilters from '../components/tasks/TaskFilters';
import { parseNaturalDate, formatDateForInput, toISOForAPI } from '../utils/parseDate';

const PRIORITY_COLOR = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' };
const PRIORITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };

function dueInfo(dateStr) {
  if (!dateStr) return null;
  const hasTime = dateStr.includes('T');
  const datePart = hasTime ? dateStr.slice(0, 10) : dateStr;
  const timePart = hasTime ? dateStr.slice(11, 16) : null;
  const d = new Date(datePart + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((d - today) / 86400000);
  const timeStr = timePart ? ` ${timePart}` : '';
  if (diff < 0) return { label: `Overdue${timeStr}`, color: '#ef4444' };
  if (diff === 0) return { label: `Due today${timeStr}`, color: '#f59e0b' };
  if (diff === 1) return { label: `Tomorrow${timeStr}`, color: 'var(--color-muted)' };
  return { label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + timeStr, color: 'var(--color-muted)' };
}

function relTime(dateStr) {
  const d = new Date(dateStr);
  const diff = Math.round((Date.now() - d) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

function isStale(task) {
  if (task.status !== 'todo' || !task.createdAt) return false;
  return (Date.now() - new Date(task.createdAt)) / 86400000 > 7;
}

function formatEffort(mins) {
  if (!mins) return '—';
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

function parseEffortInput(str) {
  if (!str || !str.trim()) return null;
  const s = str.trim().toLowerCase();
  if (/^\d+d$/.test(s)) return parseInt(s) * 480;
  if (/^\d*\.?\d+h$/.test(s)) return Math.round(parseFloat(s) * 60);
  if (/^\d+m$/.test(s)) return parseInt(s);
  if (/^\d+$/.test(s)) return parseInt(s);
  return null;
}

const EFFORT_PRESETS = [
  { label: '15m', val: 15 }, { label: '30m', val: 30 }, { label: '1h', val: 60 },
  { label: '2h', val: 120 }, { label: '4h', val: 240 }, { label: '1d', val: 480 }, { label: '2d', val: 960 },
];

const EMPTY_FORM = {
  title: '', notes: '', status: 'todo', priority: 'medium', category: '', tags: '',
  dueDate: '', dueTime: '', dueDateRaw: '', projectId: '', parentTaskId: '', recurrence: 'none',
  estimatedMinutes: null, keyResultId: null,
};

const TASK_SHORTCUTS = [
  { keys: ['n'], desc: 'New task' },
  { keys: ['w'], desc: 'Open Weekly Review' },
  { keys: ['Esc'], desc: 'Close / cancel / deselect' },
  { keys: ['/'], desc: 'Focus search' },
  { keys: ['f'], desc: 'Cycle quick filters' },
  { keys: ['1'], desc: 'Filter: To Do' },
  { keys: ['2'], desc: 'Filter: In Progress' },
  { keys: ['3'], desc: 'Filter: Done' },
  { keys: ['b'], desc: 'Cycle view: List → Board → Calendar' },
  { keys: ['Shift+F'], desc: 'Focus mode on expanded task' },
  { keys: ['?'], desc: 'Show keyboard shortcuts' },
];

function TaskShortcutsModal({ onClose }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Tasks Keyboard Shortcuts</h2>
          <button onClick={onClose} className="hover:opacity-60 transition-opacity" style={{ color: 'var(--color-muted)' }}>✕</button>
        </div>
        <div className="px-5 py-4 space-y-3">
          {TASK_SHORTCUTS.map((s, i) => (
            <div key={i} className="flex items-center justify-between">
              <span className="text-sm" style={{ color: 'var(--color-text)' }}>{s.desc}</span>
              <div className="flex items-center gap-1">
                {s.keys.map((k, j) => (
                  <kbd key={j} className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-xs font-mono border"
                    style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', minWidth: '24px' }}>{k}</kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function TasksPage() {
  const getIcon = useIcon();
  const navigate = useNavigate();
  const searchInputRef = useRef(null);

  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [subtasksCache, setSubtasksCache] = useState({});
  const [commentsCache, setCommentsCache] = useState({});
  const [expandedId, setExpandedId] = useState(null);
  const [newSubtask, setNewSubtask] = useState({});
  const [newComment, setNewComment] = useState({});
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [completedOpen, setCompletedOpen] = useState(false);
  const [newlyAddedIds, setNewlyAddedIds] = useState(new Set());

  // View mode: 'list' or 'board'
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('tasksViewMode') || 'list');

  // Filters
  const [quickFilter, setQuickFilter] = useState('all');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterProject, setFilterProject] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('due');

  // Stats chart
  const [showChart, setShowChart] = useState(false);

  // AI panel
  const [showAI, setShowAI] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiProjectId, setAiProjectId] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiMessage, setAiMessage] = useState('');

  // Form
  const [showForm, setShowForm] = useState(false);
  const [editTask, setEditTask] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [goalsForForm, setGoalsForForm] = useState([]);
  const [formObjectiveId, setFormObjectiveId] = useState('');

  // Templates panel
  const [showTemplates, setShowTemplates] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);

  // Note tooltip
  const [noteTooltip, setNoteTooltip] = useState(null); // { notes, x, y }
  const showNoteTooltip = (e, notes) => {
    if (!notes) return;
    const r = e.currentTarget.getBoundingClientRect();
    setNoteTooltip({ notes, x: Math.min(r.left, window.innerWidth - 288), y: r.bottom + 6 });
  };
  const hideNoteTooltip = () => setNoteTooltip(null);

  // Drag state
  const [dragOverId, setDragOverId] = useState(null);
  const [dragOverColumn, setDragOverColumn] = useState(null);
  const [dragging, setDragging] = useState(false);

  // Bulk select state
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [bulkCategoryInput, setBulkCategoryInput] = useState('');

  // Keyboard shortcuts modal
  const [showShortcuts, setShowShortcuts] = useState(false);

  // In-page help panel
  const [showHelp, setShowHelp] = useState(false);

  // AI subtask generation state
  const [aiSubtaskTaskId, setAiSubtaskTaskId] = useState(null);
  const [aiSubtaskPrompt, setAiSubtaskPrompt] = useState('');
  const [aiSubtaskLoading, setAiSubtaskLoading] = useState(false);

  // Feature 6: Weekly Review
  const [showWeeklyReview, setShowWeeklyReview] = useState(false);

  // Feature 7: CSV Import
  const [showImport, setShowImport] = useState(false);

  // Feature 8: Share popovers — Map<taskId, { url, copied }>
  const [sharePopovers, setSharePopovers] = useState({});
  const [shareLoading, setShareLoading] = useState(new Set());

  // Focus mode
  const [focusTask, setFocusTask] = useState(null);

  // Time tracking
  const [activeTimer, setActiveTimer] = useState(null); // { taskId, task }
  const [elapsed, setElapsed] = useState(0); // seconds since timer started
  const elapsedRef = useRef(0);
  const timerIntervalRef = useRef(null);

  // Dependencies
  const [dependenciesCache, setDependenciesCache] = useState({});
  const [depSearch, setDepSearch] = useState({}); // { [taskId]: queryString }
  const [depSearchResults, setDepSearchResults] = useState({}); // { [taskId]: tasks[] }
  const [blockerConfirm, setBlockerConfirm] = useState(null); // taskId that showed confirm on done

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/tasks');
      setTasks(await res.json());
    } catch { setTasks([]); } finally { setLoading(false); }
  }, []);

  // Timer tick
  useEffect(() => {
    if (activeTimer) {
      timerIntervalRef.current = setInterval(() => {
        elapsedRef.current += 1;
        setElapsed(elapsedRef.current);
      }, 1000);
    } else {
      clearInterval(timerIntervalRef.current);
      elapsedRef.current = 0;
      setElapsed(0);
    }
    return () => clearInterval(timerIntervalRef.current);
  }, [activeTimer]);

  const fetchTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    try {
      const res = await api.get('/api/task-templates');
      setTemplates(await res.json());
    } catch { setTemplates([]); } finally { setTemplatesLoading(false); }
  }, []);

  useEffect(() => {
    fetchTasks();
    api.get('/api/projects').then(r => r.json()).then(setProjects).catch(() => {});
  }, [fetchTasks]);

  useEffect(() => {
    if (showTemplates) fetchTemplates();
  }, [showTemplates, fetchTemplates]);

  // Refresh when a task is created from Quick Capture on another page
  useEffect(() => {
    const handler = () => fetchTasks();
    document.addEventListener('vault:task-created', handler);
    return () => document.removeEventListener('vault:task-created', handler);
  }, [fetchTasks]);

  const fetchSubtasks = async (taskId) => {
    if (subtasksCache[taskId]) return;
    try {
      const res = await api.get(`/api/tasks/${taskId}/subtasks`);
      const subs = await res.json();
      setSubtasksCache(prev => ({ ...prev, [taskId]: subs }));
    } catch { setSubtasksCache(prev => ({ ...prev, [taskId]: [] })); }
  };

  const fetchComments = async (taskId) => {
    if (commentsCache[taskId]) return;
    try {
      const res = await api.get(`/api/tasks/${taskId}/comments`);
      const data = await res.json();
      setCommentsCache(prev => ({ ...prev, [taskId]: data }));
    } catch { setCommentsCache(prev => ({ ...prev, [taskId]: [] })); }
  };

  const handleExpand = (id) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    fetchSubtasks(id);
    fetchComments(id);
    fetchDependencies(id);
  };

  const handleToggleStatus = async (task) => {
    const next = task.status === 'done' ? 'todo' : 'done';
    const updated = await api.put(`/api/tasks/${task.id}`, { status: next }).then(r => r.json());
    setTasks(prev => prev.map(t => t.id === task.id ? updated : t));
    if (next === 'done') setCompletedOpen(true);
    // Refresh comments if expanded (activity log was added)
    if (expandedId === task.id) {
      setCommentsCache(prev => ({ ...prev, [task.id]: undefined }));
      fetchComments(task.id);
    }
  };

  const handleToggleSubtask = async (taskId, sub) => {
    const next = sub.status === 'done' ? 'todo' : 'done';
    const updated = await api.put(`/api/tasks/${sub.id}`, { status: next }).then(r => r.json());
    setSubtasksCache(prev => ({
      ...prev,
      [taskId]: (prev[taskId] || []).map(s => s.id === sub.id ? updated : s),
    }));
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      const subs = (subtasksCache[taskId] || []).map(s => s.id === sub.id ? updated : s);
      return { ...t, subtaskDone: subs.filter(s => s.status === 'done').length };
    }));
  };

  const handleAddSubtask = async (taskId) => {
    const title = (newSubtask[taskId] || '').trim();
    if (!title) return;
    const sub = await api.post(`/api/tasks/${taskId}/subtasks`, { title }).then(r => r.json());
    setSubtasksCache(prev => ({ ...prev, [taskId]: [...(prev[taskId] || []), sub] }));
    setNewSubtask(prev => ({ ...prev, [taskId]: '' }));
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, subtaskCount: t.subtaskCount + 1 } : t));
  };

  const handleAddComment = async (taskId) => {
    const content = (newComment[taskId] || '').trim();
    if (!content) return;
    const comment = await api.post(`/api/tasks/${taskId}/comments`, { content }).then(r => r.json());
    setCommentsCache(prev => ({ ...prev, [taskId]: [...(prev[taskId] || []), comment] }));
    setNewComment(prev => ({ ...prev, [taskId]: '' }));
  };

  const handleDeleteComment = async (taskId, commentId) => {
    await api.delete(`/api/tasks/comments/${commentId}`);
    setCommentsCache(prev => ({ ...prev, [taskId]: (prev[taskId] || []).filter(c => c.id !== commentId) }));
  };

  const handleDelete = async (id) => {
    await api.delete(`/api/tasks/${id}`);
    setTasks(prev => prev.filter(t => t.id !== id));
    setConfirmDeleteId(null);
    if (expandedId === id) setExpandedId(null);
  };

  const handleReschedule = async (taskId, newDateKey) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    // If full datetime provided (from time grid), use as-is; otherwise preserve existing time
    const newDueDate = newDateKey.includes('T')
      ? newDateKey
      : newDateKey + (task.dueDate?.includes('T') ? task.dueDate.slice(10) : '');
    const updated = await api.put(`/api/tasks/${taskId}`, { dueDate: newDueDate }).then(r => r.json());
    setTasks(prev => prev.map(t => t.id === taskId ? updated : t));
  };

  const handleDuplicate = async (task) => {
    const res = await api.post(`/api/tasks/${task.id}/duplicate`);
    const dup = await res.json();
    setTasks(prev => [dup, ...prev]);
    // Highlight new task briefly
    setNewlyAddedIds(prev => new Set([...prev, dup.id]));
    setTimeout(() => setNewlyAddedIds(prev => { const n = new Set(prev); n.delete(dup.id); return n; }), 2000);
  };

  // Feature 8: Share handlers
  const handleShare = async (task) => {
    if (sharePopovers[task.id]) {
      setSharePopovers(prev => { const n = { ...prev }; delete n[task.id]; return n; });
      return;
    }
    if (task.shareToken) {
      const appUrl = window.location.origin;
      setSharePopovers(prev => ({ ...prev, [task.id]: { url: `${appUrl}/shared/task/${task.shareToken}`, copied: false } }));
      return;
    }
    setShareLoading(prev => new Set([...prev, task.id]));
    try {
      const { shareUrl, token } = await api.post(`/api/tasks/${task.id}/share`, {}).then(r => r.json());
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, shareToken: token } : t));
      setSharePopovers(prev => ({ ...prev, [task.id]: { url: shareUrl, copied: false } }));
    } catch (err) { console.error(err); }
    finally { setShareLoading(prev => { const n = new Set(prev); n.delete(task.id); return n; }); }
  };

  const handleRevoke = async (task) => {
    try {
      await api.delete(`/api/tasks/${task.id}/share`);
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, shareToken: null } : t));
      setSharePopovers(prev => { const n = { ...prev }; delete n[task.id]; return n; });
    } catch (err) { console.error(err); }
  };

  const handleCopyShareUrl = (taskId, url) => {
    navigator.clipboard.writeText(url).then(() => {
      setSharePopovers(prev => ({ ...prev, [taskId]: { ...prev[taskId], copied: true } }));
      setTimeout(() => setSharePopovers(prev => ({ ...prev, [taskId]: { ...prev[taskId], copied: false } })), 2000);
    });
  };

  // Time tracking handlers
  const handleStartTimer = async (task) => {
    if (activeTimer) await handleStopTimer();
    elapsedRef.current = 0;
    setElapsed(0);
    setActiveTimer({ taskId: task.id, task });
  };

  const handleStopTimer = async () => {
    if (!activeTimer) return;
    clearInterval(timerIntervalRef.current);
    const elapsedMins = Math.floor(elapsedRef.current / 60);
    if (elapsedMins > 0) {
      const task = tasks.find(t => t.id === activeTimer.taskId);
      if (task) {
        const newTotal = (task.timeSpentMinutes || 0) + elapsedMins;
        const updated = await api.put(`/api/tasks/${task.id}`, { timeSpentMinutes: newTotal }).then(r => r.json());
        setTasks(prev => prev.map(t => t.id === task.id ? updated : t));
      }
    }
    setActiveTimer(null);
    elapsedRef.current = 0;
    setElapsed(0);
  };

  // Effort update (from calendar resize)
  const handleUpdateEffort = async (taskId, minutes) => {
    try {
      const updated = await api.put(`/api/tasks/${taskId}`, { estimatedMinutes: minutes }).then(r => r.json());
      setTasks(prev => prev.map(t => t.id === taskId ? updated : t));
    } catch (err) { console.error(err); }
  };

  // Dependencies
  const fetchDependencies = async (taskId) => {
    if (dependenciesCache[taskId]) return;
    try {
      const res = await api.get(`/api/tasks/${taskId}/dependencies`);
      const data = await res.json();
      setDependenciesCache(prev => ({ ...prev, [taskId]: data }));
    } catch { setDependenciesCache(prev => ({ ...prev, [taskId]: { blockers: [], dependents: [] } })); }
  };

  const handleAddDependency = async (taskId, blockedByTaskId) => {
    try {
      await api.post(`/api/tasks/${taskId}/dependencies`, { blockedByTaskId });
      // Refresh dependencies for this task
      setDependenciesCache(prev => ({ ...prev, [taskId]: undefined }));
      fetchDependencies(taskId);
      // Update blockerCount locally
      const blocker = tasks.find(t => t.id === blockedByTaskId);
      if (blocker && blocker.status !== 'done') {
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, blockerCount: (t.blockerCount || 0) + 1 } : t));
      }
    } catch (err) { console.error(err); }
  };

  const handleRemoveDependency = async (taskId, blockedByTaskId) => {
    try {
      await api.delete(`/api/tasks/${taskId}/dependencies/${blockedByTaskId}`);
      setDependenciesCache(prev => ({
        ...prev,
        [taskId]: { ...(prev[taskId] || {}), blockers: (prev[taskId]?.blockers || []).filter(b => b.id !== blockedByTaskId) },
      }));
      const remaining = (dependenciesCache[taskId]?.blockers || []).filter(b => b.id !== blockedByTaskId && b.status !== 'done');
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, blockerCount: remaining.length } : t));
    } catch (err) { console.error(err); }
  };

  const loadGoalsForForm = () => {
    api.get('/api/goals').then(r => r.json()).then(setGoalsForForm).catch(() => {});
  };

  const openNew = (defaultStatus = 'todo', defaultDate = '') => {
    const now = new Date();
    const todayDate = defaultDate ? defaultDate.slice(0, 10) : now.toISOString().slice(0, 10);
    const currentTime = defaultDate?.includes('T') ? defaultDate.slice(11, 16) : now.toTimeString().slice(0, 5);
    const rawStr = defaultDate ? formatDateForInput(new Date(defaultDate.includes('T') ? defaultDate : defaultDate + 'T09:00')) : '';
    setEditTask(null);
    setFormObjectiveId('');
    setForm({ ...EMPTY_FORM, dueDate: todayDate, dueTime: currentTime, dueDateRaw: rawStr, status: defaultStatus });
    setShowForm(true);
    loadGoalsForForm();
  };

  const openEdit = (task) => {
    setEditTask(task);
    const existing = task.dueDate || '';
    const [datePart, timePart] = existing.includes('T') ? existing.split('T') : [existing, ''];
    const rawStr = datePart ? formatDateForInput(new Date(datePart + (timePart ? 'T' + timePart : 'T09:00'))) : '';
    setForm({
      title: task.title || '',
      notes: task.notes || '',
      status: task.status || 'todo',
      priority: task.priority || 'medium',
      category: task.category || '',
      tags: (task.tags || []).join(', '),
      dueDate: datePart,
      dueTime: timePart ? timePart.slice(0, 5) : '',
      dueDateRaw: rawStr,
      projectId: task.projectId ? String(task.projectId) : '',
      parentTaskId: task.parentTaskId ? String(task.parentTaskId) : '',
      recurrence: task.recurrence || 'none',
      estimatedMinutes: task.estimatedMinutes || null,
      keyResultId: task.keyResultId || null,
    });
    setShowForm(true);
    loadGoalsForForm();
    // Pre-select the objective for the linked KR
    if (task.keyResultId) {
      api.get('/api/goals').then(r => r.json()).then(data => {
        const obj = data.find(o => o.keyResults?.some(kr => kr.id === task.keyResultId));
        if (obj) setFormObjectiveId(String(obj.id));
      }).catch(() => {});
    } else {
      setFormObjectiveId('');
    }
  };

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        notes: form.notes.trim() || null,
        status: form.status,
        priority: form.priority,
        category: form.category.trim() || null,
        tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
        dueDate: form.dueDate ? (form.dueTime ? `${form.dueDate}T${form.dueTime}` : form.dueDate) : null,
        projectId: form.projectId ? Number(form.projectId) : null,
        parentTaskId: form.parentTaskId ? Number(form.parentTaskId) : null,
        recurrence: form.recurrence,
        estimatedMinutes: form.estimatedMinutes || null,
        keyResultId: form.keyResultId || null,
      };
      if (editTask) {
        const updated = await api.put(`/api/tasks/${editTask.id}`, payload).then(r => r.json());
        setTasks(prev => prev.map(t => t.id === editTask.id ? updated : t));
        // Refresh activity log
        setCommentsCache(prev => ({ ...prev, [editTask.id]: undefined }));
        if (expandedId === editTask.id) fetchComments(editTask.id);
      } else {
        const created = await api.post('/api/tasks', payload).then(r => r.json());
        setTasks(prev => [created, ...prev]);
      }
      setShowForm(false);
    } catch (err) { console.error(err); }
    finally { setSaving(false); }
  };

  const handleSaveAsTemplate = async () => {
    if (!form.title.trim()) return;
    setSavingTemplate(true);
    try {
      const subs = editTask ? (subtasksCache[editTask.id] || []).map(s => ({ title: s.title })) : [];
      await api.post('/api/task-templates', {
        name: form.title.trim(),
        description: form.notes.trim() || null,
        category: form.category.trim() || null,
        priority: form.priority,
        recurrence: form.recurrence,
        tags: form.tags,
        subtasks: subs,
      });
    } catch (err) { console.error(err); }
    finally { setSavingTemplate(false); }
  };

  const handleAiGenerate = async () => {
    if (!aiPrompt.trim()) return;
    setAiGenerating(true);
    setAiMessage('');
    try {
      const created = await api.post('/api/tasks/ai-generate', { prompt: aiPrompt.trim(), projectId: aiProjectId ? Number(aiProjectId) : null }).then(r => r.json());
      setTasks(prev => [...created, ...prev]);
      setAiMessage(`✓ Created ${created.length} task${created.length !== 1 ? 's' : ''}`);
      setAiPrompt('');
    } catch { setAiMessage('Failed to generate tasks'); }
    finally { setAiGenerating(false); }
  };

  const handleAiSubtasks = async (task) => {
    if (!aiSubtaskPrompt.trim()) return;
    setAiSubtaskLoading(true);
    try {
      const created = await api.post('/api/tasks/ai-generate', {
        prompt: aiSubtaskPrompt.trim(),
        parentTaskId: task.id,
      }).then(r => r.json());
      setSubtasksCache(prev => ({
        ...prev,
        [task.id]: [...(prev[task.id] || []), ...created],
      }));
      setTasks(prev => prev.map(t => t.id === task.id
        ? { ...t, subtaskCount: t.subtaskCount + created.length }
        : t
      ));
      setAiSubtaskTaskId(null);
      setAiSubtaskPrompt('');
    } catch (err) { console.error(err); }
    finally { setAiSubtaskLoading(false); }
  };

  const handleApplyTemplate = async (templateId) => {
    const res = await api.post(`/api/task-templates/${templateId}/apply`, {});
    const { taskId } = await res.json();
    await fetchTasks();
    setNewlyAddedIds(prev => new Set([...prev, taskId]));
    setTimeout(() => setNewlyAddedIds(prev => { const n = new Set(prev); n.delete(taskId); return n; }), 2000);
  };

  const handleDeleteTemplate = async (id) => {
    await api.delete(`/api/task-templates/${id}`);
    setTemplates(prev => prev.filter(t => t.id !== id));
  };

  // Drag handlers (list view)
  const handleDragStart = (e, task) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('taskId', String(task.id));
    setDragging(true);
  };
  const handleDragOver = (e, taskId) => {
    e.preventDefault();
    setDragOverId(taskId);
  };
  const handleDrop = async (e, targetTask) => {
    e.preventDefault();
    setDragOverId(null);
    setDragging(false);
    const draggedId = Number(e.dataTransfer.getData('taskId'));
    if (!draggedId || draggedId === targetTask.id) return;
    const group = incomplete.filter(t => (t.category || 'Uncategorised') === (targetTask.category || 'Uncategorised'));
    const from = group.findIndex(t => t.id === draggedId);
    const to = group.findIndex(t => t.id === targetTask.id);
    if (from === -1 || to === -1) return;
    const reordered = [...group];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    const items = reordered.map((t, i) => ({ id: t.id, order: i }));
    setTasks(prev => {
      const updated = [...prev];
      items.forEach(({ id, order }) => {
        const idx = updated.findIndex(t => t.id === id);
        if (idx !== -1) updated[idx] = { ...updated[idx], order };
      });
      return updated.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    });
    await api.put('/api/tasks/reorder', { items }).catch(console.error);
  };
  const handleDragEnd = () => { setDragging(false); setDragOverId(null); setDragOverColumn(null); };

  // Kanban drag handlers
  const handleKanbanDragOver = (e, status) => {
    e.preventDefault();
    setDragOverColumn(status);
  };
  // Drop on the column background — only fires when not dropped on a card (card handler stops propagation)
  const handleKanbanDrop = async (e, targetStatus) => {
    e.preventDefault();
    setDragOverColumn(null);
    setDragging(false);
    const draggedId = Number(e.dataTransfer.getData('taskId'));
    if (!draggedId) return;
    const task = tasks.find(t => t.id === draggedId);
    if (!task || task.status === targetStatus) return;
    const updated = await api.put(`/api/tasks/${draggedId}`, { status: targetStatus }).then(r => r.json());
    setTasks(prev => prev.map(t => t.id === draggedId ? updated : t));
  };
  // Drop on a specific card — handles both within-column reorder and cross-column move
  const handleKanbanCardDrop = async (e, targetTask) => {
    e.preventDefault();
    e.stopPropagation(); // prevent column handler from also firing
    setDragOverId(null);
    setDragOverColumn(null);
    setDragging(false);
    const draggedId = Number(e.dataTransfer.getData('taskId'));
    if (!draggedId || draggedId === targetTask.id) return;
    const draggedTask = tasks.find(t => t.id === draggedId);
    if (!draggedTask) return;
    if (draggedTask.status === targetTask.status) {
      // Same column — reorder
      const column = filtered
        .filter(t => t.status === targetTask.status)
        .sort((a, b) => ((a.order ?? 0) - (b.order ?? 0)) || (a.id - b.id));
      const from = column.findIndex(t => t.id === draggedId);
      const to = column.findIndex(t => t.id === targetTask.id);
      if (from === -1 || to === -1) return;
      const reordered = [...column];
      const [moved] = reordered.splice(from, 1);
      reordered.splice(to, 0, moved);
      const items = reordered.map((t, i) => ({ id: t.id, order: i }));
      setTasks(prev => {
        const updated = [...prev];
        items.forEach(({ id, order }) => {
          const idx = updated.findIndex(t => t.id === id);
          if (idx !== -1) updated[idx] = { ...updated[idx], order };
        });
        return updated;
      });
      await api.put('/api/tasks/reorder', { items }).catch(console.error);
    } else {
      // Different column — change status (insert at target position)
      const updated = await api.put(`/api/tasks/${draggedId}`, { status: targetTask.status }).then(r => r.json());
      setTasks(prev => prev.map(t => t.id === draggedId ? updated : t));
    }
  };

  // Bulk select handlers
  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (selectedIds.size === incomplete.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(incomplete.map(t => t.id)));
    }
  };
  const handleBulkUpdate = async (updates) => {
    const ids = [...selectedIds];
    await api.put('/api/tasks/bulk', { ids, updates });
    setTasks(prev => prev.map(t => ids.includes(t.id) ? { ...t, ...updates } : t));
    setSelectedIds(new Set());
    setBulkDeleteConfirm(false);
  };
  const handleBulkDelete = async () => {
    const ids = [...selectedIds];
    await api.delete('/api/tasks/bulk', { ids });
    setTasks(prev => prev.filter(t => !ids.includes(t.id)));
    setSelectedIds(new Set());
    setBulkDeleteConfirm(false);
  };

  // Keyboard shortcuts
  const QUICK_FILTERS = ['all', 'today', 'week', 'high', 'overdue'];
  useEffect(() => {
    const handler = (e) => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case 'n': {
          e.preventDefault();
          openNew();
          break;
        }
        case 'w': {
          e.preventDefault();
          setShowWeeklyReview(true);
          break;
        }
        case 'Escape':
          setShowForm(false);
          setShowWeeklyReview(false);
          setShowImport(false);
          setExpandedId(null);
          setSelectedIds(new Set());
          setShowShortcuts(false);
          setShowTemplates(false);
          setSharePopovers({});
          break;
        case '/': e.preventDefault(); searchInputRef.current?.focus(); break;
        case 'f': {
          e.preventDefault();
          setQuickFilter(prev => {
            const idx = QUICK_FILTERS.indexOf(prev);
            return QUICK_FILTERS[(idx + 1) % QUICK_FILTERS.length];
          });
          break;
        }
        case 'b': {
          e.preventDefault();
          setViewMode(prev => {
            const modes = ['list', 'board', 'calendar'];
            const next = modes[(modes.indexOf(prev) + 1) % modes.length];
            localStorage.setItem('tasksViewMode', next);
            return next;
          });
          break;
        }
        case '1': setFilterStatus('todo'); break;
        case '2': setFilterStatus('in-progress'); break;
        case '3': setFilterStatus('done'); break;
        case '?': setShowShortcuts(true); break;
        case 'F': {
          // Shift+F — open Focus mode for expanded task
          e.preventDefault();
          if (expandedId !== null) {
            const t = tasks.find(t => t.id === expandedId);
            if (t) setFocusTask(t);
          }
          break;
        }
        default: break;
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Derived data
  const categories = [...new Set(tasks.map(t => t.category).filter(Boolean))].sort();
  const todayStr = new Date().toISOString().slice(0, 10);
  const weekStr = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  // Stats
  const now = new Date();
  const weekStart = new Date(now); weekStart.setHours(0,0,0,0); weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 7);
  const completedThisWeek = tasks.filter(t => {
    if (t.status !== 'done') return false;
    const u = new Date(t.updatedAt);
    return u >= weekStart && u < weekEnd;
  }).length;
  const overdueCount = tasks.filter(t => {
    if (t.status === 'done') return false;
    if (!t.dueDate) return false;
    return t.dueDate.slice(0, 10) < todayStr;
  }).length;
  const highPriorityCount = tasks.filter(t => t.status !== 'done' && t.priority === 'high').length;
  const totalIncomplete = tasks.filter(t => t.status !== 'done').length;

  // 14-day chart data
  const last14Days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (13 - i));
    return d.toISOString().slice(0, 10);
  });
  const chartData = last14Days.map(day => ({
    day,
    count: tasks.filter(t => t.status === 'done' && t.updatedAt && t.updatedAt.slice(0, 10) === day).length,
  }));
  const chartMax = Math.max(...chartData.map(d => d.count), 1);

  const filtered = tasks.filter(t => {
    if (filterStatus === 'active' && t.status === 'done') return false;
    if (filterStatus !== 'active' && filterStatus !== 'all' && t.status !== filterStatus) return false;
    const taskDatePart = t.dueDate ? t.dueDate.slice(0, 10) : null;
    if (quickFilter === 'today' && taskDatePart !== todayStr) return false;
    if (quickFilter === 'week' && (!taskDatePart || taskDatePart > weekStr)) return false;
    if (quickFilter === 'high' && t.priority !== 'high') return false;
    if (quickFilter === 'overdue') {
      if (t.status === 'done' || !t.dueDate || t.dueDate.slice(0, 10) >= todayStr) return false;
    }
    if (filterCategory && t.category !== filterCategory) return false;
    if (filterProject && t.projectId !== Number(filterProject)) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!t.title.toLowerCase().includes(q) && !(t.notes || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const totalEffort = filtered.filter(t => t.status !== 'done' && t.estimatedMinutes).reduce((sum, t) => sum + t.estimatedMinutes, 0);
  const timeLogged = filtered.filter(t => t.timeSpentMinutes > 0).reduce((sum, t) => sum + (t.timeSpentMinutes || 0), 0);

  const PRIORITY_ORDER = { high: 1, medium: 2, low: 3 };
  const sortTasks = (arr) => {
    const sorted = [...arr];
    if (sortBy === 'due') {
      return sorted.sort((a, b) => {
        const aDate = a.dueDate ? a.dueDate.slice(0, 10) : null;
        const bDate = b.dueDate ? b.dueDate.slice(0, 10) : null;
        if (!aDate && !bDate) return 0;
        if (!aDate) return 1;
        if (!bDate) return -1;
        return aDate.localeCompare(bDate);
      });
    }
    if (sortBy === 'priority') return sorted.sort((a, b) => (PRIORITY_ORDER[a.priority] || 2) - (PRIORITY_ORDER[b.priority] || 2));
    if (sortBy === 'created') return sorted.sort((a, b) => (b.id || 0) - (a.id || 0));
    if (sortBy === 'az') return sorted.sort((a, b) => a.title.localeCompare(b.title));
    if (sortBy === 'za') return sorted.sort((a, b) => b.title.localeCompare(a.title));
    return sorted;
  };

  const incomplete = sortTasks(filtered.filter(t => t.status !== 'done'));
  const complete = sortTasks(filtered.filter(t => t.status === 'done'));

  // Group incomplete by category
  const grouped = {};
  incomplete.forEach(t => {
    const key = filterCategory ? '__all__' : (t.category || 'Uncategorised');
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(t);
  });
  const groupKeys = Object.keys(grouped).sort((a, b) => a === 'Uncategorised' ? 1 : b === 'Uncategorised' ? -1 : a.localeCompare(b));

  const renderTask = (task) => {
    const due = dueInfo(task.dueDate);
    const isExpanded = expandedId === task.id;
    const subs = subtasksCache[task.id] || [];
    const comments = commentsCache[task.id] || [];
    const project = projects.find(p => p.id === task.projectId);
    const isDone = task.status === 'done';
    const isNew = newlyAddedIds.has(task.id);

    return (
      <div
        key={task.id}
        draggable={task.status !== 'done'}
        onDragStart={(e) => task.status !== 'done' && handleDragStart(e, task)}
        onDragOver={(e) => task.status !== 'done' && handleDragOver(e, task.id)}
        onDrop={(e) => task.status !== 'done' && handleDrop(e, task)}
        onDragEnd={handleDragEnd}
        className="border-b last:border-b-0"
        style={{
          borderColor: 'var(--color-border)',
          outline: dragOverId === task.id ? '2px solid var(--color-primary)' : 'none',
          opacity: dragging && dragOverId === task.id ? 0.5 : 1,
          background: isNew ? 'rgba(var(--color-primary-rgb, 99,102,241), 0.06)' : 'transparent',
          transition: 'background 0.5s',
        }}
      >
        <div
          className="group flex items-start gap-2 px-3 py-2.5 hover:opacity-90 transition-opacity relative"
          style={{ borderLeft: `3px solid ${PRIORITY_COLOR[task.priority]}` }}
          onMouseEnter={(e) => showNoteTooltip(e, task.notes)}
          onMouseLeave={hideNoteTooltip}
        >
          <input
            type="checkbox"
            checked={selectedIds.has(task.id)}
            onChange={() => toggleSelect(task.id)}
            onClick={e => e.stopPropagation()}
            className={`flex-shrink-0 mt-1 cursor-pointer ${selectedIds.has(task.id) || selectedIds.size > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
            style={{ accentColor: 'var(--color-primary)', width: 14, height: 14 }}
          />

          {task.status !== 'done' && (
            <span
              className="flex-shrink-0 opacity-0 group-hover:opacity-40 cursor-grab mt-0.5"
              style={{ color: 'var(--color-muted)' }}
            >
              {getIcon('grip-vertical', { size: 14 })}
            </span>
          )}

          <button
            onClick={() => handleExpand(task.id)}
            className="flex-1 text-left min-w-0"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="text-sm font-medium"
                style={{ color: 'var(--color-text)', textDecoration: isDone ? 'line-through' : 'none', opacity: isDone ? 0.6 : 1 }}
              >
                {task.title}
              </span>
              <span
                className="text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0"
                style={{ background: PRIORITY_COLOR[task.priority] + '22', color: PRIORITY_COLOR[task.priority], border: `1px solid ${PRIORITY_COLOR[task.priority]}55` }}
              >
                {PRIORITY_LABEL[task.priority]}
              </span>
              {task.category && (
                <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>
                  {task.category}
                </span>
              )}
              {due && (
                <span className="text-xs font-medium" style={{ color: due.color }}>{due.label}</span>
              )}
              {isStale(task) && (
                <span title="Stale — sitting in To Do for 7+ days" className="flex-shrink-0 inline-flex items-center" style={{ color: '#f59e0b' }}>
                  {getIcon('clock', { size: 12 })}
                </span>
              )}
              {task.recurrence && task.recurrence !== 'none' && (
                <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-bg)', color: 'var(--color-primary)', border: '1px solid var(--color-border)' }}>
                  ↻ {task.recurrence}
                  {task.recurrenceCount > 0 && ` ×${task.recurrenceCount}`}
                </span>
              )}
              {project && (
                <span className="text-xs" style={{ color: 'var(--color-primary)', opacity: 0.8 }}>{project.name}</span>
              )}
              {task.subtaskCount > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>
                  {task.subtaskDone}/{task.subtaskCount}
                </span>
              )}
              {task.estimatedMinutes > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }} title="Estimated effort">
                  ~{formatEffort(task.estimatedMinutes)}
                </span>
              )}
              {task.keyResultId && task.keyResultTitle && (
                <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-primary)' + '18', color: 'var(--color-primary)', border: '1px solid ' + 'var(--color-primary)' + '33' }} title={task.objectiveTitle || ''}>
                  🎯 {task.keyResultTitle}
                </span>
              )}
              {task.blockerCount > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: '#ef444420', color: '#ef4444', border: '1px solid #ef444440' }} title={`Blocked by ${task.blockerCount} incomplete task${task.blockerCount !== 1 ? 's' : ''}`}>
                  🔒 {task.blockerCount}
                </span>
              )}
              {task.timeSpentMinutes > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }} title="Time logged">
                  ⏱ {formatEffort(task.timeSpentMinutes)}
                </span>
              )}
            </div>
          </button>

          <div className="flex items-center gap-1 flex-shrink-0">
            {confirmDeleteId === task.id ? (
              <>
                <button onClick={() => handleDelete(task.id)} className="text-xs px-2 py-0.5 rounded bg-red-500 text-white">Delete</button>
                <button onClick={() => setConfirmDeleteId(null)} className="text-xs" style={{ color: 'var(--color-muted)' }}>Cancel</button>
              </>
            ) : (
              <>
                {blockerConfirm === task.id ? (
                  <div className="flex items-center gap-1">
                    <span className="text-xs" style={{ color: '#f59e0b' }}>{task.blockerCount} blocker{task.blockerCount !== 1 ? 's' : ''}. Done anyway?</span>
                    <button onClick={() => { setBlockerConfirm(null); handleToggleStatus(task); }} className="text-xs px-1.5 py-0.5 rounded bg-red-500 text-white">Yes</button>
                    <button onClick={() => setBlockerConfirm(null)} className="text-xs" style={{ color: 'var(--color-muted)' }}>No</button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      if (!isDone && task.blockerCount > 0) { setBlockerConfirm(task.id); return; }
                      handleToggleStatus(task);
                    }}
                    className="hover:opacity-60 p-0.5"
                    style={{ color: isDone ? '#22c55e' : 'var(--color-muted)' }}
                    title={isDone ? 'Mark as to do' : 'Mark as done'}
                  >
                    {getIcon(isDone ? 'check-circle' : 'circle', { size: 13 })}
                  </button>
                )}
                <button
                  onClick={() => activeTimer?.taskId === task.id ? handleStopTimer() : handleStartTimer(task)}
                  className="hover:opacity-60 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ color: activeTimer?.taskId === task.id ? '#f59e0b' : 'var(--color-muted)' }}
                  title={activeTimer?.taskId === task.id ? 'Stop timer' : 'Start timer'}
                >
                  ⏱
                </button>
                <button
                  onClick={() => setFocusTask(task)}
                  className="hover:opacity-60 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ color: 'var(--color-muted)' }}
                  title="Focus mode (Shift+F when expanded)"
                >
                  🎯
                </button>
                <button
                  onClick={() => handleShare(task)}
                  className="hover:opacity-60 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ color: task.shareToken ? 'var(--color-primary)' : 'var(--color-muted)' }}
                  title={task.shareToken ? 'Shared — click to manage' : 'Share task'}
                  disabled={shareLoading.has(task.id)}
                >
                  {getIcon('share-2', { size: 12 })}
                </button>
                <button onClick={() => handleDuplicate(task)} style={{ color: 'var(--color-muted)' }} title="Duplicate" className="hover:opacity-60 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">{getIcon('copy', { size: 13 })}</button>
                <button onClick={() => openEdit(task)} style={{ color: 'var(--color-muted)' }} title="Edit" className="hover:opacity-60 p-0.5">{getIcon('edit', { size: 13 })}</button>
                <button onClick={() => setConfirmDeleteId(task.id)} style={{ color: 'var(--color-muted)' }} title="Delete" className="hover:opacity-60 p-0.5">{getIcon('trash', { size: 13 })}</button>
              </>
            )}
          </div>
          {/* Share popover */}
          {sharePopovers[task.id] && (
            <div className="absolute right-0 top-8 z-20 w-80 rounded-xl border shadow-xl p-3 space-y-2" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
              <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Share link</p>
              <div className="flex items-center gap-2">
                <input readOnly value={sharePopovers[task.id].url} className="flex-1 text-xs px-2 py-1 rounded border outline-none" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-muted)' }} onClick={e => e.target.select()} />
                <button onClick={() => handleCopyShareUrl(task.id, sharePopovers[task.id].url)} className="text-xs px-2 py-1 rounded border font-medium flex-shrink-0" style={{ borderColor: 'var(--color-primary)', color: sharePopovers[task.id].copied ? '#22c55e' : 'var(--color-primary)' }}>
                  {sharePopovers[task.id].copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <button onClick={() => handleRevoke(task)} className="text-xs hover:opacity-70" style={{ color: '#ef4444' }}>Revoke link</button>
            </div>
          )}
        </div>

        {/* Expanded view */}
        {isExpanded && (
          <div className="px-10 pb-4 space-y-3" style={{ borderLeft: `3px solid ${PRIORITY_COLOR[task.priority]}` }}>
            {task.notes && (
              <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>{task.notes}</p>
            )}
            {task.tags && task.tags.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                {task.tags.map(tag => (
                  <span key={tag} className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-bg)', color: 'var(--color-primary)', border: '1px solid var(--color-border)' }}>
                    #{tag}
                  </span>
                ))}
              </div>
            )}
            {task.sourceSessionId && (
              <div>
                <button
                  onClick={() => {
                    const path = task.projectId ? `/projects/${task.projectId}/chat` : '/chat';
                    navigate(`${path}?session=${task.sourceSessionId}`);
                  }}
                  className="flex items-center gap-1.5 text-xs hover:opacity-70 transition-opacity"
                  style={{ color: 'var(--color-primary)' }}
                >
                  {getIcon('message-circle', { size: 13 })}
                  View source chat
                </button>
              </div>
            )}
            {/* Subtasks */}
            {subs.length > 0 && (
              <div className="space-y-1">
                {subs.map(sub => (
                  <div key={sub.id} className="flex items-center gap-2">
                    <button onClick={() => handleToggleSubtask(task.id, sub)} style={{ color: sub.status === 'done' ? '#22c55e' : 'var(--color-muted)', flexShrink: 0 }}>
                      {getIcon(sub.status === 'done' ? 'check-circle' : 'circle', { size: 14 })}
                    </button>
                    <span className="text-xs" style={{ color: 'var(--color-text)', textDecoration: sub.status === 'done' ? 'line-through' : 'none', opacity: sub.status === 'done' ? 0.6 : 1 }}>
                      {sub.title}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {/* Add subtask */}
            <div className="flex items-center gap-2">
              <input
                value={newSubtask[task.id] || ''}
                onChange={e => setNewSubtask(prev => ({ ...prev, [task.id]: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && handleAddSubtask(task.id)}
                placeholder="Add subtask…"
                className="flex-1 text-xs px-2 py-1 rounded border outline-none"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
              <button onClick={() => handleAddSubtask(task.id)} className="text-xs px-2 py-1 rounded border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>Add</button>
            </div>
            {/* AI subtask generation */}
            {aiSubtaskTaskId === task.id ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={aiSubtaskPrompt}
                  onChange={e => setAiSubtaskPrompt(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAiSubtasks(task)}
                  placeholder={`Generate subtasks for "${task.title}"…`}
                  className="flex-1 text-xs px-2 py-1 rounded border outline-none"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-primary)', color: 'var(--color-text)' }}
                />
                <button onClick={() => handleAiSubtasks(task)} disabled={aiSubtaskLoading || !aiSubtaskPrompt.trim()} className="text-xs px-2 py-1 rounded border font-medium disabled:opacity-50" style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}>
                  {aiSubtaskLoading ? '…' : 'Generate'}
                </button>
                <button onClick={() => { setAiSubtaskTaskId(null); setAiSubtaskPrompt(''); }} className="text-xs" style={{ color: 'var(--color-muted)' }}>Cancel</button>
              </div>
            ) : (
              <button onClick={() => { setAiSubtaskTaskId(task.id); setAiSubtaskPrompt(task.title); }} className="flex items-center gap-1.5 text-xs hover:opacity-70 transition-opacity" style={{ color: 'var(--color-muted)' }}>
                {getIcon('sparkles', { size: 12 })}
                Generate subtasks
              </button>
            )}
            {/* Time logged */}
            {(task.timeSpentMinutes > 0 || task.estimatedMinutes > 0) && (
              <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                <span>⏱</span>
                {task.timeSpentMinutes > 0 && <span>{formatEffort(task.timeSpentMinutes)} logged</span>}
                {task.estimatedMinutes > 0 && task.timeSpentMinutes > 0 && <span>of</span>}
                {task.estimatedMinutes > 0 && <span>~{formatEffort(task.estimatedMinutes)} estimated</span>}
                {task.estimatedMinutes > 0 && task.timeSpentMinutes > 0 && (
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-border)', maxWidth: 80 }}>
                    <div className="h-full rounded-full" style={{ background: 'var(--color-primary)', width: `${Math.min(100, Math.round((task.timeSpentMinutes / task.estimatedMinutes) * 100))}%` }} />
                  </div>
                )}
              </div>
            )}
            {/* Dependencies */}
            {(() => {
              const deps = dependenciesCache[task.id];
              const blockers = deps?.blockers || [];
              const dependents = deps?.dependents || [];
              return (
                <div className="border-t pt-3 space-y-2" style={{ borderColor: 'var(--color-border)' }}>
                  <div className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Dependencies</div>
                  {/* Blocked by */}
                  <div className="space-y-1">
                    <div className="text-xs" style={{ color: 'var(--color-muted)', opacity: 0.7 }}>Blocked by</div>
                    {blockers.length === 0 && <div className="text-xs" style={{ color: 'var(--color-muted)', opacity: 0.5 }}>None</div>}
                    {blockers.map(b => (
                      <div key={b.id} className="flex items-center gap-2">
                        <span className="text-xs flex-1" style={{ color: 'var(--color-text)', textDecoration: b.status === 'done' ? 'line-through' : 'none', opacity: b.status === 'done' ? 0.5 : 1 }}>
                          {b.status === 'done' ? '✓ ' : '🔒 '}{b.title}
                        </span>
                        <button onClick={() => handleRemoveDependency(task.id, b.id)} className="text-xs hover:opacity-60" style={{ color: 'var(--color-muted)' }}>×</button>
                      </div>
                    ))}
                    {/* Add blocker */}
                    <div className="flex items-center gap-1.5 mt-1">
                      <input
                        value={depSearch[task.id] || ''}
                        onChange={async e => {
                          const q = e.target.value;
                          setDepSearch(prev => ({ ...prev, [task.id]: q }));
                          if (q.length >= 2) {
                            const res = await api.get(`/api/tasks?search=${encodeURIComponent(q)}`);
                            const results = await res.json();
                            setDepSearchResults(prev => ({ ...prev, [task.id]: results.filter(t => t.id !== task.id).slice(0, 6) }));
                          } else {
                            setDepSearchResults(prev => ({ ...prev, [task.id]: [] }));
                          }
                        }}
                        placeholder="Search to add blocker…"
                        className="flex-1 text-xs px-2 py-1 rounded border outline-none"
                        style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                      />
                    </div>
                    {(depSearchResults[task.id] || []).length > 0 && (
                      <div className="rounded border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                        {depSearchResults[task.id].map(result => (
                          <button
                            key={result.id}
                            onClick={() => {
                              handleAddDependency(task.id, result.id);
                              setDepSearch(prev => ({ ...prev, [task.id]: '' }));
                              setDepSearchResults(prev => ({ ...prev, [task.id]: [] }));
                            }}
                            className="w-full text-left px-2 py-1.5 text-xs hover:opacity-70 border-b last:border-b-0"
                            style={{ color: 'var(--color-text)', borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
                          >
                            {result.title}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Blocking (read-only) */}
                  {dependents.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-xs" style={{ color: 'var(--color-muted)', opacity: 0.7 }}>Blocking</div>
                      {dependents.map(d => (
                        <div key={d.id} className="text-xs" style={{ color: 'var(--color-muted)' }}>→ {d.title}</div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
            {/* Comments / Activity */}
            <div className="border-t pt-3 space-y-2" style={{ borderColor: 'var(--color-border)' }}>
              <div className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Activity</div>
              {comments.length > 0 && (
                <div className="space-y-1.5">
                  {comments.map(c => (
                    <div key={c.id} className="flex items-start gap-2 group/comment">
                      <div className="flex-1 min-w-0">
                        {c.type === 'system' ? (
                          <span className="text-xs italic" style={{ color: 'var(--color-muted)' }}>{c.content}</span>
                        ) : (
                          <span className="text-xs" style={{ color: 'var(--color-text)' }}>{c.content}</span>
                        )}
                        <span className="text-xs ml-1.5" style={{ color: 'var(--color-muted)', opacity: 0.6 }}>{relTime(c.createdAt)}</span>
                      </div>
                      {c.type === 'user' && (
                        <button onClick={() => handleDeleteComment(task.id, c.id)} className="opacity-0 group-hover/comment:opacity-60 hover:opacity-100 transition-opacity flex-shrink-0" style={{ color: 'var(--color-muted)' }}>
                          {getIcon('x', { size: 10 })}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  value={newComment[task.id] || ''}
                  onChange={e => setNewComment(prev => ({ ...prev, [task.id]: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && handleAddComment(task.id)}
                  placeholder="Add comment…"
                  className="flex-1 text-xs px-2 py-1 rounded border outline-none"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />
                <button onClick={() => handleAddComment(task.id)} className="text-xs px-2 py-1 rounded border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>Post</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderKanbanCard = (task) => {
    const due = dueInfo(task.dueDate);
    const isDone = task.status === 'done';
    const isOver = dragOverId === task.id;
    return (
      <div
        key={task.id}
        draggable
        onDragStart={(e) => handleDragStart(e, task)}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverId(task.id); }}
        onDragLeave={() => setDragOverId(null)}
        onDrop={(e) => handleKanbanCardDrop(e, task)}
        onDragEnd={handleDragEnd}
        onMouseEnter={(e) => showNoteTooltip(e, task.notes)}
        onMouseLeave={hideNoteTooltip}
        className="group p-3 rounded-xl border cursor-grab active:cursor-grabbing select-none transition-all"
        style={{
          background: 'var(--color-bg)',
          borderColor: isOver ? 'var(--color-primary)' : 'var(--color-border)',
          borderLeft: `3px solid ${isOver ? 'var(--color-primary)' : PRIORITY_COLOR[task.priority]}`,
          opacity: isDone ? 0.7 : 1,
          boxShadow: isOver ? '0 0 0 1px var(--color-primary)' : 'none',
          transform: isOver ? 'scale(1.01)' : 'none',
        }}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <span className="text-sm font-medium leading-snug" style={{ color: 'var(--color-text)', textDecoration: isDone ? 'line-through' : 'none', opacity: isDone ? 0.7 : 1 }}>{task.title}</span>
          <div className="flex gap-0.5 flex-shrink-0">
            <button onClick={() => handleToggleStatus(task)} style={{ color: isDone ? '#22c55e' : 'var(--color-muted)' }} title={isDone ? 'Unmark' : 'Done'} className="hover:opacity-60 p-0.5">{getIcon(isDone ? 'check-circle' : 'circle', { size: 13 })}</button>
            <button onClick={() => openEdit(task)} style={{ color: 'var(--color-muted)' }} className="hover:opacity-60 p-0.5">{getIcon('edit', { size: 12 })}</button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1 items-center">
          <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ background: PRIORITY_COLOR[task.priority] + '22', color: PRIORITY_COLOR[task.priority] }}>{PRIORITY_LABEL[task.priority]}</span>
          {due && <span className="text-xs font-medium" style={{ color: due.color }}>{due.label}</span>}
          {task.subtaskCount > 0 && <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'var(--color-surface)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>{task.subtaskDone}/{task.subtaskCount}</span>}
          {task.estimatedMinutes > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>~{formatEffort(task.estimatedMinutes)}</span>
          )}
          {isStale(task) && (
            <span title="Stale — sitting in To Do for 7+ days" className="flex items-center" style={{ color: '#f59e0b' }}>
              {getIcon('clock', { size: 12 })}
            </span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); handleShare(task); }}
            className="opacity-0 group-hover:opacity-100 transition-opacity ml-auto hover:opacity-60 p-0.5"
            style={{ color: task.shareToken ? 'var(--color-primary)' : 'var(--color-muted)' }}
            title={task.shareToken ? 'Shared' : 'Share task'}
            disabled={shareLoading.has(task.id)}
          >
            {getIcon('share-2', { size: 11 })}
          </button>
        </div>
        {/* Share popover */}
        {sharePopovers[task.id] && (
          <div className="mt-2 rounded-lg border p-2 space-y-1.5" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
            <div className="flex items-center gap-1.5">
              <input readOnly value={sharePopovers[task.id].url} className="flex-1 text-xs px-1.5 py-1 rounded border outline-none" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-muted)' }} onClick={e => e.target.select()} />
              <button onClick={() => handleCopyShareUrl(task.id, sharePopovers[task.id].url)} className="text-xs px-1.5 py-1 rounded border font-medium flex-shrink-0" style={{ borderColor: 'var(--color-primary)', color: sharePopovers[task.id].copied ? '#22c55e' : 'var(--color-primary)' }}>
                {sharePopovers[task.id].copied ? '✓' : 'Copy'}
              </button>
            </div>
            <button onClick={() => handleRevoke(task)} className="text-xs hover:opacity-70" style={{ color: '#ef4444' }}>Revoke</button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full overflow-hidden">
      {noteTooltip && (
        <div
          className="fixed z-[9999] pointer-events-none w-64 rounded-xl border shadow-xl px-3 py-2.5"
          style={{
            left: noteTooltip.x,
            top: noteTooltip.y,
            background: 'var(--color-surface)',
            borderColor: 'var(--color-border)',
          }}
        >
          <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {noteTooltip.notes.length > 300 ? noteTooltip.notes.slice(0, 300) + '…' : noteTooltip.notes}
          </p>
        </div>
      )}
      {/* Templates side panel */}
      {showTemplates && (
        <TaskTemplatesPanel
          templates={templates}
          templatesLoading={templatesLoading}
          onApply={handleApplyTemplate}
          onDelete={handleDeleteTemplate}
          onTemplateSaved={(tmpl) => setTemplates(prev => [tmpl, ...prev])}
          onClose={() => setShowTemplates(false)}
        />
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <div
          className="flex-shrink-0 flex items-center gap-3 px-6 py-4 border-b"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
        >
          <h1 className="text-xl font-semibold flex-1" style={{ color: 'var(--color-text)' }}>Tasks</h1>
          <button
            onClick={() => { setShowAI(v => !v); setAiMessage(''); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-all"
            style={{ borderColor: showAI ? 'var(--color-primary)' : 'var(--color-border)', color: showAI ? 'var(--color-primary)' : 'var(--color-muted)', background: showAI ? 'var(--color-bg)' : 'transparent' }}
          >
            {getIcon('wand', { size: 13 })} Ask Claude
          </button>
          <button
            onClick={() => setShowWeeklyReview(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-all"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
            title="Weekly Review (W)"
          >
            {getIcon('calendar', { size: 13 })} Weekly Review
          </button>
          {activeTimer && (
            <button
              onClick={handleStopTimer}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-mono"
              style={{ borderColor: '#f59e0b', color: '#f59e0b', background: '#f59e0b11', animation: 'pulse 2s infinite' }}
              title="Timer running — click to stop"
            >
              ⏱ {activeTimer.task.title.slice(0, 20)}{activeTimer.task.title.length > 20 ? '…' : ''} — {String(Math.floor(elapsed / 3600)).padStart(2,'0')}:{String(Math.floor((elapsed % 3600) / 60)).padStart(2,'0')}:{String(elapsed % 60).padStart(2,'0')}
            </button>
          )}
          <button
            onClick={() => setShowImport(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-all"
            style={{ borderColor: showImport ? 'var(--color-primary)' : 'var(--color-border)', color: showImport ? 'var(--color-primary)' : 'var(--color-muted)' }}
            title="Import from CSV"
          >
            {getIcon('upload', { size: 13 })} Import
          </button>
          <button
            onClick={() => { setShowTemplates(v => !v); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-all"
            style={{ borderColor: showTemplates ? 'var(--color-primary)' : 'var(--color-border)', color: showTemplates ? 'var(--color-primary)' : 'var(--color-muted)' }}
            title="Task Templates"
          >
            {getIcon('book', { size: 13 })} Templates
          </button>
          {/* View toggle */}
          <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
            {[
              { mode: 'list', icon: 'list-checks', title: 'List view' },
              { mode: 'board', icon: 'layout', title: 'Board view' },
              { mode: 'calendar', icon: 'calendar', title: 'Calendar view' },
            ].map((v, i) => (
              <button
                key={v.mode}
                onClick={() => { setViewMode(v.mode); localStorage.setItem('tasksViewMode', v.mode); }}
                className="px-2.5 py-1.5 text-xs transition-all border-l first:border-l-0"
                style={{ background: viewMode === v.mode ? 'var(--color-primary)' : 'transparent', color: viewMode === v.mode ? '#fff' : 'var(--color-muted)', borderColor: 'var(--color-border)' }}
                title={v.title}
              >
                {getIcon(v.icon, { size: 13 })}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowHelp(v => !v)}
            className="w-8 h-8 flex items-center justify-center rounded-lg border hover:opacity-70 transition-opacity"
            style={{ borderColor: showHelp ? 'var(--color-primary)' : 'var(--color-border)', color: showHelp ? 'var(--color-primary)' : 'var(--color-muted)' }}
            title="Tasks guide"
          >
            {getIcon('book', { size: 14 })}
          </button>
          <button
            onClick={() => setShowShortcuts(true)}
            className="w-8 h-8 flex items-center justify-center rounded-lg border text-xs font-bold hover:opacity-70 transition-opacity"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
            title="Keyboard shortcuts"
          >
            ?
          </button>
          <button
            onClick={() => openNew()}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium text-white"
            style={{ background: 'var(--color-primary)' }}
          >
            {getIcon('plus', { size: 13, color: 'white' })} New Task
          </button>
        </div>

        {/* Stats bar */}
        {tasks.length > 0 && (
          <TaskStatsBar
            totalIncomplete={totalIncomplete}
            completedThisWeek={completedThisWeek}
            overdueCount={overdueCount}
            highPriorityCount={highPriorityCount}
            totalEffortFormatted={formatEffort(totalEffort)}
            timeLoggedFormatted={timeLogged > 0 ? formatEffort(timeLogged) : '—'}
            showChart={showChart}
            onToggleChart={() => setShowChart(v => !v)}
            onFilterOverdue={() => setQuickFilter('overdue')}
            onFilterHigh={() => setQuickFilter('high')}
            chartData={chartData}
            chartMax={chartMax}
            todayStr={todayStr}
          />
        )}

        {/* AI panel */}
        {showAI && (
          <div className="flex-shrink-0 border-b px-6 py-4 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <textarea
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              placeholder='Describe what you need to get done, e.g. "Prepare for the client pitch on Friday"'
              rows={3}
              className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none resize-none"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            />
            <div className="flex items-center gap-3">
              <select
                value={aiProjectId}
                onChange={e => setAiProjectId(e.target.value)}
                className="text-xs px-2 py-1.5 rounded-lg border outline-none"
                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                <option value="">No project</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button
                onClick={handleAiGenerate}
                disabled={aiGenerating || !aiPrompt.trim()}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                style={{ background: 'var(--color-primary)' }}
              >
                {aiGenerating ? getIcon('loader', { size: 13, color: 'white' }) : getIcon('sparkles', { size: 13, color: 'white' })}
                {aiGenerating ? 'Generating…' : 'Generate Tasks'}
              </button>
              {aiMessage && (
                <span className="text-xs" style={{ color: aiMessage.startsWith('✓') ? '#22c55e' : '#ef4444' }}>{aiMessage}</span>
              )}
            </div>
          </div>
        )}

        {/* Filter bar */}
        <TaskFilters
          quickFilter={quickFilter}
          onSetQuickFilter={setQuickFilter}
          filterCategory={filterCategory}
          onSetFilterCategory={setFilterCategory}
          filterProject={filterProject}
          onSetFilterProject={setFilterProject}
          filterStatus={filterStatus}
          onSetFilterStatus={setFilterStatus}
          search={search}
          onSetSearch={setSearch}
          sortBy={sortBy}
          onSetSortBy={setSortBy}
          categories={categories}
          projects={projects}
          searchInputRef={searchInputRef}
        />

        {/* Bulk action toolbar */}
        {selectedIds.size > 0 && (
          <div className="flex-shrink-0 flex flex-wrap items-center gap-2 px-6 py-2.5 border-b" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>{selectedIds.size} selected</span>
            <button onClick={() => handleBulkUpdate({ status: 'done' })} className="text-xs px-2.5 py-1 rounded-lg border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>Mark Done</button>
            <button onClick={() => handleBulkUpdate({ status: 'in-progress' })} className="text-xs px-2.5 py-1 rounded-lg border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>In Progress</button>
            <button onClick={() => handleBulkUpdate({ status: 'todo' })} className="text-xs px-2.5 py-1 rounded-lg border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>To Do</button>
            <select onChange={e => e.target.value && handleBulkUpdate({ priority: e.target.value })} defaultValue="" className="text-xs px-2 py-1 rounded-lg border outline-none" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
              <option value="" disabled>Priority…</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <div className="flex items-center gap-1">
              <input value={bulkCategoryInput} onChange={e => setBulkCategoryInput(e.target.value)} placeholder="Set category…" onKeyDown={e => e.key === 'Enter' && bulkCategoryInput.trim() && handleBulkUpdate({ category: bulkCategoryInput.trim() })} className="text-xs px-2 py-1 rounded-lg border outline-none w-28" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
            </div>
            <div className="flex-1" />
            {bulkDeleteConfirm ? (
              <>
                <span className="text-xs text-red-500">Delete {selectedIds.size} task{selectedIds.size !== 1 ? 's' : ''}?</span>
                <button onClick={handleBulkDelete} className="text-xs px-2.5 py-1 rounded-lg bg-red-500 text-white">Confirm</button>
                <button onClick={() => setBulkDeleteConfirm(false)} className="text-xs" style={{ color: 'var(--color-muted)' }}>Cancel</button>
              </>
            ) : (
              <button onClick={() => setBulkDeleteConfirm(true)} className="text-xs px-2.5 py-1 rounded-lg border border-red-400" style={{ color: '#ef4444' }}>Delete</button>
            )}
            <button onClick={() => setSelectedIds(new Set())} className="text-xs" style={{ color: 'var(--color-muted)' }}>Clear</button>
          </div>
        )}

        {/* Task content area */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {viewMode === 'calendar' ? (
            <TasksCalendar
              tasks={tasks}
              projects={projects}
              onEdit={openEdit}
              onToggleStatus={handleToggleStatus}
              onNew={(dateKey) => openNew('todo', dateKey)}
              onReschedule={handleReschedule}
              onUpdateEffort={handleUpdateEffort}
            />
          ) : (
          <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16" style={{ color: 'var(--color-muted)' }}>
              {getIcon('loader', { size: 20 })}
            </div>
          ) : viewMode === 'board' ? (
            /* Kanban Board View */
            <div className="flex gap-4 p-4 h-full overflow-x-auto">
              {[
                { status: 'todo', label: 'To Do' },
                { status: 'in-progress', label: 'In Progress' },
                { status: 'done', label: 'Done' },
              ].map(({ status, label }) => {
                const columnTasks = filtered
                  .filter(t => t.status === status)
                  .sort((a, b) => ((a.order ?? 0) - (b.order ?? 0)) || (a.id - b.id));
                return (
                  <div
                    key={status}
                    className="flex-shrink-0 w-72 flex flex-col rounded-xl border"
                    style={{
                      borderColor: dragOverColumn === status ? 'var(--color-primary)' : 'var(--color-border)',
                      background: 'var(--color-surface)',
                      maxHeight: '100%',
                    }}
                    onDragOver={(e) => handleKanbanDragOver(e, status)}
                    onDrop={(e) => handleKanbanDrop(e, status)}
                    onDragLeave={() => setDragOverColumn(null)}
                  >
                    <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
                      <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{label}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>{columnTasks.length}</span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-2">
                      {columnTasks.map(task => renderKanbanCard(task))}
                      {columnTasks.length === 0 && (
                        <div className="py-8 text-center text-xs" style={{ color: 'var(--color-muted)', opacity: 0.5 }}>
                          Drop tasks here
                        </div>
                      )}
                    </div>
                    <div className="p-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
                      <button
                        onClick={() => openNew(status)}
                        className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs hover:opacity-70 transition-opacity"
                        style={{ color: 'var(--color-muted)', border: '1px dashed var(--color-border)' }}
                      >
                        {getIcon('plus', { size: 12 })} Add task
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : incomplete.length === 0 && complete.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 px-6">
              <div className="mb-3" style={{ color: 'var(--color-muted)', opacity: 0.4 }}>{getIcon('list-checks', { size: 40 })}</div>
              <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
                {search || quickFilter !== 'all' || filterCategory || filterProject ? 'No tasks match your filters.' : 'No tasks yet. Create one or ask Claude to generate a plan.'}
              </p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">
              {/* Grouped incomplete tasks */}
              {groupKeys.map(group => (
                <div key={group} className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                  {group !== '__all__' && (
                    <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wider" style={{ background: 'var(--color-surface)', color: 'var(--color-muted)', borderBottom: '1px solid var(--color-border)' }}>
                      {group}
                    </div>
                  )}
                  <div style={{ background: 'var(--color-bg)' }}>
                    {grouped[group].map(task => renderTask(task))}
                  </div>
                </div>
              ))}

              {/* Completed section */}
              {complete.length > 0 && (
                <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                  <button
                    onClick={() => setCompletedOpen(v => !v)}
                    className="w-full flex items-center gap-2 px-4 py-2 text-xs font-semibold uppercase tracking-wider"
                    style={{ background: 'var(--color-surface)', color: 'var(--color-muted)', borderBottom: completedOpen ? '1px solid var(--color-border)' : 'none' }}
                  >
                    {getIcon('chevron-right', { size: 12, style: { transform: completedOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' } })}
                    Completed ({complete.length})
                  </button>
                  {completedOpen && (
                    <div style={{ background: 'var(--color-bg)' }}>
                      {complete.map(task => renderTask(task))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          </div>
          )}
        </div>
      </div>

      {/* Tasks help panel (right side) */}
      {showHelp && (
        <div className="w-80 flex-shrink-0 border-l flex flex-col overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0" style={{ borderColor: 'var(--color-border)' }}>
            <div className="flex items-center gap-2">
              {getIcon('book', { size: 14, style: { color: 'var(--color-primary)' } })}
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Tasks Guide</span>
            </div>
            <button onClick={() => setShowHelp(false)} className="hover:opacity-60" style={{ color: 'var(--color-muted)' }}>{getIcon('x', { size: 14 })}</button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5 text-sm" style={{ color: 'var(--color-text)' }}>

            {/* Views */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-primary)' }}>Views</p>
              <ul className="space-y-1.5 text-xs" style={{ color: 'var(--color-text)', opacity: 0.85 }}>
                <li><strong>List</strong> — tasks grouped by category; drag to reorder</li>
                <li><strong>Board</strong> — Kanban (To Do / In Progress / Done); drag within column to reorder, across to change status</li>
                <li><strong>Calendar</strong> — Day / Week / Month / Range; drag pills between dates to reschedule</li>
              </ul>
              <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>Press <kbd className="px-1 py-0.5 rounded text-xs border" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>b</kbd> to cycle views.</p>
            </div>

            {/* Creating */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-primary)' }}>Creating Tasks</p>
              <ul className="space-y-1.5 text-xs" style={{ color: 'var(--color-text)', opacity: 0.85 }}>
                <li>Click <strong>New Task</strong> or press <kbd className="px-1 py-0.5 rounded text-xs border" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>n</kbd></li>
                <li>Press <kbd className="px-1 py-0.5 rounded text-xs border" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>Enter</kbd> in the title field to save instantly</li>
                <li>Use <strong>+ Save as template</strong> to turn any task into a reusable template</li>
              </ul>
            </div>

            {/* Quick Capture */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-primary)' }}>Quick Capture</p>
              <p className="text-xs" style={{ color: 'var(--color-text)', opacity: 0.85 }}>The <strong>+</strong> button (bottom-right of every page) opens a minimal modal — title, priority, due date. Also: <kbd className="px-1 py-0.5 rounded text-xs border" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>Ctrl+Shift+N</kbd></p>
            </div>

            {/* Filtering */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-primary)' }}>Filtering &amp; Sorting</p>
              <ul className="space-y-1.5 text-xs" style={{ color: 'var(--color-text)', opacity: 0.85 }}>
                <li><kbd className="px-1 py-0.5 rounded text-xs border" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>/</kbd> — focus search</li>
                <li><kbd className="px-1 py-0.5 rounded text-xs border" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>f</kbd> — cycle quick filters (All → Today → Week → High → Overdue)</li>
                <li><kbd className="px-1 py-0.5 rounded text-xs border" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>1</kbd> / <kbd className="px-1 py-0.5 rounded text-xs border" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>2</kbd> / <kbd className="px-1 py-0.5 rounded text-xs border" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>3</kbd> — filter by status</li>
              </ul>
            </div>

            {/* Recurring */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-primary)' }}>Recurring Tasks</p>
              <p className="text-xs" style={{ color: 'var(--color-text)', opacity: 0.85 }}>Set recurrence on any task with a due date. When marked Done, a new copy is created with the next due date. A <strong>↻</strong> badge tracks the count.</p>
            </div>

            {/* Aging */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-primary)' }}>Aging Indicator</p>
              <p className="text-xs" style={{ color: 'var(--color-text)', opacity: 0.85 }}>Tasks sitting in <strong>To Do</strong> for more than 7 days show an amber <span style={{ color: '#f59e0b' }}>⏱</span> clock icon in all three views.</p>
            </div>

            {/* Morning Digest */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-primary)' }}>Morning Digest</p>
              <p className="text-xs" style={{ color: 'var(--color-text)', opacity: 0.85 }}>On first visit each day an overlay shows overdue tasks, today's tasks, and a Claude suggestion for what to focus on first.</p>
            </div>

            {/* Subtasks & Comments */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-primary)' }}>Subtasks &amp; Comments</p>
              <ul className="space-y-1.5 text-xs" style={{ color: 'var(--color-text)', opacity: 0.85 }}>
                <li>Click a task title to expand and see subtasks + comments</li>
                <li>Use <strong>Generate with AI</strong> to auto-suggest subtasks</li>
                <li>Status, priority, and due date changes are logged automatically</li>
              </ul>
            </div>

            {/* Bulk & Templates */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-primary)' }}>Bulk Actions &amp; Templates</p>
              <ul className="space-y-1.5 text-xs" style={{ color: 'var(--color-text)', opacity: 0.85 }}>
                <li>Hover a task to reveal its checkbox; tick multiple for bulk edit/delete</li>
                <li>Click <strong>Templates</strong> in the toolbar to create and apply reusable task templates</li>
              </ul>
            </div>

            {/* Keyboard Shortcuts */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-primary)' }}>Keyboard Shortcuts</p>
              <div className="space-y-1.5">
                {[
                  ['n', 'New task'],
                  ['w', 'Weekly Review'],
                  ['/', 'Focus search'],
                  ['f', 'Cycle quick filters'],
                  ['1 / 2 / 3', 'Filter by status'],
                  ['b', 'Cycle view'],
                  ['?', 'All shortcuts'],
                  ['Ctrl+Shift+N', 'Quick capture'],
                  ['Esc', 'Close / deselect'],
                ].map(([key, desc]) => (
                  <div key={key} className="flex items-center justify-between">
                    <span className="text-xs" style={{ color: 'var(--color-text)', opacity: 0.8 }}>{desc}</span>
                    <kbd className="text-xs px-1.5 py-0.5 rounded border font-mono flex-shrink-0" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>{key}</kbd>
                  </div>
                ))}
              </div>
            </div>

            {/* Hover note */}
            <div className="rounded-xl px-3 py-2.5 text-xs" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
              <strong style={{ color: 'var(--color-primary)' }}>Tip:</strong> Hover any task to see its notes in a tooltip — works in all three views.
            </div>

          </div>
        </div>
      )}

      {/* Task form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
          <div className="w-full max-w-lg rounded-2xl border shadow-xl overflow-hidden" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
              <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{editTask ? 'Edit Task' : 'New Task'}</h2>
              <button onClick={() => setShowForm(false)} style={{ color: 'var(--color-muted)' }}>{getIcon('x', { size: 16 })}</button>
            </div>
            <div className="px-5 py-4 space-y-3 max-h-[80vh] overflow-y-auto">
              <div>
                <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-muted)' }}>Title *</label>
                <input
                  autoFocus
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && handleSave()}
                  className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-muted)' }}>Notes</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} className="w-full px-3 py-2 rounded-lg border text-sm outline-none resize-none" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-muted)' }}>Priority</label>
                  <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} className="w-full px-3 py-2 rounded-lg border text-sm outline-none" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-muted)' }}>Due date & time</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={form.dueDateRaw}
                      onChange={e => {
                        const raw = e.target.value;
                        setForm(f => {
                          const parsed = parseNaturalDate(raw);
                          if (parsed) {
                            return { ...f, dueDateRaw: raw, dueDate: toISOForAPI(parsed).slice(0, 10), dueTime: toISOForAPI(parsed).includes('T') ? toISOForAPI(parsed).slice(11, 16) : '' };
                          }
                          return { ...f, dueDateRaw: raw };
                        });
                      }}
                      placeholder='e.g. "tomorrow 3pm", "next friday", "Mar 15"'
                      className="w-full px-3 py-2 rounded-lg border text-sm outline-none pr-8"
                      style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                    />
                    <input
                      type="date"
                      value={form.dueDate}
                      onChange={e => {
                        const d = e.target.value;
                        setForm(f => ({ ...f, dueDate: d, dueDateRaw: d ? formatDateForInput(new Date(d + (f.dueTime ? 'T' + f.dueTime : 'T09:00'))) : '' }));
                      }}
                      style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', opacity: 0, width: 20, height: 20, cursor: 'pointer' }}
                    />
                    <span style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-muted)', pointerEvents: 'none', fontSize: 12 }}>📅</span>
                  </div>
                  {form.dueDateRaw && (() => {
                    const parsed = parseNaturalDate(form.dueDateRaw);
                    if (parsed && form.dueDate) return <p className="text-xs mt-1" style={{ color: '#22c55e' }}>Resolved: {parsed.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}{form.dueTime ? ' at ' + form.dueTime : ''}</p>;
                    if (!parsed && form.dueDateRaw.length > 2) return <p className="text-xs mt-1" style={{ color: '#f59e0b' }}>Could not parse — try "tomorrow", "next friday", "Mar 15"</p>;
                    return null;
                  })()}
                  {form.dueDate && form.dueTime === '' && (
                    <input type="time" value={form.dueTime} onChange={e => { setForm(f => ({ ...f, dueTime: e.target.value, dueDateRaw: f.dueDate ? formatDateForInput(new Date(f.dueDate + 'T' + e.target.value)) : '' })); }} className="w-full mt-1.5 px-3 py-1.5 rounded-lg border text-sm outline-none" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} placeholder="Add time (optional)" />
                  )}
                  {form.dueTime && (
                    <input type="time" value={form.dueTime} onChange={e => { setForm(f => ({ ...f, dueTime: e.target.value, dueDateRaw: f.dueDate ? formatDateForInput(new Date(f.dueDate + 'T' + e.target.value)) : '' })); }} className="w-full mt-1.5 px-3 py-1.5 rounded-lg border text-sm outline-none" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                  )}
                </div>
              </div>
              {form.dueDate && (
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-muted)' }}>Recurrence</label>
                  <select value={form.recurrence} onChange={e => setForm(f => ({ ...f, recurrence: e.target.value }))} className="w-full px-3 py-2 rounded-lg border text-sm outline-none" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                    <option value="none">None</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="fortnightly">Fortnightly</option>
                    <option value="monthly">Monthly</option>
                    <option value="annually">Annually</option>
                  </select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-muted)' }}>Category</label>
                  <input list="category-suggestions" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} placeholder="e.g. Marketing" className="w-full px-3 py-2 rounded-lg border text-sm outline-none" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                  <datalist id="category-suggestions">{categories.map(c => <option key={c} value={c} />)}</datalist>
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-muted)' }}>Tags (comma separated)</label>
                  <input value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} placeholder="design, urgent" className="w-full px-3 py-2 rounded-lg border text-sm outline-none" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-muted)' }}>Project</label>
                  <select value={form.projectId} onChange={e => setForm(f => ({ ...f, projectId: e.target.value }))} className="w-full px-3 py-2 rounded-lg border text-sm outline-none" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                    <option value="">None</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-muted)' }}>Parent task</label>
                  <select value={form.parentTaskId} onChange={e => setForm(f => ({ ...f, parentTaskId: e.target.value }))} className="w-full px-3 py-2 rounded-lg border text-sm outline-none" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                    <option value="">None (top-level)</option>
                    {tasks.filter(t => !editTask || t.id !== editTask.id).map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
                  </select>
                </div>
              </div>
              {/* Effort estimation */}
              <div>
                <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-muted)' }}>
                  Effort estimate {form.estimatedMinutes ? <span style={{ color: 'var(--color-primary)' }}>— {formatEffort(form.estimatedMinutes)}</span> : ''}
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {EFFORT_PRESETS.map(p => (
                    <button
                      key={p.val}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, estimatedMinutes: f.estimatedMinutes === p.val ? null : p.val }))}
                      className="px-2 py-1 rounded-lg border text-xs font-medium transition-all"
                      style={{
                        background: form.estimatedMinutes === p.val ? 'var(--color-primary)' : 'transparent',
                        borderColor: form.estimatedMinutes === p.val ? 'var(--color-primary)' : 'var(--color-border)',
                        color: form.estimatedMinutes === p.val ? '#fff' : 'var(--color-muted)',
                      }}
                    >{p.label}</button>
                  ))}
                </div>
                <input
                  placeholder="or type: 45m, 3h, 1.5h, 2d"
                  className="w-full px-3 py-1.5 rounded-lg border text-sm outline-none"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  onChange={e => {
                    const parsed = parseEffortInput(e.target.value);
                    if (parsed !== null) setForm(f => ({ ...f, estimatedMinutes: parsed }));
                    else if (!e.target.value.trim()) setForm(f => ({ ...f, estimatedMinutes: null }));
                  }}
                />
              </div>
              {/* Key Result linkage */}
              {goalsForForm.length > 0 && (
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-muted)' }}>Link to Goal</label>
                  {form.keyResultId ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-2 py-1 rounded-lg" style={{ background: 'var(--color-primary)' + '22', color: 'var(--color-primary)', border: '1px solid ' + 'var(--color-primary)' + '44' }}>
                        🎯 {goalsForForm.flatMap(o => o.keyResults).find(kr => kr.id === form.keyResultId)?.title || 'Key Result'}
                      </span>
                      <button type="button" onClick={() => { setForm(f => ({ ...f, keyResultId: null })); setFormObjectiveId(''); }} className="text-xs hover:opacity-60" style={{ color: 'var(--color-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>✕ Clear</button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <select
                        value={formObjectiveId}
                        onChange={e => { setFormObjectiveId(e.target.value); setForm(f => ({ ...f, keyResultId: null })); }}
                        className="flex-1 px-3 py-2 rounded-lg border text-sm outline-none"
                        style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                      >
                        <option value="">— Select objective</option>
                        {goalsForForm.map(o => <option key={o.id} value={o.id}>{o.title}</option>)}
                      </select>
                      {formObjectiveId && (
                        <select
                          value={form.keyResultId || ''}
                          onChange={e => setForm(f => ({ ...f, keyResultId: e.target.value ? Number(e.target.value) : null }))}
                          className="flex-1 px-3 py-2 rounded-lg border text-sm outline-none"
                          style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                        >
                          <option value="">— Select Key Result</option>
                          {(goalsForForm.find(o => String(o.id) === formObjectiveId)?.keyResults || []).map(kr => (
                            <option key={kr.id} value={kr.id}>{kr.title}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center justify-between gap-2 px-5 py-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
              <button
                onClick={handleSaveAsTemplate}
                disabled={savingTemplate || !form.title.trim()}
                className="text-xs px-3 py-2 rounded-lg border hover:opacity-70 transition-opacity disabled:opacity-40"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
                title="Save current task as a reusable template"
              >
                {savingTemplate ? 'Saving…' : '+ Save as template'}
              </button>
              <div className="flex items-center gap-2">
                <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg text-sm border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Cancel</button>
                <button onClick={handleSave} disabled={saving || !form.title.trim()} className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50" style={{ background: 'var(--color-primary)' }}>
                  {saving ? 'Saving…' : editTask ? 'Save changes' : 'Create task'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Keyboard shortcuts modal */}
      {showShortcuts && <TaskShortcutsModal onClose={() => setShowShortcuts(false)} />}

      {/* Weekly Review modal */}
      {showWeeklyReview && (
        <WeeklyReview
          tasks={tasks}
          onClose={() => setShowWeeklyReview(false)}
          onTasksChanged={fetchTasks}
        />
      )}

      {/* CSV Import modal */}
      {showImport && (
        <TaskImport
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); fetchTasks(); }}
        />
      )}

      {/* Focus mode overlay */}
      {focusTask && (
        <FocusMode
          task={focusTask}
          onClose={() => setFocusTask(null)}
          onTaskUpdate={(updates) => {
            api.put(`/api/tasks/${focusTask.id}`, updates).then(r => r.json()).then(updated => {
              setTasks(prev => prev.map(t => t.id === focusTask.id ? updated : t));
            }).catch(console.error);
          }}
        />
      )}
    </div>
  );
}
