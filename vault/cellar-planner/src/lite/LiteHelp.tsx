import { useEffect, useRef } from 'react';
import { LITE_UNIT_WIDTH_MM } from './settings';

export const LITE_HELP_KEY = 'cellar-lite:help-seen:v1';

/**
 * "How this works": the plain-language guide for someone who has never planned a cellar. Opens on the first visit and from the Help button.
 * No jargon: every term the screen uses is explained here.
 */
export function LiteHelp({ open, onClose, onTour }: { open: boolean; onClose(): void; onTour(): void }) {
  const start = useRef<HTMLButtonElement>(null);
  const before = useRef<Element | null>(null);
  // focus goes into the guide when it opens, Esc closes it, and focus goes back to where it was
  useEffect(() => {
    if (!open) return undefined;
    before.current = document.activeElement;
    start.current?.focus();
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); if (before.current instanceof HTMLElement) before.current.focus(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open) return null;
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="How this works" data-testid="lite-help" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal wide help">
        <div className="modal-head"><h2>How this works</h2><button type="button" className="icon-btn" aria-label="Close" title="Close" onClick={onClose} data-testid="lite-help-close">✕</button></div>
        <div className="modal-body" tabIndex={0} role="region" aria-label="Guide text">
          <h3>What this is</h3>
          <p>A quick way to see what a wine cellar could look like in your space, and roughly how many bottles it would hold. You answer a few simple questions and the drawing and the bottle estimate update straight away. You cannot break anything: change any answer as often as you like.</p>
          <p><b>It is an estimate, not a quote or a building plan.</b> The sizes of the racks are typical ones, and we always measure on site before anything is made.</p>

          <h3>The questions, in plain words</h3>
          <ul>
            <li><b>Inside width, depth and height.</b> The usable space <i>inside</i> the cellar, wall to wall, in millimetres (1 metre is 1000 mm, so 2.7 metres is 2700). Width is side to side on the drawing, depth is front to back, height is floor to ceiling. If you have not measured, type your best guess or the size of the space you have in mind: we confirm it with you later.</li>
            <li><b>Door on the.</b> Which side of the drawing the door is on. South is the bottom of the drawing, North the top, West the left and East the right. Think of the drawing as a map seen from above.</li>
            <li><b>Door type.</b> A <i>single</i> door is one door, about 970 mm wide. A <i>double</i> door is a pair that open together, about 1500 mm across in total: easier for carrying furniture or large deliveries through, but it takes up more of the wall, so a little less room is left for racks.</li>
            <li><b>Main bottle style.</b> The shape of the bottles you have most of. Bordeaux is the common tall straight-sided bottle (most reds and many whites). Burgundy is wider (pinot noir, chardonnay). Champagne and sparkling is wider again. A magnum holds 1.5 litres. Wider bottles need more room, so fewer fit.</li>
            <li><b>How many bottles.</b> <i>As many as fit</i> fills every wall with racks. <i>A number I choose</i> lets you type how many you want, and the plan uses just enough racks for that.</li>
          </ul>

          <h3>What you see</h3>
          <ul>
            <li><b>About … bottles</b> is the estimate. If a size cannot be built (for example the room is too small for the door) it says so in red and tells you why.</li>
            <li><b>Plan from above</b> is the cellar as if you were looking down from the ceiling: the walls, the door with the way it swings open, and the racks in orange. The numbers around the edge are sizes in millimetres.</li>
            <li><b>Racks on a wall</b> shows one wall as you would see it standing inside the cellar, with every bottle drawn at its real size. Choose the wall with the buttons beside the tabs.</li>
            <li>To look closer, drag the drawing to move it and pinch (or scroll) to zoom. <b>Fit</b> brings it all back.</li>
          </ul>

          <h3>Standard rack units</h3>
          <p>The estimate is built from <b>standard-size rack units</b>: ready-made blocks of racking, about <b>{LITE_UNIT_WIDTH_MM} mm wide</b> each, that stand against the walls. Every unit is the same size, so we can count bottles reliably and price them simply. Units are placed <b>whole</b> (we do not cut one down), so what is left over at the end of a wall, or beside the door, is shown as an empty gap. Those gaps are normal. The exact unit sizes are confirmed with the rack supplier, so the final count can differ a little. If a custom size would suit your space better, tell us when you ask for a quote.</p>

          <h3>Asking for a quote</h3>
          <p>When you are happy, press <b>Request a quote for this design</b>. Your answers are added to the enquiry form on the page, or you can copy them into an email. Nothing is sent until <i>you</i> press the form&apos;s own Send button. Your answers are only the room size, door side, bottle style and bottle count: no personal details. You can also bookmark the page address: it remembers your answers.</p>

          <h3>Good to know</h3>
          <ul>
            <li>The sizes of racks, walls and the door are typical values, so the bottle count can change once we confirm the real ones.</li>
            <li>Racks are placed along the walls and around the door. The drawing shows exactly where, so you can see how much floor is left to stand in.</li>
            <li>Not sure about something? Just ask when you send your enquiry. No question is too small.</li>
          </ul>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" title="A guided walk through the screen, one step at a time." onClick={onTour} data-testid="lite-help-tour">Take the tour</button>
          <span className="grow" />
          <button type="button" ref={start} className="btn primary" title="Close this guide and start planning. The Help button opens it again." onClick={onClose} data-testid="lite-help-got-it">Start planning</button>
        </div>
      </div>
    </div>
  );
}
