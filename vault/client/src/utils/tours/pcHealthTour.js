import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_pc_health_completed';

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
      if (footer) el.insertBefore(counter, footer);
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

/** goTab(tabId) switches the PC Health page tool (see pcHealthTools.mjs). */
export function startPcHealthTour(goTab) {
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
  const showTab = (tab, stepId, selector) => () => new Promise((resolve) => {
    goTab(tab);
    setTimeout(() => { safeBeforeShow(tour, stepId, selector); resolve(); }, 450);
  });

  tour.addStep({
    id: 'pch-welcome',
    title: 'PC Health — Quick Tour',
    text: 'Check your own computer for a full disk, memory or processor problems, large or growing files and logs left behind. It only reports. It never deletes or changes anything.',
    when: { show() { injectStepCounter(1); } },
    buttons: [btnSecondary('Skip Tour', () => tour.cancel()), { text: 'Start Tour →', action: () => tour.next() }],
  });

  tour.addStep({
    id: 'pch-menu',
    title: 'The tool list',
    text: 'Report has the overview and the scan button. Findings splits the report into disk, large files, logs and leftovers, growth, and memory and processor. Hover any item for a plain explanation, and use the search box (or its microphone) to jump to one.',
    attachTo: { element: '[data-tour="pc-health-menu"]', on: 'right' },
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'pch-helper',
    title: 'First, the helper',
    text: 'Vault runs on the internet and cannot see inside your PC. A small read-only helper runs on your PC and does the looking. Download it, make its key, and run the one command shown. You do this once.',
    attachTo: { element: '[data-tour="pch-helper-steps"]', on: 'top' },
    beforeShowPromise: showTab('helper', 'pch-helper', '[data-tour="pch-helper-steps"]'),
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'pch-scan',
    title: 'Run a scan',
    text: 'Choose the usual places (quick) or the whole drive (slow), then press Run a scan. The helper picks it up within 30 seconds, looks at your PC and sends the report back. You can type or speak the settings.',
    attachTo: { element: '[data-tour="pch-scan-options"]', on: 'bottom' },
    beforeShowPromise: showTab('scan', 'pch-scan', '[data-tour="pch-scan-options"]'),
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'pch-overview',
    title: 'The overview',
    text: 'Findings are marked High or Watch by fixed rules, most important first, each with what was found and why it matters. Press More info on a finding for what it is and what you could do, and Copy location to look at a file yourself in File Explorer. Copy report puts the whole report on your clipboard as text.',
    attachTo: { element: '[data-tour="pch-overview"]', on: 'top' },
    beforeShowPromise: showTab('overview', 'pch-overview', '[data-tour="pch-overview"]'),
    when: { show() { injectStepCounter(5); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'pch-growth',
    title: 'Growth',
    text: 'Each scan is compared with your previous one, so folders that keep getting bigger show up here, with how much per day. The first scan has nothing to compare with.',
    attachTo: { element: '[data-tour="pch-tab-growth"]', on: 'right' },
    when: { show() { injectStepCounter(6); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'pch-guide',
    title: 'Ask the guide',
    text: 'Not sure where something is? Press the round button at the bottom right and say what you want to know. The guide points you to the right tool. It cannot see your results, and PC Health never fixes anything for you.',
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
