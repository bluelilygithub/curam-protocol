import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_product_scout_completed';

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

function safeBeforeShow(tour, stepId, selector) {
  const el = document.querySelector(selector);
  if (!el) {
    const step = tour.getById(stepId);
    if (step) step.options.attachTo = undefined;
  }
}

export function startProductScoutTour(navigate) {
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
    id: 'scout-welcome',
    title: 'Amazon Search — Quick Tour',
    text: "Amazon Search is an unbiased purchasing agent. Describe what you're looking for in plain English and it searches Amazon, scores the top results for value (not sponsorship rank), then cross-checks alternatives outside Amazon. This tour shows you how to get a useful result, not just a list.",
    when: { show() { injectStepCounter(1); } },
    buttons: [
      btnSecondary('Skip Tour', () => tour.cancel()),
      { text: 'Start Tour →', action: () => tour.next() },
    ],
  });

  // ── Step 2: Search input ─────────────────────────────────────────────────
  tour.addStep({
    id: 'scout-input',
    title: 'Describe What You Want',
    text: "Start with **Build my guide**: describe the product and any features you care about. Step 2 shows a **key specs** section (measurable requirements tailored to your product type — battery hours, RAM, chuck size, etc.) and a compact **feature grid** where you click tiles to cycle skip → nice → must. Then pick price tiers to search.",
    attachTo: { element: '[data-tour="scout-input"]', on: 'bottom' },
    beforeShowPromise() {
      return new Promise(resolve => {
        navigate('/product-scout');
        setTimeout(() => {
          safeBeforeShow(tour, 'scout-input', '[data-tour="scout-input"]');
          resolve();
        }, 600);
      });
    },
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 3: Results cards ────────────────────────────────────────────────
  tour.addStep({
    id: 'scout-results',
    title: 'Value-Scored Results',
    text: "Results are scored on value — features relative to price — not Amazon's sponsored rank. Each card shows the score rationale so you can see why a cheaper option might rank above a more expensive one. Cards marked with a rating source note where the review data came from.",
    attachTo: { element: '[data-tour="scout-results"]', on: 'top' },
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 4: Feature comparison table ────────────────────────────────────
  tour.addStep({
    id: 'scout-compare',
    title: 'Side-by-Side Feature Table',
    text: "Below the cards, a feature comparison table puts the top picks side by side — price and delivery first, then specs. This makes it easy to spot which product is actually better for your use case rather than just cheaper or more popular.",
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 5: Alternatives ─────────────────────────────────────────────────
  tour.addStep({
    id: 'scout-alternatives',
    title: 'Cross-Market Alternatives',
    text: "After scoring Amazon results, the agent runs a web search for alternatives outside Amazon — other retailers, specialist stores, or refurbished options. These appear below the comparison table. They're not scored the same way, but they're worth checking if the Amazon options don't fit.",
    when: { show() { injectStepCounter(5); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 6: History ──────────────────────────────────────────────────────
  tour.addStep({
    id: 'scout-history',
    title: 'Run History',
    text: "Every search is saved to History so you can revisit results without re-running. Use the bulk delete checkboxes to clear old runs. In Settings → Amazon Search you can adjust the price variance percentage and change the Amazon marketplace region (e.g. amazon.com.au vs amazon.com).",
    when: { show() { injectStepCounter(6); } },
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
