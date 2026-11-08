import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_crm_client_completed';

// 5 steps, plus one for Plans when that section is on the page (it is left out when Plans is switched off for the person), so the count is set when the tour starts.
let totalSteps = 5;

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
    counter.textContent = `Step ${stepIndex} of ${totalSteps}`;
  });
}

// Sections are individually collapsible (docs/crm-deals-schema.md §9-§12
// added Tasks/Touchpoints content that's easy to miss collapsed) — the tour
// opens whichever one it's about to point at by clicking its toggle button
// (data-tour-toggle) if the content (data-tour) isn't already in the DOM.
function ensureSectionOpen(tourId) {
  return new Promise((resolve) => {
    if (document.querySelector(`[data-tour="${tourId}"]`)) return resolve();
    const toggle = document.querySelector(`[data-tour-toggle="${tourId}"]`);
    if (toggle) toggle.click();
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

export function startCrmTour() {
  if (Shepherd.activeTour) Shepherd.activeTour.cancel();
  const hasPlans = !!document.querySelector('[data-tour-toggle="crm-plans"]'); // the Plans section exists only when Plans is on for this person
  totalSteps = hasPlans ? 6 : 5;

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

  tour.addStep({
    id: 'crm-welcome',
    title: 'Client Page — Quick Tour',
    text: "Deals, Tasks, Touchpoints, and Communications all live on this one page, and three of them connect in a specific way — this tour walks through how.",
    attachTo: { element: '[data-tour="crm-header"]', on: 'bottom' },
    when: { show() { injectStepCounter(1); } },
    buttons: [
      btnSecondary('Skip Tour', () => tour.cancel()),
      { text: 'Start Tour →', action: () => tour.next() },
    ],
  });

  tour.addStep({
    id: 'crm-touchpoints',
    title: 'Touchpoints — the past-tense log',
    text: "Log a call, email, or meeting after it happens. Filter by channel using the chips above the list (reuses the same type you picked when logging — no separate field). Hover a row to attach a file.",
    attachTo: { element: '[data-tour="crm-activity"]', on: 'top' },
    beforeShowPromise: () => ensureSectionOpen('crm-activity'),
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'crm-followup',
    title: '"+ Follow up" — the one bridge',
    text: "Hover a touchpoint row and click \"+ Follow up\" to turn it into a Task with a due date. This is the only way a touchpoint becomes something scheduled — touchpoints themselves never carry a due date, and a Task never turns back into a touchpoint.",
    attachTo: { element: '[data-tour="crm-activity"]', on: 'top' },
    beforeShowPromise: () => ensureSectionOpen('crm-activity'),
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'crm-tasks',
    title: 'Tasks — every open task for this client',
    text: "Shows every open task linked here, whether through a project or directly (like a follow-up). Open one to add a due date, attach a file, or export it to your calendar as an .ics.",
    attachTo: { element: '[data-tour="crm-tasks"]', on: 'top' },
    beforeShowPromise: () => ensureSectionOpen('crm-tasks'),
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  if (hasPlans) {
    tour.addStep({
      id: 'crm-plans',
      title: 'Plans — the schedule for this client\'s work',
      text: "Dated plans filed under this client: each has steps with a length in working days and which steps wait on which, and says whether it finishes in time. New plan starts one already filed under this client, and Open in Plans shows only theirs. A plan can also be made from a note or a diagram that belongs to this client. Tasks sent from a plan are filed under the client, and a client project's start and end dates follow its plans.",
      attachTo: { element: '[data-tour="crm-plans"]', on: 'top' },
      beforeShowPromise: () => ensureSectionOpen('crm-plans'),
      when: { show() { injectStepCounter(5); } },
      buttons: [btnBack(), btnNext],
    });
  }

  tour.addStep({
    id: 'crm-communications',
    title: 'Communications — Gmail search',
    text: "Separate from Touchpoints: this searches actual Gmail threads with this client's contacts. Touchpoints are what you log yourself; this reads what's already in your inbox.",
    attachTo: { element: '[data-tour="crm-communications"]', on: 'top' },
    beforeShowPromise: () => ensureSectionOpen('crm-communications'),
    when: { show() { injectStepCounter(hasPlans ? 6 : 5); } },
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
