import { useEffect, useRef } from 'react';
import type { DoorStyle } from './settings';

/**
 * "How is the price worked out?": what the price of a cellar depends on, using the visitor's own choices. It never shows a figure: the business
 * quotes after a site measure. Same dialog behaviour as the guide (focus in, Esc closes, focus back).
 */
export interface PriceHelpFacts { units: number; doorStyle: DoorStyle; bottles: number; /** The names of the feature options chosen (not the standard ones). */ extras?: string[]; /** The room size already written in the visitor's unit, for example "2.75 × 1.565 × 2.15 m". */ roomText: string; bottleLabel: string }

export function PriceHelp({ open, onClose, facts }: { open: boolean; onClose(): void; facts: PriceHelpFacts }) {
  const close = useRef<HTMLButtonElement>(null);
  const before = useRef<Element | null>(null);
  useEffect(() => {
    if (!open) return undefined;
    before.current = document.activeElement;
    close.current?.focus();
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); if (before.current instanceof HTMLElement) before.current.focus(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open) return null;

  const door = facts.doorStyle === 'DOUBLE' ? 'double' : 'single';
  const extras = facts.extras ?? [];
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="How the price is worked out" data-testid="lite-price-help" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal wide help">
        <div className="modal-head"><h2>How the price is worked out</h2><button type="button" className="icon-btn" aria-label="Close" title="Close" onClick={onClose} data-testid="lite-price-help-close">✕</button></div>
        <div className="modal-body" tabIndex={0} role="region" aria-label="Price explanation">
          <p>Every cellar is priced from the choices you make on this page. We do not show a figure here, because the final price depends on things we can only confirm once we have seen the space.</p>

          <h3>What the price depends on</h3>
          <ul>
            <li><b>The racking.</b> Your room size, bottle style and the number of bottles you want decide how many standard rack units fit along the walls. More units means a higher price. Your design currently uses <b>{facts.units} rack {facts.units === 1 ? 'unit' : 'units'}</b>.</li>
            <li><b>The door.</b> A single or a double door. Yours is a <b>{door} door</b>.</li>
            <li><b>Your feature choices.</b> Each finishing touch you add, such as glass, lighting or a centrepiece, adds to the price.{extras.length > 0 && <> You have chosen <b>{extras.join(', ')}</b>.</>}</li>
            <li><b>The basics every cellar needs.</b> Work and materials that every cellar has, whatever its size.</li>
            <li><b>Your site.</b> Access, the walls and floor you have now, and where the cooling unit can go. We check these when we measure.</li>
          </ul>

          <h3>Your design right now</h3>
          <ul>
            <li>Room: <b>{facts.roomText}</b> inside</li>
            <li>Bottle style: <b>{facts.bottleLabel}</b>, about <b>{facts.bottles}</b> bottles</li>
            <li>Rack units: <b>{facts.units}</b>; door: <b>{door}</b></li>
            {extras.length > 0 && <li>Features: <b>{extras.join(', ')}</b></li>}
          </ul>

          <p>For your price, press <b>Request a quote for this design</b>. We will be in touch with your plan and confirm the price after a site measure.</p>
        </div>
        <div className="modal-foot">
          <span className="grow" />
          <button type="button" ref={close} className="btn primary" title="Close this explanation and go back to your design." onClick={onClose} data-testid="lite-price-help-done">Got it</button>
        </div>
      </div>
    </div>
  );
}
