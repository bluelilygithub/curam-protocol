/**
 * Measurement scanner — pure (no DOM, no OCR). Finds measurements in lines of text, classifies them,
 * flags ambiguities (never guesses silently) and proposes conversions from the registry.
 *
 *   scanLines(lines, opts)  → hits[]      lines: [{ text, segs?: [{start,end,bbox,conf}] }] for ONE page
 *   scanDocument(pages, opts) → hits[]    pages: [{ lines, ocr }]
 *   proposeFor(hit, prefs)  → { status, text, ... }
 *
 * opts: { context: 'general'|'recipe'|'building'|'product', region: 'us'|'imperial',
 *         cupStandard, ocr (per page), decimalComma (doc-level) }
 */
import { allUnits, getUnit, formatNumber, SCAN_TARGETS, systemMatches, GENERIC_FAMILIES, CUP_STANDARDS, DEFAULT_CUP_STANDARD, unitShort } from './registry.mjs';
import { convertValues, partLabel } from './convert.mjs';
import { NUMBER_SRC, parseNumeric } from './numbers.mjs';

// ── Unit matcher built from the registry ──────────────────────────────────────
const SYMBOL_MAP = new Map(); // exact (case-sensitive) symbol → ids
const ALIAS_MAP = new Map(); // lower-case alias → ids
function addTo(map, key, id) {
  if (!key) return;
  const list = map.get(key) || [];
  if (!list.includes(id)) list.push(id);
  map.set(key, list);
}
for (const u of allUnits()) {
  if (u.group === 'cooking' || u.type === 'compound') continue; // cooking needs an ingredient; compounds are built by the grammar
  for (const s of u.symbols) addTo(SYMBOL_MAP, s, u.id);
  for (const a of u.aliases) addTo(ALIAS_MAP, a.toLowerCase(), u.id);
}
// extra spellings that are only meaningful next to a number
for (const [s, id] of [['"', 'length.inch'], ["'", 'length.foot'], ['″', 'length.inch'], ['′', 'length.foot'], ['”', 'length.inch'], ['’', 'length.foot'], ['m2', 'area.m2'], ['m3', 'volume.m3']]) addTo(SYMBOL_MAP, s, id);
// Regional families: bare words resolve by the region setting.
for (const [fam, f] of Object.entries(GENERIC_FAMILIES)) {
  for (const w of f.words) ALIAS_MAP.set(w.toLowerCase(), [f.us, f.imperial]);
  SYMBOL_MAP.delete(fam);
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
function altFor(key) {
  let e = esc(key).replace(/ /g, '\\s+');
  if (/[°º]/.test(key)) e = e.replace(/(°|º)/g, '$1\\s?');
  return e;
}
const byLen = (a, b) => b.length - a.length;
const SYM_RE = new RegExp(`(?:${[...SYMBOL_MAP.keys()].sort(byLen).map(altFor).join('|')})(?![A-Za-z0-9²³])`, 'y');
const ALIAS_RE = new RegExp(`(?:${[...ALIAS_MAP.keys()].sort(byLen).map(altFor).join('|')})(?![A-Za-z0-9²³])`, 'iy');

const normSym = (s) => s.replace(/\s+/g, '').replace(/º/g, '°');
function symbolIds(text) {
  if (SYMBOL_MAP.has(text)) return SYMBOL_MAP.get(text);
  const n = normSym(text);
  for (const [k, v] of SYMBOL_MAP) if (normSym(k) === n) return v;
  return null;
}

/** Longest unit match at `pos`. Returns { len, ids, text, kind } or null. */
function matchUnit(line, pos) {
  SYM_RE.lastIndex = pos;
  const s = SYM_RE.exec(line);
  ALIAS_RE.lastIndex = pos;
  const a = ALIAS_RE.exec(line);
  const sm = s ? { len: s[0].length, text: s[0], ids: symbolIds(s[0]), kind: 'symbol' } : null;
  const am = a ? { len: a[0].length, text: a[0], ids: ALIAS_MAP.get(a[0].toLowerCase().replace(/\s+/g, ' ')), kind: 'alias' } : null;
  if (sm && am) return sm.len >= am.len ? sm : am;
  return sm || am;
}

// ── Number tokens ─────────────────────────────────────────────────────────────
const OCR_NUM = String.raw`[0-9OoIlS](?:[0-9OoIlS.,]*[0-9OoIlS])?`;
const mkNumRe = (ocr) => new RegExp(String.raw`(?<![A-Za-z0-9._,/])[-−]?(?:${ocr ? `${NUMBER_SRC.split('|').slice(0, 4).join('|')}|${OCR_NUM}` : NUMBER_SRC})`, 'g');
const NUM_RE = mkNumRe(false);
const NUM_RE_OCR = mkNumRe(true);
const NUM_STICKY = new RegExp(String.raw`[-−]?(?:${NUMBER_SRC})`, 'y');
const NUM_STICKY_OCR = new RegExp(String.raw`[-−]?(?:${NUMBER_SRC.split('|').slice(0, 4).join('|')}|${OCR_NUM})`, 'y');
const DIM_SEP = /\s*(?:×|x|X|\*)\s*(?=[-−]?[\d½¼¾])|\s+by\s+(?=[-−]?\d)/y;
const RANGE_SEP = /\s*[–—-]\s*(?=[-−]?[\d½¼¾])|\s+to\s+(?=[-−]?[\d½¼¾])/y;
const OCR_FIX = { O: '0', o: '0', I: '1', l: '1', S: '5' };
const STOPWORDS_AFTER_IN = /^(?:the|a|an|and|of|this|that|my|your|our|their|his|her|its|to|stock|total|all|case|case|order|addition|fact|time|general|front|use|place|which|any|each|every|one|two|three|four|five|six|seven|eight|nine|ten)\b/i;
const TIME_HINT = /(?:for|every|about|within|after|until|wait|cook|cooking|bake|baking|boil|simmer|rest|stand|chill|soak|takes?|minutes?|mins?|hours?|hrs?|seconds?)/i;
const LIQUID_WORDS = /\b(?:milk|water|juice|cream|liquid|fluid|beer|wine|oil|stock|broth|drink|beverage|soda|cola|vodka|syrup|vinegar|sauce|coffee|tea)\b/i;

function readNumber(line, pos, ocr) {
  const re = ocr ? NUM_STICKY_OCR : NUM_STICKY;
  re.lastIndex = pos;
  const m = re.exec(line);
  if (!m) return null;
  let raw = m[0];
  const flags = [];
  let text = raw;
  if (ocr && /[OolIS]/.test(raw)) {
    if (!/\d/.test(raw)) return null; // letters only: not a number
    text = raw.replace(/[OolIS]/g, (c) => OCR_FIX[c]);
    flags.push({ code: 'ocr-digit-fix', message: `OCR read "${raw}" next to a unit — corrected to "${text}". Check it against the image.` });
  }
  return { raw, text, start: m.index, end: m.index + raw.length, flags };
}

function skipSpaces(line, p) {
  let q = p;
  while (q < line.length && (line[q] === ' ' || line[q] === ' ' || line[q] === '\t') && q - p < 3) q += 1;
  return q;
}

// compound grammar: first part unit id → [compound id, second part unit id]
const COMPOUND_NEXT = {
  'length.foot': ['length.ftin', 'length.inch'],
  'mass.stone': ['mass.stlb', 'mass.pound'],
  'time.hour': ['time.hmin', 'time.minute'],
};

const RANK = { high: 3, medium: 2, low: 1 };
const lowest = (a, b) => (RANK[a] <= RANK[b] ? a : b);

// ── Unit resolution with ambiguity handling ───────────────────────────────────
function resolveUnit(match, ctx, line, afterPos, beforePos) {
  const flags = [];
  let conf = 'high';
  let ids = match.ids || [];
  const text = match.text;
  const ctxName = ctx.context || 'general';
  const region = ctx.region || 'imperial';
  let id = null;

  if (match.kind === 'symbol' && text === 'm') {
    if (ctxName === 'recipe') { id = 'time.minute'; flags.push({ code: 'ambiguous-unit', message: '"m" can mean metres or minutes — read as minutes because this looks like a recipe.' }); conf = 'medium'; }
    else if (ctxName === 'building') id = 'length.metre';
    else {
      id = 'length.metre';
      const around = `${line.slice(Math.max(0, beforePos - 30), beforePos)} ${line.slice(afterPos, afterPos + 20)}`;
      // clear evidence of lengths elsewhere and no time wording nearby: metres, no flag
      if (!(ctx.lengthEvidence && !TIME_HINT.test(around))) { flags.push({ code: 'ambiguous-unit', message: '"m" can mean metres or minutes — read as metres.' }); conf = 'medium'; }
    }
  } else if (match.kind === 'symbol' && (text === 't' || text === 'T')) {
    const asSpoon = ctxName === 'recipe';
    if (text === 't') id = asSpoon ? 'volume.tsp' : 'mass.tonne';
    else id = asSpoon ? 'volume.tbsp' : 'mass.tonne';
    flags.push({ code: 'ambiguous-unit', message: `"${text}" can mean ${text === 't' ? 'teaspoon' : 'tablespoon'} or tonne — read as ${asSpoon ? (text === 't' ? 'teaspoon' : 'tablespoon') : 'tonne'}.` });
    conf = 'medium';
  } else if (match.kind === 'symbol' && text === 'oz') {
    const around = `${line.slice(Math.max(0, beforePos - 40), beforePos)} ${line.slice(afterPos, afterPos + 40)}`;
    if (ctxName === 'recipe' && LIQUID_WORDS.test(around)) {
      id = region === 'us' ? 'volume.floz_us' : 'volume.floz_imp';
      flags.push({ code: 'ambiguous-unit', message: '"oz" can be weight or fluid ounces — nearby words suggest a liquid, read as fluid ounces.' });
    } else {
      id = 'mass.ounce';
      flags.push({ code: 'ambiguous-unit', message: '"oz" can be weight or fluid ounces — read as weight.' });
    }
    conf = 'medium';
  } else if (match.kind === 'symbol' && text.replace(/\s+/g, '') .replace('º', '°') === '°') {
    id = null; // handled by the caller (bare degree sign)
  } else {
    if (ids.length > 1) {
      const variants = ids.filter((x) => getUnit(x).generic);
      if (variants.length > 1) {
        id = variants.find((x) => getUnit(x).variant === (region === 'us' ? 'us' : 'imperial')) || variants[0];
        const u = getUnit(id);
        flags.push({ code: 'regional-variant', message: `"${text}" differs between US and imperial — read as ${u.variant === 'us' ? 'US' : 'imperial'} (${u.name}).` });
        conf = 'medium';
      } else id = ids[0];
    } else id = ids[0] || null;
    const u = id ? getUnit(id) : null;
    if (u) {
      if (['volume.cup', 'volume.tbsp', 'volume.tsp'].includes(u.id)) {
        const std = CUP_STANDARDS[ctx.cupStandard] || CUP_STANDARDS[DEFAULT_CUP_STANDARD];
        const ml = u.id === 'volume.cup' ? std.cupMl : u.id === 'volume.tbsp' ? std.tbspMl : std.tspMl;
        flags.push({ code: 'regional-variant', message: `Regional variant: using the ${std.label} standard (1 ${u.name} = ${ml} ml).` });
        conf = 'medium';
      } else if (u.ambiguity && !(match.kind === 'symbol' && /[°º]/.test(text) && u.group === 'temperature') && !['length.inch', 'length.foot', 'length.metre', 'mass.tonne', 'mass.ounce'].includes(u.id) && u.id !== 'angle.degree') {
        if (!flags.length) { flags.push({ code: 'ambiguous-unit', message: u.ambiguity }); conf = lowest(conf, 'medium'); }
      }
    }
  }
  return { id, flags, conf };
}

function pushQuoteFlags(flags, matchText, unitId, pairedCompound, nextText) {
  if (unitId === 'length.inch' || unitId === 'length.foot') {
    if (matchText === '"' || matchText === "'" || matchText === '”' || matchText === '’') {
      if (!pairedCompound) flags.push({ code: 'ambiguous-unit', message: `A straight ${matchText === '"' || matchText === '”' ? 'double' : 'single'} quote mark may be a quotation mark rather than ${unitId === 'length.inch' ? 'inches' : 'feet'}.` });
    }
    if (matchText === 'in' && STOPWORDS_AFTER_IN.test(nextText || '')) flags.push({ code: 'ambiguous-unit', message: '"in" here may be the word "in", not inches.' });
  }
}

// ── Core line scan ────────────────────────────────────────────────────────────
function segConf(line, start, end) {
  if (!line.segs) return null;
  let min = null;
  for (const s of line.segs) {
    if (s.end <= start || s.start >= end) continue;
    if (typeof s.conf === 'number') min = min === null ? s.conf : Math.min(min, s.conf);
  }
  return min;
}

function scanLine(line, lineIdx, pageIdx, ctx, ocr) {
  const text = line.text;
  const hits = [];
  const numRe = new RegExp((ocr ? NUM_RE_OCR : NUM_RE).source, 'g');
  const taken = []; // consumed ranges

  // Gas mark 4 / Gas 6 — number comes AFTER the words
  const gasRe = /\bgas\s*(?:mark\s*)?(\d+|[½¼])\b/gi;
  let gm;
  while ((gm = gasRe.exec(text))) {
    const val = gm[1] === '½' ? 0.5 : gm[1] === '¼' ? 0.25 : Number(gm[1]);
    hits.push(makeHit({ line, lineIdx, pageIdx, start: gm.index, end: gm.index + gm[0].length, kind: 'single', values: [val], unitIds: ['temperature.gasmark'], flags: [], conf: 'high', ocr, raw: gm[0] }));
    taken.push([gm.index, gm.index + gm[0].length]);
  }
  // 12° 30′ 15″ — degrees/minutes/seconds
  const dmsRe = /(\d+(?:\.\d+)?)\s*°\s*(\d+(?:\.\d+)?)\s*[′']\s*(?:(\d+(?:\.\d+)?)\s*[″"])?/g;
  let dm;
  while ((dm = dmsRe.exec(text))) {
    const parts = [Number(dm[1]), Number(dm[2]), dm[3] ? Number(dm[3]) : 0];
    hits.push(makeHit({ line, lineIdx, pageIdx, start: dm.index, end: dm.index + dm[0].length, kind: 'compound', values: parts, unitIds: ['angle.dms'], flags: [], conf: 'high', ocr, raw: dm[0] }));
    taken.push([dm.index, dm.index + dm[0].length]);
  }
  const isTaken = (a, b) => taken.some(([s, e]) => a < e && b > s);

  let m;
  while ((m = numRe.exec(text))) {
    const startIdx = m.index;
    if (isTaken(startIdx, startIdx + m[0].length)) continue;
    if (ocr && !/\d/.test(m[0])) continue;

    // 1. read elements: number [unit] ( × number [unit] )*
    const elems = [];
    let pos = startIdx;
    for (;;) {
      const n = readNumber(text, pos, ocr);
      if (!n) break;
      const el = { num: n, unit: null };
      let p = skipSpaces(text, n.end);
      const um = matchUnit(text, p);
      if (um) { el.unit = { match: um, start: p, end: p + um.len }; p += um.len; } else p = n.end;
      el.end = p;
      elems.push(el);
      DIM_SEP.lastIndex = p;
      const ds = DIM_SEP.exec(text);
      if (!ds) break;
      pos = p + ds[0].length;
    }
    if (!elems.length) continue;
    let kind = elems.length > 1 ? 'dimension' : 'single';

    // 2. range: a – b unit
    if (elems.length === 1) {
      RANGE_SEP.lastIndex = elems[0].end;
      const rs = RANGE_SEP.exec(text);
      if (rs) {
        const n2 = readNumber(text, elems[0].end + rs[0].length, ocr);
        if (n2) {
          const el2 = { num: n2, unit: null };
          let p2 = skipSpaces(text, n2.end);
          const um2 = matchUnit(text, p2);
          if (um2) { el2.unit = { match: um2, start: p2, end: p2 + um2.len }; p2 += um2.len; } else p2 = n2.end;
          el2.end = p2;
          // a range only counts when a unit is present
          if (el2.unit || elems[0].unit) { elems.push(el2); kind = 'range'; }
        }
      }
    }

    // 3. compound: 5 ft 11 in / 10 st 4 lb / 1 h 30 min (single elements only)
    let compound = null;
    if (kind === 'single' && elems[0].unit) {
      const u1 = resolveUnitIdForCompound(elems[0].unit.match);
      const nextSpec = u1 && COMPOUND_NEXT[u1];
      if (nextSpec) {
        const n2 = readNumber(text, skipSpaces(text, elems[0].unit.end), ocr);
        if (n2) {
          const p2 = skipSpaces(text, n2.end);
          const um2 = matchUnit(text, p2);
          const u2 = um2 && resolveUnitIdForCompound(um2);
          if (u2 === nextSpec[1]) compound = { n2, um2, end: p2 + um2.len, id: nextSpec[0] };
        }
      }
    }

    // 4. assemble
    const last = elems[elems.length - 1];
    const spanEnd = compound ? compound.end : last.end;
    const sharedUnit = [...elems].reverse().find((e) => e.unit)?.unit || null;

    // bare "°" (no C/F): ambiguous between temperature and angle, never guessed
    const firstUnitText = elems[0].unit?.match.text ?? sharedUnit?.match.text;
    if (kind === 'single' && elems[0].unit && /^[°º]$/.test(elems[0].unit.match.text.replace(/\s+/g, ''))) {
      const val = readValue(elems[0].num, ctx);
      const flags = [...elems[0].num.flags, { code: 'degree-ambiguous', message: 'A ° with no C or F could be an angle or a temperature — choose the unit.' }];
      if (ctx.context === 'building') {
        hits.push(makeHit({ line, lineIdx, pageIdx, start: startIdx, end: elems[0].end, kind, values: [val.value], unitIds: ['angle.degree'], flags: [...flags, ...val.flags], conf: 'medium', ocr, raw: text.slice(startIdx, elems[0].end) }));
      } else {
        hits.push(makeHit({ line, lineIdx, pageIdx, start: startIdx, end: elems[0].end, kind, values: [val.value], unitIds: [null], flags: [...flags, ...val.flags], conf: 'low', ocr, raw: text.slice(startIdx, elems[0].end) }));
      }
      numRe.lastIndex = elems[0].end;
      continue;
    }

    if (!sharedUnit) { // no unit anywhere: not a measurement (table headers are handled elsewhere)
      numRe.lastIndex = Math.max(numRe.lastIndex, elems[0].num.end);
      continue;
    }

    let flags = [];
    let conf = 'high';
    const values = [];
    const unitIds = [];
    if (compound) {
      const v1 = readValue(elems[0].num, ctx);
      const v2 = readValue(compound.n2, ctx);
      values.push(v1.value, v2.value);
      unitIds.push(compound.id);
      flags.push(...v1.flags, ...v2.flags, ...elems[0].num.flags, ...compound.n2.flags);
      const quoteStyle = /^['′’]$/.test(elems[0].unit.match.text) || /^["″”]$/.test(compound.um2.text);
      const r1 = resolveUnit(elems[0].unit.match, ctx, text, elems[0].unit.end, startIdx);
      conf = lowest(conf, r1.conf);
      if (!quoteStyle) flags.push(...r1.flags);
      else if (/^['’]$/.test(elems[0].unit.match.text) || /^["”]$/.test(compound.um2.text)) { /* paired feet+inches: unambiguous */ }
      if (compound.n2.flags.length || elems[0].num.flags.length) conf = lowest(conf, 'medium');
    } else {
      const paired = elems.filter((e) => e.unit).length;
      for (const el of elems) {
        const v = readValue(el.num, ctx);
        values.push(v.value);
        flags.push(...v.flags, ...el.num.flags);
        if (v.flags.length || el.num.flags.length) conf = lowest(conf, 'medium');
        const uSrc = el.unit || sharedUnit;
        const r = resolveUnit(uSrc.match, ctx, text, uSrc.end, startIdx);
        unitIds.push(r.id);
        if (el.unit || el === last) {
          conf = lowest(conf, r.conf);
          for (const f of r.flags) if (!flags.some((x) => x.message === f.message)) flags.push(f);
          const nextText = text.slice(uSrc.end).trimStart();
          const extra = [];
          pushQuoteFlags(extra, uSrc.match.text, r.id, paired > 1 && kind === 'dimension' && /['"′″]/.test(uSrc.match.text), nextText);
          for (const f of extra) if (!flags.some((x) => x.message === f.message)) { flags.push(f); conf = lowest(conf, 'medium'); }
        }
      }
    }

    // separators / OCR confidence
    const oc = ocr ? segConf(line, startIdx, spanEnd) : null;
    const hit = makeHit({ line, lineIdx, pageIdx, start: startIdx, end: spanEnd, kind: compound ? 'compound' : kind, values, unitIds, flags, conf, ocr, raw: text.slice(startIdx, spanEnd), ocrConf: oc });
    if (hit.unitIds.every((x) => x === null)) hit.confidence = 'low';
    hits.push(hit);
    numRe.lastIndex = spanEnd;
  }
  return hits;
}

function resolveUnitIdForCompound(match) {
  if (!match || !match.ids) return null;
  if (match.ids.includes('length.foot')) return 'length.foot';
  if (match.ids.includes('length.inch')) return 'length.inch';
  if (match.ids.includes('mass.stone')) return 'mass.stone';
  if (match.ids.includes('mass.pound')) return 'mass.pound';
  if (match.ids.includes('time.hour')) return 'time.hour';
  if (match.ids.includes('time.minute')) return 'time.minute';
  return null;
}

function readValue(n, ctx) {
  const p = parseNumeric(n.text, { decimalComma: ctx.decimalComma === true ? true : ctx.decimalComma === 'uncertain' ? 'auto-uncertain' : false });
  const flags = [];
  if (!p) return { value: NaN, flags: [{ code: 'unreadable-number', message: `Could not read "${n.raw}" as a number.` }] };
  if (p.flags.includes('decimal-comma')) flags.push({ code: 'decimal-comma', message: `"${n.raw}" read with a decimal comma (${p.value}). If it is a thousands separator, edit the value.` });
  if (p.flags.includes('separator-uncertain')) flags.push({ code: 'separator-uncertain', message: `"${n.raw}" could be one thousand-style number or a decimal comma — read as ${p.value}.` });
  return { value: p.value, flags };
}

let HIT_SEQ = 0;
function makeHit({ line, lineIdx, pageIdx, start, end, kind, values, unitIds, flags, conf, ocr, raw, ocrConf }) {
  let confidence = conf;
  const oc = ocrConf ?? (ocr ? segConf(line, start, end) : null);
  if (oc !== null && oc !== undefined) {
    if (oc < 60) { confidence = lowest(confidence, 'low'); flags.push({ code: 'low-ocr', message: `Low OCR confidence (${Math.round(oc)}%) — check the number against the image.` }); }
    else if (oc < 80) { confidence = lowest(confidence, 'medium'); flags.push({ code: 'low-ocr', message: `Moderate OCR confidence (${Math.round(oc)}%).` }); }
  }
  if (flags.some((f) => f.code === 'ocr-digit-fix')) confidence = lowest(confidence, 'medium');
  if (flags.some((f) => f.code === 'degree-ambiguous') && !unitIds.every((x) => x === 'angle.degree')) confidence = 'low';
  const first = unitIds.find(Boolean);
  const unit = first ? getUnit(first) : null;
  HIT_SEQ += 1;
  return {
    id: `h${pageIdx}-${lineIdx}-${start}-${HIT_SEQ}`,
    page: pageIdx, line: lineIdx, start, end, raw,
    before: line.text.slice(Math.max(0, start - 40), start),
    after: line.text.slice(end, end + 40),
    kind, values, unitIds,
    groupId: unit ? unit.group : null,
    confidence, ocrConf: oc ?? null, flags: dedupeFlags(flags),
    fromHeader: false,
  };
}
const dedupeFlags = (flags) => flags.filter((f, i) => flags.findIndex((g) => g.message === f.message) === i);

// ── Tables: unit only in the column header ("Width (mm)") ─────────────────────
const CELL_SPLIT = /\t| {2,}/;
const BARE_NUM_CELL = new RegExp(String.raw`^[-−]?(?:${NUMBER_SRC})$`);
function headerUnit(cell, ctx) {
  const m = cell.match(/\(([^)]{1,24})\)\s*$|\[([^\]]{1,24})\]\s*$|,\s*([^,]{1,16})$/);
  if (!m) return null;
  const t = (m[1] || m[2] || m[3]).trim();
  const probe = `1 ${t}`;
  const um = matchUnit(probe, 2);
  if (!um || um.len !== t.length) return null;
  const r = resolveUnit(um, { ...ctx, context: ctx.context }, probe, 2 + um.len, 0);
  return r.id ? { id: r.id, flags: r.flags } : null;
}

function scanTables(lines, pageIdx, ctx, ocr) {
  const hits = [];
  for (let i = 0; i < lines.length; i += 1) {
    const cells = splitCells(lines[i].text);
    if (cells.length < 2) continue;
    const units = cells.map((c) => headerUnit(c.text, ctx));
    if (!units.some(Boolean)) continue;
    let rows = 0;
    for (let r = i + 1; r < lines.length; r += 1) {
      const rc = splitCells(lines[r].text);
      const numeric = rc.filter((c) => BARE_NUM_CELL.test(c.text));
      if (rc.length < 2 || !numeric.length) break;
      rc.forEach((c, ci) => {
        const hu = units[ci];
        if (!hu || !BARE_NUM_CELL.test(c.text)) return;
        const val = readValue({ raw: c.text, text: c.text, flags: [] }, ctx);
        const flags = [{ code: 'column-header', message: `Unit taken from the column header: "${cells[ci].text}".` }, ...hu.flags, ...val.flags];
        const hit = makeHit({ line: lines[r], lineIdx: r, pageIdx, start: c.start, end: c.end, kind: 'single', values: [val.value], unitIds: [hu.id], flags, conf: 'medium', ocr, raw: c.text });
        hit.fromHeader = true;
        hits.push(hit);
      });
      rows += 1;
    }
    i += rows;
  }
  return hits;
}

function splitCells(text) {
  const cells = [];
  const re = /[^\t ]+(?: [^\t ]+)*/g;
  let m;
  while ((m = re.exec(text))) {
    // keep cells separated by 2+ spaces or tabs; the regex above already splits on those
    cells.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return cells;
}

// ── Document-level separator analysis ─────────────────────────────────────────
export function analyzeSeparators(allText) {
  const dec = (allText.match(/(?<![\d,.])\d+,\d{1,2}(?![\d,])/g) || []).length;
  const thou = (allText.match(/(?<![\d,.])\d{1,3}(?:,\d{3})+(?![\d,])/g) || []).length;
  if (dec > thou && dec >= 2) return true; // document uses decimal commas
  if (dec > 0 && thou > 0) return 'uncertain';
  return false;
}

// ── Public scanning API ───────────────────────────────────────────────────────
export function scanLines(lines, opts = {}, pageIdx = 0) {
  const ctx = { context: 'general', region: 'imperial', cupStandard: DEFAULT_CUP_STANDARD, decimalComma: false, ...opts };
  const ocr = !!opts.ocr;
  const hits = [];
  lines.forEach((line, i) => hits.push(...scanLine(line, i, pageIdx, ctx, ocr)));
  const tableHits = scanTables(lines, pageIdx, ctx, ocr);
  for (const th of tableHits) {
    if (!hits.some((h) => h.line === th.line && h.start < th.end && h.end > th.start)) hits.push(th);
  }
  hits.sort((a, b) => a.line - b.line || a.start - b.start);
  return hits;
}

export function scanDocument(pages, opts = {}) {
  const all = pages.map((p) => p.lines.map((l) => l.text).join('\n')).join('\n');
  const decimalComma = analyzeSeparators(all);
  const lengthEvidence = /\d\s*(?:mm|cm|km|metres?|meters?|ft|feet|inch(?:es)?|yd|yards?)/i.test(all);
  const hits = [];
  pages.forEach((p, i) => hits.push(...scanLines(p.lines, { ...opts, ocr: !!p.ocr, decimalComma, lengthEvidence }, i)));
  return hits;
}

export function scanText(text, opts = {}) {
  const lines = String(text || '').split(/\r?\n/).map((t) => ({ text: t }));
  return scanDocument([{ lines, ocr: false }], opts);
}

// ── Conversion proposals ──────────────────────────────────────────────────────
export const DEFAULT_PREFS = {
  system: 'metric', // 'metric' | 'us' | 'imperial'
  perGroupSystem: {}, // groupId → system
  perGroupUnit: {}, // groupId → unit id
  cupStandard: DEFAULT_CUP_STANDARD,
  precision: { mode: 'sig', n: 4 },
};

/**
 * Propose a conversion. status: 'convert' | 'same' | 'none' | 'needs-unit'
 * returns { status, text, toId, note }
 */
export function proposeFor(hit, prefs = DEFAULT_PREFS) {
  const p = { ...DEFAULT_PREFS, ...prefs };
  const ctx = { cupStandard: p.cupStandard, tempMode: 'absolute' };
  if (!hit.unitIds.length || hit.unitIds.some((x) => !x)) return { status: 'needs-unit', text: '', note: 'Choose a unit to convert.' };
  if (hit.values.some((v) => !Number.isFinite(v))) return { status: 'needs-unit', text: '', note: 'Check the number.' };

  const groupId = getUnit(hit.unitIds[0]).group;
  const explicit = p.perGroupUnit?.[groupId];
  const system = p.perGroupSystem?.[groupId] || p.system;

  // compound hits (single compound unit with several parts)
  const srcUnits = hit.unitIds.map(getUnit);
  const compound = srcUnits[0].type === 'compound';
  const elems = compound ? [{ values: hit.values, unit: srcUnits[0] }] : hit.values.map((v, i) => ({ values: [v], unit: srcUnits[i] || srcUnits[srcUnits.length - 1] }));

  let toUnit = null;
  if (explicit && getUnit(explicit) && getUnit(explicit).group === groupId) toUnit = getUnit(explicit);
  else {
    if (srcUnits.every((u) => systemMatches(u, system) || (system === 'metric' && u.system === 'metric'))) {
      if (!srcUnits.some((u) => ['volume.cup', 'volume.tbsp', 'volume.tsp'].includes(u.id))) return { status: 'same', text: '', note: `Already ${system === 'metric' ? 'metric' : system === 'us' ? 'US' : 'imperial'}.` };
    }
    const key = system === 'us' && !SCAN_TARGETS[groupId]?.us ? 'imperial' : system;
    const list = SCAN_TARGETS[groupId]?.[key];
    if (!list) return { status: 'none', text: '', note: 'No conversion for this kind of measurement unless you choose a unit.' };
    const units = list.map((k) => getUnit(`${groupId}.${k}`));
    const bases = elems.map((e) => convertValues(e.unit.type === 'compound' ? e.values : e.values[0], e.unit.id, units[0].id, ctx).base);
    const driver = Math.min(...bases.map(Math.abs).filter((b) => b > 0), Infinity);
    toUnit = units[0];
    // choose the largest unit whose value for the smallest element is still ≥ 1
    if (Number.isFinite(driver)) {
      for (const u of units) {
        const val = Math.abs(u.fromBase(driver, ctx));
        if (val >= 1) toUnit = u;
      }
    }
    if (srcUnits.length === 1 && srcUnits[0].id === toUnit.id) return { status: 'same', text: '', note: 'Already in the target unit.' };
  }

  const results = elems.map((e) => convertValues(e.unit.type === 'compound' ? e.values : e.values[0], e.unit.id, toUnit.id, ctx).value);
  if (results.some((r) => !Number.isFinite(r))) return { status: 'none', text: '', note: 'This value cannot be converted.' };
  const sym = unitShort(toUnit);
  const f = (x) => formatNumber(x, p.precision);
  let text;
  if (hit.kind === 'range') text = `${f(results[0])}–${f(results[1])} ${sym}`;
  else if (hit.kind === 'dimension') text = `${results.map(f).join(' × ')} ${sym}`;
  else text = `${f(results[0])} ${sym}`;
  const approx = toUnit.type === 'lookup' ? 'Nearest gas mark.' : '';
  return { status: 'convert', text, toId: toUnit.id, note: approx };
}

/** Text with accepted hits replaced. rows: [{ hit, proposal, status }] */
export function buildConvertedText(pages, rows, { keepOriginal = false } = {}) {
  const byPage = new Map();
  for (const r of rows) {
    if (r.status !== 'accepted' || r.proposal?.status !== 'convert') continue;
    const k = `${r.hit.page}:${r.hit.line}`;
    if (!byPage.has(k)) byPage.set(k, []);
    byPage.get(k).push(r);
  }
  return pages
    .map((pg, pi) => pg.lines.map((line, li) => {
      const list = (byPage.get(`${pi}:${li}`) || []).sort((a, b) => b.hit.start - a.hit.start);
      let t = line.text;
      for (const r of list) {
        const rep = keepOriginal ? `${r.hit.raw} (${r.proposal.text})` : r.proposal.text;
        t = t.slice(0, r.hit.start) + rep + t.slice(r.hit.end);
      }
      return t;
    }).join('\n'))
    .join('\n\n');
}

export { partLabel };
