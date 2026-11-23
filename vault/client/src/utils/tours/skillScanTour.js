import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_skill_scan_completed';

const TOTAL_STEPS = 4;

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
// goTool(id) shows that part of the page first ('scan', 'report', 'history').
export function startSkillScanTour(goTool = () => {}) {
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
    setTimeout(() => { safeBeforeShow(tour, stepId, selector); resolve(); }, tool ? 300 : 0);
  });

  tour.addStep({
    id: 'skill-scan-welcome',
    title: 'Skill Scanner — Quick Tour',
    text: 'Check an AI agent skill or plugin for security risks before you install it. The scanner is NVIDIA’s SkillSpector: it reads the files and never runs them.',
    when: { show() { injectStepCounter(1); } },
    buttons: [btnSecondary('Skip Tour', () => tour.cancel()), { text: 'Start Tour →', action: () => tour.next() }],
  });

  tour.addStep({
    id: 'skill-scan-scan',
    title: 'Scan a skill',
    text: 'Paste a public github.com link, or upload a zip of a plugin folder from your computer. Tick "Scan each skill separately" for a repository with several skills, and Deep scan to have an AI model read the files too (slower, and the files go to Anthropic).',
    attachTo: { element: '[data-tour="skill-scan-scan"]', on: 'bottom' },
    beforeShowPromise: check('skill-scan-scan', '[data-tour="skill-scan-scan"]', 'scan'),
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'skill-scan-report',
    title: 'Read the report',
    text: 'Safe, Caution or Do not install, a score out of 100, and every finding with its file, line, explanation and fix. A Safe verdict means no known risky pattern was found, not a guarantee.',
    attachTo: { element: '[data-tour="skill-scan-report"]', on: 'top' },
    beforeShowPromise: check('skill-scan-report', '[data-tour="skill-scan-report"]', 'report'),
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'skill-scan-history',
    title: 'Saved scans',
    text: 'Every scan you ran, newest first. Open one again, or delete it: it goes to the recycle bin for 30 days.',
    attachTo: { element: '[data-tour="skill-scan-history"]', on: 'top' },
    beforeShowPromise: check('skill-scan-history', '[data-tour="skill-scan-history"]', 'history'),
    when: { show() { injectStepCounter(4); } },
    buttons: [
      btnBack(),
      { text: 'Finish Tour ✓', action() { try { localStorage.setItem(TOUR_KEY, '1'); } catch (_) { /* ignore */ } tour.complete(); } },
    ],
  });

  tour.on('cancel', () => { try { localStorage.setItem(TOUR_KEY, '1'); } catch (_) { /* ignore */ } });
  tour.start();
  return tour;
}
