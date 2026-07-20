import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import useProjectStore from '../store/projectStore';
import { useIcon } from '../providers/IconProvider';
import NewProjectModal from './NewProjectModal';
import api from '../utils/apiClient';
import { formatSessionLabel } from '../utils/sessionDisplay';
import { openNewChatModal } from '../utils/openNewChatModal';
import { loadSessionById } from '../utils/chatNavigation';
import OverflowMenu from './OverflowMenu';

function ProjectSidebar({ onClose, showClientContext = false, collapsed = false }) {
  const { projects, activeProjectId, fetchProjects, setActive, create, update, reorder, remove, archive } = useProjectStore();
  const [showModal, setShowModal] = useState(false);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef(null);
  const [draggedId, setDraggedId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [dragOverFolderId, setDragOverFolderId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [deleteFolderTarget, setDeleteFolderTarget] = useState(null);
  const [renamingFolderId, setRenamingFolderId] = useState(null);
  const [renameFolderValue, setRenameFolderValue] = useState('');
  const renameFolderInputRef = useRef(null);
  const [moveProjectTarget, setMoveProjectTarget] = useState(null);
  const [moveProjectFolderId, setMoveProjectFolderId] = useState('');
  const [moveProjectSaving, setMoveProjectSaving] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const getIcon = useIcon();
  const [folders, setFolders] = useState([]);
  const [collapsedFolders, setCollapsedFolders] = useState({});
  const [showFolderInput, setShowFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [expandedProjectId, setExpandedProjectId] = useState(() => {
    const match = window.location.pathname.match(/\/projects\/(\d+)/);
    return match ? Number(match[1]) : null;
  });
  const [projectSessions, setProjectSessions] = useState({});
  const [clientOpen, setClientOpen] = useState(false);
  const [touchpointForm, setTouchpointForm] = useState(null); // null | { type, date, note }
  const [tpSaving, setTpSaving] = useState(false);
  const [railTip, setRailTip] = useState(null);

  useEffect(() => {
    const loadSessionLists = () => {
      fetchProjects();
      api.get('/api/folders').then(r => r.json()).then(setFolders).catch(() => {});
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

  const refreshFolders = () => {
    api.get('/api/folders').then(r => r.json()).then(setFolders).catch(() => {});
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    await api.post('/api/folders', { name: newFolderName.trim() });
    setNewFolderName('');
    setShowFolderInput(false);
    refreshFolders();
  };

  const saveFolderRename = async (folderId) => {
    const name = renameFolderValue.trim();
    if (name) {
      await api.put(`/api/folders/${folderId}`, { name });
      refreshFolders();
    }
    setRenamingFolderId(null);
  };

  const confirmDeleteFolder = async () => {
    if (!deleteFolderTarget) return;
    await api.delete(`/api/folders/${deleteFolderTarget.id}`);
    setDeleteFolderTarget(null);
    refreshFolders();
    await fetchProjects();
  };

  const toggleFolder = (folderId) => setCollapsedFolders(prev => ({ ...prev, [folderId]: !prev[folderId] }));

  const toggleProjectSessions = (projectId) => {
    const opening = expandedProjectId !== projectId;
    setExpandedProjectId(opening ? projectId : null);
    if (opening) {
      if (!projectSessions[projectId]) {
        api.get(`/api/chat/sessions/${projectId}`)
          .then(r => r.json())
          .then(sessions => setProjectSessions(prev => ({ ...prev, [projectId]: sessions })))
          .catch(() => {});
      }
    }
  };

  const enterProject = async (projectId) => {
    setActive(projectId);
    setExpandedProjectId(projectId);
    let sessions = projectSessions[projectId];
    if (!sessions) {
      sessions = await api.get(`/api/chat/sessions/${projectId}`).then(r => r.json()).catch(() => []);
      setProjectSessions(prev => ({ ...prev, [projectId]: sessions }));
    }
    navigate(`/projects/${projectId}/chat`);
    if (onClose) onClose();
    if (sessions?.length > 0) {
      loadSessionById(sessions[0].sessionId);
    } else {
      document.dispatchEvent(new CustomEvent('vault:new-chat'));
    }
  };

  const startQuickChat = () => {
    openNewChatModal();
    if (onClose) onClose();
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
  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
    setDragOverFolderId(null);
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

  const saveRename = async (id) => {
    if (renameValue.trim()) {
      await update(id, { name: renameValue.trim() });
    }
    setRenamingId(null);
  };

  if (collapsed) {
    const railItems = [
      { icon: 'plus', title: 'New chat', action: startQuickChat },
      { icon: 'home', title: 'Home', action: () => navigate('/'), active: location.pathname === '/' },
      { icon: 'clock', title: 'Chat History', action: () => navigate('/history'), active: location.pathname === '/history' },
    ];

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
      <div className="px-2 pt-2 pb-2">
        <button
          type="button"
          onClick={startQuickChat}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80"
          style={{ background: 'var(--color-primary)' }}
        >
          {getIcon('plus', { size: 14 })}
          New chat
        </button>
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

      {archiveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }}>
          <div className="w-full max-w-sm mx-4 rounded-2xl border shadow-xl p-6" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Archive "{archiveTarget.name}"?</h3>
            <p className="text-xs mb-5" style={{ color: 'var(--color-muted)' }}>
              The project will be hidden from the sidebar. You can restore it from Archived Projects on the home page.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setArchiveTarget(null)} className="px-4 py-2 rounded-xl text-xs border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Cancel</button>
              <button
                onClick={async () => {
                  await archive(archiveTarget.id);
                  setArchiveTarget(null);
                  if (activeProjectId === archiveTarget.id) navigate('/');
                }}
                className="px-4 py-2 rounded-xl text-xs font-medium text-white hover:opacity-80 transition-opacity"
                style={{ background: 'var(--color-primary)' }}
              >
                Archive project
              </button>
            </div>
          </div>
        </div>
      )}

      {moveProjectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }}>
          <div className="w-full max-w-sm mx-4 rounded-2xl border shadow-xl p-6" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Move to collection</h3>
            <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
              Group "{moveProjectTarget.name}" under a sidebar collection.
            </p>
            <select
              value={moveProjectFolderId}
              onChange={e => setMoveProjectFolderId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border text-sm outline-none mb-5"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            >
              <option value="">No collection</option>
              {folders.map(folder => (
                <option key={folder.id} value={folder.id}>{folder.name}</option>
              ))}
            </select>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setMoveProjectTarget(null)} className="px-4 py-2 rounded-xl text-xs border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Cancel</button>
              <button
                onClick={async () => {
                  setMoveProjectSaving(true);
                  try {
                    await update(moveProjectTarget.id, {
                      folderId: moveProjectFolderId ? Number(moveProjectFolderId) : null,
                    });
                    if (moveProjectFolderId) {
                      setCollapsedFolders(prev => ({ ...prev, [moveProjectFolderId]: false }));
                    }
                    setMoveProjectTarget(null);
                    setMoveProjectFolderId('');
                  } finally {
                    setMoveProjectSaving(false);
                  }
                }}
                disabled={moveProjectSaving}
                className="px-4 py-2 rounded-xl text-xs font-medium text-white hover:opacity-80 transition-opacity disabled:opacity-50"
                style={{ background: 'var(--color-primary)' }}
              >
                {moveProjectSaving ? 'Moving…' : 'Move'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }}>
          <div className="w-full max-w-sm mx-4 rounded-2xl border shadow-xl p-6" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Delete "{deleteTarget.name}"?</h3>
            <p className="text-xs mb-5" style={{ color: 'var(--color-muted)' }}>
              This will permanently delete the project
              {deleteTarget.chatCount > 0 && `, all ${deleteTarget.chatCount} chat session${Number(deleteTarget.chatCount) === 1 ? '' : 's'}`}
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

      {deleteFolderTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }}>
          <div className="w-full max-w-sm mx-4 rounded-2xl border shadow-xl p-6" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Delete collection "{deleteFolderTarget.name}"?</h3>
            <p className="text-xs mb-5" style={{ color: 'var(--color-muted)' }}>
              Projects inside stay in your workspace — they just leave this collection. The collection itself is removed.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteFolderTarget(null)} className="px-4 py-2 rounded-xl text-xs border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Cancel</button>
              <button
                onClick={confirmDeleteFolder}
                className="px-4 py-2 rounded-xl text-xs font-medium text-white bg-red-500 hover:opacity-80 transition-opacity"
              >
                Delete collection
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
            const isEmpty = !Number(project.chatCount);
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
                        <span style={{ flexShrink: 0, color: isActive ? 'var(--color-primary)' : '#6B8F71' }}>
                          {getIcon('layers', { size: 14 })}
                        </span>
                        <span className="truncate flex-1">{project.name}</span>
                        {isEmpty && !isExpanded && (
                          <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded" style={{ color: 'var(--color-muted)', background: 'var(--color-bg)' }}>
                            empty
                          </span>
                        )}
                        {!isEmpty && !isExpanded && (
                          <span className="flex-shrink-0 text-xs tabular-nums" style={{ color: 'var(--color-muted)', opacity: 0.7 }}>
                            {project.chatCount}
                          </span>
                        )}
                      </button>
                      <div className="flex-shrink-0">
                        <OverflowMenu
                          variant="icon"
                          title="Project actions"
                          actions={[
                            ...(isEmpty ? [{
                              label: 'Delete empty project',
                              icon: 'trash',
                              danger: true,
                              onClick: () => setDeleteTarget(project),
                            }, { divider: true, key: `empty-div-${project.id}` }] : []),
                            {
                              label: 'New chat',
                              icon: 'plus',
                              onClick: () => {
                                setActive(project.id);
                                openNewChatModal({ defaultMode: 'project', defaultProjectId: String(project.id) });
                                if (onClose) onClose();
                              },
                            },
                            {
                              label: 'Overview',
                              icon: 'external-link',
                              onClick: () => { navigate(`/projects/${project.id}`); if (onClose) onClose(); },
                            },
                            {
                              label: 'Move to collection…',
                              icon: 'folder',
                              onClick: () => {
                                setMoveProjectTarget(project);
                                setMoveProjectFolderId(project.folderId ? String(project.folderId) : '');
                              },
                            },
                            { divider: true, key: `div-${project.id}` },
                            {
                              label: 'Rename',
                              icon: 'edit',
                              onClick: () => {
                                setRenamingId(project.id);
                                setRenameValue(project.name);
                                setTimeout(() => renameInputRef.current?.focus(), 0);
                              },
                            },
                            {
                              label: 'Archive',
                              icon: 'archive',
                              onClick: () => setArchiveTarget(project),
                            },
                            ...(!isEmpty ? [{
                              label: 'Delete',
                              icon: 'trash',
                              danger: true,
                              onClick: () => setDeleteTarget(project),
                            }] : []),
                          ]}
                        />
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="mt-0.5 space-y-0.5">
                        {sessions.slice(0, 10).map(s => (
                          <button
                            key={s.sessionId}
                            onClick={() => {
                              setActive(project.id);
                              navigate(`/projects/${project.id}/chat`);
                              loadSessionById(s.sessionId);
                              if (onClose) onClose();
                            }}
                            className="w-full text-left py-1 rounded-md text-xs truncate transition-colors hover:opacity-70"
                            style={{ color: 'var(--color-muted)', paddingLeft: indent ? '3rem' : '2.25rem' }}
                          >
                            {formatSessionLabel(s)}{s.isSummarized ? ' ✦' : ''}
                          </button>
                        ))}
                        {sessions.length === 0 && (
                          <div className="flex items-center gap-2 py-1" style={{ paddingLeft: indent ? '3rem' : '2.25rem' }}>
                            <p className="text-xs flex-1" style={{ color: 'var(--color-muted)' }}>
                              No chats yet
                            </p>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(project)}
                              className="text-[10px] px-1.5 py-0.5 rounded hover:opacity-70 transition-opacity"
                              style={{ color: '#ef4444' }}
                            >
                              Delete project
                            </button>
                          </div>
                        )}
                        {sessions.length > 10 && (
                          <button
                            type="button"
                            onClick={() => { navigate(`/history?projectId=${project.id}`); if (onClose) onClose(); }}
                            className="w-full text-left py-1 text-[10px] hover:opacity-70 transition-opacity"
                            style={{ color: 'var(--color-primary)', paddingLeft: indent ? '3rem' : '2.25rem' }}
                          >
                            View all {sessions.length} chats →
                          </button>
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
                const isRenamingFolder = renamingFolderId === folder.id;
                return (
                  <div key={folder.id} className="mb-1">
                    {isRenamingFolder ? (
                      <input
                        ref={renameFolderInputRef}
                        value={renameFolderValue}
                        onChange={e => setRenameFolderValue(e.target.value)}
                        onBlur={() => saveFolderRename(folder.id)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveFolderRename(folder.id);
                          if (e.key === 'Escape') setRenamingFolderId(null);
                        }}
                        className="w-full px-2 py-1.5 text-xs rounded-lg border outline-none"
                        style={{ background: 'var(--color-bg)', borderColor: '#5B7C99', color: 'var(--color-text)' }}
                      />
                    ) : (
                      <div
                        className="group flex items-center gap-0.5 rounded-lg"
                        onDragOver={(e) => { e.preventDefault(); setDragOverFolderId(folder.id); }}
                        onDragLeave={() => setDragOverFolderId(null)}
                        onDrop={(e) => handleFolderDrop(e, folder.id)}
                        style={{
                          background: dragOverFolderId === folder.id ? 'rgba(91,124,153,0.15)' : 'rgba(91,124,153,0.08)',
                          outline: dragOverFolderId === folder.id ? '1px dashed #5B7C99' : 'none',
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => toggleFolder(folder.id)}
                          className="flex-1 min-w-0 text-left px-2 py-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider transition-all rounded-lg hover:opacity-80"
                          style={{ color: '#5B7C99' }}
                        >
                          {getIcon(isCollapsed ? 'chevron-right' : 'chevron-down', { size: 11 })}
                          {getIcon('folder-open', { size: 12 })}
                          <span className="truncate">{folder.name}</span>
                          <span className="ml-auto tabular-nums opacity-80">{fps.length}</span>
                        </button>
                        <div className="pr-1 flex-shrink-0">
                          <OverflowMenu
                            variant="icon"
                            title="Collection actions"
                            actions={[
                              {
                                label: 'Rename',
                                icon: 'edit',
                                onClick: () => {
                                  setRenamingFolderId(folder.id);
                                  setRenameFolderValue(folder.name);
                                  setTimeout(() => renameFolderInputRef.current?.focus(), 0);
                                },
                              },
                              {
                                label: 'Delete collection',
                                icon: 'trash',
                                danger: true,
                                onClick: () => setDeleteFolderTarget(folder),
                              },
                            ]}
                          />
                        </div>
                      </div>
                    )}
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

      {/* Client context section */}
      {showClientContext && (() => {
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
      </div>
    </div>
  );
}

export default ProjectSidebar;
