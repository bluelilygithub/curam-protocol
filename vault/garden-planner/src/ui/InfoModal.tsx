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
          <p>Make a new garden and enter its <b>street address</b>. Garden Planner finds it, says how exactly (an exact address, or only the street), and shows a close-up map. The address sets the state, the climate, the frost level and which way the sun goes, and it becomes the middle of your plan, so the satellite map starts right on your house. No address? Choose a suburb instead. Then draw your plot, the house, beds, lawn and paths, and add plants from the library on the left. Everything is to scale, in metres.</p>
          <p>Your address and climate are shown at the top of the plant library, because the library is filtered for them. Change the address later in the garden settings on the right: the map moves with it.</p>

          <h3>Drawing</h3>
          <ul>
            <li>Pick a tool at the top, then click the corners of the shape. Click the first dot, double-click or press <b>Enter</b> to finish. Dragging out a rectangle is quicker for plots and houses.</li>
            <li>Beds and lawns can have curved edges. Turn <b>Curves</b> off for straight ones.</li>
            <li>Shapes snap to corners and edges of the plot, house, beds and paths, then to the grid. Hold <b>Shift</b> to place freely.</li>
            <li>The <b>Service</b> tool draws sewer, water, stormwater, gas and power lines and easements, so the checks can keep trees and big roots away from them. Only what you draw is shown: call Dial Before You Dig before you dig.</li>
            <li>Select anything to move it or drag its corner dots. Use the panel on the right for exact sizes. Every change can be undone with <b>Ctrl+Z</b>.</li>
            <li>Got a site plan or aerial photo? Start a garden with <b>Trace a picture</b>, then use the Scale tool to mark a known length so it is true to size.</li>
          </ul>

          <h3>Plants, growth and seasons</h3>
          <p>A plant's size comes from the plant itself, never from dragging handles. Use the <b>Growth</b> buttons at the bottom to see the garden when it is just planted, at 1, 3 and 5 years, and fully grown. Use the <b>Month</b> slider to see flowers, bare winter trees and autumn colour. This is the southern hemisphere: summer is December to February.</p>
          <p>The library hides plants that will not suit your climate or frost level, and weeds in your state, while <b>Suits my garden</b> is on. Turn it off to browse everything; plants that do not suit are listed below with the reason, never hidden silently.</p>
          <p>To plant, click <b>Add to plan</b> then click the plan, or drag a plant from the library and release it where you want it. It is then selected, with a bar at the bottom of the plan: <b>Duplicate</b> (Ctrl+D) for another, <b>Row…</b> for several copies in a straight line, a set distance apart (it starts at the plant's grown width), or <b>Delete</b>. Hold <b>Shift</b> while clicking to keep planting. Select a bed and press <b>Fill bed</b> to plant it at the recommended spacing.</p>

          <h3>North, the sun and shade</h3>
          <p>In Australia the sun is in the north, so a north-facing bed is the sunny one. Drag the north arrow on the plan to match your plot. The <b>Time</b> slider moves the sun through the day for the month you chose, using the garden's own time zone (daylight saving is shown where it applies). Press <b>Shadows</b> to see the shadows of the house, fences, structures and plants, and <b>Sun map</b> to see how many hours of sun each part of the garden gets: full sun, part shade or shade, with the limits you can change. Neighbours' buildings and slopes are not modelled, so check the shade on the ground.</p>

          <h3>Checks</h3>
          <p>The warning button at the top (or the <b>Checks</b> tab) lists problems with a plain reason for each, and <b>Show</b> takes you to it: plants too close together at full size, over the boundary, too close to the house or to pipes, in the wrong amount of sun, not suited to the climate or frost, weeds, toxic to pets (when pets are on), paths too narrow, gates that cannot swing, and lawns the mower cannot reach. <b>Fix position</b> moves a plant to the nearest clear spot. Anything that uses plant data says it is a draft, and a weed status that was never checked says <b>unknown</b>, which is not the same as safe.</p>

          <h3>Plant tags</h3>
          <p>Got a tag from the nursery? Press the camera button above the plant list, photograph the tag and Garden Planner reads it on your device (the photo is not uploaded). It suggests the plants it could be and says why; you choose, and nothing is added for you. You can correct the words it read, or type the name instead.</p>

          <h3>Satellite map</h3>
          <p>In Garden settings, switch on <b>Show a satellite map</b> to see an aerial photo of your street under the plan. Press <b>Move map</b> and drag it until your house sits where you drew it, then draw over it. With a street address the map starts centred on it and switches on by itself, so you can draw the plot around your house on the aerial photo; if the pin is a little off, move the map until it fits. It is true to scale and turns with the north arrow, and the sun shadows fall across it, in 2D and in 3D. (The map needs a MapTiler key set up on the server.)</p>

          <h3>3D, walking and flying through</h3>
          <ul>
            <li>The <b>3D</b> button shows the same garden in 3D: drag to orbit, scroll to zoom, and use <b>Iso</b>, <b>Top</b> and <b>Front</b> for standard views. The Time and Month sliders move the real sun.</li>
            <li><b>Walk</b> puts you in the garden at eye height. W A S D or the pad walk, the arrow keys or dragging look around, Shift runs, Esc stops. The house, fences, structures and trunks are solid; gates let you through.</li>
            <li><b>Fly-through</b> makes the camera tour the garden by itself, sweeping over the house and trees instead of through them. Space pauses, Esc stops, and <b>Loop</b> goes round again.</li>
            <li><b>Views</b> saves where the camera is (or where you stand) so you can come back to it. Two or more saved views become the stops of the fly-through. They are kept with the garden.</li>
            <li><b>Render photo</b> makes a realistic picture with the sun where the sliders put it, from the camera as it is now (even from where you are walking). It starts grainy and sharpens; you can stop it and download what you have as a PNG. Plants are simple shapes, so judge the light and the layout rather than the leaves.</li>
          </ul>

          <h3>Schedule and printable plan</h3>
          <p>The <b>table button</b> at the top opens the plant schedule: every plant in the garden, one row per kind, with quantity, size, spacing, needs, flowering, cautions, weed status and where it is planted. <b>Download CSV</b> opens in Excel or Google Sheets. <b>Download plan (PDF)</b> makes a to-scale plan on A4 or A3, with every plant numbered to match the schedule, a key, a north arrow and a scale bar, followed by the schedule. Plants are drawn at mature size so you leave them room. Every printout says the plant data is a draft and to call Dial Before You Dig.</p>

          <h3>Voice</h3>
          <p>Every text and number box has a microphone button. Tap it and say a name or a number, like “two point five”. It works in Chrome, Edge and Safari.</p>

          <h3>Plant data and photos</h3>
          <p>The starter plant list is a draft. Please check sizes, frost and weed information against a local nursery or your state weed list before relying on it. Plant photos come from iNaturalist, Wikimedia Commons and the Atlas of Living Australia, only under open licences, with the creator and licence shown under each photo. <button type="button" className="linklike" onClick={() => app.ui.getState().set({ infoOpen: false, creditsOpen: true })}>See all photo credits</button>. (Vault admins also get a photo curator button, to hide wrong photos and choose the best ones.)</p>

          <h3>Place lookup</h3>
          <p>Looking up an address, suburb or postcode uses OpenStreetMap data, © OpenStreetMap contributors. It searches only when you press the button, never as you type. An address is sent to OpenStreetMap's lookup service for that search; Vault keeps it in memory for a few minutes at most and does not save it on the server or in any log. It is saved only in your garden, and it appears on your printed plan (not in picture captions or file names).</p>

          <h3>Saving</h3>
          <p>Gardens save automatically to your Vault account (or in this browser if you are signed out or offline; the bar at the bottom says which). Use <b>Your gardens</b> to switch between them, or to export a file you can keep or move to another device.</p>
        </div>
        <div className="modal-foot"><span className="grow" /><button type="button" className="btn primary" onClick={close}>Got it</button></div>
      </div>
    </div>
  );
}
