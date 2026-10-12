import React, { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import api from '../utils/apiClient';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import { useIcon } from '../providers/IconProvider';
import PageToolbar from '../components/PageToolbar';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import { VoiceInputProvider } from '../components/voiceInput/VoiceInput';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import Onboarding from './fitness/Onboarding';
import BaselineView from './fitness/BaselineView';
import GoalView from './fitness/GoalView';
import Overview from './fitness/Overview';
import ProfileTab from './fitness/ProfileTab';

const VIEWS = [
  { mode: 'overview', icon: 'home', label: 'Overview' },
  { mode: 'goal', icon: 'target', label: 'Goal' },
  { mode: 'profile', icon: 'user', label: 'Profile' },
];

export default function FitnessPage() {
  const getIcon = useIcon();
  const { user } = useAuthStore();
  const addToast = useToastStore((s) => s.addToast);
  const info = useToolInfoModal('vault:fitness:info-seen:v1');

  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const canUse = user?.isAdmin || featureAccess.fitness !== false;

  const [meta, setMeta] = useState(null);
  const [state, setState] = useState(null);
  const [view, setView] = useState('overview');
  const [focusRerate, setFocusRerate] = useState(false);
  const [settingGoal, setSettingGoal] = useState(false);

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

  const goTo = (mode, opts = {}) => {
    setFocusRerate(!!opts.rerate);
    setView(mode);
  };

  if (!canUse) return <Navigate to="/" replace />;

  const stage = state?.stage;
  const onboarding = stage && stage !== 'done';

  let body = <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>;
  if (meta && state) {
    if (stage === 'profile' || stage === 'ratings') {
      body = <Onboarding meta={meta} state={state} onSaved={(s) => setState(s)} />;
    } else if (stage === 'baseline') {
      body = (
        <div className="max-w-3xl mx-auto w-full">
          {settingGoal
            ? <GoalView meta={meta} state={state} mode="first" onSaved={(s) => { setState(s); setSettingGoal(false); setView('overview'); }} />
            : <BaselineView meta={meta} state={state} onContinue={() => setSettingGoal(true)} />}
        </div>
      );
    } else if (view === 'overview') {
      body = <Overview meta={meta} state={state} goTo={goTo} />;
    } else if (view === 'goal') {
      body = (
        <div className="max-w-3xl mx-auto w-full">
          <GoalView
            meta={meta}
            state={state}
            mode="revisit"
            onSaved={(s) => { setState(s); goTo('overview'); }}
            onCancel={() => goTo('overview')}
          />
        </div>
      );
    } else {
      body = <ProfileTab meta={meta} state={state} focusRerate={focusRerate} onChanged={(s) => setState(s)} />;
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden" style={{ background: 'var(--color-bg)' }}>
      <PageToolbar
        title="Fitness"
        views={onboarding ? [] : VIEWS}
        activeView={view}
        onViewChange={(m) => goTo(m)}
        overflowActions={[
          { label: 'How this works', icon: 'info', onClick: info.open },
          ...(user?.isAdmin ? [{ label: 'Create demo user', icon: 'user', onClick: async () => {
            try {
              const r = await api.post('/api/fitness/admin/demo-seed', {});
              const d = await r.json();
              if (!r.ok) throw new Error(d.error || 'Could not create the demo user');
              addToast(d.password ? `${d.email} created. Password: ${d.password}` : `${d.email} refreshed`, 'success', 20000);
            } catch (err) { addToast(err.message, 'error'); }
          } }] : []),
        ]}
      />

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
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>
            Tell us a little about yourself and rate your fitness. You get a plain-language baseline against what is healthy for your age
            (based on WHO guidance), then a five-year goal at a pace you choose.
          </p>
          <ul className="list-disc pl-5 space-y-1.5 text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>
            <li>Ratings are your own. Nobody checks them; they just help the plan fit you.</li>
            <li>Rest and quiet weeks are normal. This is a lifestyle tool, not a drill sergeant.</li>
            <li>Re-rate every 4 to 6 weeks, and revisit your goal any time from the Goal tab.</li>
            <li>The numbers come from fixed rules; the AI only helps with the wording, using the model set up in Vault Settings.</li>
          </ul>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-muted)' }}>{meta?.disclaimer}</p>
        </ToolInfoModal>
      )}
    </div>
  );
}
