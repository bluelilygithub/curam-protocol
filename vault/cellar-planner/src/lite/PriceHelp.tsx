import { useEffect, useRef } from 'react';
import type { LiteConfig } from './config';
import type { DoorStyle } from './settings';

/**
 * "How is this price worked out?": an outline of how the guide price follows from the visitor's own choices. It names the parts that count and
 * how many of each THIS design has, never what any part costs. A part is only mentioned if the owner has set an amount for it, so the outline
 * always matches the formula actually in use. Opens from a button beside "Copy a link"; same dialog behaviour as the guide (focus in, Esc closes,
 * focus back).
 */
export interface PriceHelpFacts { units: number; doorStyle: DoorStyle; bottles: number; /** The room size already written in the visitor's unit, for example "2.75 × 1.565 × 2.15 m". */ roomText: string; bottleLabel: string }

export function PriceHelp({ open, onClose, cfg, facts }: { open: boolean; onClose(): void; cfg: LiteConfig; facts: PriceHelpFacts }) {
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

  const p = cfg.pricing;
  const door = facts.doorStyle === 'DOUBLE' ? 'double' : 'single';
  const hasDoorPrice = p.doorSingle !== null || p.doorDouble !== null;
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="How the guide price is worked out" data-testid="lite-price-help" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal wide help">
        <div className="modal-head"><h2>How the guide price is worked out</h2><button type="button" className="icon-btn" aria-label="Close" title="Close" onClick={onClose} data-testid="lite-price-help-close">✕</button></div>
        <div className="modal-body" tabIndex={0} role="region" aria-label="Price explanation">
          <p>The guide price comes straight from the choices you have made on this page. Change any of them and the price changes with it.</p>

          <h3>What it is built from</h3>
          <ul>
            {p.perUnit !== null && (
              <li><b>The racking.</b> Your room size, bottle style and the number of bottles you want decide how many standard rack units fit along the walls. More units means a higher price. Your design currently uses <b>{facts.units} rack {facts.units === 1 ? 'unit' : 'units'}</b>.</li>
            )}
            {hasDoorPrice && (
              <li><b>The door.</b> The type of door you choose (single or double) is included. Yours is a <b>{door} door</b>.</li>
            )}
            {p.fixed !== null && (
              <li><b>The basics every cellar needs.</b> A set amount covers the work and materials that every cellar has, whatever its size.</li>
            )}
          </ul>

          <h3>Why it is a range</h3>
          <p>You see a range, not one figure, because the final details are only known once we have measured the space and talked through your choices. The figures are rounded to a tidy amount.</p>

          <h3>Your design right now</h3>
          <ul>
            <li>Room: <b>{facts.roomText}</b> inside</li>
            <li>Bottle style: <b>{facts.bottleLabel}</b>, about <b>{facts.bottles}</b> bottles</li>
            <li>Rack units: <b>{facts.units}</b>; door: <b>{door}</b></li>
          </ul>

          {p.note && <><h3>Good to know</h3><p>{p.note}</p></>}
          <p>For an exact price, press <b>Request a quote for this design</b> and we will confirm it after a site measure.</p>
        </div>
        <div className="modal-foot">
          <span className="grow" />
          <button type="button" ref={close} className="btn primary" title="Close this explanation and go back to your design." onClick={onClose} data-testid="lite-price-help-done">Got it</button>
        </div>
      </div>
    </div>
  );
}
