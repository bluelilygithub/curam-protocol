import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/apiClient';
import useAuthStore from '../../store/authStore';
import useToastStore from '../../store/toastStore';
import { useIcon } from '../../providers/IconProvider';
import { DEFAULT_FEATURE_ACCESS } from '../../utils/featureAccess';
import Tooltip from '../../components/Tooltip';
import MakePlanDialog from './MakePlanDialog';

const BTN = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs border transition-opacity duration-200 hover:opacity-60 disabled:opacity-40';
const BTN_STYLE = { borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-surface)' };

/**
 * The Make a plan button beside To Notes. No plan yet: opens the box that makes one from this diagram. Plans made from it already: the button
 * says so ("In a plan") and lists them to go to, plus Make another plan. Not shown at all unless Plans is switched on for the person.
 *
 * `getDiagram()` reads the diagram off the board (readDiagram); `beforeOpen()` saves the drawing first, so the link back to it works.
 */
export default function PlanButton({ drawingId, title, getDiagram, beforeOpen, disabled }) {
  const getIcon = useIcon();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const isAdmin = !!useAuthStore((s) => s.user?.isAdmin);

  const [allowed, setAllowed] = useState(isAdmin);
  const [plans, setPlans] = useState([]);
  const [menu, setMenu] = useState(false);
  const [diagram, setDiagram] = useState(null); // the diagram being turned into a plan, while the box is open

  useEffect(() => {
    if (isAdmin) { setAllowed(true); return; }
    api.get('/api/settings/feature-access').then((r) => r.json())
      .then((d) => setAllowed({ ...DEFAULT_FEATURE_ACCESS, ...(d?.flags || {}) }.plans !== false))
      .catch(() => setAllowed(false));
  }, [isAdmin]);

  const loadPlans = useCallback(async () => {
    if (!drawingId) return;
    try {
      const res = await api.get(`/api/plans/by-source?kind=drawing&id=${drawingId}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.plans)) setPlans(data.plans);
    } catch (_) { /* the button just stays on "Make a plan" */ }
  }, [drawingId]);
  useEffect(() => { setPlans([]); setMenu(false); if (allowed) loadPlans(); }, [drawingId, allowed, loadPlans]);

  if (!allowed) return null;

  const start = async () => {
    setMenu(false);
    try { await beforeOpen?.(); } catch (_) { /* the drawing could not be saved; the link back may not work until it is */ }
    const r = getDiagram();
    if (!r) { addToast('Draw at least two boxes with writing in them, joined by an arrow, then try again.', 'error'); return; }
    if (r.tooBig) { addToast(`That diagram has ${r.count} boxes, more than a plan can take (40). Select a smaller part of it and try again.`, 'error'); return; }
    if (r.others > 0) addToast(`There are ${r.others + 1} separate diagrams on the board. The plan is made from the one you selected, or the biggest.`, 'success');
    setDiagram(r.diagram);
  };

  const tip = plans.length === 0
    ? 'Turn this diagram into a plan: each box becomes a step and each arrow means one step waits for the other. You choose the start, the finish-by date and the days each step takes.'
    : (plans.length === 1 ? `This diagram has been made into a plan (${plans[0].title}). Go to it, or make another.` : `This diagram has been made into ${plans.length} plans. Choose one to go to, or make another.`);

  return (
    <div className="relative" data-tour="drawings-plan">
      <Tooltip text={tip}>
        <button
          type="button" className={BTN} style={BTN_STYLE} disabled={disabled}
          aria-haspopup={plans.length ? 'menu' : undefined} aria-expanded={plans.length ? menu : !!diagram}
          onClick={() => (plans.length ? setMenu((v) => !v) : start())}
        >{getIcon('gantt-chart', { size: 13 })} {plans.length === 0 ? 'Make a plan' : (plans.length === 1 ? 'In a plan' : `In ${plans.length} plans`)}</button>
      </Tooltip>
      {menu && plans.length > 0 && (
        <ul role="menu" className="absolute right-0 mt-1 z-20 min-w-[14rem] max-w-xs rounded-xl border p-1 shadow-lg" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          {plans.map((p) => (
            <li key={p.id} role="none">
              <button type="button" role="menuitem" onClick={() => { setMenu(false); navigate(`/plans/${p.id}`); }} className="block w-full text-left px-3 py-1.5 rounded-lg text-xs truncate transition-opacity duration-200 hover:opacity-60" style={{ color: 'var(--color-text)' }}>
                Go to: {p.title || 'Untitled plan'}
              </button>
            </li>
          ))}
          <li role="none">
            <button type="button" role="menuitem" onClick={start} className="block w-full text-left px-3 py-1.5 rounded-lg text-xs transition-opacity duration-200 hover:opacity-60" style={{ color: 'var(--color-text)' }}>Make another plan</button>
          </li>
        </ul>
      )}
      {diagram && (
        <MakePlanDialog
          diagram={diagram} drawingId={drawingId} drawingTitle={title}
          onClose={() => setDiagram(null)}
          onCreated={(planId) => { setDiagram(null); loadPlans(); navigate(`/plans/${planId}`); }}
        />
      )}
    </div>
  );
}
