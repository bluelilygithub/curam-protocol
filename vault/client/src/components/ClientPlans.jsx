import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../utils/apiClient';
import useToastStore from '../store/toastStore';
import { useIcon } from '../providers/IconProvider';
import Tooltip from './Tooltip';
import { fmtDay, progressText } from '../pages/plans/planLogic.mjs';

const BTN = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs border transition-opacity duration-200 hover:opacity-60 disabled:opacity-40';
const BTN_STYLE = { borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-surface)' };

/**
 * The plans of one client (clientId) or one client project (clientProjectId). `available` is false when Plans is off for this person, so the
 * page can leave the section out; null while loading. See docs/plans.md "Clients".
 */
export function useClientPlans({ clientId, clientProjectId }) {
  const [state, setState] = useState({ plans: null, available: null });
  const load = useCallback(async () => {
    const q = clientProjectId ? `clientProjectId=${clientProjectId}` : `clientId=${clientId}`;
    try {
      const res = await api.get(`/api/plans?${q}`);
      if (!res.ok) { setState({ plans: [], available: false }); return; }
      const data = await res.json().catch(() => ({}));
      setState({ plans: Array.isArray(data.plans) ? data.plans : [], available: true });
    } catch (_) { setState({ plans: [], available: false }); }
  }, [clientId, clientProjectId]);
  useEffect(() => { setState({ plans: null, available: null }); load(); }, [load]);
  return { ...state, reload: load };
}

/** The list of plans, and a button that starts a new one already filed under the client (and project). */
export function ClientPlansBody({ plans, clientId, clientProjectId, name }) {
  const getIcon = useIcon();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const [making, setMaking] = useState(false);
  const allLink = clientProjectId ? `/plans?clientProject=${clientProjectId}` : `/plans?client=${clientId}`;

  const make = async () => {
    if (making) return;
    setMaking(true);
    try {
      const res = await api.post('/api/plans', { title: name ? `${name} plan` : undefined, clientId: clientId ? Number(clientId) : undefined, clientProjectId: clientProjectId ? Number(clientProjectId) : undefined });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The plan could not be made. Try again.');
      navigate(`/plans/${data.plan.id}`);
    } catch (err) { addToast(err.message, 'error'); setMaking(false); }
  };

  return (
    <div className="space-y-3">
      {plans === null ? <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p> : plans.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No plans yet. Start one here, or from a note or a diagram that belongs to {name || 'this client'}: it starts with their client and project.</p>
      ) : (
        <ul className="space-y-1.5">
          {plans.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
              <Tooltip text="Open this plan to edit its steps and see the timeline.">
                <Link to={`/plans/${p.id}`} className="text-sm font-medium transition-opacity duration-200 hover:opacity-60" style={{ color: 'var(--color-primary)' }}>{p.title}</Link>
              </Tooltip>
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                {progressText(p)}
                {p.startDate || p.targetEndDate ? ` · ${p.startDate ? fmtDay(p.startDate) : '…'} to ${p.targetEndDate ? fmtDay(p.targetEndDate) : '…'}` : ''}
                {!clientProjectId && p.clientProjectName ? ` · ${p.clientProjectName}` : ''}
                {p.status !== 'active' ? ` · ${p.status}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip text={`Start a new plan filed under ${name || 'this client'}. You add its steps and dates on the plan page.`}>
          <button type="button" onClick={make} disabled={making} className={BTN} style={BTN_STYLE}>{getIcon('plus', { size: 13 })} {making ? 'Making…' : 'New plan'}</button>
        </Tooltip>
        <Tooltip text="Open the Plans page showing only these plans.">
          <Link to={allLink} className="text-xs transition-opacity duration-200 hover:opacity-60" style={{ color: 'var(--color-primary)' }}>Open in Plans →</Link>
        </Tooltip>
      </div>
    </div>
  );
}
