import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import api from '../utils/apiClient';
import useAuthStore from '../store/authStore';
import { useIcon } from '../providers/IconProvider';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import Tooltip from '../components/Tooltip';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import { VoiceInputProvider } from '../components/voiceInput/VoiceInput';
import PlanList from './plans/PlanList';
import PlanEditor from './plans/PlanEditor';
import PlansTutorChat from './plans/PlansTutorChat';
import { startPlansTour, TOUR_KEY as PLANS_TOUR_KEY } from '../utils/tours/plansTour';
import { TOOL_BLURBS, HOW_IT_WORKS, GUIDE_TOOLS } from './plans/plansTools.mjs';

/**
 * Plans: steps with dates and "waits on" links, drawn as a Gantt. /plans is the list, /plans/:id is one plan.
 * Plan steps are not Tasks: they live in the plan until one is sent to Tasks. Docs: docs/plans.md.
 */
export default function PlansPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.isAdmin;
  const getIcon = useIcon();
  const navigate = useNavigate();
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const view = id ? 'editor' : 'list';
  const info = useToolInfoModal('vault_plans_info_seen');

  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const [accessKnown, setAccessKnown] = useState(false);
  const canUse = isAdmin || featureAccess.plans !== false;
  useEffect(() => {
    api.get('/api/settings/feature-access')
      .then((r) => r.json())
      .then((d) => { if (d?.flags) setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...d.flags }); })
      .catch(() => {})
      .finally(() => setAccessKnown(true));
  }, []);

  // Settings -> Plans Tour opens /plans?tour=1 (also used by the tour button while a plan is open: it goes to the list first).
  useEffect(() => {
    if (params.get('tour') && view === 'list') {
      const next = new URLSearchParams(params); next.delete('tour');
      setParams(next, { replace: true });
      setTimeout(() => startPlansTour(), 300);
    }
  }, [params, view]); // eslint-disable-line react-hooks/exhaustive-deps

  const startTour = () => {
    try { localStorage.removeItem(PLANS_TOUR_KEY); } catch (_) { /* ignore */ }
    if (view !== 'list') { navigate('/plans?tour=1'); return; }
    startPlansTour();
  };

  // The guide's "Open" buttons: switch to the view that holds the control. A plan has to be opened first, so from the list this says so.
  const openToolById = (toolId) => {
    const target = GUIDE_TOOLS.find((t) => t.id === toolId);
    if (target && target.tool === 'list' && view !== 'list') navigate('/plans');
  };

  if (accessKnown && !canUse) return <Navigate to="/" replace />;

  const iconBtn = { color: 'var(--color-muted)', lineHeight: 1, background: 'none', border: 'none', padding: 0, cursor: 'pointer' };

  return (
    <VoiceInputProvider lang="en-AU">
      <div className="min-h-[calc(100dvh-3rem)]" style={{ background: 'var(--color-bg)' }}>
        <div className="flex items-center gap-2 px-6 pt-4 pb-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-surface)', color: 'var(--color-primary)' }}>
            {getIcon('gantt-chart', { size: 16 })}
          </div>
          <h1 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Plans</h1>
          <Tooltip text="How Plans work, and what they do not do yet.">
            <button type="button" onClick={info.open} aria-label="How Plans work" className="transition-opacity duration-200 hover:opacity-60" style={iconBtn}>{getIcon('info', { size: 13 })}</button>
          </Tooltip>
          <Tooltip text="Take the guided tour of Plans.">
            <button type="button" onClick={startTour} aria-label="Take the Plans tour" className="transition-opacity duration-200 hover:opacity-60" style={iconBtn}>{getIcon('compass', { size: 13 })}</button>
          </Tooltip>
          <p className="text-sm ml-2" style={{ color: 'var(--color-muted)' }}>{TOOL_BLURBS[view]}</p>
        </div>
        {id ? <PlanEditor key={id} id={Number(id)} /> : <PlanList />}
      </div>

      {info.show && (
        <ToolInfoModal title="How Plans Work" onClose={info.close}>
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>
            A plan is a list of steps, each with a length in working days. Say when it starts and Plans works out when every step lands, and whether it finishes by your end date. Your plans are saved to your account and nobody else can see them. Not sure where to start? Press the round guide button at the bottom right and say what you want to do.
          </p>
          <div className="rounded-lg p-3 text-sm space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            {HOW_IT_WORKS.map(([heading, text]) => (
              <p key={heading} style={{ color: 'var(--color-text)' }}><strong>{heading}</strong> — {text}</p>
            ))}
          </div>
        </ToolInfoModal>
      )}
      <PlansTutorChat currentTool={view} onOpenTool={openToolById} />
    </VoiceInputProvider>
  );
}
