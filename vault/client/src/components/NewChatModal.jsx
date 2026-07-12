import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIcon } from '../providers/IconProvider';

export default function NewChatModal({ projects = [], onClose }) {
  const navigate = useNavigate();
  const getIcon = useIcon();
  const [mode, setMode] = useState('quick');
  const [projectId, setProjectId] = useState(projects[0]?.id ? String(projects[0].id) : '');

  const startQuick = () => {
    document.dispatchEvent(new CustomEvent('vault:new-chat'));
    navigate('/chat');
    onClose();
  };

  const startProject = () => {
    if (!projectId) return;
    document.dispatchEvent(new CustomEvent('vault:new-chat'));
    navigate(`/projects/${projectId}/chat`);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
      <div
        className="w-full max-w-md rounded-2xl border shadow-xl p-6"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>New chat</h2>
          <button type="button" onClick={onClose} className="hover:opacity-60 transition-opacity" style={{ color: 'var(--color-muted)' }}>
            {getIcon('x', { size: 18 })}
          </button>
        </div>

        <div className="space-y-2 mb-4">
          <label
            className="flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-opacity hover:opacity-80"
            style={{
              borderColor: mode === 'quick' ? 'var(--color-primary)' : 'var(--color-border)',
              background: mode === 'quick' ? 'var(--color-bg)' : 'transparent',
            }}
          >
            <input
              type="radio"
              name="new-chat-mode"
              checked={mode === 'quick'}
              onChange={() => setMode('quick')}
              className="mt-1"
            />
            <div>
              <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Quick chat</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                No project files or brief — global memory and persona still apply.
              </div>
            </div>
          </label>

          <label
            className="flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-opacity hover:opacity-80"
            style={{
              borderColor: mode === 'project' ? 'var(--color-primary)' : 'var(--color-border)',
              background: mode === 'project' ? 'var(--color-bg)' : 'transparent',
            }}
          >
            <input
              type="radio"
              name="new-chat-mode"
              checked={mode === 'project'}
              onChange={() => setMode('project')}
              disabled={projects.length === 0}
              className="mt-1"
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>In a project</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                Uses brief, pinned files, and project context.
              </div>
              {mode === 'project' && projects.length > 0 && (
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="mt-2 w-full px-3 py-2 rounded-lg border text-sm outline-none"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              )}
              {projects.length === 0 && (
                <p className="text-xs mt-1 italic" style={{ color: 'var(--color-muted)' }}>Create a project first.</p>
              )}
            </div>
          </label>
        </div>

        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs border transition-opacity hover:opacity-70"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={mode === 'quick' ? startQuick : startProject}
            disabled={mode === 'project' && !projectId}
            className="px-4 py-2 rounded-xl text-xs font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-50"
            style={{ background: 'var(--color-primary)' }}
          >
            Start chat
          </button>
        </div>
      </div>
    </div>
  );
}
