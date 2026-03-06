import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import useProjectStore from '../store/projectStore';
import { useIcon } from '../providers/IconProvider';
import NewProjectModal from './NewProjectModal';
import api from '../utils/apiClient';

function ProjectSidebar({ onClose }) {
  const { projects, activeProjectId, fetchProjects, setActive, create, update, reorder } = useProjectStore();
  const [showModal, setShowModal] = useState(false);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef(null);
  const [draggedId, setDraggedId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();
  const getIcon = useIcon();
  const [folders, setFolders] = useState([]);
  const [collapsedFolders, setCollapsedFolders] = useState({});
  const [showFolderInput, setShowFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  useEffect(() => { fetchProjects(); }, []);
  useEffect(() => {
    api.get('/api/folders').then(r => r.json()).then(setFolders).catch(() => {});
  }, []);

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    await api.post('/api/folders', { name: newFolderName.trim() });
    setNewFolderName('');
    setShowFolderInput(false);
    api.get('/api/folders').then(r => r.json()).then(setFolders).catch(() => {});
  };

  const toggleFolder = (folderId) => setCollapsedFolders(prev => ({ ...prev, [folderId]: !prev[folderId] }));

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
  const handleDragEnd = () => { setDraggedId(null); setDragOverId(null); };

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

  return (
    <div className="flex flex-col h-full w-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3">
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

      {/* Project list */}
      <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
        {/* Render project row helper */}
        {(() => {
          const renderProject = (project, indent = false) => {
            const isActive = location.pathname.startsWith(`/projects/${project.id}`);
            const isRenaming = renamingId === project.id;
            return (
              <div
                key={project.id}
                className="group relative"
                onDragOver={(e) => handleDragOver(e, project.id)}
                onDrop={(e) => handleDrop(e, project.id)}
                onDragEnd={handleDragEnd}
                style={{
                  opacity: draggedId === project.id ? 0.4 : 1,
                  borderLeft: dragOverId === project.id ? '2px solid var(--color-primary)' : '2px solid transparent',
                }}
              >
                <div
                  draggable
                  onDragStart={(e) => handleDragStart(e, project.id)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-1 cursor-grab opacity-0 group-hover:opacity-30 hover:!opacity-70 transition-opacity z-10 text-xs select-none"
                  style={{ color: 'var(--color-muted)', lineHeight: 1 }}
                  title="Drag to reorder"
                  onClick={(e) => e.stopPropagation()}
                >
                  {'\u28ff'}
                </div>
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
                  <button
                    onClick={() => { setActive(project.id); navigate(`/projects/${project.id}/chat`); }}
                    className="w-full text-left rounded-lg text-sm flex items-center gap-2 transition-colors"
                    style={{
                      padding: indent ? '0.5rem 0.75rem 0.5rem 1.5rem' : '0.5rem 0.75rem',
                      background: isActive ? 'var(--color-bg)' : 'transparent',
                      color: isActive ? 'var(--color-primary)' : 'var(--color-text)',
                      fontWeight: isActive ? 500 : 400,
                    }}
                  >
                    <span style={{ flexShrink: 0, opacity: isActive ? 1 : 0.5 }}>
                      {getIcon('folder', { size: 14 })}
                    </span>
                    <span className="truncate flex-1">{project.name}</span>
                    {project.chatCount > 0 && (
                      <span className="flex-shrink-0 text-xs tabular-nums" style={{ color: 'var(--color-muted)', opacity: 0.7 }}>
                        {project.chatCount}
                      </span>
                    )}
                    <span
                      onClick={(e) => startRename(e, project)}
                      className="flex-shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity cursor-pointer"
                      style={{ color: 'var(--color-muted)' }}
                      title="Rename"
                    >
                      {getIcon('edit', { size: 11 })}
                    </span>
                  </button>
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
                      className="w-full text-left px-2 py-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider transition-opacity hover:opacity-70"
                      style={{ color: 'var(--color-muted)' }}
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

      {/* Bottom */}
      <div className="px-2 py-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
        <button
          onClick={() => navigate('/settings')}
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
