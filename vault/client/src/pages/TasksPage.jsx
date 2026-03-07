import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';

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

const EMPTY_FORM = {
  title: '', notes: '', status: 'todo', priority: 'medium', category: '', tags: '',
  dueDate: '', dueTime: '', projectId: '', parentTaskId: '', recurrence: 'none',
};

const TASK_SHORTCUTS = [
  { keys: ['n'], desc: 'New task' },
  { keys: ['Esc'], desc: 'Close / cancel / deselect' },
  { keys: ['/'], desc: 'Focus search' },
  { keys: ['f'], desc: 'Cycle quick filters' },
  { keys: ['1'], desc: 'Filter: To Do' },
  { keys: ['2'], desc: 'Filter: In Progress' },
  { keys: ['3'], desc: 'Filter: Done' },
  { keys: ['b'], desc: 'Toggle board / list view' },
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

  // Templates panel
  const [showTemplates, setShowTemplates] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateForm, setTemplateForm] = useState({ name: '', description: '', category: '', priority: 'medium', recurrence: 'none', tags: '', subtasks: '' });
  const [showNewTemplate, setShowNewTemplate] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);

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

  // AI subtask generation state
  const [aiSubtaskTaskId, setAiSubtaskTaskId] = useState(null);
  const [aiSubtaskPrompt, setAiSubtaskPrompt] = useState('');
  const [aiSubtaskLoading, setAiSubtaskLoading] = useState(false);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/tasks');
      setTasks(await res.json());
    } catch { setTasks([]); } finally { setLoading(false); }
  }, []);

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

  const handleDuplicate = async (task) => {
    const res = await api.post(`/api/tasks/${task.id}/duplicate`);
    const dup = await res.json();
    setTasks(prev => [dup, ...prev]);
    // Highlight new task briefly
    setNewlyAddedIds(prev => new Set([...prev, dup.id]));
    setTimeout(() => setNewlyAddedIds(prev => { const n = new Set(prev); n.delete(dup.id); return n; }), 2000);
  };

  const openNew = (defaultStatus = 'todo') => {
    const now = new Date();
    const todayDate = now.toISOString().slice(0, 10);
    const currentTime = now.toTimeString().slice(0, 5);
    setEditTask(null);
    setForm({ ...EMPTY_FORM, dueDate: todayDate, dueTime: currentTime, status: defaultStatus });
    setShowForm(true);
  };

  const openEdit = (task) => {
    setEditTask(task);
    const existing = task.dueDate || '';
    const [datePart, timePart] = existing.includes('T') ? existing.split('T') : [existing, ''];
    setForm({
      title: task.title || '',
      notes: task.notes || '',
      status: task.status || 'todo',
      priority: task.priority || 'medium',
      category: task.category || '',
      tags: (task.tags || []).join(', '),
      dueDate: datePart,
      dueTime: timePart ? timePart.slice(0, 5) : '',
      projectId: task.projectId ? String(task.projectId) : '',
      parentTaskId: task.parentTaskId ? String(task.parentTaskId) : '',
      recurrence: task.recurrence || 'none',
    });
    setShowForm(true);
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

  const handleSaveNewTemplate = async () => {
    if (!templateForm.name.trim()) return;
    setSavingTemplate(true);
    try {
      const subtasks = templateForm.subtasks.split('\n').map(s => s.trim()).filter(Boolean).map(title => ({ title }));
      const tmpl = await api.post('/api/task-templates', {
        ...templateForm,
        subtasks,
      }).then(r => r.json());
      setTemplates(prev => [tmpl, ...prev]);
      setTemplateForm({ name: '', description: '', category: '', priority: 'medium', recurrence: 'none', tags: '', subtasks: '' });
      setShowNewTemplate(false);
    } catch (err) { console.error(err); }
    finally { setSavingTemplate(false); }
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
        case 'Escape':
          setShowForm(false);
          setExpandedId(null);
          setSelectedIds(new Set());
          setShowShortcuts(false);
          setShowTemplates(false);
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
            const next = prev === 'list' ? 'board' : 'list';
            localStorage.setItem('tasksViewMode', next);
            return next;
          });
          break;
        }
        case '1': setFilterStatus('todo'); break;
        case '2': setFilterStatus('in-progress'); break;
        case '3': setFilterStatus('done'); break;
        case '?': setShowShortcuts(true); break;
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
          className="group flex items-start gap-2 px-3 py-2.5 hover:opacity-90 transition-opacity"
          style={{ borderLeft: `3px solid ${PRIORITY_COLOR[task.priority]}` }}
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
                <button
                  onClick={() => handleToggleStatus(task)}
                  className="hover:opacity-60 p-0.5"
                  style={{ color: isDone ? '#22c55e' : 'var(--color-muted)' }}
                  title={isDone ? 'Mark as to do' : 'Mark as done'}
                >
                  {getIcon(isDone ? 'check-circle' : 'circle', { size: 13 })}
                </button>
                <button onClick={() => handleDuplicate(task)} style={{ color: 'var(--color-muted)' }} title="Duplicate" className="hover:opacity-60 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">{getIcon('copy', { size: 13 })}</button>
                <button onClick={() => openEdit(task)} style={{ color: 'var(--color-muted)' }} title="Edit" className="hover:opacity-60 p-0.5">{getIcon('edit', { size: 13 })}</button>
                <button onClick={() => setConfirmDeleteId(task.id)} style={{ color: 'var(--color-muted)' }} title="Delete" className="hover:opacity-60 p-0.5">{getIcon('trash', { size: 13 })}</button>
              </>
            )}
          </div>
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
    return (
      <div
        key={task.id}
        draggable
        onDragStart={(e) => handleDragStart(e, task)}
        onDragEnd={handleDragEnd}
        className="p-3 rounded-xl border cursor-grab active:cursor-grabbing select-none"
        style={{
          background: 'var(--color-bg)',
          borderColor: 'var(--color-border)',
          borderLeft: `3px solid ${PRIORITY_COLOR[task.priority]}`,
          opacity: isDone ? 0.7 : 1,
        }}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <span className="text-sm font-medium leading-snug" style={{ color: 'var(--color-text)', textDecoration: isDone ? 'line-through' : 'none', opacity: isDone ? 0.7 : 1 }}>{task.title}</span>
          <div className="flex gap-0.5 flex-shrink-0">
            <button onClick={() => handleToggleStatus(task)} style={{ color: isDone ? '#22c55e' : 'var(--color-muted)' }} title={isDone ? 'Unmark' : 'Done'} className="hover:opacity-60 p-0.5">{getIcon(isDone ? 'check-circle' : 'circle', { size: 13 })}</button>
            <button onClick={() => openEdit(task)} style={{ color: 'var(--color-muted)' }} className="hover:opacity-60 p-0.5">{getIcon('edit', { size: 12 })}</button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ background: PRIORITY_COLOR[task.priority] + '22', color: PRIORITY_COLOR[task.priority] }}>{PRIORITY_LABEL[task.priority]}</span>
          {due && <span className="text-xs font-medium" style={{ color: due.color }}>{due.label}</span>}
          {task.subtaskCount > 0 && <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'var(--color-surface)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>{task.subtaskDone}/{task.subtaskCount}</span>}
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Templates side panel */}
      {showTemplates && (
        <div className="w-72 flex-shrink-0 border-r flex flex-col overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
            <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Task Templates</span>
            <div className="flex gap-1.5">
              <button onClick={() => setShowNewTemplate(v => !v)} className="text-xs px-2 py-0.5 rounded-lg border" style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}>+ New</button>
              <button onClick={() => setShowTemplates(false)} className="hover:opacity-60" style={{ color: 'var(--color-muted)' }}>{getIcon('x', { size: 14 })}</button>
            </div>
          </div>
          {/* New template form */}
          {showNewTemplate && (
            <div className="border-b px-4 py-3 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
              <input value={templateForm.name} onChange={e => setTemplateForm(f => ({ ...f, name: e.target.value }))} placeholder="Template name *" className="w-full text-xs px-2 py-1.5 rounded-lg border outline-none" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
              <input value={templateForm.category} onChange={e => setTemplateForm(f => ({ ...f, category: e.target.value }))} placeholder="Category (optional)" className="w-full text-xs px-2 py-1.5 rounded-lg border outline-none" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
              <select value={templateForm.priority} onChange={e => setTemplateForm(f => ({ ...f, priority: e.target.value }))} className="w-full text-xs px-2 py-1.5 rounded-lg border outline-none" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                <option value="high">High priority</option>
                <option value="medium">Medium priority</option>
                <option value="low">Low priority</option>
              </select>
              <textarea value={templateForm.subtasks} onChange={e => setTemplateForm(f => ({ ...f, subtasks: e.target.value }))} placeholder="Subtasks (one per line)" rows={3} className="w-full text-xs px-2 py-1.5 rounded-lg border outline-none resize-none" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
              <div className="flex gap-2">
                <button onClick={handleSaveNewTemplate} disabled={savingTemplate || !templateForm.name.trim()} className="flex-1 text-xs py-1.5 rounded-lg font-medium text-white disabled:opacity-50" style={{ background: 'var(--color-primary)' }}>{savingTemplate ? 'Saving…' : 'Save'}</button>
                <button onClick={() => setShowNewTemplate(false)} className="text-xs px-3 py-1.5 rounded-lg border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>Cancel</button>
              </div>
            </div>
          )}
          <div className="flex-1 overflow-y-auto py-2">
            {templatesLoading ? (
              <div className="flex justify-center py-6" style={{ color: 'var(--color-muted)' }}>{getIcon('loader', { size: 16 })}</div>
            ) : templates.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs" style={{ color: 'var(--color-muted)' }}>No templates yet. Create one above or save a task as a template.</div>
            ) : (
              templates.map(tmpl => (
                <div key={tmpl.id} className="px-4 py-2.5 border-b hover:opacity-90" style={{ borderColor: 'var(--color-border)' }}>
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{tmpl.name}</span>
                    <div className="flex gap-0.5 flex-shrink-0">
                      <button onClick={() => handleApplyTemplate(tmpl.id)} className="text-xs px-1.5 py-0.5 rounded border font-medium" style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}>Apply</button>
                      <button onClick={() => handleDeleteTemplate(tmpl.id)} className="hover:opacity-60 p-0.5" style={{ color: 'var(--color-muted)' }}>{getIcon('trash', { size: 11 })}</button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <span className="text-xs px-1 py-0.5 rounded" style={{ background: PRIORITY_COLOR[tmpl.priority] + '22', color: PRIORITY_COLOR[tmpl.priority] }}>{PRIORITY_LABEL[tmpl.priority]}</span>
                    {tmpl.category && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{tmpl.category}</span>}
                    {tmpl.subtasks.length > 0 && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{tmpl.subtasks.length} subtask{tmpl.subtasks.length !== 1 ? 's' : ''}</span>}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
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
            onClick={() => { setShowTemplates(v => !v); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-all"
            style={{ borderColor: showTemplates ? 'var(--color-primary)' : 'var(--color-border)', color: showTemplates ? 'var(--color-primary)' : 'var(--color-muted)' }}
            title="Task Templates"
          >
            {getIcon('book', { size: 13 })} Templates
          </button>
          {/* View toggle */}
          <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
            <button
              onClick={() => { setViewMode('list'); localStorage.setItem('tasksViewMode', 'list'); }}
              className="px-2.5 py-1.5 text-xs transition-all"
              style={{ background: viewMode === 'list' ? 'var(--color-primary)' : 'transparent', color: viewMode === 'list' ? '#fff' : 'var(--color-muted)' }}
              title="List view (b)"
            >
              {getIcon('list-checks', { size: 13 })}
            </button>
            <button
              onClick={() => { setViewMode('board'); localStorage.setItem('tasksViewMode', 'board'); }}
              className="px-2.5 py-1.5 text-xs transition-all border-l"
              style={{ background: viewMode === 'board' ? 'var(--color-primary)' : 'transparent', color: viewMode === 'board' ? '#fff' : 'var(--color-muted)', borderColor: 'var(--color-border)' }}
              title="Board view (b)"
            >
              {getIcon('layout', { size: 13 })}
            </button>
          </div>
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
          <>
            <div className="flex-shrink-0 flex gap-3 px-6 py-3 border-b" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
              {[
                { label: 'Total Active', value: totalIncomplete, icon: 'list-checks', action: null },
                { label: 'Done This Week', value: completedThisWeek, icon: 'check-circle', action: () => setShowChart(v => !v) },
                { label: 'Overdue', value: overdueCount, icon: 'calendar', action: () => setQuickFilter('overdue'), color: overdueCount > 0 ? '#ef4444' : undefined },
                { label: 'High Priority', value: highPriorityCount, icon: 'tag', action: () => setQuickFilter('high'), color: highPriorityCount > 0 ? '#ef4444' : undefined },
              ].map(stat => (
                <button
                  key={stat.label}
                  onClick={stat.action || undefined}
                  disabled={!stat.action}
                  className={`flex-1 flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all ${stat.action ? 'hover:opacity-80 cursor-pointer' : 'cursor-default'}`}
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
                >
                  <span style={{ color: stat.color || 'var(--color-primary)' }}>{getIcon(stat.icon, { size: 16 })}</span>
                  <div className="text-left">
                    <div className="text-lg font-bold leading-none" style={{ color: stat.color || 'var(--color-text)' }}>{stat.value}</div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{stat.label}</div>
                  </div>
                </button>
              ))}
            </div>
            {/* 14-day completion chart */}
            {showChart && (
              <div className="flex-shrink-0 px-6 py-4 border-b" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Completion trend — last 14 days</span>
                  <button onClick={() => setShowChart(false)} className="hover:opacity-60" style={{ color: 'var(--color-muted)' }}>{getIcon('x', { size: 12 })}</button>
                </div>
                <div className="flex items-end gap-1" style={{ height: 64 }}>
                  {chartData.map(({ day, count }, i) => {
                    const isToday = day === todayStr;
                    const barH = Math.max(Math.round((count / chartMax) * 56), count > 0 ? 4 : 2);
                    return (
                      <div key={day} className="flex-1 flex flex-col items-center justify-end" style={{ height: 64 }}>
                        {count > 0 && <span className="text-xs leading-none mb-0.5" style={{ color: 'var(--color-muted)', fontSize: 9 }}>{count}</span>}
                        <div
                          className="w-full rounded-t"
                          style={{ height: barH, background: isToday ? 'var(--color-primary)' : 'var(--color-border)', opacity: count > 0 ? 1 : 0.4 }}
                          title={`${day}: ${count} completed`}
                        />
                        {(i === 0 || i === 6 || i === 13) && (
                          <span className="text-xs mt-1 leading-none" style={{ color: 'var(--color-muted)', fontSize: 9 }}>
                            {new Date(day + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
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
        <div className="flex-shrink-0 flex flex-wrap items-center gap-2 px-6 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
          {[
            { key: 'all', label: 'All' },
            { key: 'today', label: 'Today' },
            { key: 'week', label: 'This Week' },
            { key: 'high', label: 'High Priority' },
            { key: 'overdue', label: 'Overdue' },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setQuickFilter(f.key)}
              className="px-3 py-1 rounded-lg text-xs font-medium border transition-all"
              style={{
                background: quickFilter === f.key ? 'var(--color-primary)' : 'transparent',
                borderColor: quickFilter === f.key ? 'var(--color-primary)' : 'var(--color-border)',
                color: quickFilter === f.key ? '#fff' : 'var(--color-muted)',
              }}
            >{f.label}</button>
          ))}

          <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="text-xs px-2 py-1 rounded-lg border outline-none" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
            <option value="">All categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          <select value={filterProject} onChange={e => setFilterProject(e.target.value)} className="text-xs px-2 py-1 rounded-lg border outline-none" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
            <option value="">All projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>

          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="text-xs px-2 py-1 rounded-lg border outline-none" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
            <option value="active">To Do + In Progress</option>
            <option value="todo">To Do</option>
            <option value="in-progress">In Progress</option>
            <option value="done">Done</option>
            <option value="all">All</option>
          </select>

          <div className="relative flex-1 min-w-[160px]">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-muted)' }}>{getIcon('search', { size: 12 })}</span>
            <input
              ref={searchInputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search tasks…"
              className="w-full pl-7 pr-3 py-1 rounded-lg border text-xs outline-none"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            />
          </div>

          <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="text-xs px-2 py-1 rounded-lg border outline-none" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
            <option value="due">Sort: Due Date</option>
            <option value="priority">Sort: Priority</option>
            <option value="created">Sort: Created</option>
            <option value="az">Sort: A–Z</option>
            <option value="za">Sort: Z–A</option>
          </select>
        </div>

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
                const columnTasks = sortTasks(filtered.filter(t => t.status === status));
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
      </div>

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
                  <div className="flex gap-2">
                    <input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} className="flex-1 px-3 py-2 rounded-lg border text-sm outline-none" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                    <input type="time" value={form.dueTime} onChange={e => setForm(f => ({ ...f, dueTime: e.target.value }))} className="w-24 px-3 py-2 rounded-lg border text-sm outline-none" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                  </div>
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
    </div>
  );
}
