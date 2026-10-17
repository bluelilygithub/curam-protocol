'use strict';

// Parses a pasted CMC Markets "dividend proceeds" email into review-queue lines.
// Plain text rules only — nothing here calls a model or leaves the machine.
//
// Unlike the PDF Trading Account Statement (net only), this email states gross, tax withheld, net
// and the exchange rate, so gross/withholding are READ, never derived. The rate is USD per 1 AUD
// ("Exchange Rate @ 0.69800"): AUD = USD / rate.
//
// The account number and account name in the email are deliberately not kept.

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

function num(s) {
  if (s == null) return null;
  const n = Number(String(s).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// DD/MM/YYYY -> YYYY-MM-DD, null unless it is a real calendar date.
function ddmmyyyy(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s || '').trim());
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const field = (block, label) => {
  const m = new RegExp(`^[ \\t]*${label}[ \\t:]+(.+)$`, 'im').exec(block);
  return m ? m[1].trim() : null;
};
// "USD 97.57" -> { cur: 'USD', value: 97.57 }
const money = (s) => {
  const m = /^([A-Z]{3})\s+(-?[\d,]*\.?\d+)/.exec(String(s || '').trim());
  return m ? { cur: m[1], value: num(m[2]) } : null;
};

function parseBlock(block) {
  const on = /Dividend On:\s*([A-Za-z0-9.\-]+)(?::([A-Za-z]{2}))?/i.exec(block);
  if (!on) return { error: 'no "Dividend On:" line' };
  const symbol = on[1].toUpperCase();
  const country = on[2] ? on[2].toUpperCase() : null;

  const payDate = ddmmyyyy(field(block, 'Pay Date'));
  if (!payDate) return { symbol, error: 'Pay Date missing or not DD/MM/YYYY' };
  const exDate = ddmmyyyy(field(block, 'Ex Date'));
  const sh = /([\d,]*\.?\d+)\s*shares?/i.exec(field(block, 'Holdings as at Ex Date') || '');

  const gross = money(field(block, 'Gross Amount'));
  const tax = money(field(block, 'Tax Withheld'));
  const netLocal = money(field(block, 'Net amount \\(Local\\)'));
  const netAudM = money(field(block, 'Net Amount \\(AUD\\)'));
  const rateRaw = /([\d.]+)/.exec(field(block, 'Exchange Rate @?') || '');
  const fx = rateRaw ? num(rateRaw[1]) : null;
  const rateMoney = money(field(block, 'Gross Dividend Rate'));

  const cur = (gross || netLocal || {}).cur || 'AUD';
  const warnings = [];
  let toAud;
  if (cur === 'AUD') toAud = (v) => v;
  else if (fx && fx > 0) toAud = (v) => v / fx;
  else return { symbol, error: `${cur} amounts but no Exchange Rate` };

  let netAud = netAudM && netAudM.cur === 'AUD' ? netAudM.value : (netLocal ? round2(toAud(netLocal.value)) : null);
  if (netAud == null || !(netAud > 0)) return { symbol, error: 'no Net Amount' };
  if (netAudM && netLocal && cur !== 'AUD' && Math.abs(netAudM.value - toAud(netLocal.value)) > 0.02) {
    warnings.push(`Net AUD ${netAudM.value.toFixed(2)} differs from ${netLocal.value.toFixed(2)} ${cur} at the stated rate (${round2(toAud(netLocal.value)).toFixed(2)}) — check it`);
  }

  // Withholding in AUD; gross = net + withholding so the three always add up to the stated net.
  const whAud = tax && tax.value > 0 ? round2(toAud(tax.value)) : 0;
  const grossAud = round2(netAud + whAud);
  if (gross && cur !== 'AUD' && Math.abs(toAud(gross.value) - grossAud) > 0.03) {
    warnings.push(`Gross ${gross.value.toFixed(2)} ${cur} converts to ${round2(toAud(gross.value)).toFixed(2)} AUD but net + tax is ${grossAud.toFixed(2)} — check it`);
  }
  const fees = money(field(block, 'Fees'));
  if (gross && tax && netLocal && Math.abs(gross.value - tax.value - (fees ? fees.value : 0) - netLocal.value) > 0.02) {
    warnings.push('Gross − tax − fees does not equal the net amount shown — check the email');
  }

  const shares = sh ? num(sh[1]) : null;
  return {
    line: {
      lineType: 'dividend',
      date: payDate,
      symbol,
      description: `Dividend ${symbol}${shares ? ` — ${shares} shares` : ''}${rateMoney ? ` @ ${rateMoney.cur} ${rateMoney.value}` : ''}${exDate ? ` (ex ${exDate})` : ''}`,
      amount: netAud,
      currency: 'AUD',
      grossAmountAud: grossAud,
      withholdingTaxAud: whAud,
      exDate,
      shares,
      country,
      localCurrency: cur,
      grossLocal: gross ? gross.value : null,
      taxLocal: tax ? tax.value : null,
      netLocal: netLocal ? netLocal.value : null,
      fxRate: cur === 'AUD' ? null : fx,
      source: 'cmc-dividend-email',
    },
    warnings,
  };
}

// text may hold one email or several pasted one after another.
function parseCmcDividendEmails(text) {
  const src = String(text || '').replace(/\r\n?/g, '\n');
  const parts = src.split(/(?=^[ \t]*Dividend On:)/im).filter((p) => /Dividend On:/i.test(p));
  const lines = [];
  const warnings = [];
  const skipped = [];
  for (const part of parts) {
    const r = parseBlock(part);
    if (r.line) {
      lines.push(r.line);
      for (const w of r.warnings) warnings.push(`${r.line.symbol} ${r.line.date}: ${w}`);
    } else {
      skipped.push(`${r.symbol || 'unknown'}: ${r.error}`);
    }
  }
  return { lines, warnings, skipped };
}

module.exports = { parseCmcDividendEmails };
