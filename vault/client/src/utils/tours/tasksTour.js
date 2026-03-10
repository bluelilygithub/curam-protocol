import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css'; // shared vault-tour styles

export const TOUR_KEY = 'vault_tour_tasks_completed';

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
      if (footer) el.insertBefore(counter, footer);
    }
    counter.textContent = `Step ${stepIndex} of ${TOTAL_STEPS}`;
  });
}

/**
 * Clear the attachTo on a step if its target element isn't in the DOM.
 * Call this inside beforeShowPromise after navigation/render has settled.
 */
function clearAttachIfMissing(tour, stepId) {
  const el = document.querySelector(
    document.getElementById(stepId)?.dataset?.tourSelector ||
    `[data-tour="${stepId.replace('step-', '')}"]`
  );
  return el;
}

function safeBeforeShow(tour, stepId, selector) {
  const el = document.querySelector(selector);
  if (!el) {
    const step = tour.getById(stepId);
    if (step) step.options.attachTo = undefined;
  }
}

/**
 * Start the Tasks product tour.
 * @param {Function} navigate - React Router navigate function
 * @returns {Shepherd.Tour}
 */
export function startTasksTour(navigate) {
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
    id: 'tasks-welcome',
    title: 'Task Manager — Quick Tour',
    text: "This 3-minute tour covers everything in Vault's task manager: views, Quick Capture, subtasks, Focus Mode, time tracking, templates, and Weekly Review.",
    when: { show() { injectStepCounter(1); } },
    buttons: [
      btnSecondary('Skip Tour', () => tour.cancel()),
      { text: 'Start Tour →', action: () => tour.next() },
    ],
  });

  // ── Step 2: Quick Capture FAB ─────────────────────────────────────────────
  tour.addStep({
    id: 'quick-capture',
    title: 'Quick Capture',
    text: "The fastest way to capture a task from anywhere in Vault. Also works with Ctrl+Shift+N from any page. Keep it minimal — title, priority, done. Don't over-plan at capture time.",
    attachTo: { element: '[data-tour="quick-capture-fab"]', on: 'top' },
    beforeShowPromise() {
      return new Promise((resolve) => {
        safeBeforeShow(tour, 'quick-capture', '[data-tour="quick-capture-fab"]');
        setTimeout(resolve, 200);
      });
    },
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 3: View Selector ─────────────────────────────────────────────────
  tour.addStep({
    id: 'view-selector',
    title: 'Four Views',
    text: 'List for daily work. Board for status flow. Calendar for time-blocking. Matrix (m key) for prioritisation. Press b to cycle through them, m to jump straight to the Matrix.',
    attachTo: { element: '[data-tour="view-selector"]', on: 'bottom' },
    beforeShowPromise() {
      return new Promise((resolve) => {
        navigate('/tasks');
        setTimeout(() => {
          safeBeforeShow(tour, 'view-selector', '[data-tour="view-selector"]');
          resolve();
        }, 500);
      });
    },
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 4: Stats Bar ─────────────────────────────────────────────────────
  tour.addStep({
    id: 'stats-bar',
    title: 'Live Stats',
    text: "These update as you filter. Total Effort is the sum of all incomplete task estimates — use it to spot when you're over-committed before the week starts.",
    attachTo: { element: '[data-tour="stats-bar"]', on: 'bottom' },
    beforeShowPromise() {
      return new Promise((resolve) => {
        safeBeforeShow(tour, 'stats-bar', '[data-tour="stats-bar"]');
        setTimeout(resolve, 200);
      });
    },
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 5: Filter Chips ──────────────────────────────────────────────────
  tour.addStep({
    id: 'filter-chips',
    title: 'Quick Filters',
    text: 'One-click filters. Combine with the full filter panel (funnel icon) for priority, tag, category, Renewal dimension, and date range filtering.',
    attachTo: { element: '[data-tour="filter-chips"]', on: 'bottom' },
    beforeShowPromise() {
      return new Promise((resolve) => {
        safeBeforeShow(tour, 'filter-chips', '[data-tour="filter-chips"]');
        setTimeout(resolve, 200);
      });
    },
    when: { show() { injectStepCounter(5); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 6: First Task Card ───────────────────────────────────────────────
  tour.addStep({
    id: 'first-task-card',
    title: 'Expand Any Task',
    text: "Click any task row to expand it. You'll see subtasks, dependencies, time log, comments, and the linked Key Result. Use the ✨ sparkles icon to let Claude generate subtasks from your task title.",
    attachTo: { element: '[data-tour="first-task-card"]', on: 'right' },
    beforeShowPromise() {
      return new Promise((resolve) => {
        safeBeforeShow(tour, 'first-task-card', '[data-tour="first-task-card"]');
        setTimeout(resolve, 300);
      });
    },
    when: { show() { injectStepCounter(6); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 7: Focus Mode ────────────────────────────────────────────────────
  tour.addStep({
    id: 'focus-mode',
    title: 'Focus Mode (Pomodoro)',
    text: "Hover any task card to reveal action buttons — including the 🎯 Focus Mode button. It opens a full-screen Pomodoro timer for one task at a time. 25-minute focus sessions with short and long breaks. Time is logged to the task automatically when you close it.",
    attachTo: { element: '[data-tour="first-task-card"]', on: 'left' },
    beforeShowPromise() {
      return new Promise((resolve) => {
        safeBeforeShow(tour, 'focus-mode', '[data-tour="first-task-card"]');
        setTimeout(resolve, 200);
      });
    },
    when: { show() { injectStepCounter(7); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 8: Templates ─────────────────────────────────────────────────────
  tour.addStep({
    id: 'templates',
    title: 'Templates',
    text: 'Save any task as a reusable template — especially useful for multi-subtask tasks you create repeatedly. Apply a template to pre-fill all fields including subtasks in one click.',
    attachTo: { element: '[data-tour="templates-btn"]', on: 'bottom' },
    beforeShowPromise() {
      return new Promise((resolve) => {
        safeBeforeShow(tour, 'templates', '[data-tour="templates-btn"]');
        setTimeout(resolve, 200);
      });
    },
    when: { show() { injectStepCounter(8); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 9: CSV Import ────────────────────────────────────────────────────
  tour.addStep({
    id: 'csv-import',
    title: 'CSV Import',
    text: 'Bulk-import tasks from a spreadsheet. Download the template, fill it in, upload. Vault shows a preview with per-row validation before you commit.',
    attachTo: { element: '[data-tour="import-btn"]', on: 'bottom' },
    beforeShowPromise() {
      return new Promise((resolve) => {
        safeBeforeShow(tour, 'csv-import', '[data-tour="import-btn"]');
        setTimeout(resolve, 200);
      });
    },
    when: { show() { injectStepCounter(9); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 10: Weekly Review ────────────────────────────────────────────────
  tour.addStep({
    id: 'weekly-review',
    title: 'Weekly Review — Do This Every Friday',
    text: '3 steps: review wins, clear overdue tasks, plan the week ahead. Claude generates a focus suggestion live. Renewal balance and Goal progress are shown inline. 20 minutes. Non-negotiable.',
    attachTo: { element: '[data-tour="weekly-review-btn"]', on: 'bottom' },
    beforeShowPromise() {
      return new Promise((resolve) => {
        safeBeforeShow(tour, 'weekly-review', '[data-tour="weekly-review-btn"]');
        setTimeout(resolve, 200);
      });
    },
    when: { show() { injectStepCounter(10); } },
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
