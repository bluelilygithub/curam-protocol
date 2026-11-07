import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_memory_completed';

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

// A part of the page may not be there (no memories yet): show that step in the middle of the screen instead of failing.
function safeBeforeShow(tour, stepId, selector) {
  if (!document.querySelector(selector)) {
    const step = tour.getById(stepId);
    if (step) step.options.attachTo = undefined;
  }
}

export function startMemoryTour() {
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
  const before = (stepId, selector) => () => new Promise((resolve) => { safeBeforeShow(tour, stepId, selector); resolve(); });

  tour.addStep({
    id: 'memory-welcome',
    title: 'Memory — Quick Tour',
    text: 'Memory is a private notebook of short facts about you, such as "I prefer plain language" or "my time zone is Australia/Brisbane". In every chat Vault picks the facts that fit what you asked and shows them to Claude, so you do not have to repeat yourself.',
    when: { show() { injectStepCounter(1); } },
    buttons: [btnSecondary('Skip Tour', () => tour.cancel()), { text: 'Start Tour →', action: () => tour.next() }],
  });

  tour.addStep({
    id: 'memory-add',
    title: 'Add a memory',
    text: 'Type one short fact about one thing and press Add, or tap the microphone and say it. This is the only place memories are added: Chat reads them but does not save new ones. The same words twice are kept once.',
    attachTo: { element: '[data-tour="memory-add"]', on: 'bottom' },
    beforeShowPromise: before('memory-add', '[data-tour="memory-add"]'),
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'memory-search',
    title: 'Search by meaning',
    text: 'Search looks for what a fact means, not only its exact words, so "where do I live" can find "my home is in Brisbane". If search by meaning is not set up, it shows your most recent memories instead of real matches.',
    attachTo: { element: '[data-tour="memory-search"]', on: 'bottom' },
    beforeShowPromise: before('memory-search', '[data-tour="memory-search"]'),
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'memory-list',
    title: 'Your memories',
    text: 'Newest first. A long memory shows a short preview with Show more. After a search, each match shows how close it was. There is no edit button: to change a fact, add the new version and delete the old one.',
    attachTo: { element: '[data-tour="memory-list"]', on: 'top' },
    beforeShowPromise: before('memory-list', '[data-tour="memory-list"]'),
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'memory-delete',
    title: 'Deleting',
    text: 'The bin icon on a memory asks Delete? Yes / No. Yes removes it for good: there is no recycle bin and no Undo. Claude stops using it from the next message.',
    attachTo: { element: '[data-tour="memory-delete"]', on: 'left' },
    beforeShowPromise: before('memory-delete', '[data-tour="memory-delete"]'),
    when: { show() { injectStepCounter(5); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'memory-help',
    title: 'Help is one tap away',
    text: 'The (i) beside the title explains how Memory works, and the round guide button at the bottom right answers questions like "can I tell Claude in a chat to remember something?" and points at the right part of the page.',
    attachTo: { element: '[data-tour="memory-info"]', on: 'bottom' },
    beforeShowPromise: before('memory-help', '[data-tour="memory-info"]'),
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
