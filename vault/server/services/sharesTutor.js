'use strict';

// The Shares guide (the round button on Vault's /shares page): a person says what they want to do ("add a share I bought", "what do I
// owe in capital gains", "get my accountant the year's figures") and the guide points at the real tabs, in order, or says plainly that
// Shares does not do it. It only knows what is written here and it never sees any holding, price or figure. It never recommends buying
// or selling and never gives tax advice (tax questions get the "accountant" verdict). Built on guideCore.js; the ids are the page's own
// tab ids (TABS in client/src/pages/SharesPage.jsx, a test keeps the two in step).
// See docs/guide-chat.md.

const { createGuide, REPLY_FORMAT } = require('./guideCore');

const CATALOG = [
  { id: 'portfolio', label: 'Portfolio', group: 'Overview',
    does: 'Current holdings with live quotes, value, profit and loss that has not been banked yet (unrealised) and profit already banked from sales (realised), dividend totals for the financial year, and the Refresh quotes button at the top of the page. Click a holding to see its parcels.',
    notes: 'Realised profit here uses average cost, so it can differ from the CGT tab, which matches parcels first-in first-out. Quotes can be up to 15 minutes old.' },
  { id: 'trades', label: 'Trades', group: 'Records',
    does: 'The list of every buy and sell. Add a trade with the form (symbol, exchange ASX/NYSE/NASDAQ, date, quantity, price, brokerage), edit one, or delete one. Everything else on the page is worked out from these.',
    notes: 'Prices are entered in Australian dollars. Deleting a trade changes the portfolio and the capital gains figures.' },
  { id: 'cash', label: 'Cash', group: 'Records',
    does: 'The cash ledger: deposits, withdrawals, dividends, interest and fees. Each dividend shows gross, tax withheld and net (the cash received), and can be edited.',
    notes: 'The amount stored for a dividend is always the net cash received. For a broker that shows net only, the gross is estimated and marked as derived.' },
  { id: 'cgt', label: 'CGT', group: 'Tax records',
    does: 'Capital gains for one financial year, worked out for each purchase parcel in Australian dollars: first-in first-out matching, trade date (not settlement), the 12-month discount test, and losses applied before the discount. Pick the year at the top; there is a CSV export. It also flags sales with no matching purchase.',
    notes: 'A working record to hand to the accountant, not tax advice. Whether a gain is taxed, and how, is the accountant\'s call.' },
  { id: 'statements', label: 'Statements', group: 'Tax records',
    does: 'Upload a broker PDF statement (CMC Markets mainly). Dividend lines are read out and listed in a review queue; each line must be approved, edited or rejected before it is written to the Cash tab. An import can be reverted.',
    notes: 'Only dividend lines are read; trades, fees and interest are not. Nothing is applied automatically.' },
  { id: 'pack', label: 'Accountant pack', group: 'Tax records',
    does: 'A financial-year pack for the accountant: a PDF, an Excel file and a zip that also holds the source documents (such as the broker\'s end-of-year statement).',
    notes: 'An accountant login can read the pack only if the owner switched Shares on for them (Settings, Members, Accountant access).' },
  { id: 'charts', label: 'Charts', group: 'Insight',
    does: 'Charts over a chosen range (today, 7 days, 30 days, 90 days, 12 months, financial year, all): the portfolio against benchmarks, which holdings beat or lagged the market, drawdowns, allocation by sector, an earnings timeline, a move heatmap and the metals spot price.',
    notes: 'Built from stored observations, so a new account has little to show at first.' },
  { id: 'news', label: 'News', group: 'Insight',
    does: 'AI-written daily briefings per holding, each marked bullish, bearish, watch or neutral, grouped by day. Generate today makes today\'s on demand. A 30-day summary reviews the trend. Send Portfolio Note emails the analyst note.',
    notes: 'Briefings are generated automatically at 4 AM and the daily ones are kept for 45 days; the monthly summaries are kept for good. They are information, not advice.' },
  { id: 'questions', label: 'Questions', group: 'Insight',
    does: 'Ask a question about your own portfolio in plain words, such as the largest position or what a sale would have returned. Answers use only the stored portfolio data, quote the numbers and are saved so you can look back.',
    notes: 'It explains figures. It never says whether to buy or sell.' },
  { id: 'metals', label: 'Metals', group: 'Insight',
    does: 'A separate book for physical gold purchases: total ounces, cost, current spot value and unrealised profit, with the gold price history and a drop alert.',
    notes: 'Kept apart from share holdings.' },
];

const RULES = [
  'Everything is built from the Trades and Cash tabs: add or fix a trade or a cash entry there and the Portfolio, CGT, Charts and pack follow.',
  'Prices are entered in Australian dollars. US-listed shares are bought in Australian dollars as well; the exchange (ASX, NYSE or NASDAQ) decides which quote source is used.',
  'The Portfolio tab\'s realised profit uses average cost; the CGT tab matches each sale to the oldest purchase parcels first. They are meant to differ.',
  'For capital gains the trade date is used, not the settlement date, and the 12-month discount test leaves out both the purchase day and the sale day.',
  'Statements never changes anything by itself: every extracted dividend line waits for approval.',
  'Dividend amounts in the Cash ledger are the net cash received; gross and tax withheld sit alongside.',
  'Quotes come from Finnhub (NYSE/NASDAQ) and Alpha Vantage (ASX) and are cached for about 15 minutes; Refresh quotes asks again.',
  'Daily drop alert emails are set up by the admin in Settings, Shares. The News briefings, the 7 AM Portfolio Note and the snapshots run on a schedule by themselves.',
  'The Open buttons in this chat only switch to a tab; they never add, change or delete anything.',
];

const NOT_POSSIBLE = [
  'Telling the person whether to buy, sell or hold anything, or predicting a price.',
  'Tax advice: whether a gain is taxable, how a dividend or franking credit is treated, or what to claim. That is for the accountant; Shares only keeps the records.',
  'Placing trades or connecting to a broker account; trades are typed in by hand.',
  'Importing trades, fees or interest from a statement (only dividend lines are read).',
  'Franking credits: the columns exist but nothing uses them yet.',
  'Exporting or backing up all the Shares data in one click (backups are taken from the server).',
  'Looking at the person\'s holdings, prices or figures: this chat cannot see them; the Questions tab can answer about them.',
  'Currencies other than Australian dollars on new trades.',
];

const SYSTEM = `You are the guide to the Shares section of Vault, a personal share portfolio tracker used by an Australian investor. People ask where to do something, or how part of Shares works, in everyday words. You point them to the right tab(s) and explain how that part of the app works.

Rules:
- Use ONLY the tabs and rules given below. Never invent a button or a feature, and never promise something the notes say Shares cannot do.
- You cannot see this person's holdings, prices, trades or figures. Never state or guess them. If they ask about their own figures, say you cannot see them and say which tab shows them (or that the Questions tab can answer about their data).
- Never recommend buying, selling or holding anything and never predict prices. If asked, say so kindly and use the verdict "beyond".
- You are not a tax adviser. Never give tax advice or state tax law, rates or what is deductible from memory. For judgement questions about tax, say what Shares records and tell them to ask their accountant, using the verdict "beyond".
- Be plain and short, as to a friend who is not an accountant. Explain a term such as "parcel" or "unrealised" in a few everyday words the first time you use it.
- Give steps in order. Each step names exactly one tab by its id and says in a sentence what to do there.
- If you need one more fact to answer, ask ONE short question and give no steps.
- Warn before anything hard to undo: deleting a trade or cash entry, or reverting a statement import, because the totals change.
${require('./guideCore').VERDICT_HELP}

${REPLY_FORMAT}`;

const guide = createGuide({
  name: 'Shares guide', feature: 'shares_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'tab', sectionTitle: 'SHARES TABS',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want to do in Shares, in a sentence?',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askSharesTutor: guide.ask,
};
