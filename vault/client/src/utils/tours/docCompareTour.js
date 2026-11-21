import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

// The DocCompare tour (compass button beside the title in the tool list, Settings -> DocCompare Tour, or /doc-compare?tour=1).
// The tools themselves run inside the page's frame, which a tour cannot reach into: a step about a tool switches the frame to that tool
// (goTool, the same as clicking it in the list) and points at the whole frame.

export const TOUR_KEY = 'vault_tour_doc_compare_completed';

const TOTAL_STEPS = 14;

// Shepherd keeps earlier cards in the page (hidden), so the counter goes into this step's own card, not the first one found.
function injectStepCounter(stepIndex, card) {
  requestAnimationFrame(() => {
    const el = card || document.querySelector('.shepherd-element.vault-tour');
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

function safeBeforeShow(tour, stepId, selector) {
  if (!document.querySelector(selector)) {
    const step = tour.getById(stepId);
    if (step) step.options.attachTo = undefined;
  }
}

const FRAME = '[data-tour="doc-compare-app"]';

/** goTool(id) shows a tool ('compare', 'changes', 'metadata', 'pages', 'report', 'settings') or the job screen ('start'). */
export function startDocCompareTour(goTool) {
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
  const done = () => { try { localStorage.setItem(TOUR_KEY, '1'); } catch (_) { /* ignore */ } };
  const show = (tool, stepId, selector) => () => new Promise((resolve) => {
    if (tool) goTool(tool);
    setTimeout(() => { safeBeforeShow(tour, stepId, selector); resolve(); }, 450);
  });
  let n = 0;
  const step = (id, title, text, selector, tool, on = 'bottom') => {
    const i = ++n;
    tour.addStep({
      id, title, text,
      attachTo: selector ? { element: selector, on } : undefined,
      beforeShowPromise: show(tool, id, selector || 'body'),
      when: { show() { injectStepCounter(i, this.getElement()); } },
      buttons: [btnBack(), btnNext],
    });
  };

  n++;
  tour.addStep({
    id: 'dc-welcome',
    title: 'DocCompare — Quick Tour',
    text: 'When an AI edits a document it can drop a paragraph, change a number or quietly reword a sentence. DocCompare puts the original and the edited version side by side and lists every difference, most serious first. Your files never leave your computer: they are compared inside this browser tab.',
    when: { show() { injectStepCounter(1, this.getElement()); } },
    buttons: [btnSecondary('Skip Tour', () => tour.cancel()), { text: 'Start Tour →', action: () => tour.next() }],
  });

  step('dc-ready', 'Is it ready to submit?',
    'The quickest way in. Press Check a document, choose your original and the LLM-edited version, and DocCompare gives you a verdict and a card for each change that matters.',
    '[data-tour="doc-compare-check"]', 'start');

  step('dc-jobs', 'Or start with a job',
    'Pick a narrower job, for example "Check the AI did not leave anything out" or "Check numbers and dates were not changed". DocCompare opens the right tool, and after you compare it moves on to the next step with the right filter already set.',
    '[data-tour="doc-compare-jobs"]', 'start');

  step('dc-menu', 'Or pick a tool',
    'Every tool is also in this list: Compare documents, then the results (Verdict and review, All changes, File details, PDF pages), then PDF report and Settings. A tool that needs results says "Compare two files first" until you have compared. Hover any tool for what it does.',
    '[data-tour="doccompare-menu"]', null, 'right');

  step('dc-compare', 'Compare documents',
    'Drop the original on the left and the AI-edited version on the right, or press Choose file. Both must be the same type: PDF, Word (.docx), Markdown or plain text. Then press Compare.',
    FRAME, 'compare', 'top');

  step('dc-saved', 'Label it and come back later',
    'Type a label above the file boxes (optional). Every check is saved in this browser under that label, with both files and your decisions. Saved checks lists them: search by label or file name, open one to pick up where you left off, rename it, or delete it.',
    FRAME, 'saved', 'top');

  step('dc-checks', 'Two checks first',
    'DocCompare stops if the two files are different types, and warns (with Compare anyway) if they look like different documents. When it finishes, a summary of what changed appears here, with buttons to every result.',
    FRAME, 'compare', 'top');

  step('dc-review', 'The verdict comes first',
    'After comparing you see the verdict: Not ready to submit, Review recommended, or No significant changes found. Below it, a card for each change that matters says what happened and why it matters. Restore copies the original text to paste back, Accept records the change was intended, Fix later keeps it open. Your decisions are kept in this browser. The verdict shows what changed, not whether the content is accurate.',
    FRAME, 'review', 'top');

  step('dc-changes', 'All changes',
    'Every difference in one table, including the minor ones: removed, added, moved, wording, typos, numbers and dates, formatting and layout, each marked High, Medium or Low. Filter and search above the table, and press a row to see the exact words that changed, red for removed and green for added.',
    FRAME, 'changes', 'top');

  step('dc-details', 'File details and PDF pages',
    'File details compares size, dates, author and counts; a word count that dropped is flagged, because it often means skipped content. For two PDFs, PDF pages compares every page as a picture and opens changed pages side by side.',
    FRAME, 'metadata', 'top');

  step('dc-report', 'Send it back to the author',
    'Download review for the author makes a PDF to-do list of every change, Must fix first, each with what to do, a tick box, and the original and edited text. The comparison report below it is for your own records and follows your filters.',
    FRAME, 'report', 'top');

  step('dc-settings', 'Settings',
    'Choose when two files count as unrelated, when size and word-count changes are flagged, and which tiny differences (spaces, quotes, dashes) are ignored. Changes apply straight away and are remembered in this browser.',
    FRAME, 'settings', 'top');

  step('dc-help', 'Help is always here',
    'The (i) beside the title explains how DocCompare works, and the compass runs this tour again.',
    '[aria-label="How DocCompare works"]', null, 'right');

  const last = ++n;
  tour.addStep({
    id: 'dc-guide',
    title: 'Ask the guide',
    text: 'Not sure where to start? Press the round button and say what you want to check, by typing or talking. The guide points you to the right tools in order. It cannot see your files.',
    attachTo: { element: '[aria-label="Open the DocCompare guide"]', on: 'left' },
    beforeShowPromise: show('start', 'dc-guide', '[aria-label="Open the DocCompare guide"]'),
    when: { show() { injectStepCounter(last, this.getElement()); } },
    buttons: [btnBack(), { text: 'Finish Tour ✓', action() { done(); tour.complete(); } }],
  });

  tour.on('cancel', done);
  tour.start();
  return tour;
}
