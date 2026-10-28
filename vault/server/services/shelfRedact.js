'use strict';

// Vault Shelf -> "check this text for sensitive data". A pattern scan over a short piece of copied text: it returns WHERE things that look
// like personal or banking details are, and nothing else. No model is called, nothing is stored, nothing is logged.
//   - It reuses the pattern list of the Document redaction tool (email, phone, ID number, date of birth, street address) so both agree on what
//     "looks like an email". It adds checked patterns that tool does not need for whole documents: Tax File Numbers (checksum), BSB and account
//     numbers, and card numbers (Luhn).
//   - It does NOT find names or free-text details. The answer says so, and the Shelf shows it.
//   - Offsets are positions in the text as JavaScript counts them (UTF-16 units); each finding also carries the matched text so a client that
//     counts differently can search for it.

const { PATTERNS } = require('./documentRedaction/patternCandidates');

const MAX_TEXT = 100000;
const MAX_FINDINGS = 500;
const NOTE = 'This is a pattern scan. It finds things shaped like emails, phone numbers, ID, tax file, bank and card numbers and addresses. It does not find names or other free text, so read the text before you share it.';

// pattern labels borrowed from the Document redaction tool -> the words used here
const REUSED = { email: 'email', phone: 'phone', national_id: 'id_number', date_of_birth: 'date_of_birth', address: 'address' };

function luhnOk(digits) {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/** A 9-digit Tax File Number passes when its weighted digit sum divides by 11 (the published check). */
function tfnOk(digits) {
  if (digits.length !== 9) return false;
  const w = [1, 4, 3, 7, 5, 8, 6, 9, 10];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (digits.charCodeAt(i) - 48) * w[i];
  return sum % 11 === 0;
}

const digitsOf = (s) => String(s).replace(/\D/g, '');

const EXTRA = [
  { category: 'tax_file_number', confidence: 0.95, regex: /\b\d{3}[ -]?\d{3}[ -]?\d{3}\b/g, validate: (m) => tfnOk(digitsOf(m)), why: 'Nine digits that pass the Tax File Number check' },
  { category: 'bank_account', confidence: 0.92, regex: /\b\d{3}[ -]\d{3}[ ,/-]{1,3}\d{6,10}\b/g, why: 'BSB followed by an account number' },
  { category: 'bank_bsb', confidence: 0.85, regex: /\bBSB\s*(?:no\.?|number|#)?\s*[:-]?\s*(\d{3}[ -]?\d{3})\b/gi, group: 1, why: 'Number labelled BSB' },
  { category: 'bank_account', confidence: 0.85, regex: /\b(?:account|acc|a\/c)\s*(?:no\.?|number|#)?\s*[:-]?\s*(\d{6,10})\b/gi, group: 1, why: 'Number labelled as an account number' },
  { category: 'card_number', confidence: 0.93, regex: /\b(?:\d[ -]?){13,19}\b/g, validate: (m) => { const d = digitsOf(m); return d.length >= 13 && d.length <= 19 && luhnOk(d); }, why: 'Digits that pass the card number check' },
];

function runRule(text, rule, category, why, out) {
  const re = new RegExp(rule.regex.source, rule.regex.flags.includes('g') ? rule.regex.flags : `${rule.regex.flags}g`);
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[0] === '') { re.lastIndex++; continue; }
    const hit = rule.group != null ? (m[rule.group] || m[0]) : m[0];
    if (!hit || (rule.validate && !rule.validate(hit))) continue;
    let start = m.index;
    if (rule.group != null && m[rule.group]) { const rel = m[0].indexOf(m[rule.group]); if (rel >= 0) start = m.index + rel; }
    out.push({ start, end: start + hit.length, text: hit, category, confidence: rule.confidence, rationale: why });
    if (out.length > MAX_FINDINGS * 4) return;
  }
}

/** Where sensitive-looking details are in `text`. Findings never overlap (the more certain one wins), in reading order. */
function scanText(text) {
  const s = String(text ?? '').slice(0, MAX_TEXT);
  const all = [];
  for (const rule of PATTERNS) {
    const category = REUSED[rule.categoryLabel];
    if (category) runRule(s, rule, category, rule.rationale, all);
  }
  for (const rule of EXTRA) runRule(s, rule, rule.category, rule.why, all);

  all.sort((a, b) => b.confidence - a.confidence || (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const kept = [];
  for (const f of all) {
    if (kept.length >= MAX_FINDINGS) break;
    if (kept.some((k) => f.start < k.end && k.start < f.end)) continue;
    kept.push(f);
  }
  kept.sort((a, b) => a.start - b.start);

  const counts = {};
  for (const f of kept) counts[f.category] = (counts[f.category] || 0) + 1;
  return { findings: kept, counts, truncated: String(text ?? '').length > MAX_TEXT, note: NOTE };
}

module.exports = { scanText, luhnOk, tfnOk, MAX_TEXT, MAX_FINDINGS, NOTE };
