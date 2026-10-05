// Guided tour (Shepherd.js, the same library and look as Vault's other tours). Started by the compass button beside the title or by
// Vault's Settings page (?tour=1). Completing or skipping it sets the same localStorage key the other Vault tours use, so Settings can
// show "Retake Tour".
import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './tour.css';
import { injectStepCounter } from '@planner-core/help/tourCard';
import type { App } from '../createApp';
import { TOUR_KEY, safeSet } from './helpKeys';
import { TOUR_STEPS, type TourStep } from './tourSteps';

const selectorOf = (target: string): string => `[data-tour="${target}"]`;

/** Start the tour. Returns the Shepherd tour (tests drive it). */
export function startRoomPlannerTour(app: App): InstanceType<typeof Shepherd.Tour> {
  if (Shepherd.activeTour) Shepherd.activeTour.cancel();
  const ui = app.ui;
  const startedIn = ui.getState().viewMode;
  const hasRoom = (): boolean => !!app.project.getState().project?.rooms.length;
  const opened = { left: ui.getState().leftOpen, right: ui.getState().rightOpen };

  const tour = new Shepherd.Tour({
    useModalOverlay: true, exitOnEsc: true, keyboardNavigation: true,
    defaultStepOptions: { scrollTo: { behavior: 'smooth', block: 'center' }, cancelIcon: { enabled: true }, classes: 'vault-tour' },
  });

  const finish = (): void => {
    safeSet(TOUR_KEY, '1');
    // put the planner back the way the tour found it
    if (ui.getState().viewMode !== startedIn) app.setViewMode(startedIn);
    ui.getState().setPanel('left', opened.left);
    ui.getState().setPanel('right', opened.right);
  };
  tour.on('complete', finish);
  tour.on('cancel', finish);

  const secondary = (text: string, action: () => void) => ({ text, action, classes: 'vault-tour-btn-secondary' });

  TOUR_STEPS.forEach((s: TourStep, i: number) => {
    const first = i === 0;
    const last = i === TOUR_STEPS.length - 1;
    tour.addStep({
      id: s.id, title: s.title, text: s.text,
      ...(s.target ? { attachTo: { element: selectorOf(s.target), on: s.on ?? 'bottom' } } : {}),
      beforeShowPromise: () => new Promise<void>((resolve) => {
        if (s.needs3d && hasRoom() && ui.getState().viewMode !== '3d') app.setViewMode('3d');
        if (s.needs2d && ui.getState().viewMode !== '2d') app.setViewMode('2d');
        if (s.panel && !ui.getState()[s.panel === 'left' ? 'leftOpen' : 'rightOpen']) ui.getState().setPanel(s.panel, true);
        window.setTimeout(() => {
          // a step whose element is not on screen (no room yet, so no 3D) is shown as a centred card instead
          if (s.target && !document.querySelector(selectorOf(s.target))) {
            const step = tour.getById(s.id);
            if (step) step.options.attachTo = undefined;
          }
          resolve();
        }, s.needs3d || s.needs2d || s.panel ? 650 : 50);
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
