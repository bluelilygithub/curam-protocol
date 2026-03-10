import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_goals_completed';

const TOTAL_STEPS = 8;

function injectStepCounter(stepIndex) {
  // Wait a tick for Shepherd to insert its DOM
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

/**
 * Start the Goals & 7 Habits product tour.
 * @param {Function} navigate - React Router navigate function
 * @returns {Shepherd.Tour}
 */
export function startGoalsTour(navigate) {
  // Clean up any existing tour
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

  // ── Step 1: Welcome (centred, no attachment) ──────────────────────────────
  tour.addStep({
    id: 'welcome',
    title: 'Goals & 7 Habits — Quick Tour',
    text: "This 2-minute tour shows you how to turn what matters most into measurable progress. We'll cover Mission Statement, Renewal Balance, Objectives & Key Results, and the Eisenhower Matrix.",
    when: { show() { injectStepCounter(1); } },
    buttons: [
      btnSecondary('Skip Tour', () => tour.cancel()),
      { text: 'Start Tour →', action: () => tour.next() },
    ],
  });

  // ── Step 2: 7 Habits Sidebar ──────────────────────────────────────────────
  tour.addStep({
    id: 'habits-sidebar',
    title: '7 Habits Quick Access',
    text: 'These three links are your shortcuts. Mission is your north star. Matrix shows your priorities. Renewal tracks your life balance. Everything connects here.',
    attachTo: { element: '[data-tour="habits-sidebar"]', on: 'right' },
    beforeShowPromise() {
      return new Promise((resolve) => {
        // Expand the 7 Habits sidebar section if collapsed
        document.dispatchEvent(new CustomEvent('vault:expand-habits-sidebar'));
        setTimeout(resolve, 400);
      });
    },
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 3: Navigate to Goals — Mission Statement ─────────────────────────
  tour.addStep({
    id: 'mission-statement',
    title: 'Personal Mission Statement — Habit 2',
    text: 'This is your compass. Before setting any goal, write your Mission Statement. Click "Write with Claude" and answer 4 questions — Claude generates your statement live.',
    attachTo: { element: '[data-tour="mission-card"]', on: 'bottom' },
    beforeShowPromise() {
      return new Promise((resolve) => {
        navigate('/goals');
        setTimeout(resolve, 700);
      });
    },
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 4: Renewal Balance ───────────────────────────────────────────────
  tour.addStep({
    id: 'renewal-balance',
    title: 'Renewal Balance — Habit 7',
    text: 'Track how your tasks and objectives are spread across Physical 🏃, Mental 📚, Social 🤝, and Spiritual 🌱 dimensions. If one is always zero — that\'s the insight.',
    attachTo: { element: '[data-tour="renewal-balance"]', on: 'bottom' },
    beforeShowPromise() {
      return new Promise((resolve) => {
        // Expand the Renewal Balance section if collapsed
        document.dispatchEvent(new CustomEvent('vault:expand-renewal-balance'));
        setTimeout(resolve, 350);
      });
    },
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 5: New Objective ─────────────────────────────────────────────────
  tour.addStep({
    id: 'new-objective',
    title: 'Create an Objective',
    text: 'Objectives are what you want to achieve. Keep them outcome-focused: "Grow client base in Q2" not "Do more sales". Add a timeframe and colour to keep things organised.',
    attachTo: { element: '[data-tour="new-objective"]', on: 'bottom' },
    when: { show() { injectStepCounter(5); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 6: AI Suggest Key Results ───────────────────────────────────────
  tour.addStep({
    id: 'ai-suggest',
    title: 'AI-Suggested Key Results',
    text: "Not sure what to measure? Select an objective, then click AI Suggest in the Key Results toolbar — Claude generates SMART targets tailored to your objective. One click adds them directly.",
    attachTo: { element: '[data-tour="objectives-panel"]', on: 'left' },
    when: { show() { injectStepCounter(6); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 7: Navigate to Tasks — Eisenhower Matrix ────────────────────────
  tour.addStep({
    id: 'matrix-view',
    title: 'Eisenhower Matrix — Habit 3',
    text: 'Plot your tasks by importance vs urgency. Q2 (important, not urgent) is where real progress lives. Mark tasks urgent with the ⚡ toggle in the task form.',
    attachTo: { element: '[data-tour="matrix-grid"]', on: 'top' },
    beforeShowPromise() {
      return new Promise((resolve) => {
        navigate('/tasks?view=matrix');
        setTimeout(resolve, 900);
      });
    },
    when: { show() { injectStepCounter(7); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 8: Weekly Review ────────────────────────────────────────────────
  tour.addStep({
    id: 'weekly-review',
    title: 'Weekly Review — The Glue',
    text: 'Run this every Friday. 3 steps: review wins, clear overdue tasks, plan the week ahead. Vault shows your Renewal balance and Goal progress inline.',
    attachTo: { element: '[data-tour="weekly-review-btn"]', on: 'bottom' },
    beforeShowPromise() {
      return new Promise((resolve) => {
        navigate('/tasks');
        setTimeout(resolve, 700);
      });
    },
    when: { show() { injectStepCounter(8); } },
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

  // Mark complete on cancel too (so auto-start doesn't fire again)
  tour.on('cancel', () => {
    localStorage.setItem(TOUR_KEY, '1');
  });

  tour.start();
  return tour;
}
