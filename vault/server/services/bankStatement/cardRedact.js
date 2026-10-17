'use strict';

// Redacted copy of an ANZ credit card statement PDF, for handing to an accountant:
//   - every transaction the person marked PERSONAL is removed (the whole row, including a foreign
//     amount line and the overseas fee line that belong to it);
//   - the running Balance column is removed on every row, and the account-summary totals on page 1
//     (opening, purchases, interest, payments, closing, available credit), because those figures
//     would let a reader work the hidden amounts back out;
//   - name, address, card number, dates and the business rows are left exactly as they are.
// The text is REMOVED from the file (PyMuPDF), not covered by a black box, then the result is read back
// and refused unless nothing is left under any removed area.
//
// Rectangles come from the PDF's own text positions (pdfjs). Rows are found by their shape (two dates
// and a card number), so no row is guessed from the text order.

const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const SCRIPT = path.join(__dirname, '..', 'pdfRedact', 'redact_pdf.py');
const PYTHON_BINS = [process.env.REDACT_PYTHON_BIN, process.env.FONTS_PYTHON_BIN, 'python3', 'python'].filter(Boolean);

const DATE_RE = /^\d{2}\/\d{2}\/\d{4}$/;
const DOLLAR_RE = /^\$([\d,]+\.\d{2})\s?(CR)?$/; // \"CR\" may be glued on (\"$400.00CR\") or a separate item
const FOREIGN_RE = /^[\d,]+\.\d{2} [A-Z]{3}$/;
const iso = (dmy) => `${dmy.slice(6, 10)}-${dmy.slice(3, 5)}-${dmy.slice(0, 2)}`;
const num = (s) => Math.abs(Number(String(s).replace(/[$,\sCR]/g, '')));
const keyOf = (date, amount, balance) => `${date}|${Math.abs(amount).toFixed(2)}|${Math.abs(balance).toFixed(2)}`;

const LEFT = 40;           // table content spans about x 45 .. 553
const RIGHT = 562;
const BALANCE_LEFT = 512;  // the Balance column starts at about x 519

async function loadPages(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), verbosity: 0 }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const items = content.items
      .filter((i) => i.str && i.str.trim())
      .map((i) => ({ str: i.str.trim(), x: i.transform[4], y: i.transform[5], w: i.width, h: i.height || 9 }));
    pages.push({ number: n, items });
  }
  return pages;
}

const sameRow = (a, b) => Math.abs(a - b) < 1.5;
function groupRows(items) {
  const rows = [];
  for (const it of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((r) => sameRow(r.y, it.y));
    if (row) row.items.push(it); else rows.push({ y: it.y, items: [it] });
  }
  for (const r of rows) r.items.sort((a, b) => a.x - b.x);
  return rows.sort((a, b) => b.y - a.y);
}

// What kind of row is this?
function classify(row) {
  const [a, b] = row.items;
  if (a && DATE_RE.test(a.str) && a.x < 60) {
    if (b && DATE_RE.test(b.str) && b.x > 90 && b.x < 115) return 'txn';
    if (row.items.some((i) => i.str.startsWith('INCL OVERSEAS TXN FEE'))) return 'fee';
  }
  if (row.items.length === 1 && FOREIGN_RE.test(a.str) && a.x > 180 && a.x < 210) return 'foreign';
  return null;
}

// Which dollar item belongs to each label on page 1 (the closest one to its right).
const SUMMARY_LABELS = [
  'Opening Balance', 'Purchases, Cash Advances & Other Debits', 'Interest Charges', 'Payments & Other Credits',
  'Closing Balance', 'Available Credit at',
];
function summaryTotals(page) {
  const dollars = page.items.filter((i) => DOLLAR_RE.test(i.str));
  const out = [];
  for (const label of SUMMARY_LABELS) {
    const l = page.items.find((i) => i.str.startsWith(label));
    if (!l) continue;
    let best = null;
    for (const d of dollars) {
      const dx = d.x - l.x; const dy = Math.abs(d.y - l.y);
      if (dx < -5 || dy > 25) continue;
      const dist = Math.hypot(dx, dy * 2);
      if (!best || dist < best.dist) best = { d, dist };
    }
    if (best && !out.includes(best.d)) out.push(best.d);
  }
  return out;
}

/**
 * @param pages  from loadPages
 * @param personal  [{ date:'YYYY-MM-DD', amount, balance }] lines marked personal (transaction date)
 * @returns { rects: {pageNo: [[x0,y0,x1,y1]]}, hiddenRows, keptRows, unmatched: keys never found }
 */
function planCardRedaction(pages, personal) {
  const wanted = new Map(personal.map((l) => [keyOf(l.date, l.amount, l.balance), false]));
  const rects = {};
  const add = (n, r) => { (rects[n] = rects[n] || []).push(r); };
  let block = null; // the transaction row currently being collected (rows can carry over a page)
  let hiddenRows = 0; let keptRows = 0;

  for (const page of pages) {
    for (const row of groupRows(page.items)) {
      const kind = classify(row);
      if (!kind) continue;
      if (kind === 'txn') {
        const amt = row.items.find((i) => DOLLAR_RE.test(i.str) && i.x > 430 && i.x < 505);
        const bal = row.items.find((i) => DOLLAR_RE.test(i.str) && i.x >= 505);
        const k = amt && bal ? keyOf(iso(row.items[1].str), num(amt.str), num(bal.str)) : null;
        const isPersonal = k != null && wanted.has(k);
        if (isPersonal) { wanted.set(k, true); hiddenRows++; } else keptRows++;
        block = { personal: isPersonal };
      }
      if (!block) continue; // a continuation row with nothing before it: leave it
      if (block.personal) add(page.number, [LEFT, row.y - 2, RIGHT, row.y + 8]);
      else {
        // kept row: only the running balance goes; a fee row's balance repeats the row above
        const balItem = row.items.find((i) => DOLLAR_RE.test(i.str) && i.x >= 505);
        if (balItem) add(page.number, [BALANCE_LEFT, row.y - 2, RIGHT, row.y + 8]);
      }
    }
  }
  const summary = pages.find((p) => p.number === 1);
  const totals = summary ? summaryTotals(summary) : [];
  for (const t of totals) add(1, [t.x - 2, t.y - 3, t.x + t.w + 3, t.y + Math.max(t.h, 9)]);

  return { rects, hiddenRows, keptRows, totalsHidden: totals.length, unmatched: [...wanted].filter(([, v]) => !v).map(([k]) => k) };
}

async function runPython(job) {
  let lastErr = null;
  for (const bin of PYTHON_BINS) {
    try {
      const child = execFileAsync(bin, [SCRIPT], { timeout: 120000, maxBuffer: 5 * 1024 * 1024, windowsHide: true });
      child.child.stdin.end(JSON.stringify(job));
      const { stdout } = await child;
      const out = JSON.parse(stdout.trim().split('\n').pop());
      if (out.ok) return out;
      lastErr = new Error(out.error || 'redaction failed');
    } catch (e) {
      // execFile rejects on a non-zero exit; the script prints its reason as JSON first
      let reason = e.message;
      try { const j = JSON.parse(String(e.stdout || '').trim().split('\n').pop()); if (j.error) reason = j.error; } catch { /* keep message */ }
      lastErr = new Error(reason);
      if (!/ENOENT|not found|not recognized|Python was not found|PyMuPDF is not installed/i.test(reason)) break;
    }
  }
  throw lastErr || new Error('Python is not available for redaction');
}

// Nothing may remain under a removed area.
function leaksIn(pages, rects) {
  const left = [];
  for (const page of pages) {
    for (const [x0, y0, x1, y1] of rects[page.number] || []) {
      for (const it of page.items) {
        const cx = it.x + it.w / 2;
        if (cx >= x0 && cx <= x1 && it.y >= y0 && it.y <= y1) left.push(`page ${page.number}: "${it.str}"`);
      }
    }
  }
  return left;
}

async function redactCardStatement(pdfBuffer, personalLines, summary) {
  const pages = await loadPages(pdfBuffer);
  const plan = planCardRedaction(pages, personalLines);
  if (plan.unmatched.length) {
    const e = new Error(`${plan.unmatched.length} personal line(s) could not be found in the PDF, so nothing was redacted`);
    e.statusCode = 422;
    throw e;
  }
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), `redact-${crypto.randomUUID()}-`));
  try {
    const input = path.join(dir, 'in.pdf'); const output = path.join(dir, 'out.pdf');
    await fsp.writeFile(input, pdfBuffer);
    await runPython({ input, output, pages: plan.rects, summary });
    const out = await fsp.readFile(output);
    const leaked = leaksIn(await loadPages(out), plan.rects);
    if (leaked.length) {
      const e = new Error(`Redaction check failed — text is still present: ${leaked.slice(0, 5).join('; ')}`);
      e.statusCode = 500;
      throw e;
    }
    return { buffer: out, report: { hiddenRows: plan.hiddenRows, keptRows: plan.keptRows, totalsHidden: plan.totalsHidden, areas: Object.values(plan.rects).reduce((s, r) => s + r.length, 0) } };
  } finally {
    fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { redactCardStatement, planCardRedaction, loadPages, leaksIn, keyOf };
