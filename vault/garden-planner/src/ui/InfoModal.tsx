import { useApp, useUi } from './AppContext';
import { Icon } from './icons';

/** "How this works": the plain-language guide. Opens on the first visit and from the (i) button. */
export function InfoModal() {
  const app = useApp();
  const open = useUi((s) => s.infoOpen);
  if (!open) return null;
  const close = (): void => {
    try { localStorage.setItem('garden-planner:info-seen:v1', '1'); } catch { /* fine */ }
    app.ui.getState().set({ infoOpen: false });
  };
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="How this works" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal wide help">
        <div className="modal-head"><h2>How Garden Planner works</h2><button type="button" className="icon-btn" title="Close" onClick={close}><Icon name="close" size={16} /></button></div>
        <div className="modal-body">
          <h3>Getting started</h3>
          <p>Make a new garden and tell it where you are. That sets the climate, the frost level and which way the sun goes. Then draw your plot, the house, beds, lawn and paths, and add plants from the library on the left. Everything is to scale, in metres.</p>
          <h3>Drawing</h3>
          <ul>
            <li>Pick a tool at the top, then click the corners of the shape. Click the first dot, double-click or press <b>Enter</b> to finish. Dragging out a rectangle is quicker for plots and houses.</li>
            <li>Beds and lawns can have curved edges. Turn <b>Curves</b> off for straight ones.</li>
            <li>Shapes snap to corners and edges of the plot, house, beds and paths, then to the grid. Hold <b>Shift</b> to place freely.</li>
            <li>Select anything to move it or drag its corner dots. Use the panel on the right for exact sizes. Every change can be undone with <b>Ctrl+Z</b>.</li>
            <li>Got a site plan or aerial photo? Start a garden with <b>Trace a picture</b>, then use the Scale tool to mark a known length so it is true to size.</li>
          </ul>
          <h3>Plants, growth and seasons</h3>
          <p>A plant's size comes from the plant itself, never from dragging handles. Use the <b>Growth</b> buttons at the bottom to see the garden when it is just planted, at 1, 3 and 5 years, and fully grown. Use the <b>Month</b> slider to see flowers, bare winter trees and autumn colour. This is the southern hemisphere: summer is December to February.</p>
          <p>The library hides plants that will not suit your climate or frost level, and weeds in your state, while <b>Suits my garden</b> is on. Turn it off to browse everything. To plant, click <b>Add to plan</b> then click the plan, or drag a plant from the library and release it where you want it. It is then selected: drag to move it, press <b>Duplicate</b> (Ctrl+D) for another, or <b>Delete</b>. Hold <b>Shift</b> while clicking to keep planting. Select a bed and press <b>Fill bed</b> to plant it at the recommended spacing.</p>
          <h3>North and the sun</h3>
          <p>In Australia the sun is in the north, so a north-facing bed is the sunny one. Drag the north arrow on the plan to match your plot. Sun and shade maps are coming next.</p>
          <h3>Voice</h3>
          <p>Every text and number box has a microphone button. Tap it and say a name or a number, like “two point five”. It works in Chrome, Edge and Safari.</p>
          <h3>Satellite map</h3>
          <p>In Garden settings, switch on <b>Show a satellite map</b> to see an aerial photo of your street under the plan. Press <b>Move map</b> and drag it until your house sits where you drew it, then draw over it. The map is true to scale and turns with the north arrow, and the sun shadows fall across it.</p>
          <h3>Plant data and photos</h3>
          <p>The starter plant list is a draft. Please check sizes, frost and weed information against a local nursery or your state weed list before relying on it. Plant photos come from iNaturalist, Wikimedia Commons and the Atlas of Living Australia, only under open licences, with the creator and licence shown under each photo. <button type="button" className="linklike" onClick={() => app.ui.getState().set({ infoOpen: false, creditsOpen: true })}>See all photo credits</button>.</p>
          <h3>Place lookup</h3>
          <p>Looking up a suburb or postcode uses OpenStreetMap data, © OpenStreetMap contributors. It searches only when you press Look up, never as you type.</p>
          <h3>Saving</h3>
          <p>Gardens save automatically to your Vault account (or in this browser if you are signed out or offline; the bar at the bottom says which). Use <b>Your gardens</b> to switch between them, or to export a file you can keep or move to another device.</p>
        </div>
        <div className="modal-foot"><span className="grow" /><button type="button" className="btn primary" onClick={close}>Got it</button></div>
      </div>
    </div>
  );
}
