import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useIcon } from '../providers/IconProvider';
import { APP_NAV_GROUPS, filterNavGroups, isNavItemActive } from '../config/appNavigation';

export default function AppsLauncher({
  canUseFeature,
  isAdmin = false,
  missionReminderDue = false,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const location = useLocation();
  const getIcon = useIcon();

  const groups = filterNavGroups({ canUseFeature, isAdmin });

  const anyActive = groups.some(g =>
    g.items.some(item => isNavItemActive(item, location.pathname))
  );

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative hidden sm:block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-7 h-7 flex items-center justify-center rounded-md hover:opacity-60 transition-opacity relative"
        style={{
          color: open || anyActive ? 'var(--color-primary)' : 'var(--color-muted)',
        }}
        data-tip="Apps"
        aria-expanded={open}
        aria-haspopup="true"
      >
        {getIcon('layout-grid', { size: 16 })}
        {missionReminderDue && (
          <span
            className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full"
            style={{ background: '#f59e0b' }}
          />
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-72 rounded-xl border shadow-xl z-20 overflow-hidden"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
        >
          <div
            className="px-3 py-2 border-b text-xs font-semibold uppercase tracking-wider"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
          >
            Apps
          </div>
          <div className="max-h-[min(70dvh,520px)] overflow-y-auto p-2 space-y-3">
            {groups.map(group => (
              <div key={group.id}>
                <p
                  className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--color-muted)' }}
                >
                  {group.label}
                </p>
                <div className="grid grid-cols-2 gap-1">
                  {group.items.map(item => {
                    const active = isNavItemActive(item, location.pathname);
                    const showMissionDot = item.badgeKey === 'missionReminder' && missionReminderDue;
                    return (
                      <Link
                        key={item.id}
                        to={item.path}
                        state={item.id === 'wellbeing' ? { dashboardNonce: Date.now() } : item.state}
                        onClick={() => setOpen(false)}
                        className="relative flex items-center gap-2 px-2 py-2 rounded-lg text-xs transition-opacity hover:opacity-70"
                        style={{
                          color: active ? 'var(--color-primary)' : 'var(--color-text)',
                          background: active ? 'var(--color-bg)' : 'transparent',
                          fontWeight: active ? 600 : 400,
                        }}
                      >
                        <span className="flex-shrink-0" style={{ color: active ? 'var(--color-primary)' : 'var(--color-muted)' }}>
                          {getIcon(item.icon, { size: 14 })}
                        </span>
                        <span className="truncate">{item.label}</span>
                        {showMissionDot && (
                          <span
                            className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full"
                            style={{ background: '#f59e0b' }}
                          />
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
