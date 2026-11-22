import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_presentations_completed';

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

// The start screen is only on screen while "What do you want to do?" is open, and the buttons for a job appear as its tools open.
// If a target is missing, show the step in the middle instead of pointing at nothing.
function safeBeforeShow(tour, stepId, selector) {
  if (!document.querySelector(selector)) {
    const step = tour.getById(stepId);
    if (step) step.options.attachTo = undefined;
  }
}

/** The Presentations tour. It sticks to the shell: jobs, sidebar, help, the work area and the guide chat. */
export function startPresentationsTour() {
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
    id: 'presentations-welcome',
    title: 'Presentations — Quick Tour',
    text: 'Presentations turns a written brief, a document, a web page or a set of pictures into a small slide deck you can edit and export. It has six tools in four groups: Make, Design, Finish and Library. It opens on “What do you want to do?” — pick a job and the tools you need open one step at a time. The guide chat at the bottom right helps you choose; it cannot see your decks.',
    when: { show() { injectStepCounter(1); } },
    buttons: [btnSecondary('Skip Tour', () => tour.cancel()), { text: 'Start Tour →', action: () => tour.next() }],
  });

  tour.addStep({
    id: 'presentations-jobs',
    title: 'Start with a job',
    text: 'The four cards are the usual ways in: make a deck from a brief, turn a document into slides, make a deck in your brand, or reopen a saved deck. Pick one and it opens just the relevant tools, in order. “Back to all jobs” above every tool takes you to another job; the deck stays with you as you move between tools.',
    attachTo: { element: '[data-tour="presentations-jobs"]', on: 'bottom' },
    beforeShowPromise: () => Promise.resolve(before('presentations-jobs', '[data-tour="presentations-jobs"]')()),
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'presentations-sidebar',
    title: 'The tool list',
    text: 'The left-hand list holds all six tools, grouped as Make (Create deck, Import source), Design (Themes, Slide editor), Finish (Export) and Library (My decks). Click a group to open or close it. The search box filters by name or plain description — press / to jump to it, or use its microphone to speak. Hover any group or tool for a short explanation.',
    attachTo: { element: '[data-tour="presentations-menu"]', on: 'right' },
    beforeShowPromise: () => Promise.resolve(before('presentations-sidebar', '[data-tour="presentations-menu"]')()),
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'presentations-help',
    title: 'Help when you need it',
    text: 'The (i) next to the title opens “How Presentations Works” once. Each tool also has a (?) button with its own short help, and the microphone works on text fields such as the brief and the tool search. Nothing here counts as a tool — they are just ways to get unstuck.',
    attachTo: { element: '[aria-label="How Presentations works"]', on: 'bottom' },
    beforeShowPromise: () => Promise.resolve(before('presentations-help', '[aria-label="How Presentations works"]')()),
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'presentations-work',
    title: 'Make, edit, export',
    text: 'Create deck writes an outline then slides using the workspace models; Import source brings in text and pictures from PDF, Word, text, Markdown, a web URL or images. Themes picks the look (six built-ins, your saved themes, a PowerPoint theme import or your Brand Kit). The slide editor changes words, pictures and order. Export makes an editable PPTX, a PDF, a self-contained HTML preview or one PNG per slide. Everything renders from one deck model, so preview and exports stay in step; long jobs run in the background with progress, Cancel and Resume, and “Use in…” hands a result to another tool.',
    attachTo: { element: '[data-tour="presentations-main"]', on: 'top' },
    beforeShowPromise: () => Promise.resolve(before('presentations-work', '[data-tour="presentations-main"]')()),
    when: { show() { injectStepCounter(5); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'presentations-guide',
    title: 'Ask the guide',
    text: 'The guide chat in the bottom right is the helper chatbot for Presentations. Ask it what you want to make — “turn this PDF into slides”, “use my brand colours”, “reopen a saved deck and export it” — and it points at the real tools in order using Open buttons. It checks the tool list and cannot see, read or change your decks, documents or settings. My decks saves work on the server; recently opened decks on this device are opt-in browser history, not a backup.',
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
