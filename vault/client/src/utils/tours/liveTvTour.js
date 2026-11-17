import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_live_tv_completed';

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
      if (footer && footer.parentNode) footer.parentNode.insertBefore(counter, footer);
    }
    counter.textContent = `Step ${stepIndex} of ${TOTAL_STEPS}`;
  });
}

// If a part of the page this step points at is missing (the list is still loading), show the step in the middle of the screen.
function safeBeforeShow(tour, stepId, selector) {
  if (!document.querySelector(selector)) {
    const step = tour.getById(stepId);
    if (step) step.options.attachTo = undefined;
  }
}

export function startLiveTvTour() {
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
    id: 'tv-welcome',
    title: 'Live TV — Quick Tour',
    text: 'Free TV channels from around the world, from the public iptv-org list. Your browser plays them straight from the broadcaster; Vault never stores or passes on any video.',
    when: { show() { injectStepCounter(1); } },
    buttons: [btnSecondary('Skip Tour', () => tour.cancel()), { text: 'Start Tour →', action: () => tour.next() }],
  });

  tour.addStep({
    id: 'tv-filters',
    title: 'Find a channel',
    text: 'All, Favourites or Recent channels; narrow All by country, kind (news, sport, music …) or name. Programmes searches the TV guide, and My shows lists the programmes you starred.',
    attachTo: { element: '[data-tour="live-tv-filters"]', on: 'bottom' },
    beforeShowPromise: check('tv-filters', '[data-tour="live-tv-filters"]'),
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'tv-list',
    title: 'The channel list',
    text: 'Press a channel to play it, or its star to keep it in Favourites. A row says when a channel needs VLC, and whether it played for you last time.',
    attachTo: { element: '[data-tour="live-tv-list"]', on: 'right' },
    beforeShowPromise: check('tv-list', '[data-tour="live-tv-list"]'),
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'tv-player',
    title: 'Watch',
    text: 'The channel plays here (press the speaker if it starts muted). If it does not start, try its other links underneath, or Open in VLC, a free player that plays more of them.',
    attachTo: { element: '[data-tour="live-tv-player"]', on: 'left' },
    beforeShowPromise: check('tv-player', '[data-tour="live-tv-player"]'),
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'tv-guide',
    title: 'TV guide',
    text: 'Under the picture: what is on today and for the next week, with ON NOW on the current programme. Press a programme for its details, or its star to follow the show in My shows. The free guide covers Australian free-to-air and some streaming channels.',
    attachTo: { element: '[data-tour="live-tv-guide"]', on: 'left' },
    beforeShowPromise: check('tv-guide', '[data-tour="live-tv-guide"]'),
    when: { show() { injectStepCounter(5); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'tv-limits',
    title: 'Good to know',
    text: 'Many links stop working or are only shown in their own country, so expect some to fail. Adult channels and ones removed after a copyright complaint are always left out. Stuck? Press the round button at the bottom right and ask the guide.',
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
