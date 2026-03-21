import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_mood_completed';

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
  const el = document.querySelector(selector);
  if (!el) {
    const step = tour.getById(stepId);
    if (step) step.options.attachTo = undefined;
  }
}

export function startMoodTour(navigate) {
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
    id: 'mood-welcome',
    title: 'Mood Tracking — Quick Tour',
    text: "Vault tracks how you feel across your work — not just productivity, but the emotional texture of your day. This tour covers check-ins, guided inquiry sessions, the Plutchik wheel, and AI-generated pattern insights.",
    when: { show() { injectStepCounter(1); } },
    buttons: [
      btnSecondary('Skip Tour', () => tour.cancel()),
      { text: 'Start Tour →', action: () => tour.next() },
    ],
  });

  // ── Step 2: Quick check-in ────────────────────────────────────────────────
  tour.addStep({
    id: 'mood-checkin',
    title: 'Quick Check-in',
    text: "A lightweight 3-step flow: body scan (where do you feel it?), the Plutchik emotion wheel (what is it?), and optional context. Takes about 30 seconds. You can also log a check-in directly from any task, note, or project using the small mood dot on each card.",
    attachTo: { element: '[data-tour="mood-checkin-btn"]', on: 'bottom' },
    beforeShowPromise() {
      return new Promise(resolve => {
        navigate('/mood');
        setTimeout(() => {
          safeBeforeShow(tour, 'mood-checkin', '[data-tour="mood-checkin-btn"]');
          resolve();
        }, 600);
      });
    },
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 3: Guided inquiry ────────────────────────────────────────────────
  tour.addStep({
    id: 'mood-inquiry',
    title: 'Guided Inquiry — Go Deeper',
    text: "The Begin Inquiry button opens a 5-stage session: arrival, body scan, emotion selection, a live AI conversation (Claude responds to what you're feeling with curiosity, not advice), and an integration summary. Voice input and read-aloud are available throughout. Sessions are saved and readable in the Sessions tab.",
    attachTo: { element: '[data-tour="mood-inquiry-btn"]', on: 'bottom' },
    beforeShowPromise() {
      return new Promise(resolve => {
        setTimeout(() => {
          safeBeforeShow(tour, 'mood-inquiry', '[data-tour="mood-inquiry-btn"]');
          resolve();
        }, 300);
      });
    },
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 4: Overview tab ──────────────────────────────────────────────────
  tour.addStep({
    id: 'mood-overview',
    title: 'Overview — Your Emotional Landscape',
    text: "The Overview tab shows a Plutchik density wheel (segments sized by check-in frequency), a day-by-day timeline, a breakdown of emotions with percentages, and your most emotionally active projects. Filter by Today / Week / Month or a custom date range. You can also filter by source — tasks, notes, projects, sessions, or goals.",
    attachTo: { element: '[data-tour="mood-tabs"]', on: 'bottom' },
    beforeShowPromise() {
      return new Promise(resolve => {
        setTimeout(() => {
          safeBeforeShow(tour, 'mood-overview', '[data-tour="mood-tabs"]');
          resolve();
        }, 300);
      });
    },
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 5: Sessions tab ──────────────────────────────────────────────────
  tour.addStep({
    id: 'mood-sessions',
    title: 'Sessions — Your Inquiry Archive',
    text: "Every completed guided inquiry is saved here with the date, duration, dominant emotions, and your closing summary. Click any row to expand the full conversation transcript — a record of your thinking that you can return to.",
    attachTo: { element: '[data-tour="mood-tabs"]', on: 'bottom' },
    when: { show() { injectStepCounter(5); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 6: Pattern Insights ──────────────────────────────────────────────
  tour.addStep({
    id: 'mood-insights',
    title: 'Pattern Insights — AI Reads Your Trends',
    text: "The Pattern Insights section analyses your recent check-ins and sessions to surface 3–5 specific observations — which emotions appear most in which contexts, shifts over time, and patterns you might not have noticed. Results are cached so you only regenerate when you want fresh analysis.",
    attachTo: { element: '[data-tour="mood-insights"]', on: 'top' },
    beforeShowPromise() {
      return new Promise(resolve => {
        setTimeout(() => {
          safeBeforeShow(tour, 'mood-insights', '[data-tour="mood-insights"]');
          resolve();
        }, 300);
      });
    },
    when: { show() { injectStepCounter(6); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 7: Reminder settings ─────────────────────────────────────────────
  tour.addStep({
    id: 'mood-reminder',
    title: 'Set a Reminder',
    text: "You can configure a daily or weekly reminder in Settings → Tasks → Mood & Reflection. Choose the time and days that work for you — a banner will appear nudging you to pause for a check-in or guided inquiry. Consistent practice is where the pattern data becomes meaningful.",
    when: { show() { injectStepCounter(7); } },
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
