import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_property_scenario_completed';

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
    text: "Property Scenario is a mortgage and property calculator with a natural-language front door. Describe a refinance, sale, purchase, or lender switch in plain English and Vault extracts the numbers, asks clarifying questions, and runs the full calculation — stamp duty, CGT, break costs, and more. This tour covers both paths.",
    when: { show() { injectStepCounter(1); } },
    buttons: [
      btnSecondary('Skip Tour', () => tour.cancel()),
      { text: 'Start Tour →', action: () => tour.next() },
    ],
  });

  // ── Step 2: Two modes ────────────────────────────────────────────────────
  tour.addStep({
    id: 'ps-modes',
    title: 'Two Entry Points',
    text: "There are two tabs at the top: Describe your situation (the live NLP path — you type, it parses) and See an example (a pre-calculated compound scenario showing all the output components). Start with the example to understand what a finished result looks like before entering your own numbers.",
    attachTo: { element: '[data-tour="ps-mode-tabs"]', on: 'bottom' },
    beforeShowPromise() {
      return new Promise(resolve => {
        navigate('/property-scenario');
        setTimeout(() => {
          safeBeforeShow(tour, 'ps-modes', '[data-tour="ps-mode-tabs"]');
          resolve();
        }, 600);
      });
    },
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 3: Describe path ────────────────────────────────────────────────
  tour.addStep({
    id: 'ps-describe',
    title: 'Describe Your Situation',
    text: "Type your scenario in plain English — \"I'm selling my Sydney home for $1.4m (bought 2016 for $820k), buying in Randwick for $1.85m with 20% deposit, and switching the new loan to 5.3% with OnlineBank.\" Include dollar amounts, percentages, and dates where you know them. The more specific you are, the fewer clarifying questions you'll get.",
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 4: Pre-extraction ───────────────────────────────────────────────
  tour.addStep({
    id: 'ps-grounding',
    title: 'Numbers Are Verified, Not Invented',
    text: "Before the AI processes your text, every currency amount, percentage, duration, and date is extracted by pattern matching. The AI's job is to assign those already-found values to scenario fields — not invent new ones. Any value the AI produces without a matching source in your text is stripped and flagged as a gap to clarify.",
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 5: Clarifying form ──────────────────────────────────────────────
  tour.addStep({
    id: 'ps-clarify',
    title: 'Clarifying Questions',
    text: "If your text left anything ambiguous — state, PPOR status, deposit source, fixed-rate period vs loan term — a form appears asking just those specific questions. Answer them and submit. The scenario recalculates automatically once everything needed is resolved.",
    when: { show() { injectStepCounter(5); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 6: Results ──────────────────────────────────────────────────────
  tour.addStep({
    id: 'ps-results',
    title: 'Scenario Tab — Costs at a Glance',
    text: "Once calculated, the Scenario tab shows total costs, stamp duty, deposit funded from sale proceeds, and monthly repayment saving — all wired together through the event sequence. The cash-flow timeline shows every money movement in order, including dependency flows (sale proceeds → deposit).",
    when: { show() { injectStepCounter(6); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 7: Lenders + CDR rates ──────────────────────────────────────────
  tour.addStep({
    id: 'ps-lenders',
    title: 'Lenders Tab — Live Rates + Document Insights',
    text: "The Lenders tab shows live rates fetched from Australian bank CDR Product Reference Data APIs — no API key needed, they're publicly available. Each row is labelled CDR (live) or MOCK (fallback), and fees are marked estimated. Below the comparison table, the Ask panel lets you read a bank's actual T&Cs or PDS and ask open questions — every answer must cite the document.",
    when: { show() { injectStepCounter(7); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 8: Honesty & caveats ─────────────────────────────────────────────
  tour.addStep({
    id: 'ps-honesty',
    title: 'What This Tool Is (and Isn\'t)',
    text: "Every result carries caveats — CGT is not tax advice, stamp duty is an estimate, borrowing power is indicative only. The Follow-ups tab surfaces the most significant gaps and generates a list of things to raise with your broker or tax agent. Nothing here replaces professional advice; it gives you structured numbers to walk into that conversation with.",
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
