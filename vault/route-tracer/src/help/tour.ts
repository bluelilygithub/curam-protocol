// Guided tour (Shepherd.js: the same library and look as Vault's other tours and the other planners). Started by the Tour button or by
// Vault's Settings page (?tour=1). Completing or skipping sets the localStorage key the other Vault tours use, so Settings can show
// "Retake Tour".
import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import '@planner-core/help/tour.css';
import { injectStepCounter } from '@planner-core/help/tourCard';
import { fromLines } from '../drawing';
import { usePlan } from '../Plan';
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
}

/** The tour as data (pure, tested). */
export const TOUR_STEPS: TourStep[] = [
  { id: 'rt-welcome', title: 'Route Tracer: Quick Tour', text: 'Trace a path on a map with a mouse or your finger, plan a route along real roads, see its distance and climb, and save it as a named track to come back to. This tour takes about two minutes.' },
  { id: 'rt-search', title: 'Find a place, or ask for a route', target: 'rt-search', on: 'bottom', text: 'Type a suburb, an address or a landmark and press Enter; the map flies to the one you pick. Or ask in plain words, such as: route from Morningside to Carindale, or a 10 km loop from Bulimba. Plan route is set up for you to check. The microphone on this and every text box lets you speak instead of type.' },
  { id: 'rt-view', title: 'Map buttons', target: 'rt-view', on: 'left', text: 'Zoom in and out, centre the map on where you are (your browser asks permission the first time), turn north to the top, and choose the map style: Streets for roads, Outdoor for trails and contours, Satellite for the aerial photo.' },
  { id: 'rt-draw', title: 'Start a route', target: 'rt-draw', on: 'right', text: 'Draw opens the drawing tools in this sidebar. Trace a route, change your mind as often as you like, then press Finish to save it.' },
  { id: 'rt-plan', title: 'Plan a route', target: 'rt-plan', on: 'right', text: 'Plan route finds a route between two places along real roads and paths. Set A and B by tapping the map or typing a place (suggestions appear as you type), choose walking, hiking, cycling or driving, and you get up to three options with distance and time. Loop makes a circular route and Longer route a longer way between A and B, of about a length you choose. On A to B, Add a stop passes through up to eight places in order. Every route has turn-by-turn directions: open the list and tap a step to see it on the map. Pick one, then Use selected route to edit and save it; the directions are saved with it.' },
  { id: 'rt-modes', title: 'Three ways to draw', target: 'rt-modes', on: 'right', needsDrawing: true, text: 'Freehand: press and drag and the line follows you (two fingers, or Space + drag, move the map instead). Click: each click adds a point joined by a straight line; turn on Follow roads and each click finds the road or path from the last one instead; double-click to finish. Edit points: drag a point to move it, drag a small dot to add a point, tap a point to delete it. The big number is the distance so far.' },
  { id: 'rt-shape', title: 'Loops, out-and-back and elevation', target: 'rt-shape', on: 'right', needsDrawing: true, text: 'Return to start adds a straight line back to where you began. Out and back retraces the route in reverse, doubling the distance. Elevation shows the height profile along the route with the total climb and descent; move across the chart to see that spot on the map.' },
  { id: 'rt-actions', title: 'Finish, undo, clear', target: 'rt-actions', on: 'right', needsDrawing: true, text: 'Finish names and saves the route, with notes and a colour. Undo takes back one step at a time (a stroke, a point, a move, a loop). Clear removes everything after asking. Cancel stops without saving. Unsaved work is also kept on this device and offered back if the page closes by accident.' },
  { id: 'rt-tracks', title: 'Your tracks', target: 'rt-panel', on: 'right', text: 'Every saved track, newest first. Search by name, tick several to delete them together (they are kept 30 days in the recycle bin, with Undo), tick Favourites only to list just your starred tracks, or turn on Show all to see them on the map at once. Click one to open it: you get its distance, climb and notes, and can star it as a favourite, copy it, reverse it, rename it, edit its points, extend it, export it as GPX, TCX or KML, send it to a Zepp watch, or print its directions as a PDF.' },
  { id: 'rt-import', title: 'Settings, import and help', target: 'rt-menu', on: 'bottom', text: 'The gear holds units (kilometres or miles), the distance markers, Import GPX (open a file from Strava, Garmin or a friend, and it appears ready to check, fix and save) and this tour. The ? button explains how everything works.' },
  { id: 'rt-tap', title: 'Tap a track to measure', text: 'With a track open, tap or click its line: a pin lands there with how far it is from the start and how far is left. Tap away or press Escape to clear it. Markers on the line count every 1 km (or 1 mi).' },
  { id: 'rt-done', title: 'You’re set', text: 'Hover any button or box for a short explanation. The ? button explains how everything works, and the gear menu has this tour whenever you want it again.' },
];

const selectorOf = (target: string): string => `[data-tour="${target}"]`;
const wait = (ms: number): Promise<void> => new Promise((r) => { window.setTimeout(r, ms); });

export function startTour(): InstanceType<typeof Shepherd.Tour> {
  if (Shepherd.activeTour) Shepherd.activeTour.cancel();
  const store = useStore;
  const before = { drawing: store.getState().drawing };
  if (!before.drawing) { usePlan.getState().cancel(); store.getState().select(null); } // the buttons the tour points at are in the idle sidebar
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
        let changed = false;
        if (s.needsDrawing && !st.drawing) {
          // the tools only exist while drawing: open them with a small sample route so every button is live, and close them afterwards
          st.startDrawing(fromLines([[[153.02, -27.47], [153.03, -27.46], [153.045, -27.465]]]));
          openedDrawing = true;
          changed = true;
        }
        if (!s.needsDrawing && openedDrawing) { closeDrawing(); changed = true; }
        await wait(changed ? 450 : 50);
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
