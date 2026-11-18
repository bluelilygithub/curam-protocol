// Search and filters for the admin Changelog page. Pure, so it is tested without a browser (node client/src/pages/changelog/filterEntries.test.mjs).
// Runs in the browser over the entries already loaded; no API. Dates are read in the viewer's own time zone, like the grouping.
// The filters live in the URL query (?q=&area=&from=&to=&concerns=1&file=) so a filtered view can be linked.

import { hasConcern } from './groupEntries.mjs';

export const EMPTY_FILTERS = Object.freeze({ q: '', area: '', from: '', to: '', concerns: false, file: '' });
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Filters from a URLSearchParams (or anything with .get). Bad values are dropped. */
export function parseFilters(params) {
  const get = (k) => String((params && params.get(k)) || '').trim();
  const from = get('from');
  const to = get('to');
  return {
    q: get('q').slice(0, 200),
    area: get('area').slice(0, 100),
    from: DATE_RE.test(from) ? from : '',
    to: DATE_RE.test(to) ? to : '',
    concerns: get('concerns') === '1',
    file: get('file').slice(0, 200),
  };
}

/** The URL query for some filters: only the ones set, so a clear view has a clean URL. */
export function filtersToParams(f) {
  const out = {};
  if (f.q) out.q = f.q;
  if (f.area) out.area = f.area;
  if (f.from) out.from = f.from;
  if (f.to) out.to = f.to;
  if (f.concerns) out.concerns = '1';
  if (f.file) out.file = f.file;
  return out;
}

export const isFiltered = (f) => !!(f.q || f.area || f.from || f.to || f.concerns || f.file);

/** The parts of an entry's area: "Graphics, Video Tools" and "Memory and SERP Tracker" each have two. */
export function areaParts(area) {
  return String(area || '').split(/\s*,\s*|\s+and\s+/i).map((s) => s.trim()).filter(Boolean);
}

/** Every area part in the entries, sorted, for the area picker. */
export function areaOptions(entries) {
  const set = new Set();
  for (const e of entries || []) for (const p of areaParts(e.area)) set.add(p);
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Search words: split on spaces, lower case; "quoted phrases" stay together. */
export function searchTerms(q) {
  const out = [];
  for (const m of String(q || '').toLowerCase().matchAll(/"([^"]+)"|(\S+)/g)) {
    const t = (m[1] || m[2] || '').trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

const SEARCH_FIELDS = ['subject', 'area', 'goal', 'whatChanged', 'benefit', 'concerns', 'commit', 'fullHash'];
const searchText = (e) => SEARCH_FIELDS.map((k) => String(e[k] || '')).join('\n').toLowerCase();

const pad = (n) => String(n).padStart(2, '0');
const localYmd = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/** The entries that pass every filter. Every search word must appear somewhere (AND); a file matches any part of a path. */
export function filterEntries(entries, f = EMPTY_FILTERS) {
  const terms = searchTerms(f.q);
  const area = String(f.area || '').toLowerCase();
  const file = String(f.file || '').toLowerCase().replace(/\\/g, '/').trim();
  return (entries || []).filter((e) => {
    if (f.from || f.to) {
      const day = localYmd(e.committedAt);
      if (f.from && day < f.from) return false;
      if (f.to && day > f.to) return false;
    }
    if (area && !areaParts(e.area).some((p) => p.toLowerCase() === area)) return false;
    if (f.concerns && !hasConcern(e)) return false;
    if (file && !(e.filesImpacted || []).some((p) => String(p).toLowerCase().includes(file))) return false;
    if (terms.length) {
      const text = searchText(e);
      if (!terms.every((t) => text.includes(t))) return false;
    }
    return true;
  });
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Split text into [{ text, hit }] pieces so the matches can be marked. No terms: one piece. */
export function highlightParts(text, terms) {
  const s = String(text ?? '');
  const list = (terms || []).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!s || !list.length) return [{ text: s, hit: false }];
  const re = new RegExp(`(${list.map(escapeRe).join('|')})`, 'gi');
  const out = [];
  let last = 0;
  for (const m of s.matchAll(re)) {
    if (m.index > last) out.push({ text: s.slice(last, m.index), hit: false });
    out.push({ text: m[0], hit: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last), hit: false });
  return out;
}

/** Split an answer from Ask into text and [hash] citation pieces: [{ text }] or [{ hash }]. Only hashes in `known` become links. */
export function citationParts(answer, known) {
  const s = String(answer || '');
  const list = [...(known || [])];
  const out = [];
  let last = 0;
  for (const m of s.matchAll(/\[([0-9a-fA-F]{7,40})\]/g)) {
    const h = m[1].toLowerCase();
    const hit = list.find((k) => h.startsWith(k) || k.startsWith(h));
    if (!hit) continue;
    if (m.index > last) out.push({ text: s.slice(last, m.index) });
    out.push({ hash: hit });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}
