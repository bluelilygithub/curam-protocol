import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_youtube_completed';

const TOTAL_STEPS = 7;

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

// If a part of the page this step points at is missing, show the step in the middle of the screen instead.
function safeBeforeShow(tour, stepId, selector) {
  if (!document.querySelector(selector)) {
    const step = tour.getById(stepId);
    if (step) step.options.attachTo = undefined;
  }
}

export function startYoutubeTour() {
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
    id: 'yt-welcome',
    title: 'YouTube — Quick Tour',
    text: 'Find videos, watch them here, and pull the useful parts out of them: AI notes with times you can click, answers to your questions, and a one-press save to Notes.',
    when: { show() { injectStepCounter(1); } },
    buttons: [btnSecondary('Skip Tour', () => tour.cancel()), { text: 'Start Tour →', action: () => tour.next() }],
  });

  tour.addStep({
    id: 'yt-search',
    title: 'Search or describe',
    text: 'Type a topic, or describe what you want in your own words, like "short recent videos about sourdough". Vault works out the filters and shows you what it understood. The microphone searches by speaking.',
    attachTo: { element: '[data-tour="yt-search"]', on: 'bottom' },
    beforeShowPromise: check('yt-search', '[data-tour="yt-search"]'),
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'yt-filters',
    title: 'Sort and filter',
    text: 'Sort by relevance, newest, most viewed or top rated, and narrow by length and date. Tick Live now for streams that are on right now. Each new search uses part of YouTube\'s daily allowance; searching for the same thing again is free.',
    attachTo: { element: '[data-tour="yt-filters"]', on: 'bottom' },
    beforeShowPromise: check('yt-filters', '[data-tour="yt-filters"]'),
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'yt-playlist',
    title: 'Open a whole playlist',
    text: 'Paste a playlist address (or just its id) here to see all its videos in order.',
    attachTo: { element: '[data-tour="yt-playlist"]', on: 'bottom' },
    beforeShowPromise: check('yt-playlist', '[data-tour="yt-playlist"]'),
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'yt-tabs',
    title: 'Results, Trending and your own collections',
    text: 'Results holds this search. Trending shows what is popular by country and category. Favourites are videos you saved. History keeps your searches (press Re-run to repeat one) and what you watched. Lists are whole result sets you saved under a name.',
    attachTo: { element: '[data-tour="yt-tabs"]', on: 'bottom' },
    beforeShowPromise: check('yt-tabs', '[data-tour="yt-tabs"]'),
    when: { show() { injectStepCounter(5); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'yt-study',
    title: 'Insights & Ask',
    text: 'Click any video to watch it. Under the player, Insights & Ask writes notes on it (summary, key points, chapters, things to do, quotes) with times you can click to jump the video, lets you ask it questions, and saves the notes to Notes, optionally under a project or client. It all comes from the video\'s captions, so a video with no captions cannot be done.',
    when: { show() { injectStepCounter(6); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'yt-limits',
    title: 'Good to know',
    text: 'The notes and answers are written by AI and can contain mistakes, so check anything important against the video. Vault never downloads videos. The Transcript button has a Timestamps view and a language list. Stuck? Press the round button at the bottom right and ask the guide.',
    when: { show() { injectStepCounter(7); } },
    buttons: [
      btnBack(),
      { text: 'Finish Tour ✓', action() { try { localStorage.setItem(TOUR_KEY, '1'); } catch (_) { /* ignore */ } tour.complete(); } },
    ],
  });

  tour.on('cancel', () => { try { localStorage.setItem(TOUR_KEY, '1'); } catch (_) { /* ignore */ } });
  tour.start();
  return tour;
}
