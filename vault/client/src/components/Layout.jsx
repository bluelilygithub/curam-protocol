import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import ProjectSidebar from './ProjectSidebar';
import PageToolbar from './PageToolbar';
import { useIcon } from '../providers/IconProvider';
import useAuthStore from '../store/authStore';
import api from '../utils/apiClient';
import QuickCapture from './QuickCapture';
import MobileNavDropdown from './mobile/MobileNavDropdown';
import MorningDigest from './MorningDigest';
import TaskReminderModal from './TaskReminderModal';
import InquirySession from './mood/InquirySession';
import TourButton from './TourButton';
import Toast from './Toast';
import AppsLauncher from './AppsLauncher';
import useSettingsStore from '../store/settingsStore';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';

function Layout() {
  const isMobileNow = () => typeof window !== 'undefined' && window.innerWidth < 640;

  // Start closed on mobile; on desktop default collapsed, persist user preference
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (isMobileNow()) return false;
    const saved = localStorage.getItem('vault:sidebarOpen');
    return saved === null ? false : saved === 'true';
  });
  const [isMobile, setIsMobile] = useState(isMobileNow());

  const { token, user, clearAuth } = useAuthStore();
  const { taskReminderTimes, taskRemindersPaused } = useSettingsStore();
  const navigate = useNavigate();
  const location = useLocation();
  const getIcon = useIcon();

  const SIDEBAR_MIN = 180;
  const SIDEBAR_MAX = 520;
  const SIDEBAR_DEFAULT = 240;

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = parseInt(localStorage.getItem('vault:sidebarWidth'), 10);
    return saved && saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX ? saved : SIDEBAR_DEFAULT;
  });
  const isResizing = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);

  // Global mouse handlers for sidebar drag-resize (desktop only)
  useEffect(() => {
    const onMove = (e) => {
      if (!isResizing.current) return;
      const delta = e.clientX - resizeStartX.current;
      const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, resizeStartWidth.current + delta));
      setSidebarWidth(next);
    };
    const onUp = () => {
      if (!isResizing.current) return;
      isResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setSidebarWidth((w) => {
        localStorage.setItem('vault:sidebarWidth', String(w));
        return w;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const startResize = (e) => {
    e.preventDefault();
    isResizing.current = true;
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = sidebarWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [reminderModal,       setReminderModal]       = useState(null); // { time, overdue, today }
  const [dueTodayCount,       setDueTodayCount]       = useState(0);
  const [showDueBanner,       setShowDueBanner]       = useState(false);
  const [bookmarkCount,       setBookmarkCount]       = useState(0);
  const [newSuggestionCount,  setNewSuggestionCount]  = useState(0);
  const [showInquiryReminder, setShowInquiryReminder] = useState(false);
  const [showInquirySession,  setShowInquirySession]  = useState(false);
  const [inquiryReminderSettings, setInquiryReminderSettings] = useState(null);
  const [missionReminderDue,  setMissionReminderDue]  = useState(false);
  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });

  useEffect(() => {
    if (sessionStorage.getItem('tasksAlertDismissed')) return;
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
    const dueBefore = todayEnd.toISOString().slice(0, 10);
    api.get(`/api/tasks?status=todo&dueBefore=${dueBefore}`)
      .then(r => r.json())
      .then(tasks => {
        if (Array.isArray(tasks) && tasks.length > 0) {
          setDueTodayCount(tasks.length);
          setShowDueBanner(true);
        }
      })
      .catch(() => {});
  }, []);

  const dismissDueBanner = () => {
    sessionStorage.setItem('tasksAlertDismissed', '1');
    setShowDueBanner(false);
  };

  const fetchBookmarkCount = () => {
    api.get('/api/bookmarks/count').then(r => r.json()).then(d => setBookmarkCount(d.count || 0)).catch(() => {});
  };

  const fetchSuggestionCount = () => {
    api.get('/api/suggestions/count?status=new').then(r => r.json()).then(d => setNewSuggestionCount(d.count || 0)).catch(() => {});
  };

  useEffect(() => {
    fetchBookmarkCount();
    fetchSuggestionCount();
    window.addEventListener('vault:bookmark-changed', fetchBookmarkCount);
    window.addEventListener('vault:suggestions-changed', fetchSuggestionCount);
    return () => {
      window.removeEventListener('vault:bookmark-changed', fetchBookmarkCount);
      window.removeEventListener('vault:suggestions-changed', fetchSuggestionCount);
    };
  }, []);

  useEffect(() => {
    api.get('/api/settings/feature-access')
      .then(r => r.json())
      .then(data => {
        if (data?.flags && typeof data.flags === 'object') {
          setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...data.flags });
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    api.get('/api/mission/reminder-status').then(r => r.json()).then(d => {
      if (d?.shouldShow) setMissionReminderDue(true);
    }).catch(() => {});
    const clearBadge = () => setMissionReminderDue(false);
    window.addEventListener('vault:mission-reminder-cleared', clearBadge);
    return () => window.removeEventListener('vault:mission-reminder-cleared', clearBadge);
  }, []);

  // Inquiry reminder logic
  const checkInquiryReminder = useCallback(async (settings) => {
    const freq = settings?.inquiry_reminder_frequency || 'off';
    if (freq === 'off') return;

    const todayKey = new Date().toISOString().slice(0, 10);
    const storageKey = `inquiry_reminder_${todayKey}`;
    if (localStorage.getItem(storageKey)) return;

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const reminderTime = settings?.inquiry_reminder_time || '09:00';
    const [rh, rm] = reminderTime.split(':').map(Number);
    const reminderMinutes = rh * 60 + rm;

    // Only show if we're within a 4-hour window after the scheduled time
    const diff = currentMinutes - reminderMinutes;
    if (diff < 0 || diff > 240) return;

    // For weekly: check if today's day-of-week is in the configured days
    if (freq === 'weekly') {
      const todayDow = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
      let days = [];
      try { days = JSON.parse(settings.inquiry_reminder_days || '[]'); } catch {}
      if (!days.includes(todayDow)) return;
    }

    setShowInquiryReminder(true);
  }, []);

  useEffect(() => {
    api.get('/api/settings').then(r => r.json()).then(data => {
      setInquiryReminderSettings(data);
      checkInquiryReminder(data);
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-check on route change (in case it's a new day)
  useEffect(() => {
    if (inquiryReminderSettings) checkInquiryReminder(inquiryReminderSettings);
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // Task reminder logic
  const showReminderForTime = useCallback(async (time) => {
    try {
      const res = await api.get('/api/tasks/morning-digest');
      const data = await res.json();
      if ((data.today?.length || 0) + (data.overdue?.length || 0) > 0) {
        setReminderModal({ time, overdue: data.overdue || [], today: data.today || [] });
      }
    } catch {}
  }, []);

  // On mount: show most recent missed reminder from the past 4 hours
  useEffect(() => {
    if (taskRemindersPaused || !taskReminderTimes.length) return;
    const now = new Date();
    const todayKey = now.toISOString().slice(0, 10);
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

    const missed = taskReminderTimes
      .filter(time => {
        const diff = currentMinutes - toMin(time);
        return diff >= 0 && diff <= 240 && !localStorage.getItem(`vault:reminder:${todayKey}_${time}`);
      })
      .sort((a, b) => toMin(b) - toMin(a));

    if (missed.length > 0) {
      localStorage.setItem(`vault:reminder:${todayKey}_${missed[0]}`, '1');
      showReminderForTime(missed[0]);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Periodic check every minute for scheduled reminders
  useEffect(() => {
    if (taskRemindersPaused || !taskReminderTimes.length) return;
    const interval = setInterval(() => {
      const now = new Date();
      const todayKey = now.toISOString().slice(0, 10);
      const currentHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      for (const time of taskReminderTimes) {
        if (time !== currentHHMM) continue;
        const storageKey = `vault:reminder:${todayKey}_${time}`;
        if (localStorage.getItem(storageKey)) continue;
        localStorage.setItem(storageKey, '1');
        showReminderForTime(time);
        break;
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [taskReminderTimes, taskRemindersPaused, showReminderForTime]);

  // Track mobile/desktop on resize
  useEffect(() => {
    const check = () => {
      const mobile = window.innerWidth < 640;
      setIsMobile(mobile);
      // Auto-open sidebar when transitioning to desktop
      if (!mobile) setSidebarOpen(true);
    };
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Auto-close sidebar on mobile when navigating
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // External toggle event (keyboard shortcut etc.)
  useEffect(() => {
    const handler = () => setSidebarOpen(v => {
      const next = !v;
      localStorage.setItem('vault:sidebarOpen', String(next));
      return next;
    });
    document.addEventListener('vault:toggle-sidebar', handler);
    return () => document.removeEventListener('vault:toggle-sidebar', handler);
  }, []);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
    clearAuth();
    navigate('/login', { replace: true });
  };

  const canUseFeature = (key) => {
    if (user?.isAdmin) return true;
    return featureAccess[key] !== false;
  };

  // Sidebar styles differ on mobile (fixed overlay) vs desktop (push)
  const sidebarStyle = isMobile
    ? {
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        zIndex: 40,
        width: `${sidebarWidth}px`,
        transform: sidebarOpen ? 'translateX(0)' : `translateX(-${sidebarWidth}px)`,
        transition: 'transform 0.2s ease',
        borderRight: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }
    : {
        width: sidebarOpen ? `${sidebarWidth}px` : '48px',
        transition: isResizing.current ? 'none' : 'width 0.2s',
        borderRight: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        overflow: 'hidden',
        position: 'relative',
      };

  return (
    <div
      className="flex overflow-hidden"
      style={{ height: '100dvh', background: 'var(--color-bg)', color: 'var(--color-text)' }}
    >
      {/* Mobile backdrop — tap to close sidebar */}
      {isMobile && sidebarOpen && (
        <div
          className="fixed inset-0 z-30"
          style={{ background: 'rgba(0,0,0,0.35)' }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside style={sidebarStyle}>
        <ProjectSidebar
          onClose={() => setSidebarOpen(false)}
          showHabits={canUseFeature('goals') && canUseFeature('habitsSidebar')}
          collapsed={!sidebarOpen && !isMobile}
        />
        {/* Drag-to-resize handle — desktop only */}
        {!isMobile && sidebarOpen && (
          <div
            onMouseDown={startResize}
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              width: '5px',
              height: '100%',
              cursor: 'col-resize',
              zIndex: 10,
            }}
            className="group"
          >
            {/* Thin visible line that brightens on hover / while dragging */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                width: '2px',
                height: '100%',
                background: 'var(--color-border)',
                transition: 'background 0.15s',
              }}
              className="group-hover:opacity-100"
            />
          </div>
        )}
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header
          className="flex-shrink-0 h-11 flex items-center gap-2 px-3 border-b"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
        >
          <button
            onClick={() => setSidebarOpen(v => {
              const next = !v;
              if (!isMobile) localStorage.setItem('vault:sidebarOpen', String(next));
              return next;
            })}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:opacity-60 transition-opacity flex-shrink-0"
            style={{ color: 'var(--color-muted)' }}
            data-tip="Toggle sidebar"
          >
            {getIcon('chevron-right', {
              size: 16,
              style: { transform: sidebarOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' },
            })}
          </button>

          <Link
            to={isMobile ? '/mobile-dashboard' : '/'}
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
            to="/tasks"
            className="w-7 h-7 hidden sm:flex items-center justify-center rounded-md hover:opacity-60 transition-opacity"
            style={{ color: location.pathname === '/tasks' ? 'var(--color-primary)' : 'var(--color-muted)' }}
            data-tip="Tasks"
          >
            {getIcon('list-checks', { size: 16 })}
          </Link>

          <Link
            to="/history"
            className="hidden sm:flex w-7 h-7 items-center justify-center rounded-md hover:opacity-60 transition-opacity relative"
            style={{ color: location.pathname === '/history' ? 'var(--color-primary)' : 'var(--color-muted)' }}
            data-tip="Chat History"
          >
            {getIcon('clock', { size: 16 })}
            {bookmarkCount > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full"
                style={{ background: '#f59e0b' }}
              />
            )}
          </Link>

          <Link
            to="/suggestions"
            className="hidden sm:flex w-7 h-7 items-center justify-center rounded-md hover:opacity-60 transition-opacity relative"
            style={{ color: location.pathname === '/suggestions' ? 'var(--color-primary)' : 'var(--color-muted)' }}
            data-tip="Suggestions"
          >
            {getIcon('inbox', { size: 16 })}
            {newSuggestionCount > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 px-0.5 rounded-full text-[9px] font-bold flex items-center justify-center"
                style={{ background: 'var(--color-primary)', color: '#fff' }}
              >
                {newSuggestionCount > 9 ? '9+' : newSuggestionCount}
              </span>
            )}
          </Link>

          <AppsLauncher
            canUseFeature={canUseFeature}
            isAdmin={!!user?.isAdmin}
            missionReminderDue={missionReminderDue}
          />

          <Link
            to="/settings"
            className="w-7 h-7 hidden sm:flex items-center justify-center rounded-md hover:opacity-60 transition-opacity"
            style={{ color: location.pathname === '/settings' ? 'var(--color-primary)' : 'var(--color-muted)' }}
            data-tip="Settings"
          >
            {getIcon('settings', { size: 16 })}
          </Link>

          <button
            onClick={handleLogout}
            className="w-7 h-7 hidden sm:flex items-center justify-center rounded-md hover:opacity-60 transition-opacity"
            style={{ color: 'var(--color-muted)' }}
            data-tip="Sign out"
          >
            {getIcon('log-out', { size: 16 })}
          </button>

          {/* Mobile-only controls */}
          {isMobile && (
            <div className="flex items-center gap-0.5">
              {location.pathname !== '/mobile-dashboard' && (
                <Link
                  to="/mobile-dashboard"
                  className="w-8 h-8 flex items-center justify-center rounded-md hover:opacity-60 transition-opacity"
                  style={{ color: 'var(--color-muted)' }}
                  data-tip="Dashboard"
                >
                  {getIcon('home', { size: 16 })}
                </Link>
              )}
              <button
                onClick={() => setMobileNavOpen(true)}
                className="w-8 h-8 flex items-center justify-center rounded-md hover:opacity-60 transition-opacity"
                style={{ color: 'var(--color-muted)' }}
                data-tip="Menu"
              >
                {getIcon('menu', { size: 16 })}
              </button>
              <button
                onClick={handleLogout}
                className="w-8 h-8 flex items-center justify-center rounded-md hover:opacity-60 transition-opacity"
                style={{ color: 'var(--color-muted)' }}
                data-tip="Sign out"
              >
                {getIcon('log-out', { size: 16 })}
              </button>
            </div>
          )}
        </header>

        {canUseFeature('student') && location.pathname.startsWith('/student') && (
          <PageToolbar
            data-tip="Student"
            views={[
              { mode: 'quiz', icon: 'clipboard-list', label: 'Quiz' },
              { mode: 'cards', icon: 'layers', label: 'Cards' },
              { mode: 'saved-decks', icon: 'library', label: 'Saved' },
            ]}
            activeView={
              location.pathname.includes('/student/saved-decks')
                ? 'saved-decks'
                : location.pathname.includes('/student/cards')
                  ? 'cards'
                  : 'quiz'
            }
            onViewChange={(mode) => {
              if (mode === 'saved-decks') navigate('/student/saved-decks');
              else navigate(`/student/${mode}`);
            }}
          />
        )}

        {/* Mobile nav dropdown */}
        {isMobile && mobileNavOpen && (
          <MobileNavDropdown onClose={() => setMobileNavOpen(false)} isAdmin={!!user?.isAdmin} />
        )}

        {/* Due today banner */}
        {showDueBanner && (
          <div
            className="flex-shrink-0 flex items-center gap-3 px-4 py-2 text-sm"
            style={{ background: '#fffbeb', borderBottom: '1px solid #fde68a', color: '#78350f' }}
          >
            <span>⚠️</span>
            <span className="flex-1">
              You have {dueTodayCount} task{dueTodayCount !== 1 ? 's' : ''} due today.{' '}
              <Link to="/tasks" onClick={dismissDueBanner} style={{ color: '#92400e', fontWeight: 600, textDecoration: 'underline' }}>
                View Tasks
              </Link>
            </span>
            <button onClick={dismissDueBanner} className="hover:opacity-60 transition-opacity font-bold" style={{ color: '#92400e' }}>✕</button>
          </div>
        )}

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
      <TourButton />
      <Toast />
      <QuickCapture />
      <MorningDigest />
      {reminderModal && (
        <TaskReminderModal
          time={reminderModal.time}
          overdue={reminderModal.overdue}
          today={reminderModal.today}
          onDismiss={() => setReminderModal(null)}
        />
      )}

      {/* Inquiry reminder banner */}
      {showInquiryReminder && !showInquirySession && (
        <div
          className="fixed bottom-5 left-1/2 z-[65] w-full max-w-sm"
          style={{ transform: 'translateX(-50%)', animation: 'slideUp 0.25s ease' }}
        >
          <style>{`@keyframes slideUp { from { opacity: 0; transform: translateX(-50%) translateY(16px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }`}</style>
          <div
            className="rounded-2xl border shadow-2xl px-5 py-4"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
          >
            <p className="text-sm font-semibold mb-0.5" style={{ color: 'var(--color-text)' }}>
              Time for your reflection
            </p>
            <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>
              A few minutes of guided inquiry can help you understand what is really going on.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const todayKey = new Date().toISOString().slice(0, 10);
                  localStorage.setItem(`inquiry_reminder_${todayKey}`, '1');
                  setShowInquiryReminder(false);
                  setShowInquirySession(true);
                }}
                className="flex-1 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity"
                style={{ background: 'var(--color-primary)' }}
              >
                Begin now
              </button>
              <button
                onClick={() => {
                  const todayKey = new Date().toISOString().slice(0, 10);
                  localStorage.setItem(`inquiry_reminder_${todayKey}`, '1');
                  setShowInquiryReminder(false);
                }}
                className="flex-1 py-2 rounded-xl text-sm border hover:opacity-70 transition-opacity"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                Maybe later
              </button>
            </div>
          </div>
        </div>
      )}

      {showInquirySession && (
        <InquirySession
          onClose={() => setShowInquirySession(false)}
          onComplete={() => {}}
        />
      )}
    </div>
  );
}

export default Layout;
