import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import useProjectStore from '../store/projectStore';
import { useIcon } from '../providers/IconProvider';
import NewProjectModal from './NewProjectModal';
import api from '../utils/apiClient';
import { formatSessionLabel } from '../utils/sessionDisplay';

function ProjectSidebar({ onClose, showHabits = true, collapsed = false }) {
  const { projects, activeProjectId, fetchProjects, setActive, create, update, reorder, remove, archive } = useProjectStore();
  const [showModal, setShowModal] = useState(false);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef(null);
  const [draggedId, setDraggedId] = useState(null);
  const [draggedSessionId, setDraggedSessionId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [dragOverFolderId, setDragOverFolderId] = useState(null);
  const [dragOverProjectId, setDragOverProjectId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [moveSessionTarget, setMoveSessionTarget] = useState(null);
  const [moveSessionProjectId, setMoveSessionProjectId] = useState('');
  const [moveSessionSaving, setMoveSessionSaving] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const getIcon = useIcon();
  const [folders, setFolders] = useState([]);
  const [collapsedFolders, setCollapsedFolders] = useState({});
  const [showFolderInput, setShowFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [generalSessions, setGeneralSessions] = useState([]);
  const [generalExpanded, setGeneralExpanded] = useState(true);
  const [expandedProjectId, setExpandedProjectId] = useState(() => {
    const match = window.location.pathname.match(/\/projects\/(\d+)/);
    return match ? Number(match[1]) : null;
  });
  const [projectSessions, setProjectSessions] = useState({});
  const [habitsOpen, setHabitsOpen] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sidebarHabitsOpen') ?? 'false'); } catch { return false; }
  });
  const [clientOpen, setClientOpen] = useState(false);
  const [touchpointForm, setTouchpointForm] = useState(null); // null | { type, date, note }
  const [tpSaving, setTpSaving] = useState(false);

  useEffect(() => {
    const loadSessionLists = () => {
      fetchProjects();
      api.get('/api/folders').then(r => r.json()).then(setFolders).catch(() => {});
      api.get('/api/chat/sessions/general').then(r => r.json()).then(setGeneralSessions).catch(() => {});
      if (expandedProjectId) {
        api.get(`/api/chat/sessions/${expandedProjectId}`)
          .then(r => r.json())
          .then(sessions => setProjectSessions(prev => ({ ...prev, [expandedProjectId]: sessions })))
          .catch(() => {});
      }
    };

    loadSessionLists();
    document.addEventListener('vault:sessions-changed', loadSessionLists);
    return () => document.removeEventListener('vault:sessions-changed', loadSessionLists);
  }, [expandedProjectId, fetchProjects]);

  // Tour: expand 7 Habits section on request
  useEffect(() => {
    const handler = () => {
      setHabitsOpen(true);
      localStorage.setItem('sidebarHabitsOpen', 'true');
    };
    document.addEventListener('vault:expand-habits-sidebar', handler);
    return () => document.removeEventListener('vault:expand-habits-sidebar', handler);
  }, []);

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    await api.post('/api/folders', { name: newFolderName.trim() });
    setNewFolderName('');
    setShowFolderInput(false);
    api.get('/api/folders').then(r => r.json()).then(setFolders).catch(() => {});
  };

  const toggleFolder = (folderId) => setCollapsedFolders(prev => ({ ...prev, [folderId]: !prev[folderId] }));

  const toggleProjectSessions = (projectId) => {
    const opening = expandedProjectId !== projectId;
    setExpandedProjectId(opening ? projectId : null);
    if (opening && !projectSessions[projectId]) {
      api.get(`/api/chat/sessions/${projectId}`)
        .then(r => r.json())
        .then(sessions => setProjectSessions(prev => ({ ...prev, [projectId]: sessions })))
        .catch(() => {});
    }
  };

  const enterProject = async (projectId) => {
    setActive(projectId);
    let sessions = projectSessions[projectId];
    if (!sessions) {
      sessions = await api.get(`/api/chat/sessions/${projectId}`).then(r => r.json()).catch(() => []);
      setProjectSessions(prev => ({ ...prev, [projectId]: sessions }));
    }
    navigate(`/projects/${projectId}/chat`);
    if (onClose) onClose();
    setTimeout(() => {
      if (sessions?.length > 0) {
        document.dispatchEvent(new CustomEvent('vault:load-session', { detail: sessions[0].sessionId }));
      } else {
        document.dispatchEvent(new CustomEvent('vault:new-chat'));
      }
    }, 80);
  };

  const startQuickChat = () => {
    document.dispatchEvent(new CustomEvent('vault:new-chat'));
    navigate('/chat');
    if (onClose) onClose();
  };

  const handleDragStart = (e, id) => { setDraggedId(id); e.dataTransfer.effectAllowed = 'move'; };
  const handleSessionDragStart = (e, sessionId) => {
    setDraggedSessionId(sessionId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', sessionId);
  };
  const handleDragOver = (e, id) => { e.preventDefault(); if (id !== draggedId) setDragOverId(id); };
  const handleDrop = (e, targetId) => {
    e.preventDefault();
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
  const handleDragEnd = () => {
    setDraggedId(null);
    setDraggedSessionId(null);
    setDragOverId(null);
    setDragOverFolderId(null);
    setDragOverProjectId(null);
  };

  const moveSessionToProject = async (sessionId, projectId) => {
    if (!sessionId || !projectId) return;
    await api.patch(`/api/chat/sessions/${sessionId}/project`, { projectId });
    await fetchProjects();
    const sessions = await api.get('/api/chat/sessions/general').then(r => r.json());
    const targetSessions = await api.get(`/api/chat/sessions/${projectId}`).then(r => r.json()).catch(() => []);
    setGeneralSessions(sessions);
    setProjectSessions(prev => ({ ...prev, [projectId]: targetSessions }));
    document.dispatchEvent(new CustomEvent('vault:sessions-changed'));
  };

  const handleProjectDragOver = (e, projectId) => {
    if (draggedSessionId) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDragOverProjectId(projectId);
      return;
    }
    handleDragOver(e, projectId);
  };

  const handleProjectDrop = async (e, projectId) => {
    if (draggedSessionId) {
      e.preventDefault();
      e.stopPropagation();
      const sid = draggedSessionId;
      setDraggedSessionId(null);
      setDragOverProjectId(null);
      await moveSessionToProject(sid, projectId);
      setExpandedProjectId(projectId);
      return;
    }
    handleDrop(e, projectId);
  };

  const openMoveSessionModal = (session) => {
    setMoveSessionTarget(session);
    setMoveSessionProjectId(projects[0]?.id ? String(projects[0].id) : '');
  };

  const confirmMoveSession = async () => {
    if (!moveSessionTarget || !moveSessionProjectId) return;
    setMoveSessionSaving(true);
    try {
      const targetProjectId = Number(moveSessionProjectId);
      await moveSessionToProject(moveSessionTarget.sessionId, targetProjectId);
      setExpandedProjectId(targetProjectId);
      setMoveSessionTarget(null);
      setMoveSessionProjectId('');
    } finally {
      setMoveSessionSaving(false);
    }
  };

  const handleFolderDrop = async (e, folderId) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggedId) return;
    const id = draggedId;
    setDragOverFolderId(null);
    setDraggedId(null);
    setDragOverId(null);
    await update(id, { folderId });
    await fetchProjects();
    // Expand the folder so the project is visible
    if (folderId) setCollapsedFolders(prev => ({ ...prev, [folderId]: false }));
  };

  const handleCreate = async (data) => {
    const project = await create(data);
    setShowModal(false);
    navigate(`/projects/${project.id}`);
  };

  const startRename = (e, project) => {
    e.stopPropagation();
    setRenamingId(project.id);
    setRenameValue(project.name);
    setTimeout(() => renameInputRef.current?.focus(), 0);
  };

  const saveRename = async (id) => {
    if (renameValue.trim()) {
      await update(id, { name: renameValue.trim() });
    }
    setRenamingId(null);
  };

  const isGeneralActive = location.pathname === '/chat';

  if (collapsed) {
    const railItems = [
      { icon: 'message-circle', title: 'Quick chat', action: startQuickChat, active: location.pathname === '/chat' },
      { icon: 'home', title: 'Home', action: () => navigate('/'), active: location.pathname === '/' },
      { icon: 'list-checks', title: 'Tasks', action: () => navigate('/tasks'), active: location.pathname === '/tasks' },
      { icon: 'clock', title: 'Chat History', action: () => navigate('/history'), active: location.pathname === '/history' },
      { icon: 'settings', title: 'Settings', action: () => navigate('/settings'), active: location.pathname === '/settings' },
    ];

    // Fixed-position tooltip state — CSS ::after can't escape overflow:hidden on the sidebar
    const [railTip, setRailTip] = useState(null);

    return (
      <div className="flex flex-col h-full w-full items-center py-3 gap-1">
        {railItems.map(item => (
          <button
            key={item.title}
            onClick={item.action}
            onMouseEnter={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setRailTip({ label: item.title, top: r.top + r.height / 2, left: r.right + 8 });
            }}
            onMouseLeave={() => setRailTip(null)}
            className="w-9 h-9 flex items-center justify-center rounded-lg hover:opacity-60 transition-opacity"
            style={{ color: item.active ? 'var(--color-primary)' : 'var(--color-muted)' }}
          >
            {getIcon(item.icon, { size: 16 })}
          </button>
        ))}
        {railTip && (
          <div
            style={{
              position: 'fixed',
              top: railTip.top,
              left: railTip.left,
              transform: 'translateY(-50%)',
              background: 'var(--color-text)',
              color: 'var(--color-bg)',
              fontSize: 11,
              padding: '3px 8px',
              borderRadius: 5,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              zIndex: 9999,
            }}
          >
            {railTip.label}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full">
      {/* Quick chat section */}
      <div className="px-2 pt-2 pb-1">
        <div className="flex items-center gap-1">
          <button
            onClick={startQuickChat}
            className="flex-1 flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors text-left"
            style={{
              background: isGeneralActive ? 'var(--color-bg)' : 'transparent',
              color: isGeneralActive ? 'var(--color-primary)' : 'var(--color-text)',
              fontWeight: isGeneralActive ? 500 : 400,
            }}
          >
            <span style={{ flexShrink: 0, opacity: isGeneralActive ? 1 : 0.5 }}>
              {getIcon('message-circle', { size: 14 })}
            </span>
            <span className="flex-1 truncate">Quick chat</span>
            {generalSessions.length > 0 && (
              <span
                onClick={(e) => { e.stopPropagation(); setGeneralExpanded(v => !v); }}
                className="text-xs tabular-nums hover:opacity-60 cursor-pointer"
                style={{ color: 'var(--color-muted)' }}
              >
                {generalSessions.length}
              </span>
            )}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); startQuickChat(); }}
            className="w-6 h-6 flex items-center justify-center rounded-md hover:opacity-60 transition-opacity flex-shrink-0"
            style={{ color: 'var(--color-primary)' }}
            data-tip="New quick chat"
          >
            {getIcon('plus', { size: 14 })}
          </button>
        </div>
        {generalExpanded && generalSessions.length > 0 && (
          <div className="mt-0.5 space-y-0.5 max-h-52 overflow-y-auto pr-1">
            {generalSessions.map(s => (
              <div
                key={s.sessionId}
                draggable
                onDragStart={(e) => handleSessionDragStart(e, s.sessionId)}
                onDragEnd={handleDragEnd}
                className="group flex items-center gap-1 rounded-md"
              >
                <button
                  onClick={() => {
                    navigate('/chat');
                    setTimeout(() => document.dispatchEvent(new CustomEvent('vault:load-session', { detail: s.sessionId })), 80);
                    if (onClose) onClose();
                  }}
                  className="flex-1 text-left px-3 py-1 rounded-md text-xs truncate transition-colors hover:opacity-70"
                  style={{ color: 'var(--color-muted)', paddingLeft: '2rem' }}
                >
                  {formatSessionLabel(s)}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); openMoveSessionModal(s); }}
                  className="w-5 h-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-70 hover:!opacity-100 transition-opacity flex-shrink-0"
                  style={{ color: 'var(--color-muted)' }}
                  data-tip="Move to project"
                >
                  {getIcon('arrow-right', { size: 11 })}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="px-3 pb-1">
        <div className="border-t" style={{ borderColor: 'var(--color-border)' }} />
      </div>

      {/* Projects header */}
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--color-muted)' }}>
          Projects
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowFolderInput(v => !v)}
            className="w-6 h-6 flex items-center justify-center rounded-md hover:opacity-60 transition-opacity"
            style={{ color: 'var(--color-muted)' }}
            data-tip="New collection (groups projects only)"
          >
            {getIcon('folder-plus', { size: 13 })}
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="w-6 h-6 flex items-center justify-center rounded-md hover:opacity-60 transition-opacity"
            style={{ color: 'var(--color-primary)' }}
            data-tip="New project"
          >
            {getIcon('plus', { size: 14 })}
          </button>
        </div>
      </div>
      <p className="px-3 pb-2 text-[11px] leading-snug" style={{ color: 'var(--color-muted)' }}>
        Collections group projects in the sidebar — not individual chats.
      </p>
      {showFolderInput && (
        <div className="px-2 pb-2">
          <input
            autoFocus
            value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreateFolder(); if (e.key === 'Escape') { setShowFolderInput(false); setNewFolderName(''); } }}
            placeholder="Collection name…"
            className="w-full px-3 py-1.5 text-xs rounded-lg border outline-none"
            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-primary)', color: 'var(--color-text)' }}
          />
        </div>
      )}

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
              <button
                onClick={async () => {
                  await remove(deleteTarget.id);
                  setDeleteTarget(null);
                  if (activeProjectId === deleteTarget.id) navigate('/');
                }}
                className="px-4 py-2 rounded-xl text-xs font-medium text-white bg-red-500 hover:opacity-80 transition-opacity"
              >
                Delete project
              </button>
            </div>
          </div>
        </div>
      )}

      {moveSessionTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }}>
          <div className="w-full max-w-sm mx-4 rounded-2xl border shadow-xl p-6" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Move chat to project</h3>
            <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
              Move "{formatSessionLabel(moveSessionTarget)}" into a project for brief and file context.
            </p>
            <select
              value={moveSessionProjectId}
              onChange={e => setMoveSessionProjectId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border text-sm outline-none mb-5"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            >
              {folders.map(folder => {
                const folderProjects = projects.filter(p => p.folderId === folder.id);
                if (folderProjects.length === 0) return null;
                return (
                  <optgroup key={folder.id} label={folder.name}>
                    {folderProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </optgroup>
                );
              })}
              <optgroup label="Unfoldered">
                {projects.filter(p => !p.folderId).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </optgroup>
            </select>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setMoveSessionTarget(null)} className="px-4 py-2 rounded-xl text-xs border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Cancel</button>
              <button
                onClick={confirmMoveSession}
                disabled={!moveSessionProjectId || moveSessionSaving}
                className="px-4 py-2 rounded-xl text-xs font-medium text-white hover:opacity-80 transition-opacity disabled:opacity-50"
                style={{ background: 'var(--color-primary)' }}
              >
                {moveSessionSaving ? 'Moving…' : 'Move'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Project list */}
      <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
        {/* Render project row helper */}
        {(() => {
          const renderProject = (project, indent = false) => {
            const isActive = location.pathname.startsWith(`/projects/${project.id}`);
            const isRenaming = renamingId === project.id;
            const isExpanded = expandedProjectId === project.id;
            const sessions = projectSessions[project.id] || [];
            return (
              <div
                key={project.id}
                className="group relative"
                draggable
                onDragStart={(e) => handleDragStart(e, project.id)}
                onDragOver={(e) => handleProjectDragOver(e, project.id)}
                onDrop={(e) => handleProjectDrop(e, project.id)}
                onDragEnd={handleDragEnd}
                style={{
                  opacity: draggedId === project.id ? 0.4 : 1,
                  borderLeft: dragOverId === project.id ? '2px solid var(--color-primary)' : '2px solid transparent',
                  outline: dragOverProjectId === project.id ? '1px dashed var(--color-primary)' : 'none',
                  borderRadius: dragOverProjectId === project.id ? '0.5rem' : undefined,
                }}
              >
                {isRenaming ? (
                  <input
                    ref={renameInputRef}
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onBlur={() => saveRename(project.id)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') saveRename(project.id);
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    className="w-full px-3 py-2 text-sm rounded-lg border outline-none"
                    style={{ background: 'var(--color-bg)', borderColor: 'var(--color-primary)', color: 'var(--color-text)' }}
                  />
                ) : (
                  <>
                    <div
                      className="w-full rounded-lg text-sm flex items-center gap-1 transition-colors"
                      style={{
                        padding: indent ? '0.25rem 0.5rem 0.25rem 1rem' : '0.25rem 0.5rem',
                        background: isActive ? 'var(--color-bg)' : 'transparent',
                      }}
                    >
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggleProjectSessions(project.id); }}
                        className="w-6 h-8 flex items-center justify-center rounded-md hover:opacity-60 transition-opacity flex-shrink-0"
                        style={{ color: 'var(--color-muted)' }}
                        data-tip={isExpanded ? 'Collapse chats' : 'Show recent chats'}
                      >
                        {getIcon(isExpanded ? 'chevron-down' : 'chevron-right', { size: 12 })}
                      </button>
                      <button
                        type="button"
                        onClick={() => enterProject(project.id)}
                        className="flex-1 min-w-0 flex items-center gap-2 py-1.5 text-left rounded-md hover:opacity-70 transition-opacity"
                        style={{
                          color: isActive ? 'var(--color-primary)' : 'var(--color-text)',
                          fontWeight: isActive ? 500 : 400,
                        }}
                      >
                        <span style={{ flexShrink: 0, opacity: isActive ? 1 : 0.5 }}>
                          {getIcon('folder', { size: 14 })}
                        </span>
                        <span className="truncate flex-1">{project.name}</span>
                        {project.chatCount > 0 && !isExpanded && (
                          <span className="flex-shrink-0 text-xs tabular-nums" style={{ color: 'var(--color-muted)', opacity: 0.7 }}>
                            {project.chatCount}
                          </span>
                        )}
                      </button>
                      <span
                        onClick={(e) => { e.stopPropagation(); navigate(`/projects/${project.id}`); if (onClose) onClose(); }}
                        className="flex-shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity cursor-pointer p-1"
                        style={{ color: 'var(--color-muted)' }}
                        data-tip="Project settings"
                      >
                        {getIcon('external-link', { size: 11 })}
                      </span>
                      <span
                        onClick={(e) => { e.stopPropagation(); setActive(project.id); document.dispatchEvent(new CustomEvent('vault:new-chat')); navigate(`/projects/${project.id}/chat`); if (onClose) onClose(); }}
                        className="flex-shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity cursor-pointer p-1"
                        style={{ color: 'var(--color-primary)' }}
                        data-tip="New chat in project"
                      >
                        {getIcon('plus', { size: 11 })}
                      </span>
                      <span
                        onClick={(e) => startRename(e, project)}
                        className="flex-shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity cursor-pointer p-1"
                        style={{ color: 'var(--color-muted)' }}
                        data-tip="Rename"
                      >
                        {getIcon('edit', { size: 11 })}
                      </span>
                      <span
                        onClick={async (e) => { e.stopPropagation(); await archive(project.id); if (activeProjectId === project.id) navigate('/'); }}
                        className="flex-shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity cursor-pointer p-1"
                        style={{ color: 'var(--color-muted)' }}
                        data-tip="Archive project"
                      >
                        {getIcon('archive', { size: 11 })}
                      </span>
                      <span
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(project); }}
                        className="flex-shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity cursor-pointer p-1"
                        style={{ color: '#ef4444' }}
                        data-tip="Delete project"
                      >
                        {getIcon('trash', { size: 11 })}
                      </span>
                    </div>
                    {isExpanded && (
                      <div className="mt-0.5 space-y-0.5">
                        {sessions.slice(0, 10).map(s => (
                          <button
                            key={s.sessionId}
                            onClick={() => {
                              setActive(project.id);
                              navigate(`/projects/${project.id}/chat`);
                              setTimeout(() => document.dispatchEvent(new CustomEvent('vault:load-session', { detail: s.sessionId })), 80);
                              if (onClose) onClose();
                            }}
                            className="w-full text-left py-1 rounded-md text-xs truncate transition-colors hover:opacity-70"
                            style={{ color: 'var(--color-muted)', paddingLeft: indent ? '3rem' : '2.25rem' }}
                          >
                            {formatSessionLabel(s)}{s.isSummarized ? ' ✦' : ''}
                          </button>
                        ))}
                        {sessions.length === 0 && (
                          <p className="text-xs py-1" style={{ color: 'var(--color-muted)', paddingLeft: indent ? '3rem' : '2.25rem' }}>
                            No chats yet
                          </p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          };

          const folderProjects = {};
          const unfoldered = [];
          projects.forEach(p => {
            if (p.folderId) {
              if (!folderProjects[p.folderId]) folderProjects[p.folderId] = [];
              folderProjects[p.folderId].push(p);
            } else {
              unfoldered.push(p);
            }
          });

          return (
            <>
              {folders.map(folder => {
                const fps = folderProjects[folder.id] || [];
                const isCollapsed = collapsedFolders[folder.id];
                return (
                  <div key={folder.id}>
                    <button
                      onClick={() => toggleFolder(folder.id)}
                      onDragOver={(e) => { e.preventDefault(); setDragOverFolderId(folder.id); }}
                      onDragLeave={() => setDragOverFolderId(null)}
                      onDrop={(e) => handleFolderDrop(e, folder.id)}
                      className="w-full text-left px-2 py-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider transition-all rounded-lg"
                      style={{
                        color: dragOverFolderId === folder.id ? 'var(--color-primary)' : 'var(--color-muted)',
                        background: dragOverFolderId === folder.id ? 'var(--color-primary)15' : 'transparent',
                        outline: dragOverFolderId === folder.id ? '1px dashed var(--color-primary)' : 'none',
                      }}
                    >
                      {getIcon(isCollapsed ? 'chevron-right' : 'chevron-down', { size: 11 })}
                      {getIcon('folder-open', { size: 12 })}
                      {folder.name}
                      <span className="ml-auto tabular-nums">{fps.length}</span>
                    </button>
                    {!isCollapsed && fps.map(p => renderProject(p, true))}
                  </div>
                );
              })}
              {draggedId && projects.find(p => p.id === draggedId)?.folderId && (
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOverFolderId('none'); }}
                  onDragLeave={() => setDragOverFolderId(null)}
                  onDrop={(e) => handleFolderDrop(e, null)}
                  className="mx-1 my-0.5 px-2 py-1.5 rounded-lg text-xs transition-all"
                  style={{
                    border: dragOverFolderId === 'none' ? '1px dashed var(--color-primary)' : '1px dashed var(--color-border)',
                    color: dragOverFolderId === 'none' ? 'var(--color-primary)' : 'var(--color-muted)',
                    background: dragOverFolderId === 'none' ? 'var(--color-primary)10' : 'transparent',
                  }}
                >
                  Drop here to remove from folder
                </div>
              )}
              {unfoldered.map(p => renderProject(p, false))}
              {projects.length === 0 && (
                <p className="px-3 py-6 text-xs text-center" style={{ color: 'var(--color-muted)' }}>
                  No projects yet
                </p>
              )}
            </>
          );
        })()}
      </div>

      {/* 7 Habits section */}
      {showHabits && (
        <div className="px-2 border-t" data-tour="habits-sidebar" style={{ borderColor: 'var(--color-border)' }}>
          <button
            onClick={() => {
              const next = !habitsOpen;
              setHabitsOpen(next);
              localStorage.setItem('sidebarHabitsOpen', JSON.stringify(next));
            }}
            className="w-full text-left px-2 py-2 flex items-center gap-1.5 transition-colors hover:opacity-70"
          >
            {getIcon(habitsOpen ? 'chevron-down' : 'chevron-right', { size: 11, style: { color: 'var(--color-muted)' } })}
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--color-muted)' }}>7 Habits</span>
          </button>
          {habitsOpen && (
            <div className="pb-1 space-y-0.5">
              {[
                { label: '🧭 Mission Statement', path: '/goals?section=mission' },
                { label: '⚡ Priority Matrix', path: '/tasks?view=matrix' },
                { label: '🌱 Renewal Balance', path: '/goals?section=renewal' },
              ].map(item => {
                const isActive = location.pathname + location.search === item.path || location.search.includes(item.path.split('?')[1] || '___');
                return (
                  <button
                    key={item.path}
                    onClick={() => { navigate(item.path); if (onClose) onClose(); }}
                    className="w-full text-left px-3 py-1.5 rounded-lg text-xs transition-colors hover:opacity-70"
                    style={{
                      color: 'var(--color-muted)',
                      paddingLeft: '1.75rem',
                    }}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Client context section */}
      {(() => {
        const activeProject = projects.find(p => p.id === activeProjectId);
        if (!activeProject?.clientId || !activeProject?.clientName) return null;
        return (
          <div className="px-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
            <button
              onClick={() => setClientOpen(v => !v)}
              className="w-full text-left px-2 py-2 flex items-center gap-1.5 transition-colors hover:opacity-70"
            >
              {getIcon(clientOpen ? 'chevron-down' : 'chevron-right', { size: 11, style: { color: 'var(--color-muted)' } })}
              <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--color-muted)' }}>Client</span>
            </button>
            {clientOpen && (
              <div className="pb-2 px-2 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>{activeProject.clientName}</span>
                  <button
                    onClick={() => { navigate(`/clients/${activeProject.clientId}`); if (onClose) onClose(); }}
                    className="text-xs hover:opacity-70 flex-shrink-0"
                    style={{ color: 'var(--color-primary)' }}
                  >View →</button>
                </div>
                {touchpointForm ? (
                  <div className="space-y-1.5">
                    <select
                      value={touchpointForm.type}
                      onChange={e => setTouchpointForm(p => ({ ...p, type: e.target.value }))}
                      className="w-full text-xs px-2 py-1.5 rounded-lg border outline-none"
                      style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                    >
                      {['call','email','meeting','decision','milestone','other'].map(t => (
                        <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                      ))}
                    </select>
                    <input
                      type="date"
                      value={touchpointForm.date}
                      onChange={e => setTouchpointForm(p => ({ ...p, date: e.target.value }))}
                      className="w-full text-xs px-2 py-1.5 rounded-lg border outline-none"
                      style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                    />
                    <textarea
                      rows={2}
                      value={touchpointForm.note}
                      onChange={e => setTouchpointForm(p => ({ ...p, note: e.target.value }))}
                      placeholder="Note…"
                      className="w-full text-xs px-2 py-1.5 rounded-lg border outline-none resize-none"
                      style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                    />
                    <div className="flex gap-1.5">
                      <button
                        disabled={tpSaving}
                        onClick={async () => {
                          setTpSaving(true);
                          try {
                            await api.post(`/api/clients/${activeProject.clientId}/touchpoints`, touchpointForm);
                            setTouchpointForm(null);
                          } finally { setTpSaving(false); }
                        }}
                        className="flex-1 text-xs py-1 rounded-lg font-medium text-white disabled:opacity-50"
                        style={{ background: 'var(--color-primary)' }}
                      >{tpSaving ? 'Saving…' : 'Log'}</button>
                      <button
                        onClick={() => setTouchpointForm(null)}
                        className="text-xs px-2 py-1 rounded-lg border"
                        style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
                      >Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setTouchpointForm({ type: 'call', date: new Date().toISOString().slice(0, 10), note: '' })}
                    className="w-full text-left text-xs px-2 py-1.5 rounded-lg hover:opacity-70 transition-opacity"
                    style={{ color: 'var(--color-muted)' }}
                  >+ Log touchpoint</button>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Bottom */}
      <div className="px-2 py-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
        <button
          onClick={() => { navigate('/history'); if (onClose) onClose(); }}
          className="w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2.5 transition-colors hover:opacity-70"
          style={{ color: location.pathname === '/history' ? 'var(--color-primary)' : 'var(--color-muted)' }}
        >
          {getIcon('clock', { size: 14 })}
          Chat History
        </button>
        <button
          onClick={() => { navigate('/?archive=1'); if (onClose) onClose(); }}
          className="w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2.5 transition-colors hover:opacity-70"
          style={{ color: 'var(--color-muted)' }}
        >
          {getIcon('archive', { size: 14 })}
          Archived Projects
        </button>
        <button
          onClick={() => { navigate('/settings'); if (onClose) onClose(); }}
          className="w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2.5 transition-colors hover:opacity-70"
          style={{ color: 'var(--color-muted)' }}
        >
          {getIcon('settings', { size: 14 })}
          Settings
        </button>
      </div>
    </div>
  );
}

export default ProjectSidebar;
