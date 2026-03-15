import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_chains_completed';

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
      if (footer) el.insertBefore(counter, footer);
    }
    counter.textContent = `Step ${stepIndex} of ${TOTAL_STEPS}`;
  });
}

function safeBeforeShow(tour, stepId, selector) {
  return () =>
    new Promise((resolve) => {
      requestAnimationFrame(() => {
        const step = tour.getById(stepId);
        if (step && !document.querySelector(selector)) {
          step.updateStepOptions({ attachTo: {} });
        }
        resolve();
      });
    });
}

/**
 * Start the Prompt Chains product tour.
 * @param {Function} navigate - React Router navigate function
 * @returns {Shepherd.Tour}
 */
export function startChainsTour(navigate) {
  if (Shepherd.activeTour) {
    Shepherd.activeTour.cancel();
  }

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

  const btnSecondary = (text, action) => ({
    text,
    action,
    classes: 'vault-tour-btn-secondary',
  });

  const btnBack = () => btnSecondary('← Back', () => tour.back());
  const btnNext = { text: 'Next →', action: () => tour.next() };

  // ── Step 1: Welcome ───────────────────────────────────────────────────────
  tour.addStep({
    id: 'chains-welcome',
    title: 'Prompt Chains — Quick Tour',
    text: "Prompt Chains let you build reusable multi-step AI pipelines. Each step's output feeds into the next — perfect for complex workflows like content creation, code review, or data processing.",
    when: { show() { injectStepCounter(1); } },
    buttons: [
      btnSecondary('Skip Tour', () => tour.cancel()),
      { text: 'Start Tour →', action: () => tour.next() },
    ],
  });

  // ── Step 2: Chain list panel ──────────────────────────────────────────────
  tour.addStep({
    id: 'chains-list',
    title: 'Your Chain Library',
    text: "All your saved chains appear here. Click any chain to open it for editing. Use the <strong>+</strong> button to create a new chain from scratch, or pick from the ready-made starter templates.",
    attachTo: { element: '[data-tour="chains-list"]', on: 'right' },
    beforeShowPromise() {
      return new Promise((resolve) => {
        navigate('/chains');
        setTimeout(resolve, 600);
      });
    },
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 3: Editor toolbar ────────────────────────────────────────────────
  tour.addStep({
    id: 'chains-editor',
    title: 'Chain Editor',
    text: "When a chain is open, the toolbar shows its name and description. <strong>Save</strong> commits your changes. <strong>▶ Run</strong> executes the chain — you'll enter an initial prompt and watch each step stream its output in sequence.",
    attachTo: { element: '[data-tour="chains-editor-toolbar"]', on: 'bottom' },
    beforeShowPromise: safeBeforeShow(tour, 'chains-editor', '[data-tour="chains-editor-toolbar"]'),
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 4: Steps editor ──────────────────────────────────────────────────
  tour.addStep({
    id: 'chains-steps',
    title: 'Building Steps',
    text: "Each step has a <strong>label</strong>, a <strong>prompt</strong>, and a <strong>model</strong>. Add as many steps as you need. Use the arrows to reorder them. Each step can use a different AI model — mix Haiku for cheap steps with Opus for ones that need depth.",
    attachTo: { element: '[data-tour="chains-steps-editor"]', on: 'left' },
    beforeShowPromise: safeBeforeShow(tour, 'chains-steps', '[data-tour="chains-steps-editor"]'),
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 5: Template variables ────────────────────────────────────────────
  tour.addStep({
    id: 'chains-templates',
    title: 'Template Variables',
    text: "Use <code>{{input}}</code> for the initial prompt entered at run-time. Use <code>{{output}}</code> for the previous step's result. Use <code>{{step_1}}</code>, <code>{{step_2}}</code> etc. to reference any specific step — ideal for synthesis steps that combine earlier outputs.",
    attachTo: { element: '[data-tour="chains-template-hints"]', on: 'top' },
    beforeShowPromise: safeBeforeShow(tour, 'chains-templates', '[data-tour="chains-template-hints"]'),
    when: { show() { injectStepCounter(5); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 6: Run a chain ───────────────────────────────────────────────────
  tour.addStep({
    id: 'chains-run',
    title: 'Running a Chain',
    text: "Hit <strong>▶ Run</strong> to open the run dialog. Type your initial input and click <strong>Run Chain</strong> — each step streams its output as it completes. You can stop mid-run or run again with a different input. Results can be copied directly from the output.",
    attachTo: { element: '[data-tour="chains-run-btn"]', on: 'bottom' },
    beforeShowPromise: safeBeforeShow(tour, 'chains-run', '[data-tour="chains-run-btn"]'),
    when: { show() { injectStepCounter(6); } },
    buttons: [
      btnBack(),
      {
        text: 'Finish Tour ✓',
        action() {
          localStorage.setItem(TOUR_KEY, '1');
          tour.complete();
        },
      },
    ],
  });

  tour.on('cancel', () => {
    localStorage.setItem(TOUR_KEY, '1');
  });

  tour.start();
  return tour;
}
