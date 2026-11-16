import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_translate_completed';

const TOTAL_STEPS = 9;

function injectStepCounter(stepIndex) {
  requestAnimationFrame(() => {
    const el = document.querySelector('.shepherd-element.vault-tour:not([hidden])') || document.querySelector('.shepherd-element.vault-tour'); // earlier cards stay in the page, hidden
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

// A step whose target is not on screen (no translations yet, a narrow window) is shown in the middle instead of failing.
function safeBeforeShow(tour, stepId, selector) {
  if (!document.querySelector(selector)) {
    const step = tour.getById(stepId);
    if (step) step.options.attachTo = undefined;
  }
}

/** goTool(id) shows that screen of the Translate page: 'start' | 'new' | 'jobs' | 'glossaries' | 'learned'. */
export function startTranslateTour(goTool = () => {}) {
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

  const done = () => { try { localStorage.setItem(TOUR_KEY, '1'); } catch { /* private window */ } };
  const btnSecondary = (text, action) => ({ text, action, classes: 'vault-tour-btn-secondary' });
  const btnBack = () => btnSecondary('← Back', () => tour.back());
  const btnNext = { text: 'Next →', action: () => tour.next() };
  const showTool = (tool, stepId, selector) => () => new Promise((resolve) => {
    goTool(tool);
    setTimeout(() => { safeBeforeShow(tour, stepId, selector); resolve(); }, 350);
  });
  const step = (n, id, tool, selector, on, title, text, buttons) => tour.addStep({
    id, title, text,
    attachTo: { element: selector, on },
    beforeShowPromise: showTool(tool, id, selector),
    when: { show() { injectStepCounter(n); } },
    buttons: buttons || [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'translate-welcome',
    title: 'Translate: a quick tour',
    text: 'Translate turns a PDF, Word, Excel or text file, or text you paste, into another language, checks the result and gives you the files to download. This tour shows where everything is. Nothing is translated during the tour.',
    when: { show() { goTool('start'); injectStepCounter(1); } },
    buttons: [btnSecondary('Skip tour', () => tour.cancel()), { text: 'Start tour →', action: () => tour.next() }],
  });

  step(2, 'translate-goals', 'start', '[data-tour="translate-goals"]', 'top',
    'Start from what you want to do',
    'Each box is a ready-made job: a quick draft, a document to send to someone, a scanned PDF and so on. Picking one opens New translation with the options already filled in. You can still change any of them.');

  step(3, 'translate-document', 'new', '[data-tour="translate-document"]', 'right',
    'Add the document and pick the language',
    'Drop a file here or click to choose one (up to 5 MB), or press “Paste text instead”. Then choose the language under “Translate to”. The language of the original is worked out for you.');

  step(4, 'translate-options', 'new', '[data-tour="translate-options"]', 'left',
    'Say a little about the document',
    'The line at the top says what this translation will do. Below it, say what kind of document it is and who will read it, and list any words to keep as they are. “More options” holds the translator, the PDF layout, the glossary and the second-model check.');

  step(5, 'translate-start', 'new', '[data-tour="translate-start"]', 'top',
    'Start, and keep the page open',
    'Press Start translation. A window shows each step while it runs. Keep this page open until it finishes: the PDF is put together in your browser at the end, so closing or reloading stops the translation part-way.');

  step(6, 'translate-tool-jobs', 'jobs', '[data-tour="translate-tool-jobs"]', 'right',
    'My translations',
    'Every translation you have run, newest first. The boxes at the top count how many are ready, need checking, are still running or did not finish. “Open result” on a row has the downloads and the list of what the checks found. The checks find problems; they do not fix them.');

  step(7, 'translate-tool-glossaries', 'glossaries', '[data-tour="translate-tool-glossaries"]', 'right',
    'Glossaries',
    'Lists of words that must always be translated one way, or left as they are, such as brand names and product codes. Translate also builds one “Learned” glossary per language and adds to it after every translation.');

  step(8, 'translate-tool-learned', 'learned', '[data-tour="translate-tool-learned"]', 'right',
    'What it has learned',
    'The rules and words you applied from “Lessons learnt” in a result, with dates, and how much stored wording Translate now reuses. These change later translations only, never one that is already finished.');

  tour.addStep({
    id: 'translate-guide',
    title: 'Not sure? Ask the guide',
    text: 'The round button at the bottom right is the Translate guide. Tell it what you want to do, by typing or talking, and it gives you the steps and opens the right screen. It cannot see your documents. The (i) beside the page title explains what Translate does and does not do.',
    when: { show() { goTool('start'); injectStepCounter(9); } },
    buttons: [btnBack(), { text: 'Finish tour ✓', action() { done(); tour.complete(); } }],
  });

  tour.on('cancel', done);
  tour.start();
  return tour;
}
