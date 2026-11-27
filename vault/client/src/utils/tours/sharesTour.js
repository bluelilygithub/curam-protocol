import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_shares_completed';

const TOTAL_STEPS = 11;

function injectStepCounter(stepIndex, totalSteps = TOTAL_STEPS) {
  requestAnimationFrame(() => {
    // The current step's own box: Shepherd keeps earlier steps' boxes in the page, so the first match was step 1's (fixed 2026-11-28).
    const el = Shepherd.activeTour?.getCurrentStep()?.getElement() || document.querySelector('.shepherd-element.vault-tour');
    if (!el) return;
    let counter = el.querySelector('.vault-tour-step-count');
    if (!counter) {
      counter = document.createElement('div');
      counter.className = 'vault-tour-step-count';
      const footer = el.querySelector('.shepherd-footer');
      if (footer) footer.parentNode.insertBefore(counter, footer);
    }
    counter.textContent = `Step ${stepIndex} of ${totalSteps}`;
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
export function startSharesTour(setTab, { isAdmin = false } = {}) {
  if (Shepherd.activeTour) Shepherd.activeTour.cancel();
  const totalSteps = isAdmin ? TOTAL_STEPS + 1 : TOTAL_STEPS;
  const showCount = (n) => injectStepCounter(n, totalSteps);

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
    when: { show() { showCount(n); } },
    buttons: last
      ? [btnBack(), { text: 'Finish Tour ✓', action() { done(); tour.complete(); } }]
      : [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'shares-welcome',
    title: 'Shares — Quick Tour',
    text: 'Shares is your private share portfolio: every buy, sell and dividend you record becomes your holdings, profit and loss, capital gains working and a pack for your accountant. It also keeps AI news briefings, answers questions about your own data and tests your reasons for owning each share. This tour visits each part. Nothing is bought or sold, and nothing here is advice.',
    when: { show() { showCount(1); } },
    buttons: [btnSecondary('Skip Tour', () => { done(); tour.cancel(); }), { text: 'Start Tour →', action: () => tour.next() }],
  });

  step(2, 'shares-refresh', 'Quotes and the menu',
    'Refresh quotes asks for fresh prices; quotes can be up to 15 minutes old and the time of the last update shows beside the title. Everything is organised in the menu on the left; search it, or press / to jump to the search box.',
    '[data-tour="shares-refresh"]', 'right', 'portfolio');

  step(3, 'shares-records', 'Trades and Cash are the source',
    'Portfolio, CGT, Charts and the accountant pack are all worked out from two lists you keep: Trades (every buy and sell, in Australian dollars) and Cash (deposits, withdrawals, dividends and fees). Fix a figure there and everything else follows. Deleting a trade changes the totals, so the page asks first.',
    '[data-tour="shares-tab-trades"]', 'right', 'trades');

  step(4, 'shares-tax', 'Capital gains and the accountant',
    'CGT works out each sale parcel by parcel (oldest first, with the 12-month discount test) for a chosen financial year. Statements reads dividend lines from a broker PDF into a review queue; nothing is applied until you approve it. Accountant pack builds the year\'s PDF, Excel file and zip. These are working records, not tax advice: your accountant decides what is taxed.',
    '[data-tour="shares-tab-cgt"]', 'right', 'cgt');

  step(5, 'shares-insight', 'Charts and News',
    'Charts has six panels. Movement: your holdings against the indexes, each holding against its sector index, and drawdown against the alert triggers. Performance: portfolio value, relative performance and price by holding. Holdings: allocation and Return by holding (% vs cost, or A$ open + closed). Then Calendar & patterns, Metals and Dividends. Cards with no tag follow the range you pick. News writes a short AI briefing per holding each morning (bullish, bearish, watch or neutral) and a 30-day summary. Each bullish or bearish signal is also kept and scored later (see Track record on the Thesis tab). They are information, not advice.',
    '[data-tour="shares-tab-news"]', 'right', 'news');

  step(6, 'shares-questions', 'Questions',
    'Ask about your own portfolio in plain words, such as your biggest position or what a sale would have returned. Answers use only your stored data, quote the figures and are saved so you can look back. It explains numbers; it never says what to buy or sell.',
    '[data-tour="shares-tab-questions"]', 'right', 'questions');

  step(7, 'shares-thesis', 'Thesis',
    'Write why you own a share, the assumptions that must stay true and the red lines that would prove you wrong. Check & review tests them against your stored trades, news briefings and, for US shares, reported figures such as margins and growth, and says whether the thesis is intact, weakening or broken. Before it decides, a bear case argues against each assumption and a bull case for it; open "Stress test" under a check to read both. It cannot read company filings, so thin evidence shows as "not enough evidence". Save each rethink as a new revision; past checks are kept so you can see drift.',
    '[data-tour="shares-tab-thesis"]', 'right', 'thesis');

  step(8, 'shares-track-record', 'Track record',
    'Every bullish or bearish news signal and every thesis verdict is saved with the price that day, then compared with how the share did against its index 30 and 90 days later. This card shows how often each kind of call was right. Thesis checks read it too, to sound only as sure as the record allows; it never changes a rating. It appears once the first call is recorded, and the first results take 30 days.',
    '[data-tour="shares-track-record"]', 'left', 'thesis');

  step(9, 'shares-watchlist', 'Watchlist',
    'Companies you are looking at but do not hold. Research writes a dated report and draws it as a visual page: verdict tiles (the analyst consensus that named sources published, moat, valuation, growth), the central question, a moat scorecard, competitors, reported figures for US shares, every published price target against today\'s price, what the price assumes, and the risks. Each claim has a numbered chip that opens its source. The full written report, with what changed and how it fits your portfolio, is at the bottom; Download and the ⋯ menu give it as Markdown. Vault never says how much to buy.',
    '[data-tour="shares-tab-watchlist"]', 'right', 'watchlist');

  if (isAdmin) {
    step(10, 'shares-compliance', 'Compliance (admins only)',
      'A monthly check of a fixed ATO page list writes an in-app note on changes that may matter for your share records, with source links and an action to consider. It is general information, not tax or legal advice: check the ATO page and your accountant. Reports are kept until you delete them, and deleted reports can be restored from the recycle bin.',
      '[data-tour="shares-tab-compliance"]', 'right', 'compliance');
  }

  const metalsStep = isAdmin ? 11 : 10;
  const helpStep = isAdmin ? 12 : 11;
  step(metalsStep, 'shares-metals', 'Metals',
    'A separate book for physical gold: ounces, cost, current spot value and unrealised profit, with a price history and a drop alert. It is kept apart from your share holdings.',
    '[data-tour="shares-tab-metals"]', 'right', 'metals');

  step(helpStep, 'shares-help', 'Help is one tap away',
    'The (i) at the top of this menu explains how Shares works, and the round guide button at the bottom right answers questions like "how do I add a share I bought?" or "what do I give my accountant?" and points at the right tab. Take this tour again any time from the compass beside the title or from Settings → Tours.',
    '[data-tour="shares-menu"]', 'right', 'portfolio', true);

  tour.on('cancel', done);
  tour.start();
  return tour;
}
