import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_integrations_completed';

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
 * Start the Gmail & Calendar Integrations product tour.
 * @param {Function} navigate - React Router navigate function
 * @returns {Shepherd.Tour}
 */
export function startIntegrationsTour(navigate) {
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
    id: 'integrations-welcome',
    title: 'Gmail & Calendar — Quick Tour',
    text: "Vault connects to your Google account so Claude can search your emails and calendar events in any chat. This tour shows you how to connect, what access is granted, and how to use the integrations.",
    when: { show() { injectStepCounter(1); } },
    buttons: [
      btnSecondary('Skip Tour', () => tour.cancel()),
      { text: 'Start Tour →', action: () => tour.next() },
    ],
  });

  // ── Step 2: Integrations section ──────────────────────────────────────────
  tour.addStep({
    id: 'integrations-section',
    title: 'Integrations Panel',
    text: "The Integrations section in Settings is where you connect and manage your Google account. Gmail and Calendar share the same OAuth flow — connecting once grants access to both, using the same Google account.",
    attachTo: { element: '[data-tour="integrations-section"]', on: 'top' },
    beforeShowPromise() {
      return new Promise((resolve) => {
        navigate('/settings');
        setTimeout(resolve, 700);
      });
    },
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 3: Gmail connect ─────────────────────────────────────────────────
  tour.addStep({
    id: 'integrations-gmail',
    title: 'Connecting Gmail',
    text: "Click <strong>Connect Gmail</strong> to start the OAuth flow. Vault requests read-only access — it cannot send, delete, or modify your emails. Once connected, your email address shows here as confirmation.",
    attachTo: { element: '[data-tour="gmail-connect"]', on: 'bottom' },
    beforeShowPromise: safeBeforeShow(tour, 'integrations-gmail', '[data-tour="gmail-connect"]'),
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 4: @gmail in chat ────────────────────────────────────────────────
  tour.addStep({
    id: 'integrations-gmail-chat',
    title: 'Using @gmail in Chat',
    text: "In any chat, type <code>@gmail</code> followed by your query — for example: <em>@gmail find the invoice from Acme Corp last month</em>. Claude searches your inbox and summarises the relevant emails directly in the conversation.",
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 5: Calendar connect ──────────────────────────────────────────────
  tour.addStep({
    id: 'integrations-calendar',
    title: 'Connecting Google Calendar',
    text: "Calendar uses the same Google OAuth connection as Gmail — if you've already connected Gmail with Calendar scope, it appears as Connected here automatically. If not, click <strong>Connect Google</strong> to grant both scopes at once.",
    attachTo: { element: '[data-tour="calendar-connect"]', on: 'bottom' },
    beforeShowPromise: safeBeforeShow(tour, 'integrations-calendar', '[data-tour="calendar-connect"]'),
    when: { show() { injectStepCounter(5); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 6: @calendar in chat ─────────────────────────────────────────────
  tour.addStep({
    id: 'integrations-calendar-chat',
    title: 'Using @calendar in Chat',
    text: "Type <code>@calendar</code> in any chat to query your events — for example: <em>@calendar what do I have on Friday?</em> or <em>@calendar find all meetings with Sarah this month</em>. Claude pulls live event data and responds in natural language.",
    when: { show() { injectStepCounter(6); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 7: Privacy note ──────────────────────────────────────────────────
  tour.addStep({
    id: 'integrations-privacy',
    title: 'Privacy & Access',
    text: "Vault stores only the OAuth tokens needed to query on your behalf — no email content is stored permanently. You can disconnect at any time from Settings and Vault immediately loses access. All queries are made in real time when you use <code>@gmail</code> or <code>@calendar</code>.",
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

  tour.on('cancel', () => {
    localStorage.setItem(TOUR_KEY, '1');
  });

  tour.start();
  return tour;
}
