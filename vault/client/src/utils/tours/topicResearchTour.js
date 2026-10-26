import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_topic_research_completed';

const TOTAL_STEPS = 14;

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
    id: 'tr-workflow',
    title: 'Where you are',
    text: 'This bar shows the four stages of the work: Search, Results, Brief and Draft. The one you are on is filled, and every stage that exists is a tab you can click. On a brief or draft the bar stays at the top while you scroll, with the buttons you need next. While a search, brief or draft runs, a box lists each step as it really happens, so you can see where it is up to.',
    attachTo: { element: '[data-tour="tr-workflow"]', on: 'bottom' },
    beforeShowPromise: check('tr-workflow', '[data-tour="tr-workflow"]'),
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'tr-search',
    title: 'Search a topic',
    text: 'Type a topic and press Search. It asks your sources, reads the best pages, groups articles about the same story and ranks the stories. It can take up to half a minute.',
    attachTo: { element: '[data-tour="tr-search"]', on: 'bottom' },
    beforeShowPromise: check('tr-search', '[data-tour="tr-search"]'),
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'tr-links',
    title: 'Link it to a client or project',
    text: 'Under the search box you can choose which client and project a topic is for. Its briefs and drafts follow, and the topic then shows on that client\'s and project\'s own pages under Research. You can change it later from the topic\'s results page.',
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'tr-suggest',
    title: 'Find the trade\'s words',
    text: 'People search in everyday words, but manufacturers and trade writers use their own, so the best articles may never use yours. Type a topic and press Suggest industry terms: the AI model offers up to three other phrasings. Tick the ones to search as well. Nothing is searched until you press Search.',
    attachTo: { element: '[data-tour="tr-suggest"]', on: 'bottom' },
    beforeShowPromise: check('tr-suggest', '[data-tour="tr-suggest"]'),
    when: { show() { injectStepCounter(5); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'tr-topics',
    title: 'Your saved topics',
    text: 'Every topic you search is saved here. Tick Watch on one and choose how often it refreshes, and it searches by itself in the background. Watched topics are listed first.',
    attachTo: { element: '[data-tour="tr-topics"]', on: 'top' },
    beforeShowPromise: check('tr-topics', '[data-tour="tr-topics"]'),
    when: { show() { injectStepCounter(6); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'tr-results',
    title: 'Ranked stories and briefs',
    text: 'Open a topic to see its stories, best first. Shop pages are badged and scored lower. Tick the articles you want and write a research brief. A quick source check first warns you if they are not really about your topic. The brief gives you: the angle, the key facts with where each came from, gaps and an outline. It is notes for your own writing, and it is checked so it does not copy the sources.',
    when: { show() { injectStepCounter(7); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'tr-prompts',
    title: 'See what the AI was asked',
    text: 'Nothing is hidden. The results page lists the words every source was searched for and any source that was not used, and why. On a brief, a draft, a source check or the suggestions, the What the AI was asked panel shows the exact prompt that was sent, so you can see why an answer came out as it did.',
    when: { show() { injectStepCounter(8); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'tr-draft',
    title: 'Turn a brief into a first draft',
    text: 'On a saved brief, press Draft article and choose a length. You get a first draft built from that brief only, with a source number on every factual paragraph and clear "needs your input" markers where the research has gaps. It is a starting point to edit and fact-check, and it warns if it repeats wording from a source.',
    when: { show() { injectStepCounter(9); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'tr-review',
    title: 'Get a second opinion',
    text: 'On a draft, the Structure verdict asks another AI model how it would structure the essay. It reads your brief and the draft\'s backbone (what is sourced, what still needs your input), never the articles\' text. Choose the model in Settings; a different one from the writer gives a truer second opinion. You can also copy the request and paste it into any AI yourself.',
    when: { show() { injectStepCounter(10); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'tr-tabs',
    title: 'History and Settings',
    text: 'History lists every past search, brief and draft, newest first, with a search box. Settings holds your feeds, what your site is about, how results are ranked and your spending.',
    attachTo: { element: '[data-tour="tr-tabs"]', on: 'bottom' },
    beforeShowPromise: check('tr-tabs', '[data-tour="tr-tabs"]'),
    when: { show() { injectStepCounter(11); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'tr-spending',
    title: 'Spending limit',
    text: 'Paid searches, briefs and drafts cost a little. In Settings, set a monthly limit. When the estimate reaches it, paid searches, new briefs and new drafts pause and a banner tells you, until you raise the limit or the month ends. Amounts are estimates.',
    attachTo: { element: '[data-tour="tr-banner"]', on: 'bottom' },
    beforeShowPromise: check('tr-spending', '[data-tour="tr-banner"]'),
    when: { show() { injectStepCounter(12); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'tr-model',
    title: 'Which AI model writes briefs and drafts',
    text: "Briefs and drafts are written by the AI model you choose in Vault Settings, under Topic Research, the same way as other tools. Leave it on the default to use the workspace model. Quick source checks and suggestions use the workspace's cheaper model. Searching, reading and ranking use none.",
    when: { show() { injectStepCounter(13); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'tr-limits',
    title: 'Good to know',
    text: 'Scores say what to look at first, not what is true. Page text is kept for 30 days, then cleared. A deleted topic can be brought back from the recycle bin. Stuck? Press the round button at the bottom right and ask the guide.',
    when: { show() { injectStepCounter(14); } },
    buttons: [
      btnBack(),
      { text: 'Finish Tour ✓', action() { try { localStorage.setItem(TOUR_KEY, '1'); } catch (_) { /* ignore */ } tour.complete(); } },
    ],
  });

  tour.on('cancel', () => { try { localStorage.setItem(TOUR_KEY, '1'); } catch (_) { /* ignore */ } });
  tour.start();
  return tour;
}
