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

const CASH_NOTE = 'GST-related figures are cash basis (recognised when paid/received). If you report GST on an accrual basis they will not match your actual BAS.';
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
module.exports = function createFinanceReportsRouter({ gstPaidForRange }) {
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
  // This app records expenses when they are PAID (cash), so there is no supplier-bill / accounts-
  // payable ledger. The only unpaid supplier obligations it tracks are purchases put on a credit
  // card (a liability account) that have not been settled yet — that is what this report ages.
  router.get('/aged-payables', wrap(async (req, res) => {
    const userId = req.user.id;
    const asOf = needAsOf(req, res); if (!asOf) return;

    const [exp, assets, liab] = await Promise.all([
      pool.query(
        `SELECT e.id, e.date, e.description, COALESCE(NULLIF(e.supplier,''),'(No supplier)') AS supplier, (e.amount + e.gst) AS total
         FROM fin_expenses e
         JOIN fin_accounts pa ON pa.id = e."paidViaId" AND pa.type = 'liability'
         WHERE e."userId"=$1 AND e."ccSettled" = false AND e.date <= $2::date
         ORDER BY e.date`, [userId, asOf]),
      pool.query(
        `SELECT a.id, a."datePurchased" AS date, a.description, (a.amount + a.gst) AS total
         FROM fin_assets a
         JOIN fin_accounts pa ON pa.id = a."paidViaId" AND pa.type = 'liability'
         WHERE a."userId"=$1 AND a."ccSettled" = false AND a.method IS DISTINCT FROM 'immediate'
           AND a."datePurchased" <= $2::date
         ORDER BY a."datePurchased"`, [userId, asOf]),
      accountTotals(userId, null, asOf, ['liability']),
    ]);

    const AGE = [
      { key: 'a0', label: '0–30 days', max: 30 }, { key: 'a30', label: '31–60 days', max: 60 },
      { key: 'a60', label: '61–90 days', max: 90 }, { key: 'a90', label: '90+ days', max: Infinity },
    ];
    const ageKey = (d) => AGE.find(a => d <= a.max).key;

    const items = [
      ...exp.rows.map(r => ({ supplier: r.supplier, description: r.description, date: ds(r.date), amount: num(r.total) })),
      ...assets.rows.map(r => ({ supplier: '(Asset purchases)', description: r.description, date: ds(r.date), amount: num(r.total) })),
    ].map(i => ({ ...i, days: diffDays(i.date, asOf) })).map(i => ({ ...i, bucket: ageKey(i.days) }));

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

    const liabRows = liab
      .map(r => ({ code: r.code, name: r.name, balance: round2(r.credit - r.debit) }))
      .filter(r => r.balance !== 0);
    const liabTotal = round2(liabRows.reduce((s, r) => s + r.balance, 0));

    res.json({
      title: 'Aged Payables',
      subtitle: `Unpaid supplier purchases as of ${asOf}`,
      notes: [
        'Expenses in this app are recorded when paid, so there is no separate supplier-bill ledger. This report ages purchases charged to a credit card that have not yet been settled, by days since purchase.',
        'Settlement dates are not stored, so the unsettled list always reflects what is unsettled today, limited to purchases dated on or before the as-of date. The liability balances table below is date-accurate (from the journal).',
      ],
      summary: [
        { label: 'Unsettled card purchases', value: totals.total, format: 'money' },
        { label: 'Items', value: items.length, format: 'int' },
        { label: 'Total liabilities (journal)', value: liabTotal, format: 'money' },
      ],
      sections: [
        { title: 'Unsettled credit-card purchases by supplier', columns: [cText('supplier', 'Supplier'), ...AGE.map(a => cMoney(a.key, a.label)), cMoney('total', 'Total')], rows: supplierRows, totals: { supplier: 'Total', ...totals } },
        { title: 'Unsettled items', columns: [cDate('date', 'Date'), cText('supplier', 'Supplier'), cText('description', 'Description'), cInt('days', 'Days'), cMoney('amount', 'Amount')], rows: items.sort((a, b) => b.days - a.days) },
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
    const [sales, capExp, nonCapExp, assets, wages, gstPaid] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(total),0) AS g1, COALESCE(SUM(gst),0) AS gst FROM fin_invoices
         WHERE "userId"=$1 AND status='paid' AND "paidAt"::date BETWEEN $2::date AND $3::date`, [userId, r.from, r.to]),
      pool.query(
        `SELECT COALESCE(SUM(amount + gst),0) AS total FROM fin_expenses
         WHERE "userId"=$1 AND "isCapitalAsset"=true AND date BETWEEN $2::date AND $3::date`, [userId, r.from, r.to]),
      pool.query(
        `SELECT COALESCE(SUM(amount + gst),0) AS total FROM fin_expenses
         WHERE "userId"=$1 AND "isCapitalAsset"=false AND description NOT LIKE $4 AND date BETWEEN $2::date AND $3::date`,
        [userId, r.from, r.to, DEPR_PREFIX + '%']),
      pool.query(
        `SELECT COALESCE(SUM(amount + gst),0) AS total FROM fin_assets
         WHERE "userId"=$1 AND method IS DISTINCT FROM 'immediate' AND "datePurchased" BETWEEN $2::date AND $3::date`, [userId, r.from, r.to]),
      pool.query(
        `SELECT COALESCE(SUM(gross),0) AS w1, COALESCE(SUM(tax),0) AS w2 FROM fin_wages
         WHERE "userId"=$1 AND date BETWEEN $2::date AND $3::date`, [userId, r.from, r.to]),
      gstPaidForRange(userId, r.from, r.to),
    ]);
    const g1 = round2(sales.rows[0].g1), a1 = round2(sales.rows[0].gst);
    const g10 = round2(num(capExp.rows[0].total) + num(assets.rows[0].total));
    const g11 = round2(nonCapExp.rows[0].total);
    const b1 = round2(gstPaid);
    const w1 = round2(wages.rows[0].w1), w2 = round2(wages.rows[0].w2);
    const netGst = round2(a1 - b1);
    const payable = round2(netGst + w2);

    const rows = [
      { section: 'GST — sales', label: 'G1', desc: 'Total sales (incl. GST)', amount: g1 },
      { section: 'GST — sales', label: '1A', desc: 'GST on sales', amount: a1 },
      { section: 'GST — purchases', label: 'G10', desc: 'Capital purchases (incl. GST)', amount: g10 },
      { section: 'GST — purchases', label: 'G11', desc: 'Non-capital purchases (incl. GST)', amount: g11 },
      { section: 'GST — purchases', label: '1B', desc: 'GST on purchases', amount: b1 },
      { section: 'PAYG withholding', label: 'W1', desc: 'Total salary, wages and other payments', amount: w1 },
      { section: 'PAYG withholding', label: 'W2', desc: 'Amount withheld from payments', amount: w2 },
      { section: 'Result', label: '1A − 1B', desc: 'Net GST (positive = payable to the ATO)', amount: netGst },
      { section: 'Result', label: '1A − 1B + W2', desc: 'Total payable / (refundable) for this BAS', amount: payable, _bold: true },
    ];
    res.json({
      title: 'BAS Worksheet',
      subtitle: `${r.from} to ${r.to}`,
      notes: [
        CASH_NOTE,
        'Worksheet only — check every figure against the ATO BAS form (and your accountant) before lodging. GST-free and input-taxed sales/purchases (G2, G3, G13, G14 …) are not separated out by this app, and PAYG instalments (T7) are not tracked.',
      ],
      summary: [
        { label: 'GST on sales (1A)', value: a1, format: 'money' },
        { label: 'GST on purchases (1B)', value: b1, format: 'money' },
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
        `SELECT COALESCE(SUM(gst),0) AS gst FROM fin_invoices WHERE "userId"=$1 AND status='paid' AND "paidAt"::date BETWEEN $2::date AND $3::date`,
        [userId, b.from, b.to]),
      gstPaidForRange(userId, b.from, b.to),
    ]);

    const wGross = round2(wages.rows[0].gross), wSuper = round2(wages.rows[0].super);
    const expRows = expByCode.rows.map(x => ({ item: x.category, amount: round2(x.amount) }));
    const expListed = round2(expRows.reduce((s, x) => s + x.amount, 0));
    const depAmt = round2(dep.rows[0].amount);
    // Anything in the journal's expense accounts that the source tables above don't explain
    // (manual journals, rounding) — shown so the deductions total always ties to the P&L.
    const unexplained = round2(pl.totalExpense - expListed - wGross - wSuper - depAmt);
    const gstCollected = round2(inv.rows[0].gst), gstPd = round2(gstPaid);
    const km = round2(veh.rows.reduce((s, x) => s + num(x.km), 0)), vehAmt = round2(veh.rows.reduce((s, x) => s + num(x.amount), 0));
    const hrs = round2(ho.rows.reduce((s, x) => s + num(x.hours), 0)), hoAmt = round2(ho.rows.reduce((s, x) => s + num(x.amount), 0));
    const cols = [cText('item', 'Item'), cMoney('amount', 'Amount')];

    res.json({
      title: 'Tax Time Summary',
      subtitle: `Financial year ${b.fy} (${b.from} to ${b.to})`,
      notes: [
        'A hand-over summary for your accountant / tax return, not tax advice. Figures come from the journal and source records and are ex-GST unless stated.',
        'Business income here is booked when invoices are issued (accrual, per the journal) — GST below is cash basis.',
      ],
      summary: [
        { label: 'Business income', value: pl.totalIncome, format: 'money' },
        { label: 'Total deductions', value: pl.totalExpense, format: 'money' },
        { label: 'Net profit', value: pl.net, format: 'money' },
        { label: "Owner's drawings", value: round2(drawings.rows[0].amount), format: 'money' },
      ],
      sections: [
        { title: 'Income', columns: [cText('item', 'Account'), cMoney('amount', 'Amount')], rows: pl.income.map(x => ({ item: `${x.code} ${x.name}`, amount: x.amount })), totals: { item: 'Total business income', amount: pl.totalIncome } },
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
          title: 'GST (cash basis)',
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
  router.get('/audit-trail', wrap(async (req, res) => {
    const userId = req.user.id;
    const r = needRange(req, res); if (!r) return;
    const LIMIT = 1000;
    const [je, sends] = await Promise.all([
      pool.query(
        `SELECT e.id, e."createdAt", e.date, e.type, e.description, e.reference,
                (SELECT COALESCE(SUM(debit),0) FROM fin_journal_lines WHERE "entryId" = e.id) AS amount
         FROM fin_journal_entries e
         WHERE e."userId"=$1 AND e."createdAt"::date BETWEEN $2::date AND $3::date
         ORDER BY e."createdAt" DESC LIMIT ${LIMIT}`, [userId, r.from, r.to]),
      pool.query(
        `SELECT s."sentAt", s."sentTo", s.ok, s.error, s."pdfAttached", i.number, COALESCE(i."docType",'invoice') AS "docType"
         FROM fin_invoice_send_log s JOIN fin_invoices i ON i.id = s."invoiceId"
         WHERE s."userId"=$1 AND s."sentAt"::date BETWEEN $2::date AND $3::date
         ORDER BY s."sentAt" DESC LIMIT ${LIMIT}`, [userId, r.from, r.to]),
    ]);
    const events = [
      ...je.rows.map(x => ({ when: x.createdAt, event: 'Journal entry created', detail: `${x.description}${x.reference ? ` (${x.reference})` : ''}`, type: x.type, entryDate: ds(x.date), amount: round2(x.amount), result: '' })),
      ...sends.rows.map(x => ({ when: x.sentAt, event: `${x.docType === 'quote' ? 'Quote' : 'Invoice'} ${x.number} sent`, detail: `To ${x.sentTo}${x.pdfAttached ? ' · PDF attached' : ''}`, type: 'send', entryDate: null, amount: null, result: x.ok ? 'OK' : `Failed: ${x.error || 'unknown error'}` })),
    ].sort((a, b) => new Date(b.when) - new Date(a.when)).slice(0, LIMIT);

    res.json({
      title: 'Audit Trail',
      subtitle: `Activity recorded ${r.from} to ${r.to}`,
      notes: [
        'Activity log, not a full audit trail: it lists when each journal entry was created and every invoice/quote email attempt. Finance does not keep field-level edit history, and an edited invoice/expense replaces its journal entry, so the earlier version is not retained.',
        ...((je.rows.length >= LIMIT || sends.rows.length >= LIMIT) ? [`Showing the most recent ${LIMIT} items per source — narrow the date range for older activity.`] : []),
      ],
      summary: [
        { label: 'Journal entries created', value: je.rows.length, format: 'int' },
        { label: 'Emails sent', value: sends.rows.filter(s => s.ok).length, format: 'int' },
        { label: 'Failed sends', value: sends.rows.filter(s => !s.ok).length, format: 'int' },
      ],
      sections: [{
        title: 'Activity',
        columns: [{ key: 'when', label: 'When', format: 'datetime' }, cText('event', 'Event'), cText('detail', 'Detail'), cText('type', 'Type'), cDate('entryDate', 'Entry date'), cMoney('amount', 'Amount'), cText('result', 'Result')],
        rows: events,
      }],
    });
  }));

  return router;
};
