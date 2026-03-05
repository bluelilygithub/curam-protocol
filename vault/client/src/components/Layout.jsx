import React, { useState, useEffect } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import ProjectSidebar from './ProjectSidebar';
import { useIcon } from '../providers/IconProvider';

function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    const handler = () => setSidebarOpen(v => !v);
    document.addEventListener('vault:toggle-sidebar', handler);
    return () => document.removeEventListener('vault:toggle-sidebar', handler);
  }, []);
  const getIcon = useIcon();
  const location = useLocation();

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--color-bg)', color: 'var(--color-text)' }}>
      {/* Sidebar */}
      <aside
        className="flex-shrink-0 flex flex-col border-r transition-all duration-200 overflow-hidden"
        style={{
          width: sidebarOpen ? '240px' : '0px',
          borderColor: 'var(--color-border)',
          background: 'var(--color-surface)',
        }}
      >
        {sidebarOpen && <ProjectSidebar onClose={() => setSidebarOpen(false)} />}
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header
          className="flex-shrink-0 h-11 flex items-center gap-2 px-3 border-b"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
        >
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:opacity-60 transition-opacity flex-shrink-0"
            style={{ color: 'var(--color-muted)' }}
            title="Toggle sidebar"
          >
            {getIcon('chevron-right', {
              size: 16,
              style: { transform: sidebarOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' },
            })}
          </button>

          <Link
            to="/"
            className="text-sm font-semibold tracking-tight flex-shrink-0"
            style={{ color: 'var(--color-text)' }}
          >
            Project Vault
          </Link>

          <div className="flex-1" />

          <button
            onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))}
            className="hidden sm:flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border"
            style={{ color: 'var(--color-muted)', borderColor: 'var(--color-border)' }}
          >
            {getIcon('search', { size: 12 })}
            Search
            <kbd className="text-xs opacity-60">⌘K</kbd>
          </button>

          <Link
            to="/guide"
            className="w-7 h-7 flex items-center justify-center rounded-md hover:opacity-60 transition-opacity text-xs font-bold border"
            style={{
              color: location.pathname === '/guide' ? 'var(--color-primary)' : 'var(--color-muted)',
              borderColor: location.pathname === '/guide' ? 'var(--color-primary)' : 'var(--color-border)',
            }}
            title="User Guide"
          >
            ?
          </Link>

          <Link
            to="/personas"
            className="w-7 h-7 flex items-center justify-center rounded-md hover:opacity-60 transition-opacity"
            style={{ color: location.pathname === '/personas' ? 'var(--color-primary)' : 'var(--color-muted)' }}
            title="Personas"
          >
            {getIcon('user', { size: 16 })}
          </Link>

          <Link
            to="/memory"
            className="w-7 h-7 flex items-center justify-center rounded-md hover:opacity-60 transition-opacity"
            style={{ color: location.pathname === '/memory' ? 'var(--color-primary)' : 'var(--color-muted)' }}
            title="Memory"
          >
            {getIcon('brain', { size: 16 })}
          </Link>

          <Link
            to="/prompts"
            className="w-7 h-7 flex items-center justify-center rounded-md hover:opacity-60 transition-opacity"
            style={{ color: location.pathname === '/prompts' ? 'var(--color-primary)' : 'var(--color-muted)' }}
            title="Prompt Library"
          >
            {getIcon('book', { size: 16 })}
          </Link>

          <Link
            to="/settings"
            className="w-7 h-7 flex items-center justify-center rounded-md hover:opacity-60 transition-opacity"
            style={{ color: location.pathname === '/settings' ? 'var(--color-primary)' : 'var(--color-muted)' }}
            title="Settings"
          >
            {getIcon('settings', { size: 16 })}
          </Link>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default Layout;
