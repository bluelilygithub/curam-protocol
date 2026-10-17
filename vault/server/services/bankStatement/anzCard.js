'use strict';

// Reads the text of an ANZ credit card statement into transactions. Plain rules only; nothing here
// calls a model or leaves the machine.
//
// Layout (oldest first): processed date, transaction date, card (last 4), description, amount
// ("$1,200.00 CR" is a credit to the card), running balance (also "CR" when the card is in credit).
// A foreign purchase shows the foreign amount ("22.66 USD") after its row, then a follow-up row
// "INCL OVERSEAS TXN FEE 1.13 AUD" whose balance repeats the row above: the fee is already inside
// the purchase amount, so it is attached to that purchase and is not a transaction of its own.
//
// Proof: every row's balance must equal the one before plus/minus its amount (starting at the opening
// balance), the last must equal the closing balance, and the purchase and payment totals must equal
// the account summary on page 1. Anything that fails is returned as a problem, never guessed.
//
// Line amounts are from the cardholder's side (purchase negative, payment/refund positive); `balance`
// is the amount owed (a card in credit is negative).

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (s) => Number(String(s).replace(/[$,\s]/g, ''));
const isoFromDmy = (s, twoDigitYear) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{2,4})$/.exec(s);
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${y}-${m[2]}-${m[1]}`;
};

// "CR" follows an amount either after a space ("$400.00 CR") or glued on ("$400.00CR"); both appear, sometimes in
// the same statement, so the space is optional everywhere.
const ROW_RE = /(\d{2}\/\d{2}\/\d{4}) (\d{2}\/\d{2}\/\d{4}) (\d{4}) (.+?) \$([\d,]+\.\d{2})( ?CR)? \$([\d,]+\.\d{2})( ?CR)?(?: ([\d,]+\.\d{2}) ([A-Z]{3}))?/g;
const FEE_RE = /(\d{2}\/\d{2}\/\d{4}) INCL OVERSEAS TXN FEE ([\d,]+\.\d{2}) AUD \$([\d,]+\.\d{2})( ?CR)?/g;

function looksLikeAnzCard(text) {
  return /STATEMENT PERIOD:/i.test(text) && /YOUR ANZ ACCOUNT SUMMARY/i.test(text) && /Transaction Details/i.test(text);
}

function parseAnzCardStatement(rawText) {
  const text = String(Array.isArray(rawText) ? rawText.join(' ') : rawText || '').replace(/\s+/g, ' ').trim();
  const problems = [];
  const fail = (msg) => ({ ok: false, kind: 'card', problems: [...problems, msg], lines: [] });

  if (!looksLikeAnzCard(text)) return fail('This does not look like an ANZ credit card statement');

  const per = /STATEMENT PERIOD: (\d{2}\/\d{2}\/\d{2,4}) to (\d{2}\/\d{2}\/\d{2,4})/i.exec(text);
  if (!per) return fail('Could not find the statement period');
  const periodStart = isoFromDmy(per[1]);
  const periodEnd = isoFromDmy(per[2]);
  const acct = /ACCOUNT NUMBER: ([\d-]{12,23})/i.exec(text);
  const digits = acct ? acct[1].replace(/\D/g, '') : '';
  const product = /^(?:\S+ )?(ANZ [A-Z ]+?) STATEMENT PERIOD/i.exec(text) || /(ANZ [A-Z ]+?) STATEMENT PERIOD/i.exec(text);

  const sum = (label) => {
    const m = new RegExp(`${label}\\s+\\$([\\d,]+\\.\\d{2})( CR)?`, 'i').exec(text);
    return m ? (m[2] ? -money(m[1]) : money(m[1])) : null;
  };
  const opening = sum('Opening Balance');
  const purchases = sum('Purchases, Cash Advances & Other Debits');
  const interest = sum('Interest Charges');
  const payments = sum('Payments & Other Credits');
  const closing = sum('Closing Balance');
  if ([opening, purchases, payments, closing].some((v) => v == null)) return fail('Could not read the account summary');

  const head = {
    kind: 'card', bank: 'ANZ', product: product ? product[1].trim() : 'ANZ credit card', bsb: null,
    // only the last four digits of the card are kept
    accountNumber: digits ? `…${digits.slice(-4)}` : null,
    periodStart, periodEnd, openingBalance: opening, closingBalance: closing,
  };

  const start = text.search(/Transaction Details Date Processed/i);
  const body = start >= 0 ? text.slice(start) : text;

  const events = [];
  for (const m of body.matchAll(ROW_RE)) events.push({ at: m.index, type: 'row', m });
  for (const m of body.matchAll(FEE_RE)) events.push({ at: m.index, type: 'fee', m });
  events.sort((a, b) => a.at - b.at);

  const lines = [];
  for (const ev of events) {
    const m = ev.m;
    if (ev.type === 'row') {
      const credit = !!m[6];
      const amount = credit ? money(m[5]) : -money(m[5]);
      lines.push({
        date: isoFromDmy(m[2]), processed: isoFromDmy(m[1]), card: m[3], description: m[4].trim(), amount,
        balance: m[8] ? -money(m[7]) : money(m[7]),
        foreignAmount: m[9] ? money(m[9]) : null, foreignCurrency: m[10] || null, overseasFee: null,
        direction: credit ? 'credit' : 'debit',
      });
    } else {
      const prev = lines[lines.length - 1];
      const bal = m[4] ? -money(m[3]) : money(m[3]);
      if (!prev) { problems.push('An overseas fee row appears before any purchase'); continue; }
      if (round2(prev.balance) !== round2(bal)) problems.push(`Overseas fee row after "${prev.description}" has balance ${bal.toFixed(2)}, expected ${prev.balance.toFixed(2)}`);
      prev.overseasFee = money(m[2]);
    }
  }
  if (!lines.length) {
    if (round2(opening) === round2(closing) && round2(purchases) === 0 && round2(payments) === 0) return { ok: true, ...head, lines: [], problems };
    return fail('No transactions were found but the statement shows activity');
  }

  // running balance proof
  let bal = opening;
  for (const l of lines) {
    bal = round2(bal - l.amount); // a purchase (negative amount) raises what is owed
    if (round2(l.balance) !== bal) {
      problems.push(`${l.date} ${l.description}: balance ${l.balance.toFixed(2)} does not follow from the row before (${bal.toFixed(2)}) — a row may be missing or misread`);
      bal = round2(l.balance); // resynchronise so one bad row does not flag every later one
    }
  }
  if (round2(bal) !== round2(closing)) problems.push(`The last balance ${bal.toFixed(2)} does not equal the closing balance ${closing.toFixed(2)}`);

  // Interest has its own line on the summary ("Interest Charges"), separate from purchases, but appears among
  // the transactions as a row ("INTEREST CHARGED ON PURCHASES"), so those rows are totalled apart.
  const isInterest = (l) => l.amount < 0 && /^INTEREST(\s|$)/i.test(l.description);
  const interestSum = round2(lines.filter(isInterest).reduce((s, l) => s - l.amount, 0));
  const debits = round2(lines.filter((l) => l.amount < 0 && !isInterest(l)).reduce((s, l) => s - l.amount, 0));
  const credits = round2(lines.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0));
  const interestRows = interest || 0;
  if (round2(debits) !== round2(purchases)) problems.push(`Purchases and other debits add up to ${debits.toFixed(2)} but the summary says ${purchases.toFixed(2)}`);
  if (round2(interestSum) !== round2(interestRows)) problems.push(`Interest rows add up to ${interestSum.toFixed(2)} but the summary says ${interestRows.toFixed(2)}`);
  if (round2(credits) !== round2(payments)) problems.push(`Payments and other credits add up to ${credits.toFixed(2)} but the summary says ${payments.toFixed(2)}`);
  if (round2(opening + purchases + interestRows - payments) !== round2(closing)) problems.push('The account summary does not add up (opening + purchases + interest − payments ≠ closing)');

  const out = lines.map((l) => {
    const extra = l.foreignAmount ? ` (${l.foreignCurrency} ${l.foreignAmount.toFixed(2)}${l.overseasFee ? `, incl. overseas fee ${l.overseasFee.toFixed(2)}` : ''})` : '';
    return { ...l, description: `${l.description}${extra}` };
  });
  return { ok: problems.length === 0, ...head, lines: out, problems };
}

module.exports = { parseAnzCardStatement, looksLikeAnzCard };
