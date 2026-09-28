import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_contract_review_completed';

const TOTAL_STEPS = 8;

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

export function startContractReviewTour(navigate) {
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

  // ── Step 1: Welcome ──────────────────────────────────────────────────────
  tour.addStep({
    id: 'cr-welcome',
    title: 'Contract Review — Quick Tour',
    text: "Upload a contract (PDF or DOCX) and get an automated review: parties, definitions, clause-by-clause risk flags, extracted obligations with deadlines, and a Q&A assistant grounded in the actual document text. It's informational only — always confirm important decisions with a qualified lawyer.",
    when: { show() { injectStepCounter(1); } },
    buttons: [
      btnSecondary('Skip Tour', () => tour.cancel()),
      { text: 'Start Tour →', action: () => tour.next() },
    ],
  });

  // ── Step 2: Upload ───────────────────────────────────────────────────────
  tour.addStep({
    id: 'cr-upload',
    title: 'Upload & Review',
    text: "Give the contract a title, attach the PDF or DOCX, and click Upload & review. The pipeline runs text extraction, clause segmentation, contract-type detection, and party extraction right away — you'll usually be asked to confirm which party you are before the rest of the analysis continues.",
    attachTo: { element: '[data-tour="contract-review-upload"]', on: 'bottom' },
    beforeShowPromise() {
      return new Promise(resolve => {
        navigate('/contract-review');
        setTimeout(() => {
          safeBeforeShow(tour, 'cr-upload', '[data-tour="contract-review-upload"]');
          resolve();
        }, 600);
      });
    },
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 3: Confirm your party ───────────────────────────────────────────
  tour.addStep({
    id: 'cr-party',
    title: 'Which Party Are You?',
    text: "Risk scoring is one-sided by design — a clause that's risky for the tenant may be standard for the landlord. Confirming your party unblocks the rest of the analysis. You can correct a detected name or role right there before confirming, or add yourself manually if no parties were found at all.",
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 4: Clauses & risk flags ─────────────────────────────────────────
  tour.addStep({
    id: 'cr-clauses',
    title: 'Clauses & Risk Flags',
    text: "Every clause is scored Risky, Unclear, or Standard for your confirmed party, with a plain-English reason and an advisory (copy-paste only) suggested redline. A Verified badge means the clause text was matched back to the source document; Unverified means it couldn't be confirmed word-for-word. Filter by severity or re-sort, and dismiss or override any flag that doesn't apply to you.",
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 5: Ask about this contract ──────────────────────────────────────
  tour.addStep({
    id: 'cr-qa',
    title: 'Ask About This Contract',
    text: "Ask a plain-English question — \"how much notice do I need to give to terminate?\" — and get an answer grounded in the actual clause text, with a quoted citation back to the document. It searches every document and revision under the contract, not just the one currently open.",
    when: { show() { injectStepCounter(5); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 6: Obligations ──────────────────────────────────────────────────
  tour.addStep({
    id: 'cr-obligations',
    title: 'Obligations — What You Need to Do',
    text: "Dates, deadlines, and recurring duties extracted from the contract land on the Obligations tab. Assign the obligor, mark items done, send any obligation to Tasks, or export the whole list as a calendar (.ics). Obligations on a draft (not-yet-executed) document are clearly labelled as such.",
    when: { show() { injectStepCounter(6); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 7: Documents & revisions ────────────────────────────────────────
  tour.addStep({
    id: 'cr-revisions',
    title: 'Documents, Revisions & What Changed',
    text: "Upload a new revision of a document and it's fully re-reviewed. \"What changed\" compares it against the version it replaced — added, removed, and edited clauses, plus any risk-level shifts. Mark a draft as executed once it's signed, or run an independent review of the same document as a different party.",
    when: { show() { injectStepCounter(7); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 8: Reports ───────────────────────────────────────────────────────
  tour.addStep({
    id: 'cr-report',
    title: 'PDF Report & Email',
    text: "Download a PDF report — banner, parties and role, every flag with its reason and redline, and obligations — or send it straight to an email address. Look for the compass and info icons next to the page title any time you want to retake this tour or re-read how the tool works.",
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

  tour.on('cancel', () => localStorage.setItem(TOUR_KEY, '1'));
  tour.start();
  return tour;
}
