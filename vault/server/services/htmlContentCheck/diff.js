'use strict';

// What changed between two snapshots (docs/html-content-check.md, "Changes"). Pure apart from the bundled `diff` package.
//
// 1. Blocks are lined up by a key: type, level and the text as compared (normalizeText: spaces, soft hyphens, quotes and whitespace evened
//    out; case and dashes kept), plus link addresses and, for a picture, its address. Longest common subsequence (`diffArrays`).
// 2. A removed block whose key reappears among the added ones elsewhere is one "moved" change, not a removal and an addition.
// 3. Within each run of removed-then-added blocks, a removed block is paired with the most alike added block (word overlap 40% or more,
//    in order) as one "changed" block with a word diff; the rest stay added or removed.
// 4. Changes that look like content changing by itself (cookie banners, dates, counters, wording that left the page in an earlier round
//    and came back, as a rotating panel does) are marked
//    `volatile` with a reason, so the page can group them under the real edits. They are never dropped.
// Change ids (c1, c2 ...) follow reading order, so the same two snapshots always give the same ids.

const lib = require('./lib');
const { normalizeText } = require('./extract');

const DIFF_VERSION = 2; // 2: filler words ("a", "just", "on") no longer count as a date changing by itself
const PAIR_MIN = 0.4;

const linksOf = (b) => (b.runs || []).filter((r) => r.link).map((r) => r.link);
function keyOf(b) {
  const parts = [b.type, b.level || '', normalizeText(b.text)];
  if (b.type === 'image') parts.push(b.src || '');
  const links = linksOf(b);
  if (links.length) parts.push(links.join(' '));
  return parts.join('\u0001');
}
const wordsOf = (s) => normalizeText(s).toLowerCase().split(' ').filter(Boolean);
function likeness(a, b) {
  if (a.type === 'image' || b.type === 'image') return a.type === b.type && (a.src === b.src || normalizeText(a.text) === normalizeText(b.text)) ? 1 : 0;
  const wa = wordsOf(a.text);
  const wb = wordsOf(b.text);
  if (!wa.length && !wb.length) return 1;
  const count = new Map();
  for (const w of wa) count.set(w, (count.get(w) || 0) + 1);
  let common = 0;
  for (const w of wb) { const n = count.get(w); if (n) { common++; count.set(w, n - 1); } }
  return (2 * common) / (wa.length + wb.length);
}

const brief = (b) => ({ blockId: b.id, type: b.type, text: b.text, section: b.section || [], ...(b.src ? { src: b.src } : {}), ...(b.level ? { level: b.level } : {}) });

/** The word diff of a changed block: [{ op: '=' | '-' | '+', text }], from the original texts (what the person sees). */
function wordDiff(before, after) {
  const parts = lib.diffWordsWithSpace(before, after, { timeout: WORDS_MS });
  if (!parts) return [{ op: '-', text: before }, { op: '+', text: after }]; // too long to compare word by word in time: shown whole
  return parts.map((p) => ({ op: p.added ? '+' : p.removed ? '-' : '=', text: p.value }));
}

// Lining up blocks costs time growing with blocks × differences, so a huge page that changed almost everywhere could take minutes
// (20,000 blocks all different: 110 s). The unchanged start and end are taken off first; the rest gets ALIGN_MS. If that runs out, the
// middle is treated as replaced (in order), and the result says `rough` so the page can say the line-up was approximate.
const ALIGN_MS = 1500;
const WORDS_MS = 200;
const PAIR_BUDGET = 250000; // "most alike" comparisons allowed in one stretch of changes; past it, unpaired blocks stay added / removed
function align(ka, kb) {
  let pre = 0;
  while (pre < ka.length && pre < kb.length && ka[pre] === kb[pre]) pre++;
  let suf = 0;
  while (suf < ka.length - pre && suf < kb.length - pre && ka[ka.length - 1 - suf] === kb[kb.length - 1 - suf]) suf++;
  const midA = ka.slice(pre, ka.length - suf);
  const midB = kb.slice(pre, kb.length - suf);
  const lined = midA.length && midB.length ? lib.diffArrays(midA, midB, { timeout: ALIGN_MS }) : null;
  const middle = lined || [{ removed: true, count: midA.length }, { added: true, count: midB.length }];
  return { parts: [{ count: pre }, ...middle, { count: suf }].filter((p) => p.count), rough: Boolean(midA.length && midB.length && !lined) };
}

// ---- content that changes by itself ----
const COOKIE = /\b(cookies?|consent|gdpr|privacy (settings|preferences)|accept all|reject all|manage (preferences|cookies))\b/i;
const MONTHS = 'jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?';
const DAYS = 'mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(r(s(day)?)?)?|fri(day)?|sat(urday)?|sun(day)?';
const DATE_WORD = new RegExp(`^(\\d{1,4}|\\d{1,2}(st|nd|rd|th)|\\d{1,2}[:.]\\d{2}([:.]\\d{2})?|\\d{1,4}[-/.]\\d{1,2}([-/.]\\d{1,4})?|${MONTHS}|${DAYS}|am|pm|today|yesterday|tomorrow|ago|just|now|an?|seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|updated|posted|published|on|at)$`, 'i');
const NUMBER_WORD = /^[~≈]?[$€£]?\d[\d,.]*[kmb%+]?$/i;
const COUNTING = /\b(results?|members?|views?|visitors?|followers?|subscribers?|likes?|comments?|reviews?|ratings?|items?|people|users?|downloads?|sold|left|in stock|online|shares?|votes?|signups?|bookings?)\b/i;
// A date that changes by itself needs a date's shape, not just a number or a weekday (a new phone number or opening day is an edit):
// a month, a time of day, a numeric date, or a relative time ("3 hours ago", "updated today").
const DATE_CORE = new RegExp(`^(\\d.*|${MONTHS}|today|yesterday|tomorrow)$`, 'i'); // a changed word that is itself a date part
const DATE_SHAPE = new RegExp(`^(${MONTHS}|\\d{1,2}[:.]\\d{2}([:.]\\d{2})?|\\d{1,4}[-/.]\\d{1,2}([-/.]\\d{1,4})?|today|yesterday|tomorrow|ago|now)$`, 'i');
// every changed word is a date word, and the line has a date's shape somewhere ("Updated 3 hours ago" -> "5 hours ago" changes only the number)
const lineWords = (t) => String(t).split(/[\s,()]+/).map((x) => x.replace(/^[^\w]+|[^\w%]+$/g, '')).filter(Boolean);
// and a changed word is itself a number or a date ("3" -> "5", "today" -> "yesterday"): adding "just", "a" or "on" to a sentence that
// mentions a month is an edit, not a date updating itself (owner's test, 2026-11-27)
const isDate = (w, text) => w.length > 0 && w.every((x) => DATE_WORD.test(x)) && w.some((x) => DATE_CORE.test(x))
  && [...w, ...lineWords(text)].some((x) => DATE_SHAPE.test(x));
// only the year changed, next to a copyright sign: footers that update themselves every January
const isCopyrightYear = (w, text) => w.length > 0 && w.every((x) => /^(19|20)\d\d$/.test(x)) && /©|\(c\)|copyright/i.test(text);
const changedWords = (words) => words.filter((p) => p.op !== '=').flatMap((p) => p.text.split(/[\s,()]+/)).map((w) => w.replace(/^[^\w$€£~≈]+|[^\w%+]+$/g, '')).filter(Boolean);
const countWords = (s) => (String(s).match(/\S+/g) || []).length;

/** Why a change looks like content changing by itself, or null. `gone` = normalised texts that left the page in an earlier round. */
function volatileReason(c, gone) {
  const texts = [c.before?.text, c.after?.text].filter(Boolean);
  if (texts.some((t) => COOKIE.test(t) && countWords(t) <= 80)) return 'cookie';
  // wording that went away earlier and is back: a rotating panel (or, rarely, an edit put back; grouped, never hidden)
  if (gone && c.after && c.type !== 'moved' && gone.has(normalizeText(c.after.text))) return 'rotating';
  if (c.type === 'changed' && c.words) {
    const w = changedWords(c.words);
    if (isDate(w, c.after.text) || isCopyrightYear(w, c.after.text)) return 'date';
    // a number that moved by itself in a short line that counts something ("1,204 members", "45,725,780 results"). A number inside a
    // sentence, a phone number or a price is a real edit, so a counting word must be there too.
    if (w.length && w.every((x) => NUMBER_WORD.test(x)) && countWords(c.after.text) <= 6 && COUNTING.test(c.after.text)) return 'counter';
  }
  if (c.type !== 'changed' && c.type !== 'moved') {
    const t = (c.after || c.before).text;
    const w = lineWords(t);
    if (w.length <= 8 && isDate(w, t)) return 'date';
  }
  return null;
}

/**
 * Changes from `from` to `to` (snapshots). `goneTexts`: normalised texts that left the page in earlier rounds (for 'rotating').
 * Returns { changes, stats }.
 */
function diffSnapshots(from, to, { goneTexts = null } = {}) {
  const A = from?.blocks || [];
  const B = to?.blocks || [];
  const ka = A.map(keyOf);
  const kb = B.map(keyOf);
  // ops in reading order: { kind: 'same' | 'removed' | 'added', a?, b? }
  const ops = [];
  let ia = 0;
  let ib = 0;
  const { parts, rough } = align(ka, kb);
  for (const part of parts) {
    for (let n = 0; n < part.count; n++) {
      if (part.added) ops.push({ kind: 'added', b: B[ib++] });
      else if (part.removed) ops.push({ kind: 'removed', a: A[ia++] });
      else ops.push({ kind: 'same', a: A[ia++], b: B[ib++] });
    }
  }

  // moved: the same block taken out in one place and put back in another
  const addedByKey = new Map();
  ops.forEach((o, i) => { if (o.kind === 'added') { const k = keyOf(o.b); if (!addedByKey.has(k)) addedByKey.set(k, []); addedByKey.get(k).push(i); } });
  for (const o of ops) {
    if (o.kind !== 'removed') continue;
    const at = addedByKey.get(keyOf(o.a));
    if (!at?.length) continue;
    const i = at.shift();
    ops[i] = { kind: 'moved', a: o.a, b: ops[i].b };
    o.kind = 'gone'; // reported once, where the block now is
  }

  // pair removed with added inside each run between unchanged blocks
  const changes = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].kind === 'same') { i++; continue; }
    let j = i;
    while (j < ops.length && ops[j].kind !== 'same') j++;
    const run = ops.slice(i, j);
    const removed = run.filter((o) => o.kind === 'removed');
    const added = run.filter((o) => o.kind === 'added');
    const pairOf = new Map(); // added op -> removed op
    let from0 = 0;
    // as many blocks replaced as put in, in the same place: an in-place edit, however short ("1921-2008" -> "1921–2008")
    if (removed.length === added.length && removed.every((r, k) => (r.a.type === 'image') === (added[k].b.type === 'image'))) {
      removed.forEach((r, k) => { pairOf.set(added[k], r); r.paired = true; });
      from0 = added.length;
    }
    const budget = removed.length * added.length <= PAIR_BUDGET;
    for (const r of budget ? removed : []) {
      if (r.paired) continue;
      let best = -1;
      let bestScore = PAIR_MIN;
      for (let k = from0; k < added.length; k++) {
        const s = likeness(r.a, added[k].b);
        if (s >= bestScore && !(s === bestScore && best >= 0)) { best = k; bestScore = s; }
      }
      if (best >= 0) { pairOf.set(added[best], r); r.paired = true; from0 = best + 1; }
    }
    for (const o of run) {
      if (o.kind === 'removed' && !o.paired) changes.push({ type: 'removed', before: brief(o.a) });
      else if (o.kind === 'moved') changes.push({ type: 'moved', before: brief(o.a), after: brief(o.b) });
      else if (o.kind === 'added') {
        const r = pairOf.get(o);
        if (!r) { changes.push({ type: 'added', after: brief(o.b) }); continue; }
        const c = { type: 'changed', before: brief(r.a), after: brief(o.b), words: wordDiff(r.a.text, o.b.text) };
        const la = linksOf(r.a).join(' ');
        const lb = linksOf(o.b).join(' ');
        if (la !== lb) c.links = { before: linksOf(r.a), after: linksOf(o.b) };
        if (r.a.type !== o.b.type || (r.a.level || 0) !== (o.b.level || 0)) c.kindChanged = true;
        changes.push(c);
      }
    }
    i = j;
  }

  const stats = { added: 0, removed: 0, changed: 0, moved: 0, volatile: 0, total: changes.length, ...(rough ? { rough: true } : {}) };
  changes.forEach((c, n) => {
    c.id = `c${n + 1}`;
    const why = volatileReason(c, goneTexts);
    if (why) { c.volatile = why; stats.volatile++; }
    stats[c.type]++;
  });
  return { changes, stats };
}

/** The normalised texts a diff took off the page (removed, or the old side of a change), for later rounds' 'rotating' check. */
function goneTexts(d, into = new Set()) {
  for (const c of d?.changes || []) if ((c.type === 'removed' || c.type === 'changed') && c.before?.text) into.add(normalizeText(c.before.text));
  return into;
}

module.exports = { diffSnapshots, goneTexts, volatileReason, DIFF_VERSION, _keyOf: keyOf };
