import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_sketchbook_completed';

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

// A step whose target is not on screen (for example a control inside an opened sketch while the list is showing) is shown in the middle instead.
function safeBeforeShow(tour, stepId, selector) {
  if (!document.querySelector(selector)) {
    const step = tour.getById(stepId);
    if (step) step.options.attachTo = undefined;
  }
}

/** The Sketchbook tour. It points at things on the collection page, which is always there; what is inside an opened sketch is described in words. */
export function startSketchbookTour() {
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
    id: 'sketchbook-welcome',
    title: 'Sketchbook — Quick Tour',
    text: 'Describe a scene, a theory or a possibility and have it drawn as a cartoon. Every sketch is saved to your account and nobody else can see it.',
    when: { show() { injectStepCounter(1); } },
    buttons: [btnSecondary('Skip Tour', () => tour.cancel()), { text: 'Start Tour →', action: () => tour.next() }],
  });

  tour.addStep({
    id: 'sketchbook-describe',
    title: 'Describe a scene',
    text: 'Say it with the microphone, or type it: who is there and what they are doing. Choose Pencil, Pen (in the ink colour you like) or Coloured in, and the shape of the picture. The cost is shown beside the button before you press it.',
    attachTo: { element: '[data-tour="sketchbook-describe"]', on: 'bottom' },
    beforeShowPromise: () => Promise.resolve(before('sketchbook-describe', '[data-tour="sketchbook-describe"]')()),
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'sketchbook-draw',
    title: 'Draw it',
    text: 'Draw it makes one picture, saves it to your collection and opens it. It is one paid AI image request, and the limit for the day is shared with Graphics. If the image service fails, nothing is recorded as spent.',
    attachTo: { element: '[data-tour="sketchbook-draw"]', on: 'bottom' },
    beforeShowPromise: () => Promise.resolve(before('sketchbook-draw', '[data-tour="sketchbook-draw"]')()),
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'sketchbook-list',
    title: 'Your sketches',
    text: 'Each sketch shows a small preview, its look and how many changes it has had. Click it to open it. Under each one you can rename it, make a copy, or delete it (it waits 30 days in the recycle bin, and an Undo button appears). A sketch that is in a note shows an In a note button that takes you straight to the note.',
    attachTo: { element: '[data-tour="sketchbook-list"]', on: 'top' },
    beforeShowPromise: () => Promise.resolve(before('sketchbook-list', '[data-tour="sketchbook-list"]')()),
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'sketchbook-change',
    title: 'Change a sketch',
    text: 'Inside a sketch, say what to change (make the dog bigger, add rain) and press Change it: the same picture is changed, not a new one drawn. Pencil, pen or colour redraws it in another look, and Colour it in does that with one press. The picture each change replaces is kept under Earlier pictures (the last 6): click one to look at it, and Put back brings it back, with its look.',
    when: { show() { injectStepCounter(5); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'sketchbook-notes',
    title: 'Save, copy and Notes',
    text: 'PNG, JPG and WebP save the picture to your computer, and Copy picture lets you paste it into an email or document. To Notes makes a new note with the picture inside it and a link back to the sketch. Once a sketch is in a note the same button becomes Go to note (or In 2 notes, with a list) and takes you straight there, and from the note the link comes back to the sketch.',
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
