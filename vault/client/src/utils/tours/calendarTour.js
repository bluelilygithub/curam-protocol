import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_calendar_completed';

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

function clickCalendarView() {
  // Click the calendar view toggle button in the tasks toolbar
  const btn = document.querySelector('[data-tour="tasks-view-calendar"]');
  if (btn) btn.click();
}

export function startCalendarTour(navigate) {
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

  // ── Step 1: Welcome ───────────────────────────────────────────────────────
  tour.addStep({
    id: 'calendar-welcome',
    title: 'Task Calendar — Quick Tour',
    text: "The Calendar view turns your task list into a time-blocking workspace. Tasks with estimated effort become draggable blocks on a 24-hour grid. This tour covers the four sub-views, how to schedule and reschedule, and the unscheduled panel.",
    when: { show() { injectStepCounter(1); } },
    buttons: [
      btnSecondary('Skip Tour', () => tour.cancel()),
      { text: 'Start Tour →', action: () => tour.next() },
    ],
  });

  // ── Step 2: Switching to Calendar view ────────────────────────────────────
  tour.addStep({
    id: 'calendar-switch',
    title: 'Opening the Calendar',
    text: "From the Tasks page, use the view toggle in the toolbar to switch to Calendar. You can also press the keyboard shortcut — check the ? help panel in the toolbar for the full list. The calendar persists your last sub-view (day / week / month / agenda) between visits.",
    attachTo: { element: '[data-tour="tasks-view-calendar"]', on: 'bottom' },
    beforeShowPromise() {
      return new Promise(resolve => {
        navigate('/tasks');
        setTimeout(() => {
          safeBeforeShow(tour, 'calendar-switch', '[data-tour="tasks-view-calendar"]');
          resolve();
        }, 600);
      });
    },
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 3: Sub-views ─────────────────────────────────────────────────────
  tour.addStep({
    id: 'calendar-subviews',
    title: 'Day / Week / Month / Agenda',
    text: "Day view gives you a full 24-hour column — best for planning a single focused day. Week view shows Mon–Sun in parallel columns for weekly planning. Month view gives the big picture with task pills per day. Agenda view lists upcoming tasks in chronological order. Switch with the buttons in the calendar sub-header.",
    attachTo: { element: '[data-tour="calendar-subview-btns"]', on: 'bottom' },
    beforeShowPromise() {
      return new Promise(resolve => {
        clickCalendarView();
        setTimeout(() => {
          safeBeforeShow(tour, 'calendar-subviews', '[data-tour="calendar-subview-btns"]');
          resolve();
        }, 500);
      });
    },
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 4: Time blocks & drag ────────────────────────────────────────────
  tour.addStep({
    id: 'calendar-blocks',
    title: 'Time Blocks — Drag to Reschedule',
    text: "Any task with a due date and a time appears as a coloured block on the 24-hour grid, sized by its estimated effort. Drag a block to a new time slot to reschedule it — the task's due date and time update automatically. Blocks are colour-coded by priority.",
    attachTo: { element: '[data-tour="calendar-grid"]', on: 'right' },
    beforeShowPromise() {
      return new Promise(resolve => {
        setTimeout(() => {
          safeBeforeShow(tour, 'calendar-blocks', '[data-tour="calendar-grid"]');
          resolve();
        }, 300);
      });
    },
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 5: Resize for effort ─────────────────────────────────────────────
  tour.addStep({
    id: 'calendar-resize',
    title: 'Resize to Adjust Effort',
    text: "Drag the bottom edge of any time block to make it taller or shorter — this updates the task's estimated effort in 15-minute increments. It's the fastest way to adjust your time estimates as you plan the day. The effort change is saved immediately.",
    when: { show() { injectStepCounter(5); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 6: Unscheduled panel ─────────────────────────────────────────────
  tour.addStep({
    id: 'calendar-unscheduled',
    title: 'Unscheduled Panel & Click to Create',
    text: "The left sidebar shows tasks that have no scheduled time for the current view period — drag them onto the grid to assign a time slot. You can also click any empty slot on the grid to create a new task pre-filled with that date and time. Milestone tasks appear as amber diamonds — they aren't draggable.",
    attachTo: { element: '[data-tour="calendar-sidebar"]', on: 'right' },
    beforeShowPromise() {
      return new Promise(resolve => {
        setTimeout(() => {
          safeBeforeShow(tour, 'calendar-unscheduled', '[data-tour="calendar-sidebar"]');
          resolve();
        }, 300);
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

  tour.on('cancel', () => localStorage.setItem(TOUR_KEY, '1'));
  tour.start();
  return tour;
}
