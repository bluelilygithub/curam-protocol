import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css'; // shared vault-tour styles

export const TOUR_KEY = 'vault_tour_finance_completed';

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

function clickFinanceTab(name) {
  const btn = document.querySelector(`[data-finance-tab="${name}"]`);
  if (btn) btn.click();
}

function safeBeforeShow(tour, stepId, selector) {
  const el = document.querySelector(selector);
  if (!el) {
    const step = tour.getById(stepId);
    if (step) step.options.attachTo = undefined;
  }
}

/**
 * Start the Finance product tour.
 * @param {Function} navigate - React Router navigate function
 * @returns {Shepherd.Tour}
 */
export function startFinanceTour(navigate) {
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
    id: 'finance-welcome',
    title: 'Curam Finance — Quick Tour',
    text: "This tour covers the Finance module: invoicing, expenses, wages, the double-entry journal, and the Australian BAS workflow. Everything in one place — no spreadsheet required.",
    when: { show() { injectStepCounter(1); } },
    buttons: [
      btnSecondary('Skip Tour', () => tour.cancel()),
      { text: 'Start Tour →', action: () => tour.next() },
    ],
  });

  // ── Step 2: Tab navigation ────────────────────────────────────────────────
  tour.addStep({
    id: 'finance-tabs',
    title: '8 Tabs — One Module',
    text: "Dashboard · Invoices · Clients · Expenses · Wages · Journal · BAS · Settings. Each tab is a self-contained workspace. The Journal and BAS tabs update automatically as you record transactions — you never touch them manually.",
    attachTo: { element: '[data-tour="finance-tabs"]', on: 'bottom' },
    beforeShowPromise() {
      return new Promise((resolve) => {
        navigate('/finance');
        setTimeout(() => {
          safeBeforeShow(tour, 'finance-tabs', '[data-tour="finance-tabs"]');
          resolve();
        }, 600);
      });
    },
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 3: Dashboard ─────────────────────────────────────────────────────
  tour.addStep({
    id: 'finance-dashboard',
    title: 'Dashboard — Your Numbers at a Glance',
    text: "Revenue YTD, Outstanding, Overdue, Expenses, Wages, and estimated Net Profit — all calculated live from your transactions. Overdue invoices turn amber, negative profit turns red. Check this before any client meeting.",
    attachTo: { element: '[data-tour="finance-dashboard"]', on: 'bottom' },
    beforeShowPromise() {
      return new Promise((resolve) => {
        clickFinanceTab('Dashboard');
        setTimeout(() => {
          safeBeforeShow(tour, 'finance-dashboard', '[data-tour="finance-dashboard"]');
          resolve();
        }, 400);
      });
    },
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 4: Invoices ──────────────────────────────────────────────────────
  tour.addStep({
    id: 'finance-invoices',
    title: 'Invoices — Draft → Sent → Paid',
    text: "Create a line-item invoice with + New Invoice. GST is calculated per line. Send directly from Vault via email — the styled HTML template is sent automatically. Mark as Paid when money arrives. Download a PDF for your records. Overdue invoices are flagged separately in the filter tabs.",
    attachTo: { element: '[data-tour="finance-invoices"]', on: 'bottom' },
    beforeShowPromise() {
      return new Promise((resolve) => {
        clickFinanceTab('Invoices');
        setTimeout(() => {
          safeBeforeShow(tour, 'finance-invoices', '[data-tour="finance-invoices"]');
          resolve();
        }, 400);
      });
    },
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 5: Expenses ──────────────────────────────────────────────────────
  tour.addStep({
    id: 'finance-expenses',
    title: 'Expenses — GST Auto-Calc & Receipts',
    text: "Enter the total amount paid and tick GST Included — Vault calculates the GST component (÷ 11) automatically. Category autocompletes from your history. Attach a receipt PDF or image to any expense — a paperclip icon on the row confirms it's stored.",
    attachTo: { element: '[data-tour="finance-expenses"]', on: 'bottom' },
    beforeShowPromise() {
      return new Promise((resolve) => {
        clickFinanceTab('Expenses');
        setTimeout(() => {
          safeBeforeShow(tour, 'finance-expenses', '[data-tour="finance-expenses"]');
          resolve();
        }, 400);
      });
    },
    when: { show() { injectStepCounter(5); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 6: BAS ───────────────────────────────────────────────────────────
  tour.addStep({
    id: 'finance-bas',
    title: 'BAS — Australian Tax Made Simple',
    text: "Select your quarter and Vault calculates G1 (Total Sales), G11 (Purchases), 1A (GST collected), 1B (GST credits), and Net GST Payable — all from your paid invoices and expenses. Follow the Open → Reconciled → Lodged → Paid workflow. Pre-reconcile warnings flag anything that looks off before you proceed.",
    attachTo: { element: '[data-tour="finance-bas"]', on: 'bottom' },
    beforeShowPromise() {
      return new Promise((resolve) => {
        clickFinanceTab('BAS');
        setTimeout(() => {
          safeBeforeShow(tour, 'finance-bas', '[data-tour="finance-bas"]');
          resolve();
        }, 400);
      });
    },
    when: { show() { injectStepCounter(6); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 7: Journal ───────────────────────────────────────────────────────
  tour.addStep({
    id: 'finance-journal',
    title: 'Journal — Auto-Generated Double Entry',
    text: "Every invoice payment, expense, and wage entry automatically creates a balanced double-entry journal record. You never write journal entries manually — Vault handles the bookkeeping. The Journal tab is your audit trail and accountant-ready ledger.",
    attachTo: { element: '[data-tour="finance-journal"]', on: 'bottom' },
    beforeShowPromise() {
      return new Promise((resolve) => {
        clickFinanceTab('Journal');
        setTimeout(() => {
          safeBeforeShow(tour, 'finance-journal', '[data-tour="finance-journal"]');
          resolve();
        }, 400);
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

  tour.on('cancel', () => {
    localStorage.setItem(TOUR_KEY, '1');
  });

  tour.start();
  return tour;
}
