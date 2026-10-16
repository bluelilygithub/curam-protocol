'use strict';

// Gathers everything in the financial-year pack as normalized report objects:
//   { key, group, title, subtitle, notes, summary, sections: [{ title, note, columns, rows, totals }] }
// by running the SAME report code the Reports tab uses (via runReport), so the pack can never show a
// number the app doesn't. The four older reports (P&L, Balance Sheet, Trial Balance, GST Summary) predate
// the normalized shape and are adapted here. A report that fails is kept in the pack as an error entry
// rather than failing the whole pack.

const { pool } = require('../../db');

const money = (key, label) => ({ key, label, format: 'money', align: 'right' });
const text = (key, label) => ({ key, label });

function fyBounds(fy) {
  const y = parseInt(fy.slice(0, 4), 10);
  return { fy, y, from: `${y}-07-01`, to: `${y + 1}-06-30`, openingDay: `${y}-06-30` };
}
const quarters = (y) => [
  { label: `Q1 Jul–Sep ${y}`, from: `${y}-07-01`, to: `${y}-09-30` },
  { label: `Q2 Oct–Dec ${y}`, from: `${y}-10-01`, to: `${y}-12-31` },
  { label: `Q3 Jan–Mar ${y + 1}`, from: `${y + 1}-01-01`, to: `${y + 1}-03-31` },
  { label: `Q4 Apr–Jun ${y + 1}`, from: `${y + 1}-04-01`, to: `${y + 1}-06-30` },
];

// Accountant's labels from the export mapping (accounts and income/expense codes share one map).
async function loadMap(userId) {
  const { rows } = await pool.query(`SELECT value FROM settings WHERE "userId"=$1 AND key='fin_export_account_map'`, [userId]);
  try { return rows[0] ? JSON.parse(rows[0].value) || {} : {}; } catch { return {}; }
}
const dayOf = (v) => {
  if (v instanceof Date) { const p2 = (n) => String(n).padStart(2, '0'); return `${v.getFullYear()}-${p2(v.getMonth() + 1)}-${p2(v.getDate())}`; }
  return v ? String(v).slice(0, 10) : '';
};
const labelOf = (map, code) => (map[code] && (map[code].name || map[code].code)) || '';
const codeOf = (map, code) => (map[code] && map[code].code) || '';
function withMapped(columns, rows, map, codeKey = 'code') {
  if (!rows.some(r => labelOf(map, r[codeKey]) || codeOf(map, r[codeKey]))) return { columns, rows };
  const at = columns.findIndex(c => c.key === 'name');
  const cols = columns.slice();
  cols.splice(at + 1, 0, text('accCode', 'Accountant code'), text('accLabel', 'Accountant label'));
  return { columns: cols, rows: rows.map(r => ({ ...r, accCode: codeOf(map, r[codeKey]), accLabel: labelOf(map, r[codeKey]) })) };
}

// ---- adapters for the original, non-normalized reports -----------------------------------------
function adaptProfitLoss(raw, map, b) {
  const sec = (title, list, total) => {
    const base = { columns: [text('code', 'Code'), text('name', 'Account'), money('amount', 'Amount')], rows: list.map(x => ({ code: x.code, name: x.name, amount: x.amount })) };
    const m = withMapped(base.columns, base.rows, map);
    return { title, columns: m.columns, rows: m.rows, totals: { name: `Total ${title.toLowerCase()}`, amount: total } };
  };
  return {
    title: 'Profit & Loss', subtitle: `${raw.from} to ${raw.to} (income as invoiced; see Income Received for the cash basis)`,
    notes: ['Built from the journal. Income is recognised when invoices are issued. Capital purchases are listed separately and are depreciated through the Assets register.'],
    summary: [{ label: 'Total income', value: raw.totalIncome, format: 'money' }, { label: 'Total expenses', value: raw.totalExpense, format: 'money' }, { label: 'Net profit', value: raw.netProfit, format: 'money' }],
    sections: [
      sec('Income', raw.income, raw.totalIncome),
      sec('Expenses', raw.expenses, raw.totalExpense),
      { title: 'Capital asset purchases (informational)', note: raw.capitalAssetNote, columns: [{ key: 'date', label: 'Date', format: 'date' }, text('description', 'Description'), text('category', 'Category'), money('amount', 'Amount'), money('gst', 'GST')], rows: (raw.capitalAssetPurchases || []).map(x => ({ date: dayOf(x.date), description: x.description, category: x.category || '', amount: x.amount, gst: x.gst })) },
    ],
  };
}
function adaptBalanceSheet(raw, map, title) {
  const sec = (name, list, total) => {
    const base = { columns: [text('code', 'Code'), text('name', 'Account'), money('balance', 'Balance')], rows: list.map(x => ({ code: x.code, name: x.name, balance: x.balance })) };
    const m = withMapped(base.columns, base.rows, map);
    return { title: name, columns: m.columns, rows: m.rows, totals: { name: `Total ${name.toLowerCase()}`, balance: total } };
  };
  return {
    title, subtitle: `As at ${raw.asOf}`,
    notes: [raw.isBalanced ? 'Assets equal liabilities plus equity.' : `Out of balance by ${raw.difference} — see Things to Review.`],
    summary: [{ label: 'Total assets', value: raw.totalAssets, format: 'money' }, { label: 'Total liabilities', value: raw.totalLiabilities, format: 'money' }, { label: 'Total equity', value: raw.totalEquity, format: 'money' }],
    sections: [sec('Assets', raw.assets, raw.totalAssets), sec('Liabilities', raw.liabilities, raw.totalLiabilities), sec('Equity', raw.equity, raw.totalEquity)],
  };
}
function adaptTrialBalance(raw, map) {
  const base = { columns: [text('code', 'Code'), text('name', 'Account'), text('type', 'Type'), money('debit', 'Debit'), money('credit', 'Credit')], rows: raw.accounts.map(a => ({ code: a.code, name: a.name, type: a.type, debit: a.debitBalance || '', credit: a.creditBalance || '' })) };
  const m = withMapped(base.columns, base.rows, map);
  return {
    title: 'Trial Balance', subtitle: `As at ${raw.asOf}`,
    notes: [raw.isBalanced ? 'Total debits equal total credits.' : 'Debits and credits do not agree — see Things to Review.'],
    summary: [{ label: 'Total debits', value: raw.totalDebit, format: 'money' }, { label: 'Total credits', value: raw.totalCredit, format: 'money' }],
    sections: [{ title: 'Accounts', columns: m.columns, rows: m.rows, totals: { name: 'Total', debit: raw.totalDebit, credit: raw.totalCredit } }],
  };
}
function adaptGstSummary(raw) {
  const cols = [text('code', 'Code'), text('name', 'Name'), money('amount', 'Amount (ex-GST)'), money('gst', 'GST')];
  return {
    title: 'GST Summary', subtitle: `${raw.from} to ${raw.to} · ${raw.basis === 'accrual' ? 'accrual' : 'cash'} basis`,
    notes: [raw.cashBasisNote].filter(Boolean),
    summary: [{ label: 'GST collected', value: raw.gstCollected, format: 'money' }, { label: 'GST paid', value: raw.gstPaid, format: 'money' }, { label: 'Net GST', value: raw.netGst, format: 'money' }],
    sections: [
      { title: 'Sales by income code', columns: cols, rows: raw.byIncomeCode || [] },
      { title: 'Purchases by expense code', columns: cols, rows: raw.byExpenseCode || [] },
    ],
  };
}

// ---- the plan -----------------------------------------------------------------------------------
function plan(b) {
  const range = { from: b.from, to: b.to };
  return [
    { key: 'review', group: 'Overview', path: 'review-items', query: { fy: b.fy } },
    { key: 'pl', group: 'Statements', path: 'profit-loss', legacy: 'pl', query: range },
    { key: 'bs_end', group: 'Statements', path: 'balance-sheet', legacy: 'bs', query: { asOf: b.to }, title: `Balance Sheet — end of year (${b.to})` },
    { key: 'bs_start', group: 'Statements', path: 'balance-sheet', legacy: 'bs', query: { asOf: b.openingDay }, title: `Balance Sheet — start of year (${b.openingDay})` },
    { key: 'tb', group: 'Statements', path: 'trial-balance', legacy: 'tb', query: { asOf: b.to } },
    { key: 'cash_book', group: 'Statements', path: 'cash-book', query: range },
    { key: 'capital', group: 'Statements', path: 'capital-related', query: range },
    { key: 'tax_time', group: 'Tax & compliance', path: 'tax-time-summary', query: { fy: b.fy } },
    { key: 'income_received', group: 'Tax & compliance', path: 'income-received', query: range },
    { key: 'depreciation', group: 'Tax & compliance', path: 'depreciation-schedule', query: { fy: b.fy } },
    { key: 'drawings_wages', group: 'Tax & compliance', path: 'drawings-wages', query: range },
    { key: 'tax_payments', group: 'Tax & compliance', path: 'tax-payments', query: range },
    { key: 'gst', group: 'Tax & compliance', path: 'gst-summary', legacy: 'gst', query: range },
    ...quarters(b.y).map((q, i) => ({ key: `bas_q${i + 1}`, group: 'Tax & compliance', path: 'bas-worksheet', query: { from: q.from, to: q.to }, title: `BAS Worksheet — ${q.label}`, skipIfEmpty: true })),
    { key: 'aged_rec', group: 'Receivables & payables', path: 'aged-receivables', query: { asOf: b.to } },
    { key: 'aged_pay', group: 'Receivables & payables', path: 'aged-payables', query: { asOf: b.to } },
    { key: 'sales_client', group: 'Sales & purchases', path: 'sales-by-client', query: range },
    { key: 'expenses_cat', group: 'Sales & purchases', path: 'expenses-by-category', query: range },
    { key: 'expense_listing', group: 'Sales & purchases', path: 'expense-listing', query: range },
    { key: 'documents', group: 'Records', path: 'documents-index', query: { fy: b.fy } },
    { key: 'chart', group: 'Records', path: 'chart-of-accounts', query: {} },
    { key: 'gl', group: 'Records', path: 'general-ledger', query: range },
    { key: 'audit', group: 'Records', path: 'audit-trail', query: range },
  ];
}

const isEmptyBas = (rep) => {
  const rows = (rep.sections && rep.sections[0] && rep.sections[0].rows) || [];
  return rows.filter(r => ['G1', 'G10', 'G11', '1A', '1B', 'W2', 'T7'].includes(r.label)).every(r => !r.amount);
};

async function collectPack(userId, fy, runReport) {
  const b = fyBounds(fy);
  const map = await loadMap(userId);
  const items = plan(b);
  const reports = [];
  for (const it of items) {
    try {
      // The original reports live at /reports/<name>; same router, different shape.
      let raw = await runReport(it.path, userId, it.query);
      let rep;
      if (it.legacy === 'pl') rep = adaptProfitLoss(raw, map, b);
      else if (it.legacy === 'bs') rep = adaptBalanceSheet(raw, map, it.title);
      else if (it.legacy === 'tb') rep = adaptTrialBalance(raw, map);
      else if (it.legacy === 'gst') rep = adaptGstSummary(raw);
      else rep = raw;
      if (it.skipIfEmpty && isEmptyBas(rep)) continue;
      reports.push({ key: it.key, group: it.group, ...rep, title: it.title || rep.title });
    } catch (err) {
      reports.push({ key: it.key, group: it.group, title: it.title || it.path, subtitle: '', notes: [], summary: [], sections: [], error: err.message });
    }
  }

  // ---- cover
  const { rows: setRows } = await pool.query(
    `SELECT key, value FROM settings WHERE "userId"=$1 AND key IN ('fin_biz_name','fin_abn','fin_address','fin_website','fin_gst_basis','fin_gst_registered','fin_gst_ended_on','fin_gst_unreg_since','user_timezone')`, [userId]);
  const cfg = Object.fromEntries(setRows.map(r => [r.key, r.value]));
  const review = reports.find(r => r.key === 'review');
  const checks = review && !review.error ? (review.summary.find(s => s.label === 'Items to check') || {}).value : null;
  const regText = cfg.fin_gst_registered === 'false'
    ? `Not registered for GST from ${cfg.fin_gst_ended_on || cfg.fin_gst_unreg_since || 'an unrecorded date'}`
    : 'Registered for GST';
  const tz = cfg.user_timezone || 'Australia/Brisbane';
  const cover = {
    title: `Financial year pack — FY ${fy}`,
    business: cfg.fin_biz_name || '(business name not set — Finance → Settings)',
    abn: cfg.fin_abn || '',
    address: cfg.fin_address || '',
    website: cfg.fin_website || '',
    period: `${b.from} to ${b.to}`,
    generatedAt: new Intl.DateTimeFormat('en-AU', { dateStyle: 'long', timeStyle: 'short', timeZone: tz }).format(new Date()),
    gstBasis: cfg.fin_gst_basis === 'accrual' ? 'Accrual' : 'Cash',
    gstStatus: regText,
    itemsToCheck: checks,
    failed: reports.filter(r => r.error).map(r => `${r.title}: ${r.error}`),
    notes: [
      `Prepared from ${cfg.fin_biz_name || 'the business'}’s books. The figures come from the same reports as the accounting system, so they agree with it, but the books are only as complete as what has been entered: compare the Cash Book closing balances with your bank and card statements.`,
      'Income is shown as invoiced (Profit & Loss) and as received (Income Received); your accountant will say which basis applies.',
      `Where an accountant’s code or label has been mapped, it appears beside ${cfg.fin_biz_name || 'the business'}’s own name; blank means the business’s own name is used. The Chart of Accounts & Codes page lists them all so they can be filled in.`,
      'This pack is information for your accountant. It is not tax advice or a lodged return.',
    ],
  };
  return { fy, bounds: b, cover, reports };
}

module.exports = { collectPack, fyBounds, quarters };
