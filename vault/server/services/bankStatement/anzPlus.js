'use strict';

// Reads the text of an ANZ Plus account statement (savings / Flex Saver style) into transactions.
// Plain rules only; nothing here calls a model or leaves the machine.
//
// The PDF text gives each row ONE amount, so credit or debit is not printed. It is worked out from
// the running balance (rows are newest first: amount = balance - balance of the row below, the last
// row is measured against the opening balance), and the printed amount must agree with that change.
// The whole statement is then proved: opening + every row = closing. Anything that fails is returned
// as a problem instead of being guessed.

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (s) => Number(String(s).replace(/[$,\s]/g, ''));
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

function parseAnzPlusStatement(rawText) {
  const text = String(Array.isArray(rawText) ? rawText.join(' ') : rawText || '').replace(/\s+/g, ' ').trim();
  const problems = [];
  const fail = (msg) => ({ ok: false, problems: [...problems, msg], lines: [] });

  if (!/Australia and New Zealand Banking Group|\bANZ\b/i.test(text)) return fail('This does not look like an ANZ statement');

  const period = /(\d{1,2}) ([A-Za-z]{3,9}) (\d{4}) - (\d{1,2}) ([A-Za-z]{3,9}) (\d{4})/.exec(text);
  if (!period) return fail('Could not find the statement period');
  const mon = (s) => MONTHS[s.slice(0, 3).toLowerCase()];
  const start = { d: +period[1], m: mon(period[2]), y: +period[3] };
  const end = { d: +period[4], m: mon(period[5]), y: +period[6] };
  if (!start.m || !end.m) return fail('Could not read the statement period');

  // header: "Opening Balance Closing Balance 014 111 808 502 062 $20,830.43 $29,182.00"
  const hdr = /Opening Balance Closing Balance[\s\S]*?\$([\d,]+\.\d{2}) \$([\d,]+\.\d{2})/i.exec(text);
  if (!hdr) return fail('Could not find the opening and closing balances');
  const openingBal = money(hdr[1]);
  const closingBal = money(hdr[2]);

  const acct = /Branch Number \(BSB\)[\s\S]*?(\d{3}) (\d{3}) ([\d ]{6,}?) \$/i.exec(text);
  const bsb = acct ? `${acct[1]}-${acct[2]}` : null;
  const accountNumber = acct ? acct[3].replace(/\s/g, '') : null;
  const product = /(ANZ Plus [A-Za-z ]+?) Branch Number/i.exec(text);
  const head = {
    bank: 'ANZ', product: product ? product[1].trim() : null, bsb, accountNumber,
    periodStart: iso(start.y, start.m, start.d), periodEnd: iso(end.y, end.m, end.d),
    openingBalance: openingBal, closingBalance: closingBal,
  };

  const tIdx = text.search(/Transactions Date Description/i);
  if (tIdx < 0) return fail('Could not find the transactions table');
  let body = text.slice(tIdx).replace(/^Transactions Date Description Credit Debit Balance\s*/i, '');
  const stop = body.search(/Opening Balance \$[\d,]+\.\d{2}|Please check your statement/i);
  if (stop >= 0) body = body.slice(0, stop);

  // "31 Aug CREDIT INTEREST PAID $53.22 $29,182.00"
  const rowRe = /(\d{1,2}) ([A-Z][a-z]{2}) (.+?) \$([\d,]+\.\d{2}) \$([\d,]+\.\d{2})(?= \d{1,2} [A-Z][a-z]{2} |\s*$)/g;
  const raw = [];
  let m;
  while ((m = rowRe.exec(body.trim()))) {
    const month = MONTHS[m[2].toLowerCase()];
    if (!month) { problems.push(`Unreadable date "${m[1]} ${m[2]}"`); continue; }
    raw.push({ day: +m[1], month, description: m[3].trim(), printed: money(m[4]), balance: money(m[5]) });
  }
  if (!raw.length) {
    // a month with nothing in it is legitimate when the balance did not move
    if (round2(openingBal) === round2(closingBal)) return { ok: true, ...head, lines: [], problems };
    return fail('No transactions were found but the balance changed');
  }

  // A statement can straddle New Year. Rows are newest first, so walk back from the end date and
  // drop a year each time the month number jumps up.
  let year = end.y;
  let prevMonth = null;
  const lines = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    if (prevMonth != null && r.month > prevMonth) year -= 1;
    prevMonth = r.month;
    const below = i + 1 < raw.length ? raw[i + 1].balance : openingBal;
    const amount = round2(r.balance - below);
    if (round2(Math.abs(amount)) !== round2(r.printed)) {
      problems.push(`${r.day} ${r.description}: printed amount ${r.printed.toFixed(2)} does not match the balance change ${amount.toFixed(2)}`);
    }
    lines.push({
      date: iso(year, r.month, r.day), description: r.description, amount, balance: r.balance,
      direction: amount >= 0 ? 'credit' : 'debit',
    });
  }
  lines.reverse(); // oldest first

  const net = round2(lines.reduce((s, l) => s + l.amount, 0));
  if (round2(openingBal + net) !== round2(closingBal)) {
    problems.push(`Opening ${openingBal.toFixed(2)} + transactions ${net.toFixed(2)} does not equal closing ${closingBal.toFixed(2)} — a row may be missing or misread`);
  }

  return { ok: problems.length === 0, ...head, lines, problems };
}

module.exports = { parseAnzPlusStatement };
