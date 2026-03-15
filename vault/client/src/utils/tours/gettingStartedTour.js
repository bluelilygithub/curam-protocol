import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css'; // shared vault-tour styles

export const TOUR_KEY = 'vault_tour_getting_started_completed';

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

function safeAttach(tour, stepId, selector) {
  const el = document.querySelector(selector);
  if (!el) {
    const step = tour.getById(stepId);
    if (step) step.options.attachTo = undefined;
  }
}

/**
 * Start the Getting Started Wizard preparation tour.
 * This tour prepares the user before they run the wizard — it does NOT open the wizard.
 * @param {Function} navigate - React Router navigate function
 * @returns {Shepherd.Tour}
 */
export function startGettingStartedTour(navigate) {
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

  // ── Step 1: Before You Begin (floating) ────────────────────────────────────
  tour.addStep({
    id: 'before-you-begin',
    title: 'Before You Begin',
    text: 'The Getting Started Wizard will guide you through building your personal foundation in Curam Vault — your Mission Statement, a 90-day Objective, measurable Key Results, and connecting your daily tasks to what matters most. This takes 10–15 minutes and is worth doing properly. You can pause at any point and pick up exactly where you left off.',
    when: { show() { injectStepCounter(1); } },
    buttons: [
      btnSecondary('Skip Tour', () => tour.cancel()),
      { text: 'Next →', action: () => tour.next() },
    ],
  });

  // ── Step 2: Built on 7 Habits (floating) ───────────────────────────────────
  tour.addStep({
    id: 'seven-habits',
    title: 'Built on 7 Habits',
    text: "This wizard is built on Stephen Covey's 7 Habits of Highly Effective People — specifically Habit 2 (Begin With the End in Mind), Habit 3 (Put First Things First), and Habit 7 (Sharpen the Saw). You don't need to know the framework to benefit from it. The wizard explains each concept as you go.",
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 3: The Get Started button ─────────────────────────────────────────
  tour.addStep({
    id: 'getting-started-trigger',
    title: 'Your Starting Point',
    text: "This button opens the 7-step wizard. Claude will suggest your Mission Statement, Objective, and Key Results based on a few questions you answer in Step 1. Every suggestion is editable — treat them as a starting point, not a final answer.",
    attachTo: { element: '[data-tour="getting-started-trigger"]', on: 'right' },
    beforeShowPromise() {
      return new Promise((resolve) => {
        navigate('/goals');
        setTimeout(() => {
          safeAttach(tour, 'getting-started-trigger', '[data-tour="getting-started-trigger"]');
          resolve();
        }, 700);
      });
    },
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 4: Take Your Time (floating) ──────────────────────────────────────
  tour.addStep({
    id: 'take-your-time',
    title: 'Take Your Time',
    text: "Nothing is saved to the app until the final step. You can close the wizard at any point and return later — your answers are preserved exactly as you left them. There is no rush. The Mission Statement step in particular deserves real thought.",
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 5: What Gets Created (floating) ───────────────────────────────────
  tour.addStep({
    id: 'what-gets-created',
    title: 'What Will Be Created',
    text: "When you complete the wizard, Curam Vault will have: a Mission Statement shown at the top of every Weekly Review, your first Objective with measurable Key Results, your existing tasks linked to your Objective, and a Renewal Balance baseline. These pieces connect the rest of the app — tasks, reviews, goals, and the knowledge graph — into a coherent system.",
    when: { show() { injectStepCounter(5); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 6: When You're Ready (attach to Get Started button) ───────────────
  tour.addStep({
    id: 'when-ready',
    title: "When You're Ready",
    text: "Click the button below when you're ready to begin. If you'd like to read about the 7 Habits framework first, the 'Why this matters' sections inside the wizard explain each concept in depth. There is no wrong way to do this — start, and refine over time.",
    attachTo: { element: '[data-tour="getting-started-trigger"]', on: 'right' },
    beforeShowPromise() {
      return new Promise((resolve) => {
        setTimeout(() => {
          safeAttach(tour, 'when-ready', '[data-tour="getting-started-trigger"]');
          resolve();
        }, 100);
      });
    },
    when: { show() { injectStepCounter(6); } },
    buttons: [
      btnBack(),
      {
        text: "I'm ready",
        action() {
          localStorage.setItem(TOUR_KEY, '1');
          tour.complete();
        },
      },
    ],
  });

  // Mark complete on cancel so the button doesn't keep reappearing
  tour.on('cancel', () => {
    localStorage.setItem(TOUR_KEY, '1');
  });

  tour.start();
  return tour;
}
