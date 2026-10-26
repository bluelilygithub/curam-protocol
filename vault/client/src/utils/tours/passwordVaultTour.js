import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_password_vault_completed';

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

// Some parts only exist once the vault is unlocked (the add button, the list): if a step's target is missing, show it in the middle of the screen.
function safeBeforeShow(tour, stepId, selector) {
  if (!document.querySelector(selector)) {
    const step = tour.getById(stepId);
    if (step) step.options.attachTo = undefined;
  }
}

/** `setTab(id)` switches the page's tool, so the tour can walk through them. */
export function startPasswordVaultTour(setTab) {
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
  const go = (id, stepId, selector) => () => new Promise((resolve) => {
    setTab?.(id);
    setTimeout(() => { safeBeforeShow(tour, stepId, selector); resolve(); }, 120);
  });

  tour.addStep({
    id: 'vault-welcome',
    title: 'Password Vault — Quick Tour',
    text: 'A safe place for logins, some of them for your clients. Everything is locked in your browser with a master password before it is saved, so Vault only ever holds scrambled text it cannot read.',
    when: { show() { injectStepCounter(1); } },
    buttons: [btnSecondary('Skip Tour', () => tour.cancel()), { text: 'Start Tour →', action: () => tour.next() }],
  });

  tour.addStep({
    id: 'vault-master',
    title: 'The master password',
    text: 'You make one master password, and it opens everything. It never leaves this device, so Vault cannot reset it: if it is forgotten, the only way back is to erase the vault and start again. This is also where you lock the vault and choose how soon it locks itself.',
    attachTo: { element: '[data-tour="vault-tab-master"]', on: 'right' },
    beforeShowPromise: go('master', 'vault-master', '[data-tour="vault-tab-master"]'),
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'vault-add',
    title: 'Add a login',
    text: 'Save a title, username, web address, password and notes. Pick a client to file it under them. Make one opens the password generator for this login, so you can set its own rules (length, which characters, which to avoid) and keep them with the login.',
    attachTo: { element: '[data-tour="vault-add"]', on: 'bottom' },
    beforeShowPromise: go('passwords', 'vault-add', '[data-tour="vault-add"]'),
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'vault-client',
    title: 'Find logins by client',
    text: 'Filter the list to one client, or to logins with none. Copy puts a password on the clipboard without showing it, and clears it again after 30 seconds.',
    attachTo: { element: '[data-tour="vault-client-filter"]', on: 'bottom' },
    beforeShowPromise: go('passwords', 'vault-client', '[data-tour="vault-client-filter"]'),
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'vault-generator',
    title: 'Make a strong password',
    text: 'Choose the length and which characters to use. It is made on this device with the browser\'s secure random numbers, and nothing is saved until you put it in a login.',
    attachTo: { element: '[data-tour="vault-tab-generator"]', on: 'right' },
    beforeShowPromise: go('generator', 'vault-generator', '[data-tour="vault-tab-generator"]'),
    when: { show() { injectStepCounter(5); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'vault-health',
    title: 'Password health',
    text: 'Lists passwords that are weak, used for more than one login, or not changed for over a year. It checks on this device and cannot tell if a password was in a data breach. Stuck? Press the round button at the bottom right and ask the guide, but never type a password into it.',
    attachTo: { element: '[data-tour="vault-tab-health"]', on: 'right' },
    beforeShowPromise: go('health', 'vault-health', '[data-tour="vault-tab-health"]'),
    when: { show() { injectStepCounter(6); } },
    buttons: [
      btnBack(),
      { text: 'Finish Tour ✓', action() { try { localStorage.setItem(TOUR_KEY, '1'); } catch (_) { /* ignore */ } tour.complete(); } },
    ],
  });

  tour.on('cancel', () => { try { localStorage.setItem(TOUR_KEY, '1'); } catch (_) { /* ignore */ } });
  tour.start();
  return tour;
}
