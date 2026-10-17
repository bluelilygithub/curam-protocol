'use strict';

// Suggests which invoice or expense a statement line belongs to. Suggestions only: the person
// confirms each one and nothing is posted from here.
//   credit (money in)  -> an invoice: its number appears in the description and the total agrees
//                         ('exact'), or only one of the two does ('possible')
//   debit  (money out) -> an expense: same total within 7 days; 'exact' when the supplier's name is
//                         also in the description

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const digitsOf = (s) => String(s || '').replace(/\D/g, '');
const dayMs = 86400000;
const toDay = (d) => {
  if (d instanceof Date) return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
};

// A statement description can hold the invoice number run into other digits ("...2026004"), so the
// invoice number counts as present when its digits (at least 6 of them) appear in the description.
function numberInDescription(invoiceNumber, description) {
  const d = digitsOf(invoiceNumber);
  return d.length >= 6 && digitsOf(description).includes(d);
}

function suggestMatch(line, invoices, expenses) {
  const amt = round2(line.amount);
  if (amt > 0) {
    let best = null;
    for (const inv of invoices || []) {
      const sameTotal = Math.abs(round2(inv.total) - amt) < 0.005;
      const byNumber = numberInDescription(inv.number, line.description);
      if (byNumber && sameTotal) return { invoiceId: inv.id, strength: 'exact', note: `Invoice ${inv.number}: number and amount agree` };
      if (byNumber && !best) best = { invoiceId: inv.id, strength: 'possible', note: `Invoice ${inv.number} is named but its total is ${round2(inv.total).toFixed(2)}` };
      else if (sameTotal && !best) best = { invoiceId: inv.id, strength: 'possible', note: `Invoice ${inv.number} has the same total` };
    }
    return best;
  }
  const out = Math.abs(amt);
  const when = toDay(line.date);
  const desc = String(line.description || '').toLowerCase();
  let best = null;
  for (const e of expenses || []) {
    const total = round2(Number(e.amount) + Number(e.gst || 0));
    if (Math.abs(total - out) >= 0.005) continue;
    const gap = Math.abs(toDay(e.date) - when) / dayMs;
    if (!(gap <= 7)) continue;
    const sup = String(e.supplier || '').trim().toLowerCase();
    const named = sup.length >= 4 && desc.includes(sup);
    const cand = { expenseId: e.id, strength: named ? 'exact' : 'possible', note: `Expense "${e.description}" ${gap === 0 ? 'same day' : `${gap} day${gap === 1 ? '' : 's'} apart`}${named ? ', supplier named' : ''}` };
    if (!best || (cand.strength === 'exact' && best.strength !== 'exact')) best = cand;
  }
  return best;
}

module.exports = { suggestMatch, numberInDescription };
