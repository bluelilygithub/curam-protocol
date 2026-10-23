'use strict';

// Renders the financial-year pack as an Excel workbook: a cover, a linked contents sheet, one sheet per
// report (real numbers and real dates, so they can be sorted, summed and pasted), and raw data sheets
// for the year's invoices, expenses, journal lines, assets, wages and drawings.

const XLSX = require('xlsx');
const { pool } = require('../../db');

const MONEY = '#,##0.00;[Red]-#,##0.00';
const SHORT = {
  review: 'Things to Review', pl: 'Profit & Loss', bs_end: 'Balance Sheet End', bs_start: 'Balance Sheet Start', tb: 'Trial Balance',
  cash_book: 'Cash Book', capital: 'Capital & Related', tax_time: 'Tax Time Summary', income_received: 'Income Received',
  depreciation: 'Depreciation', drawings_wages: 'Drawings & Wages', tax_payments: 'Tax Payments', gst: 'GST Summary',
  bas_q1: 'BAS Q1', bas_q2: 'BAS Q2', bas_q3: 'BAS Q3', bas_q4: 'BAS Q4', aged_rec: 'Aged Receivables', aged_pay: 'Aged Payables',
  sales_client: 'Sales by Client', expenses_cat: 'Expenses by Category', expense_listing: 'Expense Listing',
  documents: 'Documents Index', chart: 'Chart of Accounts', gl: 'General Ledger', audit: 'Audit Trail',
};

const serial = (y, m, d) => Date.UTC(y, m - 1, d) / 86400000 + 25569;
function cell(v, format) {
  if (v === null || v === undefined || v === '') return null;
  switch (format) {
    case 'money': return { t: 'n', v: Number(v) || 0, z: MONEY };
    case 'int': return { t: 'n', v: Math.round(Number(v) || 0), z: '0' };
    case 'num': return { t: 'n', v: Number(v) || 0, z: '0.0' };
    case 'pct': return { t: 'n', v: (Number(v) || 0) / 100, z: '0.0%' };
    case 'date': {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
      return m ? { t: 'n', v: serial(+m[1], +m[2], +m[3]), z: 'dd/mm/yyyy' } : { t: 's', v: String(v) };
    }
    case 'datetime': { const ms = Date.parse(v); return Number.isNaN(ms) ? { t: 's', v: String(v) } : { t: 'n', v: ms / 86400000 + 25569, z: 'dd/mm/yyyy hh:mm' }; }
    default: return { t: 's', v: String(v) };
  }
}
const str = (v) => (v === null || v === undefined || v === '' ? null : { t: 's', v: String(v) });

function buildSheet(rows) {
  const ws = {};
  let maxC = 0;
  const widths = [];
  rows.forEach((row, r) => row.forEach((c, ci) => {
    if (!c) return;
    ws[XLSX.utils.encode_cell({ r, c: ci })] = c;
    maxC = Math.max(maxC, ci);
    const len = c.t === 'n' ? 13 : Math.min(String(c.v).length + 2, 60);
    widths[ci] = Math.max(widths[ci] || 10, len);
  }));
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length - 1, 0), c: maxC } });
  ws['!cols'] = widths.map(w => ({ wch: w || 10 }));
  return ws;
}

function reportRows(rep) {
  const rows = [[str(rep.title)], [str(rep.subtitle)], []];
  if (rep.error) rows.push([str(`This report could not be produced: ${rep.error}`)], []);
  (rep.summary || []).forEach(m => rows.push([str(m.label), cell(m.value, m.format)]));
  if ((rep.summary || []).length) rows.push([]);
  for (const sec of rep.sections || []) {
    rows.push([str(sec.title)]);
    if (sec.note) rows.push([str(sec.note)]);
    rows.push(sec.columns.map(c => str(c.label)));
    for (const r of sec.rows || []) rows.push(sec.columns.map(c => cell(r[c.key], c.format)));
    if (sec.totals) rows.push(sec.columns.map(c => cell(sec.totals[c.key], c.format)));
    rows.push([]);
  }
  (rep.notes || []).forEach(n => rows.push([str(n)]));
  return rows;
}

async function rawData(userId, b) {
  const q = (sql, params) => pool.query(sql, [userId, b.from, b.to, ...(params || [])]).then(r => r.rows);
  const [inv, exp, jr, ast, wag, drw] = await Promise.all([
    q(`SELECT i.number, COALESCE(cr.name,'') AS client, i."issueDate"::text AS issued, i."dueDate"::text AS due, i.status, COALESCE(i."docType",'invoice') AS type,
              i.subtotal, i.gst, i.total, i."paidAt"::date::text AS paid
       FROM fin_invoices i LEFT JOIN clients cr ON cr.id = i."clientRef"
       WHERE i."userId"=$1 AND i."issueDate" BETWEEN $2::date AND $3::date ORDER BY i."issueDate", i.id`),
    q(`SELECT e.date::text AS date, COALESCE(e.supplier,'') AS supplier, e.description, COALESCE(e.category,'') AS category, COALESCE(t.code,'') AS code,
              e.amount, e.gst, (e.amount + e.gst) AS total, COALESCE(pa.name,'Bank / Cash') AS paid_from,
              CASE WHEN e.receipt_path IS NOT NULL THEN 'Receipt' WHEN EXISTS (SELECT 1 FROM fin_document_links l WHERE l."expenseId"=e.id) THEN 'Document' ELSE 'None' END AS evidence
       FROM fin_expenses e LEFT JOIN fin_tx_codes t ON t.id=e."txCodeId" LEFT JOIN fin_accounts pa ON pa.id=e."paidViaId"
       WHERE e."userId"=$1 AND e.date BETWEEN $2::date AND $3::date ORDER BY e.date, e.id`),
    q(`SELECT e.date::text AS date, e.type, e.description, COALESCE(e.reference,'') AS reference, a.code, a.name, l.debit, l.credit
       FROM fin_journal_entries e JOIN fin_journal_lines l ON l."entryId"=e.id JOIN fin_accounts a ON a.id=l."accountId"
       WHERE e."userId"=$1 AND e.date BETWEEN $2::date AND $3::date ORDER BY e.date, e.id, l.id`),
    q(`SELECT "datePurchased"::text AS purchased, description, method, "effectiveLifeYears" AS life, amount, gst, "businessUsePercent" AS business_use,
              "accumulatedDepreciation" AS accumulated, COALESCE("disposedDate"::text,'') AS disposed, COALESCE("disposalAmount",0) AS proceeds
       FROM fin_assets WHERE "userId"=$1 AND "datePurchased" <= $3::date AND ("disposedDate" IS NULL OR "disposedDate" >= $2::date) ORDER BY "datePurchased", id`),
    q(`SELECT date::text AS date, employee, gross, tax, superannuation, net FROM fin_wages WHERE "userId"=$1 AND date BETWEEN $2::date AND $3::date ORDER BY date, id`),
    q(`SELECT date::text AS date, COALESCE(description,'') AS description, amount FROM fin_drawings WHERE "userId"=$1 AND date BETWEEN $2::date AND $3::date ORDER BY date, id`),
  ]);
  const M = (key, label) => ({ key, label, format: 'money' });
  const T = (key, label) => ({ key, label });
  const D = (key, label) => ({ key, label, format: 'date' });
  return [
    { name: 'Data - Invoices', title: 'Invoices and quotes issued in the year', columns: [T('number', 'Number'), T('type', 'Type'), T('client', 'Client'), D('issued', 'Issued'), D('due', 'Due'), T('status', 'Status'), M('subtotal', 'Ex-GST'), M('gst', 'GST'), M('total', 'Total'), D('paid', 'Paid')], rows: inv },
    { name: 'Data - Expenses', title: 'Expenses in the year', columns: [D('date', 'Date'), T('supplier', 'Supplier'), T('description', 'Description'), T('category', 'Category'), T('code', 'Code'), M('amount', 'Ex-GST'), M('gst', 'GST'), M('total', 'Total'), T('paid_from', 'Paid from'), T('evidence', 'Evidence')], rows: exp },
    { name: 'Data - Journal', title: 'Journal lines in the year', columns: [D('date', 'Date'), T('type', 'Type'), T('description', 'Description'), T('reference', 'Ref'), T('code', 'Account'), T('name', 'Account name'), M('debit', 'Debit'), M('credit', 'Credit')], rows: jr },
    { name: 'Data - Assets', title: 'Depreciating assets', columns: [D('purchased', 'Purchased'), T('description', 'Description'), T('method', 'Method'), { key: 'life', label: 'Life (yrs)', format: 'num' }, M('amount', 'Cost ex-GST'), M('gst', 'GST'), { key: 'business_use', label: 'Business use %', format: 'num' }, M('accumulated', 'Accumulated'), D('disposed', 'Disposed'), M('proceeds', 'Proceeds')], rows: ast },
    { name: 'Data - Wages', title: 'Wages', columns: [D('date', 'Date'), T('employee', 'Employee'), M('gross', 'Gross'), M('tax', 'PAYG'), M('superannuation', 'Super'), M('net', 'Net')], rows: wag },
    { name: 'Data - Drawings', title: 'Owner’s drawings', columns: [D('date', 'Date'), T('description', 'Description'), M('amount', 'Amount')], rows: drw },
  ];
}

const safeName = (name, used) => {
  let base = String(name).replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let n = base, i = 2;
  while (used.has(n.toLowerCase())) n = `${base.slice(0, 28)} ${i++}`;
  used.add(n.toLowerCase());
  return n;
};

async function renderPackXlsx(pack, userId) {
  const wb = XLSX.utils.book_new();
  const used = new Set();
  const c = pack.cover;

  // cover
  const coverRows = [
    [str(c.title)], [str(c.business)], [str(c.abn ? `ABN ${c.abn}` : '')], [str(c.address)], [],
    [str('Period'), str(c.period)],
    ...(c.gstStatus ? [[str('GST'), str(`${c.gstStatus} · ${c.gstBasis} basis`)]] : []),
    [str('Generated'), str(c.generatedAt)],
    ...(c.hideChecks ? [] : [[str('Items flagged to check'), c.itemsToCheck === null || c.itemsToCheck === undefined ? null : cell(c.itemsToCheck, 'int')]]), [],
    ...c.notes.map(n => [str(n)]),
    ...(c.failed.length ? [[], [str(`Not produced: ${c.failed.join(' | ')}`)]] : []),
  ];
  XLSX.utils.book_append_sheet(wb, buildSheet(coverRows), safeName('Cover', used));

  // sheet names first, so contents can link to them
  const reportSheets = pack.reports.map((r, i) => ({ r, i, name: safeName(SHORT[r.key] || r.title, used) }));
  const data = pack.dataSheets || await rawData(userId, pack.bounds); // other packs (Shares) bring their own raw data
  const dataSheets = data.map(d => ({ d, name: safeName(d.name, used) }));

  const tocRows = [[str('Contents')], [str('Click a name to jump to it.')], []];
  const link = (name, label) => { const x = str(label); x.l = { Target: `#'${name}'!A1`, Tooltip: label }; return x; };
  let lastGroup = null;
  for (const { r, i, name } of reportSheets) {
    if (r.group !== lastGroup) { tocRows.push([], [str(r.group)]); lastGroup = r.group; }
    tocRows.push([str(`${i + 1}.`), link(name, r.title), str(r.error ? `Not produced: ${r.error}` : '')]);
  }
  tocRows.push([], [str('Data for copying and pasting')]);
  for (const { d, name } of dataSheets) tocRows.push([null, link(name, d.title)]);
  XLSX.utils.book_append_sheet(wb, buildSheet(tocRows), safeName('Contents', used));
  // keep Contents second
  wb.SheetNames.splice(1, 0, wb.SheetNames.pop());

  for (const { r, name } of reportSheets) XLSX.utils.book_append_sheet(wb, buildSheet(reportRows(r)), name);
  for (const { d, name } of dataSheets) {
    const rows = [[str(d.title)], [], d.columns.map(col => str(col.label))];
    for (const row of d.rows) rows.push(d.columns.map(col => cell(row[col.key], col.format)));
    XLSX.utils.book_append_sheet(wb, buildSheet(rows), name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { renderPackXlsx };
