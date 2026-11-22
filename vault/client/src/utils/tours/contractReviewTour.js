import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

// The Contract Review tour (compass button beside the title in the tool list, Settings -> Contract Review Tour, or /contract-review?tour=1).
// Like DocCompare's: a step about a tool switches to that tool (goTool, the same as clicking it in the list) and points at the main area.
// With no contract open, a contract tool shows "Open one of yours"; the card text says what the tool holds.

export const TOUR_KEY = 'vault_tour_contract_review_completed';

const TOTAL_STEPS = 16;

// Shepherd keeps earlier cards in the page (hidden), so the counter goes into this step's own card, not the first one found.
function injectStepCounter(stepIndex, card) {
  requestAnimationFrame(() => {
    const el = card || document.querySelector('.shepherd-element.vault-tour');
    if (!el) return;
    let counter = el.querySelector('.vault-tour-step-count');
    if (!counter) {
      counter = document.createElement('div');
      counter.className = 'vault-tour-step-count';
      const footer = el.querySelector('.shepherd-footer');
      if (footer) footer.parentNode.insertBefore(counter, footer);
    }
    counter.textContent = `Step ${stepIndex} of ${TOTAL_STEPS}`;
  });
}

function safeBeforeShow(tour, stepId, selector) {
  if (!document.querySelector(selector)) {
    const step = tour.getById(stepId);
    if (step) step.options.attachTo = undefined;
  }
}

const MAIN = '[data-tour="contract-review-main"]';

/** goTool(id) shows a tool ('new', 'contracts', 'review', ...) or the job screen ('start'). */
export function startContractReviewTour(goTool) {
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
  const done = () => { try { localStorage.setItem(TOUR_KEY, '1'); } catch (_) { /* ignore */ } };
  const show = (tool, stepId, selector) => () => new Promise((resolve) => {
    if (tool) goTool(tool);
    setTimeout(() => { safeBeforeShow(tour, stepId, selector); resolve(); }, 450);
  });
  let n = 0;
  const step = (id, title, text, selector, tool, on = 'bottom') => {
    const i = ++n;
    tour.addStep({
      id, title, text,
      attachTo: selector ? { element: selector, on } : undefined,
      beforeShowPromise: show(tool, id, selector || 'body'),
      when: { show() { injectStepCounter(i, this.getElement()); } },
      buttons: [btnBack(), btnNext],
    });
  };

  n++;
  tour.addStep({
    id: 'cr-welcome',
    title: 'Contract Review — Quick Tour',
    text: 'Upload a contract (PDF or Word) and get a plain-English review: who the parties are, which clauses are risky or unclear for your side and why, what you would have to do and by when, and answers to your questions quoted from the contract. It is informational only: always confirm important decisions with a qualified lawyer.',
    when: { show() { injectStepCounter(1, this.getElement()); } },
    buttons: [btnSecondary('Skip Tour', () => tour.cancel()), { text: 'Start Tour →', action: () => tour.next() }],
  });

  step('cr-check', 'What am I signing up to?',
    'The quickest way in. Press Review a contract, give it a title and drop in the file. Contract Review asks which party you are, then gives you a verdict for your side and every clause that matters.',
    '[data-tour="contract-review-check"]', 'start');

  step('cr-jobs', 'Or start with a job',
    'Pick a narrower job, for example "Check a new revision" or "What do I have to do, and when?". Contract Review opens the right tool, and once you open the contract it moves on to the next step. The bar above each tool shows where you are.',
    '[data-tour="contract-review-jobs"]', 'start');

  step('cr-menu', 'Or pick a tool',
    'Every tool is also in this list. New review and Your contracts work on their own; the tools under This contract need a contract open first and say "Open or start a contract first" until then. The open contract is shown at the top, with a cross to close it. Hover any tool for what it does.',
    '[data-tour="contract-review-menu"]', null, 'right');

  step('cr-new', 'New review',
    'Give the contract a title (only for finding it again) and drop in the PDF or Word (.docx) file, then press Upload & review. The text is pulled out, split into clauses, and the contract type and parties are found straight away.',
    '[data-tour="contract-review-upload"]', 'new');

  step('cr-party', 'Which party are you?',
    'A clause that is risky for a tenant can be standard for a landlord, so the review pauses until you confirm which party is you. Fix a detected name or role there if it is wrong, or add yourself if no party was found. The rest of the review is scored for that party.',
    MAIN, 'review', 'top');

  step('cr-verdict', 'The verdict comes first',
    'Risk review opens with a verdict for your side: Read before you sign when a clause is risky, Worth a closer look when one is unclear, or No risky clauses flagged. Links take you to those clauses or to your obligations. It counts what was flagged; it never says a contract is safe.',
    MAIN, 'review', 'top');

  step('cr-clauses', 'Clauses and risk flags',
    'Below the verdict: the summary, then every clause, Risky, Unclear or Standard, with why it matters and a suggested change to copy into a negotiation (never applied to the document). Verified means the text was matched back to the document. Filter or sort them, and press Not risky for me on a flag that does not apply. Review as a different party starts a separate review for the other side.',
    MAIN, 'review', 'top');

  step('cr-obligations', 'Obligations: what you have to do',
    'Deadlines, notice periods and recurring duties, with who owes each one. Filter by owner, status or date, fix an owner or date, mark one done, Send to Tasks, or Export .ics for your calendar. Obligations in a draft that is not yet signed are labelled as such.',
    MAIN, 'obligations', 'top');

  step('cr-ask', 'Ask about it',
    'Ask in your own words, such as "how much notice do I need to give?". The answer comes from the contract\'s own text and quotes the clause, from any document or revision under the contract.',
    MAIN, 'ask', 'top');

  step('cr-documents', 'Documents, revisions and what changed',
    'Every document and revision under the contract. Upload new revision reviews the new version again and shows What changed by itself. Mark a draft as executed once it is signed, or run a review of a document as another party.',
    MAIN, 'documents', 'top');

  step('cr-compare', 'Compare revisions',
    'Choose whose side to look from, then any two reviewed versions. Each change says whether the risk went up or down and what to do (accept, negotiate or investigate), as a list or in two columns.',
    MAIN, 'compare', 'top');

  step('cr-contracts', 'Your contracts',
    'Every contract you have reviewed, with its type and status. Open one to come back to it, or select several and delete them. Parties & actions holds the parties (link each to a CRM contact), legal hold, expired or terminated, and the history.',
    MAIN, 'contracts', 'top');

  step('cr-report', 'PDF report',
    'Download the review as a PDF (the parties and your role, every flag with its reason and suggested change, and the obligations) or type an email address and send it.',
    MAIN, 'report', 'top');

  step('cr-help', 'Help is always here',
    'The (i) beside the title explains how Contract Review works, and the compass runs this tour again.',
    '[aria-label="How Contract Review works"]', null, 'right');

  const last = ++n;
  tour.addStep({
    id: 'cr-guide',
    title: 'Ask the guide',
    text: 'Not sure where to start? Press the round button and say what you want to do, by typing or talking. The guide points you to the right tools in order. It explains Contract Review; it does not read your contracts or give legal advice.',
    attachTo: { element: '[aria-label="Open the Contract Review guide"]', on: 'left' },
    beforeShowPromise: show('start', 'cr-guide', '[aria-label="Open the Contract Review guide"]'),
    when: { show() { injectStepCounter(last, this.getElement()); } },
    buttons: [btnBack(), { text: 'Finish Tour ✓', action() { done(); tour.complete(); } }],
  });

  tour.on('cancel', done);
  tour.start();
  return tour;
}
