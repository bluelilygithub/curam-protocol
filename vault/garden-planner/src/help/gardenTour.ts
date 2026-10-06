// Guided tour (Shepherd.js: the same library and look as Vault's other tours). Started by the compass button or by Vault's Settings page
// (?tour=1). Completing or skipping sets the localStorage key the other Vault tours use, so Settings can show "Retake Tour".
import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import '@planner-core/help/tour.css';
import { injectStepCounter } from '@planner-core/help/tourCard';
import type { App } from '../createApp';

export const TOUR_KEY = 'vault_tour_garden_planner_completed';

export interface TourStep {
  id: string; title: string; text: string;
  /** `data-tour` value of the element to point at; omitted = centred card. */
  target?: string;
  on?: 'top' | 'bottom' | 'left' | 'right';
  needs2d?: boolean;
  /** The step points at something that only exists in the 3D view. */
  needs3d?: boolean;
  panel?: 'library' | 'inspector';
}

/** The tour as data (pure, tested). */
export const TOUR_STEPS: TourStep[] = [
  { id: 'gp-welcome', title: 'Garden Planner: Quick Tour', text: 'Design a real Australian garden to scale, see whether it works now and when it has grown, check it for problems, walk through it, and print a planting plan. This tour takes about two minutes.' },
  { id: 'gp-project', title: 'Your gardens', target: 'gp-project', on: 'bottom', text: 'Start a new garden here, or open, copy, import and export the ones you have. A new garden asks for the street address (and shows a close-up map of it), which sets the state, climate, frost level and the sun, and centres the plan and the satellite map on your house. Changes save to your Vault account on their own, and the bar at the bottom says where.' },
  { id: 'gp-tools', title: 'Drawing tools', target: 'gp-tools', on: 'bottom', needs2d: true, text: 'Draw your plot, the house, beds, lawns, paths and zones, and place structures like a pergola, shed, gate or water tank. The Service tool marks sewer, water, gas and power lines so the checks can keep trees away from them. Click corners, or drag a rectangle. Beds and lawns can be curved, and shapes snap to corners and edges (hold Shift to place freely). Ctrl+Z undoes anything.' },
  { id: 'gp-library', title: 'Plant library', target: 'gp-library', on: 'right', panel: 'library', text: 'Search by name or filter by size, sun, water, flowering month and colour. “Suits my garden” hides plants that will not take your climate or frost, and weeds in your state, and lists them with the reason below. Click Add to plan then the plan, or drag a plant onto the plan. The box at the top shows your address and the climate the library is filtered for; click it to change them. The camera button reads a nursery tag from a photo and suggests the plant.' },
  { id: 'gp-stage', title: 'The plan', target: 'gp-stage', on: 'left', needs2d: true, text: 'Scroll or pinch to zoom, drag empty space to pan. Select anything to move it or drag its corner dots. A selected item gets a bar at the bottom with Duplicate, Row… (several copies in a straight line, evenly spaced) and Delete. Drag the north arrow to match your plot: in Australia the sun is in the north.' },
  { id: 'gp-inspector', title: 'Details panel', target: 'gp-inspector', on: 'left', panel: 'inspector', text: 'Select something to edit it exactly: names, sizes, fences, mulch, edging, grass. Select a bed and use Fill bed to plant it at the right spacing. With nothing selected it shows the garden’s settings: the address (change it and the map moves with it), climate, frost, soil, pets, north, and the satellite map (an aerial photo under the plan that you line up with your house, true to scale).' },
  { id: 'gp-growth', title: 'Growth, season and sun', target: 'gp-growth', on: 'top', text: 'Plants grow. Use Growth to see the garden just planted, then at 1, 3 and 5 years and fully grown. Month shows flowers, bare winter trees and autumn colour. Time moves the sun through the day: press Shadows to see what shades what, and Sun map to see the hours of sun each spot gets (full sun, part shade, shade). Summer is December to February.' },
  { id: 'gp-checks', title: 'Checks', target: 'gp-checks', on: 'bottom', text: 'Problems are listed here with a plain reason for each: plants too close at full size, over the boundary, too near the house or pipes, wrong amount of sun, not suited to your climate, weeds, toxic to pets, paths too narrow, blocked gates, lawns the mower cannot reach. Show takes you to it and Fix position moves a plant to a clear spot. Plant-data checks say they are a draft, and an unchecked weed status says “unknown”, never “safe”.' },
  { id: 'gp-schedule', title: 'Schedule and printable plan', target: 'gp-schedule', on: 'bottom', text: 'Every plant in the garden, one row per kind, with quantity, size, spacing, needs, cautions and where it is planted. Download it as a CSV for a spreadsheet, or as a to-scale PDF plan (A4 or A3) with each plant numbered to match, a key, a north arrow and a scale bar, to take to the nursery. Everything printed says the plant data is a draft.' },
  { id: 'gp-view', title: '2D and 3D', target: 'gp-view', on: 'bottom', text: 'Switch between the plan you edit and a 3D view of the same garden, with the real sun and your shadows. The Time and Month sliders still work in 3D.' },
  { id: 'gp-3dbar', title: 'In 3D', target: 'gp-3dbar', on: 'bottom', needs3d: true, text: 'Iso, Top and Front are standard views. Walk puts you in the garden at eye height (the house, fences and trunks are solid; gates let you through). Fly-through tours the garden by itself, sweeping over the house and trees. Views saves a camera position, and two or more become the fly-through’s stops. Render photo makes a realistic picture from where the camera is, which you can download.' },
  { id: 'gp-done', title: 'You’re set', text: 'Hover any button or field for a short explanation. Every text and number box has a microphone: tap it and speak. The (i) explains how it all fits together, and the compass retakes this tour.' },
];

const selectorOf = (target: string): string => `[data-tour="${target}"]`;

export function startGardenTour(app: App): InstanceType<typeof Shepherd.Tour> {
  if (Shepherd.activeTour) Shepherd.activeTour.cancel();
  const ui = app.ui;
  const before = { view: ui.getState().viewMode, lib: ui.getState().libraryOpen, insp: ui.getState().inspectorOpen };
  const tour = new Shepherd.Tour({
    useModalOverlay: true, exitOnEsc: true, keyboardNavigation: true,
    defaultStepOptions: { scrollTo: { behavior: 'smooth', block: 'center' }, cancelIcon: { enabled: true }, classes: 'vault-tour' },
  });
  const finish = (): void => {
    try { window.localStorage.setItem(TOUR_KEY, '1'); } catch { /* it will simply show again */ }
    ui.getState().set({ viewMode: before.view, libraryOpen: before.lib, inspectorOpen: before.insp });
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
        if (s.needs2d && ui.getState().viewMode !== '2d') ui.getState().set({ viewMode: '2d' });
        if (s.needs3d && ui.getState().viewMode !== '3d') ui.getState().set({ viewMode: '3d' });
        if (s.panel === 'library' && !ui.getState().libraryOpen) ui.getState().set({ libraryOpen: true });
        if (s.panel === 'inspector' && !ui.getState().inspectorOpen) ui.getState().set({ inspectorOpen: true });
        window.setTimeout(() => {
          // a step whose element is not on screen is shown as a centred card instead
          if (s.target && !document.querySelector(selectorOf(s.target))) { const step = tour.getById(s.id); if (step) step.options.attachTo = undefined; }
          resolve();
        }, s.needs2d || s.needs3d || s.panel ? 450 : 50);
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
