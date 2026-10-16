#!/usr/bin/env node
/**
 * Finance regression tests: invoice/journal lifecycle, depreciation dates, recurring-expense posting.
 * Integration test: needs a real Postgres (the SQL is the point). Uses a throwaway user that is
 * deleted afterwards (all fin_* tables cascade from users).
 *
 * Run: DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_local node server/routes/finance.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
if (!process.env.DATABASE_URL) {
  console.log('SKIP finance.test.js: set DATABASE_URL to a local Postgres (see docs/local-dev-windows.md)');
  process.exit(0);
}

const assert = require('assert');
const fsx = require('fs');
const os = require('os');
const pathx = require('path');
// uploads from these tests go to a throwaway folder (read when the finance modules load)
process.env.UPLOAD_DIR = fsx.mkdtempSync(pathx.join(os.tmpdir(), 'fin-docs-test-'));
const http = require('http');
const express = require('express');
const { pool } = require('../db');

let userId;
const router = require('./finance');
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { id: userId, isAdmin: true }; next(); });
app.use('/api/finance', router);

let base;
async function call(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

async function upload(files, fields = {}) {
  const fd = new FormData();
  for (const [name, content, type] of files) fd.append('files', new Blob([content], { type: type || 'application/pdf' }), name);
  for (const [k, v] of Object.entries(fields)) for (const x of [].concat(v)) fd.append(k, x);
  const res = await fetch(base + '/api/finance/documents', { method: 'POST', body: fd });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

// Net balance (debit - credit) of one account code for this user, optionally limited to a journal type.
async function bal(code, type) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(l.debit - l.credit),0)::float AS b
     FROM fin_journal_lines l
     JOIN fin_journal_entries e ON e.id = l."entryId"
     JOIN fin_accounts a ON a.id = l."accountId"
     WHERE e."userId"=$1 AND a.code=$2 AND ($3::text IS NULL OR e.type=$3)`,
    [userId, code, type || null]
  );
  return rows[0].b;
}
async function journalCount(sourceId, type) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM fin_journal_entries WHERE "userId"=$1 AND "sourceId"=$2 AND type=$3`,
    [userId, sourceId, type]
  );
  return rows[0].n;
}
const near = (a, b) => Math.abs(a - b) < 0.005;

async function newInvoice(extra = {}) {
  const r = await call('POST', '/api/finance/invoices', {
    issueDate: '2026-03-10',
    items: [{ description: 'Work', qty: 1, unitPrice: 100 }], // 100 + 10 GST
    ...extra,
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  return r.json;
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ---------------------------------------------------------------- #1 depreciation dates
test('depreciation: pure calc pro-rates a mid-year purchase and stops at disposal (Date inputs)', () => {
  const calc = router.computeAssetYearDepreciation;
  // pg hands back DATE as local-midnight Date objects
  const base = { method: 'prime_cost', amount: 1000, accumulatedDepreciation: 0, effectiveLifeYears: 5, businessUsePercent: 100 };
  const full = calc({ ...base, dateFirstUsed: new Date(2025, 5, 1) }, '2025-26'); // used before the FY
  assert.ok(near(full.decline, 200), `full-year decline ${full.decline}`);
  const half = calc({ ...base, dateFirstUsed: new Date(2026, 0, 1) }, '2025-26'); // 1 Jan -> 30 Jun = 181/365
  assert.ok(near(half.decline, 99.18), `pro-rata decline ${half.decline}`);
  assert.strictEqual(calc({ ...base, dateFirstUsed: new Date(2026, 7, 1) }, '2025-26'), null, 'not yet in use');
  assert.strictEqual(calc({ ...base, dateFirstUsed: new Date(2024, 0, 1), disposedDate: new Date(2025, 0, 1) }, '2025-26'), null, 'disposed before FY');
  const partDisposed = calc({ ...base, dateFirstUsed: new Date(2024, 0, 1), disposedDate: new Date(2025, 11, 31) }, '2025-26');
  assert.ok(partDisposed.decline < 200 && partDisposed.decline > 90, `disposed mid-year ${partDisposed.decline}`);
  // string inputs (preview path) agree with Date inputs (run path)
  const asStr = calc({ ...base, dateFirstUsed: '2026-01-01' }, '2025-26');
  assert.strictEqual(asStr.decline, half.decline);
});

test('depreciation: low-value pool takes 18.75% in the first year however late it was bought, then 37.5% (no day proration)', () => {
  const calc = router.computeAssetYearDepreciation;
  const pool1 = { method: 'low_value_pool', amount: 999.09, accumulatedDepreciation: 0, businessUsePercent: 100 };
  // bought 5 June 2026: only 26 days of FY2025-26, but the pool rate is not prorated
  const y1 = calc({ ...pool1, dateFirstUsed: new Date(2026, 5, 5) }, '2025-26');
  assert.ok(near(y1.decline, 187.33), `first-year pool decline ${y1.decline}`);
  assert.strictEqual(calc({ ...pool1, dateFirstUsed: new Date(2025, 6, 1) }, '2025-26').decline, y1.decline, 'same figure whenever in the year it was bought');
  // second year: 37.5% of the opening balance
  const y2 = calc({ ...pool1, accumulatedDepreciation: y1.decline, dateFirstUsed: new Date(2026, 5, 5) }, '2026-27');
  assert.ok(near(y2.decline, Math.round((999.09 - y1.decline) * 0.375 * 100) / 100), `second-year pool decline ${y2.decline}`);
  // business-use % reduces the deduction, not the decline
  const part = calc({ ...pool1, businessUsePercent: 50, dateFirstUsed: new Date(2026, 5, 5) }, '2025-26');
  assert.ok(near(part.deduction, y1.decline / 2) && near(part.decline, y1.decline));
  // prime cost is still prorated by days
  const pc = calc({ method: 'prime_cost', amount: 1200, accumulatedDepreciation: 0, effectiveLifeYears: 4, businessUsePercent: 100, dateFirstUsed: new Date(2026, 5, 5) }, '2025-26');
  assert.ok(pc.decline < 25, `prime cost still prorated: ${pc.decline}`);
});

test('depreciation: run endpoint posts the same pro-rata figure the preview shows', async () => {
  const a = await call('POST', '/api/finance/assets', {
    datePurchased: '2026-01-01', dateFirstUsed: '2026-01-01', description: 'Test laptop',
    amount: 2000, gstIncluded: false, method: 'prime_cost', effectiveLifeYears: 5,
  });
  assert.strictEqual(a.status, 200, JSON.stringify(a.json));
  const prev = await call('GET', '/api/finance/assets/depreciation/preview?fy=2025-26');
  const p = prev.json.find((x) => x.id === a.json.id);
  assert.ok(p, 'asset in preview');
  const run = await call('POST', '/api/finance/assets/depreciation/run', { fy: '2025-26' });
  assert.strictEqual(run.status, 200, JSON.stringify(run.json));
  const posted = run.json.posted.find((x) => x.id === a.json.id);
  assert.ok(posted, 'asset posted');
  assert.ok(near(posted.deduction, p.deduction), `run ${posted.deduction} vs preview ${p.deduction}`);
  assert.ok(posted.deduction < 200, `pro-rata, not a full year: ${posted.deduction}`); // 2000/5 = 400 full year
});

// ---------------------------------------------------------------- #2 recurring expense journal
test('recurring expense: cron posts a balanced journal (reaches P&L)', async () => {
  const { rows: others } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM fin_recurring WHERE active AND "nextDate" <= CURRENT_DATE + 1 AND "userId" <> $1`, [userId]);
  if (others[0].n > 0) { console.log('    (skipped: other users have due recurring items; would touch their data)'); return; }
  const rec = await call('POST', '/api/finance/recurring', {
    type: 'expense', label: 'Hosting', frequency: 'monthly', nextDate: '2020-01-01',
    template: { description: 'Hosting', amount: 100, gst: 10 },
  });
  assert.strictEqual(rec.status, 200, JSON.stringify(rec.json));
  await require('../cron/recurringCron').runRecurring();
  const { rows } = await pool.query(`SELECT id, amount::float, gst::float FROM fin_expenses WHERE "userId"=$1 AND description='Hosting'`, [userId]);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(await journalCount(rows[0].id, 'expense'), 1, 'journal entry exists');
  assert.ok(near(await bal('5000', 'expense'), 100), 'expense debited ex-GST');
  assert.ok(near(await bal('1200', 'expense'), 10), 'GST paid debited');
  assert.ok(near(await bal('1000', 'expense'), -110), 'bank credited gross');
});

// ---------------------------------------------------------------- #3 mark-paid on a draft
test('mark-paid on a draft posts income first, AR nets to zero', async () => {
  const inv = await newInvoice();
  assert.strictEqual(await journalCount(inv.id, 'invoice'), 0, 'draft has no journal');
  const r = await call('POST', `/api/finance/invoices/${inv.id}/mark-paid`, { paidAt: '2026-03-20' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(await journalCount(inv.id, 'invoice'), 1, 'invoice journal posted');
  assert.strictEqual(await journalCount(inv.id, 'payment'), 1, 'payment journal posted');
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(l.debit-l.credit),0)::float AS b FROM fin_journal_lines l
     JOIN fin_journal_entries e ON e.id=l."entryId" JOIN fin_accounts a ON a.id=l."accountId"
     WHERE e."userId"=$1 AND a.code='1100' AND e."sourceId"=$2`, [userId, inv.id]);
  assert.ok(near(rows[0].b, 0), `AR for this invoice should be 0, got ${rows[0].b}`);
  const again = await call('POST', `/api/finance/invoices/${inv.id}/mark-paid`, {});
  assert.strictEqual(again.status, 400, 'second mark-paid refused');
});

test('mark-paid refuses quotes, void invoices and bad dates', async () => {
  const q = await newInvoice({ docType: 'quote' });
  assert.strictEqual((await call('POST', `/api/finance/invoices/${q.id}/mark-paid`, {})).status, 400);
  const v = await newInvoice();
  assert.strictEqual((await call('PATCH', `/api/finance/invoices/${v.id}/status`, { status: 'void' })).status, 200);
  assert.strictEqual((await call('POST', `/api/finance/invoices/${v.id}/mark-paid`, {})).status, 400);
  const d = await newInvoice();
  assert.strictEqual((await call('POST', `/api/finance/invoices/${d.id}/mark-paid`, { paidAt: 'garbage' })).status, 400);
});

// ---------------------------------------------------------------- #4 convert + edit draft
test('convert quote -> draft invoice has no journal; editing the draft never leaves a stale one', async () => {
  const q = await newInvoice({ docType: 'quote' });
  const c = await call('POST', `/api/finance/invoices/${q.id}/convert`, {});
  assert.strictEqual(c.status, 200, JSON.stringify(c.json));
  const invId = c.json.invoice.id;
  assert.strictEqual(await journalCount(invId, 'invoice'), 0, 'converted draft has no journal');

  // simulate an invoice that already carries a stale journal from the old behaviour
  await call('PATCH', `/api/finance/invoices/${invId}/status`, { status: 'sent' });
  assert.strictEqual(await journalCount(invId, 'invoice'), 1);
  const put = await call('PUT', `/api/finance/invoices/${invId}`, {
    issueDate: '2026-03-10', status: 'draft', items: [{ description: 'Work', qty: 2, unitPrice: 100 }],
  });
  assert.strictEqual(put.status, 200, JSON.stringify(put.json));
  assert.strictEqual(await journalCount(invId, 'invoice'), 0, 'editing back to draft removes the journal');
});

test('editing a sent invoice rebuilds the journal with the new totals', async () => {
  const inv = await newInvoice();
  await call('PATCH', `/api/finance/invoices/${inv.id}/status`, { status: 'sent' });
  const put = await call('PUT', `/api/finance/invoices/${inv.id}`, {
    issueDate: '2026-03-10', status: 'sent', items: [{ description: 'Work', qty: 3, unitPrice: 100 }],
  });
  assert.strictEqual(put.status, 200, JSON.stringify(put.json));
  assert.strictEqual(await journalCount(inv.id, 'invoice'), 1);
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(l.debit),0)::float AS d FROM fin_journal_lines l
     JOIN fin_journal_entries e ON e.id=l."entryId" WHERE e."userId"=$1 AND e."sourceId"=$2 AND e.type='invoice'`, [userId, inv.id]);
  assert.ok(near(rows[0].d, 330), `AR debit should be 330, got ${rows[0].d}`);
});

// ---------------------------------------------------------------- #5 status handling
test('PATCH status: validates values, voiding removes the journal, paid is refused', async () => {
  const inv = await newInvoice();
  assert.strictEqual((await call('PATCH', `/api/finance/invoices/${inv.id}/status`, { status: 'sent' })).status, 200);
  assert.strictEqual(await journalCount(inv.id, 'invoice'), 1);
  assert.strictEqual((await call('PATCH', `/api/finance/invoices/${inv.id}/status`, { status: 'bogus' })).status, 400);
  assert.strictEqual((await call('PATCH', `/api/finance/invoices/${inv.id}/status`, { status: 'paid' })).status, 400, 'paid only via mark-paid');
  assert.strictEqual((await call('PATCH', `/api/finance/invoices/${inv.id}/status`, { status: 'void' })).status, 200);
  assert.strictEqual(await journalCount(inv.id, 'invoice'), 0, 'void removes AR/income');
  // a paid invoice can't be moved
  const p = await newInvoice();
  await call('POST', `/api/finance/invoices/${p.id}/mark-paid`, { paidAt: '2026-03-20' });
  assert.strictEqual((await call('PATCH', `/api/finance/invoices/${p.id}/status`, { status: 'draft' })).status, 400);
  assert.strictEqual(await journalCount(p.id, 'invoice'), 1, 'paid invoice journal untouched');
});

test('PUT: cannot set paid by editing; voiding via edit posts no income', async () => {
  const inv = await newInvoice();
  const bad = await call('PUT', `/api/finance/invoices/${inv.id}`, { issueDate: '2026-03-10', status: 'paid', items: [{ description: 'x', qty: 1, unitPrice: 5 }] });
  assert.strictEqual(bad.status, 400);
  const v = await call('PUT', `/api/finance/invoices/${inv.id}`, { issueDate: '2026-03-10', status: 'void', items: [{ description: 'x', qty: 1, unitPrice: 5 }] });
  assert.strictEqual(v.status, 200, JSON.stringify(v.json));
  assert.strictEqual(await journalCount(inv.id, 'invoice'), 0);
});

test('quotes keep their own statuses and never get journals', async () => {
  const q = await newInvoice({ docType: 'quote' });
  for (const s of ['sent', 'declined', 'accepted', 'draft']) {
    assert.strictEqual((await call('PATCH', `/api/finance/invoices/${q.id}/status`, { status: s })).status, 200, s);
  }
  assert.strictEqual(await journalCount(q.id, 'invoice'), 0);
});

// ---------------------------------------------------------------- credit card settlement
async function ccAccountId() {
  const { rows } = await pool.query(`SELECT id FROM fin_accounts WHERE "userId"=$1 AND code='2100'`, [userId]);
  return rows[0].id;
}

test('cc-unsettle reverses the bank payment, so settling again does not pay twice', async () => {
  await call('GET', '/api/finance/accounts'); // ensures the chart exists
  const cc = await ccAccountId();
  const bank0 = await bal('1000'), cc0 = await bal('2100');
  const e = await call('POST', '/api/finance/expenses', { date: '2026-03-12', description: 'CC thing', amount: 110, gstIncluded: true, paidViaId: cc });
  assert.strictEqual(e.status, 200, JSON.stringify(e.json));
  assert.strictEqual((await call('POST', `/api/finance/expenses/${e.json.id}/cc-pay`, { date: '2026-03-13' })).status, 200);
  assert.ok(near(await bal('1000') - bank0, -110), 'bank paid once');
  assert.strictEqual((await call('POST', `/api/finance/expenses/${e.json.id}/cc-unsettle`, {})).status, 200);
  assert.ok(near(await bal('1000') - bank0, 0), 'unsettle gives the bank money back');
  assert.ok(near(await bal('2100') - cc0, -110), 'card owes the full amount again');
  await call('POST', `/api/finance/expenses/${e.json.id}/cc-pay`, { date: '2026-03-14' });
  assert.ok(near(await bal('1000') - bank0, -110), 'settled again = still paid once');
});

test('deleting a card-settled expense also reverses its settlement', async () => {
  const cc = await ccAccountId();
  const bank0 = await bal('1000'), cc0 = await bal('2100');
  const e = await call('POST', '/api/finance/expenses', { date: '2026-03-12', description: 'CC delete me', amount: 55, gstIncluded: false, paidViaId: cc });
  await call('POST', `/api/finance/expenses/${e.json.id}/cc-pay`, {});
  assert.strictEqual((await call('DELETE', `/api/finance/expenses/${e.json.id}`)).status, 200);
  assert.ok(near(await bal('1000') - bank0, 0), 'bank back to start');
  assert.ok(near(await bal('2100') - cc0, 0), 'card back to start');
});

test('a settled expense cannot have its amount changed', async () => {
  const cc = await ccAccountId();
  const e = await call('POST', '/api/finance/expenses', { date: '2026-03-12', description: 'CC locked amt', amount: 40, gstIncluded: false, paidViaId: cc });
  await call('POST', `/api/finance/expenses/${e.json.id}/cc-pay`, {});
  const put = await call('PUT', `/api/finance/expenses/${e.json.id}`, { date: '2026-03-12', description: 'CC locked amt', amount: 99, gstIncluded: false, paidViaId: cc });
  assert.strictEqual(put.status, 400);
});

// ---------------------------------------------------------------- BAS lock, ownership, validation
test('records inside a lodged BAS quarter cannot be added, changed or paid into', async () => {
  await pool.query(`INSERT INTO fin_bas_quarters ("userId", from_date, to_date, status) VALUES ($1,'2024-01-01','2024-03-31','lodged')`, [userId]);
  const exp = await call('POST', '/api/finance/expenses', { date: '2024-02-01', description: 'Late', amount: 10, gstIncluded: false });
  assert.strictEqual(exp.status, 400, 'expense');
  const wage = await call('POST', '/api/finance/wages', { date: '2024-02-01', employee: 'A', gross: 100, tax: 10 });
  assert.strictEqual(wage.status, 400, 'wage');
  const inv = await newInvoice();
  assert.strictEqual((await call('POST', `/api/finance/invoices/${inv.id}/mark-paid`, { paidAt: '2024-03-01' })).status, 400, 'payment');
  // an expense dated outside the quarter is still fine
  assert.strictEqual((await call('POST', '/api/finance/expenses', { date: '2024-04-02', description: 'Ok', amount: 10, gstIncluded: false })).status, 200);
});

test('expense validation: description, amount, and someone else\'s account are refused', async () => {
  const base = { date: '2026-03-12', description: 'v', amount: 10, gstIncluded: false };
  assert.strictEqual((await call('POST', '/api/finance/expenses', { ...base, description: '  ' })).status, 400);
  assert.strictEqual((await call('POST', '/api/finance/expenses', { ...base, amount: -5 })).status, 400);
  assert.strictEqual((await call('POST', '/api/finance/expenses', { ...base, paidViaId: 987654321 })).status, 400);
});

test('manual journal validation: both sides, empty lines, unknown account', async () => {
  const { rows } = await pool.query(`SELECT id FROM fin_accounts WHERE "userId"=$1 ORDER BY code LIMIT 2`, [userId]);
  const [a, b] = rows.map((r) => r.id);
  const post = (lines) => call('POST', '/api/finance/journal', { date: '2026-03-12', description: 'm', lines });
  assert.strictEqual((await post([{ accountId: a, debit: 5, credit: 5 }, { accountId: b, debit: 0, credit: 0 }])).status, 400);
  assert.strictEqual((await post([{ accountId: a, debit: -5, credit: 0 }, { accountId: b, debit: 0, credit: -5 }])).status, 400);
  assert.strictEqual((await post([{ accountId: 987654321, debit: 5, credit: 0 }, { accountId: b, debit: 0, credit: 5 }])).status, 400);
  assert.strictEqual((await post([{ accountId: a, debit: 5, credit: 0 }, { accountId: b, debit: 0, credit: 5 }])).status, 200);
  assert.strictEqual((await call('DELETE', '/api/finance/journal/987654321')).status, 404);
});

// ---------------------------------------------------------------- assets
test('depreciation must be run in financial-year order', async () => {
  const a = await call('POST', '/api/finance/assets', {
    datePurchased: '2024-07-01', dateFirstUsed: '2024-07-01', description: 'Old gear',
    amount: 3000, gstIncluded: false, method: 'prime_cost', effectiveLifeYears: 10,
  });
  assert.strictEqual(a.status, 200, JSON.stringify(a.json));
  const skip = await call('POST', '/api/finance/assets/depreciation/run', { fy: '2026-27' });
  assert.strictEqual(skip.status, 400, 'FY 2025-26 unposted for Old gear');
  const back = await call('POST', '/api/finance/assets/depreciation/run', { fy: '2024-25' });
  assert.strictEqual(back.status, 400, 'laptop already depreciated to 2025-26');
});

test('asset-owned expenses (depreciation, immediate deductions) cannot be edited or deleted as expenses', async () => {
  const { rows: dep } = await pool.query(`SELECT id FROM fin_expenses WHERE "userId"=$1 AND description LIKE 'Depreciation FY%' LIMIT 1`, [userId]);
  assert.ok(dep[0], 'depreciation expense exists from the earlier test');
  assert.strictEqual((await call('DELETE', `/api/finance/expenses/${dep[0].id}`)).status, 400);
  assert.strictEqual((await call('PUT', `/api/finance/expenses/${dep[0].id}`, { date: '2026-06-30', description: 'x', amount: 1 })).status, 400);
  const a = await call('POST', '/api/finance/assets', {
    datePurchased: '2026-03-01', dateFirstUsed: '2026-03-01', description: 'Cheap thing', amount: 100, gstIncluded: false,
  });
  assert.strictEqual(a.status, 200, JSON.stringify(a.json));
  assert.strictEqual((await call('DELETE', `/api/finance/expenses/${a.json.immediateExpenseId}`)).status, 400);
});

// ---------------------------------------------------------------- BAS payment, recurring dates
test('BAS payment still clears the GST accounts when they net to zero', async () => {
  // quarter with $10 GST collected and $10 GST paid
  const inv = await newInvoice({ issueDate: '2023-05-10' });
  await call('POST', `/api/finance/invoices/${inv.id}/mark-paid`, { paidAt: '2023-05-11' });
  await call('POST', '/api/finance/expenses', { date: '2023-05-12', description: 'GST offset', amount: 110, gstIncluded: true });
  const bas = await call('GET', '/api/finance/bas?from=2023-04-01&to=2023-06-30');
  assert.ok(near(bas.json.netGst, 0), `net GST ${bas.json.netGst}`);
  await call('POST', `/api/finance/bas/${bas.json.quarterId}/reconcile`);
  await call('POST', `/api/finance/bas/${bas.json.quarterId}/lodge`);
  const gstCol0 = await bal('2200', 'bas'), gstPaid0 = await bal('1200', 'bas');
  const paid = await call('POST', `/api/finance/bas/${bas.json.quarterId}/paid`);
  assert.strictEqual(paid.status, 200, JSON.stringify(paid.json));
  assert.ok(near(await bal('2200', 'bas') - gstCol0, 10), 'GST collected cleared');
  assert.ok(near(await bal('1200', 'bas') - gstPaid0, -10), 'GST paid cleared');
});

test('recurring dates: month-end clamps and recovers, weekly/annual step correctly', () => {
  const { nextOccurrence } = require('../cron/recurringCron');
  assert.strictEqual(nextOccurrence('2026-01-31', 'monthly', 31), '2026-02-28');
  assert.strictEqual(nextOccurrence('2026-02-28', 'monthly', 31), '2026-03-31');
  assert.strictEqual(nextOccurrence('2024-01-31', 'monthly', 31), '2024-02-29');
  assert.strictEqual(nextOccurrence('2026-11-30', 'monthly', 30), '2026-12-30');
  assert.strictEqual(nextOccurrence('2026-12-15', 'monthly', 15), '2027-01-15');
  assert.strictEqual(nextOccurrence('2026-01-01', 'weekly'), '2026-01-08');
  assert.strictEqual(nextOccurrence('2026-01-01', 'fortnightly'), '2026-01-15');
  assert.strictEqual(nextOccurrence('2026-01-31', 'quarterly', 31), '2026-04-30');
  assert.strictEqual(nextOccurrence('2024-02-29', 'annually', 29), '2025-02-28');
});

// ---------------------------------------------------------------- supplier bills (Accounts Payable)
test('bills: an Accounts Payable expense ages by due date, and payment dates make the report date-accurate', async () => {
  await call('GET', '/api/finance/accounts');
  const { rows } = await pool.query(`SELECT id FROM fin_accounts WHERE "userId"=$1 AND code='2000'`, [userId]);
  const ap = rows[0].id;
  const e = await call('POST', '/api/finance/expenses', {
    date: '2026-01-10', dueDate: '2026-02-09', description: 'Bill from Acme', supplier: 'Acme', amount: 220, gstIncluded: true, paidViaId: ap,
  });
  assert.strictEqual(e.status, 200, JSON.stringify(e.json));
  const aged = async (asOf) => (await call('GET', `/api/finance/reports/aged-payables?asOf=${asOf}`)).json;
  let r = await aged('2026-03-15');
  let item = r.sections[1].rows.find((x) => x.description === 'Bill from Acme');
  assert.ok(item, 'unpaid bill listed');
  assert.strictEqual(item.due, '2026-02-09');
  assert.strictEqual(item.days, 34, 'days past DUE date, not purchase date');
  assert.strictEqual(item.amount, 220);
  assert.strictEqual((await aged('2026-01-05')).sections[1].rows.find((x) => x.description === 'Bill from Acme'), undefined, 'not there before it was entered');
  const bank0 = await bal('1000');
  assert.strictEqual((await call('POST', `/api/finance/expenses/${e.json.id}/cc-pay`, { date: '2026-03-01' })).status, 200);
  assert.ok(near(await bal('1000') - bank0, -220), 'bank paid the full bill');
  assert.ok((await aged('2026-02-20')).sections[1].rows.find((x) => x.description === 'Bill from Acme'), 'still owed before the payment date');
  assert.strictEqual((await aged('2026-03-15')).sections[1].rows.find((x) => x.description === 'Bill from Acme'), undefined, 'gone after payment date');
  await call('POST', `/api/finance/expenses/${e.json.id}/cc-unsettle`, {});
  assert.ok((await aged('2026-03-15')).sections[1].rows.find((x) => x.description === 'Bill from Acme'), 'unsettle brings it back');
});

// ---------------------------------------------------------------- BAS: GST codes, T7, W2, accrual basis
const setBasis = (b) => pool.query(
  `INSERT INTO settings ("userId", key, value) VALUES ($1,'fin_gst_basis',$2) ON CONFLICT ("userId", key) DO UPDATE SET value=EXCLUDED.value`, [userId, b]);
const worksheet = async (from, to) => {
  const r = await call('GET', `/api/finance/reports/bas-worksheet?from=${from}&to=${to}`);
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  return Object.fromEntries(r.json.sections[0].rows.map((x) => [x.label, x.amount]));
};

test('BAS worksheet: G2/G3/G4 from invoice GST codes, G13/G14 from purchases', async () => {
  const inv = await call('POST', '/api/finance/invoices', {
    issueDate: '2025-05-05',
    items: [
      { description: 'Taxable', qty: 1, unitPrice: 100 },                      // 100 + 10
      { description: 'Export', qty: 1, unitPrice: 200, gstCode: 'EXP' },
      { description: 'Fresh food', qty: 1, unitPrice: 300, gstCode: 'FRE' },
      { description: 'Rent income', qty: 1, unitPrice: 400, gstCode: 'INP' },
    ],
  });
  assert.strictEqual(inv.status, 200, JSON.stringify(inv.json));
  assert.ok(near(parseFloat(inv.json.gst), 10), 'only the taxable line carries GST');
  await call('POST', `/api/finance/invoices/${inv.json.id}/mark-paid`, { paidAt: '2025-05-06' });
  await call('POST', '/api/finance/expenses', { date: '2025-05-07', description: 'Normal buy', amount: 110, gstIncluded: true });
  await call('POST', '/api/finance/expenses', { date: '2025-05-08', description: 'No GST buy', amount: 50, gstIncluded: false });
  const it = await call('POST', '/api/finance/expenses', { date: '2025-05-09', description: 'For rent', amount: 90, gstIncluded: true, inputTaxed: true });
  assert.ok(near(parseFloat(it.json.gst), 0) && near(parseFloat(it.json.amount), 90), 'input-taxed purchase claims no GST');
  const w = await worksheet('2025-04-01', '2025-06-30');
  assert.ok(near(w.G1, 1010), `G1 ${w.G1}`);
  assert.ok(near(w.G2, 200) && near(w.G3, 300) && near(w.G4, 400), `G2-4 ${w.G2} ${w.G3} ${w.G4}`);
  assert.ok(near(w['1A'], 10));
  assert.ok(near(w.G11, 250), `G11 ${w.G11}`);          // 110 + 50 + 90
  assert.ok(near(w.G13, 90), `G13 ${w.G13}`);
  assert.ok(near(w.G14, 50), `G14 ${w.G14}`);
  assert.ok(near(w['1B'], 10), `1B ${w['1B']}`);        // only the normal purchase earns a credit
});

test('BAS payment clears PAYG withholding (W2) and books the T7 instalment as drawings', async () => {
  await call('POST', '/api/finance/wages', { date: '2021-05-10', employee: 'Sam', gross: 1000, tax: 200 });
  const bas = await call('GET', '/api/finance/bas?from=2021-04-01&to=2021-06-30');
  assert.ok(near(bas.json.withholdingTax, 200));
  const t7 = await call('POST', `/api/finance/bas/${bas.json.quarterId}/payg-instalment`, { amount: 50 });
  assert.strictEqual(t7.status, 200, JSON.stringify(t7.json));
  assert.strictEqual((await call('POST', `/api/finance/bas/${bas.json.quarterId}/payg-instalment`, { amount: -1 })).status, 400);
  const w = await worksheet('2021-04-01', '2021-06-30');
  assert.ok(near(w.T7, 50) && near(w.W2, 200) && near(w['1A − 1B + W2 + T7'], 250), JSON.stringify(w));
  await call('POST', `/api/finance/bas/${bas.json.quarterId}/reconcile`);
  await call('POST', `/api/finance/bas/${bas.json.quarterId}/lodge`);
  assert.strictEqual((await call('POST', `/api/finance/bas/${bas.json.quarterId}/payg-instalment`, { amount: 60 })).status, 400, 'locked after lodging');
  const bank0 = await bal('1000');
  const paid = await call('POST', `/api/finance/bas/${bas.json.quarterId}/paid`);
  assert.strictEqual(paid.status, 200, JSON.stringify(paid.json));
  assert.ok(near(await bal('2400', 'bas'), 200), 'PAYG withholding payable cleared');
  assert.ok(near(await bal('3100', 'bas'), 50), 'instalment is owner drawings');
  assert.ok(near(await bal('1000') - bank0, -250), 'bank pays W2 + T7');
});

test('GST basis: accrual counts invoiced sales and dated bills; cash waits for payment; switching is guarded', async () => {
  // earlier tests have lodged quarters, so the route must refuse the switch
  const refuse = await call('PUT', '/api/finance/settings', { fin_gst_basis: 'accrual' });
  assert.strictEqual(refuse.status, 400);
  assert.strictEqual((await call('PUT', '/api/finance/settings', { fin_gst_basis: 'bogus' })).status, 400);

  const inv = await newInvoice({ issueDate: '2022-05-10' });           // 10 GST, sent but never paid
  await call('PATCH', `/api/finance/invoices/${inv.id}/status`, { status: 'sent' });
  const { rows } = await pool.query(`SELECT id FROM fin_accounts WHERE "userId"=$1 AND code='2000'`, [userId]);
  const bill = await call('POST', '/api/finance/expenses', {
    date: '2022-05-12', dueDate: '2022-06-12', description: 'Cash vs accrual bill', amount: 110, gstIncluded: true, paidViaId: rows[0].id,
  });
  const q = (basis) => call('GET', '/api/finance/bas?from=2022-04-01&to=2022-06-30').then((r) => r.json);
  try {
    await setBasis('cash');
    let b = await q();
    assert.ok(near(b.gstCollected, 0) && near(b.gstPaid, 0), `cash: nothing paid yet (${b.gstCollected}/${b.gstPaid})`);
    await setBasis('accrual');
    b = await q();
    assert.strictEqual(b.basis, 'accrual');
    assert.ok(near(b.gstCollected, 10), `accrual sales ${b.gstCollected}`);
    assert.ok(near(b.gstPaid, 10), `accrual bill ${b.gstPaid}`);
    // paying the bill in a later quarter moves its cash-basis claim there
    await call('POST', `/api/finance/expenses/${bill.json.id}/cc-pay`, { date: '2022-08-01' });
    await setBasis('cash');
    b = await q();
    assert.ok(near(b.gstPaid, 0), 'cash: not claimed in the bill quarter');
    const later = (await call('GET', '/api/finance/bas?from=2022-07-01&to=2022-09-30')).json;
    assert.ok(near(later.gstPaid, 10), `cash: claimed in the quarter it was paid (${later.gstPaid})`);
  } finally {
    await setBasis('cash');
  }
});

// ---------------------------------------------------------------- disposal
test('disposal: depreciates to the disposal date, books GST on the sale, and reports it on the BAS', async () => {
  const a = await call('POST', '/api/finance/assets', {
    datePurchased: '2025-07-01', dateFirstUsed: '2025-07-01', description: 'Sold press',
    amount: 1200, gstIncluded: false, method: 'prime_cost', effectiveLifeYears: 4,
  });
  assert.strictEqual(a.status, 200, JSON.stringify(a.json));
  const days = (Date.UTC(2025, 11, 15) - Date.UTC(2025, 6, 1)) / 86400000 + 1; // 1 Jul..15 Dec inclusive
  const dep = Math.round(1200 * 0.25 * (days / 365) * 100) / 100;
  const d = await call('POST', `/api/finance/assets/${a.json.id}/dispose`, { disposedDate: '2025-12-15', disposalAmount: 770, gstIncluded: true });
  assert.strictEqual(d.status, 200, JSON.stringify(d.json));
  assert.ok(near(d.json.finalYearDeduction, dep), `final-year deduction ${d.json.finalYearDeduction} vs ${dep}`);
  assert.ok(near(d.json.gstOnSale, 70));
  const wdv = 1200 - dep;
  assert.ok(near(d.json.writtenDownValue, wdv));
  assert.ok(near(d.json.adjustment, 700 - wdv), `adjustment ${d.json.adjustment}`);
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(l.debit - l.credit) FILTER (WHERE a.code='1400'),0)::float AS fixed,
            COALESCE(SUM(l.debit - l.credit) FILTER (WHERE a.code='1300'),0)::float AS accdep,
            COALESCE(SUM(l.credit - l.debit) FILTER (WHERE a.code='2200'),0)::float AS gst
     FROM fin_journal_lines l JOIN fin_journal_entries e ON e.id=l."entryId" JOIN fin_accounts a ON a.id=l."accountId"
     WHERE e."userId"=$1 AND e."sourceId"=$2 AND e.type IN ('asset_purchase','asset_disposal')`, [userId, a.json.id]);
  assert.ok(near(rows[0].fixed, 0), 'asset fully removed from Fixed Assets');
  assert.ok(near(rows[0].gst, 70), 'GST collected on the sale');
  const bas = (await call('GET', '/api/finance/bas?from=2025-10-01&to=2025-12-31')).json;
  assert.ok(near(bas.gstCollected, 70), `BAS 1A includes the sale GST: ${bas.gstCollected}`);
  assert.ok(near(bas.income, 700), `BAS sales include the ex-GST proceeds: ${bas.income}`);
  const w = await worksheet('2025-10-01', '2025-12-31');
  assert.ok(near(w['1A'], 70) && near(w.G1, 770), `worksheet 1A/G1 ${w['1A']}/${w.G1}`);
  assert.strictEqual((await call('POST', `/api/finance/assets/${a.json.id}/dispose`, { disposedDate: '2025-12-20', disposalAmount: 1 })).status, 400, 'cannot dispose twice');
  // the later full-year run must not double-count that year
  const run = await call('POST', '/api/finance/assets/depreciation/run', { fy: '2025-26' });
  assert.ok(!(run.json.posted || []).some((x) => x.id === a.json.id), 'disposed asset not depreciated again for the same FY');
});

test('disposal: refuses a date before purchase and ignores GST when the price excludes it', async () => {
  const a = await call('POST', '/api/finance/assets', { datePurchased: '2026-02-01', dateFirstUsed: '2026-02-01', description: 'Scrap gear', amount: 100, gstIncluded: false });
  assert.strictEqual((await call('POST', `/api/finance/assets/${a.json.id}/dispose`, { disposedDate: '2026-01-01', disposalAmount: 0 })).status, 400);
  const ok = await call('POST', `/api/finance/assets/${a.json.id}/dispose`, { disposedDate: '2026-02-10', disposalAmount: 50, gstIncluded: false });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
  assert.ok(near(ok.json.gstOnSale, 0) && near(ok.json.adjustment, 50), JSON.stringify(ok.json));
});

// ---------------------------------------------------------------- recording a BAS that was lodged/paid earlier
test('BAS lodge/pay take the real dates: payment journal and timestamps use them, bad dates are refused', async () => {
  const inv = await newInvoice({ issueDate: '2019-02-10' });
  await call('POST', `/api/finance/invoices/${inv.id}/mark-paid`, { paidAt: '2019-02-11' });
  const bas = (await call('GET', '/api/finance/bas?from=2019-01-01&to=2019-03-31')).json;
  assert.ok(near(bas.gstCollected, 10));
  await call('POST', `/api/finance/bas/${bas.quarterId}/reconcile`);
  assert.strictEqual((await call('POST', `/api/finance/bas/${bas.quarterId}/lodge`, { date: '2099-01-01' })).status, 400, 'future');
  assert.strictEqual((await call('POST', `/api/finance/bas/${bas.quarterId}/lodge`, { date: '2019-03-01' })).status, 400, 'before the quarter ended');
  assert.strictEqual((await call('POST', `/api/finance/bas/${bas.quarterId}/lodge`, { date: 'tomorrow' })).status, 400, 'malformed');
  const lodged = await call('POST', `/api/finance/bas/${bas.quarterId}/lodge`, { date: '2019-04-20' });
  assert.strictEqual(lodged.status, 200, JSON.stringify(lodged.json));
  assert.ok(String(lodged.json.lodged_at).startsWith('2019-04-20'), String(lodged.json.lodged_at));
  const paid = await call('POST', `/api/finance/bas/${bas.quarterId}/paid`, { date: '2019-04-26' });
  assert.strictEqual(paid.status, 200, JSON.stringify(paid.json));
  const { rows } = await pool.query(`SELECT date::text AS date FROM fin_journal_entries WHERE "userId"=$1 AND type='bas' AND "sourceId"=$2`, [userId, bas.quarterId]);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].date, '2019-04-26', 'bank payment is dated when it was actually paid');
});

// ---------------------------------------------------------------- GST deregistration
test('GST deregistration: no GST on documents or credits on purchases from the effective date; history untouched', async () => {
  const settings = () => call('GET', '/api/finance/settings').then((r) => r.json);
  const put = (body) => call('PUT', '/api/finance/settings', body);
  const gstOf = async (issueDate, extra = {}) => {
    const r = await call('POST', '/api/finance/invoices', { issueDate, items: [{ description: 'Work', qty: 1, unitPrice: 100, gstCode: 'GST' }], ...extra });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    return { gst: parseFloat(r.json.gst), total: parseFloat(r.json.total), id: r.json.id };
  };
  const itemCode = async (id) => (await call('GET', `/api/finance/invoices/${id}`)).json.items[0].gstCode;
  try {
    const today = await router.todayStr();
    // un-ticking records the day it happened when the real date isn't known yet
    assert.strictEqual((await put({ fin_gst_registered: 'false' })).status, 200);
    let st = await settings();
    assert.strictEqual(st.fin_gst_unreg_since, today);
    const nowInv = await gstOf(today);
    assert.strictEqual(nowInv.gst, 0, 'no GST from the day it was un-ticked');
    assert.strictEqual(nowInv.total, 100);
    assert.strictEqual(await itemCode(nowInv.id), 'NT');
    assert.strictEqual((await gstOf('2020-01-01')).gst, 10, 'older invoices keep their GST');

    // the real cancellation date overrides it
    assert.strictEqual((await put({ fin_gst_ended_on: 'not a date' })).status, 400);
    assert.strictEqual((await put({ fin_gst_ended_on: '2026-06-01' })).status, 200);
    assert.strictEqual((await gstOf('2026-05-31')).gst, 10, 'still registered the day before');
    assert.strictEqual((await gstOf('2026-06-01')).gst, 0, 'not registered from the effective date');

    // purchases: no input credit once unregistered
    const bank0 = await bal('1200');
    const after = await call('POST', '/api/finance/expenses', { date: '2026-07-01', description: 'Post-cancellation buy', amount: 110, gstIncluded: true });
    assert.ok(near(parseFloat(after.json.gst), 0) && near(parseFloat(after.json.amount), 110), JSON.stringify(after.json));
    assert.ok(near(await bal('1200') - bank0, 0), 'no GST Paid posted');
    const before = await call('POST', '/api/finance/expenses', { date: '2026-05-01', description: 'Pre-cancellation buy', amount: 110, gstIncluded: true });
    assert.ok(near(parseFloat(before.json.gst), 10));

    // a quote written while registered converts to a GST-free invoice
    const q = await call('POST', '/api/finance/invoices', { docType: 'quote', issueDate: '2020-02-01', items: [{ description: 'Job', qty: 1, unitPrice: 200, gstCode: 'GST' }] });
    assert.ok(near(parseFloat(q.json.gst), 20));
    const conv = await call('POST', `/api/finance/invoices/${q.json.id}/convert`, {});
    assert.strictEqual(conv.status, 200, JSON.stringify(conv.json));
    assert.ok(near(parseFloat(conv.json.invoice.gst), 0) && near(parseFloat(conv.json.invoice.total), 200), JSON.stringify(conv.json.invoice));

    // BAS: quarters from the effective date on don't need one
    const post = (await call('GET', '/api/finance/bas?from=2026-07-01&to=2026-09-30')).json;
    assert.strictEqual(post.gstRegistered, false);
    assert.strictEqual(post.quarterNeedsBas, false);
    assert.strictEqual((await call('GET', '/api/finance/bas?from=2026-01-01&to=2026-03-31')).json.quarterNeedsBas, true);

    // recurring invoices stop adding GST too
    const { rows: others } = await pool.query(`SELECT COUNT(*)::int AS n FROM fin_recurring WHERE active AND "nextDate" <= CURRENT_DATE + 1 AND "userId" <> $1`, [userId]);
    if (others[0].n === 0) {
      await call('POST', '/api/finance/recurring', { type: 'invoice', label: 'Monthly', frequency: 'monthly', nextDate: '2020-01-01', template: { items: [{ description: 'Retainer', qty: 1, unitPrice: 100, gstCode: 'GST' }] } });
      await require('../cron/recurringCron').runRecurring();
      const { rows } = await pool.query(`SELECT i.gst::float AS gst, i.total::float AS total FROM fin_invoices i JOIN fin_invoice_items ii ON ii."invoiceId"=i.id WHERE i."userId"=$1 AND ii.description='Retainer'`, [userId]);
      assert.ok(rows.length === 1 && near(rows[0].gst, 0) && near(rows[0].total, 100), JSON.stringify(rows));
    }

    // registering again restores GST and clears the dates
    assert.strictEqual((await put({ fin_gst_registered: 'true' })).status, 200);
    st = await settings();
    assert.ok(!st.fin_gst_unreg_since && !st.fin_gst_ended_on);
    assert.strictEqual((await gstOf(today)).gst, 10);
  } finally {
    await call('PUT', '/api/finance/settings', { fin_gst_registered: 'true' });
  }
});

// ---------------------------------------------------------------- document library
test('documents: upload, link to many expenses, download, relink, and confirmed delete removes the file', async () => {
  const e1 = await call('POST', '/api/finance/expenses', { date: '2025-09-05', description: 'AI credits Sep', supplier: 'Provider', amount: 40, gstIncluded: false });
  const e2 = await call('POST', '/api/finance/expenses', { date: '2025-09-20', description: 'AI credits Sep 2', supplier: 'Provider', amount: 60, gstIncluded: false });
  const up = await upload([['sep-statement.pdf', '%PDF-1.4 statement bytes']], { kind: 'statement', supplier: 'Provider', docDate: '2025-09-30', expenseIds: [String(e1.json.id), String(e2.json.id)] });
  assert.strictEqual(up.status, 201, JSON.stringify(up.json));
  const doc = up.json.documents[0];
  assert.strictEqual(doc.fy, '2025-26', 'financial year worked out from the document date');
  assert.strictEqual(doc.links.length, 2);
  assert.ok(!('storedName' in doc), 'internal file name is never sent to the browser');

  const dl = await fetch(`${base}/api/finance/documents/${doc.id}/file`);
  assert.strictEqual(dl.status, 200);
  assert.strictEqual(await dl.text(), '%PDF-1.4 statement bytes');
  assert.strictEqual(dl.headers.get('x-content-type-options'), 'nosniff');

  const list = (await call('GET', '/api/finance/documents?fy=2025-26&expenseId=' + e1.json.id)).json;
  assert.strictEqual(list.documents.length, 1);
  const exps = (await call('GET', '/api/finance/expenses')).json;
  assert.strictEqual(exps.find((x) => x.id === e1.json.id).docCount, 1, 'expense list shows the linked document count');

  const re = await call('PUT', `/api/finance/documents/${doc.id}/links`, { expenseIds: [e2.json.id] });
  assert.strictEqual(re.json.links.length, 1);
  assert.strictEqual((await call('PUT', `/api/finance/documents/${doc.id}/links`, { expenseIds: [987654321] })).status, 400, 'unknown expense refused');

  const meta = await call('PATCH', `/api/finance/documents/${doc.id}`, { title: 'September statement', kind: 'bank_statement', notes: 'checked' });
  assert.strictEqual(meta.json.title, 'September statement');
  assert.strictEqual((await call('PATCH', `/api/finance/documents/${doc.id}`, { kind: 'nonsense' })).status, 400);

  const del1 = await call('DELETE', `/api/finance/documents/${doc.id}`);
  assert.strictEqual(del1.status, 409, 'delete needs explicit confirmation');
  assert.ok(del1.json.needsConfirm && /five years/.test(del1.json.message));
  const folder = pathx.join(process.env.UPLOAD_DIR, 'finance-docs', String(userId));
  assert.ok(fsx.readdirSync(folder).length >= 1);
  assert.strictEqual((await call('DELETE', `/api/finance/documents/${doc.id}?confirm=1`)).status, 200);
  assert.strictEqual(fsx.readdirSync(folder).length, 0, 'file removed from disk');
  assert.strictEqual((await fetch(`${base}/api/finance/documents/${doc.id}/file`)).status, 404);
  assert.strictEqual((await call('GET', '/api/finance/expenses')).json.find((x) => x.id === e2.json.id).docCount, 0, 'links removed with the document');
});

test('documents: rejects disguised executables, disallowed types, bad fields; accepts several files at once', async () => {
  const exe = await upload([['invoice.pdf', 'MZ' + String.fromCharCode(0x90) + ' pretend this is a pdf']]);
  assert.strictEqual(exe.status, 400);
  assert.strictEqual(exe.json.rejected.length, 1);
  const folder = pathx.join(process.env.UPLOAD_DIR, 'finance-docs', String(userId));
  assert.strictEqual(fsx.existsSync(folder) ? fsx.readdirSync(folder).length : 0, 0, 'rejected file not left on disk');
  assert.strictEqual((await upload([['payload.exe', 'x']])).status, 400, 'extension not allowed');
  assert.strictEqual((await upload([['ok.pdf', '%PDF']], { kind: 'bogus' })).status, 400);
  assert.strictEqual((await upload([['ok.pdf', '%PDF']], { docDate: 'yesterday' })).status, 400);
  assert.strictEqual((await upload([['ok.pdf', '%PDF']], { expenseId: '987654321' })).status, 400, 'link to unknown expense');
  const two = await upload([['a.pdf', '%PDF a'], ['b.csv', 'x,y\n1,2', 'text/csv']], { kind: 'invoice', fy: '2024-25' });
  assert.strictEqual(two.status, 201, JSON.stringify(two.json));
  assert.strictEqual(two.json.documents.length, 2);
  assert.ok(two.json.documents.every((d) => d.fy === '2024-25' && d.links.length === 0));
  const un = (await call('GET', '/api/finance/documents?unlinked=1&fy=2024-25')).json;
  assert.strictEqual(un.documents.length, 2);
  const q = (await call('GET', '/api/finance/documents?q=b.csv')).json;
  assert.strictEqual(q.documents.length, 1);
  for (const d of two.json.documents) await call('DELETE', `/api/finance/documents/${d.id}?confirm=1`);
});

test('documents: missing-evidence list excludes linked, below-threshold and depreciation items', async () => {
  const mk = (extra) => call('POST', '/api/finance/expenses', { date: '2025-10-10', amount: 100, gstIncluded: false, ...extra });
  await mk({ description: 'Needs evidence' });
  const linked = await mk({ description: 'Has statement' });
  await mk({ description: 'Tiny buy', amount: 5 });
  const up = await upload([['evidence.pdf', '%PDF e']], { expenseId: String(linked.json.id) });
  assert.strictEqual(up.status, 201);
  const m = (await call('GET', '/api/finance/documents/missing?fy=2025-26&min=10')).json;
  const names = m.expenses.map((x) => x.description);
  assert.ok(names.includes('Needs evidence'), 'unevidenced expense listed');
  assert.ok(!names.includes('Has statement'), 'linked expense not listed');
  assert.ok(!names.includes('Tiny buy'), 'below the threshold not listed');
  assert.ok(!names.some((n) => /^Depreciation FY/.test(n)), 'posted depreciation never needs a receipt');
  assert.strictEqual((await call('GET', '/api/finance/documents/missing?fy=junk')).status, 400);
  await call('DELETE', `/api/finance/documents/${up.json.documents[0].id}?confirm=1`);
});

// ---------------------------------------------------------------- accountant reports (Stage B)
const report = async (path, q) => {
  const r = await call('GET', `/api/finance/reports/${path}?${q}`);
  assert.strictEqual(r.status, 200, `${path}: ${JSON.stringify(r.json)}`);
  return r.json;
};
const secRows = (rep, title) => rep.sections.find((x) => x.title.startsWith(title)).rows;

test('income-received: cash vs invoiced reconciles with opening and closing debtors', async () => {
  const mk = async (issueDate) => (await call('POST', '/api/finance/invoices', { issueDate, items: [{ description: 'Work', qty: 1, unitPrice: 100 }] })).json;
  const z = await mk('2018-05-01'); const x = await mk('2018-08-10'); const y = await mk('2018-12-01');
  for (const inv of [z, x, y]) await call('PATCH', `/api/finance/invoices/${inv.id}/status`, { status: 'sent' });
  await call('POST', `/api/finance/invoices/${z.id}/mark-paid`, { paidAt: '2018-08-20' });   // opening debtor, paid in period
  await call('POST', `/api/finance/invoices/${x.id}/mark-paid`, { paidAt: '2018-09-05' });   // issued and paid in period
  const rep = await report('income-received', 'from=2018-07-01&to=2018-12-31');
  const rec = Object.fromEntries(rep.summary.map((s2) => [s2.label, s2.value]));
  assert.ok(near(rec['Income received (ex-GST)'], 200), JSON.stringify(rec));
  assert.ok(near(rec['Invoiced in period (ex-GST)'], 200));
  assert.ok(near(rec['Unpaid at end of period (ex-GST)'], 100));
  const recon = secRows(rep, 'Reconciliation');
  assert.ok(near(recon[3].amount, 200) && near(recon[4].amount, 200) && near(recon[5].amount, 0), JSON.stringify(recon));
  assert.deepStrictEqual(secRows(rep, 'Unpaid at the end').map((r2) => r2.number), [y.number]);
  assert.deepStrictEqual(secRows(rep, 'Unpaid at the start').map((r2) => r2.number), [z.number]);
  assert.strictEqual(secRows(rep, 'Payments received').length, 2);
});

test('tax-payments: lists BAS payments with PAYG split and flags tax booked as an expense', async () => {
  await call('POST', '/api/finance/expenses', { date: '2019-04-27', description: 'For BAS', supplier: 'ATO', amount: 2359.22, gstIncluded: false });
  const rep = await report('tax-payments', 'from=2019-04-01&to=2019-04-30');
  const bas = secRows(rep, 'BAS payments');
  assert.strictEqual(bas.length, 1);
  assert.ok(near(bas[0].paid, 10) && near(bas[0].gst, 10), JSON.stringify(bas[0]));
  const flagged = secRows(rep, 'Payments that look like tax');
  assert.ok(flagged.some((f) => near(f.total, 2359.22) && f.supplier === 'ATO'));
  assert.ok(secRows(rep, 'BAS quarters').length >= 1);
});

test('cash-book: opening + movements = closing and agrees with the ledger; unknown account refused', async () => {
  const rep = await report('cash-book', 'from=2019-04-01&to=2019-04-30&account=1000');
  const sec = rep.sections[0];
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(l.debit - l.credit),0)::float AS bal FROM fin_journal_lines l JOIN fin_journal_entries e ON e.id=l."entryId"
     JOIN fin_accounts a ON a.id=l."accountId" WHERE e."userId"=$1 AND a.code='1000' AND e.date <= '2019-04-30'`, [userId]);
  assert.ok(near(sec.totals.balance, rows[0].bal), `closing ${sec.totals.balance} vs ledger ${rows[0].bal}`);
  assert.strictEqual(sec.rows[0].description, 'Opening balance');
  const last = sec.rows[sec.rows.length - 1];
  assert.ok(near(last.balance, sec.totals.balance), 'running balance ends at the closing balance');
  assert.strictEqual((await call('GET', '/api/finance/reports/cash-book?from=2019-04-01&to=2019-04-30&account=9999')).status, 400);
  const all = await report('cash-book', 'from=2019-04-01&to=2019-04-30');
  assert.ok(all.sections.length >= 1);
});

test('capital-related: warns when no opening balance exists, then shows capital introduced', async () => {
  const early = await report('capital-related', 'from=2017-07-01&to=2018-06-30');
  assert.ok(/No opening balance/.test(early.notes[0]), early.notes[0]);
  const { rows } = await pool.query(`SELECT id, code FROM fin_accounts WHERE "userId"=$1 AND code IN ('1000','3000')`, [userId]);
  const id = Object.fromEntries(rows.map((r2) => [r2.code, r2.id]));
  const j = await call('POST', '/api/finance/journal', { date: '2025-07-02', description: 'Capital introduced', lines: [{ accountId: id['1000'], debit: 5000, credit: 0 }, { accountId: id['3000'], debit: 0, credit: 5000 }] });
  assert.strictEqual(j.status, 200, JSON.stringify(j.json));
  await call('POST', '/api/finance/drawings', { date: '2025-08-01', description: 'Living costs', amount: 750 });
  const rep = await report('capital-related', 'from=2025-07-01&to=2026-06-30');
  const sum = Object.fromEntries(rep.summary.map((s2) => [s2.label, s2.value]));
  assert.ok(near(sum['Capital introduced (net)'], 5000) && near(sum.Drawings, 750), JSON.stringify(sum));
  assert.ok(!/No opening balance/.test(rep.notes[0]));
});

test('expense-listing: shows evidence status per expense', async () => {
  const withDoc = await call('POST', '/api/finance/expenses', { date: '2025-12-05', description: 'Listed with doc', supplier: 'S', amount: 80, gstIncluded: false });
  await call('POST', '/api/finance/expenses', { date: '2025-12-06', description: 'Listed bare', supplier: 'S', amount: 90, gstIncluded: false });
  const up = await upload([['stmt.pdf', '%PDF s']], { expenseId: String(withDoc.json.id), docDate: '2025-12-31' });
  const rep = await report('expense-listing', 'from=2025-12-01&to=2025-12-31');
  const rows = secRows(rep, 'Expenses');
  assert.strictEqual(rows.find((r2) => r2.description === 'Listed with doc').evidence, '1 document');
  assert.strictEqual(rows.find((r2) => r2.description === 'Listed bare').evidence, 'None');
  assert.ok(rep.summary.find((s2) => s2.label === 'With no evidence attached').value >= 1);
  await call('DELETE', `/api/finance/documents/${up.json.documents[0].id}?confirm=1`);
});

test('review-items: flags tax booked as expenses, wages without PAYG, and a missing opening position', async () => {
  await call('POST', '/api/finance/expenses', { date: '2025-11-01', description: 'For BAS', supplier: 'ATO', amount: 100, gstIncluded: false });
  await call('POST', '/api/finance/wages', { date: '2025-11-02', employee: 'Me', gross: 500, tax: 0 });
  const rep = await report('review-items', 'fy=2025-26');
  const items = rep.sections[0].rows.map((r2) => r2.item);
  assert.ok(items.some((t) => /Payments to the ATO recorded as expenses/.test(t)), items.join(' | '));
  assert.ok(items.some((t) => /Wage entries with no PAYG withheld/.test(t)));
  const old = await report('review-items', 'fy=2017-18');
  assert.ok(old.sections[0].rows.some((r2) => /No opening balance/.test(r2.item)), 'opening position flagged for a year before any capital');
  assert.strictEqual((await call('GET', '/api/finance/reports/review-items?fy=junk')).status, 400);
});

test('tax-time-summary: shows income on a received basis and PAYG instalments paid', async () => {
  const fy18 = await report('tax-time-summary', 'fy=2018-19');
  const sum = Object.fromEntries(fy18.summary.map((s2) => [s2.label, s2.value]));
  assert.ok(near(sum['Income received (ex-GST)'], 300), JSON.stringify(sum));
  assert.ok(fy18.sections.some((x) => x.title === 'Income on a received (cash) basis'));
  const today = await router.todayStr();
  const y = parseInt(today.slice(0, 4), 10) + (today.slice(5, 7) >= '07' ? 0 : -1);
  const now = await report('tax-time-summary', `fy=${y}-${String((y + 1) % 100).padStart(2, '0')}`);
  const nowSum = Object.fromEntries(now.summary.map((s2) => [s2.label, s2.value]));
  assert.ok(near(nowSum['PAYG instalments paid (T7)'], 50), `T7 ${nowSum['PAYG instalments paid (T7)']}`);
});

test('chart-of-accounts: lists accounts and codes with the accountant’s mapped labels', async () => {
  await pool.query(
    `INSERT INTO settings ("userId", key, value) VALUES ($1,'fin_export_account_map',$2) ON CONFLICT ("userId", key) DO UPDATE SET value=EXCLUDED.value`,
    [userId, JSON.stringify({ '1000': { code: '1-1100', name: 'Cheque account', myobTax: 'N-T' }, 'EXP-100': { code: '6-4000', name: 'Advertising' } })]);
  const rep = await report('chart-of-accounts', '');
  const bank = secRows(rep, 'Accounts').find((a) => a.code === '1000');
  assert.strictEqual(bank.accCode, '1-1100'); assert.strictEqual(bank.accName, 'Cheque account'); assert.strictEqual(bank.myob, 'N-T');
  const adv = secRows(rep, 'Income & expense').find((c) => c.code === 'EXP-100');
  assert.strictEqual(adv.accName, 'Advertising');
  assert.ok(/2 mapped/.test(rep.subtitle), rep.subtitle);
  assert.strictEqual(secRows(rep, 'Accounts').find((a) => a.code === '4000').accCode, '', 'unmapped stays blank');
});

// ---------------------------------------------------------------- mapping + FY pack (Stage C)
test('mapping: accounts you added and income/expense codes can carry the accountant’s labels', async () => {
  const acct = await call('POST', '/api/finance/accounts', { code: '2999', name: 'Loan from other business', type: 'liability' });
  assert.ok(acct.status === 200 || acct.status === 201, JSON.stringify(acct.json));
  const got = (await call('GET', '/api/finance/export/account-map')).json;
  assert.ok(got.accounts.some((a) => a.code === '2999'), 'own accounts listed');
  assert.ok(got.txCodes.some((c) => c.code === 'EXP-160'), 'income/expense codes listed');
  const put = await call('PUT', '/api/finance/export/account-map', { map: { '2999': { code: '2-9999', name: 'Related loan' }, 'EXP-160': { code: '6-2200', name: 'Software' }, 'BOGUS': { code: 'x' } } });
  assert.strictEqual(put.status, 200);
  assert.deepStrictEqual(Object.keys(put.json.map).sort(), ['2999', 'EXP-160'], 'unknown keys dropped');
  const chart = await report('chart-of-accounts', '');
  assert.strictEqual(secRows(chart, 'Accounts').find((a) => a.code === '2999').accName, 'Related loan');
  assert.strictEqual(secRows(chart, 'Income & expense').find((c) => c.code === 'EXP-160').accCode, '6-2200');
});

test('FY pack: preview, PDF, Excel and zip are produced from the same reports and contain what they should', async () => {
  const XLSX = require('xlsx');
  const JSZip = require('jszip');
  const fyq = 'fy=2025-26';
  // one document to include in the zip
  const up = await upload([['pack-statement.pdf', '%PDF pack doc']], { kind: 'statement', docDate: '2025-12-31', supplier: 'Provider' });
  assert.strictEqual(up.status, 201);

  const pv = await call('GET', `/api/finance/pack/preview?${fyq}`);
  assert.strictEqual(pv.status, 200, JSON.stringify(pv.json));
  const failed = pv.json.reports.filter((r2) => r2.error);
  assert.deepStrictEqual(failed, [], 'every report in the pack produces: ' + JSON.stringify(failed));
  assert.ok(pv.json.reports.length >= 18);
  assert.ok(pv.json.reports.some((r2) => r2.key === 'bs_start') && pv.json.reports.some((r2) => r2.key === 'income_received'));
  assert.ok(pv.json.documents.count >= 1);
  assert.strictEqual((await call('GET', '/api/finance/pack/preview?fy=nonsense')).status, 400);

  const pdf = Buffer.from(await (await fetch(`${base}/api/finance/pack/pdf?${fyq}`)).arrayBuffer());
  assert.strictEqual(pdf.slice(0, 5).toString(), '%PDF-');
  if (process.env.PACK_DUMP_DIR) fsx.writeFileSync(pathx.join(process.env.PACK_DUMP_DIR, 'pack.pdf'), pdf); // eyeball the layout
  assert.ok(pdf.length > 8000, `pdf size ${pdf.length}`);

  const xr = await fetch(`${base}/api/finance/pack/xlsx?${fyq}`);
  assert.ok(/spreadsheetml/.test(xr.headers.get('content-type')));
  assert.ok(/-FY2025-26/.test(xr.headers.get('content-disposition')) && !/Vault/i.test(xr.headers.get('content-disposition')));
  const xbuf = Buffer.from(await xr.arrayBuffer());
  if (process.env.PACK_DUMP_DIR) fsx.writeFileSync(pathx.join(process.env.PACK_DUMP_DIR, 'pack.xlsx'), xbuf);
  const wb = XLSX.read(xbuf, { type: 'buffer' });
  for (const name of ['Cover', 'Contents', 'Profit & Loss', 'Balance Sheet End', 'Tax Time Summary', 'Income Received', 'Cash Book', 'Chart of Accounts', 'Data - Expenses', 'Data - Journal'])
    assert.ok(wb.SheetNames.includes(name), `sheet ${name} in ${wb.SheetNames.join(', ')}`);
  assert.strictEqual(wb.SheetNames[1], 'Contents');

  // numbers are real numbers, and the sheet agrees with the report the app serves
  const plRep = (await call('GET', '/api/finance/reports/profit-loss?from=2025-07-01&to=2026-06-30')).json;
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Profit & Loss'], { header: 1 });
  const net = rows.find((r2) => r2[0] === 'Net profit');
  assert.ok(net && typeof net[1] === 'number' && near(net[1], plRep.netProfit), `net profit ${net && net[1]} vs ${plRep.netProfit}`);
  const exp = XLSX.utils.sheet_to_json(wb.Sheets['Data - Expenses'], { header: 1 });
  assert.ok(exp.length > 3 && typeof exp[3][0] === 'number', 'dates are real Excel dates');

  const zipRes = await fetch(`${base}/api/finance/pack/zip?${fyq}&documents=1`);
  assert.strictEqual(zipRes.headers.get('content-type'), 'application/zip');
  const zip = await JSZip.loadAsync(Buffer.from(await zipRes.arrayBuffer()));
  const names = Object.keys(zip.files);
  assert.ok(names.some((n2) => n2.endsWith('.pdf')) && names.some((n2) => n2.endsWith('.xlsx')), names.join(', '));
  assert.ok(names.includes('documents/README.txt'));
  assert.ok(names.some((n2) => /^documents\/2025-12-31_.*\.pdf$/.test(n2)), 'the uploaded document is in the zip: ' + names.join(', '));
  const noDocs = await JSZip.loadAsync(Buffer.from(await (await fetch(`${base}/api/finance/pack/zip?${fyq}`)).arrayBuffer()));
  assert.ok(!Object.keys(noDocs.files).some((n2) => n2.startsWith('documents/')), 'documents only when asked for');

  await call('DELETE', `/api/finance/documents/${up.json.documents[0].id}?confirm=1`);
});

test('FY pack and reports use the stored company name, never the product name', async () => {
  await call('PUT', '/api/finance/settings', { fin_biz_name: 'Test Trading Co' });
  const texts = [];
  for (const [path, q] of [['chart-of-accounts', ''], ['cash-book', 'from=2025-07-01&to=2026-06-30'], ['documents-index', 'fy=2025-26']]) {
    const rep = await report(path, q);
    texts.push(JSON.stringify(rep));
  }
  const all = texts.join(' ');
  assert.ok(!/vault/i.test(all), 'a report still mentions the product name: ' + (all.match(/.{30}vault.{30}/i) || [''])[0]);
  assert.ok(/Test Trading Co/.test(all), 'company name appears in the report wording');
  const chart = await report('chart-of-accounts', '');
  assert.ok(chart.sections[0].columns.some((c) => c.label === 'Test Trading Co code'));
  const XLSX = require('xlsx');
  const xr = await fetch(`${base}/api/finance/pack/xlsx?fy=2025-26`);
  assert.ok(/^attachment; filename="Test-Trading-Co-FY2025-26\.xlsx"/.test(xr.headers.get('content-disposition')), xr.headers.get('content-disposition'));
  const wb = XLSX.read(Buffer.from(await xr.arrayBuffer()), { type: 'buffer' });
  const cover = XLSX.utils.sheet_to_json(wb.Sheets.Cover, { header: 1 }).flat().join(' ');
  assert.ok(!/vault/i.test(cover) && /Test Trading Co/.test(cover), cover.slice(0, 200));
  await call('PUT', '/api/finance/settings', { fin_biz_name: '' });
});

test('FY pack still works when route-level tracing (Sentry-style) wraps every handler', async () => {
  // Sentry's express tracing calls req.on / res.once on each layer. A plain-object request stub made every
  // report fail on the live server ("res.once is not a function"). Reproduce by putting such a layer first.
  const probe = (req, res, next) => { req.on('x', () => {}); res.once('finish', () => {}); next(); };
  router.use('/reports', probe);
  const layer = router.stack.pop();
  router.stack.unshift(layer);
  try {
    const pv = await call('GET', '/api/finance/pack/preview?fy=2025-26');
    assert.strictEqual(pv.status, 200, JSON.stringify(pv.json));
    const failed = pv.json.reports.filter((r2) => r2.error);
    assert.deepStrictEqual(failed, [], JSON.stringify(failed.slice(0, 2)));
  } finally {
    router.stack.splice(router.stack.indexOf(layer), 1);
  }
});

// ---------------------------------------------------------------- audit trail
test('audit log: triggers record create, field-level change and delete; log is append-only', async () => {
  const e = await call('POST', '/api/finance/expenses', { date: '2026-03-12', description: 'Audit me', amount: 50, gstIncluded: false });
  await call('PUT', `/api/finance/expenses/${e.json.id}`, { date: '2026-03-12', description: 'Audit me', amount: 75, gstIncluded: false });
  await call('DELETE', `/api/finance/expenses/${e.json.id}`);
  const { rows } = await pool.query(
    `SELECT action, "changedFields", "rowData", label FROM fin_audit_log
     WHERE "userId"=$1 AND "tableName"='fin_expenses' AND "rowId"=$2 ORDER BY id`, [userId, e.json.id]);
  assert.deepStrictEqual(rows.map((r) => r.action), ['INSERT', 'UPDATE', 'DELETE']);
  assert.strictEqual(rows[1].label, 'Audit me');
  assert.strictEqual(Number(rows[1].changedFields.amount.from), 50);
  assert.strictEqual(Number(rows[1].changedFields.amount.to), 75);
  assert.ok(!('updatedAt' in rows[1].changedFields), 'updatedAt noise excluded');
  assert.strictEqual(Number(rows[2].rowData.amount), 75, 'deleted row kept in full');
  await assert.rejects(pool.query(`UPDATE fin_audit_log SET label='x' WHERE "userId"=$1`, [userId]), /append-only/);
  // a no-op save logs nothing
  const inv = await newInvoice();
  const before = (await pool.query(`SELECT COUNT(*)::int n FROM fin_audit_log WHERE "userId"=$1`, [userId])).rows[0].n;
  await pool.query(`UPDATE fin_invoices SET notes=notes WHERE id=$1`, [inv.id]);
  const after = (await pool.query(`SELECT COUNT(*)::int n FROM fin_audit_log WHERE "userId"=$1`, [userId])).rows[0].n;
  assert.strictEqual(after, before);
});

test('audit trail report lists record changes and hides bank details', async () => {
  await call('PUT', '/api/finance/settings', { fin_biz_name: 'Audit Co', fin_account_number: '12345678' });
  await call('PUT', '/api/finance/settings', { fin_account_number: '99999999' });
  const r = await call('GET', '/api/finance/reports/audit-trail?from=2020-01-01&to=2099-12-31');
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  const rows = r.json.sections[0].rows;
  assert.ok(rows.some((x) => /Expense “Audit me” changed/.test(x.event) && /amount: 50.* → 75/.test(x.detail)), 'expense change shown');
  assert.ok(rows.some((x) => /Expense “Audit me” deleted/.test(x.event)), 'delete shown');
  const bank = rows.filter((x) => /fin_account_number/.test(x.event));
  assert.ok(bank.length && bank.every((x) => !/12345678|99999999/.test(x.detail)), 'bank number not exposed');
  assert.strictEqual((await call('GET', '/api/finance/reports/audit-trail?from=2020-01-01&to=2099-12-31&table=nope')).status, 400);
  const only = await call('GET', '/api/finance/reports/audit-trail?from=2020-01-01&to=2099-12-31&table=fin_expenses');
  assert.ok(only.json.sections[0].rows.every((x) => x.type === 'expenses'));
});

test('trial balance still balances after all of the above', async () => {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(l.debit),0)::float AS d, COALESCE(SUM(l.credit),0)::float AS c
     FROM fin_journal_lines l JOIN fin_journal_entries e ON e.id=l."entryId" WHERE e."userId"=$1`, [userId]);
  assert.ok(near(rows[0].d, rows[0].c), `debits ${rows[0].d} credits ${rows[0].c}`);
});

async function cleanup(id) {
  await pool.query(`DELETE FROM fin_journal_entries WHERE "userId"=$1`, [id]);
  await pool.query(`DELETE FROM fin_audit_log WHERE "userId"=$1`, [id]);
  await pool.query(`DELETE FROM users WHERE id=$1`, [id]);
}

// ---------------------------------------------------------------- runner
(async () => {
  // db.js runs its own idempotent schema init on load; calling it again here deadlocks.
  await new Promise((r) => setTimeout(r, 4000));
  const email = `finance-test-${Date.now()}@example.test`;
  const u = await pool.query(`INSERT INTO users (email, "passwordHash") VALUES ($1,'x') RETURNING id`, [email]);
  userId = u.rows[0].id;
  const server = http.createServer(app).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  let failed = 0;
  try {
    for (const t of tests) {
      try { await t.fn(); console.log(`  ok   ${t.name}`); }
      catch (e) { failed++; console.log(`  FAIL ${t.name}\n       ${e.message}`); }
    }
  } finally {
    server.close();
    // journal lines reference accounts with ON DELETE RESTRICT, so clear the entries (lines cascade) first
    await cleanup(userId);
    try { fsx.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
    await pool.end();
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
