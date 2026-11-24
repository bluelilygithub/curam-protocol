import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_tickets_completed';

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

// A step whose target is not on screen (the list when there are no tickets yet) is shown in the middle instead.
function safeBeforeShow(tour, stepId, selector) {
  if (!document.querySelector(selector)) {
    const step = tour.getById(stepId);
    if (step) step.options.attachTo = undefined;
  }
}

/** The Tickets tour. It points at things on the list page; what is inside an opened ticket is described in words. */
export function startTicketsTour() {
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
    id: 'tickets-welcome',
    title: 'Tickets — Quick Tour',
    text: 'An internal list of work: client requests, bugs in Vault or our sites and apps, admin, and ideas for later. Everyone who has Tickets sees and works on every ticket, and each change is written to its history.',
    when: { show() { injectStepCounter(1); } },
    buttons: [btnSecondary('Skip Tour', () => tour.cancel()), { text: 'Start Tour →', action: () => tour.next() }],
  });

  tour.addStep({
    id: 'tickets-new',
    title: 'New ticket',
    text: 'Type or dictate a title and pick the type, priority, due date, who has it and the client. Or paste a messy request into AI from text and press Fill in with AI: it fills the form for you to check. Nothing is saved until Create ticket.',
    attachTo: { element: '[data-tour="tickets-new"]', on: 'bottom' },
    beforeShowPromise: () => Promise.resolve(before('tickets-new', '[data-tour="tickets-new"]')()),
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'tickets-filters',
    title: 'Find tickets',
    text: 'Active shows everything not done. The chips narrow it by status and type, Mine shows what is assigned to you and Overdue what is past due. Search finds words, or a number such as T-12.',
    attachTo: { element: '[data-tour="tickets-filters"]', on: 'bottom' },
    beforeShowPromise: () => Promise.resolve(before('tickets-filters', '[data-tour="tickets-filters"]')()),
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'tickets-ticket',
    title: 'One ticket',
    text: 'Click a ticket to open it. The boxes on the right (status, assigned to, priority, type, due date, client) save as you change them. Comment in the Activity box; changes are listed there by themselves. Make a task adds a linked task to your Tasks.',
    attachTo: { element: '[data-tour="tickets-list"]', on: 'top' },
    beforeShowPromise: () => Promise.resolve(before('tickets-ticket', '[data-tour="tickets-list"]')()),
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'tickets-elsewhere',
    title: 'From other tools',
    text: 'Make a ticket in an open note or an Email Follow-Up case opens New ticket already filled in. A client\'s page has a Tickets tab, and a client project\'s page a Tickets section, each with its own New ticket button.',
    when: { show() { injectStepCounter(5); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'tickets-reminders',
    title: 'Reminders',
    text: 'Each morning at 7 you get an email of your tickets that are overdue, due today or newly assigned to you, when there are any. The Tickets item in the Apps menu shows how many are yours, red when some are overdue. The round guide button answers questions about Tickets.',
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
