'use strict';

// Extra Finance reports, mounted by finance.js at /api/finance/reports (requireFeature('finance')
// is already applied upstream, so req.user is set). Every endpoint returns ONE normalized shape so
// the client has a single renderer and a single CSV/print path for all of them:
//
//   { title, subtitle, notes: string[],
//     summary:  [{ label, value, format }],
//     sections: [{ title, note?, columns: [{ key, label, format?, align? }], rows: [{...}], totals? }] }
//
// column.format: 'money' | 'int' | 'num' | 'pct' | 'date' | 'datetime' | 'text' (default text).
// Like the four original reports, figures come from fin_journal_entries/fin_journal_lines wherever
// the question is "what is in the books"; source tables (invoices, expenses, assets) are used only
// where the question is about the documents themselves (ageing, sales by client, statements...).
//
// Range/asOf/fy validation is strict — anything malformed is a 400, never silently defaulted.

const express = require('express');
const { pool } = require('../db');
const { getLogger } = require('../middleware/requestContext');

const round2 = (n) => Math.round((parseFloat(n) || 0) * 100) / 100;
const num = (v) => Number(v) || 0;

// ── date helpers (all UTC, YYYY-MM-DD strings) ───────────────────────────────
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const today = () => new Date().toISOString().slice(0, 10);
// pg (no custom type parsers here) returns DATE/TIMESTAMPTZ as JS Dates — format with local
// components (DATE is parsed as local midnight, so this round-trips exactly), never String(date).
const ds = (v) => {
  if (v == null) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const p = (n) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  return String(v).slice(0, 10);
};
function addDays(d, n) { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
function addYears(d, n) { const x = new Date(d + 'T00:00:00Z'); x.setUTCFullYear(x.getUTCFullYear() + n); return x.toISOString().slice(0, 10); }
function diffDays(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }

function currentFy() {
  const t = new Date();
  const y = t.getUTCFullYear();
  const start = t.getUTCMonth() >= 6 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
// "2025-26" -> { fy, from: '2025-07-01', to: '2026-06-30' }, or null if malformed.
function fyBounds(fy) {
  const m = /^(\d{4})-(\d{2})$/.exec(fy || '');
  if (!m) return null;
  const start = parseInt(m[1], 10);
  if ((start + 1) % 100 !== parseInt(m[2], 10)) return null;
  return { fy, from: `${start}-07-01`, to: `${start + 1}-06-30` };
}

function needRange(req, res) {
  const { from, to } = req.query;
  if (!isDate(from) || !isDate(to)) { res.status(400).json({ error: 'from and to required (YYYY-MM-DD)' }); return null; }
  if (from > to) { res.status(400).json({ error: 'from must not be after to' }); return null; }
  return { from, to };
}
function needFy(req, res) {
  const b = fyBounds(req.query.fy || currentFy());
  if (!b) { res.status(400).json({ error: 'fy must look like 2025-26' }); return null; }
  return b;
}
function needAsOf(req, res) {
  const a = req.query.asOf || today();
  if (!isDate(a)) { res.status(400).json({ error: 'asOf must be YYYY-MM-DD' }); return null; }
  return a;
}

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (err) {
    getLogger().error({ err }, 'finance report failed');
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
};

// ── column shorthands ────────────────────────────────────────────────────────
const cText  = (key, label) => ({ key, label });
const cMoney = (key, label) => ({ key, label, format: 'money', align: 'right' });
const cInt   = (key, label) => ({ key, label, format: 'int', align: 'right' });
const cPct   = (key, label) => ({ key, label, format: 'pct', align: 'right' });
const cDate  = (key, label) => ({ key, label, format: 'date' });

const basisNote = (basis) => basis === 'accrual'
  ? 'GST-related figures are on an accrual basis (sales when invoiced, bills when dated), as set in Finance → Settings.'
  : 'GST-related figures are cash basis (sales when paid, purchases when paid). If you report GST on an accrual basis, switch the GST basis in Finance → Settings.';
const DEPR_PREFIX = 'Depreciation FY';

// ── shared queries ───────────────────────────────────────────────────────────

// Per-account debit/credit totals from the journal for [from, to]. from = null means "from the
// beginning" (used for opening balances / as-of balances). INNER-joins entries so lines from
// entries outside the range are never counted.
async function accountTotals(userId, from, to, types) {
  const { rows } = await pool.query(
    `SELECT a.id, a.code, a.name, a.type,
            COALESCE(SUM(l.debit),0)  AS debit,
            COALESCE(SUM(l.credit),0) AS credit
     FROM fin_accounts a
     JOIN fin_journal_lines l   ON l."accountId" = a.id
     JOIN fin_journal_entries e ON e.id = l."entryId" AND e."userId" = a."userId"
     WHERE a."userId" = $1 AND a.type = ANY($4::text[])
       AND ($2::date IS NULL OR e.date >= $2::date) AND e.date <= $3::date
     GROUP BY a.id, a.code, a.name, a.type
     ORDER BY a.code`,
    [userId, from, to, types]
  );
  return rows.map(r => ({ id: r.id, code: r.code, name: r.name, type: r.type, debit: num(r.debit), credit: num(r.credit) }));
}

function plFromTotals(rows) {
  const income = [], expenses = [];
  let totalIncome = 0, totalExpense = 0;
  for (const r of rows) {
    if (r.type === 'income') {
      const amount = round2(r.credit - r.debit);
      if (amount !== 0) { income.push({ code: r.code, name: r.name, amount }); totalIncome += amount; }
    } else if (r.type === 'expense') {
      const amount = round2(r.debit - r.credit);
      if (amount !== 0) { expenses.push({ code: r.code, name: r.name, amount }); totalExpense += amount; }
    }
  }
  totalIncome = round2(totalIncome); totalExpense = round2(totalExpense);
  return { income, expenses, totalIncome, totalExpense, net: round2(totalIncome - totalExpense) };
}

async function plForRange(userId, from, to) {
  return plFromTotals(await accountTotals(userId, from, to, ['income', 'expense']));
}

// Total equity as of a date = equity account balances + accumulated profit (same definition as
// the Balance Sheet report, so the two always agree).
async function equityAsOf(userId, date) {
  const eq = await accountTotals(userId, null, date, ['equity']);
  const pl = await plForRange(userId, null, date);
  return round2(eq.reduce((s, r) => s + (r.credit - r.debit), 0) + pl.net);
}

async function businessConfig(userId) {
  const keys = ['fin_biz_name', 'fin_abn', 'fin_address', 'fin_website', 'fin_bank_name', 'fin_account_name', 'fin_bsb', 'fin_account_number'];
  const { rows } = await pool.query(`SELECT key, value FROM settings WHERE "userId"=$1 AND key = ANY($2)`, [userId, keys]);
  const cfg = {};
  for (const r of rows) cfg[r.key] = r.value;
  return cfg;
}

// ── ageing ───────────────────────────────────────────────────────────────────
const AR_BUCKETS = [
  { key: 'current', label: 'Current' },
  { key: 'd30',     label: '1–30 days' },
  { key: 'd60',     label: '31–60 days' },
  { key: 'd90',     label: '61–90 days' },
  { key: 'd90p',    label: '90+ days' },
];
function arBucket(daysOverdue) {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return 'd30';
  if (daysOverdue <= 60) return 'd60';
  if (daysOverdue <= 90) return 'd90';
  return 'd90p';
}
const arBucketColumns = () => AR_BUCKETS.map(b => cMoney(b.key, b.label));

// Outstanding invoices as of a date: issued on/before it, and not paid until after it.
async function outstandingInvoices(userId, asOf, clientId) {
  const params = [userId, asOf];
  let clientClause = '';
  if (clientId != null) { params.push(clientId); clientClause = ` AND i."clientRef" = $3`; }
  const { rows } = await pool.query(
    `SELECT i.id, i.number, i."issueDate", i."dueDate", i.total, i.status,
            i."clientRef" AS "clientId", COALESCE(cr.name, '(No client)') AS client
     FROM fin_invoices i
     LEFT JOIN clients cr ON cr.id = i."clientRef"
     WHERE i."userId" = $1 AND COALESCE(i."docType",'invoice') = 'invoice'
       AND i.status IN ('sent','paid')
       AND i."issueDate" <= $2::date
       AND (i."paidAt" IS NULL OR i."paidAt"::date > $2::date)
       ${clientClause}
     ORDER BY i."issueDate", i.id`,
    params
  );
  return rows.map(r => {
    const ref = ds(r.dueDate) || ds(r.issueDate);
    const daysOverdue = diffDays(ref, asOf);
    return {
      id: r.id, number: r.number, clientId: r.clientId, client: r.client,
      issueDate: ds(r.issueDate), dueDate: ds(r.dueDate), amount: num(r.total),
      daysOverdue, bucket: arBucket(daysOverdue),
    };
  });
}

// ── factory ──────────────────────────────────────────────────────────────────
// gstPaidForRange is injected from finance.js so BAS/GST numbers here can never drift from the
// figures the BAS tab and GST Summary report already use.
module.exports = function createFinanceReportsRouter({ gstPaidForRange, disposalSalesForRange, getGstRegistration, gstAppliesOn, getGstBasis, gstSalesSql, purchaseClaimDateSql, PURCHASES_FROM }) {
  const router = express.Router();

  // ── 1. Aged Receivables ────────────────────────────────────────────────────
  router.get('/aged-receivables', wrap(async (req, res) => {
    const asOf = needAsOf(req, res); if (!asOf) return;
    const invoices = await outstandingInvoices(req.user.id, asOf);

    const byClient = new Map();
    const totals = { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0, total: 0 };
    for (const inv of invoices) {
      const key = inv.clientId ?? 0;
      if (!byClient.has(key)) byClient.set(key, { client: inv.client, current: 0, d30: 0, d60: 0, d90: 0, d90p: 0, total: 0 });
      const row = byClient.get(key);
      row[inv.bucket] += inv.amount; row.total += inv.amount;
      totals[inv.bucket] += inv.amount; totals.total += inv.amount;
    }
    const clientRows = [...byClient.values()]
      .map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' ? round2(v) : v])))
      .sort((a, b) => b.total - a.total);
    for (const k of Object.keys(totals)) totals[k] = round2(totals[k]);
    const overdue = round2(totals.total - totals.current);

    res.json({
      title: 'Aged Receivables',
      subtitle: `Unpaid invoices as of ${asOf}`,
      notes: ['Ageing counts days past the due date (or the issue date when no due date is set). Invoices marked paid after this date still show as outstanding on it. Quotes and void invoices are excluded.'],
      summary: [
        { label: 'Total outstanding', value: totals.total, format: 'money' },
        { label: 'Overdue', value: overdue, format: 'money' },
        { label: 'Overdue share', value: totals.total ? round2((overdue / totals.total) * 100) : 0, format: 'pct' },
        { label: 'Invoices', value: invoices.length, format: 'int' },
      ],
      sections: [
        { title: 'By client', columns: [cText('client', 'Client'), ...arBucketColumns(), cMoney('total', 'Total')], rows: clientRows, totals: { client: 'Total', ...totals } },
        {
          title: 'Outstanding invoices',
          columns: [cText('number', 'Invoice'), cText('client', 'Client'), cDate('issueDate', 'Issued'), cDate('dueDate', 'Due'), cInt('daysOverdue', 'Days overdue'), cText('bucketLabel', 'Bucket'), cMoney('amount', 'Amount')],
          rows: invoices
            .map(i => ({ ...i, bucketLabel: AR_BUCKETS.find(b => b.key === i.bucket).label, daysOverdue: Math.max(0, i.daysOverdue) }))
            .sort((a, b) => b.daysOverdue - a.daysOverdue),
        },
      ],
    });
  }));

  // ── 2. Aged Payables ───────────────────────────────────────────────────────
  // A supplier bill is an expense (or asset purchase) paid via a liability account — Accounts Payable
  // for "pay later" bills, or a credit card — until it is settled. dueDate (optional) is when it must
  // be paid; settledDate is when it was. Date-accurate: an item paid after the as-of date still shows.
  // Ageing counts days past the due date (purchase date when no due date was entered).
  router.get('/aged-payables', wrap(async (req, res) => {
    const userId = req.user.id;
    const asOf = needAsOf(req, res); if (!asOf) return;

    const [exp, assets, liab] = await Promise.all([
      pool.query(
        `SELECT e.id, e.date, e."dueDate", e.description, pa.code AS "accountCode", pa.name AS "accountName",
                COALESCE(NULLIF(e.supplier,''),'(No supplier)') AS supplier, (e.amount + e.gst) AS total
         FROM fin_expenses e
         JOIN fin_accounts pa ON pa.id = e."paidViaId" AND pa.type = 'liability'
         WHERE e."userId"=$1 AND e.date <= $2::date
           AND (e."ccSettled" = false OR e."settledDate" > $2::date)
         ORDER BY e.date`, [userId, asOf]),
      pool.query(
        `SELECT a.id, a."datePurchased" AS date, a.description, pa.code AS "accountCode", pa.name AS "accountName", (a.amount + a.gst) AS total
         FROM fin_assets a
         JOIN fin_accounts pa ON pa.id = a."paidViaId" AND pa.type = 'liability'
         WHERE a."userId"=$1 AND a.method IS DISTINCT FROM 'immediate'
           AND a."datePurchased" <= $2::date
           AND (a."ccSettled" = false OR a."settledDate" > $2::date)
         ORDER BY a."datePurchased"`, [userId, asOf]),
      accountTotals(userId, null, asOf, ['liability']),
    ]);

    const AGE = [
      { key: 'a0', label: 'Current / 0–30 days', max: 30 }, { key: 'a30', label: '31–60 days', max: 60 },
      { key: 'a60', label: '61–90 days', max: 90 }, { key: 'a90', label: '90+ days', max: Infinity },
    ];
    const ageKey = (d) => AGE.find(a => d <= a.max).key;

    const items = [
      ...exp.rows.map(r => ({ supplier: r.supplier, description: r.description, account: r.accountName, date: ds(r.date), due: ds(r.dueDate), amount: num(r.total) })),
      ...assets.rows.map(r => ({ supplier: '(Asset purchases)', description: r.description, account: r.accountName, date: ds(r.date), due: null, amount: num(r.total) })),
    ].map(i => ({ ...i, days: Math.max(0, diffDays(i.due || i.date, asOf)) })).map(i => ({ ...i, bucket: ageKey(i.days) }));

    const bySupplier = new Map();
    const totals = { a0: 0, a30: 0, a60: 0, a90: 0, total: 0 };
    for (const i of items) {
      if (!bySupplier.has(i.supplier)) bySupplier.set(i.supplier, { supplier: i.supplier, a0: 0, a30: 0, a60: 0, a90: 0, total: 0 });
      const row = bySupplier.get(i.supplier);
      row[i.bucket] += i.amount; row.total += i.amount;
      totals[i.bucket] += i.amount; totals.total += i.amount;
    }
    const supplierRows = [...bySupplier.values()]
      .map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' ? round2(v) : v])))
      .sort((a, b) => b.total - a.total);
    for (const k of Object.keys(totals)) totals[k] = round2(totals[k]);

    const overdue = round2(items.filter(i => i.due && i.due < asOf).reduce((s2, i) => s2 + i.amount, 0));
    const liabRows = liab
      .map(r => ({ code: r.code, name: r.name, balance: round2(r.credit - r.debit) }))
      .filter(r => r.balance !== 0);
    const liabTotal = round2(liabRows.reduce((s2, r) => s2 + r.balance, 0));

    res.json({
      title: 'Aged Payables',
      subtitle: `Unpaid supplier bills and card purchases as of ${asOf}`,
      notes: [
        'To record a bill you will pay later, enter it as an expense with “Paid via” set to Accounts Payable (and a due date). “Pay” on the expense records the payment and its date. Card purchases not yet paid off appear here too.',
        'Ageing counts days past the due date (or the purchase date if none was entered). Items paid after the as-of date still show as unpaid on it. Items settled before payment dates were recorded are treated as paid before any as-of date.',
      ],
      summary: [
        { label: 'Unpaid bills and card purchases', value: totals.total, format: 'money' },
        { label: 'Past due date', value: overdue, format: 'money' },
        { label: 'Items', value: items.length, format: 'int' },
        { label: 'Total liabilities (journal)', value: liabTotal, format: 'money' },
      ],
      sections: [
        { title: 'Unpaid by supplier', columns: [cText('supplier', 'Supplier'), ...AGE.map(a => cMoney(a.key, a.label)), cMoney('total', 'Total')], rows: supplierRows, totals: { supplier: 'Total', ...totals } },
        { title: 'Unpaid items', columns: [cDate('date', 'Date'), cDate('due', 'Due'), cText('supplier', 'Supplier'), cText('description', 'Description'), cText('account', 'Owed to'), cInt('days', 'Days past due'), cMoney('amount', 'Amount')], rows: items.sort((a, b) => b.days - a.days) },
        { title: 'Liability balances (from the journal)', columns: [cText('code', 'Code'), cText('name', 'Account'), cMoney('balance', 'Balance')], rows: liabRows, totals: { name: 'Total liabilities', balance: liabTotal } },
      ],
    });
  }));

  // ── 3. General Ledger ──────────────────────────────────────────────────────
  const GL_ROW_CAP = 5000;
  router.get('/general-ledger', wrap(async (req, res) => {
    const r = needRange(req, res); if (!r) return;
    const code = req.query.account ? String(req.query.account) : null;
    const { rows } = await pool.query(
      `SELECT a.code, a.name, a.type, e.id AS "entryId", e.date, e.description, e.reference, e.type AS "entryType", l.debit, l.credit
       FROM fin_accounts a
       JOIN fin_journal_lines l   ON l."accountId" = a.id
       JOIN fin_journal_entries e ON e.id = l."entryId" AND e."userId" = a."userId"
       WHERE a."userId"=$1 AND ($3::text IS NULL OR a.code = $3) AND e.date <= $2::date
       ORDER BY a.code, e.date, e.id, l.id`,
      [req.user.id, r.to, code]
    );

    const accounts = new Map();
    let emitted = 0, truncated = false;
    for (const row of rows) {
      if (!accounts.has(row.code)) {
        accounts.set(row.code, { code: row.code, name: row.name, debitNormal: row.type === 'asset' || row.type === 'expense', opening: 0, running: 0, lines: [], dr: 0, cr: 0 });
      }
      const acc = accounts.get(row.code);
      const debit = num(row.debit), credit = num(row.credit);
      const delta = acc.debitNormal ? debit - credit : credit - debit;
      const d = ds(row.date);
      acc.running = round2(acc.running + delta);
      if (d < r.from) { acc.opening = acc.running; continue; }
      if (emitted >= GL_ROW_CAP) { truncated = true; continue; }
      emitted++;
      acc.dr += debit; acc.cr += credit;
      acc.lines.push({ date: d, description: row.description, reference: row.reference || '', type: row.entryType, debit, credit, balance: acc.running });
    }

    const sections = [];
    let txCount = 0;
    for (const acc of accounts.values()) {
      if (!acc.lines.length && acc.opening === 0) continue;
      txCount += acc.lines.length;
      const rowsOut = [
        { date: r.from, description: 'Opening balance', reference: '', type: '', debit: null, credit: null, balance: acc.opening, _bold: true },
        ...acc.lines,
      ];
      sections.push({
        title: `${acc.code} — ${acc.name}`,
        columns: [cDate('date', 'Date'), cText('description', 'Description'), cText('reference', 'Ref'), cText('type', 'Type'), cMoney('debit', 'Debit'), cMoney('credit', 'Credit'), cMoney('balance', 'Balance')],
        rows: rowsOut,
        totals: { description: 'Closing balance', debit: round2(acc.dr), credit: round2(acc.cr), balance: acc.running },
      });
    }

    res.json({
      title: 'General Ledger',
      subtitle: `${code ? `Account ${code}` : 'All accounts'} · ${r.from} to ${r.to}`,
      notes: [
        'Running balance follows each account\'s normal side: assets/expenses increase with debits, liabilities/equity/income with credits.',
        ...(truncated ? [`Showing the first ${GL_ROW_CAP} transactions only — narrow the date range or pick one account to see the rest.`] : []),
      ],
      summary: [{ label: 'Accounts with activity', value: sections.length, format: 'int' }, { label: 'Transactions', value: txCount, format: 'int' }],
      sections,
    });
  }));

  // ── 4. Cash Flow Statement ─────────────────────────────────────────────────
  // Direct method, built from every journal entry that touches the Bank account (1000) and grouped
  // by what caused it. Credit-card purchases hit cash only when the card is settled, so they appear
  // here at settlement (under "Credit card settlements"), which is when the cash actually moves.
  router.get('/cash-flow-statement', wrap(async (req, res) => {
    const userId = req.user.id;
    const r = needRange(req, res); if (!r) return;

    const [openRes, moveRes] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(l.debit - l.credit),0) AS bal
         FROM fin_journal_lines l
         JOIN fin_journal_entries e ON e.id = l."entryId" AND e."userId" = $1
         JOIN fin_accounts a ON a.id = l."accountId" AND a.code = '1000' AND a."userId" = $1
         WHERE e.date < $2::date`, [userId, r.from]),
      pool.query(
        `SELECT e.id, e.type, e.description,
                SUM(CASE WHEN a.code = '1000' THEN l.debit - l.credit ELSE 0 END) AS bank,
                BOOL_OR(a.code = '1400') AS "touchesFixed",
                BOOL_OR(a.code IN ('3000','3100')) AS "touchesEquity"
         FROM fin_journal_entries e
         JOIN fin_journal_lines l ON l."entryId" = e.id
         JOIN fin_accounts a ON a.id = l."accountId"
         WHERE e."userId" = $1 AND e.date BETWEEN $2::date AND $3::date
         GROUP BY e.id, e.type, e.description
         HAVING SUM(CASE WHEN a.code = '1000' THEN l.debit - l.credit ELSE 0 END) <> 0`,
        [userId, r.from, r.to]),
    ]);
    const opening = round2(openRes.rows[0].bal);

    const classify = (m) => {
      switch (m.type) {
        case 'payment':        return ['operating', 'Receipts from customers'];
        case 'interest':       return ['operating', 'Interest received'];
        case 'expense':        return ['operating', 'Payments for expenses'];
        case 'wage':           return ['operating', 'Wages, PAYG & super'];
        case 'bas':            return ['operating', 'BAS / GST payments'];
        case 'asset_purchase': return ['investing', 'Purchase of assets'];
        case 'asset_disposal': return ['investing', 'Proceeds from asset disposals'];
        case 'drawing':        return ['financing', "Owner's drawings"];
        default:
          if (m.touchesFixed)  return ['investing', 'Asset-related (manual entries)'];
          if (m.touchesEquity) return ['financing', 'Owner equity movements (manual entries)'];
          if (/^CC /i.test(m.description || '')) return ['operating', 'Credit card settlements'];
          return ['operating', 'Other manual entries'];
      }
    };
    const groups = { operating: new Map(), investing: new Map(), financing: new Map() };
    for (const m of moveRes.rows) {
      const [g, label] = classify(m);
      groups[g].set(label, round2((groups[g].get(label) || 0) + num(m.bank)));
    }
    const toRows = (map) => [...map.entries()].map(([activity, amount]) => ({ activity, amount })).sort((a, b) => a.activity.localeCompare(b.activity));
    const sum = (map) => round2([...map.values()].reduce((s, v) => s + v, 0));
    const op = sum(groups.operating), inv = sum(groups.investing), fin = sum(groups.financing);
    const net = round2(op + inv + fin);
    const cols = [cText('activity', 'Activity'), cMoney('amount', 'Amount')];

    res.json({
      title: 'Cash Flow Statement',
      subtitle: `${r.from} to ${r.to}`,
      notes: ['Direct method: every movement in the Bank account (1000), grouped by cause. Positive = cash in, negative = cash out. Manual journal entries are grouped by the accounts they touch.'],
      summary: [
        { label: 'Opening bank balance', value: opening, format: 'money' },
        { label: 'Net cash movement', value: net, format: 'money' },
        { label: 'Closing bank balance', value: round2(opening + net), format: 'money' },
      ],
      sections: [
        { title: 'Operating activities', columns: cols, rows: toRows(groups.operating), totals: { activity: 'Net cash from operating activities', amount: op } },
        { title: 'Investing activities', columns: cols, rows: toRows(groups.investing), totals: { activity: 'Net cash from investing activities', amount: inv } },
        { title: 'Financing activities', columns: cols, rows: toRows(groups.financing), totals: { activity: 'Net cash from financing activities', amount: fin } },
        {
          title: 'Reconciliation', columns: cols,
          rows: [
            { activity: 'Opening bank balance', amount: opening },
            { activity: 'Net cash movement', amount: net },
          ],
          totals: { activity: 'Closing bank balance', amount: round2(opening + net) },
        },
      ],
    });
  }));

  // ── 5. Profit & Loss comparison ────────────────────────────────────────────
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  router.get('/profit-loss-comparison', wrap(async (req, res) => {
    const userId = req.user.id;
    const r = needRange(req, res); if (!r) return;
    const compare = ['previous', 'year', 'monthly'].includes(req.query.compare) ? req.query.compare : 'previous';

    if (compare === 'monthly') {
      const months = [];
      let cur = r.from.slice(0, 7);
      const last = r.to.slice(0, 7);
      while (cur <= last) {
        months.push(cur);
        const [y, m] = cur.split('-').map(Number);
        cur = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
        if (months.length > 24) return res.status(400).json({ error: 'Monthly view supports at most 24 months' });
      }
      const { rows } = await pool.query(
        `SELECT to_char(e.date,'YYYY-MM') AS month, a.code, a.name, a.type,
                COALESCE(SUM(l.debit),0) AS debit, COALESCE(SUM(l.credit),0) AS credit
         FROM fin_accounts a
         JOIN fin_journal_lines l   ON l."accountId" = a.id
         JOIN fin_journal_entries e ON e.id = l."entryId" AND e."userId" = a."userId"
         WHERE a."userId"=$1 AND a.type IN ('income','expense') AND e.date BETWEEN $2::date AND $3::date
         GROUP BY 1,2,3,4 ORDER BY a.code`, [userId, r.from, r.to]);

      const acct = new Map();
      for (const row of rows) {
        if (!acct.has(row.code)) acct.set(row.code, { code: row.code, name: row.name, type: row.type, byMonth: {} });
        const amt = row.type === 'income' ? num(row.credit) - num(row.debit) : num(row.debit) - num(row.credit);
        acct.get(row.code).byMonth[row.month] = round2(amt);
      }
      const label = (m) => `${MONTHS[parseInt(m.slice(5), 10) - 1]} ${m.slice(2, 4)}`;
      const cols = [cText('name', 'Account'), ...months.map((m, i) => cMoney(`m${i}`, label(m))), cMoney('total', 'Total')];
      const build = (type) => {
        const list = [...acct.values()].filter(a => a.type === type);
        const totals = { name: `Total ${type === 'income' ? 'income' : 'expenses'}`, total: 0 };
        months.forEach((_, i) => { totals[`m${i}`] = 0; });
        const rowsOut = list.map(a => {
          const row = { name: `${a.code} ${a.name}`, total: 0 };
          months.forEach((m, i) => { const v = a.byMonth[m] || 0; row[`m${i}`] = v; row.total = round2(row.total + v); totals[`m${i}`] = round2(totals[`m${i}`] + v); });
          totals.total = round2(totals.total + row.total);
          return row;
        });
        return { rows: rowsOut, totals };
      };
      const inc = build('income'), exp = build('expense');
      const net = { name: 'Net profit', total: round2(inc.totals.total - exp.totals.total) };
      months.forEach((_, i) => { net[`m${i}`] = round2(inc.totals[`m${i}`] - exp.totals[`m${i}`]); });

      return res.json({
        title: 'Profit & Loss — Monthly',
        subtitle: `${r.from} to ${r.to}`,
        notes: ['Months at either end of the range may be partial if the range does not start/end on month boundaries.'],
        summary: [
          { label: 'Total income', value: inc.totals.total, format: 'money' },
          { label: 'Total expenses', value: exp.totals.total, format: 'money' },
          { label: 'Net profit', value: net.total, format: 'money' },
        ],
        sections: [
          { title: 'Income', columns: cols, rows: inc.rows, totals: inc.totals },
          { title: 'Expenses', columns: cols, rows: exp.rows, totals: exp.totals },
          { title: 'Net profit', columns: cols, rows: [net] },
        ],
      });
    }

    let fromB, toB, labelB;
    if (compare === 'year') { fromB = addYears(r.from, -1); toB = addYears(r.to, -1); labelB = 'Same period last year'; }
    else { const len = diffDays(r.from, r.to) + 1; toB = addDays(r.from, -1); fromB = addDays(toB, -(len - 1)); labelB = 'Previous period'; }

    const [cur, prev] = await Promise.all([plForRange(userId, r.from, r.to), plForRange(userId, fromB, toB)]);
    const merge = (a, b) => {
      const map = new Map();
      for (const x of a) map.set(x.code, { code: x.code, name: x.name, current: x.amount, prior: 0 });
      for (const x of b) { const e = map.get(x.code) || { code: x.code, name: x.name, current: 0, prior: 0 }; e.prior = x.amount; map.set(x.code, e); }
      return [...map.values()].sort((p, q) => p.code.localeCompare(q.code)).map(x => ({
        name: `${x.code} ${x.name}`, current: x.current, prior: x.prior, change: round2(x.current - x.prior),
        pct: x.prior ? round2(((x.current - x.prior) / Math.abs(x.prior)) * 100) : null,
      }));
    };
    const tot = (label, c, p) => ({ name: label, current: c, prior: p, change: round2(c - p), pct: p ? round2(((c - p) / Math.abs(p)) * 100) : null });
    const cols = [cText('name', 'Account'), cMoney('current', 'This period'), cMoney('prior', labelB), cMoney('change', 'Change'), cPct('pct', 'Change %')];

    res.json({
      title: 'Profit & Loss — Comparison',
      subtitle: `${r.from} to ${r.to} vs ${fromB} to ${toB}`,
      notes: [`Compared against: ${labelB.toLowerCase()} (${fromB} to ${toB}). Change % is blank where the comparison figure is zero.`],
      summary: [
        { label: 'Net profit — this period', value: cur.net, format: 'money' },
        { label: `Net profit — ${labelB.toLowerCase()}`, value: prev.net, format: 'money' },
        { label: 'Change', value: round2(cur.net - prev.net), format: 'money' },
      ],
      sections: [
        { title: 'Income', columns: cols, rows: merge(cur.income, prev.income), totals: tot('Total income', cur.totalIncome, prev.totalIncome) },
        { title: 'Expenses', columns: cols, rows: merge(cur.expenses, prev.expenses), totals: tot('Total expenses', cur.totalExpense, prev.totalExpense) },
        { title: 'Result', columns: cols, rows: [tot('Net profit', cur.net, prev.net)] },
      ],
    });
  }));

  // ── 6. Sales by Client ─────────────────────────────────────────────────────
  router.get('/sales-by-client', wrap(async (req, res) => {
    const r = needRange(req, res); if (!r) return;
    const { rows } = await pool.query(
      `SELECT COALESCE(cr.name,'(No client)') AS client, COUNT(*)::int AS invoices,
              COALESCE(SUM(i.subtotal),0) AS subtotal, COALESCE(SUM(i.gst),0) AS gst, COALESCE(SUM(i.total),0) AS total,
              COALESCE(SUM(CASE WHEN i.status='paid' THEN i.total ELSE 0 END),0) AS paid
       FROM fin_invoices i LEFT JOIN clients cr ON cr.id = i."clientRef"
       WHERE i."userId"=$1 AND COALESCE(i."docType",'invoice')='invoice' AND i.status IN ('sent','paid')
         AND i."issueDate" BETWEEN $2::date AND $3::date
       GROUP BY cr.id, cr.name ORDER BY total DESC`, [req.user.id, r.from, r.to]);
    const grand = rows.reduce((s, x) => s + num(x.total), 0);
    const out = rows.map(x => ({
      client: x.client, invoices: x.invoices, subtotal: round2(x.subtotal), gst: round2(x.gst), total: round2(x.total),
      paid: round2(x.paid), outstanding: round2(num(x.total) - num(x.paid)), share: grand ? round2((num(x.total) / grand) * 100) : 0,
    }));
    const t = out.reduce((a, x) => ({ invoices: a.invoices + x.invoices, subtotal: a.subtotal + x.subtotal, gst: a.gst + x.gst, total: a.total + x.total, paid: a.paid + x.paid, outstanding: a.outstanding + x.outstanding }), { invoices: 0, subtotal: 0, gst: 0, total: 0, paid: 0, outstanding: 0 });
    for (const k of Object.keys(t)) t[k] = k === 'invoices' ? t[k] : round2(t[k]);
    res.json({
      title: 'Sales by Client',
      subtitle: `Invoices issued ${r.from} to ${r.to}`,
      notes: ['Counts sent and paid invoices by issue date (not cash received). "Paid" is the part of that total whose invoice is now marked paid. Quotes, drafts and void invoices are excluded.'],
      summary: [
        { label: 'Total invoiced (incl. GST)', value: t.total, format: 'money' },
        { label: 'Clients', value: out.length, format: 'int' },
        { label: 'Top client share', value: out[0]?.share || 0, format: 'pct' },
      ],
      sections: [{
        title: 'Clients by revenue',
        columns: [cText('client', 'Client'), cInt('invoices', 'Invoices'), cMoney('subtotal', 'Ex-GST'), cMoney('gst', 'GST'), cMoney('total', 'Total'), cMoney('paid', 'Paid'), cMoney('outstanding', 'Outstanding'), cPct('share', 'Share')],
        rows: out, totals: { client: 'Total', ...t, share: out.length ? 100 : 0 },
      }],
    });
  }));

  // ── 7. Purchases by Supplier ───────────────────────────────────────────────
  router.get('/purchases-by-supplier', wrap(async (req, res) => {
    const userId = req.user.id;
    const r = needRange(req, res); if (!r) return;
    const [exp, assets] = await Promise.all([
      pool.query(
        `SELECT COALESCE(NULLIF(supplier,''),'(No supplier)') AS supplier, COUNT(*)::int AS n,
                COALESCE(SUM(amount),0) AS amount, COALESCE(SUM(gst),0) AS gst
         FROM fin_expenses
         WHERE "userId"=$1 AND date BETWEEN $2::date AND $3::date AND description NOT LIKE $4
         GROUP BY 1`, [userId, r.from, r.to, DEPR_PREFIX + '%']),
      pool.query(
        `SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0) AS amount, COALESCE(SUM(gst),0) AS gst
         FROM fin_assets
         WHERE "userId"=$1 AND "datePurchased" BETWEEN $2::date AND $3::date AND method IS DISTINCT FROM 'immediate'`,
        [userId, r.from, r.to]),
    ]);
    const list = exp.rows.map(x => ({ supplier: x.supplier, count: x.n, amount: round2(x.amount), gst: round2(x.gst) }));
    const a = assets.rows[0];
    if (a.n > 0) list.push({ supplier: '(Asset purchases — no supplier recorded)', count: a.n, amount: round2(a.amount), gst: round2(a.gst) });
    const grand = list.reduce((s, x) => s + x.amount + x.gst, 0);
    const out = list.map(x => ({ ...x, total: round2(x.amount + x.gst), share: grand ? round2(((x.amount + x.gst) / grand) * 100) : 0 })).sort((p, q) => q.total - p.total);
    const t = out.reduce((s, x) => ({ count: s.count + x.count, amount: s.amount + x.amount, gst: s.gst + x.gst, total: s.total + x.total }), { count: 0, amount: 0, gst: 0, total: 0 });
    res.json({
      title: 'Purchases by Supplier',
      subtitle: `${r.from} to ${r.to}`,
      notes: ['Includes expenses and capitalised asset purchases. Non-cash depreciation entries are excluded. Expenses with no supplier typed in are grouped as "(No supplier)".'],
      summary: [
        { label: 'Total purchases (incl. GST)', value: round2(t.total), format: 'money' },
        { label: 'Suppliers', value: out.length, format: 'int' },
        { label: 'Transactions', value: t.count, format: 'int' },
      ],
      sections: [{
        title: 'Suppliers by spend',
        columns: [cText('supplier', 'Supplier'), cInt('count', 'Transactions'), cMoney('amount', 'Ex-GST'), cMoney('gst', 'GST'), cMoney('total', 'Total'), cPct('share', 'Share')],
        rows: out, totals: { supplier: 'Total', count: t.count, amount: round2(t.amount), gst: round2(t.gst), total: round2(t.total), share: out.length ? 100 : 0 },
      }],
    });
  }));

  // ── 8. Expenses by Category (with transaction drill-down) ──────────────────
  router.get('/expenses-by-category', wrap(async (req, res) => {
    const r = needRange(req, res); if (!r) return;
    const { rows } = await pool.query(
      `SELECT e.id, e.date, e.description, COALESCE(NULLIF(e.supplier,''),'') AS supplier,
              COALESCE(t.name, NULLIF(e.category,''), 'Uncategorised') AS category, e.amount, e.gst, e."isCapitalAsset"
       FROM fin_expenses e LEFT JOIN fin_tx_codes t ON t.id = e."txCodeId"
       WHERE e."userId"=$1 AND e.date BETWEEN $2::date AND $3::date
       ORDER BY category, e.date, e.id`, [req.user.id, r.from, r.to]);
    const cats = new Map();
    for (const x of rows) {
      if (!cats.has(x.category)) cats.set(x.category, { category: x.category, count: 0, amount: 0, gst: 0, items: [] });
      const c = cats.get(x.category);
      c.count++; c.amount += num(x.amount); c.gst += num(x.gst);
      c.items.push({ date: ds(x.date), description: x.description, supplier: x.supplier, amount: round2(x.amount), gst: round2(x.gst), total: round2(num(x.amount) + num(x.gst)), capital: x.isCapitalAsset ? 'Yes' : '' });
    }
    const list = [...cats.values()].sort((a, b) => b.amount - a.amount);
    const grand = list.reduce((s, c) => s + c.amount, 0);
    const summaryRows = list.map(c => ({ category: c.category, count: c.count, amount: round2(c.amount), gst: round2(c.gst), share: grand ? round2((c.amount / grand) * 100) : 0 }));
    const totalRow = { category: 'Total', count: list.reduce((s, c) => s + c.count, 0), amount: round2(grand), gst: round2(list.reduce((s, c) => s + c.gst, 0)), share: list.length ? 100 : 0 };
    res.json({
      title: 'Expenses by Category',
      subtitle: `${r.from} to ${r.to}`,
      notes: ['Category is the transaction code name where one is set, otherwise the free-text category. Amounts are ex-GST. Depreciation entries are included; asset purchases capitalised to the register are not (they are not expenses until depreciated).'],
      summary: [
        { label: 'Total expenses (ex-GST)', value: round2(grand), format: 'money' },
        { label: 'Categories', value: list.length, format: 'int' },
        { label: 'Largest category', value: summaryRows[0]?.category || '—', format: 'text' },
      ],
      sections: [
        { title: 'By category', columns: [cText('category', 'Category'), cInt('count', 'Count'), cMoney('amount', 'Ex-GST'), cMoney('gst', 'GST'), cPct('share', 'Share')], rows: summaryRows, totals: totalRow },
        ...list.map(c => ({
          title: `Detail — ${c.category}`,
          columns: [cDate('date', 'Date'), cText('description', 'Description'), cText('supplier', 'Supplier'), cMoney('amount', 'Ex-GST'), cMoney('gst', 'GST'), cText('capital', 'Capital')],
          rows: c.items, totals: { description: `${c.category} total`, amount: round2(c.amount), gst: round2(c.gst) },
        })),
      ],
    });
  }));

  // ── 9. BAS Worksheet ───────────────────────────────────────────────────────
  router.get('/bas-worksheet', wrap(async (req, res) => {
    const userId = req.user.id;
    const r = needRange(req, res); if (!r) return;
    const basis = await getGstBasis(pool, userId);
    const claim = purchaseClaimDateSql(basis);
    const [sales, salesByCode, capExp, nonCapExp, assets, noGstExp, noGstAssets, inputTaxedExp, wages, gstPaid, quarter] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(total),0) AS g1, COALESCE(SUM(gst),0) AS gst FROM fin_invoices
         WHERE "userId"=$1 AND ${gstSalesSql(basis, '', '$2::date', '$3::date')}`, [userId, r.from, r.to]),
      // Sale lines by GST code: EXP = exports (G2), FRE = other GST-free (G3), INP = input-taxed (G4).
      pool.query(
        `SELECT ii."gstCode" AS code, COALESCE(SUM(ii.amount),0) AS amount
         FROM fin_invoice_items ii JOIN fin_invoices i ON i.id = ii."invoiceId"
         WHERE i."userId"=$1 AND ${gstSalesSql(basis, 'i', '$2::date', '$3::date')}
         GROUP BY ii."gstCode"`, [userId, r.from, r.to]),
      pool.query(
        `SELECT COALESCE(SUM(e.amount + e.gst),0) AS total FROM ${PURCHASES_FROM}
         WHERE e."userId"=$1 AND e."isCapitalAsset"=true AND ${claim} BETWEEN $2::date AND $3::date`, [userId, r.from, r.to]),
      pool.query(
        `SELECT COALESCE(SUM(e.amount + e.gst),0) AS total FROM ${PURCHASES_FROM}
         WHERE e."userId"=$1 AND e."isCapitalAsset"=false AND e.description NOT LIKE $4 AND ${claim} BETWEEN $2::date AND $3::date`,
        [userId, r.from, r.to, DEPR_PREFIX + '%']),
      pool.query(
        `SELECT COALESCE(SUM(amount + gst),0) AS total FROM fin_assets
         WHERE "userId"=$1 AND method IS DISTINCT FROM 'immediate' AND "datePurchased" BETWEEN $2::date AND $3::date`, [userId, r.from, r.to]),
      // G14: purchases with no GST in the price (and not flagged input-taxed). Depreciation is not a purchase.
      pool.query(
        `SELECT COALESCE(SUM(e.amount),0) AS total FROM ${PURCHASES_FROM}
         WHERE e."userId"=$1 AND e.gst = 0 AND e."inputTaxed" = false AND e.description NOT LIKE $4
           AND ${claim} BETWEEN $2::date AND $3::date`, [userId, r.from, r.to, DEPR_PREFIX + '%']),
      pool.query(
        `SELECT COALESCE(SUM(amount),0) AS total FROM fin_assets
         WHERE "userId"=$1 AND gst = 0 AND method IS DISTINCT FROM 'immediate' AND "datePurchased" BETWEEN $2::date AND $3::date`, [userId, r.from, r.to]),
      // G13: purchases made to produce input-taxed sales.
      pool.query(
        `SELECT COALESCE(SUM(e.amount + e.gst),0) AS total FROM ${PURCHASES_FROM}
         WHERE e."userId"=$1 AND e."inputTaxed" = true AND ${claim} BETWEEN $2::date AND $3::date`, [userId, r.from, r.to]),
      pool.query(
        `SELECT COALESCE(SUM(gross),0) AS w1, COALESCE(SUM(tax),0) AS w2 FROM fin_wages
         WHERE "userId"=$1 AND date BETWEEN $2::date AND $3::date`, [userId, r.from, r.to]),
      gstPaidForRange(userId, r.from, r.to, basis),
      pool.query(
        `SELECT "paygInstalment", status FROM fin_bas_quarters WHERE "userId"=$1 AND from_date=$2::date AND to_date=$3::date`,
        [userId, r.from, r.to]),
    ]);
    const byCode = Object.fromEntries(salesByCode.rows.map(x => [x.code, num(x.amount)]));
    const sold = await disposalSalesForRange(pool, userId, r.from, r.to);
    const g1 = round2(num(sales.rows[0].g1) + sold.net + sold.gst), a1 = round2(num(sales.rows[0].gst) + sold.gst);
    const g2 = round2(byCode.EXP || 0), g3 = round2(byCode.FRE || 0), g4 = round2(byCode.INP || 0);
    const g10 = round2(num(capExp.rows[0].total) + num(assets.rows[0].total));
    const g11 = round2(nonCapExp.rows[0].total);
    const g13 = round2(inputTaxedExp.rows[0].total);
    const g14 = round2(num(noGstExp.rows[0].total) + num(noGstAssets.rows[0].total));
    const b1 = round2(gstPaid);
    const w1 = round2(wages.rows[0].w1), w2 = round2(wages.rows[0].w2);
    const t7 = round2(quarter.rows[0]?.paygInstalment || 0);
    const netGst = round2(a1 - b1);
    const payable = round2(netGst + w2 + t7);

    const rows = [
      { section: 'GST — sales', label: 'G1', desc: 'Total sales (incl. GST, G2–G4 and any asset sales)', amount: g1 },
      { section: 'GST — sales', label: 'G2', desc: 'Export sales', amount: g2 },
      { section: 'GST — sales', label: 'G3', desc: 'Other GST-free sales', amount: g3 },
      { section: 'GST — sales', label: 'G4', desc: 'Input-taxed sales', amount: g4 },
      { section: 'GST — sales', label: '1A', desc: 'GST on sales', amount: a1 },
      { section: 'GST — purchases', label: 'G10', desc: 'Capital purchases (incl. GST)', amount: g10 },
      { section: 'GST — purchases', label: 'G11', desc: 'Non-capital purchases (incl. GST)', amount: g11 },
      { section: 'GST — purchases', label: 'G13', desc: 'Purchases for making input-taxed sales', amount: g13 },
      { section: 'GST — purchases', label: 'G14', desc: 'Purchases without GST in the price', amount: g14 },
      { section: 'GST — purchases', label: '1B', desc: 'GST on purchases', amount: b1 },
      { section: 'PAYG withholding', label: 'W1', desc: 'Total salary, wages and other payments', amount: w1 },
      { section: 'PAYG withholding', label: 'W2', desc: 'Amount withheld from payments', amount: w2 },
      { section: 'PAYG instalment', label: 'T7', desc: quarter.rows[0] ? 'PAYG income-tax instalment (entered on the BAS tab)' : 'PAYG income-tax instalment (open this quarter on the BAS tab to enter it)', amount: t7 },
      { section: 'Result', label: '1A − 1B', desc: 'Net GST (positive = payable to the ATO)', amount: netGst },
      { section: 'Result', label: '1A − 1B + W2 + T7', desc: 'Total payable / (refundable) for this BAS', amount: payable, _bold: true },
    ];
    res.json({
      title: 'BAS Worksheet',
      subtitle: `${r.from} to ${r.to} · ${basis === 'accrual' ? 'accrual' : 'cash'} basis`,
      notes: [
        basisNote(basis),
        'Worksheet only — check every figure against the ATO BAS form (and your accountant) before lodging. G2–G4 come from the GST code chosen on each invoice line (GST-free, export, input-taxed); G13 from expenses ticked “for input-taxed sales”; G14 is every purchase with no GST in the price. G15 (private use) and the other PAYG labels are not tracked.',
      ],
      summary: [
        { label: 'GST on sales (1A)', value: a1, format: 'money' },
        { label: 'GST on purchases (1B)', value: b1, format: 'money' },
        { label: 'PAYG instalment (T7)', value: t7, format: 'money' },
        { label: 'Net payable', value: payable, format: 'money' },
      ],
      sections: [{ title: 'BAS labels', columns: [cText('label', 'Label'), cText('desc', 'Description'), cMoney('amount', 'Amount')], rows }],
    });
  }));

  // ── 10. Depreciation Schedule ──────────────────────────────────────────────
  router.get('/depreciation-schedule', wrap(async (req, res) => {
    const userId = req.user.id;
    const b = needFy(req, res); if (!b) return;
    const [assetRes, depRes, immRes] = await Promise.all([
      pool.query(
        `SELECT id, description, amount, "businessUsePercent", method, "effectiveLifeYears",
                "datePurchased", "dateFirstUsed", "disposedDate", "disposalAmount"
         FROM fin_assets
         WHERE "userId"=$1 AND method IS DISTINCT FROM 'immediate' AND "datePurchased" <= $3::date
           AND ("disposedDate" IS NULL OR "disposedDate" >= $2::date)
         ORDER BY "datePurchased", id`, [userId, b.from, b.to]),
      pool.query(`SELECT description, amount FROM fin_expenses WHERE "userId"=$1 AND description LIKE $2`, [userId, DEPR_PREFIX + '%']),
      pool.query(
        `SELECT "datePurchased", description, amount, "businessUsePercent" FROM fin_assets
         WHERE "userId"=$1 AND method = 'immediate' AND "datePurchased" BETWEEN $2::date AND $3::date ORDER BY "datePurchased"`,
        [userId, b.from, b.to]),
    ]);

    // Posted depreciation expenses are named "Depreciation FY2025-26: <asset description>".
    const depByDesc = new Map(); // description -> [{ fy, amount }]
    for (const d of depRes.rows) {
      const m = /^Depreciation FY(\d{4}-\d{2}): (.*)$/.exec(d.description || '');
      if (!m) continue;
      if (!depByDesc.has(m[2])) depByDesc.set(m[2], []);
      depByDesc.get(m[2]).push({ fy: m[1], amount: num(d.amount) });
    }
    const descCount = new Map();
    for (const a of assetRes.rows) descCount.set(a.description, (descCount.get(a.description) || 0) + 1);
    const dupes = [...descCount.entries()].filter(([, n]) => n > 1).map(([d]) => d);

    const out = [];
    const t = { opening: 0, additions: 0, depreciation: 0, disposals: 0, closing: 0 };
    for (const a of assetRes.rows) {
      const cost = num(a.amount);
      const pct = (num(a.businessUsePercent) || 100) / 100;
      const posted = depByDesc.get(a.description) || [];
      // Deductions are business-use adjusted; the asset's own written-down value falls by the full decline.
      const declineOf = (list) => round2(list.reduce((s, x) => s + x.amount, 0) / pct);
      const priorDecline = declineOf(posted.filter(x => x.fy < b.fy));
      const thisFyPosted = posted.filter(x => x.fy === b.fy);
      const thisDecline = declineOf(thisFyPosted);
      const claimed = round2(thisFyPosted.reduce((s, x) => s + x.amount, 0));
      const purchasedInFy = ds(a.datePurchased) >= b.from;
      const disposed = a.disposedDate ? ds(a.disposedDate) <= b.to : false;
      const openingWdv = purchasedInFy ? 0 : round2(Math.max(0, cost - priorDecline));
      const additions = purchasedInFy ? cost : 0;
      const wdvBeforeDisposal = round2(Math.max(0, cost - priorDecline - thisDecline));
      const disposals = disposed ? wdvBeforeDisposal : 0;
      const closing = disposed ? 0 : wdvBeforeDisposal;
      out.push({
        description: a.description, method: (a.method || '').replace(/_/g, ' '), purchased: ds(a.datePurchased),
        opening: openingWdv, additions, depreciation: claimed, disposals, closing,
      });
      t.opening += openingWdv; t.additions += additions; t.depreciation += claimed; t.disposals += disposals; t.closing += closing;
    }
    for (const k of Object.keys(t)) t[k] = round2(t[k]);

    const imm = immRes.rows.map(x => ({ date: ds(x.datePurchased), description: x.description, cost: round2(x.amount), deduction: round2(num(x.amount) * ((num(x.businessUsePercent) || 100) / 100)) }));
    res.json({
      title: 'Depreciation Schedule',
      subtitle: `Financial year ${b.fy} (${b.from} to ${b.to})`,
      notes: [
        'Simplified figures — the same starting-point calculations the Assets tab uses; review with your accountant. "Depreciation" is the business-use-adjusted deduction actually posted for this year.',
        'Only depreciation already posted for a year appears here — run the annual depreciation from the Assets tab first if this year shows zero.',
        ...(dupes.length ? [`Assets sharing a description are indistinguishable in posted depreciation, so their figures may be combined/misallocated: ${dupes.join(', ')}. Give them distinct descriptions.`] : []),
      ],
      summary: [
        { label: 'Opening written-down value', value: t.opening, format: 'money' },
        { label: 'Depreciation claimed', value: t.depreciation, format: 'money' },
        { label: 'Closing written-down value', value: t.closing, format: 'money' },
      ],
      sections: [
        {
          title: 'Depreciating assets',
          columns: [cText('description', 'Asset'), cText('method', 'Method'), cDate('purchased', 'Purchased'), cMoney('opening', 'Opening WDV'), cMoney('additions', 'Additions'), cMoney('depreciation', 'Depreciation'), cMoney('disposals', 'Disposals (WDV)'), cMoney('closing', 'Closing WDV')],
          rows: out, totals: { description: 'Total', ...t },
        },
        { title: 'Assets deducted immediately this year', columns: [cDate('date', 'Purchased'), cText('description', 'Asset'), cMoney('cost', 'Cost (ex-GST)'), cMoney('deduction', 'Deduction')], rows: imm, totals: { description: 'Total', cost: round2(imm.reduce((s, x) => s + x.cost, 0)), deduction: round2(imm.reduce((s, x) => s + x.deduction, 0)) } },
      ],
    });
  }));

  // ── 11. Drawings & Wages summary ───────────────────────────────────────────
  router.get('/drawings-wages', wrap(async (req, res) => {
    const userId = req.user.id;
    const r = needRange(req, res); if (!r) return;
    const dayBefore = addDays(r.from, -1);
    const [wages, drawings, drawAcct, pl, openEq, closeEq] = await Promise.all([
      pool.query(
        `SELECT employee, COUNT(*)::int AS n, COALESCE(SUM(gross),0) AS gross, COALESCE(SUM(tax),0) AS tax,
                COALESCE(SUM(superannuation),0) AS super, COALESCE(SUM(net),0) AS net
         FROM fin_wages WHERE "userId"=$1 AND date BETWEEN $2::date AND $3::date GROUP BY employee ORDER BY employee`,
        [userId, r.from, r.to]),
      pool.query(
        `SELECT to_char(date,'YYYY-MM') AS month, COUNT(*)::int AS n, COALESCE(SUM(amount),0) AS total
         FROM fin_drawings WHERE "userId"=$1 AND date BETWEEN $2::date AND $3::date GROUP BY 1 ORDER BY 1`,
        [userId, r.from, r.to]),
      accountTotals(userId, r.from, r.to, ['equity']),
      plForRange(userId, r.from, r.to),
      equityAsOf(userId, dayBefore),
      equityAsOf(userId, r.to),
    ]);
    const wRows = wages.rows.map(x => ({ employee: x.employee, count: x.n, gross: round2(x.gross), tax: round2(x.tax), super: round2(x.super), net: round2(x.net) }));
    const wTot = wRows.reduce((s, x) => ({ count: s.count + x.count, gross: s.gross + x.gross, tax: s.tax + x.tax, super: s.super + x.super, net: s.net + x.net }), { count: 0, gross: 0, tax: 0, super: 0, net: 0 });
    for (const k of Object.keys(wTot)) wTot[k] = k === 'count' ? wTot[k] : round2(wTot[k]);
    const dRows = drawings.rows.map(x => ({ month: x.month, count: x.n, total: round2(x.total) }));
    const dTot = round2(dRows.reduce((s, x) => s + x.total, 0));

    // Drawings as actually booked in the journal (account 3100), so the equity roll-forward ties
    // to the Balance Sheet even if a manual entry touched that account.
    const drawJournal = drawAcct.filter(a => a.code === '3100').reduce((s, a) => s + (a.debit - a.credit), 0);
    const otherEquity = round2(closeEq - openEq - pl.net + drawJournal);

    res.json({
      title: 'Drawings & Wages Summary',
      subtitle: `${r.from} to ${r.to}`,
      notes: ['Wages are for employees; the sole trader\'s own withdrawals are Drawings (a reduction of equity, not an expense). The equity roll-forward is derived from the journal and ties to the Balance Sheet.'],
      summary: [
        { label: 'Wages (gross)', value: wTot.gross, format: 'money' },
        { label: 'Drawings', value: dTot, format: 'money' },
        { label: 'Net profit', value: pl.net, format: 'money' },
      ],
      sections: [
        { title: 'Wages by employee', columns: [cText('employee', 'Employee'), cInt('count', 'Pay runs'), cMoney('gross', 'Gross'), cMoney('tax', 'PAYG withheld'), cMoney('super', 'Super'), cMoney('net', 'Net paid')], rows: wRows, totals: { employee: 'Total', ...wTot } },
        { title: 'Drawings by month', columns: [cText('month', 'Month'), cInt('count', 'Entries'), cMoney('total', 'Total')], rows: dRows, totals: { month: 'Total', total: dTot } },
        {
          title: "Owner's equity movement",
          columns: [cText('item', 'Item'), cMoney('amount', 'Amount')],
          rows: [
            { item: `Opening equity (${dayBefore})`, amount: openEq },
            { item: 'Add: net profit for the period', amount: pl.net },
            { item: 'Less: drawings', amount: round2(-drawJournal) },
            { item: 'Other equity movements (e.g. capital introduced)', amount: otherEquity },
          ],
          totals: { item: `Closing equity (${r.to})`, amount: closeEq },
        },
      ],
    });
  }));

  // ── 12. Invoice / Quote status summary ─────────────────────────────────────
  router.get('/invoice-status', wrap(async (req, res) => {
    const userId = req.user.id;
    const r = needRange(req, res); if (!r) return;
    const [byStatus, overdue, pay] = await Promise.all([
      pool.query(
        `SELECT COALESCE("docType",'invoice') AS "docType", status, COUNT(*)::int AS n, COALESCE(SUM(total),0) AS total
         FROM fin_invoices WHERE "userId"=$1 AND "issueDate" BETWEEN $2::date AND $3::date GROUP BY 1,2 ORDER BY 1,2`,
        [userId, r.from, r.to]),
      pool.query(
        `SELECT COUNT(*)::int AS n, COALESCE(SUM(total),0) AS total FROM fin_invoices
         WHERE "userId"=$1 AND COALESCE("docType",'invoice')='invoice' AND status='sent'
           AND COALESCE("dueDate","issueDate") < CURRENT_DATE AND "issueDate" BETWEEN $2::date AND $3::date`,
        [userId, r.from, r.to]),
      pool.query(
        `SELECT AVG("paidAt"::date - "issueDate")::float AS avg, COUNT(*)::int AS n FROM fin_invoices
         WHERE "userId"=$1 AND COALESCE("docType",'invoice')='invoice' AND status='paid' AND "paidAt" IS NOT NULL
           AND "issueDate" BETWEEN $2::date AND $3::date`, [userId, r.from, r.to]),
    ]);
    const pick = (dt) => byStatus.rows.filter(x => x.docType === dt).map(x => ({ status: x.status, count: x.n, total: round2(x.total) }));
    const inv = pick('invoice'), quo = pick('quote');
    const sumT = (l) => ({ count: l.reduce((s, x) => s + x.count, 0), total: round2(l.reduce((s, x) => s + x.total, 0)) });
    const issuedQuotes = quo.filter(x => x.status !== 'draft');
    const accepted = quo.filter(x => x.status === 'accepted').reduce((s, x) => s + x.count, 0);
    const issuedCount = issuedQuotes.reduce((s, x) => s + x.count, 0);
    const conv = issuedCount ? round2((accepted / issuedCount) * 100) : 0;
    const cols = [cText('status', 'Status'), cInt('count', 'Count'), cMoney('total', 'Value')];

    res.json({
      title: 'Invoice & Quote Status',
      subtitle: `Documents issued ${r.from} to ${r.to}`,
      notes: ['Overdue = sent invoices past their due date (issue date if none set) as of today. Quote conversion = accepted quotes ÷ quotes that have left draft. Days to pay is issue date → date marked paid.'],
      summary: [
        { label: 'Overdue invoices', value: overdue.rows[0].n, format: 'int' },
        { label: 'Overdue value', value: round2(overdue.rows[0].total), format: 'money' },
        { label: 'Avg days to pay', value: pay.rows[0].n ? round2(pay.rows[0].avg) : 0, format: 'num' },
        { label: 'Quote conversion', value: conv, format: 'pct' },
      ],
      sections: [
        { title: 'Invoices by status', columns: cols, rows: inv, totals: { status: 'Total', ...sumT(inv) } },
        { title: 'Quotes by status', columns: cols, rows: quo, totals: { status: 'Total', ...sumT(quo) } },
      ],
    });
  }));

  // ── 13. Budget vs Actual ───────────────────────────────────────────────────
  // Budgets are annual, per FY, per transaction code (income or expense). Actuals: income = invoice
  // line amounts (ex-GST) on invoices issued in the FY; expenses = expense amounts (ex-GST) dated in it.
  async function budgetLines(userId, b) {
    const [codes, budgets, incAct, expAct] = await Promise.all([
      pool.query(`SELECT code, name, type FROM fin_tx_codes WHERE "userId"=$1 AND "isActive"=true ORDER BY type, code`, [userId]),
      pool.query(`SELECT kind, code, amount FROM fin_budgets WHERE "userId"=$1 AND fy=$2`, [userId, b.fy]),
      pool.query(
        `SELECT COALESCE(t.code,'(none)') AS code, COALESCE(SUM(ii.amount),0) AS amount
         FROM fin_invoice_items ii
         JOIN fin_invoices i ON i.id = ii."invoiceId"
         LEFT JOIN fin_tx_codes t ON t.id = ii."txCodeId"
         WHERE i."userId"=$1 AND COALESCE(i."docType",'invoice')='invoice' AND i.status IN ('sent','paid')
           AND i."issueDate" BETWEEN $2::date AND $3::date
         GROUP BY 1`, [userId, b.from, b.to]),
      pool.query(
        `SELECT COALESCE(t.code,'(none)') AS code, COALESCE(SUM(e.amount),0) AS amount
         FROM fin_expenses e LEFT JOIN fin_tx_codes t ON t.id = e."txCodeId"
         WHERE e."userId"=$1 AND e.date BETWEEN $2::date AND $3::date GROUP BY 1`, [userId, b.from, b.to]),
    ]);
    const budgetMap = new Map(budgets.rows.map(x => [`${x.kind}:${x.code}`, num(x.amount)]));
    const actMap = { income: new Map(incAct.rows.map(x => [x.code, num(x.amount)])), expense: new Map(expAct.rows.map(x => [x.code, num(x.amount)])) };
    const lines = [];
    const seen = new Set();
    for (const c of codes.rows) {
      seen.add(`${c.type}:${c.code}`);
      lines.push({ kind: c.type, code: c.code, name: c.name, budget: budgetMap.get(`${c.type}:${c.code}`) || 0, actual: round2(actMap[c.type].get(c.code) || 0) });
    }
    // Actuals with no matching (or no) code still count — never let real spend vanish from the report.
    for (const kind of ['income', 'expense']) {
      for (const [code, amount] of actMap[kind]) {
        if (seen.has(`${kind}:${code}`)) continue;
        lines.push({ kind, code, name: code === '(none)' ? 'Uncoded' : code, budget: budgetMap.get(`${kind}:${code}`) || 0, actual: round2(amount) });
      }
    }
    return lines;
  }

  router.get('/budget-lines', wrap(async (req, res) => {
    const b = needFy(req, res); if (!b) return;
    res.json({ fy: b.fy, from: b.from, to: b.to, lines: await budgetLines(req.user.id, b) });
  }));

  router.put('/budget-lines', wrap(async (req, res) => {
    const userId = req.user.id;
    const b = fyBounds(req.body?.fy);
    if (!b) return res.status(400).json({ error: 'fy must look like 2025-26' });
    const lines = Array.isArray(req.body?.lines) ? req.body.lines : null;
    if (!lines || lines.length > 500) return res.status(400).json({ error: 'lines must be an array (max 500)' });
    for (const l of lines) {
      if (!['income', 'expense'].includes(l?.kind) || typeof l?.code !== 'string' || !l.code || l.code.length > 40) {
        return res.status(400).json({ error: 'each line needs kind (income|expense) and code' });
      }
      const amt = Number(l.amount);
      if (l.amount !== '' && l.amount != null && (!Number.isFinite(amt) || amt < 0)) return res.status(400).json({ error: `Invalid amount for ${l.code}` });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const l of lines) {
        const amt = l.amount === '' || l.amount == null ? 0 : round2(l.amount);
        if (amt === 0) {
          await client.query(`DELETE FROM fin_budgets WHERE "userId"=$1 AND fy=$2 AND kind=$3 AND code=$4`, [userId, b.fy, l.kind, l.code]);
        } else {
          await client.query(
            `INSERT INTO fin_budgets ("userId", fy, kind, code, amount) VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT ("userId", fy, kind, code) DO UPDATE SET amount = EXCLUDED.amount, "updatedAt" = NOW()`,
            [userId, b.fy, l.kind, l.code, amt]);
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    res.json({ ok: true });
  }));

  router.get('/budget-vs-actual', wrap(async (req, res) => {
    const b = needFy(req, res); if (!b) return;
    const lines = await budgetLines(req.user.id, b);
    const shape = (kind) => {
      const list = lines.filter(l => l.kind === kind && (l.budget !== 0 || l.actual !== 0));
      const rows = list.map(l => ({
        name: `${l.code} ${l.name}`, budget: round2(l.budget), actual: l.actual, variance: round2(l.actual - l.budget),
        pct: l.budget ? round2((l.actual / l.budget) * 100) : null,
      }));
      const tb = round2(list.reduce((s, l) => s + l.budget, 0)), ta = round2(list.reduce((s, l) => s + l.actual, 0));
      return { rows, totals: { name: `Total ${kind === 'income' ? 'income' : 'expenses'}`, budget: tb, actual: ta, variance: round2(ta - tb), pct: tb ? round2((ta / tb) * 100) : null }, tb, ta };
    };
    const inc = shape('income'), exp = shape('expense');
    const cols = [cText('name', 'Code'), cMoney('budget', 'Budget'), cMoney('actual', 'Actual'), cMoney('variance', 'Variance'), cPct('pct', '% of budget')];
    res.json({
      title: 'Budget vs Actual',
      subtitle: `Financial year ${b.fy} (${b.from} to ${b.to})`,
      notes: ['Variance = actual − budget: for income a positive variance is good, for expenses a positive variance means overspent. Set budgets with "Edit budgets". Actuals are ex-GST; income by issue date, expenses by date paid. Lines with no budget and no activity are hidden.'],
      summary: [
        { label: 'Income vs budget', value: inc.totals.variance, format: 'money' },
        { label: 'Expenses vs budget', value: exp.totals.variance, format: 'money' },
        { label: 'Budgeted profit', value: round2(inc.tb - exp.tb), format: 'money' },
        { label: 'Actual profit', value: round2(inc.ta - exp.ta), format: 'money' },
      ],
      sections: [
        { title: 'Income', columns: cols, rows: inc.rows, totals: inc.totals },
        { title: 'Expenses', columns: cols, rows: exp.rows, totals: exp.totals },
      ],
    });
  }));

  // ── 14. Tax Time Summary ───────────────────────────────────────────────────
  router.get('/tax-time-summary', wrap(async (req, res) => {
    const userId = req.user.id;
    const b = needFy(req, res); if (!b) return;
    const taxBasis = await getGstBasis(pool, userId);
    const [pl, expByCode, wages, veh, ho, dep, imm, drawings, inv, gstPaid] = await Promise.all([
      plForRange(userId, b.from, b.to),
      pool.query(
        `SELECT COALESCE(t.name, NULLIF(e.category,''), 'Uncategorised') AS category, COALESCE(SUM(e.amount),0) AS amount
         FROM fin_expenses e LEFT JOIN fin_tx_codes t ON t.id = e."txCodeId"
         WHERE e."userId"=$1 AND e.date BETWEEN $2::date AND $3::date AND e.description NOT LIKE $4
         GROUP BY 1 ORDER BY 2 DESC`, [userId, b.from, b.to, DEPR_PREFIX + '%']),
      pool.query(
        `SELECT COALESCE(SUM(gross),0) AS gross, COALESCE(SUM(superannuation),0) AS super
         FROM fin_wages WHERE "userId"=$1 AND date BETWEEN $2::date AND $3::date`, [userId, b.from, b.to]),
      pool.query(
        `SELECT v.method, COALESCE(SUM(v.km),0) AS km, COALESCE(SUM(e.amount),0) AS amount
         FROM fin_vehicle_expenses v JOIN fin_expenses e ON e.id = v."expenseId"
         WHERE v."userId"=$1 AND e.date BETWEEN $2::date AND $3::date GROUP BY v.method`, [userId, b.from, b.to]),
      pool.query(
        `SELECT h.method, COALESCE(SUM(h.hours),0) AS hours, COALESCE(SUM(e.amount),0) AS amount
         FROM fin_home_office_expenses h JOIN fin_expenses e ON e.id = h."expenseId"
         WHERE h."userId"=$1 AND e.date BETWEEN $2::date AND $3::date GROUP BY h.method`, [userId, b.from, b.to]),
      pool.query(`SELECT COALESCE(SUM(amount),0) AS amount FROM fin_expenses WHERE "userId"=$1 AND description LIKE $2`, [userId, `${DEPR_PREFIX}${b.fy}:%`]),
      pool.query(
        `SELECT COALESCE(SUM(amount),0) AS amount, COUNT(*)::int AS n FROM fin_expenses
         WHERE "userId"=$1 AND "isCapitalAsset"=true AND date BETWEEN $2::date AND $3::date`, [userId, b.from, b.to]),
      pool.query(`SELECT COALESCE(SUM(amount),0) AS amount FROM fin_drawings WHERE "userId"=$1 AND date BETWEEN $2::date AND $3::date`, [userId, b.from, b.to]),
      pool.query(
        `SELECT COALESCE(SUM(gst),0) AS gst FROM fin_invoices WHERE "userId"=$1 AND ${gstSalesSql(taxBasis, '', '$2::date', '$3::date')}`,
        [userId, b.from, b.to]),
      gstPaidForRange(userId, b.from, b.to, taxBasis),
    ]);

    // Income on a received (cash) basis and tax already paid, so the summary supports either basis.
    const [recv, inst] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(subtotal),0) AS ex FROM fin_invoices WHERE "userId"=$1 AND COALESCE("docType",'invoice')='invoice' AND status='paid' AND "paidAt"::date BETWEEN $2::date AND $3::date`, [userId, b.from, b.to]),
      pool.query(
        `SELECT COALESCE(SUM(l.debit) FILTER (WHERE a.code='3100'),0) AS payg_i, COALESCE(SUM(l.debit) FILTER (WHERE a.code='2400'),0) AS payg_w
         FROM fin_journal_entries e JOIN fin_journal_lines l ON l."entryId"=e.id JOIN fin_accounts a ON a.id=l."accountId"
         WHERE e."userId"=$1 AND e.type='bas' AND e.date BETWEEN $2::date AND $3::date`, [userId, b.from, b.to]),
    ]);
    const recvEx = round2(recv.rows[0].ex), paygInst = round2(inst.rows[0].payg_i), paygWh = round2(inst.rows[0].payg_w);
    const wGross = round2(wages.rows[0].gross), wSuper = round2(wages.rows[0].super);
    const expRows = expByCode.rows.map(x => ({ item: x.category, amount: round2(x.amount) }));
    const expListed = round2(expRows.reduce((s, x) => s + x.amount, 0));
    const depAmt = round2(dep.rows[0].amount);
    // Anything in the journal's expense accounts that the source tables above don't explain
    // (manual journals, rounding) — shown so the deductions total always ties to the P&L.
    const unexplained = round2(pl.totalExpense - expListed - wGross - wSuper - depAmt);
    const soldTax = await disposalSalesForRange(pool, userId, b.from, b.to);
    const gstCollected = round2(num(inv.rows[0].gst) + soldTax.gst), gstPd = round2(gstPaid);
    const km = round2(veh.rows.reduce((s, x) => s + num(x.km), 0)), vehAmt = round2(veh.rows.reduce((s, x) => s + num(x.amount), 0));
    const hrs = round2(ho.rows.reduce((s, x) => s + num(x.hours), 0)), hoAmt = round2(ho.rows.reduce((s, x) => s + num(x.amount), 0));
    const cols = [cText('item', 'Item'), cMoney('amount', 'Amount')];

    res.json({
      title: 'Tax Time Summary',
      subtitle: `Financial year ${b.fy} (${b.from} to ${b.to})`,
      notes: [
        'A hand-over summary for your accountant / tax return, not tax advice. Figures come from the journal and source records and are ex-GST unless stated.',
        `Business income above is what you invoiced in the year (accrual, per the journal). The “Income on a received basis” section shows what you were actually paid; ask your accountant which applies to you. GST below is on a ${taxBasis} basis (Finance → Settings).`,
      ],
      summary: [
        { label: 'Business income', value: pl.totalIncome, format: 'money' },
        { label: 'Total deductions', value: pl.totalExpense, format: 'money' },
        { label: 'Net profit', value: pl.net, format: 'money' },
        { label: "Owner's drawings", value: round2(drawings.rows[0].amount), format: 'money' },
        { label: 'Income received (ex-GST)', value: recvEx, format: 'money' },
        { label: 'PAYG instalments paid (T7)', value: paygInst, format: 'money' },
      ],
      sections: [
        { title: 'Income', columns: [cText('item', 'Account'), cMoney('amount', 'Amount')], rows: pl.income.map(x => ({ item: `${x.code} ${x.name}`, amount: x.amount })), totals: { item: 'Total business income', amount: pl.totalIncome } },
        {
          title: 'Income on a received (cash) basis',
          note: 'Invoice payments received in the year, ex-GST, from paid invoices. See the Income Received report for the reconciliation to invoiced income and the unpaid invoices at each end of the year.',
          columns: [cText('item', 'Item'), cMoney('amount', 'Amount')],
          rows: [
            { item: 'Invoice payments received (ex-GST)', amount: recvEx },
            { item: 'Invoiced in the year, per Profit & Loss (for comparison)', amount: pl.totalIncome },
            { item: 'Difference (invoiced less received, plus other income recorded)', amount: round2(pl.totalIncome - recvEx) },
          ],
        },
        {
          title: 'Tax already paid',
          note: 'From BAS payments recorded in the year. PAYG instalments are a prepayment of your income tax; PAYG withholding relates to employees.',
          columns: [cText('item', 'Item'), cMoney('amount', 'Amount')],
          rows: [{ item: 'PAYG instalments (T7)', amount: paygInst }, { item: 'PAYG withholding remitted', amount: paygWh }],
        },
        {
          title: 'Deductions',
          columns: cols,
          rows: [
            ...expRows,
            ...(depAmt ? [{ item: 'Depreciation (posted for this year)', amount: depAmt }] : []),
            ...(wGross ? [{ item: 'Wages (gross)', amount: wGross }] : []),
            ...(wSuper ? [{ item: 'Superannuation', amount: wSuper }] : []),
            ...(unexplained !== 0 ? [{ item: 'Other / manual journal entries', amount: unexplained }] : []),
          ],
          totals: { item: 'Total deductions (ties to Profit & Loss)', amount: pl.totalExpense },
        },
        {
          title: 'Vehicle & home office claimed',
          columns: [cText('item', 'Claim'), cText('detail', 'Detail'), cMoney('amount', 'Deduction')],
          rows: [
            { item: 'Vehicle', detail: veh.rows.length ? `${veh.rows.map(x => x.method.replace(/_/g, ' ')).join(' + ')}${km ? ` · ${km} km` : ''}` : 'None recorded', amount: vehAmt },
            { item: 'Home office', detail: ho.rows.length ? `${ho.rows.map(x => x.method.replace(/_/g, ' ')).join(' + ')}${hrs ? ` · ${hrs} hours` : ''}` : 'None recorded', amount: hoAmt },
          ],
          note: 'Already included in the deductions above — shown separately because the ATO asks about them specifically.',
        },
        {
          title: 'Assets',
          columns: cols,
          rows: [
            { item: 'Depreciation posted for this year', amount: depAmt },
            { item: `Capital purchases deducted as expenses (${imm.rows[0].n})`, amount: round2(imm.rows[0].amount) },
          ],
          note: 'See the Depreciation Schedule report for the per-asset breakdown.',
        },
        {
          title: `GST (${taxBasis} basis)`,
          columns: cols,
          rows: [{ item: 'GST collected', amount: gstCollected }, { item: 'GST paid', amount: gstPd }],
          totals: { item: 'Net GST for the year', amount: round2(gstCollected - gstPd) },
        },
      ],
    });
  }));

  // ── 15. Customer Statements ────────────────────────────────────────────────
  async function buildStatement(userId, clientId, from, to) {
    const { rows: cr } = await pool.query(
      `SELECT c.id, c.name, pc.name AS "contactName", pc.email, b.address, b.abn
       FROM clients c
       LEFT JOIN client_contacts pc ON pc."clientId" = c.id AND pc."isPrimary" = TRUE
       LEFT JOIN client_billing_details b ON b."clientId" = c.id
       WHERE c.id=$1 AND c."userId"=$2`, [clientId, userId]);
    if (!cr[0]) return null;
    const { rows } = await pool.query(
      `SELECT number, "issueDate", total, status, "paidAt"
       FROM fin_invoices
       WHERE "userId"=$1 AND "clientRef"=$2 AND COALESCE("docType",'invoice')='invoice' AND status IN ('sent','paid')
       ORDER BY "issueDate", id`, [userId, clientId]);
    const events = [];
    for (const i of rows) {
      events.push({ date: ds(i.issueDate), order: 0, description: `Invoice ${i.number}`, debit: num(i.total), credit: 0 });
      if (i.status === 'paid' && i.paidAt) events.push({ date: ds(i.paidAt), order: 1, description: `Payment received — ${i.number}`, debit: 0, credit: num(i.total) });
    }
    events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order));
    let running = 0, opening = 0;
    const lines = [];
    for (const e of events) {
      if (e.date > to) continue;
      running = round2(running + e.debit - e.credit);
      if (e.date < from) { opening = running; continue; }
      lines.push({ ...e, balance: running });
    }
    const outstanding = await outstandingInvoices(userId, to, clientId);
    const aging = Object.fromEntries(AR_BUCKETS.map(b => [b.key, 0]));
    for (const o of outstanding) aging[o.bucket] = round2(aging[o.bucket] + o.amount);
    return { client: cr[0], from, to, opening, lines, closing: running, aging };
  }

  function statementParams(req, res) {
    const r = needRange(req, res); if (!r) return null;
    const clientId = parseInt(req.query.clientId, 10);
    if (!Number.isInteger(clientId)) { res.status(400).json({ error: 'clientId required' }); return null; }
    return { ...r, clientId };
  }

  // Named route before anything param-like; PDF variant registered first.
  router.get('/customer-statement/pdf', wrap(async (req, res) => {
    const p = statementParams(req, res); if (!p) return;
    const stmt = await buildStatement(req.user.id, p.clientId, p.from, p.to);
    if (!stmt) return res.status(404).json({ error: 'Client not found' });
    const cfg = await businessConfig(req.user.id);
    const { generateStatementPdf } = require('../services/statementPdf');
    const buffer = await generateStatementPdf(stmt, cfg);
    const safe = String(stmt.client.name || 'client').replace(/[^\w.-]+/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="statement-${safe}-${p.to}.pdf"`);
    res.send(buffer);
  }));

  router.get('/customer-statement', wrap(async (req, res) => {
    const p = statementParams(req, res); if (!p) return;
    const stmt = await buildStatement(req.user.id, p.clientId, p.from, p.to);
    if (!stmt) return res.status(404).json({ error: 'Client not found' });
    const drSum = round2(stmt.lines.reduce((s, l) => s + l.debit, 0)), crSum = round2(stmt.lines.reduce((s, l) => s + l.credit, 0));
    res.json({
      title: `Customer Statement — ${stmt.client.name}`,
      subtitle: `${p.from} to ${p.to}`,
      notes: ['Debits are invoices issued; credits are payments received (by the date the invoice was marked paid). Quotes, drafts and void invoices are excluded. Use "Download PDF" for a customer-ready copy.'],
      summary: [
        { label: 'Opening balance', value: stmt.opening, format: 'money' },
        { label: 'Invoiced', value: drSum, format: 'money' },
        { label: 'Received', value: crSum, format: 'money' },
        { label: 'Closing balance', value: stmt.closing, format: 'money' },
      ],
      sections: [
        {
          title: 'Transactions',
          columns: [cDate('date', 'Date'), cText('description', 'Description'), cMoney('debit', 'Invoiced'), cMoney('credit', 'Received'), cMoney('balance', 'Balance')],
          rows: [{ date: p.from, description: 'Opening balance', debit: null, credit: null, balance: stmt.opening, _bold: true }, ...stmt.lines],
          totals: { description: 'Closing balance', debit: drSum, credit: crSum, balance: stmt.closing },
        },
        { title: `Ageing of outstanding invoices at ${p.to}`, columns: arBucketColumns(), rows: [stmt.aging] },
      ],
    });
  }));

  // ── 16. Audit Trail ────────────────────────────────────────────────────────
  // The finance module keeps no field-level change history, so this is an ACTIVITY log: every journal
  // entry as it was created, plus every invoice/quote send attempt. Edits that rebuild an entry show
  // up as a new entry — the old version is not retained anywhere.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // Reports added for the accountant hand-over (FY pack): income received, tax payments, cash book,
  // capital & related parties, expense listing, things to review, and the chart of accounts/codes.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  const subDay = (d, n) => addDays(d, -n);
  // The company name as stored in Settings (fin_biz_name), used in report wording instead of the product name.
  const bizName = async (userId) => {
    const { rows } = await pool.query(`SELECT value FROM settings WHERE "userId"=$1 AND key='fin_biz_name'`, [userId]);
    return (rows[0] && String(rows[0].value).trim()) || 'The business';
  };
  const DOC_COUNT = `(SELECT COUNT(*)::int FROM fin_document_links l WHERE l."expenseId" = e.id)`;
  const TAXISH = `(e.supplier ILIKE '%ATO%' OR e.supplier ILIKE '%Taxation Office%' OR e.category ILIKE 'tax' OR t.code = 'EXP-300' OR e.description ILIKE '%for BAS%' OR e.description ILIKE 'BAS %')`;

  // Invoices (not quotes/void) issued on or before `date` and still unpaid at the end of that day.
  async function debtorsAt(userId, date) {
    const { rows } = await pool.query(
      `SELECT i.number, COALESCE(cr.name,'(No client)') AS client, i."issueDate", i."dueDate",
              i.subtotal, i.gst, i.total
       FROM fin_invoices i LEFT JOIN clients cr ON cr.id = i."clientRef"
       WHERE i."userId"=$1 AND COALESCE(i."docType",'invoice')='invoice' AND i.status IN ('sent','paid')
         AND i."issueDate" <= $2::date AND (i."paidAt" IS NULL OR i."paidAt"::date > $2::date)
       ORDER BY i."issueDate", i.id`, [userId, date]);
    return rows.map(r => ({ number: r.number, client: r.client, issued: ds(r.issueDate), due: ds(r.dueDate), subtotal: round2(r.subtotal), gst: round2(r.gst), total: round2(r.total) }));
  }

  // ── Income Received (cash basis) ─────────────────────────────────────────────
  router.get('/income-received', wrap(async (req, res) => {
    const userId = req.user.id;
    const r = needRange(req, res); if (!r) return;
    const [paid, invoiced, other] = await Promise.all([
      pool.query(
        `SELECT i.number, COALESCE(cr.name,'(No client)') AS client, i."issueDate", i."paidAt", i.subtotal, i.gst, i.total
         FROM fin_invoices i LEFT JOIN clients cr ON cr.id = i."clientRef"
         WHERE i."userId"=$1 AND COALESCE(i."docType",'invoice')='invoice' AND i.status='paid' AND i."paidAt"::date BETWEEN $2::date AND $3::date
         ORDER BY i."paidAt", i.id`, [userId, r.from, r.to]),
      pool.query(
        `SELECT COALESCE(SUM(subtotal),0) AS subtotal, COALESCE(SUM(gst),0) AS gst, COALESCE(SUM(total),0) AS total, COUNT(*)::int AS n
         FROM fin_invoices WHERE "userId"=$1 AND COALESCE("docType",'invoice')='invoice' AND status IN ('sent','paid')
           AND "issueDate" BETWEEN $2::date AND $3::date`, [userId, r.from, r.to]),
      accountTotals(userId, r.from, r.to, ['income']),
    ]);
    const open = await debtorsAt(userId, subDay(r.from, 1));
    const close = await debtorsAt(userId, r.to);
    const sum = (rows, k) => round2(rows.reduce((s2, x) => s2 + num(x[k]), 0));
    const paidRows = paid.rows.map(x => ({ number: x.number, client: x.client, issued: ds(x.issueDate), paid: ds(x.paidAt), subtotal: round2(x.subtotal), gst: round2(x.gst), total: round2(x.total) }));
    const recEx = sum(paidRows, 'subtotal');
    const calc = round2(num(invoiced.rows[0].subtotal) + sum(open, 'subtotal') - sum(close, 'subtotal'));
    const otherIncome = other.filter(a => a.code !== '4000').map(a => ({ code: a.code, name: a.name, amount: round2(a.credit - a.debit) })).filter(a => a.amount !== 0);

    res.json({
      title: 'Income Received (cash basis)',
      subtitle: `${r.from} to ${r.to}`,
      notes: [
        'Most sole traders report business income when the money is received, not when the invoice is issued. This report shows both and how they reconcile. Profit & Loss and the Tax Time Summary use the invoice date; ask your accountant which basis applies to you.',
        'Amounts are ex-GST unless the column says otherwise. Voided invoices and quotes are excluded. Any difference in the reconciliation usually means an invoice was edited or voided after it was sent or paid.',
      ],
      summary: [
        { label: 'Income received (ex-GST)', value: recEx, format: 'money' },
        { label: 'Invoiced in period (ex-GST)', value: round2(invoiced.rows[0].subtotal), format: 'money' },
        { label: 'Unpaid at end of period (ex-GST)', value: sum(close, 'subtotal'), format: 'money' },
      ],
      sections: [
        {
          title: 'Reconciliation: invoiced to received (ex-GST)',
          columns: [cText('item', 'Item'), cMoney('amount', 'Amount')],
          rows: [
            { item: `Invoiced in the period (${invoiced.rows[0].n} invoice${invoiced.rows[0].n === 1 ? '' : 's'})`, amount: round2(invoiced.rows[0].subtotal) },
            { item: `Add: unpaid at the start (${open.length})`, amount: sum(open, 'subtotal') },
            { item: `Less: unpaid at the end (${close.length})`, amount: -sum(close, 'subtotal') },
            { item: 'Income received, calculated', amount: calc, _bold: true },
            { item: `Income received, per payments recorded (${paidRows.length})`, amount: recEx, _bold: true },
            { item: 'Difference (should be nil)', amount: round2(recEx - calc) },
          ],
        },
        {
          title: 'Payments received in the period',
          columns: [cText('number', 'Invoice'), cText('client', 'Client'), cDate('issued', 'Issued'), cDate('paid', 'Paid'), cMoney('subtotal', 'Ex-GST'), cMoney('gst', 'GST'), cMoney('total', 'Total')],
          rows: paidRows, totals: { number: 'Total', subtotal: recEx, gst: sum(paidRows, 'gst'), total: sum(paidRows, 'total') },
        },
        {
          title: 'Unpaid at the end of the period (debtors)',
          columns: [cText('number', 'Invoice'), cText('client', 'Client'), cDate('issued', 'Issued'), cDate('due', 'Due'), cMoney('subtotal', 'Ex-GST'), cMoney('gst', 'GST'), cMoney('total', 'Total')],
          rows: close, totals: { number: 'Total', subtotal: sum(close, 'subtotal'), gst: sum(close, 'gst'), total: sum(close, 'total') },
        },
        {
          title: 'Unpaid at the start of the period',
          columns: [cText('number', 'Invoice'), cText('client', 'Client'), cDate('issued', 'Issued'), cDate('due', 'Due'), cMoney('subtotal', 'Ex-GST'), cMoney('gst', 'GST'), cMoney('total', 'Total')],
          rows: open, totals: { number: 'Total', subtotal: sum(open, 'subtotal'), gst: sum(open, 'gst'), total: sum(open, 'total') },
        },
        { title: 'Other income recorded (interest, gain on asset sales, manual entries)', columns: [cText('code', 'Code'), cText('name', 'Account'), cMoney('amount', 'Amount')], rows: otherIncome },
      ],
    });
  }));

  // ── Tax Payments & Credits ───────────────────────────────────────────────────
  router.get('/tax-payments', wrap(async (req, res) => {
    const userId = req.user.id;
    const r = needRange(req, res); if (!r) return;
    const [bas, quarters, asExpense] = await Promise.all([
      pool.query(
        `SELECT e.id, e.date, e.description,
                COALESCE(SUM(l.debit)  FILTER (WHERE a.code='2200'),0) AS gst_col,
                COALESCE(SUM(l.credit) FILTER (WHERE a.code='1200'),0) AS gst_paid,
                COALESCE(SUM(l.debit)  FILTER (WHERE a.code='2400'),0) AS payg_w,
                COALESCE(SUM(l.debit)  FILTER (WHERE a.code='3100'),0) AS payg_i,
                COALESCE(SUM(l.credit - l.debit) FILTER (WHERE a.code='1000'),0) AS bank
         FROM fin_journal_entries e JOIN fin_journal_lines l ON l."entryId"=e.id JOIN fin_accounts a ON a.id=l."accountId"
         WHERE e."userId"=$1 AND e.type='bas' AND e.date BETWEEN $2::date AND $3::date
         GROUP BY e.id ORDER BY e.date, e.id`, [userId, r.from, r.to]),
      pool.query(
        `SELECT from_date, to_date, status, "paygInstalment", lodged_at, paid_at FROM fin_bas_quarters
         WHERE "userId"=$1 AND ((to_date >= $2::date AND from_date <= $3::date)
            OR lodged_at::date BETWEEN $2::date AND $3::date OR paid_at::date BETWEEN $2::date AND $3::date) ORDER BY from_date`, [userId, r.from, r.to]),
      pool.query(
        `SELECT e.date, e.supplier, e.description, (e.amount + e.gst) AS total, COALESCE(t.code,'') AS code
         FROM fin_expenses e LEFT JOIN fin_tx_codes t ON t.id = e."txCodeId"
         WHERE e."userId"=$1 AND e.date BETWEEN $2::date AND $3::date AND ${TAXISH}
         ORDER BY e.date, e.id`, [userId, r.from, r.to]),
    ]);
    const basRows = bas.rows.map(x => ({ date: ds(x.date), description: x.description, gst: round2(num(x.gst_col) - num(x.gst_paid)), withheld: round2(x.payg_w), instalment: round2(x.payg_i), paid: round2(x.bank) }));
    const tot = (k) => round2(basRows.reduce((s2, x) => s2 + x[k], 0));
    const expRows = asExpense.rows.map(x => ({ date: ds(x.date), supplier: x.supplier || '', description: x.description, code: x.code, total: round2(x.total) }));
    const expTotal = round2(expRows.reduce((s2, x) => s2 + x.total, 0));

    res.json({
      title: 'Tax Payments & Credits',
      subtitle: `${r.from} to ${r.to}`,
      notes: [
        'Money paid to the ATO through the BAS tab: net GST, PAYG withholding and PAYG instalments (T7). A PAYG instalment is a prepayment of your income tax, so it appears as a credit here and as owner’s drawings in the books, not as a business expense.',
        'GST and tax payments are not deductible expenses. Anything below under “recorded as an expense” should be moved to a BAS payment (or reviewed with your accountant) so profit and deductions aren’t understated.',
      ],
      summary: [
        { label: 'Paid to the ATO via BAS', value: tot('paid'), format: 'money' },
        { label: 'PAYG instalments (T7)', value: tot('instalment'), format: 'money' },
        { label: 'Tax-looking payments booked as expenses', value: expTotal, format: 'money' },
      ],
      sections: [
        { title: 'BAS payments recorded', columns: [cDate('date', 'Paid'), cText('description', 'Description'), cMoney('gst', 'Net GST'), cMoney('withheld', 'PAYG withheld'), cMoney('instalment', 'PAYG instalment'), cMoney('paid', 'Total paid')], rows: basRows, totals: { description: 'Total', gst: tot('gst'), withheld: tot('withheld'), instalment: tot('instalment'), paid: tot('paid') } },
        { title: 'BAS quarters covered, lodged or paid in the period', columns: [cDate('from', 'From'), cDate('to', 'To'), cText('status', 'Status'), cMoney('instalment', 'PAYG instalment (T7)'), cDate('lodged', 'Lodged'), cDate('paid', 'Paid')], rows: quarters.rows.map(q => ({ from: ds(q.from_date), to: ds(q.to_date), status: q.status, instalment: round2(q.paygInstalment), lodged: ds(q.lodged_at), paid: ds(q.paid_at) })) },
        { title: 'Payments that look like tax but are recorded as expenses', note: 'Matched on supplier (ATO), the Tax code EXP-300, a “Tax” category or “BAS” in the description.', columns: [cDate('date', 'Date'), cText('supplier', 'Supplier'), cText('description', 'Description'), cText('code', 'Code'), cMoney('total', 'Amount')], rows: expRows, totals: { description: 'Total', total: expTotal } },
      ],
    });
  }));

  // ── Cash Book (bank / card / bills with a running balance) ────────────────────
  router.get('/cash-book', wrap(async (req, res) => {
    const userId = req.user.id;
    const biz = await bizName(userId);
    const r = needRange(req, res); if (!r) return;
    const { rows: accts } = await pool.query(`SELECT id, code, name, type FROM fin_accounts WHERE "userId"=$1 AND type IN ('asset','liability') ORDER BY code`, [userId]);
    let wanted;
    if (req.query.account) {
      const a = accts.find(x => x.code === String(req.query.account));
      if (!a) return res.status(400).json({ error: 'Unknown account code' });
      wanted = [a];
    } else {
      wanted = accts.filter(a => ['1000', '2100', '2000'].includes(a.code));
    }
    const ROW_CAP = 5000;
    const sections = [];
    const summary = [];
    let capped = false;
    for (const a of wanted) {
      const asset = a.type === 'asset';
      const sign = asset ? 1 : -1; // balance as a positive number the way a statement shows it
      const { rows: [ob] } = await pool.query(
        `SELECT COALESCE(SUM(l.debit - l.credit),0) AS net FROM fin_journal_lines l JOIN fin_journal_entries e ON e.id=l."entryId"
         WHERE e."userId"=$1 AND l."accountId"=$2 AND e.date < $3::date`, [userId, a.id, r.from]);
      const { rows } = await pool.query(
        `SELECT e.date, e.description, e.type, e.reference, l.debit, l.credit
         FROM fin_journal_lines l JOIN fin_journal_entries e ON e.id=l."entryId"
         WHERE e."userId"=$1 AND l."accountId"=$2 AND e.date BETWEEN $3::date AND $4::date
         ORDER BY e.date, e.id, l.id LIMIT ${ROW_CAP + 1}`, [userId, a.id, r.from, r.to]);
      if (rows.length > ROW_CAP) { capped = true; rows.length = ROW_CAP; }
      if (!asset && rows.length === 0 && round2(num(ob.net)) === 0) continue;
      if (asset && a.code !== '1000' && rows.length === 0 && round2(num(ob.net)) === 0) continue;
      let bal = sign * num(ob.net);
      let tin = 0, tout = 0;
      const out = rows.map(x => {
        const inn = asset ? num(x.debit) : num(x.credit);
        const outt = asset ? num(x.credit) : num(x.debit);
        bal += inn - outt; tin += inn; tout += outt;
        return { date: ds(x.date), description: x.description, reference: x.reference || '', type: x.type, in: round2(inn), out: round2(outt), balance: round2(bal) };
      });
      const open = round2(sign * num(ob.net));
      sections.push({
        title: `${a.code} ${a.name} — ${asset ? 'tick against your bank statement' : 'tick against the statement / bills'}`,
        columns: [cDate('date', 'Date'), cText('description', 'Description'), cText('reference', 'Ref'), cText('type', 'Type'), cMoney('in', asset ? 'Money in' : 'Charges'), cMoney('out', asset ? 'Money out' : 'Payments'), cMoney('balance', 'Balance')],
        rows: [{ date: r.from, description: 'Opening balance', reference: '', type: '', in: '', out: '', balance: open, _bold: true }, ...out],
        totals: { description: `Closing balance ${r.to}`, in: round2(tin), out: round2(tout), balance: round2(bal) },
      });
      summary.push({ label: `${a.name} closing balance`, value: round2(bal), format: 'money' });
    }
    res.json({
      title: 'Cash Book',
      subtitle: `${r.from} to ${r.to}`,
      notes: [
        'Every movement in the books for the bank account (and the credit card and accounts payable, where used), in date order with a running balance. Compare the closing balance with the balance on your bank/card statement for the same date; any difference is a missing, wrong or duplicate entry.',
        `${biz} has no bank feed, so this is what has been entered in the books, not what the bank holds. Opening balances come from the journal (if the books started at zero, so does this).`,
        ...(capped ? [`Showing the first ${ROW_CAP} movements per account — narrow the date range.`] : []),
      ],
      summary,
      sections,
    });
  }));

  // ── Capital & Related Parties ────────────────────────────────────────────────
  router.get('/capital-related', wrap(async (req, res) => {
    const userId = req.user.id;
    const r = needRange(req, res); if (!r) return;
    const [eq, draws, liabAccts, equityBefore] = await Promise.all([
      pool.query(
        `SELECT e.date, e.description, e.type, a.code, l.debit, l.credit
         FROM fin_journal_lines l JOIN fin_journal_entries e ON e.id=l."entryId" JOIN fin_accounts a ON a.id=l."accountId"
         WHERE e."userId"=$1 AND a.code='3000' AND e.date BETWEEN $2::date AND $3::date ORDER BY e.date, e.id`, [userId, r.from, r.to]),
      pool.query(
        `SELECT d.date, d.description, d.amount, COALESCE(pa.name,'Bank / Cash') AS via
         FROM fin_drawings d LEFT JOIN fin_accounts pa ON pa.id = d."paidViaId"
         WHERE d."userId"=$1 AND d.date BETWEEN $2::date AND $3::date ORDER BY d.date, d.id`, [userId, r.from, r.to]),
      pool.query(`SELECT id, code, name FROM fin_accounts WHERE "userId"=$1 AND type='liability' AND "isSystem"=false ORDER BY code`, [userId]),
      pool.query(
        `SELECT COUNT(*)::int AS n FROM fin_journal_lines l JOIN fin_journal_entries e ON e.id=l."entryId" JOIN fin_accounts a ON a.id=l."accountId"
         WHERE e."userId"=$1 AND a.code='3000' AND e.date <= $2::date`, [userId, r.to]),
    ]);
    const eqRows = eq.rows.map(x => ({ date: ds(x.date), description: x.description, type: x.type, introduced: round2(num(x.credit) - num(x.debit)) }));
    const eqTotal = round2(eqRows.reduce((s2, x) => s2 + x.introduced, 0));
    const drawRows = draws.rows.map(x => ({ date: ds(x.date), description: x.description || '', via: x.via, amount: round2(x.amount) }));
    const drawTotal = round2(drawRows.reduce((s2, x) => s2 + x.amount, 0));

    const loanRows = [];
    for (const a of liabAccts.rows) {
      const { rows: [m] } = await pool.query(
        `SELECT COALESCE(SUM(l.credit - l.debit) FILTER (WHERE e.date < $3::date),0) AS opening,
                COALESCE(SUM(l.credit) FILTER (WHERE e.date BETWEEN $3::date AND $4::date),0) AS received,
                COALESCE(SUM(l.debit)  FILTER (WHERE e.date BETWEEN $3::date AND $4::date),0) AS repaid,
                COALESCE(SUM(l.credit - l.debit) FILTER (WHERE e.date <= $4::date),0) AS closing
         FROM fin_journal_lines l JOIN fin_journal_entries e ON e.id=l."entryId" WHERE e."userId"=$1 AND l."accountId"=$2`, [userId, a.id, r.from, r.to]);
      if (round2(m.opening) || round2(m.received) || round2(m.repaid) || round2(m.closing)) {
        loanRows.push({ account: `${a.code} ${a.name}`, opening: round2(m.opening), received: round2(m.received), repaid: round2(m.repaid), closing: round2(m.closing) });
      }
    }
    res.json({
      title: 'Capital & Related Parties',
      subtitle: `${r.from} to ${r.to}`,
      notes: [
        equityBefore.rows[0].n === 0
          ? 'No opening balance or capital introduced has been recorded in the books up to this date. If money from the owner, another business or a loan paid for early expenses, the Cash Book and Balance Sheet will not agree with the bank until it is recorded. Ask your accountant whether it is capital introduced (equity) or a loan (liability).'
          : 'Capital introduced and drawings are shown as recorded. Money lent to or borrowed from a related business belongs under a loan account (Accounts tab), not in drawings.',
        'Owner’s drawings are withdrawals of profit by the sole trader; they are not an expense and not wages.',
      ],
      summary: [
        { label: 'Capital introduced (net)', value: eqTotal, format: 'money' },
        { label: 'Drawings', value: drawTotal, format: 'money' },
        { label: 'Loan accounts with activity', value: loanRows.length, format: 'int' },
      ],
      sections: [
        { title: 'Owner’s equity entries (capital introduced / adjustments)', columns: [cDate('date', 'Date'), cText('description', 'Description'), cText('type', 'Type'), cMoney('introduced', 'Introduced')], rows: eqRows, totals: { description: 'Total', introduced: eqTotal } },
        { title: 'Drawings', columns: [cDate('date', 'Date'), cText('description', 'Description'), cText('via', 'Paid from'), cMoney('amount', 'Amount')], rows: drawRows, totals: { description: 'Total', amount: drawTotal } },
        { title: 'Loan and other liability accounts you have added', columns: [cText('account', 'Account'), cMoney('opening', 'Opening'), cMoney('received', 'Received'), cMoney('repaid', 'Repaid'), cMoney('closing', 'Closing')], rows: loanRows },
      ],
    });
  }));

  // ── Expense Listing with evidence ────────────────────────────────────────────
  router.get('/expense-listing', wrap(async (req, res) => {
    const userId = req.user.id;
    const r = needRange(req, res); if (!r) return;
    const ROW_CAP = 5000;
    const [exp, assets] = await Promise.all([
      pool.query(
        `SELECT e.date, e.supplier, e.description, e.category, COALESCE(t.code,'') AS code, e.amount, e.gst,
                COALESCE(pa.name,'Bank / Cash') AS via, e."isCapitalAsset", e."inputTaxed", e.receipt_path, ${DOC_COUNT} AS docs
         FROM fin_expenses e LEFT JOIN fin_tx_codes t ON t.id = e."txCodeId" LEFT JOIN fin_accounts pa ON pa.id = e."paidViaId"
         WHERE e."userId"=$1 AND e.date BETWEEN $2::date AND $3::date ORDER BY e.date, e.id LIMIT ${ROW_CAP + 1}`, [userId, r.from, r.to]),
      pool.query(
        `SELECT a."datePurchased", a.description, a.amount, a.gst, COALESCE(pa.name,'Bank / Cash') AS via, a.method,
                (SELECT COUNT(*)::int FROM fin_document_links l WHERE l."assetId" = a.id) AS docs
         FROM fin_assets a LEFT JOIN fin_accounts pa ON pa.id = a."paidViaId"
         WHERE a."userId"=$1 AND a.method IS DISTINCT FROM 'immediate' AND a."datePurchased" BETWEEN $2::date AND $3::date ORDER BY a."datePurchased", a.id`, [userId, r.from, r.to]),
    ]);
    const capped = exp.rows.length > ROW_CAP; if (capped) exp.rows.length = ROW_CAP;
    const calc = (x) => /^Depreciation FY/.test(x.description || '');
    const evidence = (x) => x.receipt_path && x.docs ? `Receipt + ${x.docs} doc${x.docs === 1 ? '' : 's'}` : x.receipt_path ? 'Receipt' : x.docs ? `${x.docs} document${x.docs === 1 ? '' : 's'}` : calc(x) ? 'n/a (calculated)' : 'None';
    const { rows: [mapRow] } = await pool.query(`SELECT value FROM settings WHERE "userId"=$1 AND key='fin_export_account_map'`, [userId]);
    let acctMap = {}; try { acctMap = mapRow ? JSON.parse(mapRow.value) || {} : {}; } catch { acctMap = {}; }
    const rows = exp.rows.map(x => ({
      accLabel: (acctMap[x.code] && (acctMap[x.code].name || acctMap[x.code].code)) || '',
      date: ds(x.date), supplier: x.supplier || '', description: x.description, category: x.category || '', code: x.code,
      amount: round2(x.amount), gst: round2(x.gst), total: round2(num(x.amount) + num(x.gst)), via: x.via,
      evidence: evidence(x), flags: [x.isCapitalAsset ? 'Capital' : '', x.inputTaxed ? 'Input-taxed' : ''].filter(Boolean).join(', '),
    }));
    const noEv = rows.filter(x => x.evidence === 'None').length;
    const T = (k) => round2(rows.reduce((s2, x) => s2 + x[k], 0));
    const assetRows = assets.rows.map(x => ({ date: ds(x.datePurchased), description: x.description, method: (x.method || '').replace(/_/g, ' '), amount: round2(x.amount), gst: round2(x.gst), total: round2(num(x.amount) + num(x.gst)), via: x.via, evidence: x.docs ? `${x.docs} document${x.docs === 1 ? '' : 's'}` : 'None' }));
    res.json({
      title: 'Expense Listing',
      subtitle: `${r.from} to ${r.to}`,
      notes: [
        'Every expense in date order, with the account it was paid from and whether evidence (a receipt or a linked document such as a provider statement) is attached. “n/a” rows are calculated claims or depreciation, which have no receipt by nature. Evidence lives in the Documents tab.',
        ...(capped ? [`Showing the first ${ROW_CAP} expenses — narrow the date range.`] : []),
      ],
      summary: [
        { label: 'Expenses', value: rows.length, format: 'int' },
        { label: 'Total (incl. GST)', value: T('total'), format: 'money' },
        { label: 'With no evidence attached', value: noEv, format: 'int' },
      ],
      sections: [
        { title: 'Expenses', columns: [cDate('date', 'Date'), cText('supplier', 'Supplier'), cText('description', 'Description'), cText('category', 'Category'), cText('code', 'Code'), ...(rows.some(x => x.accLabel) ? [cText('accLabel', 'Accountant label')] : []), cMoney('amount', 'Ex-GST'), cMoney('gst', 'GST'), cMoney('total', 'Total'), cText('via', 'Paid from'), cText('evidence', 'Evidence'), cText('flags', 'Flags')], rows, totals: { description: 'Total', amount: T('amount'), gst: T('gst'), total: T('total') } },
        { title: 'Depreciating asset purchases', columns: [cDate('date', 'Date'), cText('description', 'Asset'), cText('method', 'Method'), cMoney('amount', 'Cost ex-GST'), cMoney('gst', 'GST'), cMoney('total', 'Total'), cText('via', 'Paid from'), cText('evidence', 'Evidence')], rows: assetRows },
      ],
    });
  }));

  // ── Things to Review ─────────────────────────────────────────────────────────
  router.get('/review-items', wrap(async (req, res) => {
    const userId = req.user.id;
    const b = needFy(req, res); if (!b) return;
    const reg = await getGstRegistration(pool, userId);
    const items = [];
    const add = (severity, area, item, detail, count, amount) => items.push({ severity, area, item, detail, count: count ?? '', amount: amount ?? '' });

    // GST quarters
    const { rows: qs } = await pool.query(`SELECT from_date, to_date, status FROM fin_bas_quarters WHERE "userId"=$1 AND to_date >= $2::date AND from_date <= $3::date ORDER BY from_date`, [userId, b.from, b.to]);
    for (const q of qs) {
      if (q.status !== 'paid' && gstAppliesOn(reg, q.from_date)) add('Check', 'BAS', `Quarter ${ds(q.from_date)} to ${ds(q.to_date)} is ${q.status}, not paid`, 'Record it as reconciled, lodged and paid on the BAS tab once it has been done.');
    }
    // tax paid through expenses
    const { rows: [tx] } = await pool.query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(e.amount + e.gst),0) AS total FROM fin_expenses e LEFT JOIN fin_tx_codes t ON t.id = e."txCodeId"
       WHERE e."userId"=$1 AND e.date BETWEEN $2::date AND $3::date AND ${TAXISH}`, [userId, b.from, b.to]);
    if (tx.n) add('Check', 'Tax', 'Payments to the ATO recorded as expenses', 'GST and tax payments are not deductions. Record them as BAS payments (or ask your accountant), then remove the expense.', tx.n, round2(tx.total));
    // wages without PAYG
    const { rows: [wg] } = await pool.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(gross),0) AS gross FROM fin_wages WHERE "userId"=$1 AND date BETWEEN $2::date AND $3::date AND tax = 0`, [userId, b.from, b.to]);
    if (wg.n) add('Check', 'Wages', 'Wage entries with no PAYG withheld', 'If this is your own pay it should be Owner’s Drawings, not wages. Employee wages normally have PAYG withheld.', wg.n, round2(wg.gross));
    // invoices
    const { rows: [dr] } = await pool.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(total),0) AS total FROM fin_invoices WHERE "userId"=$1 AND COALESCE("docType",'invoice')='invoice' AND status='draft' AND "issueDate" BETWEEN $2::date AND $3::date`, [userId, b.from, b.to]);
    if (dr.n) add('Info', 'Invoices', 'Draft invoices dated in the year (not counted as income)', 'Send or delete them.', dr.n, round2(dr.total));
    const { rows: [od] } = await pool.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(total),0) AS total FROM fin_invoices WHERE "userId"=$1 AND COALESCE("docType",'invoice')='invoice' AND status='sent' AND "dueDate" < CURRENT_DATE - 30`, [userId]);
    if (od.n) add('Info', 'Invoices', 'Invoices more than 30 days overdue', 'Follow up, or write off with your accountant.', od.n, round2(od.total));
    // GST after cancellation
    if (!reg.registered && reg.effectiveFrom) {
      const { rows: [gi] } = await pool.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(gst),0) AS gst FROM fin_invoices WHERE "userId"=$1 AND gst > 0 AND "issueDate" >= $2::date`, [userId, reg.effectiveFrom]);
      if (gi.n) add('Check', 'GST', `Invoices dated on or after ${reg.effectiveFrom} that include GST`, 'You are not GST registered from that date.', gi.n, round2(gi.gst));
      const { rows: [ge] } = await pool.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(gst),0) AS gst FROM fin_expenses WHERE "userId"=$1 AND gst > 0 AND date >= $2::date`, [userId, reg.effectiveFrom]);
      if (ge.n) add('Check', 'GST', `Purchases dated on or after ${reg.effectiveFrom} with GST claimed`, 'No GST credit can be claimed once not registered.', ge.n, round2(ge.gst));
    }
    // classification and evidence
    const { rows: [uc] } = await pool.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(amount+gst),0) AS total FROM fin_expenses WHERE "userId"=$1 AND date BETWEEN $2::date AND $3::date AND "txCodeId" IS NULL AND COALESCE(category,'')='' AND description NOT LIKE 'Depreciation FY%'`, [userId, b.from, b.to]);
    if (uc.n) add('Check', 'Expenses', 'Expenses with no category or code', 'The Tax Time Summary groups deductions by category.', uc.n, round2(uc.total));
    const { rows: [me] } = await pool.query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(e.amount+e.gst),0) AS total FROM fin_expenses e
       WHERE e."userId"=$1 AND e.date BETWEEN $2::date AND $3::date AND (e.amount+e.gst) >= 50 AND e.receipt_path IS NULL
         AND NOT EXISTS (SELECT 1 FROM fin_document_links l WHERE l."expenseId"=e.id) AND e.description NOT LIKE 'Depreciation FY%'
         AND NOT EXISTS (SELECT 1 FROM fin_vehicle_expenses v WHERE v."expenseId"=e.id AND v.method='cents_per_km')
         AND NOT EXISTS (SELECT 1 FROM fin_home_office_expenses h WHERE h."expenseId"=e.id AND h.method='fixed_rate')`, [userId, b.from, b.to]);
    if (me.n) add('Info', 'Evidence', 'Expenses of $50 or more with no receipt, invoice or statement attached', 'Upload provider statements/invoices in the Documents tab and link them.', me.n, round2(me.total));
    const { rows: [ud] } = await pool.query(`SELECT COUNT(*)::int AS n FROM fin_documents d WHERE d."userId"=$1 AND d.fy=$2 AND NOT EXISTS (SELECT 1 FROM fin_document_links l WHERE l."documentId"=d.id)`, [userId, b.fy]);
    if (ud.n) add('Info', 'Evidence', 'Uploaded documents not linked to any expense or asset', 'Link them so it’s clear what they support.', ud.n);
    // assets
    const { rows: [ua] } = await pool.query(`SELECT COUNT(*)::int AS n FROM fin_assets WHERE "userId"=$1 AND method IS DISTINCT FROM 'immediate' AND "disposedDate" IS NULL AND "dateFirstUsed" <= $3::date AND ("lastDepreciatedFy" IS NULL OR "lastDepreciatedFy" < $2)`, [userId, b.fy, b.to]);
    if (ua.n) add('Check', 'Assets', `Assets with no depreciation posted up to FY ${b.fy}`, 'Run the annual depreciation on the Assets tab.', ua.n);
    // books integrity
    const { rows: [cap] } = await pool.query(`SELECT COUNT(*)::int AS n FROM fin_journal_lines l JOIN fin_journal_entries e ON e.id=l."entryId" JOIN fin_accounts a ON a.id=l."accountId" WHERE e."userId"=$1 AND a.code='3000' AND e.date <= $2::date`, [userId, b.to]);
    if (!cap.n) add('Check', 'Opening position', 'No opening balance or capital introduced is recorded', 'If the business started with money or owed money, record it so the bank balance in the books can match your statements.');
    const { rows: [bank] } = await pool.query(`SELECT COALESCE(SUM(l.debit - l.credit),0) AS bal FROM fin_journal_lines l JOIN fin_journal_entries e ON e.id=l."entryId" JOIN fin_accounts a ON a.id=l."accountId" WHERE e."userId"=$1 AND a.code='1000' AND e.date <= $2::date`, [userId, b.to]);
    if (num(bank.bal) < 0) add('Check', 'Bank', `The bank balance in the books is negative at ${b.to}`, 'That usually means money in is missing (capital introduced, an unrecorded deposit) or an entry is duplicated. Compare with the Cash Book.', '', round2(bank.bal));
    const { rows: [mj] } = await pool.query(`SELECT COUNT(*)::int AS n FROM fin_journal_entries WHERE "userId"=$1 AND type='manual' AND date BETWEEN $2::date AND $3::date`, [userId, b.from, b.to]);
    if (mj.n) add('Info', 'Journal', 'Manual journal entries in the year', 'Listed in the General Ledger; your accountant may ask what they are for.', mj.n);

    const checks = items.filter(i => i.severity === 'Check').length;
    res.json({
      title: 'Things to Review',
      subtitle: `Financial year ${b.fy} (${b.from} to ${b.to})`,
      notes: ['A checklist generated from the books: “Check” items usually mean the figures are wrong or incomplete; “Info” items are worth a look. It is for you to clear before sending the pack, and for your accountant to see what is unresolved.'],
      summary: [{ label: 'Items to check', value: checks, format: 'int' }, { label: 'For information', value: items.length - checks, format: 'int' }],
      sections: [{
        title: items.length ? 'Items' : 'Items',
        columns: [cText('severity', 'Level'), cText('area', 'Area'), cText('item', 'Item'), cText('detail', 'What to do'), cInt('count', 'Count'), cMoney('amount', 'Amount')],
        rows: items.length ? items : [{ severity: 'OK', area: '', item: 'Nothing to flag', detail: '', count: '', amount: '' }],
      }],
    });
  }));

  // ── Documents Index ──────────────────────────────────────────────────────────
  router.get('/documents-index', wrap(async (req, res) => {
    const userId = req.user.id;
    const biz = await bizName(userId);
    const b = needFy(req, res); if (!b) return;
    const { rows } = await pool.query(
      `SELECT d.id, d.kind, d.title, d.supplier, d."docDate", d."originalName", d."sizeBytes",
              COALESCE((SELECT string_agg(COALESCE(e.description, a.description), '; ' ORDER BY COALESCE(e.date, a."datePurchased"))
                        FROM fin_document_links l LEFT JOIN fin_expenses e ON e.id = l."expenseId" LEFT JOIN fin_assets a ON a.id = l."assetId"
                        WHERE l."documentId" = d.id), '') AS links,
              (SELECT COUNT(*)::int FROM fin_document_links l WHERE l."documentId" = d.id) AS n
       FROM fin_documents d WHERE d."userId"=$1 AND d.fy=$2
         AND d.id NOT IN (SELECT "redactedFromId" FROM fin_documents WHERE "userId"=$1 AND "redactedFromId" IS NOT NULL)
       ORDER BY COALESCE(d."docDate", d."createdAt"::date), d.id`, [userId, b.fy]);
    const KIND = { invoice: 'Invoice', receipt: 'Receipt', statement: 'Statement', bank_statement: 'Bank statement', ato_notice: 'ATO notice', other: 'Other' };
    res.json({
      title: 'Supporting Documents Index',
      subtitle: `Financial year ${b.fy}`,
      notes: [`The statements, invoices and receipts kept in ${biz}’s records for this year and what each one supports. The files themselves can be included in the pack as a zip; ask for any you need.`],
      summary: [{ label: 'Documents', value: rows.length, format: 'int' }, { label: 'Not linked to anything', value: rows.filter(x => !x.n && !['bank_statement', 'ato_notice'].includes(x.kind)).length, format: 'int' }],
      sections: [{
        title: 'Documents',
        columns: [cDate('date', 'Date'), cText('title', 'Title'), cText('kind', 'Type'), cText('supplier', 'Supplier'), cText('file', 'File name'), cText('supports', 'Supports')],
        rows: rows.map(x => ({ date: ds(x.docDate), title: x.title, kind: KIND[x.kind] || x.kind, supplier: x.supplier || '', file: x.originalName, supports: x.n ? `${x.n} item${x.n === 1 ? '' : 's'}: ${x.links}` : (['bank_statement', 'ato_notice'].includes(x.kind) ? 'Kept as a record' : 'Not linked') })),
      }],
    });
  }));

  // ── Chart of Accounts & Codes (with the accountant's mapped labels) ──────────
  router.get('/chart-of-accounts', wrap(async (req, res) => {
    const userId = req.user.id;
    const biz = await bizName(userId);
    const [accts, codes, mapRow] = await Promise.all([
      pool.query(`SELECT code, name, type, "isSystem" FROM fin_accounts WHERE "userId"=$1 ORDER BY code`, [userId]),
      pool.query(`SELECT code, name, type, "isActive" AS active FROM fin_tx_codes WHERE "userId"=$1 ORDER BY type, code`, [userId]),
      pool.query(`SELECT value FROM settings WHERE "userId"=$1 AND key='fin_export_account_map'`, [userId]),
    ]);
    let map = {};
    try { map = mapRow.rows[0] ? JSON.parse(mapRow.rows[0].value) || {} : {}; } catch { map = {}; }
    const m = (code) => map[code] || {};
    const aRows = accts.rows.map(a => ({ code: a.code, name: a.name, type: a.type, accCode: m(a.code).code || '', accName: m(a.code).name || '', myob: m(a.code).myobTax || '', xero: m(a.code).xeroTax || '' }));
    const cRows = codes.rows.map(c => ({ code: c.code, name: c.name, type: c.type, active: c.active === false ? 'No' : 'Yes', accCode: m(c.code).code || '', accName: m(c.code).name || '' }));
    const mapped = aRows.filter(a => a.accCode || a.accName).length + cRows.filter(c => c.accCode || c.accName).length;
    res.json({
      title: 'Chart of Accounts & Codes',
      subtitle: mapped ? `${mapped} mapped to your accountant’s codes` : 'Not yet mapped to your accountant’s codes',
      notes: [
        `${biz}’s own account list and the income/expense codes used to group transactions. The “Accountant code / label” columns are filled where your accountant’s equivalent has been entered (Finance → Settings → Export account mapping); blank means the name used in ${biz}’s books applies. Your accountant can type their codes straight into these columns.`,
      ],
      summary: [{ label: 'Accounts', value: aRows.length, format: 'int' }, { label: 'Income/expense codes', value: cRows.length, format: 'int' }, { label: 'Mapped', value: mapped, format: 'int' }],
      sections: [
        { title: 'Accounts', columns: [cText('code', `${biz} code`), cText('name', `${biz} name`), cText('type', 'Type'), cText('accCode', 'Accountant code'), cText('accName', 'Accountant label'), cText('myob', 'MYOB tax'), cText('xero', 'Xero tax')], rows: aRows },
        { title: 'Income & expense codes', columns: [cText('code', `${biz} code`), cText('name', `${biz} name`), cText('type', 'Type'), cText('active', 'Active'), cText('accCode', 'Accountant code'), cText('accName', 'Accountant label')], rows: cRows },
      ],
    });
  }));

  // Field-level change history comes from fin_audit_log, written by database triggers (see db.js), so
  // it covers every route and any direct SQL. Derived journal postings and email attempts are shown
  // alongside it. Optional ?table= narrows to one record type (e.g. fin_invoices).
  const AUDIT_ENTITY = {
    fin_invoices: 'Invoice/quote', fin_expenses: 'Expense', fin_wages: 'Wage', fin_drawings: 'Drawing',
    fin_assets: 'Asset', fin_accounts: 'Account', fin_suppliers: 'Supplier', fin_tx_codes: 'Transaction code',
    fin_recurring: 'Recurring entry', fin_budgets: 'Budget line', fin_bas_quarters: 'BAS quarter',
    fin_journal_entries: 'Manual journal entry', settings: 'Setting',
  };
  const auditVal = (v) => {
    if (v === null || v === undefined) return '(empty)';
    const t = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return t.length > 60 ? t.slice(0, 57) + '…' : t;
  };
  const AUDIT_SECRET = /(account_number|bsb|password|token|secret)/i;

  router.get('/audit-trail', wrap(async (req, res) => {
    const userId = req.user.id;
    const r = needRange(req, res); if (!r) return;
    const table = req.query.table ? String(req.query.table) : null;
    if (table && !AUDIT_ENTITY[table]) return res.status(400).json({ error: 'Unknown table filter' });
    const LIMIT = 1000;
    const [log, je, sends] = await Promise.all([
      pool.query(
        `SELECT "createdAt", "tableName", "rowId", label, action, "changedFields", "rowData"
         FROM fin_audit_log
         WHERE "userId"=$1 AND "createdAt"::date BETWEEN $2::date AND $3::date AND ($4::text IS NULL OR "tableName"=$4)
         ORDER BY "createdAt" DESC, id DESC LIMIT ${LIMIT}`, [userId, r.from, r.to, table]),
      table ? Promise.resolve({ rows: [] }) : pool.query(
        `SELECT e.id, e."createdAt", e.date, e.type, e.description, e.reference,
                (SELECT COALESCE(SUM(debit),0) FROM fin_journal_lines WHERE "entryId" = e.id) AS amount
         FROM fin_journal_entries e
         WHERE e."userId"=$1 AND e."createdAt"::date BETWEEN $2::date AND $3::date
         ORDER BY e."createdAt" DESC LIMIT ${LIMIT}`, [userId, r.from, r.to]),
      table ? Promise.resolve({ rows: [] }) : pool.query(
        `SELECT s."sentAt", s."sentTo", s.ok, s.error, s."pdfAttached", i.number, COALESCE(i."docType",'invoice') AS "docType"
         FROM fin_invoice_send_log s JOIN fin_invoices i ON i.id = s."invoiceId"
         WHERE s."userId"=$1 AND s."sentAt"::date BETWEEN $2::date AND $3::date
         ORDER BY s."sentAt" DESC LIMIT ${LIMIT}`, [userId, r.from, r.to]),
    ]);

    const changeEvents = log.rows.map(x => {
      const entity = AUDIT_ENTITY[x.tableName] || x.tableName;
      const name = x.label ? ` “${x.label}”` : (x.rowId ? ` #${x.rowId}` : '');
      let detail = '';
      let amount = null;
      if (x.action === 'UPDATE') {
        const hide = x.tableName === 'settings' && AUDIT_SECRET.test(x.label || '');
        const parts = Object.entries(x.changedFields || {}).map(([k, v]) =>
          hide ? `${k}: changed` : `${k}: ${auditVal(v.from)} → ${auditVal(v.to)}`);
        detail = parts.slice(0, 8).join('; ') + (parts.length > 8 ? `; +${parts.length - 8} more` : '');
      } else {
        const d = x.rowData || {};
        amount = num(d.total ?? d.amount ?? d.gross ?? 0) || null;
        detail = x.action === 'INSERT' ? 'Created' : 'Deleted — row kept here for the record';
      }
      return {
        when: x.createdAt,
        event: `${entity}${name} ${x.action === 'INSERT' ? 'created' : x.action === 'UPDATE' ? 'changed' : 'deleted'}`,
        detail, type: x.tableName.replace(/^fin_/, ''), entryDate: null, amount, result: '',
      };
    });
    const events = [
      ...changeEvents,
      ...je.rows.map(x => ({ when: x.createdAt, event: 'Journal entry posted', detail: `${x.description}${x.reference ? ` (${x.reference})` : ''}`, type: x.type, entryDate: ds(x.date), amount: round2(x.amount), result: '' })),
      ...sends.rows.map(x => ({ when: x.sentAt, event: `${x.docType === 'quote' ? 'Quote' : 'Invoice'} ${x.number} sent`, detail: `To ${x.sentTo}${x.pdfAttached ? ' · PDF attached' : ''}`, type: 'send', entryDate: null, amount: null, result: x.ok ? 'OK' : `Failed: ${x.error || 'unknown error'}` })),
    ].sort((a, b) => new Date(b.when) - new Date(a.when)).slice(0, LIMIT);

    res.json({
      title: 'Audit Trail',
      subtitle: `Activity recorded ${r.from} to ${r.to}${table ? ` · ${AUDIT_ENTITY[table]} only` : ''}`,
      notes: [
        'Every create, edit and delete of an invoice/quote, expense, wage, drawing, asset, account, supplier, code, recurring entry, budget line, BAS quarter, manual journal entry and Finance setting is recorded by the database itself, with the old and new value of each changed field. Deleted records are kept here in full.',
        'History starts from when this feature was installed; earlier changes were not captured. Invoice line items are not listed one by one (an edit rebuilds them) — the invoice’s subtotal, GST and total changes are. Bank details show as “changed” without the value. Derived journal postings and email attempts are listed too.',
        ...((log.rows.length >= LIMIT || je.rows.length >= LIMIT || sends.rows.length >= LIMIT) ? [`Showing the most recent ${LIMIT} items per source — narrow the date range for older activity.`] : []),
      ],
      summary: [
        { label: 'Record changes', value: log.rows.length, format: 'int' },
        { label: 'Journal entries posted', value: je.rows.length, format: 'int' },
        { label: 'Emails sent', value: sends.rows.filter(s => s.ok).length, format: 'int' },
        { label: 'Failed sends', value: sends.rows.filter(s => !s.ok).length, format: 'int' },
      ],
      sections: [{
        title: 'Activity',
        columns: [{ key: 'when', label: 'When', format: 'datetime' }, { ...cText('event', 'Event'), wide: true }, { ...cText('detail', 'Detail'), wide: true }, cText('type', 'Type'), cDate('entryDate', 'Entry date'), cMoney('amount', 'Amount'), cText('result', 'Result')],
        rows: events,
      }],
    });
  }));

  return router;
};
