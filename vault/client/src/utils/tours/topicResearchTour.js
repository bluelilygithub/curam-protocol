import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_topic_research_completed';

const TOTAL_STEPS = 9;

function injectStepCounter(stepIndex) {
  requestAnimationFrame(() => {
    const el = document.querySelector('.shepherd-element.vault-tour');
    if (!el) return;
    let counter = el.querySelector('.vault-tour-step-count');
    if (!counter) {
      counter = document.createElement('div');
      counter.className = 'vault-tour-step-count';
      const footer = el.querySelector('.shepherd-footer');
      if (footer && footer.parentNode) footer.parentNode.insertBefore(counter, footer);
    }
    counter.textContent = `Step ${stepIndex} of ${TOTAL_STEPS}`;
  });
}

// Some parts of the page only exist once something is saved or on another tab: if a part this step points at is missing, show the step in the middle of the screen.
function safeBeforeShow(tour, stepId, selector) {
  if (!document.querySelector(selector)) {
    const step = tour.getById(stepId);
    if (step) step.options.attachTo = undefined;
  }
}

export function startTopicResearchTour() {
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
    id: 'tr-welcome',
    title: 'Topic Research — Quick Tour',
    text: 'Topic Research finds what is being talked about on a topic right now, ranks the stories and can write you a research brief. You then write your own article. It never writes or publishes one for you.',
    when: { show() { injectStepCounter(1); } },
    buttons: [btnSecondary('Skip Tour', () => tour.cancel()), { text: 'Start Tour →', action: () => tour.next() }],
  });

  tour.addStep({
    id: 'tr-search',
    title: 'Search a topic',
    text: 'Type a topic and press Search. It asks your sources, reads the best pages, groups articles about the same story and ranks the stories. It can take up to half a minute.',
    attachTo: { element: '[data-tour="tr-search"]', on: 'bottom' },
    beforeShowPromise: check('tr-search', '[data-tour="tr-search"]'),
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'tr-topics',
    title: 'Your saved topics',
    text: 'Every topic you search is saved here. Tick Watch on one and choose how often it refreshes, and it searches by itself in the background. Watched topics are listed first.',
    attachTo: { element: '[data-tour="tr-topics"]', on: 'top' },
    beforeShowPromise: check('tr-topics', '[data-tour="tr-topics"]'),
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'tr-results',
    title: 'Ranked stories and briefs',
    text: 'Open a topic to see its stories, best first. Tick the articles you want and write a research brief: the angle, the key facts with where each came from, gaps and an outline. It is notes for your own writing, and it is checked so it does not copy the sources.',
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'tr-draft',
    title: 'Turn a brief into a first draft',
    text: 'On a saved brief, press Draft article and choose a length. You get a first draft built from that brief only, with a source number on every factual paragraph and clear "needs your input" markers where the research has gaps. It is a starting point to edit and fact-check, and it warns if it repeats wording from a source.',
    when: { show() { injectStepCounter(5); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'tr-tabs',
    title: 'History and Settings',
    text: 'History lists every past search, brief and draft, newest first, with a search box. Settings holds your feeds, what your site is about, how results are ranked and your spending.',
    attachTo: { element: '[data-tour="tr-tabs"]', on: 'bottom' },
    beforeShowPromise: check('tr-tabs', '[data-tour="tr-tabs"]'),
    when: { show() { injectStepCounter(6); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'tr-spending',
    title: 'Spending limit',
    text: 'Paid searches, briefs and drafts cost a little. In Settings, set a monthly limit. When the estimate reaches it, paid searches, new briefs and new drafts pause and a banner tells you, until you raise the limit or the month ends. Amounts are estimates.',
    attachTo: { element: '[data-tour="tr-banner"]', on: 'bottom' },
    beforeShowPromise: check('tr-spending', '[data-tour="tr-banner"]'),
    when: { show() { injectStepCounter(7); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'tr-model',
    title: 'Which AI model writes briefs and drafts',
    text: 'Briefs and drafts are written by the AI model you choose in Vault Settings, under Topic Research, the same way as other tools. Leave it on the default to use the workspace model. Searching, reading and ranking use no model.',
    when: { show() { injectStepCounter(8); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'tr-limits',
    title: 'Good to know',
    text: 'Scores say what to look at first, not what is true. Page text is kept for 30 days, then cleared. A deleted topic can be brought back from the recycle bin. Stuck? Press the round button at the bottom right and ask the guide.',
    when: { show() { injectStepCounter(9); } },
    buttons: [
      btnBack(),
      { text: 'Finish Tour ✓', action() { try { localStorage.setItem(TOUR_KEY, '1'); } catch (_) { /* ignore */ } tour.complete(); } },
    ],
  });

  tour.on('cancel', () => { try { localStorage.setItem(TOUR_KEY, '1'); } catch (_) { /* ignore */ } });
  tour.start();
  return tour;
}
