import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import useProjectStore from '../store/projectStore';
import { useIcon } from '../providers/IconProvider';
import NewProjectModal from '../components/NewProjectModal';
import { getModelShortName } from '../utils/models';
import api from '../utils/apiClient';

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
    const d = new Date(dateStr + 'T00:00:00');
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
  const { projects, fetchProjects, create, setActive, reorder, remove } = useProjectStore();
  const [showModal, setShowModal] = useState(false);
  const [draggedId, setDraggedId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const handleConfirmDelete = async () => {
    await remove(deleteTarget.id);
    setDeleteTarget(null);
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
  const getIcon = useIcon();

  useEffect(() => { fetchProjects(); }, []);

  const handleCreate = async (data) => {
    const project = await create(data);
    setShowModal(false);
    navigate(`/projects/${project.id}`);
  };

  return (
    <div className="flex flex-col h-full">
      {showModal && <NewProjectModal onClose={() => setShowModal(false)} onCreate={handleCreate} />}

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
                  className="relative group"
                  style={{
                    opacity: draggedId === project.id ? 0.4 : 1,
                    outline: dragOverId === project.id ? '2px solid var(--color-primary)' : 'none',
                    borderRadius: '12px',
                    cursor: 'grab',
                  }}
                >
                <button
                  onClick={() => { setActive(project.id); navigate(`/projects/${project.id}`); }}
                  className="w-full text-left p-4 rounded-xl border transition-all hover:shadow-sm"
                  style={{
                    background: 'var(--color-surface)',
                    borderColor: 'var(--color-border)',
                    cursor: 'pointer',
                  }}
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
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setDeleteTarget(project); }}
                  className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}
                  title="Delete project"
                >
                  {getIcon('trash', { size: 12 })}
                </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ProjectList;
