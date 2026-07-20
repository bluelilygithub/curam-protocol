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
    text: "This tool handles three things: structured mortgage and property calculators for common scenarios, a plain-English NLP path for complex multi-event situations, and a qualification check that tells you whether you\'re likely to get a loan approved. All dollar figures come from deterministic maths — the AI never touches the numbers themselves.",
    when: { show() { injectStepCounter(1); } },
    buttons: [
      btnSecondary('Skip Tour', () => tour.cancel()),
      { text: 'Start Tour →', action: () => tour.next() },
    ],
  });

  // ── Step 2: Scenario type picker ─────────────────────────────────────────
  tour.addStep({
    id: 'ps-type-picker',
    title: 'Start by Choosing Your Scenario',
    text: "Instead of a blank text box, you pick what you\'re trying to do: compare lenders or refinance, sell a property, buy a property, run quick calculators, check if you qualify for a loan, or describe a complex multi-event situation in plain English. Simple scenarios go directly to a form — no AI parsing required.",
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
    text: "For Refinance, Sell, and Buy scenarios, you fill in a short form (balance, rate, term, state) and submit directly to the calculation engine. There\'s no LLM parse step, no clarifying question loop, and no risk of a number being misread. The calculation runs immediately and shows what was entered alongside the result so you can verify every figure.",
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 4: Results panels ───────────────────────────────────────────────
  tour.addStep({
    id: 'ps-results',
    title: 'Results — Interpretation, Not Just Numbers',
    text: "Each scenario type has a dedicated plain-English interpretation panel. Refinance shows monthly saving, break-even months, and names the specific CDR bank used. Sell shows net proceeds and CGT — a genuine PPOR gets $0 CGT (main residence exemption), an investment shows indicative tax at three 2025-26 marginal brackets. Buy shows stamp duty (calculated, not estimated), LMI if LVR exceeds 80%, and — for first-home buyers — a First Home Owner Grant cross-reference showing whether your state grant is available and what it pays.",
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 5: Live CDR rates ───────────────────────────────────────────────
  tour.addStep({
    id: 'ps-cdr',
    title: 'Live Rates from 9 Australian Lenders',
    text: "The refinance path fetches live mortgage rates from Australia\'s open banking CDR APIs — CommBank, Westpac, ANZ, NAB, ING, Macquarie, UBank, Up, and Bank of Queensland. No API key needed; these are publicly available. The best available rate below your current rate is used automatically. Rates are labelled Live CDR or Mock (fallback). Switch to the Lenders tab to see all products side by side.",
    when: { show() { injectStepCounter(5); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 6: Quick calculators ────────────────────────────────────────────
  tour.addStep({
    id: 'ps-calculators',
    title: 'Quick Calculators — Your Own Numbers',
    text: "Enter your own loan details and instantly run four standalone calculators: repayment (P&I), extra repayment impact (time and interest saved), offset account benefit, and borrowing power. Borrowing power uses the APRA +3% buffer with an 8.5% floor — consistent with what the major banks actually apply today, not the lower floor from the low-rate era. The figure is explicitly caveated as indicative; it doesn\'t replace a full serviceability assessment.",
    when: { show() { injectStepCounter(6); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 7: Qualification proforma ───────────────────────────────────────
  tour.addStep({
    id: 'ps-qualify',
    title: 'Qualification Proforma — Broker-Style File Review',
    text: "The featured path on the homepage. Runs the same deterministic AU checks as the lite \"Quick check\", then adds risk-rated presentation levers, a curated bank-by-bank posture matrix (indicative broker knowledge — not a credit decision), and live CDR product fit. Overtime/bonus with history is shaded into strict serviceability; genuine-savings holding months and gift portions refine the deposit check. Buy, refinance, and the lite qualify flow can continue into the proforma with figures prefilled. PDF download covers the full review for a broker conversation.",
    when: { show() { injectStepCounter(7); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 8: Lender guidance ──────────────────────────────────────────────
  tour.addStep({
    id: 'ps-lender-guidance',
    title: 'Lender Guidance and Bank Posture',
    text: "If any check fails or warns, results can show \"Lenders likely to discuss your situation\" plus the curated bank posture ranking (CommBank, Westpac, ANZ, NAB, ING, Macquarie, UBank, Up, BOQ). Barrier types map to more flexible lenders — Macquarie, Pepper Money, Liberty, BOQ, Bendigo, La Trobe, and others. Rate premiums and broker tips are included. CDR product fit shows published rates only — it does not predict approval.",
    when: { show() { injectStepCounter(8); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 9: NLP path for complex scenarios ───────────────────────────────
  tour.addStep({
    id: 'ps-nlp',
    title: 'Complex Scenarios — Plain English NLP',
    text: "Choose \"Multiple events at once\" to describe a compound situation in plain English: selling, buying, and switching lender simultaneously. The system pattern-matches all currency amounts, percentages, and dates from your text before the AI sees it — the AI\'s only job is assigning those already-found values to fields, not inventing numbers. Any value with no matching source is stripped and added to the clarifying questions form.",
    when: { show() { injectStepCounter(9); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 10: PDF + follow-ups ─────────────────────────────────────────────
  tour.addStep({
    id: 'ps-pdf',
    title: 'Download, Follow-ups, and Caveats',
    text: "Every result set has a PDF download button. The qualification report PDF includes all 14 checks, the settlement cost breakdown, the rate/income stress test, lender guidance, and the HECS/stamp duty/LMI data — structured to hand directly to a broker or accountant. The Follow-ups tab surfaces suggested questions grounded in your specific numbers (click \"Ask this\" for an AI answer) and accepts your own custom questions. All results carry explicit caveats stating what the tool cannot know: credit history, lender-specific overlays, and anything requiring a professional opinion.",
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
