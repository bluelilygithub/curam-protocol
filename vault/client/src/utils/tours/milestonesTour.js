import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css'; // shared vault-tour styles

export const TOUR_KEY = 'vault_tour_milestones_completed';

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
  const el = document.querySelector(selector);
  if (!el) {
    const step = tour.getById(stepId);
    if (step) step.options.attachTo = undefined;
  }
}

/**
 * Start the Milestones product tour.
 * @param {Function} navigate - React Router navigate function
 * @returns {Shepherd.Tour}
 */
export function startMilestonesTour(navigate) {
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
    id: 'milestones-welcome',
    title: 'Milestones — Quick Tour',
    text: "Milestones let you flag the tasks that really matter — due dates, deliverables, launch moments. Flag them with 🏁 and they surface on your Goals timeline, Calendar, and Weekly Review, keeping big-picture progress visible every day.",
    when: { show() { injectStepCounter(1); } },
    buttons: [
      btnSecondary('Skip Tour', () => tour.cancel()),
      { text: 'Start Tour →', action: () => tour.next() },
    ],
  });

  // ── Step 2: The milestone toggle in the task form ─────────────────────────
  tour.addStep({
    id: 'milestone-toggle',
    title: 'Mark any Task as a Milestone',
    text: "Open any task and scroll to the bottom of the form — click the 🏁 Not a milestone button to toggle it on. A warning appears if you haven't set a due date. Milestones work best when they have a date so they appear correctly on the Goals timeline.",
    attachTo: { element: '[data-tour="view-selector"]', on: 'bottom' },
    beforeShowPromise() {
      return new Promise((resolve) => {
        navigate('/tasks');
        setTimeout(() => {
          safeBeforeShow(tour, 'milestone-toggle', '[data-tour="view-selector"]');
          resolve();
        }, 600);
      });
    },
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 3: Badges across views ───────────────────────────────────────────
  tour.addStep({
    id: 'milestone-badges',
    title: '🏁 Badges Across All Views',
    text: "Milestone tasks show an amber 🏁 badge on List, Board, Matrix, and Tree views — so you can spot them at a glance without filtering. In the Calendar, they render as a diamond marker instead of a block, making them visually distinct from regular timed tasks.",
    attachTo: { element: '[data-tour="stats-bar"]', on: 'bottom' },
    beforeShowPromise() {
      return new Promise((resolve) => {
        safeBeforeShow(tour, 'milestone-badges', '[data-tour="stats-bar"]');
        setTimeout(resolve, 300);
      });
    },
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 4: Calendar diamond marker ──────────────────────────────────────
  tour.addStep({
    id: 'milestone-calendar',
    title: 'Calendar: Diamond Markers',
    text: "On the Calendar, milestone tasks appear as amber ♦ diamonds pinned to their scheduled time. They are not draggable or resizable — milestones are fixed commitments. All-day milestones get the same amber 🏁 treatment in the all-day row. Click any diamond to see details.",
    attachTo: { element: '[data-tour="calendar-view"]', on: 'top' },
    beforeShowPromise() {
      return new Promise((resolve) => {
        navigate('/tasks?view=calendar');
        setTimeout(() => {
          safeBeforeShow(tour, 'milestone-calendar', '[data-tour="calendar-view"]');
          resolve();
        }, 800);
      });
    },
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 5: Goals milestone timeline ─────────────────────────────────────
  tour.addStep({
    id: 'milestone-timeline',
    title: 'Milestone Timeline on Goals',
    text: "Select any Objective to see its Milestone Timeline below the Key Results. It pulls in all 🏁 tasks linked to that objective's KRs, sorted by due date. Overdue milestones show in red — a direct signal that a commitment is at risk. The count badge on the chevron goes red when any are overdue.",
    attachTo: { element: '[data-tour="milestone-timeline"]', on: 'left' },
    beforeShowPromise() {
      return new Promise((resolve) => {
        navigate('/goals');
        setTimeout(() => {
          safeBeforeShow(tour, 'milestone-timeline', '[data-tour="milestone-timeline"]');
          resolve();
        }, 800);
      });
    },
    when: { show() { injectStepCounter(5); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 6: Weekly Review ─────────────────────────────────────────────────
  tour.addStep({
    id: 'milestone-weekly-review',
    title: 'Milestones in Your Weekly Review',
    text: "In Step 3 of the Weekly Review, each Objective shows its next two non-done milestones inline — upcoming ones in amber, overdue in red. It's a weekly prompt to catch slipping commitments before they become a problem.",
    attachTo: { element: '[data-tour="weekly-review-btn"]', on: 'bottom' },
    beforeShowPromise() {
      return new Promise((resolve) => {
        navigate('/tasks');
        setTimeout(() => {
          safeBeforeShow(tour, 'milestone-weekly-review', '[data-tour="weekly-review-btn"]');
          resolve();
        }, 700);
      });
    },
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
