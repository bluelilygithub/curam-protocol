import React, { useState, useEffect, useMemo } from 'react';
import api from '../../utils/apiClient';
import Tooltip from '../../components/Tooltip';
import useToastStore from '../../store/toastStore';

// Renderer for the Finance reports added on top of the original four (see
// server/routes/financeReports.js). Every one of them returns the same normalized shape —
// { title, subtitle, notes, summary, sections: [{ title, note, columns, rows, totals }] } — so this
// one component renders any of them and provides CSV export and Print/PDF for all of them.

// ── registry ──────────────────────────────────────────────────────────────────
// mode: 'asOf' (one date) | 'range' (from/to) | 'fy' (financial year picker)
export const EXTRA_REPORTS = {
  'P&L Comparison':      { path: 'profit-loss-comparison', mode: 'range', extra: 'compare', tip: 'Profit & loss for a period against the previous period, the same period last year, or month by month.' },
  'Cash Flow Statement': { path: 'cash-flow-statement', mode: 'range', tip: 'Where cash actually came from and went — operating, investing and financing — with opening and closing bank balance.' },
  'General Ledger':      { path: 'general-ledger', mode: 'range', extra: 'account', tip: 'Every transaction per account with a running balance — the detail behind any figure in the other reports.' },
  'Aged Receivables':    { path: 'aged-receivables', mode: 'asOf', tip: 'Unpaid invoices grouped by how overdue they are, per client.' },
  'Aged Payables':       { path: 'aged-payables', mode: 'asOf', tip: 'Credit-card purchases not yet settled, aged by days since purchase, plus liability balances.' },
  'Customer Statements': { path: 'customer-statement', mode: 'range', extra: 'client', tip: 'A per-client statement of invoices and payments with a running balance. Download it as a PDF to send.' },
  'Invoice Status':      { path: 'invoice-status', mode: 'range', tip: 'Invoices and quotes by status, overdue value, average days to pay and quote conversion rate.' },
  'Sales by Client':     { path: 'sales-by-client', mode: 'range', tip: 'Who your revenue comes from: invoiced, paid and outstanding per client.' },
  'Purchases by Supplier': { path: 'purchases-by-supplier', mode: 'range', tip: 'Who you spend money with, ranked by total spend.' },
  'Expenses by Category': { path: 'expenses-by-category', mode: 'range', tip: 'Spending by category, with every underlying transaction listed underneath.' },
  'BAS Worksheet':       { path: 'bas-worksheet', mode: 'range', tip: 'Your figures laid out against the BAS labels (G1, 1A, G10, G11, 1B, W1, W2).' },
  'Depreciation Schedule': { path: 'depreciation-schedule', mode: 'fy', tip: 'Per-asset opening value, additions, depreciation, disposals and closing value for a financial year.' },
  'Drawings & Wages':    { path: 'drawings-wages', mode: 'range', tip: "Wages by employee, drawings by month, and the roll-forward of owner's equity." },
  'Tax Time Summary':    { path: 'tax-time-summary', mode: 'fy', tip: 'A financial-year hand-over for your accountant: income, deductions, vehicle/home office, assets and GST.' },
  'Budget vs Actual':    { path: 'budget-vs-actual', mode: 'fy', extra: 'budget', tip: 'Compare your budget for the year against actual income and expenses.' },
  'Audit Trail':         { path: 'audit-trail', mode: 'range', tip: 'When each journal entry was created and every invoice/quote email sent.' },
};

export const REPORT_GROUPS = [
  { label: 'Statements', items: ['Profit & Loss', 'P&L Comparison', 'Balance Sheet', 'Cash Flow Statement', 'Trial Balance', 'General Ledger'] },
  { label: 'Receivables & Payables', items: ['Aged Receivables', 'Aged Payables', 'Customer Statements', 'Invoice Status'] },
  { label: 'Sales & Purchases', items: ['Sales by Client', 'Purchases by Supplier', 'Expenses by Category'] },
  { label: 'Tax & Compliance', items: ['GST Summary', 'BAS Worksheet', 'Depreciation Schedule', 'Drawings & Wages', 'Tax Time Summary'] },
  { label: 'Planning & Control', items: ['Budget vs Actual', 'Audit Trail', 'Charts'] },
];

// ── local helpers ─────────────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0');
const isoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => isoLocal(new Date());
function quarterRange() {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3);
  return { from: `${now.getFullYear()}-${pad(q * 3 + 1)}-01`, to: isoLocal(new Date(now.getFullYear(), q * 3 + 3, 0)) };
}
function currentFy() {
  const now = new Date();
  const start = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return `${start}-${pad((start + 1) % 100)}`;
}
function fyOptions(count = 6) {
  const start = parseInt(currentFy().slice(0, 4), 10);
  return Array.from({ length: count }, (_, i) => { const s = start - i; return `${s}-${pad((s + 1) % 100)}`; });
}

const AUD = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });
function fmtDate(d) {
  if (!d) return '';
  return new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtCell(v, format) {
  if (v === null || v === undefined || v === '') return format === 'pct' ? '—' : '';
  switch (format) {
    case 'money': return AUD.format(Number(v) || 0);
    case 'int': return String(Math.round(Number(v) || 0));
    case 'num': return (Number(v) || 0).toFixed(1);
    case 'pct': return `${(Number(v) || 0).toFixed(1)}%`;
    case 'date': return fmtDate(v);
    case 'datetime': return new Date(v).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    default: return String(v);
  }
}
// Machine-readable value for CSV.
function rawCell(v, format) {
  if (v === null || v === undefined) return '';
  if (format === 'money' || format === 'num' || format === 'pct') return v === '' ? '' : (Number(v) || 0).toFixed(2);
  if (format === 'date') return String(v).slice(0, 10);
  if (format === 'datetime') return new Date(v).toISOString();
  return String(v);
}

function reportToRows(rep) {
  const rows = [[rep.title], [rep.subtitle || ''], []];
  (rep.summary || []).forEach(s => rows.push([s.label, rawCell(s.value, s.format)]));
  for (const sec of rep.sections || []) {
    rows.push([], [sec.title], sec.columns.map(c => c.label));
    sec.rows.forEach(r => rows.push(sec.columns.map(c => rawCell(r[c.key], c.format))));
    if (sec.totals) rows.push(sec.columns.map(c => rawCell(sec.totals[c.key], c.format)));
    if (sec.note) rows.push([sec.note]);
  }
  (rep.notes || []).forEach(n => rows.push([], [n]));
  return rows;
}

function downloadCsv(filename, rows) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + rows.map(r => r.map(esc).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// Opens a clean, black-on-white copy in a new window and triggers the browser print dialog
// ("Save as PDF" there). Deliberately unthemed — it is a printable document, not app UI.
function printReport(rep) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const table = (sec) => `
    <h2>${esc(sec.title)}</h2>
    ${sec.note ? `<p class="note">${esc(sec.note)}</p>` : ''}
    <table><thead><tr>${sec.columns.map(c => `<th class="${c.align === 'right' ? 'r' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>
    ${sec.rows.map(r => `<tr class="${r._bold ? 'b' : ''}">${sec.columns.map(c => `<td class="${c.align === 'right' ? 'r' : ''}">${esc(fmtCell(r[c.key], c.format))}</td>`).join('')}</tr>`).join('')}
    ${sec.totals ? `<tr class="t">${sec.columns.map(c => `<td class="${c.align === 'right' ? 'r' : ''}">${esc(fmtCell(sec.totals[c.key], c.format))}</td>`).join('')}</tr>` : ''}
    </tbody></table>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(rep.title)}</title><style>
    body{font:12px/1.4 Helvetica,Arial,sans-serif;color:#111;margin:24px}
    h1{font-size:18px;margin:0 0 2px} h2{font-size:13px;margin:18px 0 6px} .sub{color:#555;margin:0 0 12px}
    .sum{display:flex;gap:24px;flex-wrap:wrap;margin:8px 0 4px} .sum div span{display:block;color:#555;font-size:10px;text-transform:uppercase}
    table{width:100%;border-collapse:collapse} th,td{padding:4px 6px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}
    th{border-bottom:2px solid #999;font-size:10px;text-transform:uppercase;color:#444} .r{text-align:right} .b td{font-weight:bold}
    .t td{font-weight:bold;border-top:2px solid #999;background:#f3f3f3} .note,.notes{color:#555;font-style:italic;font-size:11px}
    @media print{body{margin:12mm}}
  </style></head><body>
    <h1>${esc(rep.title)}</h1><p class="sub">${esc(rep.subtitle || '')}</p>
    ${(rep.summary || []).length ? `<div class="sum">${rep.summary.map(s => `<div><span>${esc(s.label)}</span><b>${esc(fmtCell(s.value, s.format))}</b></div>`).join('')}</div>` : ''}
    ${(rep.sections || []).map(table).join('')}
    ${(rep.notes || []).map(n => `<p class="notes">${esc(n)}</p>`).join('')}
  </body></html>`;
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
  return true;
}

const fieldStyle = { background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' };
const secondaryBtn = 'px-3 py-1.5 text-sm rounded-lg font-medium transition-opacity hover:opacity-70 disabled:opacity-40';
const secondaryStyle = { background: 'transparent', color: 'var(--color-text)', border: '1px solid var(--color-border)' };

function LabelledField({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>{label}</label>
      {children}
    </div>
  );
}

function ReportSection({ sec }) {
  return (
    <div className="mb-6">
      <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--color-muted)' }}>{sec.title}</p>
      {sec.note && <p className="text-xs italic mb-1" style={{ color: 'var(--color-muted)' }}>{sec.note}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
              {sec.columns.map(c => (
                <th key={c.key} className={`py-2 px-2 text-xs font-semibold whitespace-nowrap ${c.align === 'right' ? 'text-right' : 'text-left'}`} style={{ color: 'var(--color-muted)' }}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sec.rows.length === 0 && (
              <tr><td colSpan={sec.columns.length} className="py-2 px-2 text-xs" style={{ color: 'var(--color-muted)' }}>No data for this period.</td></tr>
            )}
            {sec.rows.map((r, i) => (
              <tr key={i} style={{ borderTop: '1px solid var(--color-border)' }}>
                {sec.columns.map(c => (
                  <td key={c.key} className={`py-1.5 px-2 ${c.align === 'right' ? 'text-right tabular-nums' : ''} ${r._bold ? 'font-semibold' : ''}`} style={{ color: 'var(--color-text)' }}>
                    {fmtCell(r[c.key], c.format)}
                  </td>
                ))}
              </tr>
            ))}
            {sec.totals && (
              <tr style={{ borderTop: '2px solid var(--color-border)', background: 'var(--color-surface)' }}>
                {sec.columns.map(c => (
                  <td key={c.key} className={`py-1.5 px-2 text-xs font-semibold ${c.align === 'right' ? 'text-right tabular-nums' : ''}`} style={{ color: 'var(--color-text)' }}>
                    {fmtCell(sec.totals[c.key], c.format)}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BudgetEditor({ fy, onSaved }) {
  const addToast = useToastStore(s => s.addToast);
  const [lines, setLines] = useState(null);
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLines(null);
    api.get(`/api/finance/reports/budget-lines?fy=${fy}`).then(r => r.json()).then(d => {
      if (cancelled) return;
      if (d.error) { addToast(d.error, 'error'); return; }
      setLines(d.lines);
      setValues(Object.fromEntries(d.lines.map(l => [`${l.kind}:${l.code}`, l.budget ? String(l.budget) : ''])));
    }).catch(e => { if (!cancelled) addToast(e.message, 'error'); });
    return () => { cancelled = true; };
  }, [fy, addToast]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.put('/api/finance/reports/budget-lines', {
        fy, lines: lines.map(l => ({ kind: l.kind, code: l.code, amount: values[`${l.kind}:${l.code}`] || 0 })),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not save budgets');
      addToast('Budgets saved');
      onSaved();
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!lines) return <p className="text-sm mb-4" style={{ color: 'var(--color-muted)' }}>Loading budgets…</p>;
  const group = (kind, title) => (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>{title}</p>
      <div className="flex flex-col gap-2">
        {lines.filter(l => l.kind === kind).map(l => (
          <div key={`${kind}:${l.code}`} className="flex items-center gap-3">
            <span className="text-sm flex-1 min-w-0 truncate" style={{ color: 'var(--color-text)' }}>{l.code} · {l.name}</span>
            <span className="text-xs tabular-nums w-24 text-right" style={{ color: 'var(--color-muted)' }}>actual {AUD.format(l.actual)}</span>
            <input
              type="number" min="0" step="0.01" placeholder="0.00"
              value={values[`${kind}:${l.code}`] ?? ''}
              onChange={e => setValues(v => ({ ...v, [`${kind}:${l.code}`]: e.target.value }))}
              className="text-sm px-3 py-1.5 rounded-lg border w-32 text-right"
              style={fieldStyle}
            />
          </div>
        ))}
      </div>
    </div>
  );
  return (
    <div className="rounded-2xl border p-4 mb-6 max-w-2xl" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
      <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>
        Annual budget per transaction code for {fy}, ex-GST. Leave blank (or 0) for no budget.
      </p>
      <div className="flex flex-col gap-5">
        {group('income', 'Income')}
        {group('expense', 'Expenses')}
      </div>
      <div className="mt-4">
        <button onClick={save} disabled={saving} className="px-3 py-1.5 text-sm rounded-lg font-medium transition-opacity hover:opacity-80 disabled:opacity-40" style={{ background: 'var(--color-primary)', color: '#fff' }}>
          {saving ? 'Saving…' : 'Save budgets'}
        </button>
      </div>
    </div>
  );
}

export default function ExtraReport({ name, config }) {
  const addToast = useToastStore(s => s.addToast);
  const [range, setRange] = useState(quarterRange);
  const [asOf, setAsOf] = useState(todayStr);
  const [fy, setFy] = useState(currentFy);
  const [compare, setCompare] = useState('previous');
  const [account, setAccount] = useState('');
  const [clientId, setClientId] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [clients, setClients] = useState([]);
  const [showBudget, setShowBudget] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const fys = useMemo(() => fyOptions(), []);

  useEffect(() => {
    if (config.extra === 'account') {
      api.get('/api/finance/accounts').then(r => r.json()).then(d => Array.isArray(d) && setAccounts(d)).catch(() => {});
    }
    if (config.extra === 'client') {
      api.get('/api/finance/clients').then(r => r.json()).then(d => Array.isArray(d) && setClients(d)).catch(() => {});
    }
  }, [config.extra]);

  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (config.mode === 'range') { q.set('from', range.from); q.set('to', range.to); }
    if (config.mode === 'asOf') q.set('asOf', asOf);
    if (config.mode === 'fy') q.set('fy', fy);
    if (config.extra === 'compare') q.set('compare', compare);
    if (config.extra === 'account' && account) q.set('account', account);
    if (config.extra === 'client') q.set('clientId', clientId);
    return q.toString();
  }, [config, range, asOf, fy, compare, account, clientId]);

  const needsClient = config.extra === 'client' && !clientId;

  useEffect(() => {
    if (needsClient) { setReport(null); setError(''); return undefined; }
    let cancelled = false;
    setLoading(true); setError('');
    api.get(`/api/finance/reports/${config.path}?${query}`)
      .then(async r => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || `Report failed (${r.status})`);
        return body;
      })
      .then(d => { if (!cancelled) setReport(d); })
      .catch(e => { if (!cancelled) { setReport(null); setError(e.message); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [config.path, query, needsClient, reloadKey]);

  const fileStem = `${config.path}-${config.mode === 'range' ? `${range.from}-${range.to}` : config.mode === 'fy' ? fy : asOf}`;

  const exportCsv = () => report && downloadCsv(`${fileStem}.csv`, reportToRows(report));
  const doPrint = () => {
    if (report && !printReport(report)) addToast('Pop-ups are blocked — allow pop-ups to print or save as PDF.', 'error');
  };
  const downloadStatement = async () => {
    try {
      await api.download(`/api/finance/reports/customer-statement/pdf?${query}`, 'statement.pdf');
    } catch (e) {
      addToast(e.message, 'error');
    }
  };

  return (
    <div className="max-w-4xl">
      <div className="flex flex-wrap items-end gap-3 mb-4">
        {config.mode === 'range' && (
          <>
            <Tooltip text="Start of the report period"><LabelledField label="From"><input type="date" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} className="text-sm px-3 py-2 rounded-lg border" style={fieldStyle} /></LabelledField></Tooltip>
            <Tooltip text="End of the report period"><LabelledField label="To"><input type="date" value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} className="text-sm px-3 py-2 rounded-lg border" style={fieldStyle} /></LabelledField></Tooltip>
          </>
        )}
        {config.mode === 'asOf' && (
          <Tooltip text="Show the position as of this date"><LabelledField label="As of"><input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} className="text-sm px-3 py-2 rounded-lg border" style={fieldStyle} /></LabelledField></Tooltip>
        )}
        {config.mode === 'fy' && (
          <Tooltip text="Australian financial year, 1 July to 30 June"><LabelledField label="Financial year">
            <select value={fy} onChange={e => setFy(e.target.value)} className="text-sm px-3 py-2 rounded-lg border" style={fieldStyle}>
              {fys.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </LabelledField></Tooltip>
        )}
        {config.extra === 'compare' && (
          <Tooltip text="What to compare the period against"><LabelledField label="Compare with">
            <select value={compare} onChange={e => setCompare(e.target.value)} className="text-sm px-3 py-2 rounded-lg border" style={fieldStyle}>
              <option value="previous">Previous period</option>
              <option value="year">Same period last year</option>
              <option value="monthly">Month by month</option>
            </select>
          </LabelledField></Tooltip>
        )}
        {config.extra === 'account' && (
          <Tooltip text="Limit the ledger to a single account, or show all"><LabelledField label="Account">
            <select value={account} onChange={e => setAccount(e.target.value)} className="text-sm px-3 py-2 rounded-lg border" style={fieldStyle}>
              <option value="">All accounts</option>
              {accounts.map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
            </select>
          </LabelledField></Tooltip>
        )}
        {config.extra === 'client' && (
          <Tooltip text="Which client the statement is for"><LabelledField label="Client">
            <select value={clientId} onChange={e => setClientId(e.target.value)} className="text-sm px-3 py-2 rounded-lg border" style={fieldStyle}>
              <option value="">Select a client…</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </LabelledField></Tooltip>
        )}
        <div className="flex items-center gap-2 ml-auto">
          {config.extra === 'budget' && (
            <Tooltip text="Set the annual budget for each income and expense code"><button onClick={() => setShowBudget(s => !s)} className={secondaryBtn} style={secondaryStyle}>{showBudget ? 'Hide budgets' : 'Edit budgets'}</button></Tooltip>
          )}
          {config.extra === 'client' && (
            <Tooltip text="Download a customer-ready statement as a PDF"><button onClick={downloadStatement} disabled={needsClient} className={secondaryBtn} style={secondaryStyle}>Download PDF</button></Tooltip>
          )}
          <Tooltip text="Download this report as a CSV file"><button onClick={exportCsv} disabled={!report} className={secondaryBtn} style={secondaryStyle}>Export CSV</button></Tooltip>
          <Tooltip text="Open a printable copy — choose “Save as PDF” in the print dialog to keep a PDF"><button onClick={doPrint} disabled={!report} className={secondaryBtn} style={secondaryStyle}>Print / PDF</button></Tooltip>
        </div>
      </div>

      {config.extra === 'budget' && showBudget && <BudgetEditor fy={fy} onSaved={() => setReloadKey(k => k + 1)} />}

      {needsClient && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Pick a client to see their statement.</p>}
      {loading && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>}
      {error && <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>}

      {report && !loading && (
        <div>
          <div className="mb-3">
            <h3 className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>{report.title}</h3>
            {report.subtitle && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{report.subtitle}</p>}
          </div>
          {(report.notes || []).map((n, i) => (
            <p key={i} className="text-xs italic mb-2" style={{ color: 'var(--color-muted)' }}>{n}</p>
          ))}
          {(report.summary || []).length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-4">
              {report.summary.map(s => (
                <div key={s.label} className="rounded-2xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{s.label}</p>
                  <p className="text-base font-semibold tabular-nums" style={{ color: 'var(--color-text)' }}>{fmtCell(s.value, s.format)}</p>
                </div>
              ))}
            </div>
          )}
          {report.sections.map((sec, i) => <ReportSection key={`${sec.title}-${i}`} sec={sec} />)}
        </div>
      )}
    </div>
  );
}
