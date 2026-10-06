import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { INFO_KEY, type UiStore } from '../app/uiStore';
import { Icon } from './icons';

/** "How this works": the plain-language guide. Opens on the first visit and from the (i) button. */
export function InfoModal({ ui }: { ui: UiStore }) {
  const open = useStore(ui, (s) => s.infoOpen);
  const gotIt = useRef<HTMLButtonElement>(null);
  const before = useRef<Element | null>(null);
  const close = (): void => {
    try { localStorage.setItem(INFO_KEY, '1'); } catch { /* fine */ }
    ui.getState().set({ infoOpen: false });
  };
  // focus goes into the guide when it opens, Esc closes it, and focus goes back to where it was
  useEffect(() => {
    if (!open) return undefined;
    before.current = document.activeElement;
    gotIt.current?.focus();
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); if (before.current instanceof HTMLElement) before.current.focus(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open) return null;
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="How this works" data-testid="info-modal" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal wide help">
        <div className="modal-head"><h2>How Cellar Planner works</h2><button type="button" className="icon-btn" title="Close" onClick={close} data-testid="info-close"><Icon name="close" /></button></div>
        <div className="modal-body" tabIndex={0} role="region" aria-label="Guide text">
          <h3>What it is</h3>
          <p>A planner for a free-standing <b>glass walk-in wine enclosure</b>: the walls, the door, the ceiling header with its conditioner and vents, and the racks inside. It draws the plan and the wall elevations, counts bottles, and checks the design. Every size is in whole millimetres.</p>
          <p><b>This is a design aid, not a drawing for building from.</b> Every drawing says <i>preliminary design only: final site measure required prior to fabrication</i>, and the sizes that came from sample drawings are marked as unverified.</p>

          <h3>Getting started</h3>
          <ul>
            <li>The <b>Sample</b> button loads an enclosure read from the Carter Noir sample drawings (2850 × 1665 × 2200 mm), with the racks left blank. Change any number on the left and both drawings follow.</li>
            <li>The <b>Test case</b> button loads the same enclosure with racks on every wall, filled with <b>best-guess rack values</b> so there are bottles to count (1,120 to begin with). Each guess is marked <b>estimated</b> until you type your own number over it. They are invented, not a supplier's: do not quote from them.</li>
            <li>Sizes are to the <b>outer faces</b> of the walls. The <b>build-up</b> of each wall (a 50 mm panel, a 100 mm stud wall, a glass frame) is taken off to give the <b>inside size</b>, shown at the top right.</li>
            <li>Every change can be undone with <b>Undo</b>.</li>
          </ul>

          <h3>The two drawings</h3>
          <ul>
            <li><b>Plan</b> is the enclosure from above: the walls in their build-up, the door opening with the open leaf and the arc it sweeps, the racks, and the dimensions. A door that opens in also shows the floor that must stay clear.</li>
            <li><b>Elevation</b> shows one wall as you see it from <b>outside</b>: the door, the header with the conditioner and vents, and the sizes. Pick the wall with the buttons beside the tabs.</li>
            <li>Scroll to zoom, drag to move, <b>Fit</b> to bring it all back. The <b>hinge</b> side is always as seen from outside, facing the door.</li>
          </ul>

          <h3>Racks, and what “not set” means</h3>
          <p>There is no supplier sheet yet, so the <b>rack specification starts blank</b>: unit width, depth and height, row pitch, bottles per row, bottle orientation and posts. A blank is shown as <b>not set</b>, never as zero, and the bottle total says <b>not set</b> until every run has its values. The checks say exactly which values are missing. Enter your supplier's or fabricator's numbers when you have them.</p>
          <ul>
            <li>A <b>run</b> is a line of rack units against one wall. Add one, or press <b>Fill</b> on a wall to fit as many whole units as the wall allows, leaving the door opening free.</li>
            <li>Bottles = rows × bottles per row × units. The rows come from the number you give, or from unit height divided by row pitch.</li>
            <li>The <b>minimum walkway</b> is yours to set. Blank means it is not checked. A narrow walkway is only ever a warning, because a step-in cabinet and a walk-in room are designed to different minimums.</li>
          </ul>

          <h3>Checks and advice</h3>
          <p>The right-hand panel lists <b>errors</b> (something does not fit), <b>warnings</b> and <b>information</b>, each with a plain reason and a way to fix it. Runs with an error turn red on the plan.</p>
          <p><b>Advisory guidance</b> (insulation, glass, doors, heat sources) comes from a cellar-building guide. It is information only, it never blocks a design, and it always says it needs <b>mechanical engineer or HVAC sign-off</b>. Nothing here sizes cooling or insulation.</p>

          <h3>Saving</h3>
          <p>Use <b>Save file</b> to download the design as a <code>.cellar.json</code> file and <b>Open file</b> to load one, so you can send it to someone to look at. A draft is also kept in this browser. Saving to your Vault account is not built yet.</p>

          <h3>What is not here yet</h3>
          <p>Dragging racks on the plan, free-standing runs, the printable drawing package (plan, sections, elevations, isometric and renders), pricing and the quote request, a 3D view, and the carcass-joinery product. Rack capacity waits for real supplier values.</p>
        </div>
        <div className="modal-foot"><span className="grow" /><button type="button" ref={gotIt} className="btn primary" title="Close this guide. The (i) button opens it again." onClick={close} data-testid="info-got-it">Got it</button></div>
      </div>
    </div>
  );
}
