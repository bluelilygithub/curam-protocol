'use strict';

// The Finance tutor: a person asks, in everyday words, where to do something in Finance or how a part of it works ("where do I
// record money I put into the business?", "why can't I edit this BAS quarter?"), and the tutor points at the real tabs, in order,
// or says plainly that the app does not do it, or that the question is a tax judgement for their accountant.
//
// Same design as the Video Tools tutor (videoTutor.js): it only knows what is written below, the model's answer is treated as
// untrusted (parsed, trimmed, every tab id checked against the catalogue), and a test (financeTutor.test.js) fails if a tab is
// added to or removed from the Finance page without this file being updated.
//
// It does NOT see the person's books. It explains how the app works. It never gives tax advice: tax, GST and entity questions
// get the "accountant" verdict. Nothing here reads or writes Finance data.

// The model, workspace-settings and usage modules open a database connection when loaded, so they are loaded only when
// the tutor really calls the model. The tests (and anything that only reads the catalogue) need no database.

// id = the tab name on the Finance page (exactly as in TABS in client/src/pages/FinancePage.jsx).
const CATALOG = [
  { id: 'Dashboard', group: 'Overview',
    does: 'A quick summary of the current financial year: who owes you money, what you have spent, quotes waiting for an answer, and a rough profit estimate.',
    notes: 'The profit shown is only rough. The Profit & Loss report (Reports tab) is the accurate figure.' },
  { id: 'Invoices', group: 'Sales',
    does: 'Create, send (as a PDF by email), track and download invoices. Each line has a GST code. Marking an invoice paid posts the income and the GST to the journal. An accepted quote can be converted into an invoice.',
    notes: 'Invoices can only be attached to clients from your own CRM list. After GST registration ends in Settings, new invoices carry no GST. A paid invoice in a reconciled or lodged BAS quarter is locked.' },
  { id: 'Quotes', group: 'Sales',
    does: 'Send a price quote before invoicing. Track it as draft, sent, accepted or declined, and convert an accepted quote into an invoice with a new invoice number.', notes: '' },
  { id: 'Suppliers', group: 'Purchases',
    does: 'A simple directory of who you buy from (name, ABN, contact details) so you can reuse it on expenses.', notes: 'Only a directory; it does not pay anyone.' },
  { id: 'Expenses', group: 'Purchases',
    does: 'Record what the business spent, with category, GST, the supplier, and how it was paid (bank, card, or later as a bill). Every expense posts to the journal and feeds your BAS and Profit & Loss. A tick-box marks a capital purchase so it goes to the Assets register.',
    notes: 'Payments to the ATO (BAS, income tax) are NOT expenses; they are recorded against the tax owed (see the BAS tab). Loan repayments are not straightforward expenses: ask the accountant how to split principal and interest.' },
  { id: 'Documents', group: 'Records',
    does: 'Keep the evidence behind your books: bank statements, provider statements, supplier invoices, receipts and ATO notices. You can upload several files at once, choose the type (for example Bank statement), and link a document to the expenses or assets it supports. A list shows expenses and assets that have no evidence yet.',
    notes: 'The files are only stored and shown. Nothing reads the figures from a statement or creates entries from it. Deleting a document asks for confirmation because records must be kept for five years. Private to your login.' },
  { id: 'Drawings', group: 'Owner',
    does: 'For a sole trader taking money out of the business for themselves. It is not a wage: no tax is withheld, and it is not an expense. It reduces owner\'s equity.',
    notes: 'A sole trader cannot pay themselves a wage. Money the business pays back to the owner for money the owner put in is also recorded as a drawing.' },
  { id: 'Wages', group: 'Owner',
    does: 'For real employees, or a company or trust paying the owner a wage. Posts gross wages, PAYG withholding and superannuation as a payroll journal entry.',
    notes: 'It only records the books. It does not report to the ATO or pay super. Not for a sole trader paying themselves: use Drawings.' },
  { id: 'Vehicle/Home Office', group: 'Deductions',
    does: 'Calculators for vehicle and home-office running costs (cents per kilometre or logbook for the vehicle; the fixed hourly rate or actual cost for the home office). Saving one posts a normal expense. A daily work-from-home hours diary can be kept.',
    notes: 'The method is chosen once per financial year per claim type (not per entry) in Settings, and then locked. Rates are set in Settings and can be updated each year.' },
  { id: 'Assets', group: 'Records',
    does: 'The register of things you buy that last (capital purchases): depreciation methods (immediate write-off, low-value pool, prime-cost, diminishing-value), the purchase journal with GST, depreciation runs for a year, and disposal (sale) with GST.',
    notes: 'Depreciation is posted by running it for a financial year; it is not automatic.' },
  { id: 'Recurring', group: 'Automation',
    does: 'Set up invoices or expenses that repeat on a schedule. A draft is made for you to review; nothing is sent or posted without your action.', notes: '' },
  { id: 'Interest', group: 'Income',
    does: 'Record bank interest received. A simple two-line entry with no GST, because interest is not subject to GST.', notes: '' },
  { id: 'Journal', group: 'Ledger',
    does: 'The full ledger of every entry, including those made by invoices, expenses, wages, drawings and BAS payments, plus manual entries for anything else. Every entry must balance (debits equal credits) before it can be saved.',
    notes: 'Use a manual entry only when no other tab fits, and ideally with your accountant\'s guidance on the accounts to use.' },
  { id: 'Accounts', group: 'Ledger',
    does: 'The chart of accounts: assets, liabilities, equity, income and expenses. The built-in accounts include Bank, GST Paid, GST Collected, Owner\'s Equity and Owner\'s Drawings. You can add your own on top (for example a credit card).', notes: '' },
  { id: 'Codes', group: 'Ledger',
    does: 'Optional tags for invoice lines and expenses, for more detailed reporting than the chart of accounts gives.', notes: '' },
  { id: 'BAS', group: 'Tax',
    does: 'For GST-registered businesses: work through each quarter. Review the figures, mark the quarter reconciled, record it as lodged, then record the payment. Figures follow the GST basis chosen in Settings (cash by default). A BAS lodged or paid outside the app can be recorded here with its real dates.',
    notes: 'The app does NOT lodge anything with the ATO; you lodge elsewhere and record it here. A reconciled, lodged or paid quarter is locked, and the GST basis cannot be changed after that. If the person is no longer registered for GST, quarters after the cancellation date do not need a BAS.' },
  { id: 'Position', group: 'Overview',
    does: 'A practical snapshot of where things stand now: cash, money owed to you, card debt and GST position. Not a formal financial statement.', notes: '' },
  { id: 'Balances', group: 'Overview',
    does: 'Every account\'s balance as of today. Mainly an integrity check: it should always read Balanced.', notes: '' },
  { id: 'Reports', group: 'Reporting',
    does: 'The formal reports an accountant needs, each with a CSV export: Profit & Loss, Balance Sheet, Trial Balance, Cash Flow, General Ledger, aged receivables and payables, GST summary and BAS worksheet, depreciation schedule, Tax Time Summary, Cash Book, Income Received, Expense Listing, and more. "Things to Review" is a checklist of items worth fixing before the year is handed over. "Export FY pack" builds a PDF, an Excel workbook and a zip of the supporting documents for a financial year.',
    notes: 'These show what has been recorded. They do not tell the person whether the treatment of something is right for tax.' },
  { id: 'Settings', group: 'Setup',
    does: 'Business name, ABN, address and bank details printed on invoices; default payment terms; GST registration and GST basis (cash or accrual); the real GST cancellation date; vehicle and home-office methods and rates for each financial year; weekly reminder email; export account mapping; and the export history lock that prevents duplicate MYOB, Xero, Excel or Sheets imports.',
    notes: 'Un-ticking "Registered for GST" stops GST on invoices and purchase credits from that date. Nothing already created is rewritten, and lodged quarters stay locked.' },
];

// Rules of the app and of bookkeeping that the tutor may explain. Taken from how Finance actually behaves (docs/finance.md).
const RULES = [
  'Every transaction is a balanced double-entry journal entry. An entry that does not balance cannot be saved.',
  'GST is counted on a cash basis by default: when an invoice is paid or an expense is paid, not when it is issued. The basis is chosen in Settings and cannot be changed once a BAS quarter has been reconciled.',
  'Money the owner puts into the business is owner\'s equity (capital introduced). It is not income, and it is not a loan unless there is an agreement to repay it. Money the business later pays back to the owner is a drawing.',
  'Payments to the ATO for BAS or income tax are not business expenses. A BAS payment is recorded in the BAS tab against the tax owed. If one was entered as an expense, it should be corrected.',
  'A sole trader does not pay themselves wages: use Drawings. The Wages tab is for employees, or a company or trust paying the owner.',
  'When GST registration ends, untick "Registered for GST" in Settings and enter the real cancellation date from the ATO notice. New invoices then carry no GST and purchases claim no GST credit from that date. Earlier records keep their GST.',
  'A BAS quarter moves through open, reconciled, lodged, paid. Once reconciled, lodged or paid it is locked, and records dated in it cannot be edited.',
  'Vehicle and home-office deduction methods are fixed per financial year, not per entry.',
  'Receipts and statements should be kept for five years. Uploading them to the Documents tab keeps them with the books and in the accountant\'s FY pack.',
  'The financial year runs 1 July to 30 June, for example 2025-26 is 1 July 2025 to 30 June 2026.',
];

// Things people commonly ask for that Finance does NOT do.
const NOT_POSSIBLE = [
  'Reading a bank statement or connecting to the bank: there is no bank feed and no statement import. Statements can be stored in Documents as evidence, but entries are made by hand (or by the invoice, expense and other tabs).',
  'Matching or reconciling the books to a bank or credit card statement automatically.',
  'Lodging a BAS, tax return or any other form with the ATO, or paying the ATO. The app records what was lodged and paid elsewhere.',
  'Payroll reporting to the ATO (Single Touch Payroll) or paying superannuation. The Wages tab only posts the entries.',
  'Preparing or calculating an income tax return, or telling the person what their tax will be. The Tax Time Summary report gathers recorded figures for the accountant.',
  'Foreign currency: amounts are in Australian dollars only.',
  'Looking at the person\'s own figures to answer a question. This tutor explains how Finance works but cannot see the books.',
];

const VERDICTS = ['doable', 'partly', 'missing', 'beyond', 'accountant', 'question'];
const CATALOG_IDS = new Set(CATALOG.map((t) => t.id));
const byId = (id) => CATALOG.find((t) => t.id === id);

function catalogText() {
  return CATALOG.map((t) => `- tab "${t.id}" (${t.group}): ${t.does}${t.notes ? ` Note: ${t.notes}` : ''}`).join('\n');
}

const SYSTEM = `You are the guide to the Finance section of Vault, an Australian small-business bookkeeping tool. People ask where to do something, or how part of Finance works, in everyday words. You point them to the right tab(s) and explain how that part of the app works.

Rules:
- Use ONLY the tabs and rules given below. Never invent a tab or a feature, and never promise something the notes say the app cannot do.
- You cannot see this person's books or figures. Never state or guess their numbers. If they ask about their own figures, say you cannot see them and say which tab or report shows them.
- You are not a tax adviser or accountant. Never give tax advice and never state tax law, rates, thresholds, deadlines or what is deductible from memory. Explain how Finance records things, and what the rules of the app are.
- When the question is a judgement about tax, GST, super, entity type, or how a transaction should be treated (for example "is this deductible?", "should this be a loan?", "do I need to register for GST?"), use the verdict "accountant": say briefly what Finance can record once they have the answer, and tell them to ask their accountant. Do not give the answer yourself.
- Be plain and short, as to someone who is not an accountant. Avoid jargon; if you must use a term such as "drawings" or "owner's equity", say what it means in the same sentence.
- Give steps in order. Each step names exactly one tab by its id and says in a sentence what to do there.
- If you need one more fact to answer, ask ONE short question and give no steps.
- Warn before anything hard to undo: deleting records, marking a BAS quarter lodged or paid, un-ticking GST registration. Suggest a backup or checking with the accountant first.
- Choose a verdict:
  "doable"     = the job can be done fully with Finance as it is.
  "partly"     = part can be done; one piece cannot. Give the possible steps and explain in "missing" what is not possible.
  "missing"    = it sounds like something Finance should do, but it does not. In "missing" say what would be needed. Give any steps that still help.
  "beyond"     = not something Finance is for (see the list of things it does not do). Say so kindly in "answer".
  "accountant" = a tax or accounting judgement for their accountant (see above). Steps are optional and only for recording the result.
  "question"   = you need to ask something first.

Reply with ONLY a JSON object, no other text:
{"verdict":"doable|partly|missing|beyond|accountant|question","answer":"1-4 short sentences","steps":[{"tool":"<tab id>","do":"what to do on this tab"}],"missing":"only for partly or missing: what is needed","tip":"optional one-line tip"}`;

function buildTutorPrompt({ messages, currentTab }) {
  const convo = (messages || []).map((m) => `${m.role === 'assistant' ? 'Guide' : 'Person'}: ${m.content}`).join('\n');
  const where = currentTab && byId(currentTab) ? `\nThe person currently has the "${currentTab}" tab open.` : '';
  return `FINANCE TABS (the complete list):
${catalogText()}

HOW FINANCE WORKS (rules you may explain):
${RULES.map((t) => `- ${t}`).join('\n')}

THINGS FINANCE DOES NOT DO:
${NOT_POSSIBLE.map((t) => `- ${t}`).join('\n')}
${where}

CONVERSATION SO FAR:
${convo}

Reply with the JSON object now.`;
}

/** Keep only the last few turns, trimmed, with roles we know. */
function cleanMessages(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content.replace(/\s+/g, ' ').trim().slice(0, 1500) }));
}

function extractJson(text) {
  let s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try { return JSON.parse(s); } catch { /* fall through */ }
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a !== -1 && b > a) {
    try { return JSON.parse(s.slice(a, b + 1)); } catch { /* fall through */ }
  }
  return null;
}

const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Turn the model's reply into something safe to show: known tab ids only, bounded text, a valid verdict. Never throws. */
function normalizeTutorReply(raw) {
  const parsed = typeof raw === 'string' ? extractJson(raw) : raw;
  if (!parsed || typeof parsed !== 'object') {
    const prose = typeof raw === 'string' && !/[{}]/.test(raw) ? clip(raw, 900) : '';
    return {
      verdict: 'question',
      answer: prose || 'Sorry, I could not work that out. Could you say again what you want to do in Finance, in a sentence?',
      steps: [], missing: '', tip: '',
    };
  }
  const steps = (Array.isArray(parsed.steps) ? parsed.steps : [])
    .map((s) => ({ tool: String(s?.tool || '').trim(), do: clip(s?.do, 300) }))
    .filter((s) => CATALOG_IDS.has(s.tool) && s.do)
    .slice(0, 8)
    .map((s) => ({ ...s, label: s.tool, group: byId(s.tool).group }));
  const missing = clip(parsed.missing, 400);
  let verdict = VERDICTS.includes(parsed.verdict) ? parsed.verdict : (steps.length ? 'doable' : 'question');
  if (verdict === 'doable' && !steps.length) verdict = 'question';
  if ((verdict === 'partly' || verdict === 'missing') && !missing) verdict = steps.length ? 'doable' : 'question';
  if (verdict === 'beyond' || verdict === 'question') steps.length = 0;
  return {
    verdict,
    answer: clip(parsed.answer, 900) || (verdict === 'beyond' ? 'That is outside what Finance does.' : verdict === 'accountant' ? 'That is a question for your accountant.' : ''),
    steps,
    missing: verdict === 'partly' || verdict === 'missing' ? missing : '',
    tip: clip(parsed.tip, 200),
  };
}

/**
 * @param {number} userId
 * @param {{ messages: Array<{role:string,content:string}>, currentTab?: string }} input
 */
async function askFinanceTutor(userId, { messages, currentTab } = {}, deps = {}) {
  const convo = cleanMessages(messages);
  if (!convo.length || convo[convo.length - 1].role !== 'user') {
    const err = new Error('Type what you want to do first.');
    err.status = 400;
    throw err;
  }
  const resolve = deps.getModels || require('./modelResolver').getModelsForUser;
  const call = deps.callModel || require('./callModel').callModel;
  const { standard: modelId } = await resolve(userId);
  const result = await call(modelId, buildTutorPrompt({ messages: convo, currentTab }), {
    system: SYSTEM, maxTokens: 900, returnUsage: true, timeoutMs: 45000,
  });
  (deps.logUsage || require('../utils/logUsage').logUsage)({ userId, model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, feature: 'finance' });
  return normalizeTutorReply(String(result.text || ''));
}

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS,
  buildTutorPrompt, cleanMessages, normalizeTutorReply, askFinanceTutor, catalogText,
};
