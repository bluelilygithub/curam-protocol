import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import useProjectStore from '../store/projectStore';
import { useIcon } from '../providers/IconProvider';
import NewProjectModal from './NewProjectModal';
import api from '../utils/apiClient';

function ProjectSidebar({ onClose }) {
  const { projects, activeProjectId, fetchProjects, setActive, create, update, reorder, remove, archive } = useProjectStore();
  const [showModal, setShowModal] = useState(false);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef(null);
  const [draggedId, setDraggedId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [dragOverFolderId, setDragOverFolderId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
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

  useEffect(() => { fetchProjects(); }, []);
  useEffect(() => {
    api.get('/api/folders').then(r => r.json()).then(setFolders).catch(() => {});
    api.get('/api/chat/sessions/general').then(r => r.json()).then(setGeneralSessions).catch(() => {});
  }, []);

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

  const handleDragStart = (e, id) => { setDraggedId(id); e.dataTransfer.effectAllowed = 'move'; };
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
  const handleDragEnd = () => { setDraggedId(null); setDragOverId(null); setDragOverFolderId(null); };

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

  return (
    <div className="flex flex-col h-full w-full">
      {/* General section */}
      <div className="px-2 pt-2 pb-1">
        <div className="flex items-center gap-1">
          <button
            onClick={() => { navigate('/chat'); if (onClose) onClose(); }}
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
            <span className="flex-1 truncate">General</span>
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
            onClick={(e) => { e.stopPropagation(); document.dispatchEvent(new CustomEvent('vault:new-chat')); navigate('/chat'); if (onClose) onClose(); }}
            className="w-6 h-6 flex items-center justify-center rounded-md hover:opacity-60 transition-opacity flex-shrink-0"
            style={{ color: 'var(--color-primary)' }}
            title="New general chat"
          >
            {getIcon('plus', { size: 14 })}
          </button>
        </div>
        {generalExpanded && generalSessions.length > 0 && (
          <div className="mt-0.5 space-y-0.5">
            {generalSessions.slice(0, 8).map(s => (
              <button
                key={s.sessionId}
                onClick={() => {
                  navigate('/chat');
                  setTimeout(() => document.dispatchEvent(new CustomEvent('vault:load-session', { detail: s.sessionId })), 80);
                  if (onClose) onClose();
                }}
                className="w-full text-left px-3 py-1 rounded-md text-xs truncate transition-colors hover:opacity-70"
                style={{ color: 'var(--color-muted)', paddingLeft: '2rem' }}
              >
                {s.title || `${new Date(s.startedAt).toLocaleDateString()} · ${s.sessionId.slice(-6)}`}
              </button>
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
            title="New folder"
          >
            {getIcon('folder-plus', { size: 13 })}
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="w-6 h-6 flex items-center justify-center rounded-md hover:opacity-60 transition-opacity"
            style={{ color: 'var(--color-primary)' }}
            title="New project"
          >
            {getIcon('plus', { size: 14 })}
          </button>
        </div>
      </div>
      {showFolderInput && (
        <div className="px-2 pb-2">
          <input
            autoFocus
            value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreateFolder(); if (e.key === 'Escape') { setShowFolderInput(false); setNewFolderName(''); } }}
            placeholder="Folder name…"
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
                onDragOver={(e) => handleDragOver(e, project.id)}
                onDrop={(e) => handleDrop(e, project.id)}
                onDragEnd={handleDragEnd}
                style={{
                  opacity: draggedId === project.id ? 0.4 : 1,
                  borderLeft: dragOverId === project.id ? '2px solid var(--color-primary)' : '2px solid transparent',
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
                    <button
                      onClick={() => toggleProjectSessions(project.id)}
                      className="w-full text-left rounded-lg text-sm flex items-center gap-2 transition-colors"
                      style={{
                        padding: indent ? '0.5rem 0.75rem 0.5rem 1.5rem' : '0.5rem 0.75rem',
                        background: isActive ? 'var(--color-bg)' : 'transparent',
                        color: isActive ? 'var(--color-primary)' : 'var(--color-text)',
                        fontWeight: isActive ? 500 : 400,
                      }}
                    >
                      <span style={{ flexShrink: 0, opacity: isActive ? 1 : 0.5 }}>
                        {getIcon(isExpanded ? 'chevron-down' : 'chevron-right', { size: 12 })}
                      </span>
                      <span style={{ flexShrink: 0, opacity: isActive ? 1 : 0.5 }}>
                        {getIcon('folder', { size: 14 })}
                      </span>
                      <span className="truncate flex-1">{project.name}</span>
                      {project.chatCount > 0 && !isExpanded && (
                        <span className="flex-shrink-0 text-xs tabular-nums" style={{ color: 'var(--color-muted)', opacity: 0.7 }}>
                          {project.chatCount}
                        </span>
                      )}
                      <span
                        onClick={(e) => { e.stopPropagation(); setActive(project.id); navigate(`/projects/${project.id}/chat`); if (onClose) onClose(); }}
                        className="flex-shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity cursor-pointer"
                        style={{ color: 'var(--color-primary)' }}
                        title="New chat"
                      >
                        {getIcon('plus', { size: 11 })}
                      </span>
                      <span
                        onClick={(e) => startRename(e, project)}
                        className="flex-shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity cursor-pointer"
                        style={{ color: 'var(--color-muted)' }}
                        title="Rename"
                      >
                        {getIcon('edit', { size: 11 })}
                      </span>
                      <span
                        onClick={async (e) => { e.stopPropagation(); await archive(project.id); if (activeProjectId === project.id) navigate('/'); }}
                        className="flex-shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity cursor-pointer"
                        style={{ color: 'var(--color-muted)' }}
                        title="Archive project"
                      >
                        {getIcon('archive', { size: 11 })}
                      </span>
                      <span
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(project); }}
                        className="flex-shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity cursor-pointer"
                        style={{ color: '#ef4444' }}
                        title="Delete project"
                      >
                        {getIcon('trash', { size: 11 })}
                      </span>
                    </button>
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
                            {s.title || `${new Date(s.startedAt).toLocaleDateString()} · ${s.sessionId.slice(-6)}`}
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
