import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css'; // shared vault-tour styles

export const TOUR_KEY = 'vault_tour_finance_completed';

const TOTAL_STEPS = 9;

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
    text: "This tour covers the Finance module: invoices, quotes, expenses, wages, the double-entry journal, BAS, and automated reminders. Built for a small Australian business — no spreadsheet required.",
    when: { show() { injectStepCounter(1); } },
    buttons: [
      btnSecondary('Skip Tour', () => tour.cancel()),
      { text: 'Start Tour →', action: () => tour.next() },
    ],
  });

  // ── Step 2: Tab navigation ────────────────────────────────────────────────
  tour.addStep({
    id: 'finance-tabs',
    title: '16 Tabs — One Module',
    text: "Dashboard · Invoices · Quotes · Clients · Suppliers · Expenses · Recurring · Wages · Interest · Journal · Accounts · Codes · BAS · Position · Balances · Settings. The Journal and BAS tabs update automatically as you record transactions.",
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

  // ── Step 4: Invoices & Quotes ─────────────────────────────────────────────
  tour.addStep({
    id: 'finance-invoices',
    title: 'Invoices & Quotes',
    text: "Create line-item invoices or quotes. GST is calculated per line — use the <strong>N-T</strong> option for non-taxable items. The <strong>⊞</strong> button next to Unit Price opens a calculator. The due date defaults to your configured payment terms. Send directly from Vault — the email includes a <strong>PDF attachment</strong> and goes to the client's address pre-filled from their record. Convert a quote to an invoice in one click.",
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
    text: "Enter the total amount paid and tick GST Included — Vault calculates the GST component (÷ 11) automatically. Category autocompletes from your history. Attach a receipt PDF or image to any expense. For recurring bills (subscriptions, rent, etc.) set up a schedule in the <strong>Recurring</strong> tab.",
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

  // ── Step 6: Recurring ─────────────────────────────────────────────────────
  tour.addStep({
    id: 'finance-recurring',
    title: 'Recurring — Set & Forget',
    text: "Set up weekly, fortnightly, monthly, quarterly, or annual schedules for invoices or expenses. Invoices are created as <strong>drafts</strong> each cycle so you can review before sending. Expenses are recorded automatically. Pause or resume any schedule at any time.",
    attachTo: { element: '[data-tour="finance-recurring"]', on: 'bottom' },
    beforeShowPromise() {
      return new Promise((resolve) => {
        clickFinanceTab('Recurring');
        setTimeout(() => {
          safeBeforeShow(tour, 'finance-recurring', '[data-tour="finance-recurring"]');
          resolve();
        }, 400);
      });
    },
    when: { show() { injectStepCounter(6); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 7: BAS ───────────────────────────────────────────────────────────
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
    when: { show() { injectStepCounter(7); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 8: Journal ───────────────────────────────────────────────────────
  tour.addStep({
    id: 'finance-journal',
    title: 'Journal — Auto-Generated Double Entry',
    text: "Journal entries are created automatically when an invoice is <strong>sent</strong> (not on draft save), when a payment is recorded, and when expenses or wages are entered. Deleting a record also cleans up its journal. Superannuation on wages is journalled as Super Payable. You can also add manual entries for adjustments.",
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
    when: { show() { injectStepCounter(8); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 9: Exports & Reminders ───────────────────────────────────────────
  tour.addStep({
    id: 'finance-exports',
    title: 'Exports & Reminders',
    text: "Export to <strong>MYOB</strong> (general journal CSV) or <strong>Excel</strong> (real .xlsx with three sheets: Expenses, Invoices, Wages) for your accountant. Every Monday morning, Vault sends you an overdue-items summary <em>and</em> individual reminder emails directly to each overdue client. Configure the send time and admin email in <strong>Settings</strong>.",
    beforeShowPromise() {
      return new Promise((resolve) => {
        navigate('/finance');
        setTimeout(resolve, 400);
      });
    },
    when: { show() { injectStepCounter(9); } },
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
