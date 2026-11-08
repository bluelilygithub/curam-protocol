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
    title: 'Diagrams — Quick Tour',
    text: 'Sketch ideas, diagrams and plans on an endless page. Your diagrams are saved to your account by themselves, and nobody else can see them.',
    when: { show() { injectStepCounter(1); } },
    buttons: [btnSecondary('Skip Tour', () => tour.cancel()), { text: 'Start Tour →', action: () => tour.next() }],
  });

  tour.addStep({
    id: 'drawings-new',
    title: 'Start a diagram',
    text: 'New diagram opens an empty page straight away. It is called "Untitled diagram" until you rename it, and it saves as soon as you start diagram.',
    attachTo: { element: '[data-tour="drawings-new"]', on: 'bottom' },
    beforeShowPromise: () => Promise.resolve(before('drawings-new', '[data-tour="drawings-new"]')()),
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'drawings-open-file',
    title: 'Bring a diagram in',
    text: 'Open a file takes a diagram file ending in .excalidraw, from Excalidraw itself or an earlier export, and saves it as a new diagram in your list.',
    attachTo: { element: '[data-tour="drawings-open-file"]', on: 'bottom' },
    beforeShowPromise: () => Promise.resolve(before('drawings-open-file', '[data-tour="drawings-open-file"]')()),
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'drawings-list',
    title: 'Your diagrams',
    text: 'Each diagram shows a small preview. Click it to open it. Under each one you can rename it, make a copy, or delete it. A deleted diagram shows an Undo button and waits 30 days in the recycle bin in Settings.',
    attachTo: { element: '[data-tour="drawings-list"]', on: 'top' },
    beforeShowPromise: () => Promise.resolve(before('drawings-list', '[data-tour="drawings-list"]')()),
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'drawings-board',
    title: 'The board',
    text: 'Inside a diagram, the tools are along the top: rectangle, diamond, ellipse, arrow, line, pen, text, picture and eraser. Click a piece to change its colour and style in the panel on the left. The words beside the name say when it last saved. Undo and Redo (the arrows at the bottom left of the board) go back and forward as many steps as you need. Numbers puts a small number on each shape so you can say add a step after 7, Select all (top right of the board) and Fit to screen help with resizing, Keep shape or Free (also top right) decides whether stretching keeps proportions, Snap to grid lines boxes up, and a selected arrow can take an arrowhead at both ends under Arrowheads in the left panel.',
    when: { show() { injectStepCounter(5); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'drawings-export',
    title: 'Look, export and Notes',
    text: 'Use the buttons above the diagram: Sketch or Clean switches its look (and back again, exactly as drawn), PNG and SVG save a picture, File saves a .excalidraw file you can open again, and To Notes puts the diagram inside a new note (once it is in a note, the same button takes you back to it). Draw it for me, which turns something you say or type into boxes and arrows, is in the More tools menu, the last icon in the row of tools along the top of the board; its box also has What have I missed?, which lists what you may not have considered.',
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
