'use strict';

// BIP: small shared value helpers. No network calls here so every module can use them in tests.

const url = require('url');

const STOP_WORDS = new Set('a about after all also am an and any are as at be been by can for from had has have how in into is it its may more most of on or our out over own the their them then there these this to was we were what when which who will with you your'.split(' '));

/** Turn anything the person types into a registrable domain name. Returns null when it is not one. */
function domain(input) {
  let s = String(input || '').trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  s = s.split(/[/?#]/)[0].replace(/^[^@]*@/, '').replace(/:\d+$/, '').replace(/\.$/, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return null;
  const ascii = url.domainToASCII(s);
  if (!ascii || ascii.length > 253) return null;
  const labels = ascii.split('.');
  if (labels.length < 2 || labels.some((l) => !l || l.length > 63 || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(l))) return null;
  return ascii.replace(/^www\./, '');
}

function domainLabel(name) {
  return String(name || '').split('.')[0].replace(/[^a-z0-9]+/gi, ' ').trim();
}

function cleanText(input, max = 400) {
  return String(input || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function dateISO(input) {
  if (!input) return null;
  if (input instanceof Date && !Number.isNaN(input.getTime())) return input.toISOString().slice(0, 10);
  const s = String(input).trim();
  const m = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function yearsSince(input, now = new Date()) {
  const iso = dateISO(input);
  if (!iso) return null;
  const then = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(then.getTime()) || then > now) return null;
  const years = (now - then) / (365.25 * 24 * 60 * 60 * 1000);
  return Math.max(0, Math.round(years * 10) / 10);
}

function abnDigits(input) {
  const digits = String(input || '').replace(/\D/g, '');
  return digits.length === 11 ? digits : null;
}

function abnPretty(input) {
  const digits = abnDigits(input);
  return digits ? `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}` : cleanText(input, 40) || null;
}

/** Compare values without caring about spaces, case or punctuation. Used only to find duplicates, never to choose a winner. */
function valueKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function keywords(text, limit = 20) {
  const words = String(text || '').toLowerCase().match(/[a-z][a-z-]{2,}/g) || [];
  const counts = new Map();
  for (const w of words) {
    if (STOP_WORDS.has(w) || w.length < 4) continue;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([w]) => w);
}

function unique(items) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).filter((item) => {
    const key = valueKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { domain, domainLabel, cleanText, dateISO, yearsSince, abnDigits, abnPretty, valueKey, keywords, unique };
