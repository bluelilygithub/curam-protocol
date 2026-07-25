import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_property_scenario_completed';

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

function safeBeforeShow(tour, stepId, selector) {
  const el = document.querySelector(selector);
  if (!el) {
    const step = tour.getById(stepId);
    if (step) step.options.attachTo = undefined;
  }
}

export function startPropertyScenarioTour(navigate) {
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
    id: 'ps-welcome',
    title: 'Property Scenario — Quick Tour',
    text: "This tool helps you check a home loan file, plan a buy/sell/refinance, and run quick repayment maths. All dollar figures come from deterministic Australian rules — the AI never invents numbers. The recommended start is the Qualification Proforma: a full file review with per-bank indicative capacity.",
    when: { show() { injectStepCounter(1); } },
    buttons: [
      btnSecondary('Skip Tour', () => tour.cancel()),
      { text: 'Start Tour →', action: () => tour.next() },
    ],
  });

  // ── Step 2: Scenario type picker ─────────────────────────────────────────
  tour.addStep({
    id: 'ps-type-picker',
    title: 'Three Groups on the Homepage',
    text: "Cards are grouped: Check my file (Qualification proforma + Lite serviceability check), Plan a transaction (refinance, buy, sell, multi-event), and Quick tools (standalone calculators). The proforma is featured — use the lite check for a fast snapshot, then continue into the full review when you want bank-by-bank capacity.",
    attachTo: { element: '[data-tour="ps-type-picker"]', on: 'bottom' },
    beforeShowPromise() {
      return new Promise(resolve => {
        navigate('/property-scenario');
        setTimeout(() => {
          safeBeforeShow(tour, 'ps-type-picker', '[data-tour="ps-type-picker"]');
          resolve();
        }, 600);
      });
    },
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 3: Structured forms ─────────────────────────────────────────────
  tour.addStep({
    id: 'ps-structured-forms',
    title: 'Structured Forms — No AI, Instant Results',
    text: "For Refinance, Sell, and Buy, you fill a short form and submit straight to the calculation engine — no LLM parse step. Income, deposit, and debt fields you enter in the lite check or proforma are saved in a shared file profile in this browser, so you don\'t re-type when you switch modes.",
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 4: Results panels ───────────────────────────────────────────────
  tour.addStep({
    id: 'ps-results',
    title: 'Results — Interpretation, Not Just Numbers',
    text: "Each scenario type has a plain-English interpretation panel. Refinance shows monthly saving and break-even. Sell shows net proceeds and CGT. Buy shows stamp duty, LMI if LVR exceeds 80%, and first-home grant cross-checks. From buy, refinance, or the lite check you can Continue to the qualification proforma with figures prefilled.",
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 5: Live CDR rates ───────────────────────────────────────────────
  tour.addStep({
    id: 'ps-cdr',
    title: 'Live Rates from 9 Australian Lenders',
    text: "Refinance and the proforma bank panel can fetch live mortgage rates from Australia\'s open banking CDR APIs — CommBank, Westpac, ANZ, NAB, ING, Macquarie, UBank, Up, and Bank of Queensland. Rates are labelled Live CDR or Mock (fallback). CDR is product publication only — it does not predict approval.",
    when: { show() { injectStepCounter(5); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 6: Quick calculators ────────────────────────────────────────────
  tour.addStep({
    id: 'ps-calculators',
    title: 'Quick Calculators — Your Own Numbers',
    text: "Enter your own loan details and run four standalone calculators: repayment (P&I), extra repayment impact, offset benefit, and borrowing power. Borrowing power uses the APRA +3% buffer with an 8.5% floor. The figure is indicative — it doesn\'t replace a full serviceability assessment.",
    when: { show() { injectStepCounter(6); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 7: Qualification proforma ───────────────────────────────────────
  tour.addStep({
    id: 'ps-qualify',
    title: 'Qualification Proforma — Full File Review',
    text: "Runs the same deterministic AU checks as the lite serviceability check, then adds structuring levers, a capacity delta (strict → with levers), and a merged bank panel. Each bank gets an indicative capacity from the same surplus engine with that bank\'s overtime shade, rental shade, and HEM stance — so dollars move by lender (e.g. Macquarie vs CommBank on overtime). Also includes documents they\'d typically ask for, live rate when CDR matches, and supplementary rate-stress analysis. Clearly labelled indicative — not a credit decision.",
    when: { show() { injectStepCounter(7); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 8: Lender guidance ──────────────────────────────────────────────
  tour.addStep({
    id: 'ps-lender-guidance',
    title: 'How Each Bank May See This File',
    text: "The bank panel ranks CommBank, Westpac, ANZ, NAB, ING, Macquarie, UBank, Up, and BOQ with Fit (strong/fair/weak/unsuitable), indicative capacity, and reasons. Fit is scored from capacity headroom, LVR/DTI, and each bank\'s curated knobs — separate from the overall PASS/FAIL verdict. Clean PAYG files still differentiate on FHBG, offset-on-fixed, cashback, and turnaround. Expand \"Documents they\'d typically ask for\" per bank. Curated policy knobs plus CDR rates — not an underwriting system.",
    when: { show() { injectStepCounter(8); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 9: NLP path for complex scenarios ───────────────────────────────
  tour.addStep({
    id: 'ps-nlp',
    title: 'Complex Scenarios — Plain English NLP',
    text: "Choose \"Multiple events at once\" to describe a compound situation in plain English: selling, buying, and switching lender together. Currency amounts, percentages, and dates are pattern-matched from your text before the AI sees them — the AI only assigns those values to fields. Anything without a matching source is stripped and asked in clarifying questions.",
    when: { show() { injectStepCounter(9); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 10: PDF + follow-ups ─────────────────────────────────────────────
  tour.addStep({
    id: 'ps-pdf',
    title: 'PDF Report, Follow-ups, and Caveats',
    text: "The proforma PDF opens with an executive summary: verdict, loan vs capacity, top actions, and a capacity-by-bank table. Later pages cover severity-ordered checks, levers, the full bank panel, and supplementary rate/income stress. Follow-ups on scenario results let you ask grounded questions. All results carry caveats: this is educational, not pre-approval, and not a substitute for a licensed broker.",
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

  tour.on('cancel', () => localStorage.setItem(TOUR_KEY, '1'));
  tour.start();
  return tour;
}
