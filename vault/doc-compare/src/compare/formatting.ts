import type { Block, NormalizedDoc, Run } from '../readers/types';
import { mapQuotes } from './normalize';

const BOOL_KEYS = ['bold', 'italic', 'underline', 'strike'] as const;
// undefined means "reader couldn't tell" for these, so a side without a value is skipped
const VALUE_KEYS = ['font', 'sizePt', 'color'] as const;
// undefined means "none" for these
const NONE_KEYS = ['style', 'link'] as const;
type Key = (typeof BOOL_KEYS)[number] | (typeof VALUE_KEYS)[number] | (typeof NONE_KEYS)[number];
const KEY_LABEL: Record<Key, string> = { bold: 'bold', italic: 'italic', underline: 'underline', strike: 'strikethrough', font: 'font', sizePt: 'size', color: 'colour', style: 'character style', link: 'link' };

export function blockLabel(b: Block): string {
  switch (b.type) {
    case 'heading': return `Heading ${b.level ?? '?'}`;
    case 'listItem': return `${b.style && /list/.test(b.style) ? b.style.replace(/^./, (c) => c.toUpperCase()) : 'List item'} level ${b.level ?? 1}`;
    case 'tableCell': return 'Table cell';
    case 'paragraph': return 'Paragraph';
    case 'other': return b.style ? b.style.replace(/^code/, 'Code block') : 'Other';
    default: return b.type;
  }
}

/** Visible characters (whitespace dropped, quotes/dashes folded) with each one's run and raw position, so runs split differently still line up. */
function charMap(runs: Run[]) {
  let chars = '';
  const fmt: Run[] = [];
  const raw: number[] = [];
  let pos = 0;
  for (const r of runs) {
    const folded = mapQuotes(r.text.normalize('NFC'));
    for (let i = 0; i < folded.length; i++) {
      const ch = folded[i];
      if (!/[\s​-‍﻿­]/.test(ch)) { chars += ch; fmt.push(r); raw.push(pos + i); }
    }
    pos += folded.length;
  }
  return { chars, fmt, raw, text: runs.map((r) => mapQuotes(r.text.normalize('NFC'))).join('') };
}

const val = (r: Run, k: Key) => (BOOL_KEYS as readonly string[]).includes(k) ? !!r[k] : r[k];
const show = (k: Key, v: unknown) => (v === undefined || v === '' ? 'none' : k === 'sizePt' ? `${v}pt` : k === 'color' ? `#${v}` : String(v));

export interface FormatDiff { structural: string[]; inline: string[] }

/** Formatting differences between two blocks whose text is equal or nearly equal. */
export function compareFormatting(a: Block, b: Block): FormatDiff {
  const structural: string[] = [];
  const inline: string[] = [];
  const la = blockLabel(a), lb = blockLabel(b);
  if (la !== lb) structural.push(`${la} → ${lb}`);
  else if (a.style !== undefined && b.style !== undefined && a.style !== b.style) inline.push(`paragraph style ${a.style} → ${b.style}`);

  const ma = charMap(a.runs), mb = charMap(b.runs);
  if (!ma.chars.length || !mb.chars.length) return { structural, inline };
  const keys: Key[] = [...BOOL_KEYS, ...VALUE_KEYS, ...NONE_KEYS];
  if (ma.chars === mb.chars) {
    for (const k of keys) {
      // ranges of consecutive characters where this attribute differs
      let start = -1;
      const ranges: [number, number, unknown, unknown][] = [];
      for (let i = 0; i <= ma.chars.length; i++) {
        let diff = false;
        if (i < ma.chars.length) {
          const va = val(ma.fmt[i], k), vb = val(mb.fmt[i], k);
          const skip = (VALUE_KEYS as readonly string[]).includes(k) && (va === undefined || vb === undefined);
          diff = !skip && va !== vb;
        }
        if (diff && start < 0) start = i;
        else if (!diff && start >= 0) { ranges.push([start, i - 1, val(ma.fmt[start], k), val(mb.fmt[start], k)]); start = -1; }
      }
      if (!ranges.length) continue;
      const whole = ranges.length === 1 && ranges[0][0] === 0 && ranges[0][1] === ma.chars.length - 1;
      const [s, e, va, vb] = ranges[0];
      const sample = ma.text.slice(ma.raw[s], ma.raw[e] + 1);
      const where = whole ? 'whole block' : `"${sample.length > 60 ? `${sample.slice(0, 59)}…` : sample}"${ranges.length > 1 ? ` and ${ranges.length - 1} more place${ranges.length > 2 ? 's' : ''}` : ''}`;
      const what = (BOOL_KEYS as readonly string[]).includes(k) ? `${KEY_LABEL[k]} ${va ? 'removed' : 'added'}` : `${KEY_LABEL[k]} ${show(k, va)} → ${show(k, vb)}`;
      inline.push(`${what} (${where})`);
    }
  } else {
    // text differs slightly: compare the value covering most characters
    for (const k of keys) {
      const da = dominant(ma.fmt, k), db = dominant(mb.fmt, k);
      if ((VALUE_KEYS as readonly string[]).includes(k) && (da === undefined || db === undefined)) continue;
      if (da !== db) inline.push((BOOL_KEYS as readonly string[]).includes(k) ? `${KEY_LABEL[k]} ${da ? 'removed' : 'added'} (most of the block)` : `${KEY_LABEL[k]} ${show(k, da)} → ${show(k, db)} (most of the block)`);
    }
  }
  return { structural, inline };
}

function dominant(fmt: Run[], k: Key): unknown {
  const counts = new Map<unknown, number>();
  for (const r of fmt) counts.set(val(r, k), (counts.get(val(r, k)) ?? 0) + 1);
  return [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
}

/** Table column-count changes (removed/added rows are reported as content). Tables are matched by position. */
export function compareTableShapes(a: NormalizedDoc, b: NormalizedDoc): { table: number; from: string; to: string }[] {
  const shape = (d: NormalizedDoc) => {
    const m = new Map<number, { r: number; c: number }>();
    for (const bl of d.blocks) {
      const t = bl.location.table; if (!t) continue;
      const s = m.get(t.t) ?? { r: 0, c: 0 };
      m.set(t.t, { r: Math.max(s.r, t.r + 1), c: Math.max(s.c, t.c + 1) });
    }
    return m;
  };
  const sa = shape(a), sb = shape(b);
  if (sa.size !== sb.size) return []; // a table was added/removed: content changes already say so
  const out: { table: number; from: string; to: string }[] = [];
  for (const [t, x] of sa) { const y = sb.get(t); if (y && x.c !== y.c) out.push({ table: t + 1, from: `${x.r} × ${x.c}`, to: `${y.r} × ${y.c}` }); }
  return out;
}
