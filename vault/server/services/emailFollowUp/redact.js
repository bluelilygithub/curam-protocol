'use strict';

// Hide personal details from the AI. Pure: no network, no database.
//
// Before mail text goes to the model, each detail of a few known shapes (phone numbers, street addresses, card, tax file, Medicare, bank and
// licence numbers, dates of birth, and email addresses that are not the owner's or the case's people) is swapped for a placeholder such as
// [PHONE_1]. The same detail always gets the same placeholder inside one call, so the AI can still tell that two mentions are the same.
// Whatever the AI sends back is put through restore(), so a quote is checked against the ORIGINAL text word for word, exactly as before.
//
// What this does not do, and the page says so: it does not hide NAMES, dates (other than a date of birth), amounts, company names or
// anything of a shape it does not know. It is pattern matching, not understanding. A detail it misses goes to the model as written.

const STREET = 'Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Court|Ct|Place|Pl|Lane|Ln|Crescent|Cres|Parade|Pde|Terrace|Tce|Boulevard|Blvd|Highway|Hwy|Way|Close|Cl|Circuit|Cct|Esplanade|Esp';
const STATE = 'NSW|VIC|QLD|SA|WA|TAS|NT|ACT';

// Order matters: the labelled numbers go first so a bare-number pattern cannot take their digits.
const PATTERNS = [
  { kind: 'EMAIL', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { kind: 'TFN', re: /((?:TFN|tax file number)[:\s#]*)(\d{3}[\s-]?\d{3}[\s-]?\d{2,3})/gi, group: 2 },
  { kind: 'MEDICARE', re: /(Medicare(?: card)?(?: number| no\.?)?[:\s#]*)(\d{4}[\s-]?\d{5}[\s-]?\d(?:\/\d)?)/gi, group: 2 },
  { kind: 'BANK', re: /(BSB[:\s#]*)(\d{3}[-\s]?\d{3})/gi, group: 2 },
  { kind: 'BANK', re: /((?:account|acc|a\/c)(?: number| no\.?)?[:\s#]*)(\d{6,10})\b/gi, group: 2 },
  { kind: 'DOB', re: /((?:DOB|date of birth|born)[:\s]*)(\d{1,2}[\s/.-]+(?:\d{1,2}|[A-Za-z]{3,9})[\s/.-]+\d{2,4})/gi, group: 2 },
  { kind: 'IDNUM', re: /((?:passport|licen[cs]e|driver'?s licen[cs]e)(?: number| no\.?)?[:\s#]*)([A-Z0-9]{6,12})\b/gi, group: 2 },
  { kind: 'CARD', re: /\b(?:\d[ -]?){13,19}\b/g, test: luhn },
  { kind: 'ADDRESS', re: new RegExp(`\\b(?:(?:Unit|Apt|Apartment|Flat|Suite)\\s+\\d+[A-Za-z]?,?\\s+)?\\d{1,5}[A-Za-z]?(?:/\\d{1,5})?\\s+[A-Z][A-Za-z'-]+(?:\\s[A-Z][A-Za-z'-]+)?\\s(?:${STREET})\\b\\.?(?:,?\\s+[A-Z][A-Za-z' -]{2,30}\\s+(?:${STATE})\\s+\\d{4})?`, 'g') },
  { kind: 'PHONE', re: /(?:\+61|\(?\b0)[\s-]?\(?[2-478]\)?(?:[\s-]?\d){8}\b|\b1[38]00[\s-]?\d{3}[\s-]?\d{3}\b|\+\d{1,3}[\s-]?\d(?:[\s-]?\d){7,11}\b/g },
];

function luhn(s) {
  const d = String(s).replace(/\D/g, '');
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = d.length - 1; i >= 0; i -= 1) {
    let n = Number(d[i]);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

const PLACEHOLDER = /\[(?:EMAIL|TFN|MEDICARE|BANK|DOB|IDNUM|CARD|ADDRESS|PHONE)_\d+\]/g;

/**
 * @param {{keep?: string[]}} opts `keep` lists addresses to leave alone: the owner's, and the case's people ("a@b.com" or "@b.com").
 */
function createRedactor({ keep = [] } = {}) {
  const exact = new Set();
  const domains = [];
  for (const k of keep.map((x) => String(x || '').trim().toLowerCase()).filter(Boolean)) {
    if (k.startsWith('@')) domains.push(k); else exact.add(k);
  }
  const isKept = (email) => {
    const e = email.toLowerCase();
    return exact.has(e) || domains.some((d) => e.endsWith(d));
  };

  const toPlaceholder = new Map(); // "KIND\u0000original" -> "[KIND_n]"
  const toOriginal = new Map();    // "[KIND_n]" -> original
  const counts = {};
  const tally = {};
  const place = (kind, original) => {
    const key = `${kind}\u0000${original}`;
    if (toPlaceholder.has(key)) return toPlaceholder.get(key);
    counts[kind] = (counts[kind] || 0) + 1;
    const ph = `[${kind}_${counts[kind]}]`;
    toPlaceholder.set(key, ph);
    toOriginal.set(ph, original);
    return ph;
  };

  function redact(text) {
    let out = String(text == null ? '' : text);
    // An existing placeholder-shaped string in the mail is left as it is; restore() would otherwise swap it for a detail.
    for (const p of PATTERNS) {
      out = out.replace(p.re, (...m) => {
        const whole = m[0];
        if (p.kind === 'EMAIL' && isKept(whole)) return whole;
        if (p.test && !p.test(whole)) return whole;
        if (p.group) {
          const secret = m[p.group];
          tally[p.kind] = (tally[p.kind] || 0) + 1;
          return whole.slice(0, whole.length - secret.length) + place(p.kind, secret);
        }
        tally[p.kind] = (tally[p.kind] || 0) + 1;
        return place(p.kind, whole);
      });
    }
    return out;
  }

  /** Put the originals back. `json: true` escapes them so they sit safely inside a JSON string in the model's reply. */
  function restore(text, { json = false } = {}) {
    return String(text == null ? '' : text).replace(PLACEHOLDER, (ph) => {
      if (!toOriginal.has(ph)) return ph;
      const o = toOriginal.get(ph);
      return json ? JSON.stringify(o).slice(1, -1) : o;
    });
  }

  return { redact, restore, count: () => toOriginal.size, tally: () => ({ ...tally }) };
}

/** The sentence added to the AI's instructions when details have been hidden. */
const PLACEHOLDER_NOTE = 'Some personal details in the text were replaced by placeholders such as [PHONE_1], [EMAIL_2] or [ADDRESS_1]. Treat each as the real detail. When you quote, copy the placeholder exactly as written, with its brackets.';

module.exports = { createRedactor, PLACEHOLDER_NOTE, luhn };
