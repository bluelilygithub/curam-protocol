import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_bip_completed';

const TOTAL_STEPS = 5;

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

function safeBeforeShow(tour, stepId, selector) {
  if (!document.querySelector(selector)) {
    const step = tour.getById(stepId);
    if (step) step.options.attachTo = undefined;
  }
}

// goTool(id) switches the page to a tool ('start' = the job tiles), so each step can show its part of the page first.
export function startBipTour(goTool = () => {}) {
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
  const check = (stepId, selector, tool) => () => new Promise((resolve) => {
    if (tool) goTool(tool);
    setTimeout(() => { safeBeforeShow(tour, stepId, selector); resolve(); }, tool ? 350 : 0);
  });

  tour.addStep({
    id: 'bip-welcome',
    title: 'Business Profiler — Quick Tour',
    text: 'BIP gathers public information about a business from its domain into one saved profile. It reads registration, DNS, the website and the sources this server has keys for. It shows where sources disagree; it never guesses. The page opens on job tiles; the list on the left has every tool.',
    attachTo: { element: '[data-tour="bip-jobs"]', on: 'bottom' },
    beforeShowPromise: check('bip-welcome', '[data-tour="bip-jobs"]', 'start'),
    when: { show() { injectStepCounter(1); } },
    buttons: [btnSecondary('Skip Tour', () => tour.cancel()), { text: 'Start Tour →', action: () => tour.next() }],
  });

  tour.addStep({
    id: 'bip-search',
    title: 'Profile a domain',
    text: 'Type a domain such as example.com and press Profile. The work runs in the background; the page shows progress until the report is ready. A domain profiled in the last 30 days opens its saved report instead.',
    attachTo: { element: '[data-tour="bip-search"]', on: 'bottom' },
    beforeShowPromise: check('bip-search', '[data-tour="bip-search"]', 'search'),
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'bip-profiles',
    title: 'Saved profiles',
    text: 'Every profile you make is a tile here, newest first. Open one to see all seven cards (they need a profile open, so with none open this step just points at the list). Profiles stay until you delete them; a deleted one goes to the recycle bin.',
    attachTo: { element: '[data-tour="bip-profiles"]', on: 'top' },
    beforeShowPromise: check('bip-profiles', '[data-tour="bip-profiles"]', 'profiles'),
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'bip-cards',
    title: 'Read the report',
    text: 'The full profile has Entity Overview, People, Locations, Products & Services, Digital Footprint, Online Presence & Reputation and Financial Indicators. Financial figures are labelled estimates from public sources; blanks mean nothing was found.',
    attachTo: { element: '[data-tour="bip-cards"]', on: 'top' },
    beforeShowPromise: check('bip-cards', '[data-tour="bip-cards"]', 'profile'),
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'bip-review',
    title: 'Confidence, refresh and export',
    text: '✅ means two or more sources agree, ⚠️ means one source, and ❌ means they disagree. All values stay visible; you can record your own decision. Re-scan & sources refreshes everything or one source; Keep & share has the PDF and Save to Note & Client.',
    attachTo: { element: '[data-tour="bip-review"]', on: 'top' },
    beforeShowPromise: check('bip-review', '[data-tour="bip-review"]', 'conflicts'),
    when: { show() { injectStepCounter(5); } },
    buttons: [
      btnBack(),
      { text: 'Finish Tour ✓', action() { try { localStorage.setItem(TOUR_KEY, '1'); } catch (_) { /* ignore */ } tour.complete(); } },
    ],
  });

  tour.on('cancel', () => { try { localStorage.setItem(TOUR_KEY, '1'); } catch (_) { /* ignore */ } });
  tour.start();
  return tour;
}
