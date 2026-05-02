import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';

export default function ProjectsTile() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const getIcon = useIcon();

  useEffect(() => {
    api.get('/api/projects')
      .then(r => r.json())
      .then(data => { setProjects(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="rounded-2xl border overflow-hidden" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <div className="flex items-center gap-2">
          {getIcon('folder', { size: 16, style: { color: 'var(--color-text)' } })}
          <span className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>Projects</span>
          {projects.length > 0 && (
            <span
              className="text-xs px-1.5 py-0.5 rounded-full"
              style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}
            >
              {projects.length}
            </span>
          )}
        </div>
      </div>

      <div className="p-3" style={{ maxHeight: '240px', overflowY: 'auto' }}>
        {loading && (
          <div className="text-sm px-1 py-1" style={{ color: 'var(--color-muted)' }}>Loading...</div>
        )}
        {!loading && projects.length === 0 && (
          <div className="text-sm px-1 py-1" style={{ color: 'var(--color-muted)' }}>No projects yet</div>
        )}
        <div className="grid grid-cols-2 gap-2">
          {projects.map(p => (
            <button
              key={p.id}
              onClick={() => navigate(`/projects/${p.id}`)}
              className="text-left rounded-xl border px-3 py-2.5 hover:opacity-70 transition-opacity"
              style={{
                borderColor: 'var(--color-border)',
                background: 'var(--color-bg)',
                borderLeft: p.color ? `3px solid ${p.color}` : undefined,
              }}
            >
              <div className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
                {p.name}
              </div>
              {p.description && (
                <div
                  className="text-xs mt-0.5 truncate"
                  style={{ color: 'var(--color-muted)' }}
                >
                  {p.description}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={() => navigate('/')}
        className="w-full px-4 py-2.5 text-sm flex items-center justify-between hover:opacity-70 transition-opacity border-t"
        style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}
      >
        All projects
        {getIcon('chevron-right', { size: 14 })}
      </button>
    </div>
  );
}
