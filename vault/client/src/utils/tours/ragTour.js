import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_rag_completed';

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
  return () =>
    new Promise((resolve) => {
      requestAnimationFrame(() => {
        const step = tour.getById(stepId);
        if (step && !document.querySelector(selector)) {
          step.updateStepOptions({ attachTo: {} });
        }
        resolve();
      });
    });
}

/**
 * Start the RAG & File Context product tour.
 * @param {Function} navigate - React Router navigate function
 * @param {string|number} projectId - ID of the project to tour
 * @returns {Shepherd.Tour}
 */
export function startRagTour(navigate, projectId) {
  if (Shepherd.activeTour) {
    Shepherd.activeTour.cancel();
  }

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

  const btnSecondary = (text, action) => ({
    text,
    action,
    classes: 'vault-tour-btn-secondary',
  });

  const btnBack = () => btnSecondary('← Back', () => tour.back());
  const btnNext = { text: 'Next →', action: () => tour.next() };

  // ── Step 1: Welcome ───────────────────────────────────────────────────────
  tour.addStep({
    id: 'rag-welcome',
    title: 'Project Context & RAG — Quick Tour',
    text: "Every project in Vault is a persistent AI context. Whatever you add here — descriptions, files, pinned web pages — is automatically included in every chat inside this project. Claude always knows the full picture.",
    when: { show() { injectStepCounter(1); } },
    buttons: [
      btnSecondary('Skip Tour', () => tour.cancel()),
      { text: 'Start Tour →', action: () => tour.next() },
    ],
  });

  // ── Step 2: Project context form ──────────────────────────────────────────
  tour.addStep({
    id: 'rag-form',
    title: 'Project Context Fields',
    text: "Fill in Goal, Problem, Target Audience, Tech Stack, and more. These fields are injected into Claude's system prompt for every chat in this project — the more detail you add, the more relevant and precise Claude's responses will be.",
    attachTo: { element: '[data-tour="rag-project-form"]', on: 'right' },
    beforeShowPromise() {
      return new Promise((resolve) => {
        if (projectId) navigate(`/projects/${projectId}`);
        setTimeout(resolve, 600);
      });
    },
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 3: AI Model picker ───────────────────────────────────────────────
  tour.addStep({
    id: 'rag-model',
    title: 'Default AI Model',
    text: "Choose which Claude model this project defaults to. Sonnet is the best balance of speed and quality for most work. Opus delivers deeper reasoning for complex research. Haiku is fastest for high-volume tasks. You can override this per-chat from the chat header.",
    attachTo: { element: '[data-tour="rag-model-picker"]', on: 'top' },
    beforeShowPromise: safeBeforeShow(tour, 'rag-model', '[data-tour="rag-model-picker"]'),
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 4: Pinned URLs ───────────────────────────────────────────────────
  tour.addStep({
    id: 'rag-pinned-urls',
    title: 'Pinned Web Pages',
    text: "Paste any URL — docs, articles, API references, YouTube videos — and Vault fetches and stores the content. It's included in Claude's context for every chat automatically. YouTube links are transcribed. Refresh a URL anytime to pull the latest content.",
    attachTo: { element: '[data-tour="rag-pinned-urls"]', on: 'top' },
    beforeShowPromise: safeBeforeShow(tour, 'rag-pinned-urls', '[data-tour="rag-pinned-urls"]'),
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 5: File uploads ──────────────────────────────────────────────────
  tour.addStep({
    id: 'rag-files',
    title: 'Uploaded Files',
    text: "Upload PDFs, Word docs, spreadsheets, images, code files — Vault extracts the text and adds it to context. Type <code>@files</code> in any chat message to explicitly reference your uploaded files, or just ask naturally — Claude already has them in context.",
    attachTo: { element: '[data-tour="rag-files"]', on: 'top' },
    beforeShowPromise: safeBeforeShow(tour, 'rag-files', '[data-tour="rag-files"]'),
    when: { show() { injectStepCounter(5); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 6: Start chatting ────────────────────────────────────────────────
  tour.addStep({
    id: 'rag-chat',
    title: 'Chat with Full Context',
    text: "Once your context is set up, hit <strong>Chat</strong> in the project header to start a conversation. Every message automatically includes your project fields, pinned pages, and uploaded files. No need to copy-paste context ever again.",
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

  tour.on('cancel', () => {
    localStorage.setItem(TOUR_KEY, '1');
  });

  tour.start();
  return tour;
}
