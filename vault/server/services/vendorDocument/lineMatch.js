'use strict';

// Suggests which card/bank statement line a vendor receipt or invoice is the proof of. Suggestions only.
//
// A foreign purchase on the card statement carries its foreign amount in the description, written by the
// card reader as "(USD 27.50, incl. overseas fee 1.38)". The AUD amount on the line is what the bank
// charged (rate + fee), so it never equals a USD receipt: the receipt's own total is compared with the
// foreign amount instead. An AUD receipt is compared with the AUD amount directly.
//   exact    : amount agrees AND the vendor is named in the description
//   possible : amount agrees, or the vendor is named and the date is close

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const dayMs = 86400000;
const toDay = (d) => {
  if (d instanceof Date) return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
};

function foreignOf(description) {
  const m = /\(([A-Z]{3}) ([\d,]+\.\d{2})/.exec(String(description || ''));
  return m ? { currency: m[1], amount: round2(m[2].replace(/,/g, '')) } : null;
}

// the first distinctive word of the vendor: "Anthropic, PBC" -> "anthropic", "fal - Features & Labels" -> "features"
function vendorWord(vendor) {
  const words = String(vendor || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !['inc', 'llc', 'ltd', 'pty', 'pbc', 'the', 'fal'].includes(w));
  return words[0] || null;
}

function suggestLines(read, lines, { maxDays = 7 } = {}) {
  if (!read || !read.docDate || !(Number(read.total) > 0)) return [];
  const word = vendorWord(read.vendor);
  const when = toDay(read.docDate);
  const out = [];
  for (const l of lines || []) {
    if (!(Number(l.amount) < 0)) continue; // money out only
    const gap = Math.abs(toDay(l.date) - when) / dayMs;
    if (!(gap <= maxDays)) continue;
    const desc = String(l.description || '').toLowerCase();
    const named = !!word && desc.includes(word);
    const f = foreignOf(l.description);
    let amountAgrees = false;
    let how = '';
    if (read.currency === 'AUD') {
      amountAgrees = Math.abs(Math.abs(round2(l.amount)) - round2(read.total)) < 0.005;
      how = 'same AUD amount';
    } else if (f && Math.abs(f.amount - round2(read.total)) < 0.005 && (!read.currency || read.currency === f.currency)) {
      amountAgrees = true;
      how = `${f.currency} ${f.amount.toFixed(2)} matches the receipt`;
    }
    if (!amountAgrees && !named) continue;
    out.push({
      lineId: l.id, date: l.date, description: l.description, amount: round2(l.amount), decision: l.decision,
      strength: amountAgrees && named ? 'exact' : 'possible',
      note: [amountAgrees ? how : null, named ? 'vendor named' : null, `${gap === 0 ? 'same day' : `${gap} day${gap === 1 ? '' : 's'} apart`}`].filter(Boolean).join(', '),
      gap,
    });
  }
  const rank = { exact: 0, possible: 1 };
  return out.sort((a, b) => rank[a.strength] - rank[b.strength] || a.gap - b.gap).slice(0, 8);
}

module.exports = { suggestLines, foreignOf, vendorWord };
