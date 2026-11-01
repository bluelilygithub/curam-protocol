import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_device_preview_completed';

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

// The screens only exist after a page is loaded: if a part of the page this step points at is missing, show the step in the middle of the screen.
function safeBeforeShow(tour, stepId, selector) {
  if (!document.querySelector(selector)) {
    const step = tour.getById(stepId);
    if (step) step.options.attachTo = undefined;
  }
}

export function startDevicePreviewTour() {
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
  const check = (stepId, selector) => () => new Promise((resolve) => { safeBeforeShow(tour, stepId, selector); resolve(); });

  tour.addStep({
    id: 'dp-welcome',
    title: 'Device preview — Quick Tour',
    text: 'See how a public web page looks on real phones, tablets and monitors, side by side. It only looks: nothing is saved and the page is never changed.',
    when: { show() { injectStepCounter(1); } },
    buttons: [btnSecondary('Skip Tour', () => tour.cancel()), { text: 'Start Tour →', action: () => tour.next() }],
  });

  tour.addStep({
    id: 'dp-address',
    title: 'Type the address',
    text: 'Type the address of a public page, or say it with the microphone, then press Show the page. If the page comes up empty, tick the JavaScript box and try again.',
    attachTo: { element: '[data-tour="dp-address"]', on: 'bottom' },
    beforeShowPromise: check('dp-address', '[data-tour="dp-address"]'),
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'dp-devices',
    title: 'Choose screens',
    text: 'Tap up to four phones, tablets or monitors. Tap one again to remove it. Each screen is drawn as wide as the real device, so the page changes shape the way it does there.',
    attachTo: { element: '[data-tour="dp-devices"]', on: 'top' },
    beforeShowPromise: check('dp-devices', '[data-tour="dp-devices"]'),
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'dp-own',
    title: 'Your own size',
    text: 'Need a size that is not in the list? Type a width and a height in pixels and press Add. You can keep up to three of your own.',
    attachTo: { element: '[data-tour="dp-own"]', on: 'top' },
    beforeShowPromise: check('dp-own', '[data-tour="dp-own"]'),
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'dp-view',
    title: 'Turn it and resize it',
    text: 'The phone button holds phones and tablets on their side. Fit shrinks every screen so it fits on the page; 100% shows the real size, which may need scrolling sideways.',
    attachTo: { element: '[data-tour="dp-view"]', on: 'top' },
    beforeShowPromise: check('dp-view', '[data-tour="dp-view"]'),
    when: { show() { injectStepCounter(5); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'dp-limits',
    title: 'Good to know',
    text: 'Heights are close, not exact: a real phone has browser bars that use some of it. The page is shown without its scripts, so menus that open will not work, and pages behind a login cannot be loaded. To change how a page looks, use the Style editor. Stuck? Press the round button at the bottom right and ask the guide.',
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
