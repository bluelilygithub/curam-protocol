import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_recipes_completed';

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
  const el = document.querySelector(selector);
  if (!el) {
    const step = tour.getById(stepId);
    if (step) step.options.attachTo = undefined;
  }
}

export function startRecipesTour(navigate) {
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
    id: 'recipes-welcome',
    title: 'Recipes — Quick Tour',
    text: "Recipes is a cooking assistant with three modes: turn leftovers into meal ideas, look up a recipe by name at any skill level, and get live Coles/Woolworths grocery prices for any recipe. This tour walks through all three.",
    when: { show() { injectStepCounter(1); } },
    buttons: [
      btnSecondary('Skip Tour', () => tour.cancel()),
      { text: 'Start Tour →', action: () => tour.next() },
    ],
  });

  // ── Step 2: Leftover recipes ─────────────────────────────────────────────
  tour.addStep({
    id: 'recipes-leftovers',
    title: 'Leftover Recipes — Use What You Have',
    text: "On the Create tab, type in whatever ingredients you have on hand — \"chicken, spinach, lemon, feta\" — and hit Generate. Vault returns four recipe cards based on what you actually have, ranked by how well they use your ingredients. No need to list quantities.",
    attachTo: { element: '[data-tour="recipes-create-tab"]', on: 'bottom' },
    beforeShowPromise() {
      return new Promise(resolve => {
        navigate('/recipes');
        setTimeout(() => {
          safeBeforeShow(tour, 'recipes-leftovers', '[data-tour="recipes-create-tab"]');
          resolve();
        }, 600);
      });
    },
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 3: Recipe cards ─────────────────────────────────────────────────
  tour.addStep({
    id: 'recipes-cards',
    title: 'Recipe Cards — Click to Expand',
    text: "Each card shows the dish name, a short description, and key ingredients. Click a card to expand it into the full recipe: step-by-step method, nutrition per serve, useful links, and an auto-generated dish photo. The photo uses your configured AI image model.",
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 4: Recipe by name ───────────────────────────────────────────────
  tour.addStep({
    id: 'recipes-by-name',
    title: 'Recipe by Name — Any Skill Level',
    text: "Switch to the By Name tab and type any dish — \"beef bourguignon\" or \"sourdough bread\". Choose Basic (weeknight friendly), Advanced (more technique), or Master (chef-level). Each tier includes ingredient swap suggestions for dietary needs or substitutions.",
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 5: Grocery prices ───────────────────────────────────────────────
  tour.addStep({
    id: 'recipes-prices',
    title: 'Live Grocery Prices — Coles & Woolworths',
    text: "Inside any expanded recipe, click Get prices to fetch live Coles and Woolworths prices for each ingredient. Prices are sourced from Google Shopping search — every row cites its source link. Unmatched items show \"Not found\" with a manual search link rather than a guessed price.",
    when: { show() { injectStepCounter(5); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 6: Shop tab ─────────────────────────────────────────────────────
  tour.addStep({
    id: 'recipes-shop',
    title: 'Shop Tab — Standalone Price Lookup',
    text: "The Shop tab lets you look up grocery prices independently — paste in any ingredient list without needing a full recipe. Useful for meal planning or comparing what's cheap at each store this week.",
    when: { show() { injectStepCounter(6); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 7: Library ──────────────────────────────────────────────────────
  tour.addStep({
    id: 'recipes-library',
    title: 'Library — Save What You Like',
    text: "Click Save on any expanded recipe to add it to your Library. Saved recipes include the full method, ingredients, photo, and tags so you can filter later. The Library tab shows all your saved recipes with search and tag filters.",
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

  tour.on('cancel', () => localStorage.setItem(TOUR_KEY, '1'));
  tour.start();
  return tour;
}
