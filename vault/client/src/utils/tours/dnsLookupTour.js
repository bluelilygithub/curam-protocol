import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_dns_lookup_completed';

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
      if (footer) el.insertBefore(counter, footer);
    }
    counter.textContent = `Step ${stepIndex} of ${TOTAL_STEPS}`;
  });
}

// The answer area only exists after a lookup: if a part of the page this step points at is missing, show the step in the middle of the screen.
function safeBeforeShow(tour, stepId, selector) {
  if (!document.querySelector(selector)) {
    const step = tour.getById(stepId);
    if (step) step.options.attachTo = undefined;
  }
}

export function startDnsLookupTour() {
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
    id: 'dns-welcome',
    title: 'DNS Lookup — Quick Tour',
    text: 'DNS is the internet\'s phone book. This page asks a public resolver what a name points to, and checks that a domain\'s email records look right. It only reads; it never changes anything.',
    when: { show() { injectStepCounter(1); } },
    buttons: [btnSecondary('Skip Tour', () => tour.cancel()), { text: 'Start Tour →', action: () => tour.next() }],
  });

  tour.addStep({
    id: 'dns-name',
    title: 'Type a name',
    text: 'Type a domain (example.com), a web address or an IP address. An IP address gives the name it belongs to. Choose which kinds of record you want and who to ask, then press Look up.',
    attachTo: { element: '[data-tour="dns-name"]', on: 'bottom' },
    beforeShowPromise: check('dns-name', '[data-tour="dns-name"]'),
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'dns-compare',
    title: 'Compare Cloudflare and Google',
    text: 'Compare both asks the two big resolvers the same question and says whether they agree. After you change a record, different answers usually mean the change is still spreading. It settles by itself.',
    attachTo: { element: '[data-tour="dns-compare"]', on: 'bottom' },
    beforeShowPromise: check('dns-compare', '[data-tour="dns-compare"]'),
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'dns-email',
    title: 'Check email setup',
    text: 'Type a domain here to read its mail records. Each finding is marked good, worth a look or a problem, in plain words. It cannot tell whether an email will really arrive.',
    attachTo: { element: '[data-tour="dns-email"]', on: 'top' },
    beforeShowPromise: check('dns-email', '[data-tour="dns-email"]'),
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'dns-limits',
    title: 'Good to know',
    text: 'Answers can be out of date for a while after a change, because resolvers keep an answer for its time to live (TTL). Nothing is saved, and records are changed where the domain is managed, such as Cloudflare. Stuck? Press the round button at the bottom right and ask the guide.',
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
