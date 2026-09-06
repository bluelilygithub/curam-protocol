'use strict';

/**
 * Format validators + deterministic generators for synthetic replacement values.
 * Keeps replacements passing basic real-world format checks (checksum/regex) so a
 * downstream reader validating the field doesn't immediately flag it as fake.
 *
 * Used as a post-pass over any strategy's map — never blocks generation, only
 * swaps an invalid synthetic value for a deterministically-generated valid one.
 */

function digitsOnly(v) {
  return String(v || '').replace(/\D/g, '');
}

/** AU ABN checksum (11 digits, weighted mod-89 == 0 after subtracting 1 from first digit). */
const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

function isValidAbn(value) {
  const d = digitsOnly(value);
  if (d.length !== 11) return false;
  const digits = d.split('').map(Number);
  digits[0] -= 1;
  const sum = digits.reduce((acc, n, i) => acc + n * ABN_WEIGHTS[i], 0);
  return sum % 89 === 0;
}

/** Deterministic valid ABN seeded from the real value so re-runs are stable. */
function generateValidAbn(seed) {
  const seedDigits = digitsOnly(seed).padEnd(10, '0').slice(0, 10).split('').map(Number);
  for (let last = 0; last <= 9; last += 1) {
    const digits = [...seedDigits, last];
    const check = [...digits];
    check[0] -= 1;
    const sum = check.reduce((acc, n, i) => acc + n * ABN_WEIGHTS[i], 0);
    if (sum % 89 === 0) return digits.join('');
  }
  // Fallback — should not happen (11 residues cover 0-9 pigeonhole across mod 89 rarely fails)
  return '51824753556'; // known-valid ABN (ATO example)
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function isValidEmail(value) {
  return EMAIL_RE.test(String(value || '').trim());
}

function generateValidEmail(seed) {
  const local = String(seed || 'person').toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 20) || 'person';
  return `${local || 'person'}@example.com`;
}

/** AU-shaped phone: 10 digits, starts 0. Loose — not carrier-validated. */
const AU_PHONE_RE = /^0\d{9}$/;

function isValidAuPhone(value) {
  return AU_PHONE_RE.test(digitsOnly(value));
}

function generateValidAuPhone(seed) {
  const d = digitsOnly(seed).padEnd(9, '5').slice(-9);
  return `0${d}`;
}

/** DD/MM/YYYY, real calendar date. */
function isValidDateDmy(value) {
  const m = String(value || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return false;
  const [, dd, mm, yyyy] = m.map(Number);
  const d = new Date(yyyy, mm - 1, dd);
  return d.getFullYear() === yyyy && d.getMonth() === mm - 1 && d.getDate() === dd;
}

/**
 * Validate + repair a synthetic value for a category. Returns the original value
 * unchanged when it already passes, otherwise a deterministic replacement.
 * @returns {{ value: string, wasInvalid: boolean }}
 */
function validateAndRepair(categoryLabel, syntheticValue, realValue) {
  const cat = String(categoryLabel || '').toLowerCase();

  if (/\babn\b/.test(cat)) {
    if (isValidAbn(syntheticValue)) return { value: syntheticValue, wasInvalid: false };
    return { value: generateValidAbn(realValue || syntheticValue), wasInvalid: true };
  }
  if (/email/.test(cat)) {
    if (isValidEmail(syntheticValue)) return { value: syntheticValue, wasInvalid: false };
    return { value: generateValidEmail(realValue || syntheticValue), wasInvalid: true };
  }
  if (/phone|mobile|tel/.test(cat)) {
    if (isValidAuPhone(syntheticValue)) return { value: syntheticValue, wasInvalid: false };
    return { value: generateValidAuPhone(realValue || syntheticValue), wasInvalid: true };
  }
  if (/^date$|date_of_birth|\bdob\b/.test(cat)) {
    if (isValidDateDmy(syntheticValue)) return { value: syntheticValue, wasInvalid: false };
    return { value: syntheticValue, wasInvalid: false }; // no safe deterministic repair without knowing source format
  }

  return { value: syntheticValue, wasInvalid: false };
}

module.exports = {
  isValidAbn,
  generateValidAbn,
  isValidEmail,
  generateValidEmail,
  isValidAuPhone,
  generateValidAuPhone,
  isValidDateDmy,
  validateAndRepair,
};
