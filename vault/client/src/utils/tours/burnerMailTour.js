import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_burner_mail_completed';

const TOTAL_STEPS = 7;

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

// An address or email may not exist yet: if the part of the page this step points at is missing, show the step in the middle of the screen.
function safeBeforeShow(tour, stepId, selector) {
  if (!document.querySelector(selector)) {
    const step = tour.getById(stepId);
    if (step) step.options.attachTo = undefined;
  }
}

/** `go(view)` switches the page ('make', 'live', 'saved', or 'burn' for the newest burn), so the tour can walk through it. */
export function startBurnerMailTour(go) {
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
  const check = (view, stepId, selector) => () => new Promise((resolve) => {
    Promise.resolve(view && go?.(view)).finally(() => setTimeout(() => { safeBeforeShow(tour, stepId, selector); resolve(); }, 400));
  });

  tour.addStep({
    id: 'burner-welcome',
    title: 'Burner Mail — Quick Tour',
    text: 'Make a throw-away email address for a web sign-up. When the site sends its verification email, the code and confirm link appear here. Nothing is opened for you.',
    when: { show() { injectStepCounter(1); } },
    buttons: [btnSecondary('Skip Tour', () => tour.cancel()), { text: 'Start Tour →', action: () => tour.next() }],
  });

  tour.addStep({
    id: 'burner-make',
    title: 'Make an address',
    text: 'New burn in the menu on the left. Type what it is for (optional), choose how long to keep it, and press Make burn. Seven days is the usual choice.',
    attachTo: { element: '[data-tour="burner-make"]', on: 'bottom' },
    beforeShowPromise: check('make', 'burner-make', '[data-tour="burner-make"]'),
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'burner-list',
    title: 'Your burns',
    text: 'Live burns lists every burn that still receives mail, each with a number like B-12, the same way tickets have T-12. Search by name, address or number. Saved burns shows only the ones you kept.',
    attachTo: { element: '[data-tour="burner-list"]', on: 'top' },
    beforeShowPromise: check('live', 'burner-list', '[data-tour="burner-list"]'),
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'burner-address',
    title: 'Copy the address',
    text: 'Open a burn, copy its address and paste it into the sign-up form on the other website. The burn then waits for mail and checks every few seconds.',
    attachTo: { element: '[data-tour="burner-address"]', on: 'bottom' },
    beforeShowPromise: check('burn', 'burner-address', '[data-tour="burner-address"]'),
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'burner-save',
    title: 'Save a burn',
    text: 'Save keeps a burn for good: it never expires and keeps receiving mail until you delete it. Click the name to rename it. The bin deletes the burn and its emails for good.',
    attachTo: { element: '[data-tour="burner-save"]', on: 'bottom' },
    beforeShowPromise: check(null, 'burner-save', '[data-tour="burner-save"]'),
    when: { show() { injectStepCounter(5); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'burner-inbox',
    title: 'Codes and links',
    text: 'When an email arrives, its verification code shows in large type with a Copy button, and confirm links are listed first with the site name. Burner Mail never opens a link for you, so check the site name before you press Open. Show full text is always there if the code looks wrong.',
    attachTo: { element: '[data-tour="burner-inbox"]', on: 'top' },
    beforeShowPromise: check(null, 'burner-inbox', '[data-tour="burner-inbox"]'),
    when: { show() { injectStepCounter(6); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'burner-limits',
    title: 'Good to know',
    text: 'Addresses only receive mail, and unsaved ones stop working when they expire. Only plain text, codes and link addresses are kept. Some websites refuse unfamiliar email domains; nothing here can change that. Stuck? Press the round button at the bottom right and ask the guide.',
    when: { show() { injectStepCounter(7); } },
    buttons: [
      btnBack(),
      { text: 'Finish Tour ✓', action() { try { localStorage.setItem(TOUR_KEY, '1'); } catch (_) { /* ignore */ } tour.complete(); } },
    ],
  });

  tour.on('cancel', () => { try { localStorage.setItem(TOUR_KEY, '1'); } catch (_) { /* ignore */ } });
  tour.start();
  return tour;
}
