// Guided tour (Shepherd.js: the same library and look as Vault's other tours and the other planners). Started by the compass button or by Vault's
// Settings page (?tour=1). Completing or skipping sets the localStorage key the other Vault tours use, so Settings can show "Retake Tour".
import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import '@planner-core/help/tour.css';
import { injectStepCounter } from '@planner-core/help/tourCard';
import type { UiStore } from '../app/uiStore';

export const TOUR_KEY = 'vault_tour_cellar_planner_completed';

export interface TourStep {
  id: string; title: string; text: string;
  /** `data-tour` value of the element to point at; omitted = centred card. */
  target?: string;
  on?: 'top' | 'bottom' | 'left' | 'right';
  /** Which drawing must be showing for the step. */
  tab?: 'plan' | 'elevation';
}

/** The tour as data (pure, tested against the screen's data-tour hooks). */
export const TOUR_STEPS: TourStep[] = [
  { id: 'cp-welcome', title: 'Cellar Planner: Quick Tour', text: 'Plan a free-standing glass walk-in wine enclosure: the walls, the door, the ceiling header with its conditioner and vents, and the racks inside. You get a plan and wall elevations, a bottle count, and a list of checks. Every size is in whole millimetres. It is a design aid: every drawing says final site measure is required before fabrication.' },
  { id: 'cp-project', title: 'Your design', target: 'cp-project', on: 'bottom', text: 'Name it, undo and redo any change, save it as a file (and open one someone sent you), or load the test case (racks filled with best-guess values, marked estimated) or the blank sample (racks left blank) to see how it works. The (i) explains everything in plain language and the compass button starts this tour again.' },
  { id: 'cp-enclosure', title: 'The enclosure', target: 'cp-enclosure', on: 'right', text: 'Sizes are to the outer faces of the walls. Each wall has a build-up (a 50 mm panel, a stud wall, a glass frame), and taking it off gives the inside size shown at the top right. The ceiling and floor build-ups are unconfirmed in the sample drawings: hover a field to see why.' },
  { id: 'cp-door', title: 'The door', target: 'cp-door', on: 'right', text: 'Choose the wall, width and height, whether it swings out or in, and the hinge side as seen from outside. Leave the offset blank to centre it. The plan shows the open leaf and the arc it sweeps; a door that opens in also shows the floor that must stay clear.' },
  { id: 'cp-header', title: 'The header: conditioner and vents', target: 'cp-header', on: 'right', text: 'The ceiling header sits above the enclosure and carries the conditioner and vents. Place each one from the left end of the header; the checks tell you if one does not fit or two overlap.' },
  { id: 'cp-rack', title: 'The rack specification', target: 'cp-rack', on: 'right', text: 'This starts blank on purpose. There is no supplier sheet yet, so every value says “not set” until you enter your supplier’s or fabricator’s numbers, and bottles are never counted as zero by mistake. The minimum walkway is yours to set; blank means it is not checked.' },
  { id: 'cp-runs', title: 'Rack runs', target: 'cp-runs', on: 'right', text: 'A run is a line of rack units against one wall. Add one and set where it starts and how many units, or press Fill to fit as many whole units as the wall allows, leaving the door opening free.' },
  { id: 'cp-tabs', title: 'Plan and elevation', target: 'cp-tabs', on: 'bottom', tab: 'elevation', text: 'Plan is the enclosure from above. Elevation shows one wall as you see it from outside: the door, the header and the sizes. Pick the wall with the buttons beside the tabs.' },
  { id: 'cp-drawing', title: 'The drawing', target: 'cp-drawing', on: 'left', tab: 'plan', text: 'Scroll to zoom, drag to move, and press Fit to bring the whole drawing back. Racks turn red on the plan when they have an error, and the dimensions follow every change you make.' },
  { id: 'cp-total', title: 'Bottles', target: 'cp-total', on: 'left', text: 'The bottle count adds up every run that can be built. It says “not set” until every run has its rack values, and runs with an error are left out and named, never added in. Bottles per row is calculated from the unit width and the bottle, until you type the real figure.' },
  { id: 'cp-checks', title: 'Checks', target: 'cp-checks', on: 'left', text: 'Errors (something does not fit), warnings and information, each with a plain reason and a way to fix it. A narrow walkway is only ever a warning.' },
  { id: 'cp-advisory', title: 'Advisory guidance', target: 'cp-advisory', on: 'left', text: 'Insulation, glass, door sealing and heat sources, from a cellar-building guide. This is information only: it never blocks a design and always needs mechanical engineer or HVAC sign-off. Nothing here sizes cooling or insulation.' },
  { id: 'cp-done', title: 'You’re set', text: 'Hover any button or field for a short explanation. The (i) is the full guide. Save the file to send the design to someone, and remember it is preliminary: final site measure is required before anything is made.' },
];

const selectorOf = (target: string): string => `[data-tour="${target}"]`;

export function startCellarTour(ui: UiStore): InstanceType<typeof Shepherd.Tour> {
  if (Shepherd.activeTour) Shepherd.activeTour.cancel();
  const before = { tab: ui.getState().tab, wall: ui.getState().wall };
  const tour = new Shepherd.Tour({
    useModalOverlay: true, exitOnEsc: true, keyboardNavigation: true,
    defaultStepOptions: { scrollTo: { behavior: 'smooth', block: 'center' }, cancelIcon: { enabled: true }, classes: 'vault-tour' },
  });
  const finish = (): void => {
    try { window.localStorage.setItem(TOUR_KEY, '1'); } catch { /* it will simply show again */ }
    ui.getState().set({ tab: before.tab, wall: before.wall });
  };
  tour.on('complete', finish);
  tour.on('cancel', finish);
  const secondary = (text: string, action: () => void) => ({ text, action, classes: 'vault-tour-btn-secondary' });

  TOUR_STEPS.forEach((s, i) => {
    const first = i === 0, last = i === TOUR_STEPS.length - 1;
    tour.addStep({
      id: s.id, title: s.title, text: s.text,
      ...(s.target ? { attachTo: { element: selectorOf(s.target), on: s.on ?? 'bottom' } } : {}),
      beforeShowPromise: () => new Promise<void>((resolve) => {
        if (s.tab && ui.getState().tab !== s.tab) ui.getState().set({ tab: s.tab });
        window.setTimeout(() => {
          // a step whose element is not on screen is shown as a centred card instead
          if (s.target && !document.querySelector(selectorOf(s.target))) { const step = tour.getById(s.id); if (step) step.options.attachTo = undefined; }
          resolve();
        }, s.tab ? 450 : 50);
      }),
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
