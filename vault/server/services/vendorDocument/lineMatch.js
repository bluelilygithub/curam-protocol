'use strict';

// Suggests which expense a vendor receipt/invoice is the proof of, going through the card statement line.
// Suggestions only: the person confirms, nothing here writes.
//
//   receipt  --(its total = the foreign amount on the card line, vendor named, within a week)-->  card line
//   card line --(already matched in Statement review, else same AUD total within a week)-->     expense
//
// A foreign purchase on the card statement carries its foreign amount in the description, written by the
// card reader as "(USD 21.20, incl. overseas fee 1.05)". The AUD amount on the line (and on the expense the
// person entered) is what the bank charged, so it never equals a USD receipt. A receipt that shows only
// "$" has no currency: its number is compared with the foreign amount and the currency is not checked.
// An AUD receipt is compared with the AUD amount directly.

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const dayMs = 86400000;
const toDay = (d) => {
  if (d instanceof Date) return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
};
const gapDays = (a, b) => Math.abs(toDay(a) - toDay(b)) / dayMs;

function foreignOf(description) {
  const m = /\(([A-Z]{3}) ([\d,]+\.\d{2})/.exec(String(description || ''));
  return m ? { currency: m[1], amount: round2(m[2].replace(/,/g, '')) } : null;
}

// the first distinctive word of the vendor: "Anthropic, PBC" -> "anthropic", "Eleven Labs Inc." -> "eleven"
function vendorWord(vendor) {
  const skip = ['inc', 'llc', 'ltd', 'pty', 'pbc', 'the', 'fal'];
  const words = String(vendor || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !skip.includes(w));
  return words[0] || null;
}

// card/bank statement lines that could be this document's charge, best first
function suggestLines(doc, lines, { maxDays = 7 } = {}) {
  if (!doc || !doc.docDate || !(Number(doc.total) > 0)) return [];
  const word = vendorWord(doc.vendor);
  const out = [];
  for (const l of lines || []) {
    if (!(Number(l.amount) < 0)) continue; // money out only
    const gap = gapDays(l.date, doc.docDate);
    if (!(gap <= maxDays)) continue;
    const named = !!word && String(l.description || '').toLowerCase().includes(word);
    const f = foreignOf(l.description);
    let amountAgrees = false;
    let how = '';
    if (doc.currency === 'AUD') {
      amountAgrees = Math.abs(Math.abs(round2(l.amount)) - round2(doc.total)) < 0.005;
      how = 'same AUD amount';
    } else if (f && Math.abs(f.amount - round2(doc.total)) < 0.005 && (!doc.currency || doc.currency === f.currency)) {
      amountAgrees = true;
      how = `${f.currency} ${f.amount.toFixed(2)} matches the receipt`;
    }
    if (!amountAgrees && !named) continue;
    out.push({
      lineId: l.id, date: l.date, description: l.description, amount: round2(l.amount), expenseId: l.matchExpenseId || null,
      strength: amountAgrees && named ? 'exact' : 'possible',
      note: [amountAgrees ? how : null, named ? 'vendor named' : null, gap === 0 ? 'same day' : `${gap} day${gap === 1 ? '' : 's'} apart`].filter(Boolean).join(', '),
      gap,
    });
  }
  const rank = { exact: 0, possible: 1 };
  return out.sort((a, b) => rank[a.strength] - rank[b.strength] || a.gap - b.gap).slice(0, 8);
}

// expenses whose total is this AUD amount, near this date; those naming the vendor first
function expensesFor(amountAud, date, vendor, expenses, { maxDays = 7 } = {}) {
  const word = vendorWord(vendor);
  const hits = (expenses || []).filter(e => Math.abs(round2(e.total) - round2(amountAud)) < 0.005 && gapDays(e.date, date) <= maxDays);
  const named = hits.filter(e => word && `${e.supplier || ''} ${e.description || ''}`.toLowerCase().includes(word));
  const pool = named.length ? named : hits;
  return pool.sort((a, b) => gapDays(a.date, date) - gapDays(b.date, date));
}

/**
 * @param doc      { docDate, vendor, total, currency }
 * @param lines    [{ id, date, description, amount, matchExpenseId }]
 * @param expenses [{ id, date, description, supplier, total }]   (total = amount + GST)
 * @returns { status: 'clear' | 'check' | 'none', line, expense, candidates: { lines, expenses }, note }
 *   clear = one card line agrees on amount AND vendor, and one expense belongs to it
 */
function matchReceipt(doc, lines, expenses) {
  const lineCands = suggestLines(doc, lines);
  const best = lineCands[0] || null;
  const lineIsUnique = !!best && (!lineCands[1] || lineCands[1].strength !== best.strength || lineCands[1].gap !== best.gap);

  let expenseCands = [];
  if (best) {
    const byId = best.expenseId ? (expenses || []).filter(e => e.id === best.expenseId) : [];
    expenseCands = byId.length ? byId : expensesFor(Math.abs(best.amount), best.date, doc.vendor, expenses);
  } else if (doc.currency === 'AUD') {
    expenseCands = expensesFor(doc.total, doc.docDate, doc.vendor, expenses);
  }

  const expense = expenseCands.length === 1 ? expenseCands[0] : null;
  const clear = !!expense && (best ? best.strength === 'exact' && lineIsUnique : false);
  const status = clear ? 'clear' : (best || expenseCands.length ? 'check' : 'none');
  let note = '';
  if (status === 'clear') note = best.note;
  else if (status === 'check') {
    note = !expense && expenseCands.length > 1 ? 'More than one expense fits'
      : !expense ? 'No expense of that amount near the charge'
      : !best ? 'Matched on amount only'
      : !lineIsUnique ? 'More than one card line fits'
      : 'Amount or vendor is not an exact match';
  } else note = doc.currency && doc.currency !== 'AUD' ? 'No card line with this amount near that date' : 'Nothing near that date matches';
  return { status, line: best, expense, candidates: { lines: lineCands, expenses: expenseCands.slice(0, 6) }, note };
}

module.exports = { suggestLines, expensesFor, matchReceipt, foreignOf, vendorWord };
