import { useEffect, useRef } from 'react';
import { INFO_KEY } from './help/tour';
import { useStore } from './store';

/** "How this works": the plain-language guide. Opens on the first visit and from the ⓘ button. */
export function InfoModal() {
  const open = useStore((s) => s.infoOpen);
  const setInfoOpen = useStore((s) => s.setInfoOpen);
  const gotIt = useRef<HTMLButtonElement>(null);

  const close = (): void => {
    try { localStorage.setItem(INFO_KEY, '1'); } catch { /* it simply opens again next visit */ }
    setInfoOpen(false);
  };
  // focus goes into the guide when it opens, Esc closes it, and focus goes back to where it was
  useEffect(() => {
    if (!open) return undefined;
    const before = document.activeElement;
    gotIt.current?.focus();
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); if (before instanceof HTMLElement) before.focus(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open) return null;
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="How Route Tracer works" data-testid="info-modal" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal help">
        <div className="modal-head">
          <h2>How Route Tracer works</h2>
          <button type="button" onClick={close} aria-label="Close" title="Close this guide">✕</button>
        </div>
        <div className="modal-body" tabIndex={0} role="region" aria-label="Guide text">
          <h3>What it is</h3>
          <p>Trace a path on a map with a mouse or your finger and see its distance as you draw. Save it as a named track and come back to it later: reshape it, extend it, check how much it climbs, measure any spot along it, or export it as a GPX file. Your tracks belong to your Vault account, so they are there on any device you sign in on.</p>

          <h3>Drawing a route</h3>
          <ul>
            <li>Press <b>Draw</b>. The big number is the distance so far.</li>
            <li><b>Freehand</b>: press and drag, and the line follows you. Lift your finger to end a stroke. Start again near the end of the last stroke and it carries on as one line. <b>On a phone or tablet</b>, one finger draws and two fingers move and zoom the map. <b>On a computer</b>, the scroll wheel zooms, and holding <b>Space</b> while you drag moves the map.</li>
            <li><b>Click</b>: each click or tap adds a point joined to the last by a straight line, best for following a road exactly. Double-click (or press Finish) to end.</li>
            <li><b>Follow roads</b> (a switch in Click mode): turn it on and each click finds the road or path from the last click, instead of a straight line, for walking, hiking, cycling or driving. Drag a point and the roads beside it are found again; in <b>Edit points</b>, drag a dot to add a point, or delete one, and only the points you clicked are shown, not every point of the road. <b>Undo</b> takes back a click and its road together. Where no road can be found near a click, that section stays a straight line, you are told, and <b>Try again</b> asks once more. It starts from the first click (turn it on before drawing, or after Clear), and <b>Finish</b> waits until the roads are found. Return to start follows roads back, and Out and back retraces the same roads. Roads come from OpenStreetMap, so a path that is missing from it cannot be followed.</li>
            <li><b>Edit points</b>: drag any point to move it, drag a small dot (the middle of a segment) to add a point there, or tap a point and press <b>Delete selected point</b>. This works on a route you are drawing and on one you saved.</li>
            <li><b>Undo</b> takes back exactly one step: a stroke, a point, a move, a loop. <b>Clear</b> removes everything, after asking.</li>
            <li>Your drawing is also kept on this device every two seconds. If the page closes by accident, you are offered it back next time.</li>
          </ul>

          <h3>Plan a route (directions)</h3>
          <ul>
            <li>Press <b>Plan route</b> in the sidebar. Set the <b>start (A)</b> and the <b>end (B)</b> by tapping the map, or by typing a place in the field: suggestions appear as you type (from three letters, after a short pause), and you pick one with a click or tap, or with the arrow keys and <b>Enter</b>. Pressing Enter with nothing highlighted searches straight away. The field fills in the place name when you tap the map. The suggestions come from MapTiler, so what you type in these two fields is sent to MapTiler as you type; the search box at the top, and a tap on the map, are not. Choose how you are travelling: <b>walking, hiking, cycling or driving</b>. The app finds up to three routes between them along real roads and paths, each with its distance and estimated time. The shortest is listed first.</li>
            <li>Choose a route in the list, or tap its line on the map. Drag the A or B pin to move it and the routes are found again. The arrows between the fields swap A and B; <b>Reset</b> clears both points.</li>
            <li><b>Use selected route</b> opens the chosen route in the drawing tools in <b>Edit points</b> mode. From there you can drag points to adjust it, see its elevation, add a return leg, and press <b>Finish</b> to save it as a track like any other.</li>
            <li>Routes come from OpenRouteService using OpenStreetMap data, so they are only as good as the map: a path that is missing from OpenStreetMap cannot be used. If a point is not near a road or footpath you are told which one to move. The free service has daily limits, so the same request is remembered for an hour and each person has a fair share per minute and per day.</li>
            <li><b>Loops:</b> switch from <b>A to B</b> to <b>Loop</b>, tap one start point, and type a length (1 to 50 km, or the same in miles). You get up to three circular routes that start and end at that point, each showing how far it is from the length you asked for, for example <i>(+4%)</i>. The planner treats the length as a target and can miss it, so the app asks again for any loop that is far off. In a built-up cul-de-sac or somewhere with few paths, a loop may come out longer or shorter than you wanted. <b>Different loops</b> asks for loops that head off in other directions.</li>
            <li><b>Longer route:</b> the same two places, but a longer way between them (a longer walk, ride or drive that still ends at B). Set A and B and the sidebar shows how long the direct route is. Then type how long you want the whole trip to be, which must be longer than that, and you get up to three routes that bend off to one side or the other to reach about that length, each showing how far it is from what you asked for. No routing service does this in one step, so the app moves a point out to the side of your line and checks the result, a few times. If the area has few paths on that side it may fall short, and it tells you if you ask for less than the direct route (it is already longer) or more than four times as long. <b>Different routes</b> tries other shapes.</li>
            <li>If <b>Plan route</b> is greyed out, route planning has not been set up on this server yet.</li>
          </ul>

          <h3>Loops and out-and-back</h3>
          <ul>
            <li><b>Return to start</b> adds a straight line from the end of the route back to its first point. It is a straight line, not a road route, so on a road route follow the roads back yourself instead.</li>
            <li><b>Out and back</b> retraces the route in reverse so you finish where you started. The distance doubles. Both can be undone.</li>
          </ul>

          <h3>Elevation and climb</h3>
          <ul>
            <li>Press <b>Elevation</b> while drawing, or open a saved track, to see a height profile along the route with the total <b>climb</b> (metres up) and <b>descent</b> (metres down), and the lowest and highest points.</li>
            <li>Move your mouse (or drag a finger) across the chart: a pin shows that spot on the map with its height and how far along it is.</li>
            <li>Heights come from MapTiler's terrain tiles, a model of the ground about a few metres accurate. A bridge or tunnel reads as the ground beneath it, and climb is an estimate. To keep tiny bumps in the data from inflating it, only rises and falls of more than 3 m are counted. Heights show in feet when the units are miles.</li>
            <li>Elevation needs a connection to MapTiler and is read each time you look; nothing about it is saved with the track.</li>
          </ul>

          <h3>Saving and your tracks</h3>
          <ul>
            <li><b>Finish</b> asks for a name, optional notes and a colour. <b>Escape</b> goes back to drawing without losing anything.</li>
            <li>The sidebar lists everything you saved under <b>Your tracks</b>, newest first. Search by name. Tick tracks and press <b>Delete</b> to remove several at once (it asks first). <b>Show all on map</b> draws them all.</li>
            <li>Open a track to <b>rename or recolour</b> it, <b>edit its points</b>, <b>extend</b> it (carry on drawing from its end), <b>export GPX</b> or <b>delete</b> it.</li>
          </ul>

          <h3>Measuring along a track</h3>
          <ul>
            <li><b>Distance markers</b> are numbered dots every 1 km (every 1 mi in miles). Zoomed out they thin to every 5th, 10th and so on so they never pile up. Turn them off in the gear menu.</li>
            <li>With a track open, <b>tap or click its line</b>: a pin lands on it with how far that is from the start and how far is left. Tap away, or press Escape, to clear it. This does not work while drawing or editing, because a tap already means something there.</li>
          </ul>

          <h3>GPX files</h3>
          <ul>
            <li><b>Import GPX</b> (in the gear menu) opens a file from Strava, Garmin or a friend. It appears in Edit points mode with its distance, ready to check and press Finish to save. Waypoints, times and heart rate are ignored; only the path is kept. A recording with more points than a track can hold (20,000) is simplified, and you are told by how much.</li>
            <li><b>Export GPX</b> on a saved track downloads a standard file that Strava, Garmin and gpx.studio open.</li>
          </ul>

          <h3>Map as PDF: download or email</h3>
          <ul>
            <li>Open a saved track and press <b>Map as PDF</b>. After a few seconds you have one A4 page: the route on a map of the area it covers, the start (A) and finish (B), distance markers, a scale bar and north arrow, the distance, climb and descent, your notes, and the elevation profile. It uses the map style you are looking at (Streets, Outdoor or Satellite).</li>
            <li><b>Download PDF</b> saves it to your device to print. <b>Email PDF</b> sends the same file as an attachment to one address, with an optional message, and can send you a copy. The email comes from Vault with your address as the reply-to.</li>
            <li>If the server cannot send email yet, the form says so and Download still works. Emails are limited to 10 an hour and 30 a day each, so this cannot be used to send bulk mail.</li>
          </ul>

          <h3>Map controls</h3>
          <ul>
            <li>The box at the top finds a place or address, and also understands a request in plain words: <i>give me a route from Morningside to Carindale</i>, <i>a 10 km cycling loop from Bulimba</i>, <i>walk from Toowong to the city, about 8 km</i>. It works out the two places, the kind of route, the length and how you are travelling, finds the places nearest to where the map is looking, and sets up <b>Plan route</b> for you with A and B filled in, so you can check the places, change anything and pick one of the routes. If a place is the wrong one, change it in the A or B box. Clear requests are understood on the spot; unusual wording is sent to Vault&apos;s AI model (only the sentence you typed, nothing else), and there is a limit of 20 of those an hour. If it was not a route request, it simply searches for the place.</li>
            <li>Every text box has a <b>microphone</b>: press it, speak, and the words appear (it listens in Australian English; allow the microphone if the browser asks). In the top box a spoken request is carried out as soon as you stop talking. In A and B it searches for the place you said. For a length, say the number. For an email address say it like <i>michael at example dot com</i>. In notes and messages what you say is added to the end. Browsers without speech recognition show the button greyed out; typing always works.</li>
            <li>The buttons down the right edge of the map zoom, centre the map on you, turn north to the top, and switch the map style.</li>
            <li>In the <b>layers</b> button: <b>Streets</b> shows roads and addresses, <b>Outdoor</b> shows trails and contours, <b>Satellite</b> shows the aerial photo.</li>
            <li>The <b>gear</b> menu holds <b>Units</b> (kilometres or miles, used everywhere), distance markers, Import GPX and the tour. Style, units, markers and your last map position are remembered on this device.</li>
          </ul>

          <h3>Good to know</h3>
          <ul>
            <li>Distance is measured along the line you draw, as a great-circle distance, so it is only as good as the line. A freehand line cuts corners; click along the road for more accuracy.</li>
            <li>What you draw is not snapped to roads. To follow roads, use <b>Plan route</b>, or click along the road in <b>Click</b> mode. There is no GPS recording or sharing in this version.</li>
            <li>Hover any button or box for a short explanation. <b>Take the tour</b> in the gear menu walks through the screen in about two minutes.</li>
          </ul>
        </div>
        <div className="row"><button ref={gotIt} type="button" className="primary" onClick={close} title="Close the guide. You can open it again with the ⓘ button.">Got it</button></div>
      </div>
    </div>
  );
}
