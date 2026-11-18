import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

// Compass tour for the admin Code Map (pages/CodeMapPage.jsx). goView(id) switches the page's tab.

export const TOUR_KEY = 'vault_tour_code_map_completed';

const TOTAL_STEPS = 10;

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

export function startCodeMapTour(goView) {
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

  const done = () => { try { localStorage.setItem(TOUR_KEY, '1'); } catch (_) { /* ignore */ } };
  const btnSecondary = (text, action) => ({ text, action, classes: 'vault-tour-btn-secondary' });
  const btnBack = () => btnSecondary('← Back', () => tour.back());
  const btnNext = { text: 'Next →', action: () => tour.next() };
  const showView = (view, stepId, selector) => () => new Promise((resolve) => {
    goView(view);
    setTimeout(() => { safeBeforeShow(tour, stepId, selector); resolve(); }, 450);
  });
  const step = (n, id, title, text, selector, on, view) => tour.addStep({
    id,
    title,
    text,
    ...(selector ? { attachTo: { element: selector, on } } : {}),
    ...(view ? { beforeShowPromise: showView(view, id, selector) } : {}),
    when: { show() { injectStepCounter(n); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'cm-welcome',
    title: 'Code Map — Quick Tour',
    text: "Code Map reads Vault's own source code on the server and shows every tool, the code it owns, how it follows the rules in CLAUDE.md, and what to improve first. It only reads; it never changes code.",
    when: { show() { injectStepCounter(1); } },
    buttons: [btnSecondary('Skip Tour', () => tour.cancel()), { text: 'Start Tour →', action: () => tour.next() }],
  });
  step(2, 'cm-run', 'Run an analysis', 'Press Run analysis to read the code as it is now (a few seconds). The line beside it says when the last run was, how long it took and which commit it saw. The last 30 runs are kept.', '[data-tour="cm-run"]', 'bottom');
  step(3, 'cm-overview', 'What to improve', 'Findings are ranked: high first, then by how many tools they touch. Each names the tools (click one to open it) and has the file and line evidence. High findings also go to your Suggestions inbox, once per tool.', '[data-tour="cm-findings"]', 'bottom', 'overview');
  step(4, 'cm-tools', 'Tools', 'One card per tool in the menu: its rules score, size, tests, and a dot per rule (green follows, amber check, red gap, grey not applicable). Filter, sort, and click a card for the detail.', '[data-tour="cm-tools-filter"]', 'bottom', 'tools');
  step(5, 'cm-conventions', 'Conventions', 'Every tool against every rule. Hover a rule name for why it matters, and click a cell to see the note and evidence underneath.', '[data-tour="cm-matrix"]', 'top', 'conventions');
  step(6, 'cm-map', 'Dependency map', "Circles are tools (bigger means more code, colour is the score). Solid lines are API calls, dashed lines shared code files. Click a tool to highlight its links and again to open it.", '[data-tour="cm-map"]', 'top', 'map');
  step(7, 'cm-structure', 'Structure', 'The code as a whole: largest files, import cycles, modules most tools depend on, separate packages, and files that look unused (check before deleting).', '[data-tour="cm-cycles"]', 'top', 'structure');
  step(8, 'cm-changes', 'Changes', 'Pick two runs (the latest and the one before by default) to see new and resolved findings, findings that got worse, and each tool\'s score movement, worst first. A run also happens by itself every Sunday at 3:17 am.', '[data-tour="cm-changes"]', 'bottom', 'changes');
  step(9, 'cm-context', 'Context', 'Build briefing makes a description of how Vault is built (tools, rules, building blocks, recent changes, outside services as YES or NO) to paste into a new Claude conversation before designing the next tool. Add your own notes for Claude, and copy CLAUDE.md with the docs it links to at the bottom. It never includes what is in your tools.', '[data-tour="cm-context"]', 'bottom', 'context');
  tour.addStep({
    id: 'cm-end',
    title: 'Reading a check',
    text: 'The checks are pattern matches, not proof. Amber means worth a look; a red gap can still be a false positive. The (i) button explains each part, and docs/code-map.md lists the known false positives.',
    when: { show() { injectStepCounter(10); } },
    buttons: [btnBack(), { text: 'Finish Tour ✓', action() { done(); tour.complete(); } }],
  });

  tour.on('cancel', done);
  tour.start();
  return tour;
}
