import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_measurements_completed';

const TOTAL_STEPS = 8;

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

/** goTab(tabId) switches the Measurements page tab (convert | formulas | scan). */
export function startMeasurementsTour(goTab) {
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
    id: 'measure-welcome',
    title: 'Measurements — Quick Tour',
    text: 'Convert any measurement, see the exact formula behind it, and scan a PDF or photo for measurements to convert. Every input has a microphone, so you can speak instead of type.',
    when: { show() { injectStepCounter(1); } },
    buttons: [btnSecondary('Skip Tour', () => tour.cancel()), { text: 'Start Tour →', action: () => tour.next() }],
  });

  tour.addStep({
    id: 'measure-say',
    title: 'Say it — a whole conversion',
    text: 'Click the microphone and say something like “five feet eleven in centimetres” or “two cups of flour in grams”. You see what was understood first, then click Use this to fill in the converter.',
    attachTo: { element: '[data-tour="measure-say"]', on: 'bottom' },
    beforeShowPromise: showTab('convert', 'measure-say', '[data-tour="measure-say"]'),
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'measure-groups',
    title: 'Pick what you are measuring',
    text: 'Length, volume, mass, temperature, cooking and more. Metric is first; US and imperial units are all there, with US and imperial gallons kept separate.',
    attachTo: { element: '[data-tour="measure-groups"]', on: 'bottom' },
    beforeShowPromise: showTab('convert', 'measure-groups', '[data-tour="measure-groups"]'),
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'measure-value',
    title: 'Value and units',
    text: 'Type or speak the value, then choose the units — you can search them or say their name. Feet + inches and stones + pounds show two boxes. Cups and spoons follow your cup standard (Australian by default).',
    attachTo: { element: '[data-tour="measure-value"]', on: 'bottom' },
    beforeShowPromise: showTab('convert', 'measure-value', '[data-tour="measure-value"]'),
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'measure-result',
    title: 'The result and its formula',
    text: 'The answer updates live, with the formula used and a link to its full entry — factor, source and example. Below it you get the value in every unit of that kind, and your recent conversions.',
    attachTo: { element: '[data-tour="measure-result"]', on: 'top' },
    beforeShowPromise: showTab('convert', 'measure-result', '[data-tour="measure-result"]'),
    when: { show() { injectStepCounter(5); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'measure-formulas',
    title: 'Formula library',
    text: 'Browse or search every unit and the formula behind it. Filter by type (factor, offset, inverse, lookup) or system, and try a value right inside any entry.',
    attachTo: { element: '[data-tour="formula-search"]', on: 'bottom' },
    beforeShowPromise: showTab('formulas', 'measure-formulas', '[data-tour="formula-search"]'),
    when: { show() { injectStepCounter(6); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'measure-scan',
    title: 'Document scanner',
    text: 'Drop a PDF, photo or screenshot, or paste text. Vault finds measurements — fractions, ranges, sizes like 1200 × 600 × 18 mm, table columns — and proposes conversions. Unclear ones are flagged and nothing changes until you accept it.',
    attachTo: { element: '[data-tour="measure-scan-drop"]', on: 'bottom' },
    beforeShowPromise: showTab('scan', 'measure-scan', '[data-tour="measure-scan-drop"]'),
    when: { show() { injectStepCounter(7); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'measure-privacy',
    title: 'Private by default',
    text: 'Documents are read on this device — nothing you scan is uploaded. Scanned pages use text recognition that runs in the background, and you can cancel it any time. Review each find, correct it by typing or speaking, then export converted text, a CSV, or an annotated PDF.',
    when: { show() { injectStepCounter(8); } },
    buttons: [
      btnBack(),
      { text: 'Finish Tour ✓', action() { try { localStorage.setItem(TOUR_KEY, '1'); } catch (_) { /* ignore */ } tour.complete(); } },
    ],
  });

  tour.on('cancel', () => { try { localStorage.setItem(TOUR_KEY, '1'); } catch (_) { /* ignore */ } });
  tour.start();
  return tour;
}
