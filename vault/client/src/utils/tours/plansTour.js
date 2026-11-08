import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_plans_completed';

const TOTAL_STEPS = 6;

function injectStepCounter(stepIndex) {
  requestAnimationFrame(() => {
    const el = document.querySelector('.shepherd-element.vault-tour');
    if (!el) return;
    let counter = el.querySelector('.vault-tour-step-count');
    if (!counter) {
      counter = document.createElement('div');
      counter.className = 'vault-tour-step-count';
      const footer = el.querySelector('.shepherd-footer');
      if (footer) footer.parentNode.insertBefore(counter, footer);
    }
    counter.textContent = `Step ${stepIndex} of ${TOTAL_STEPS}`;
  });
}

// A step whose target is not on screen (the list of plans when there are none yet, or anything inside an opened plan while the list is
// showing) is shown in the middle instead.
function safeBeforeShow(tour, stepId, selector) {
  if (!document.querySelector(selector)) {
    const step = tour.getById(stepId);
    if (step) step.options.attachTo = undefined;
  }
}

/** The Plans tour. It points at things on the list page, which is always there; what is inside an opened plan is described in words. */
export function startPlansTour() {
  if (Shepherd.activeTour) Shepherd.activeTour.cancel();

  const tour = new Shepherd.Tour({
    useModalOverlay: true,
    exitOnEsc: true,
    keyboardNavigation: true,
    defaultStepOptions: {
      scrollTo: { behavior: 'smooth', block: 'center' },
      cancelIcon: { enabled: true },
      classes: 'vault-tour',
    },
  });

  const btnSecondary = (text, action) => ({ text, action, classes: 'vault-tour-btn-secondary' });
  const btnBack = () => btnSecondary('← Back', () => tour.back());
  const btnNext = { text: 'Next →', action: () => tour.next() };
  const before = (stepId, selector) => () => { safeBeforeShow(tour, stepId, selector); };

  tour.addStep({
    id: 'plans-welcome',
    title: 'Plans — Quick Tour',
    text: 'A plan is a list of steps with a length in working days, and which steps wait on which. Plans works out the dates and tells you whether it all finishes in time. Your plans are saved to your account and nobody else can see them.',
    when: { show() { injectStepCounter(1); } },
    buttons: [btnSecondary('Skip Tour', () => tour.cancel()), { text: 'Start Tour →', action: () => tour.next() }],
  });

  tour.addStep({
    id: 'plans-start',
    title: 'Start a plan',
    text: 'Type or say a name. Add a Start date if you know when work begins, and a Finish by date if it must be done by then. You can leave either empty: with only a Finish by date, Plans suggests when to start. Then press Make plan and add the steps.',
    attachTo: { element: '[data-tour="plans-start"]', on: 'bottom' },
    beforeShowPromise: () => Promise.resolve(before('plans-start', '[data-tour="plans-start"]')()),
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'plans-list',
    title: 'Your plans',
    text: 'Each plan shows how many steps are done, and its dates. Click its name to open it. Delete asks first, and an Undo button appears; a deleted plan waits 30 days in the recycle bin. A plan made from a diagram is also reachable from the diagram: its Make a plan button then says In a plan.',
    attachTo: { element: '[data-tour="plans-list"]', on: 'top' },
    beforeShowPromise: () => Promise.resolve(before('plans-list', '[data-tour="plans-list"]')()),
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'plans-steps',
    title: 'Steps and lengths',
    text: 'Inside a plan, press Add step and give each a length in working days. Press the pencil on a step to choose which step it waits on: the step then starts the working day after that one ends. A milestone has no length and shows as a diamond, and Add a sub-step in the same box puts sub-steps inside a step.',
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'plans-fit',
    title: 'Does it fit?',
    text: 'The line under the dates says whether the steps finish by your Finish by date: fits, fits with days to spare, or over by some working days. It never changes your lengths for you. To hold a step on a day, change its Starts date and a pin appears; press the pin to let it move again.',
    when: { show() { injectStepCounter(5); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'plans-timeline',
    title: 'Timeline, Tasks and diagrams',
    text: 'Under the steps, the timeline draws every step as a bar, with an arrow for each waits-on link. Drag a bar to move a step, or drag its right edge to change its length. The checklist button on a step (or Send all to Tasks) makes real tasks from it. In Diagrams, Make a plan turns a flowchart into a plan.',
    when: { show() { injectStepCounter(6); } },
    buttons: [
      btnBack(),
      { text: 'Finish Tour ✓', action() { try { localStorage.setItem(TOUR_KEY, '1'); } catch (_) { /* ignore */ } tour.complete(); } },
    ],
  });

  tour.on('cancel', () => { try { localStorage.setItem(TOUR_KEY, '1'); } catch (_) { /* ignore */ } });
  tour.start();
  return tour;
}
