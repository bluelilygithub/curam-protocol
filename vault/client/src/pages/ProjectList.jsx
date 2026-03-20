import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import useProjectStore from '../store/projectStore';
import { useIcon } from '../providers/IconProvider';
import NewProjectModal from '../components/NewProjectModal';
import { getModelShortName } from '../utils/models';
import api from '../utils/apiClient';
import CheckinModal from '../components/mood/CheckinModal';

const EMOTION_COLOURS = {
  joy: '#C9A84C', trust: '#6B9E70', fear: '#507A60', surprise: '#6B97B5',
  sadness: '#5B6FAD', disgust: '#8A5C8A', anger: '#A85C5C', anticipation: '#C48B3C',
};

function GoalsWidget() {
  const getIcon = useIcon();
  const [dashboard, setDashboard] = useState(null);

  useEffect(() => {
    api.get('/api/goals/dashboard').then(r => r.json()).then(setDashboard).catch(() => {});
  }, []);

  if (!dashboard || dashboard.activeCount === 0) return null;

  const pctColor = (p) => p >= 70 ? '#22c55e' : p >= 30 ? '#f59e0b' : '#ef4444';

  return (
    <div className="mb-6 rounded-2xl border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {getIcon('target', { size: 14, style: { color: 'var(--color-primary)' } })}
          <span className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Goals</span>
          <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}>{dashboard.activeCount} active</span>
          {dashboard.avgProgress > 0 && (
            <span className="text-xs font-semibold" style={{ color: pctColor(dashboard.avgProgress) }}>{dashboard.avgProgress}% avg</span>
          )}
        </div>
        <Link to="/goals" className="text-xs hover:opacity-70 transition-opacity" style={{ color: 'var(--color-primary)' }}>
          View all →
        </Link>
      </div>
      <div className="flex flex-col gap-2">
        {dashboard.topObjectives.map(obj => (
          <div key={obj.id}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs truncate" style={{ color: 'var(--color-text)', maxWidth: '70%' }}>{obj.title}</span>
              <span className="text-xs font-semibold" style={{ color: pctColor(obj.overallProgress) }}>{obj.overallProgress}%</span>
            </div>
            <div style={{ height: 4, borderRadius: 2, background: 'var(--color-border)', overflow: 'hidden' }}>
              <div style={{ width: `${obj.overallProgress}%`, height: '100%', background: obj.color || 'var(--color-primary)', borderRadius: 2, transition: 'width 0.3s' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TasksWidget() {
  const getIcon = useIcon();
  const [tasks, setTasks] = useState([]);
  const [quickInput, setQuickInput] = useState('');
  const [showAI, setShowAI] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiMessage, setAiMessage] = useState('');
  const [newlyAddedIds, setNewlyAddedIds] = useState(new Set());
  const navigate = useNavigate();

  const refreshTasks = useCallback(async () => {
    try {
      const data = await api.get('/api/tasks').then(r => r.json());
      const order = { high: 1, medium: 2, low: 3 };
      const incomplete = data.filter(t => t.status !== 'done').sort((a, b) => {
        if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
        if (a.dueDate) return -1;
        if (b.dueDate) return 1;
        return (order[a.priority] || 2) - (order[b.priority] || 2);
      });
      return incomplete.slice(0, 5);
    } catch { return []; }
  }, []);

  useEffect(() => {
    refreshTasks().then(setTasks);
  }, [refreshTasks]);

  const handleQuickAdd = async (e) => {
    if (e.key !== 'Enter' || !quickInput.trim()) return;
    try {
      const task = await api.post('/api/tasks', { title: quickInput.trim(), priority: 'medium' }).then(r => r.json());
      setTasks(prev => [task, ...prev].slice(0, 5));
      setQuickInput('');
    } catch { /* ignore */ }
  };

  const handleAiGenerate = async () => {
    if (!aiPrompt.trim()) return;
    setAiGenerating(true); setAiMessage('');
    try {
      const created = await api.post('/api/tasks/ai-generate', { prompt: aiPrompt.trim() }).then(r => r.json());
      const freshTasks = await refreshTasks();
      setTasks(freshTasks);
      const newIds = new Set(created.map(t => t.id));
      setNewlyAddedIds(newIds);
      setTimeout(() => setNewlyAddedIds(new Set()), 2000);
      setAiMessage(`✓ ${created.length} task${created.length !== 1 ? 's' : ''} created`);
      setAiPrompt('');
    } catch { setAiMessage('Failed'); }
    finally { setAiGenerating(false); }
  };

  const handleCompleteTask = async (e, taskId) => {
    e.stopPropagation();
    await api.put(`/api/tasks/${taskId}`, { status: 'done' }).catch(() => {});
    const fresh = await refreshTasks();
    setTasks(fresh);
  };

  const priorityColor = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' };

  function dueLabel(dateStr) {
    if (!dateStr) return null;
    const datePart = dateStr.includes('T') ? dateStr.slice(0, 10) : dateStr;
    const d = new Date(datePart + 'T00:00:00');
    const today = new Date(); today.setHours(0,0,0,0);
    const diff = Math.round((d - today) / 86400000);
    if (diff < 0) return { text: 'Overdue', color: '#ef4444' };
    if (diff === 0) return { text: 'Today', color: '#f59e0b' };
    return { text: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), color: 'var(--color-muted)' };
  }

  return (
    <div className="rounded-2xl border mb-6" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex items-center gap-2">
          <span style={{ color: 'var(--color-primary)' }}>{getIcon('list-checks', { size: 15 })}</span>
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>My Tasks</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setShowAI(v => !v); setAiMessage(''); }}
            className="w-6 h-6 flex items-center justify-center rounded-md hover:opacity-60 transition-opacity"
            style={{ color: 'var(--color-muted)' }}
            title="Ask Claude to generate tasks"
          >
            {getIcon('wand', { size: 13 })}
          </button>
          <Link to="/tasks" className="text-xs hover:opacity-70" style={{ color: 'var(--color-primary)' }}>View all</Link>
        </div>
      </div>

      {tasks.length > 0 && (() => {
        const now2 = new Date();
        const ws = new Date(now2); ws.setHours(0,0,0,0); ws.setDate(now2.getDate() - ((now2.getDay()+6)%7));
        const we = new Date(ws); we.setDate(ws.getDate()+7);
        const todayS = now2.toISOString().slice(0,10);
        const doneWk = tasks.filter(t => { if(t.status!=='done') return false; const u=new Date(t.updatedAt); return u>=ws&&u<we; }).length;
        const ov = tasks.filter(t => t.status!=='done' && t.dueDate && t.dueDate.slice(0,10)<todayS).length;
        if (!doneWk && !ov) return null;
        return (
          <div className="px-4 py-1.5 border-b text-xs" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
            {doneWk > 0 && <span style={{ color: '#22c55e' }}>{doneWk} done this week</span>}
            {doneWk > 0 && ov > 0 && <span> · </span>}
            {ov > 0 && <span style={{ color: '#ef4444' }}>{ov} overdue</span>}
          </div>
        );
      })()}

      {showAI && (
        <div className="px-4 py-3 border-b space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
          <input
            autoFocus
            value={aiPrompt}
            onChange={e => setAiPrompt(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAiGenerate()}
            placeholder="What do you need to get done?"
            className="w-full px-3 py-2 rounded-lg border text-xs outline-none"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleAiGenerate}
              disabled={aiGenerating || !aiPrompt.trim()}
              className="flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium text-white disabled:opacity-50"
              style={{ background: 'var(--color-primary)' }}
            >
              {aiGenerating ? getIcon('loader', { size: 11, color: 'white' }) : getIcon('sparkles', { size: 11, color: 'white' })}
              {aiGenerating ? 'Generating…' : 'Generate'}
            </button>
            {aiMessage && <span className="text-xs" style={{ color: aiMessage.startsWith('✓') ? '#22c55e' : '#ef4444' }}>{aiMessage}</span>}
          </div>
        </div>
      )}

      <div>
        {tasks.length === 0 ? (
          <p className="text-xs text-center py-4" style={{ color: 'var(--color-muted)' }}>No tasks — add one below or <button onClick={() => navigate('/tasks')} className="underline" style={{ color: 'var(--color-primary)' }}>open Tasks</button></p>
        ) : tasks.map(task => {
          const due = dueLabel(task.dueDate);
          return (
            <div
              key={task.id}
              className="w-full flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0"
              style={{
                borderColor: 'var(--color-border)',
                borderLeft: `3px solid ${priorityColor[task.priority] || '#f59e0b'}`,
                transition: 'background 0.5s ease',
                background: newlyAddedIds.has(task.id) ? 'var(--color-primary)15' : 'transparent',
              }}
            >
              <button
                onClick={(e) => handleCompleteTask(e, task.id)}
                className="flex-shrink-0 hover:opacity-70"
                style={{ color: 'var(--color-muted)' }}
                title="Mark done"
              >
                {getIcon('circle', { size: 13 })}
              </button>
              <button
                onClick={() => navigate('/tasks')}
                className="flex-1 text-left truncate"
              >
                <span className="text-xs" style={{ color: 'var(--color-text)' }}>{task.title}</span>
              </button>
              {due && <span className="text-xs flex-shrink-0" style={{ color: due.color }}>{due.text}</span>}
            </div>
          );
        })}
      </div>

      <div className="px-4 py-2.5 border-t" style={{ borderColor: 'var(--color-border)' }}>
        <input
          value={quickInput}
          onChange={e => setQuickInput(e.target.value)}
          onKeyDown={handleQuickAdd}
          placeholder="Quick add task… (press Enter)"
          className="w-full text-xs outline-none bg-transparent"
          style={{ color: 'var(--color-text)' }}
        />
      </div>
    </div>
  );
}

function ProjectList() {
  const { projects, fetchProjects, create, setActive, reorder, remove, archive, unarchive } = useProjectStore();
  const [showModal, setShowModal] = useState(false);
  const [draggedId, setDraggedId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [showArchive, setShowArchive] = useState(false);
  const [archivedProjects, setArchivedProjects] = useState([]);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [toast, setToast] = useState(null); // { message, action?: { label, fn } }
  const toastTimer = useRef(null);
  const [moodMap, setMoodMap] = useState(null);
  const [feelingModalProjectId, setFeelingModalProjectId] = useState(null);

  const showToast = (message, action) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, action });
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  };

  // Fetch archived count on mount (for the "View archived" link)
  const fetchArchived = useCallback(async () => {
    setArchivedLoading(true);
    try {
      const res = await api.get('/api/projects?archived=true');
      const data = await res.json();
      setArchivedProjects(data);
    } catch {}
    setArchivedLoading(false);
  }, []);

  useEffect(() => {
    fetchProjects();
    fetchArchived();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (projects.length === 0) { setMoodMap({}); return; }
    const entities = projects.map(p => ({ entityType: 'project', entityId: String(p.id) }));
    api.post('/api/mood/dominant/batch', { entities })
      .then(r => r.json())
      .then(batch => {
        const map = {};
        for (const p of projects) map[`project:${p.id}`] = batch[`project:${p.id}`] || null;
        setMoodMap(map);
      })
      .catch(() => setMoodMap({}));
  }, [projects]);

  const refreshProjectMood = (pid) => {
    api.get(`/api/mood/dominant/project/${pid}`)
      .then(r => r.json())
      .then(d => setMoodMap(prev => ({
        ...prev,
        [`project:${pid}`]: d.coreEmotion ? d : null,
      })))
      .catch(() => {});
  };

  const handleConfirmDelete = async () => {
    await remove(deleteTarget.id);
    setDeleteTarget(null);
  };

  const handleConfirmArchive = async () => {
    const project = archiveTarget;
    setArchiveTarget(null);
    await archive(project.id);
    await fetchArchived();
    showToast(`"${project.name}" archived`, {
      label: 'View archive',
      fn: () => setShowArchive(true),
    });
  };

  const handleUnarchive = async (project) => {
    await unarchive(project.id);
    setArchivedProjects(prev => prev.filter(p => p.id !== project.id));
    showToast(`"${project.name}" restored to workspace`);
  };

  const handleDrop = (targetId) => {
    if (!draggedId || draggedId === targetId) return;
    const ids = projects.map(p => p.id);
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(targetId);
    const reordered = [...ids];
    reordered.splice(from, 1);
    reordered.splice(to, 0, draggedId);
    reorder(reordered);
    setDraggedId(null);
    setDragOverId(null);
  };

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const getIcon = useIcon();

  // Open archive view directly when navigated here with ?archive=1
  useEffect(() => {
    if (searchParams.get('archive') === '1') setShowArchive(true);
  }, [searchParams]);

  const handleCreate = async (data) => {
    const project = await create(data);
    setShowModal(false);
    navigate(`/projects/${project.id}`);
  };

  // ── Archive view ─────────────────────────────────────────────────────────────
  if (showArchive) {
    return (
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={() => setShowArchive(false)}
              className="flex items-center gap-1.5 text-sm hover:opacity-70 transition-opacity"
              style={{ color: 'var(--color-muted)' }}
            >
              {getIcon('chevron-left', { size: 14 })}
              Back to projects
            </button>
          </div>

          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Archived Projects</h1>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                Archived projects are hidden from your workspace. All data is preserved.
              </p>
            </div>
          </div>

          {archivedLoading ? (
            <p className="text-sm text-center py-12" style={{ color: 'var(--color-muted)' }}>Loading…</p>
          ) : archivedProjects.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No archived projects.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {archivedProjects.map(project => (
                <div key={project.id} className="relative group rounded-xl border overflow-hidden" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', opacity: 0.75 }}>
                  <button
                    onClick={() => { setActive(project.id); navigate(`/projects/${project.id}`); }}
                    className="w-full text-left p-4"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}>
                          {getIcon('folder', { size: 15 })}
                        </div>
                        <span className="text-xs font-medium px-1.5 py-0.5 rounded" style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}>
                          Archived
                        </span>
                      </div>
                      <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                        {new Date(project.archived_at).toLocaleDateString()}
                      </span>
                    </div>
                    <h3 className="font-medium text-sm mb-1 truncate" style={{ color: 'var(--color-muted)' }}>
                      {project.name}
                    </h3>
                    {project.goal ? (
                      <p className="text-xs line-clamp-2" style={{ color: 'var(--color-muted)', opacity: 0.7 }}>{project.goal}</p>
                    ) : (
                      <p className="text-xs italic" style={{ color: 'var(--color-muted)', opacity: 0.5 }}>No description</p>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      {project.chatCount > 0 && (
                        <span className="text-xs" style={{ color: 'var(--color-muted)', opacity: 0.6 }}>
                          {project.chatCount} {project.chatCount === 1 ? 'chat' : 'chats'}
                        </span>
                      )}
                    </div>
                  </button>
                  <div className="px-4 pb-3">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleUnarchive(project); }}
                      className="w-full px-3 py-1.5 rounded-lg border text-xs font-medium transition-opacity hover:opacity-70"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-bg)' }}
                    >
                      Unarchive
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Toast */}
        {toast && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium text-white z-50"
            style={{ background: 'var(--color-primary)' }}>
            <span>{toast.message}</span>
            {toast.action && (
              <button onClick={() => { toast.action.fn(); setToast(null); }} className="underline opacity-80 hover:opacity-100 text-xs">
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Active projects view ──────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {showModal && <NewProjectModal onClose={() => setShowModal(false)} onCreate={handleCreate} />}

      {feelingModalProjectId && (() => {
        const proj = projects.find(p => p.id === feelingModalProjectId);
        return (
          <CheckinModal
            entityType="project"
            entityId={feelingModalProjectId}
            entityTitle={proj?.name || 'Project'}
            onClose={() => setFeelingModalProjectId(null)}
            onSave={() => { setFeelingModalProjectId(null); refreshProjectMood(feelingModalProjectId); }}
          />
        );
      })()}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }}>
          <div className="w-full max-w-sm mx-4 rounded-2xl border shadow-xl p-6" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Delete "{deleteTarget.name}"?</h3>
            <p className="text-xs mb-5" style={{ color: 'var(--color-muted)' }}>
              This will permanently delete the project
              {deleteTarget.chatCount > 0 && `, all ${deleteTarget.chatCount} chat session${deleteTarget.chatCount === 1 ? '' : 's'}`}
              , all uploaded files, and all messages. This cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 rounded-xl text-xs border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Cancel</button>
              <button onClick={handleConfirmDelete} className="px-4 py-2 rounded-xl text-xs font-medium text-white bg-red-500 hover:opacity-80 transition-opacity">Delete project</button>
            </div>
          </div>
        </div>
      )}

      {/* Archive confirmation */}
      {archiveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }}>
          <div className="w-full max-w-sm mx-4 rounded-2xl border shadow-xl p-6" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Archive "{archiveTarget.name}"?</h3>
            <p className="text-xs mb-5" style={{ color: 'var(--color-muted)' }}>
              It will be hidden from your workspace but all data will be kept. You can unarchive it at any time.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setArchiveTarget(null)} className="px-4 py-2 rounded-xl text-xs border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Cancel</button>
              <button onClick={handleConfirmArchive} className="px-4 py-2 rounded-xl text-xs font-medium text-white transition-opacity hover:opacity-80" style={{ background: 'var(--color-primary)' }}>Archive project</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium text-white z-50"
          style={{ background: 'var(--color-primary)' }}>
          <span>{toast.message}</span>
          {toast.action && (
            <button onClick={() => { toast.action.fn(); setToast(null); }} className="underline opacity-80 hover:opacity-100 text-xs">
              {toast.action.label}
            </button>
          )}
        </div>
      )}

      {projects.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6 pb-16">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center mb-5"
            style={{ background: 'var(--color-surface)', color: 'var(--color-primary)' }}
          >
            {getIcon('folder', { size: 24 })}
          </div>
          <h1 className="text-2xl font-semibold mb-2" style={{ color: 'var(--color-text)' }}>
            Welcome to Project Vault
          </h1>
          <p className="text-sm mb-8 text-center max-w-xs" style={{ color: 'var(--color-muted)' }}>
            Create a project to give Claude focused context for your work.
          </p>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80"
            style={{ background: 'var(--color-primary)' }}
          >
            {getIcon('plus', { size: 14, color: 'white' })}
            New Project
          </button>
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-4xl mx-auto">
            <GoalsWidget />
            <TasksWidget />
            <div className="flex items-center justify-between mb-6">
              <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Projects</h1>
              <button
                onClick={() => setShowModal(true)}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-80"
                style={{ background: 'var(--color-primary)' }}
              >
                {getIcon('plus', { size: 13, color: 'white' })}
                New
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {projects.map((project) => (
                <div
                  key={project.id}
                  draggable
                  onDragStart={(e) => { setDraggedId(project.id); e.dataTransfer.effectAllowed = 'move'; }}
                  onDragOver={(e) => { e.preventDefault(); if (project.id !== draggedId) setDragOverId(project.id); }}
                  onDrop={(e) => { e.preventDefault(); handleDrop(project.id); }}
                  onDragEnd={() => { setDraggedId(null); setDragOverId(null); }}
                  className="relative group rounded-xl border overflow-hidden transition-all hover:shadow-sm"
                  style={{
                    opacity: draggedId === project.id ? 0.4 : 1,
                    outline: dragOverId === project.id ? '2px solid var(--color-primary)' : 'none',
                    background: 'var(--color-surface)',
                    borderColor: 'var(--color-border)',
                    cursor: 'grab',
                  }}
                >
                  <button
                    onClick={() => { setActive(project.id); navigate(`/projects/${project.id}`); }}
                    className="w-full text-left p-4"
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center"
                        style={{ background: 'var(--color-bg)', color: 'var(--color-primary)' }}
                      >
                        {getIcon('folder', { size: 15 })}
                      </div>
                      <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                        {new Date(project.updatedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <h3 className="font-medium text-sm mb-1 truncate" style={{ color: 'var(--color-text)' }}>
                      {project.name}
                    </h3>
                    {project.goal ? (
                      <p className="text-xs line-clamp-2" style={{ color: 'var(--color-muted)' }}>{project.goal}</p>
                    ) : (
                      <p className="text-xs italic" style={{ color: 'var(--color-muted)' }}>No description</p>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      {project.model && (
                        <span className="text-xs" style={{ color: 'var(--color-muted)', opacity: 0.8 }}>
                          {getModelShortName(project.model)}
                        </span>
                      )}
                      {project.chatCount > 0 && (
                        <span className="text-xs ml-auto" style={{ color: 'var(--color-muted)', opacity: 0.7 }}>
                          {project.chatCount} {project.chatCount === 1 ? 'chat' : 'chats'}
                        </span>
                      )}
                    </div>
                  </button>

                  {/* Mood row — full width, own row at bottom of card */}
                  {moodMap !== null && (() => {
                    const dominant = moodMap[`project:${project.id}`];
                    const color = dominant ? (EMOTION_COLOURS[dominant.coreEmotion] || '#888') : null;
                    return (
                      <div className="px-4 py-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); setFeelingModalProjectId(project.id); }}
                          className="flex items-center gap-2 hover:opacity-70 transition-opacity"
                        >
                          <span
                            className="w-6 h-6 rounded-full flex-shrink-0"
                            style={{
                              background: color || 'transparent',
                              border: dominant ? 'none' : '1.5px dashed var(--color-muted)',
                            }}
                          />
                          <span className="text-xs capitalize" style={{ color: 'var(--color-muted)' }}>
                            {dominant ? dominant.coreEmotion : 'Log feeling'}
                          </span>
                        </button>
                      </div>
                    );
                  })()}

                  {/* Hover action buttons */}
                  <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setArchiveTarget(project); }}
                      className="w-6 h-6 flex items-center justify-center rounded-lg"
                      style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}
                      title="Archive project"
                    >
                      {getIcon('archive', { size: 12 })}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(project); }}
                      className="w-6 h-6 flex items-center justify-center rounded-lg"
                      style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}
                      title="Delete project"
                    >
                      {getIcon('trash', { size: 12 })}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* View archived link */}
            {archivedProjects.length > 0 && (
              <div className="mt-8 text-center">
                <button
                  onClick={() => setShowArchive(true)}
                  className="text-xs hover:opacity-70 transition-opacity"
                  style={{ color: 'var(--color-muted)' }}
                >
                  View archived projects ({archivedProjects.length})
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ProjectList;
