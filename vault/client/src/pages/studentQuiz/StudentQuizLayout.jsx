import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import useAuthStore from '../../store/authStore';
import api from '../../utils/apiClient';
import { DEFAULT_FEATURE_ACCESS } from '../../utils/featureAccess';
import QuizBuildingModal from '../../components/studentQuiz/QuizBuildingModal';
import { QuizBuildContext } from './quizBuildContext';

const TABS = [
  { to: '/student/quiz', end: true, label: 'Dashboard' },
  { to: '/student/quiz/library', end: false, label: 'Quiz Library' },
  { to: '/student/quiz/take', end: false, label: 'Take Quiz' },
  { to: '/student/quiz/results', end: false, label: 'Results' },
];

export default function StudentQuizLayout() {
  const { user } = useAuthStore();
  const isAdmin = !!user?.isAdmin;
  const location = useLocation();
  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const [buildState, setBuildState] = useState(null);
  const canUseStudent = isAdmin || featureAccess.student !== false;

  const startQuizBuild = useCallback((title) => {
    setBuildState({ title: title?.trim() || 'New quiz' });
  }, []);

  const endQuizBuild = useCallback(() => {
    setBuildState(null);
  }, []);

  const buildContext = useMemo(
    () => ({ buildState, startQuizBuild, endQuizBuild }),
    [buildState, startQuizBuild, endQuizBuild],
  );

  useEffect(() => {
    api.get('/api/settings/feature-access')
      .then((r) => r.json())
      .then((data) => {
        if (data?.flags && typeof data.flags === 'object') {
          setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...data.flags });
        }
      })
      .catch(() => {});
  }, []);

  if (!canUseStudent) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 py-12" style={{ background: 'var(--color-bg)' }}>
        <p className="text-sm text-center max-w-sm" style={{ color: 'var(--color-muted)' }}>
          Student workspace is turned off. Ask an admin to enable it under Settings → Feature Access.
        </p>
      </div>
    );
  }

  const hideSubNav = /\/student\/quiz\/take\/\d+/.test(location.pathname);

  return (
    <QuizBuildContext.Provider value={buildContext}>
    <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: 'var(--color-bg)' }}>
      {buildState && <QuizBuildingModal title={buildState.title} />}
      {!hideSubNav && (
        <div
          className="flex-shrink-0 px-4 pt-3 pb-0 border-b overflow-x-auto"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
        >
          <nav className="flex gap-1 min-w-max">
            {TABS.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.end}
                className="px-3 py-2 text-xs font-medium rounded-t-lg transition-opacity hover:opacity-70 whitespace-nowrap"
                style={({ isActive }) => {
                  const onTake = tab.label === 'Take Quiz' && location.pathname.includes('/take/');
                  const onResults = tab.label === 'Results' && location.pathname.includes('/results/');
                  const active = isActive || onTake || onResults;
                  return {
                    color: active ? 'var(--color-primary)' : 'var(--color-muted)',
                    borderBottom: active ? '2px solid var(--color-primary)' : '2px solid transparent',
                    marginBottom: -1,
                  };
                }}
              >
                {tab.label}
              </NavLink>
            ))}
          </nav>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <Outlet />
      </div>
    </div>
    </QuizBuildContext.Provider>
  );
}
