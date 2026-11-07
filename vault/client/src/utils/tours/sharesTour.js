import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_shares_completed';

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
      if (footer) footer.parentNode.insertBefore(counter, footer);
    }
    counter.textContent = `Step ${stepIndex} of ${TOTAL_STEPS}`;
  });
}

// A part of the page may not be there (a tab the person cannot see): show that step in the middle of the screen instead of failing.
function safeBeforeShow(tour, stepId, selector) {
  if (!document.querySelector(selector)) {
    const step = tour.getById(stepId);
    if (step) step.options.attachTo = undefined;
  }
}

// setTab switches the Shares page to a tab so the content behind the highlight matches what the step says.
export function startSharesTour(setTab) {
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

  const done = () => { try { localStorage.setItem(TOUR_KEY, '1'); } catch (_) { /* ignore */ } setTab?.('portfolio'); };
  const btnSecondary = (text, action) => ({ text, action, classes: 'vault-tour-btn-secondary' });
  const btnBack = () => btnSecondary('← Back', () => tour.back());
  const btnNext = { text: 'Next →', action: () => tour.next() };
  // Switch to a tab (when given), give it a moment to draw, then attach to the element if it is there.
  const before = (stepId, selector, tab) => () => new Promise((resolve) => {
    if (tab) setTab?.(tab);
    setTimeout(() => { safeBeforeShow(tour, stepId, selector); resolve(); }, tab ? 350 : 0);
  });
  const step = (n, id, title, text, selector, on, tab, last = false) => tour.addStep({
    id, title, text,
    attachTo: { element: selector, on },
    beforeShowPromise: before(id, selector, tab),
    when: { show() { injectStepCounter(n); } },
    buttons: last
      ? [btnBack(), { text: 'Finish Tour ✓', action() { done(); tour.complete(); } }]
      : [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'shares-welcome',
    title: 'Shares — Quick Tour',
    text: 'Shares is your private share portfolio: every buy, sell and dividend you record becomes your holdings, profit and loss, capital gains working and a pack for your accountant. It also keeps AI news briefings, answers questions about your own data and tests your reasons for owning each share. This tour visits each part. Nothing is bought or sold, and nothing here is advice.',
    when: { show() { injectStepCounter(1); } },
    buttons: [btnSecondary('Skip Tour', () => { done(); tour.cancel(); }), { text: 'Start Tour →', action: () => tour.next() }],
  });

  step(2, 'shares-refresh', 'Quotes and the tab row',
    'Refresh quotes asks for fresh prices; quotes can be up to 15 minutes old and the time of the last update shows beside the title. Everything below is organised in tabs along this row.',
    '[data-tour="shares-refresh"]', 'bottom', 'portfolio');

  step(3, 'shares-records', 'Trades and Cash are the source',
    'Portfolio, CGT, Charts and the accountant pack are all worked out from two lists you keep: Trades (every buy and sell, in Australian dollars) and Cash (deposits, withdrawals, dividends and fees). Fix a figure there and everything else follows. Deleting a trade changes the totals, so the page asks first.',
    '[data-tour="shares-tab-trades"]', 'bottom', 'trades');

  step(4, 'shares-tax', 'Capital gains and the accountant',
    'CGT works out each sale parcel by parcel (oldest first, with the 12-month discount test) for a chosen financial year. Statements reads dividend lines from a broker PDF into a review queue; nothing is applied until you approve it. Accountant pack builds the year\'s PDF, Excel file and zip. These are working records, not tax advice: your accountant decides what is taxed.',
    '[data-tour="shares-tab-cgt"]', 'bottom', 'cgt');

  step(5, 'shares-insight', 'Charts and News',
    'Charts compare your portfolio with benchmarks and show who beat or lagged the market, drawdowns, sector mix and an earnings timeline. News writes a short AI briefing per holding each morning (bullish, bearish, watch or neutral) and a 30-day summary. They are information, not advice.',
    '[data-tour="shares-tab-news"]', 'bottom', 'news');

  step(6, 'shares-questions', 'Questions',
    'Ask about your own portfolio in plain words, such as your biggest position or what a sale would have returned. Answers use only your stored data, quote the figures and are saved so you can look back. It explains numbers; it never says what to buy or sell.',
    '[data-tour="shares-tab-questions"]', 'bottom', 'questions');

  step(7, 'shares-thesis', 'Thesis',
    'Write why you own a share, the assumptions that must stay true and the red lines that would prove you wrong. Check now tests them against your stored trades and news briefings and says whether the thesis is intact, weakening or broken. It cannot read company filings, so thin evidence shows as "not enough evidence". Past checks are kept so you can see drift.',
    '[data-tour="shares-tab-thesis"]', 'bottom', 'thesis');

  step(8, 'shares-metals', 'Metals',
    'A separate book for physical gold: ounces, cost, current spot value and unrealised profit, with a price history and a drop alert. It is kept apart from your share holdings.',
    '[data-tour="shares-tab-metals"]', 'bottom', 'metals');

  step(9, 'shares-help', 'Help is one tap away',
    'The (i) beside the title explains how Shares works, and the round guide button at the bottom right answers questions like "how do I add a share I bought?" or "what do I give my accountant?" and points at the right tab. Take this tour again any time from the link beside the title or from Settings → Tours.',
    '[data-tour="shares-info"]', 'bottom', 'portfolio', true);

  tour.on('cancel', done);
  tour.start();
  return tour;
}
