import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_drawings_completed';

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

// A step whose target is not on screen (for example the drawing board while the list is showing) is shown in the middle instead.
function safeBeforeShow(tour, stepId, selector) {
  if (!document.querySelector(selector)) {
    const step = tour.getById(stepId);
    if (step) step.options.attachTo = undefined;
  }
}

/** The Drawings tour. It only points at things on the list of drawings, which is always there; the drawing board is described in words. */
export function startDrawingsTour() {
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
    id: 'drawings-welcome',
    title: 'Drawings — Quick Tour',
    text: 'Sketch ideas, diagrams and plans on an endless page. Your drawings are saved to your account by themselves, and nobody else can see them.',
    when: { show() { injectStepCounter(1); } },
    buttons: [btnSecondary('Skip Tour', () => tour.cancel()), { text: 'Start Tour →', action: () => tour.next() }],
  });

  tour.addStep({
    id: 'drawings-new',
    title: 'Start a drawing',
    text: 'New drawing opens an empty page straight away. It is called "Untitled drawing" until you rename it, and it saves as soon as you start drawing.',
    attachTo: { element: '[data-tour="drawings-new"]', on: 'bottom' },
    beforeShowPromise: () => Promise.resolve(before('drawings-new', '[data-tour="drawings-new"]')()),
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'drawings-open-file',
    title: 'Bring a drawing in',
    text: 'Open a file takes a drawing file ending in .excalidraw, from Excalidraw itself or an earlier export, and saves it as a new drawing in your list.',
    attachTo: { element: '[data-tour="drawings-open-file"]', on: 'bottom' },
    beforeShowPromise: () => Promise.resolve(before('drawings-open-file', '[data-tour="drawings-open-file"]')()),
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'drawings-list',
    title: 'Your drawings',
    text: 'Each drawing shows a small preview. Click it to open it. Under each one you can rename it, make a copy, or delete it. A deleted drawing shows an Undo button and waits 30 days in the recycle bin in Settings.',
    attachTo: { element: '[data-tour="drawings-list"]', on: 'top' },
    beforeShowPromise: () => Promise.resolve(before('drawings-list', '[data-tour="drawings-list"]')()),
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'drawings-board',
    title: 'The drawing board',
    text: 'Inside a drawing, the tools are along the top: rectangle, diamond, ellipse, arrow, line, pen, text, picture and eraser. Click a piece to change its colour and style in the panel on the left. The words beside the name say when it last saved.',
    when: { show() { injectStepCounter(5); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'drawings-export',
    title: 'Look, export and Notes',
    text: 'Use the buttons above the drawing: Draw it for me turns something you say or type into boxes and arrows, Sketch or Clean switches its look (and back again, exactly as drawn), PNG and SVG save a picture, File saves a .excalidraw file you can open again, and To Notes puts the drawing inside a new note.',
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
