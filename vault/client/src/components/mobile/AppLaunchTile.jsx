import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useIcon } from '../../providers/IconProvider';

// Compact launcher card for apps with no summary data of their own.
// One component, driven by APP_TILES in mobileConfig.js.
export default function AppLaunchTile({ label, description, path, icon }) {
  const navigate = useNavigate();
  const getIcon = useIcon();

  return (
    <button
      onClick={() => navigate(path)}
      className="w-full rounded-2xl border px-4 py-3 flex items-center gap-3 text-left hover:opacity-70 transition-opacity"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      {getIcon(icon, { size: 18, style: { color: 'var(--color-primary)', flexShrink: 0 } })}
      <span className="flex-1 min-w-0">
        <span className="block font-semibold text-sm" style={{ color: 'var(--color-text)' }}>{label}</span>
        {description && (
          <span className="block text-xs truncate" style={{ color: 'var(--color-muted)' }}>{description}</span>
        )}
      </span>
      {getIcon('chevron-right', { size: 14, style: { color: 'var(--color-muted)', flexShrink: 0 } })}
    </button>
  );
}
