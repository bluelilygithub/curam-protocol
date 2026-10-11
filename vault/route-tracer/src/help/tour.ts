// Guided tour (Shepherd.js: the same library and look as Vault's other tours and the other planners). Started by the Tour button or by
// Vault's Settings page (?tour=1). Completing or skipping sets the localStorage key the other Vault tours use, so Settings can show
// "Retake Tour".
import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import '@planner-core/help/tour.css';
import { injectStepCounter } from '@planner-core/help/tourCard';
import { fromLines } from '../drawing';
import { useStore } from '../store';

export const TOUR_KEY = 'vault_tour_route_tracer_completed';
export const INFO_KEY = 'route-tracer:info-seen:v1';

export interface TourStep {
  id: string; title: string; text: string;
  /** `data-tour` value of the element to point at; omitted = centred card. */
  target?: string;
  on?: 'top' | 'bottom' | 'left' | 'right';
  /** The step points at the drawing tools, so they are opened for it (and closed again afterwards if the tour opened them). */
  needsDrawing?: boolean;
  /** The step points at the Tracks panel. */
  needsTracks?: boolean;
}

/** The tour as data (pure, tested). */
export const TOUR_STEPS: TourStep[] = [
  { id: 'rt-welcome', title: 'Route Tracer: Quick Tour', text: 'Trace a path on a map with a mouse or your finger, see its distance as you draw, check how much it climbs, and save it as a named track to come back to. This tour takes about two minutes.' },
  { id: 'rt-search', title: 'Find a place', target: 'rt-search', on: 'bottom', text: 'Type a suburb, an address or a landmark and press Go; the map flies to the one you pick. The ◎ button next to it centres the map on where you are (your browser asks permission the first time).' },
  { id: 'rt-view', title: 'Map style, units and markers', target: 'rt-view', on: 'bottom', text: 'Streets shows roads, Outdoor shows trails and contours, Satellite shows the aerial photo. Units switches between kilometres and miles. Markers turns the numbered distance dots on the line on and off. All of these are remembered on this device.' },
  { id: 'rt-draw', title: 'Start a route', target: 'rt-draw', on: 'bottom', text: 'Draw opens the drawing tools. Trace a route, change your mind as often as you like, then press Finish to save it.' },
  { id: 'rt-plan', title: 'Plan a route', target: 'rt-plan', on: 'bottom', text: 'Plan route finds a route between two points along real roads and paths. Tap a start (A) and an end (B), choose walking, hiking, cycling or driving, and you get up to three routes with their distance and time. Drag the A or B pin to change it, tap a route to choose it, then Use this route to open it for editing, elevation and saving.' },
  { id: 'rt-modes', title: 'Three ways to draw', target: 'rt-modes', on: 'top', needsDrawing: true, text: 'Freehand: press and drag and the line follows you (two fingers, or Space + drag, move the map instead). Click: each click adds a point joined by a straight line, good for following roads exactly; double-click to finish. Edit points: drag a point to move it, drag a small dot to add a point, tap a point to delete it. The big number is the distance so far.' },
  { id: 'rt-shape', title: 'Loops, out-and-back and elevation', target: 'rt-shape', on: 'top', needsDrawing: true, text: 'Return to start adds a straight line back to where you began. Out and back retraces the route in reverse, doubling the distance. Elevation shows the height profile along the route with the total climb and descent; move across the chart to see that spot on the map.' },
  { id: 'rt-actions', title: 'Undo, clear, finish', target: 'rt-actions', on: 'top', needsDrawing: true, text: 'Undo takes back one step at a time (a stroke, a point, a move, a loop). Clear removes everything after asking. Finish names and saves the route, with notes and a colour. Cancel stops without saving. Unsaved work is also kept on this device and offered back if the page closes by accident.' },
  { id: 'rt-tracks', title: 'Your tracks', target: 'rt-panel', on: 'left', needsTracks: true, text: 'Every saved track, newest first. Search by name, tick several to delete them together, or turn on Show all to see them on the map at once. Click one to open it: you get its distance, climb and notes, and can rename it, edit its points, extend it, or export it as a GPX file.' },
  { id: 'rt-import', title: 'Bring a route in', target: 'rt-import', on: 'bottom', text: 'Import GPX opens a file from Strava, Garmin or a friend. It appears in Edit points mode with its distance, ready to check, fix and save. Very long recordings are simplified to fit.' },
  { id: 'rt-tap', title: 'Tap a track to measure', text: 'With a track open, tap or click its line: a pin lands there with how far it is from the start and how far is left. Tap away or press Escape to clear it. Markers on the line count every 1 km (or 1 mi).' },
  { id: 'rt-done', title: 'You’re set', text: 'Hover any button or box for a short explanation. The ⓘ button explains how everything works, and the Tour button retakes this tour.' },
];

const selectorOf = (target: string): string => `[data-tour="${target}"]`;
const wait = (ms: number): Promise<void> => new Promise((r) => { window.setTimeout(r, ms); });

export function startTour(): InstanceType<typeof Shepherd.Tour> {
  if (Shepherd.activeTour) Shepherd.activeTour.cancel();
  const store = useStore;
  const before = { drawing: store.getState().drawing, panel: store.getState().panel };
  let openedDrawing = false;
  const closeDrawing = (): void => {
    if (openedDrawing) { store.getState().stopDrawing(); openedDrawing = false; }
  };
  const tour = new Shepherd.Tour({
    useModalOverlay: true, exitOnEsc: true, keyboardNavigation: true,
    defaultStepOptions: { scrollTo: { behavior: 'smooth', block: 'center' }, cancelIcon: { enabled: true }, classes: 'vault-tour' },
  });
  const finish = (): void => {
    try { window.localStorage.setItem(TOUR_KEY, '1'); } catch { /* it will simply show again */ }
    closeDrawing();
    if (!before.drawing) store.getState().setPanel(before.panel);
  };
  tour.on('complete', finish);
  tour.on('cancel', finish);
  const secondary = (text: string, action: () => void) => ({ text, action, classes: 'vault-tour-btn-secondary' });

  TOUR_STEPS.forEach((s, i) => {
    const first = i === 0;
    const last = i === TOUR_STEPS.length - 1;
    tour.addStep({
      id: s.id, title: s.title, text: s.text,
      ...(s.target ? { attachTo: { element: selectorOf(s.target), on: s.on ?? 'bottom' } } : {}),
      beforeShowPromise: async () => {
        const st = store.getState();
        if (s.needsDrawing && !st.drawing) {
          // the tools only exist while drawing: open them with a small sample route so every button is live, and close them afterwards
          st.startDrawing(fromLines([[[153.02, -27.47], [153.03, -27.46], [153.045, -27.465]]]));
          openedDrawing = true;
        }
        if (!s.needsDrawing) closeDrawing();
        if (s.needsTracks && !store.getState().drawing) store.getState().setPanel('tracks');
        if (!s.needsTracks && !s.needsDrawing && !before.drawing && store.getState().panel === 'tracks' && before.panel !== 'tracks') store.getState().setPanel('closed');
        await wait(s.needsDrawing || s.needsTracks ? 450 : 50);
        // a step whose element is not on screen is shown as a centred card instead
        if (s.target && !document.querySelector(selectorOf(s.target))) { const step = tour.getById(s.id); if (step) step.options.attachTo = undefined; }
      },
      when: { show() { injectStepCounter(i + 1, TOUR_STEPS.length); } },
      buttons: first
        ? [secondary('Skip Tour', () => tour.cancel()), { text: 'Start Tour →', action: () => tour.next() }]
        : last
          ? [secondary('← Back', () => tour.back()), { text: 'Finish', action: () => tour.complete() }]
          : [secondary('← Back', () => tour.back()), { text: 'Next →', action: () => tour.next() }],
    });
  });
  tour.start();
  return tour;
}
