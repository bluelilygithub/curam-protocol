import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_email_follow_up_completed';

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

// Some parts only exist inside an open case (the people box, the tabs). If a step's target is not on screen, show the step in the
// middle of the screen instead of failing.
function safeBeforeShow(tour, stepId, selector) {
  if (!document.querySelector(selector)) {
    const step = tour.getById(stepId);
    if (step) step.options.attachTo = undefined;
  }
}

export function startEmailFollowUpTour() {
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
  const check = (stepId, selector) => () => new Promise((resolve) => { safeBeforeShow(tour, stepId, selector); resolve(); });

  tour.addStep({
    id: 'ef-welcome',
    title: 'Email Follow-Up — Quick Tour',
    text: 'This keeps track of what has been promised or is owed in a matter, shows the exact words it came from, and writes follow-up text for you to copy. It reads Gmail but never sends, files or changes anything.',
    when: { show() { injectStepCounter(1); } },
    buttons: [btnSecondary('Skip Tour', () => tour.cancel()), { text: 'Start Tour →', action: () => tour.next() }],
  });

  tour.addStep({
    id: 'ef-new',
    title: 'You open each case',
    text: 'Press New case, say what is owed and by whom, and list the people\'s email addresses. Nothing opens by itself and no email attaches by itself: you choose each thread.',
    attachTo: { element: '[data-tour="ef-new"]', on: 'bottom' },
    beforeShowPromise: check('ef-new', '[data-tour="ef-new"]'),
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'ef-people',
    title: 'The people in the case',
    text: 'Inside a case, these addresses are used to find mail and to check your Sent folder. Press Save people after changing them.',
    attachTo: { element: '[data-tour="ef-people"]', on: 'bottom' },
    beforeShowPromise: check('ef-people', '[data-tour="ef-people"]'),
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'ef-steps',
    title: 'Find, attachments, read, check Sent',
    text: '1. Find mail lists threads with these people for you to attach. 2. Get attachments reads the text of PDFs and Word files that came with them, and scanned pages by OCR. 3. Read asks the AI to propose ledger rows; each must quote the text word for word or it is dropped. 4. Check Sent looks for replies you already sent (a busy case takes a few presses). Draft follow-up runs it for you when it is out of date, and drafts nothing if it cannot.',
    attachTo: { element: '[data-tour="ef-steps"]', on: 'bottom' },
    beforeShowPromise: check('ef-steps', '[data-tour="ef-steps"]'),
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'ef-ledger',
    title: 'The ledger',
    text: 'Each row is one thing owed, with the words it came from and its deadline. A deadline the tool cannot work out says what is missing; it never guesses. "Resolved elsewhere" closes a row that was dealt with by phone or in person.',
    attachTo: { element: '[data-tour="ef-tabs"]', on: 'bottom' },
    beforeShowPromise: check('ef-ledger', '[data-tour="ef-tabs"]'),
    when: { show() { injectStepCounter(5); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'ef-drafts',
    title: 'Drafts you approve and copy',
    text: 'Draft follow-up writes fixed sentences around the row\'s own quoted words, checked against the email. Read any warnings, approve, then Copy: just before copying, Gmail is checked for new replies. Paste it into your own mail program; nothing is sent.',
    when: { show() { injectStepCounter(6); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'ef-limits',
    title: 'Good to know',
    text: 'The tool cannot see phone calls, portals, other mailboxes, or anything that is only a photo. Scans are read by OCR, which can misread a figure, so check those against the original. The What was covered tab says so. Use it for accounting, freelance and job-search matters, not medical or mortgage ones. Stuck? Press the round button at the bottom right and ask the guide.',
    when: { show() { injectStepCounter(7); } },
    buttons: [
      btnBack(),
      { text: 'Finish Tour ✓', action() { try { localStorage.setItem(TOUR_KEY, '1'); } catch (_) { /* ignore */ } tour.complete(); } },
    ],
  });

  tour.on('cancel', () => { try { localStorage.setItem(TOUR_KEY, '1'); } catch (_) { /* ignore */ } });
  tour.start();
  return tour;
}
