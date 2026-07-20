import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useIcon } from '../providers/IconProvider';
import { getAppsNavGroups, isNavItemActive } from '../config/appNavigation';

export default function AppsLauncher({
  canUseFeature,
  isAdmin = false,
  missionReminderDue = false,
  newSuggestionCount = 0,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const location = useLocation();
  const getIcon = useIcon();

  const groups = getAppsNavGroups({ canUseFeature, isAdmin });

  const anyActive = groups.some((g) =>
    g.items.some((item) => isNavItemActive(item, location.pathname, location.search))
  );

  useEffect(() => {
    const openHandler = () => setOpen(true);
    document.addEventListener('vault:open-apps-launcher', openHandler);
    return () => document.removeEventListener('vault:open-apps-launcher', openHandler);
  }, []);

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
        data-tour="apps-launcher"
        aria-expanded={open}
        aria-haspopup="true"
      >
        {getIcon('layout-grid', { size: 16 })}
        {newSuggestionCount > 0 ? (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 px-0.5 rounded-full text-[9px] font-bold flex items-center justify-center"
            style={{ background: 'var(--color-primary)', color: '#fff' }}
          >
            {newSuggestionCount > 9 ? '9+' : newSuggestionCount}
          </span>
        ) : missionReminderDue ? (
          <span
            className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full"
            style={{ background: '#f59e0b' }}
          />
        ) : null}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-72 rounded-xl border shadow-xl z-20 overflow-hidden"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
        >
          <div
            className="px-3 py-2 border-b text-xs font-semibold uppercase tracking-wider"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            Apps
          </div>
          <div className="max-h-[min(70dvh,520px)] overflow-y-auto p-2 space-y-3">
            {groups.map((group) => (
              <div
                key={group.id}
                {...(group.id === 'seven-habits' ? { 'data-tour': 'habits-apps' } : {})}
              >
                <p
                  className="px-1 pb-1.5 pt-0.5 text-[10px] font-bold uppercase tracking-wider"
                  style={{ color: '#166534' }}
                >
                  {group.label}
                </p>
                <div className="grid grid-cols-2 gap-1">
                  {group.items.map((item) => {
                    const active = isNavItemActive(item, location.pathname, location.search);
                    const showMissionDot = item.badgeKey === 'missionReminder' && missionReminderDue;
                    const showSuggestionBadge = item.badgeKey === 'suggestions' && newSuggestionCount > 0;
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
                        {showSuggestionBadge && (
                          <span
                            className="absolute top-1 right-1 min-w-[14px] h-3.5 px-0.5 rounded-full text-[9px] font-bold flex items-center justify-center"
                            style={{ background: 'var(--color-primary)', color: '#fff' }}
                          >
                            {newSuggestionCount > 9 ? '9+' : newSuggestionCount}
                          </span>
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
