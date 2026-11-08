import React, { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import api from '../utils/apiClient';
import useAuthStore from '../store/authStore';
import { useIcon } from '../providers/IconProvider';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import Tooltip from '../components/Tooltip';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import { VoiceInputProvider } from '../components/voiceInput/VoiceInput';
import PlanList from './plans/PlanList';
import PlanEditor from './plans/PlanEditor';

/**
 * Plans: steps with dates and "waits on" links, drawn as a Gantt. /plans is the list, /plans/:id is one plan.
 * Plan steps are not Tasks: they live in the plan until one is sent to Tasks. Docs: docs/plans.md.
 */
export default function PlansPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.isAdmin;
  const getIcon = useIcon();
  const { id } = useParams();
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
          {!id && <p className="text-sm ml-2" style={{ color: 'var(--color-muted)' }}>Steps with dates, and which ones wait on which, drawn as a timeline.</p>}
        </div>
        {id ? <PlanEditor key={id} id={Number(id)} /> : <PlanList />}
      </div>

      {info.show && (
        <ToolInfoModal title="How Plans Work" onClose={info.close}>
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>
            A plan is a list of steps, each with a length in working days. Say when it starts and Plans works out when every step lands, and whether it finishes by your end date. Your plans are saved to your account and nobody else can see them.
          </p>
          <div className="rounded-lg p-3 text-sm space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <p style={{ color: 'var(--color-text)' }}><strong>Start, end and length</strong> — give any two and Plans fills in the third. Start plus step lengths gives the finish; an end date plus step lengths suggests the start. If all three disagree it says by how many working days.</p>
            <p style={{ color: 'var(--color-text)' }}><strong>Waits on</strong> — a step that waits on another starts the working day after it ends. Steps that wait on nothing start together.</p>
            <p style={{ color: 'var(--color-text)' }}><strong>Pin a start</strong> — set a step's own start date to hold it there. If a step it waits on runs past that day it is marked as clashing.</p>
            <p style={{ color: 'var(--color-text)' }}><strong>Groups and milestones</strong> — a step with sub-steps spans them. A milestone takes no time and shows as a diamond.</p>
            <p style={{ color: 'var(--color-text)' }}><strong>Not built yet</strong> — making a plan from a diagram, sending a step to Tasks, dragging bars, a calendar layer, a tour and a guide chat.</p>
          </div>
        </ToolInfoModal>
      )}
    </VoiceInputProvider>
  );
}
