import React from 'react';
import { workflowSteps } from './format.mjs';

/**
 * "You are here": Search -> Choose sources -> Brief -> Draft. The current stage is filled, earlier ones are ticked and clickable (`go[id]`
 * says where each leads), later ones are muted. Derived from what is on screen; nothing is stored. `view` is topics | results | brief | draft.
 */
export default function WorkflowBar({ view, go = {} }) {
  const steps = workflowSteps(view);
  return (
    <nav aria-label="Where you are in the work" className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs" data-tour="tr-workflow">
      {steps.map((s, i) => {
        const clickable = s.state === 'done' && typeof go[s.id] === 'function';
        const style = s.state === 'current'
          ? { background: 'var(--color-primary)', color: '#fff', border: '1px solid var(--color-primary)' }
          : s.state === 'done'
            ? { border: '1px solid var(--color-border)', color: 'var(--color-text)' }
            : { border: '1px dashed var(--color-border)', color: 'var(--color-muted)' };
        const inner = <><span className="font-semibold">{s.state === 'done' ? '✓' : i + 1}</span> {s.label}</>;
        return (
          <React.Fragment key={s.id}>
            {i > 0 && <span aria-hidden="true" style={{ color: 'var(--color-muted)' }}>›</span>}
            {clickable ? (
              <button type="button" onClick={go[s.id]} title={`Go back to: ${s.label}`} className="px-2 py-0.5 rounded-full hover:opacity-70 transition-opacity" style={style}>{inner}</button>
            ) : (
              <span aria-current={s.state === 'current' ? 'step' : undefined} className="px-2 py-0.5 rounded-full" style={style}>{inner}</span>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
