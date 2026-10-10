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
          <p>A planner for a free-standing <b>glass walk-in wine enclosure</b>: the walls, the door, the ceiling header with its conditioner and vents, and the racks inside. It draws the plan, the wall elevations and a 3D view, counts bottles, checks the design, gives a guide price and an indicative cooling figure, and makes a quote. Every size is in whole millimetres.</p>
          <p><b>This is a design aid, not a drawing for building from.</b> Every drawing says <i>preliminary design only: final site measure required prior to fabrication</i>, and the sizes that came from sample drawings are marked as unverified.</p>

          <h3>How the numbers are worked out</h3>
          <p>Press the calculator button next to this (i) button for the formulas and the working behind every figure (inside size, the door split, bottles, depth, the checks and the price), using the design you have open. <b>Copy as text</b> there puts it in a ticket or an email.</p>

          <h3>Getting started</h3>
          <ul>
            <li>The first time you open it, you see the <b>Test case</b>: the sample enclosure (read from the Carter Noir drawings, 2850 × 1665 × 2200 mm) with racks on every wall. Change any number on the left and both drawings follow.</li>
            <li><b>Blank sample</b> loads the same enclosure with the racks left blank, so every rack value says <b>not set</b>. In that banner, <b>Fill the blanks with best guesses</b> fills only the empty rack fields (it keeps anything you typed) and <b>Undo</b> takes them back.</li>
            <li>The <b>Test case</b> button loads it again with racks on every wall, filled with <b>best-guess rack values</b> so there are bottles to count (1,120 to begin with). Each guess is marked <b>estimated</b> until you type your own number over it. They are invented, not a supplier's: do not quote from them.</li>
            <li>Sizes are to the <b>outer faces</b> of the walls. The <b>build-up</b> of each wall (a 50 mm panel, a 100 mm stud wall, a glass frame) is taken off to give the <b>inside size</b>, shown at the top right.</li>
            <li>Every change can be undone with <b>Undo</b>.</li>
          </ul>

          <h3>The four views</h3>
          <ul>
            <li><b>Plan</b> is the enclosure from above: the walls in their build-up, the door opening with the open leaf and the arc it sweeps, the racks, and the dimensions. A door that opens in also shows the floor that must stay clear.</li>
            <li><b>Elevation</b> shows one wall as you see it from <b>outside</b>: the door, the header with the conditioner and vents, and the sizes. Pick the wall with the buttons beside the tabs.</li>
            <li><b>Racks</b> shows the <b>inside face of one wall</b>, as you would see it standing in the enclosure, with <b>every bottle drawn at its true size and spacing</b>: end-on circles for neck-out racks (the bottle lies front to back), side-on shapes for label-forward. You see the rows, the columns and the count. Racks the tool says cannot be built are red and say "not counted". Pick the wall with the buttons beside the tabs.</li>
            <li><b>3D</b> shows the <b>inside of the cellar from the door</b>, with the racks and every bottle, the inside measurements, and a choice of <b>Oak, Walnut or Black</b> racks (colour only: it never changes a count; the choice is kept with the design). Drag to look left or right and use the zoom buttons. Racks against the door wall are seen from behind, so their bottles are not drawn. This is the picture that goes into the drawing package and the quote.</li>
            <li>Scroll to zoom, drag to move, <b>Fit</b> to bring it all back. The <b>hinge</b> side is always as seen from outside, facing the door. A <b>double door</b> has two equal leaves, each hinged at an outer edge, and the width you enter is the whole opening.</li>
          </ul>

          <h3>Racks, and what “not set” means</h3>
          <p>There is no supplier sheet yet, so the <b>rack specification starts blank</b>: unit width, depth and height, row pitch, bottles per row, bottle orientation and posts. A blank is shown as <b>not set</b>, never as zero, and the bottle total says <b>not set</b> until every run has its values. The checks say exactly which values are missing. Enter your supplier's or fabricator's numbers when you have them.</p>
          <ul>
            <li><b>Drag a run on the plan</b> to slide it along its wall. It snaps to the ends of the wall, the door opening and other runs, shows how far it stands from each end, and only lands where it adds no error (otherwise it springs back and says why). One drag is one Undo. Hover a run to see what it is.</li>
            <li>Each error in the Checks panel that can be fixed automatically has a <b>fix button</b> (it moves or shortens a run, or corrects the door); <b>Fix all</b> does them together, and one Undo takes them back.</li>
            <li>The strip above the drawing always shows bottles, units, price and errors. <b>Hide controls</b>, <b>Hide checks</b> and <b>Focus</b> give the drawing more room, and the controls panel can be dragged wider or narrower; the choice is remembered.</li>
            <li>A <b>run</b> is a line of rack units against one wall. Add one, or press <b>Fill</b> on a wall to fit as many whole units as the wall allows, leaving the door opening free.</li>
            <li>Bottles = rows × bottles per row × units. The rows come from the number you give, or from unit height divided by row pitch.</li>
            <li><b>Bottles per row</b> is <b>calculated</b> if you leave it blank: the unit width divided by the bottle's pitch (a 600 mm unit holds 7 Bordeaux, 6 Burgundy, 5 Champagne, 4 Magnum). So changing the <b>Bottle</b> changes the count. It is an estimate; type your fabricator's real number to override it.</li>
            <li><b>Label-forward</b> racks have their own bottles-per-row, never calculated and <b>not set</b> until you enter it, because on a metal rack the bottle may lie side-on and take far more width than a neck-out one.</li>
            <li>The total <b>only counts runs that can be built</b>. A run with an error (too tall, too shallow for the bottle, off the end of the wall) is left out, and the panel says how many bottles that is, so the number you see is never one the tool itself says cannot be built.</li>
            <li>The <b>minimum walkway</b> is yours to set. Blank means it is not checked. A narrow walkway is only ever a warning, because a step-in cabinet and a walk-in room are designed to different minimums.</li>
          </ul>

          <h3>Rack types and price</h3>
          <ul>
            <li>Your owner keeps a <b>catalogue of rack types</b> in Vault (Settings, Cellar Planner): sizes, bottle counts, price per unit, and whether the supplier has <b>confirmed</b> the numbers. Under <b>Rack specification</b>, <b>Rack type</b> copies a type's numbers into the design and tells you exactly which values changed. A new design starts with the default type.</li>
            <li>A <b>confirmed</b> type is trusted. An <b>unconfirmed</b> type fills the values but marks every one <b>estimated</b>, and the drawing package says so. If you edit the values afterwards, a note offers <b>Use the catalogue's values again</b>.</li>
            <li>The <b>Price</b> panel is the full breakdown: a fixed amount, the racks (units × the type's price per unit) and the door, then the range a customer would see. It is <b>a guide only</b>: a blank amount is left out (never counted as zero) and the panel says so. A site measure and the finishes decide the real price.</li>
          </ul>

          <h3>Cooling</h3>
          <ul>
            <li>The <b>Cooling</b> panel estimates how much cooling the cellar needs: the heat that leaks in through every wall, the door, the ceiling and the floor (U-value × area × temperature difference), plus lights, people and stock, plus a safety margin. A bigger cellar needs more and thicker insulation needs less.</li>
            <li>Set the <b>outside design temperature</b> and the <b>target temperature</b> for this design (the Settings values are used until you change them). Enter each conditioner's <b>cooling capacity</b> in the Header section and the panel says whether the header covers the load or is short. A conditioner with no capacity is <b>not rated</b>, never counted as zero.</li>
            <li>The assumptions (insulation, glass, floor, margin) are your owner's, in Settings. <b>This is a guide for choosing a conditioner, never a design: it always needs mechanical engineer or HVAC sign-off.</b> A wall or ceiling with no thickness entered shows <b>not set</b> rather than a guess.</li>
          </ul>

          <h3>Checks and advice</h3>
          <p>The right-hand panel lists <b>errors</b> (something does not fit), <b>warnings</b> and <b>information</b>, each with a plain reason and a way to fix it. Runs with an error turn red on the plan.</p>
          <p><b>Advisory guidance</b> (insulation, glass, doors, heat sources) comes from a cellar-building guide. It is information only, it never blocks a design, and it always says it needs <b>mechanical engineer or HVAC sign-off</b>. The <b>Cooling</b> panel gives a separate indicative figure, which is also only a guide.</p>

          <h3>Drawing package</h3>
          <p>The <b>Drawing package</b> button makes a PDF of A3 sheets in the style of the Carter Noir drawings: a specification and schedule, the plan, the elevation of the door wall, and one sheet for each wall that has racks, with every bottle drawn at its true size, and, once racks are placed, a <b>3D view</b> sheet. Fill in the title block (client, address, project number, who drew and checked it) and press <b>Download PDF</b>. Every sheet says <i>preliminary design only: final site measure required prior to fabrication</i>, and a line at the foot says whether the rack values are estimated, calculated or not set, so a test case can never be mistaken for a quote. Still to come: sections, isometric views, renders, a logo, and sheets for the other walls' elevations.</p>

          <h3>Enquiries and quotes</h3>
          <ul>
            <li><b>Enquiries</b> lists people who sent your website's contact form with a design from the public planner (a number shows how many are new). <b>Open</b> adds their design as a new design, with your default rack type, named for them. Following the link in their CRM deal does the same.</li>
            <li><b>Quote</b> makes an A4 PDF for the customer: your business details, the price breakdown and total, the 3D picture, your terms and the dates. Enter your business name, terms and validity in Settings, Cellar Planner first.</li>
            <li>A quote is <b>refused until the numbers can be trusted</b>, and the window lists what to fix: the rack type must be <b>confirmed by the supplier</b>, the values must still match it, nothing may be estimated, racks must be placed with no errors, and there must be a price. When the design came from an enquiry, making the quote is logged on their deal in the CRM.</li>
          </ul>

          <h3>Saving</h3>
          <p>Use <b>Download file</b> to download a copy of the design as a <code>.cellar.json</code> file and <b>Upload file</b> to load one, so you can send it to someone to look at. A draft is also kept in this browser. Designs save by themselves: to your Vault account when you open the planner from Vault while signed in, otherwise in this browser. <b>Your designs</b> lists them so you can open, copy or delete one.</p>

          <h3>What is not here yet</h3>
          <p>Mixed rack types in one design, free-standing runs (a centre island), rooms that are not rectangular, drawing-package sections and renders, prices for glass, the cooling unit, lighting and installation, a parts list, and the carcass-joinery product. Rack capacity waits for real supplier values, and the cooling assumptions are typical values until your suppliers confirm them.</p>
        </div>
        <div className="modal-foot"><span className="grow" /><button type="button" ref={gotIt} className="btn primary" title="Close this guide. The (i) button opens it again." onClick={close} data-testid="info-got-it">Got it</button></div>
      </div>
    </div>
  );
}
