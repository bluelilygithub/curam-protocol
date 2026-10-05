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
  panel?: 'library' | 'inspector';
}

/** The tour as data (pure, tested). */
export const TOUR_STEPS: TourStep[] = [
  { id: 'gp-welcome', title: 'Garden Planner: Quick Tour', text: 'Design a real Australian garden to scale, then see whether it works now and when it has grown. This tour takes about a minute.' },
  { id: 'gp-project', title: 'Your gardens', target: 'gp-project', on: 'bottom', text: 'Start a new garden here, or open, copy, import and export the ones you have. A new garden asks where you are, which sets the climate, frost level and the sun. Changes save by themselves.' },
  { id: 'gp-tools', title: 'Drawing tools', target: 'gp-tools', on: 'bottom', needs2d: true, text: 'Draw your plot, the house, beds, lawns, paths and zones, and place structures like a pergola, shed or water tank. Click corners, or drag a rectangle. Beds and lawns can have curved edges. Everything snaps to the plot, house and other shapes.' },
  { id: 'gp-library', title: 'Plant library', target: 'gp-library', on: 'right', panel: 'library', text: 'Search by name or filter by size, sun, water, flowering month and colour. “Suits my garden” hides plants that will not take your climate or frost, and weeds in your state. Open a plant to see its facts, then Add to plan.' },
  { id: 'gp-stage', title: 'The plan', target: 'gp-stage', on: 'left', needs2d: true, text: 'Scroll or pinch to zoom, drag empty space to pan. Select anything to move it or drag its corner dots. Drag the north arrow to match your plot: in Australia the sun is in the north.' },
  { id: 'gp-inspector', title: 'Details panel', target: 'gp-inspector', on: 'left', panel: 'inspector', text: 'Select something to edit it exactly: names, sizes, fences, mulch, edging, grass. Select a bed and use Fill bed to plant it at the right spacing. With nothing selected you can change the garden’s climate, frost, soil and north.' },
  { id: 'gp-growth', title: 'Growth and season', target: 'gp-growth', on: 'top', text: 'Plants grow. Use Growth to see the garden just planted, then at 1, 3 and 5 years and fully grown. Use Month to see flowers, bare winter trees and autumn colour. Summer is December to February.' },
  { id: 'gp-view', title: '2D and 3D', target: 'gp-view', on: 'bottom', text: 'Switch between the plan you edit and a 3D view of the same garden. In 3D you can orbit, zoom, and jump to Iso, Top or Front views.' },
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
        if (s.panel === 'library' && !ui.getState().libraryOpen) ui.getState().set({ libraryOpen: true });
        if (s.panel === 'inspector' && !ui.getState().inspectorOpen) ui.getState().set({ inspectorOpen: true });
        window.setTimeout(() => {
          // a step whose element is not on screen is shown as a centred card instead
          if (s.target && !document.querySelector(selectorOf(s.target))) { const step = tour.getById(s.id); if (step) step.options.attachTo = undefined; }
          resolve();
        }, s.needs2d || s.panel ? 450 : 50);
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
