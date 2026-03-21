import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_graph_completed';

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

export function startGraphTour(navigate) {
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

  // ── Step 1: Welcome ───────────────────────────────────────────────────────
  tour.addStep({
    id: 'graph-welcome',
    title: 'Knowledge Graph — Quick Tour',
    text: "The Knowledge Graph maps every project, file, note, task, goal, session, and pinned URL in your vault as nodes, connected by their relationships. It gives you a bird's-eye view of how your work is connected — and uses AI to surface patterns you might not notice.",
    when: { show() { injectStepCounter(1); } },
    buttons: [
      btnSecondary('Skip Tour', () => tour.cancel()),
      { text: 'Start Tour →', action: () => tour.next() },
    ],
  });

  // ── Step 2: The toolbar ───────────────────────────────────────────────────
  tour.addStep({
    id: 'graph-toolbar',
    title: 'Toolbar — Search & Controls',
    text: "Type in the search box to highlight matching nodes across the graph — matching nodes glow amber. Use the Filter button to show or hide node types by preset (All / Work / Tasks & Goals) or per-type checkbox. The node and connection counts on the right update as you filter.",
    attachTo: { element: '[data-tour="graph-toolbar"]', on: 'bottom' },
    beforeShowPromise() {
      return new Promise(resolve => {
        navigate('/graph');
        setTimeout(() => {
          safeBeforeShow(tour, 'graph-toolbar', '[data-tour="graph-toolbar"]');
          resolve();
        }, 700);
      });
    },
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 3: Navigating the graph ──────────────────────────────────────────
  tour.addStep({
    id: 'graph-navigate',
    title: 'Navigating the Canvas',
    text: "Scroll to zoom, drag the background to pan. Click a node to select it — a detail panel appears on the right with the node's title, type, and a Go to button to open it. Hover a node to highlight all its direct connections and dim everything else. Click the background to deselect.",
    attachTo: { element: '[data-tour="graph-canvas"]', on: 'right' },
    beforeShowPromise() {
      return new Promise(resolve => {
        setTimeout(() => {
          safeBeforeShow(tour, 'graph-navigate', '[data-tour="graph-canvas"]');
          resolve();
        }, 300);
      });
    },
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 4: Semantic connections ──────────────────────────────────────────
  tour.addStep({
    id: 'graph-semantic',
    title: 'Semantic Connections — AI-Detected Links',
    text: "Click Find connections to run an embedding analysis across all your files, notes, and sessions. Vault computes vector similarity and draws dashed pink lines between content that is conceptually related — even if there's no explicit link between them. Use the semantic toggle to show or hide these lines once computed.",
    attachTo: { element: '[data-tour="graph-semantic-btn"]', on: 'bottom' },
    beforeShowPromise() {
      return new Promise(resolve => {
        setTimeout(() => {
          safeBeforeShow(tour, 'graph-semantic', '[data-tour="graph-semantic-btn"]');
          resolve();
        }, 300);
      });
    },
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 5: AI Insights ───────────────────────────────────────────────────
  tour.addStep({
    id: 'graph-insights',
    title: 'AI Insights — Patterns in Your Work',
    text: "Click the Insights button to open the insights panel. Vault analyses your graph structure and content to surface 3–5 observations about your work patterns — which projects are most connected, where your attention is concentrated, orphaned content, and emerging themes. Insights are cached; click Refresh to regenerate with fresh data.",
    attachTo: { element: '[data-tour="graph-insights-btn"]', on: 'bottom' },
    beforeShowPromise() {
      return new Promise(resolve => {
        setTimeout(() => {
          safeBeforeShow(tour, 'graph-insights', '[data-tour="graph-insights-btn"]');
          resolve();
        }, 300);
      });
    },
    when: { show() { injectStepCounter(5); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 6: Node types & colours ─────────────────────────────────────────
  tour.addStep({
    id: 'graph-node-types',
    title: 'Node Types & Shapes',
    text: "Every node type has a distinct shape and colour: Projects are indigo circles, Goals are purple hexagons, Tasks are orange diamonds, Notes are amber rounded rectangles, Files are blue rectangles, Sessions are green circles, and Pinned URLs are teal circles. Link colours indicate relationship type — orange for subtasks, purple for key results, red for blockers.",
    when: { show() { injectStepCounter(6); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 7: Focus preset ──────────────────────────────────────────────────
  tour.addStep({
    id: 'graph-focus',
    title: '"This Project" Focus',
    text: "Select any project node on the canvas, then open the Filter panel and click This Project. Vault instantly filters the graph to show only that project and everything directly connected to it — its files, tasks, goals, and notes — and zooms to fit. It's the fastest way to review the full scope of a single project.",
    attachTo: { element: '[data-tour="graph-filter-btn"]', on: 'bottom' },
    beforeShowPromise() {
      return new Promise(resolve => {
        setTimeout(() => {
          safeBeforeShow(tour, 'graph-focus', '[data-tour="graph-filter-btn"]');
          resolve();
        }, 300);
      });
    },
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
