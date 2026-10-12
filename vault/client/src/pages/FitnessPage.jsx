import React, { useCallback, useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import api from '../utils/apiClient';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import useProcessingStore from '../store/processingStore';
import { useIcon } from '../providers/IconProvider';
import PageToolbar from '../components/PageToolbar';
import ConfirmModal from '../components/ConfirmModal';
import Tooltip from '../components/Tooltip';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import { VoiceInputProvider } from '../components/voiceInput/VoiceInput';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import { startFitnessTour } from '../utils/tours/fitnessTour';
import Onboarding from './fitness/Onboarding';
import BaselineView from './fitness/BaselineView';
import GoalView from './fitness/GoalView';
import Overview from './fitness/Overview';
import ProfileTab from './fitness/ProfileTab';
import FitnessInfoBody, { INFO_KEY } from './fitness/FitnessInfo';

const VIEWS = [
  { mode: 'overview', icon: 'home', label: 'Overview' },
  { mode: 'goal', icon: 'target', label: 'Goal' },
  { mode: 'profile', icon: 'user', label: 'Profile' },
];

function StartOverModal({ onConfirm, onCancel }) {
  const [clear, setClear] = useState(false);
  const [clearWeight, setClearWeight] = useState(false);
  return (
    <ConfirmModal
      title="Start over?"
      confirmLabel="Start over"
      confirmText={clear ? 'RESET' : undefined}
      danger={clear}
      onConfirm={() => onConfirm(clear, clear && clearWeight)}
      onCancel={onCancel}
      message={(
        <div className="space-y-3">
          <p>You will go back to the first step of the wizard, with your earlier answers filled in so you can change what you like.</p>
          <p>Your earlier goals and ratings are kept as history.</p>
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" className="mt-1" checked={clear} onChange={(e) => setClear(e.target.checked)} />
            <span>Clear everything instead: ratings, goals, and my date of birth, sex and height. This cannot be undone.</span>
          </label>
          {clear && (
            <label className="flex items-start gap-2 cursor-pointer ml-6">
              <input type="checkbox" className="mt-1" checked={clearWeight} onChange={(e) => setClearWeight(e.target.checked)} />
              <span>
                Also delete my weight history
                <span className="block text-xs mt-0.5">Kept by default, because the diet app planned for later will use it too.</span>
              </span>
            </label>
          )}
        </div>
      )}
    />
  );
}

export default function FitnessPage() {
  const getIcon = useIcon();
  const { user } = useAuthStore();
  const addToast = useToastStore((s) => s.addToast);
  const { startProcessing, stopProcessing } = useProcessingStore();
  const info = useToolInfoModal(INFO_KEY);
  const [params, setParams] = useSearchParams();

  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const canUse = user?.isAdmin || featureAccess.fitness !== false;

  const [meta, setMeta] = useState(null);
  const [state, setState] = useState(null);
  const [view, setView] = useState('overview');
  const [focusRerate, setFocusRerate] = useState(false);
  const [settingGoal, setSettingGoal] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    api.get('/api/settings/feature-access')
      .then((r) => r.json())
      .then((d) => { if (d?.flags) setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...d.flags }); })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    try {
      const [m, s] = await Promise.all([api.get('/api/fitness/meta'), api.get('/api/fitness/me')]);
      if (!m.ok || !s.ok) throw new Error('Could not load the planner');
      setMeta(await m.json());
      setState(await s.json());
    } catch (err) {
      addToast(err.message, 'error');
    }
  }, [addToast]);

  useEffect(() => { load(); }, [load]);

  const goTo = useCallback((mode, opts = {}) => {
    setFocusRerate(!!opts.rerate);
    setView(mode);
  }, []);

  const runTour = useCallback(() => {
    if (!state) return;
    try { localStorage.removeItem('vault_tour_fitness_completed'); } catch (_) { /* ignore */ }
    setSettingGoal(false);
    startFitnessTour({ stage: state.stage, goTo });
  }, [state, goTo]);

  // Settings -> Tours -> Fitness Tour opens /fitness?tour=1
  useEffect(() => {
    if (!state || !params.get('tour')) return;
    const next = new URLSearchParams(params);
    next.delete('tour');
    setParams(next, { replace: true });
    setTimeout(runTour, 400);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const startOver = async (clear, clearWeight = false) => {
    setConfirmReset(false);
    startProcessing(clear ? 'Clearing your answers…' : 'Resetting the wizard…');
    try {
      const r = await api.post('/api/fitness/reset', { clear, clearWeight });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not reset');
      setState(d);
      setSettingGoal(false);
      setView('overview');
      addToast(clear ? 'Cleared. Starting fresh.' : 'Back to the start. Your earlier answers are filled in.', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  };

  if (!canUse) return <Navigate to="/" replace />;

  const stage = state?.stage;
  const onboarding = stage && stage !== 'done';

  let body = <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>;
  if (meta && state) {
    if (stage === 'profile' || stage === 'ratings') {
      body = <Onboarding key={state.profile ? 'retake' : 'new'} meta={meta} state={state} onSaved={(s) => setState(s)} />;
    } else if (stage === 'baseline') {
      body = (
        <div className={`${settingGoal ? 'max-w-5xl' : 'max-w-3xl'} mx-auto w-full`}>
          {settingGoal
            ? <GoalView meta={meta} state={state} mode="first" onSaved={(s) => { setState(s); setSettingGoal(false); setView('overview'); }} />
            : <BaselineView meta={meta} state={state} onContinue={() => setSettingGoal(true)} />}
        </div>
      );
    } else if (view === 'overview') {
      body = <Overview meta={meta} state={state} goTo={goTo} />;
    } else if (view === 'goal') {
      body = (
        <div className="max-w-5xl mx-auto w-full">
          <GoalView
            meta={meta}
            state={state}
            mode="revisit"
            onAddMinutes={() => goTo('profile')}
            onSaved={(s) => { setState(s); goTo('overview'); }}
            onCancel={() => goTo('overview')}
          />
        </div>
      );
    } else {
      body = <ProfileTab meta={meta} state={state} focusRerate={focusRerate} onChanged={(s) => setState(s)} />;
    }
  }

  const overflow = [
    { label: 'Start over (retake the wizard)', icon: 'rotate-ccw', onClick: () => setConfirmReset(true), disabled: !state?.profile && !state?.lifestyle },
    ...(user?.isAdmin ? [{ label: 'Create demo user', icon: 'user', onClick: async () => {
      try {
        const r = await api.post('/api/fitness/admin/demo-seed', {});
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Could not create the demo user');
        addToast(d.password ? `${d.email} created. Password: ${d.password}` : `${d.email} refreshed`, 'success', 20000);
      } catch (err) { addToast(err.message, 'error'); }
    } }] : []),
  ];

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden" style={{ background: 'var(--color-bg)' }}>
      <PageToolbar
        title="Fitness"
        views={onboarding ? [] : VIEWS}
        viewsGroupTour="fitness-tabs"
        activeView={view}
        onViewChange={(m) => goTo(m)}
        overflowActions={overflow}
      >
        <div className="flex items-center gap-1" data-tour="fitness-help">
          <Tooltip text="Take the guided tour">
            <button type="button" aria-label="Take the Fitness tour" onClick={runTour} className="w-8 h-8 flex items-center justify-center rounded-lg hover:opacity-60 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}>
              {getIcon('compass', { size: 15 })}
            </button>
          </Tooltip>
          <Tooltip text="How this works">
            <button type="button" aria-label="How the Fitness Planner works" onClick={info.open} className="w-8 h-8 flex items-center justify-center rounded-lg hover:opacity-60 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}>
              {getIcon('info', { size: 15 })}
            </button>
          </Tooltip>
        </div>
      </PageToolbar>

      <VoiceInputProvider lang="en-AU">
        <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-6">
          {body}
          <p className="max-w-3xl mx-auto text-xs leading-relaxed mt-8 text-center" style={{ color: 'var(--color-muted)' }}>
            {meta?.disclaimer || 'A lifestyle tool, not medical advice.'}
          </p>
        </div>
      </VoiceInputProvider>

      {info.show && (
        <ToolInfoModal title="How the Fitness Planner works" onClose={info.close}>
          <FitnessInfoBody disclaimer={meta?.disclaimer} />
        </ToolInfoModal>
      )}
      {confirmReset && <StartOverModal onConfirm={startOver} onCancel={() => setConfirmReset(false)} />}
    </div>
  );
}
