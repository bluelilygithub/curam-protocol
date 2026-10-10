import { useEffect, useRef } from 'react';
import { describeLength, type LengthUnit } from './units';

export const LITE_HELP_KEY = 'cellar-lite:help-seen:v1';

/**
 * "How this works": the plain-language guide for someone who has never planned a cellar. Opens on the first visit and from the Help button.
 * No jargon: every term the screen uses is explained here.
 */
export function LiteHelp({ open, onClose, onTour, unit, unitWidthMm, doorSingleMm, doorDoubleMm }: { open: boolean; onClose(): void; onTour(): void; unit: LengthUnit; unitWidthMm: number; doorSingleMm: number; doorDoubleMm: number }) {
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
          <p>A quick way to see what a wine cellar could look like in your space, and roughly how many bottles it would hold. You go through three short steps (<b>Space</b>, <b>Racking &amp; finishes</b>, <b>Review</b>) and the picture and the bottle estimate update straight away. You cannot break anything: change any answer as often as you like.</p>
          <p><b>It is an estimate, not a quote or a building plan.</b> The sizes of the racks are typical ones, and we always measure on site before anything is made.</p>

          <h3>The steps, in plain words</h3>
          <ul>
            <li><b>Inside width, depth and height.</b> The usable space <i>inside</i> the cellar, wall to wall. Type it in metres (2.75), feet and inches (9' 6"), or millimetres (2750): use the <b>Metres / Feet / Millimetres</b> buttons beside <b>Dimensions</b> to choose, the <b>minus</b> and <b>plus</b> buttons to nudge a size, or write the unit yourself ("275cm"). Width is side to side on the drawing, depth is front to back, height is floor to ceiling. If you have not measured, type your best guess or the size of the space you have in mind: we confirm it with you later.</li>
            <li><b>Door position.</b> Tap the wall the door is on in the little room picture (the top is North, the bottom South, the left West, the right East: think of a map seen from above). Then choose <b>Left, Centre or Right</b>: where along that wall the door sits, as you see it standing outside facing it.</li>
            <li><b>Door type.</b> A <i>single</i> door is one door, about {describeLength(doorSingleMm, unit)} wide. A <i>double</i> door is a pair that open together, about {describeLength(doorDoubleMm, unit)} across in total: easier for carrying furniture or large deliveries through, but it takes up more of the wall, so a little less room is left for racks.</li>
            <li><b>Main bottle style.</b> The shape of the bottles you have most of. Bordeaux is the common tall straight-sided bottle (most reds and many whites). Burgundy is wider (pinot noir, chardonnay). Champagne and sparkling is wider again. A magnum holds 1.5 litres. Wider bottles need more room, so fewer fit.</li>
            <li><b>How many bottles.</b> <i>As many as fit</i> fills every wall with racks. <i>A number I choose</i> lets you type, or slide, how many you want, and the plan uses just enough racks for that.</li>
            <li><b>Rack finish.</b> Oak, walnut or black. It changes how the racks look in the pictures, not how many bottles fit.</li>
          </ul>

          <h3>What you see</h3>
          <ul>
            <li><b>Estimated capacity</b> (along the bottom) is the estimate, with the floor space and your setup beside it. If a size cannot be built (for example the room is too small for the door) it says so in red and tells you why.</li>
            <li><b>3D</b> shows what the cellar would look like standing at the door and looking in from above, with the racks full of bottles and the sizes marked. Drag the picture to look a little to the left or right. Racks against the door wall are seen from behind.</li>
            <li><b>Plan</b> is the cellar as if you were looking down from the ceiling: the walls, the door with the way it swings open, and the racks in timber. The numbers around the edge are sizes in millimetres.</li>
            <li><b>Racks</b> shows one wall as you would see it standing inside the cellar, with every bottle drawn at its real size. Choose the wall with the buttons beside the tabs.</li>
            <li>To look closer, use the <b>+</b> and <b>&minus;</b> buttons on the picture. Drag the plan or a wall to move it. The round arrow brings it all back.</li>
          </ul>

          <h3>Standard rack units</h3>
          <p>The estimate is built from <b>standard-size rack units</b>: ready-made blocks of racking, about <b>{describeLength(unitWidthMm, unit)} wide</b> each, that stand against the walls. Every unit is the same size, so we can count bottles reliably and price them simply. Units are placed <b>whole</b> (we do not cut one down), so what is left over at the end of a wall, or beside the door, is shown as an empty gap. Those gaps are normal. The exact unit sizes are confirmed with the rack supplier, so the final count can differ a little. If a custom size would suit your space better, tell us when you ask for a quote.</p>

          <h3>Asking for a quote</h3>
          <p>When you are happy, press <b>Request a quote</b>, in the <b>Review</b> step or in the bar along the bottom. In <b>Review</b> you can also download your plan as a PDF, and <b>Save design</b> at the top keeps a link to this exact design. Your answers are added to the enquiry form on the page, or you can copy them into an email. Nothing is sent until <i>you</i> press the form&apos;s own Send button. Your answers are only the room size, door, bottle style, rack finish and bottle count: no personal details. You can also bookmark the page address: it remembers your answers.</p>

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
