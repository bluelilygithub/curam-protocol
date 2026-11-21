import type { NewChange } from '../compare/content';
import { locate } from '../compare/content';
import type { PostCheck } from '../compare/postChecks';
import type { Block, NormalizedDoc } from '../readers/types';
import { SEVERITY } from '../report/severity';
import { referenceBlockIds } from './docText';

/**
 * Numbered paragraphs, headings, figures and tables (addendum §5.3). Numbers come from DOCX automatic numbering and Markdown ordered lists
 * (Block.number), or from the text: "1.", "2.3", "(a)", "(iv)", "[3]" at the start, and "Figure 2" / "Table 3" captions.
 *   amber  a gap, a duplicate or a restart that the original did not have
 *   amber  paragraphs whose number differs from their original paragraph's (one grouped change)
 */

export type NumKind = 'decimal' | 'alpha' | 'roman' | 'bracket' | 'figure' | 'table';
export interface Num { kind: NumKind; label: string; parts: number[] }

const FIGURE_RE = /^(Figure|Fig\.|Chart|Diagram|Table|Box)\s+(\d{1,3}(?:\.\d{1,3})?)\b/;
const romanValue = (s: string) => { const v: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 }; let n = 0; for (let i = 0; i < s.length; i++) { const c = v[s[i]], d = v[s[i + 1]] ?? 0; n += c < d ? -c : c; } return n; };

/** The number at the start of a paragraph's text, and the text after it. Years ("2023 was…") are not numbers: parts are 1-3 digits. */
export function numberLabel(text: string): { num?: Num; rest: string } {
  const t = text.trimStart();
  const f = FIGURE_RE.exec(t);
  if (f) return { num: { kind: /table/i.test(f[1]) ? 'table' : 'figure', label: `${f[1]} ${f[2]}`, parts: f[2].split('.').map(Number) }, rest: `${f[1]} ${t.slice(f[0].length)}` };
  let m = /^(\d{1,3}(?:\.\d{1,3})*)(?:[.)]\s+|\s+(?=[A-Z]))/.exec(t);
  if (m) return { num: { kind: 'decimal', label: m[1], parts: m[1].split('.').map(Number) }, rest: t.slice(m[0].length) };
  m = /^\(([ivxlc]{1,6}|[a-z])\)\s+/.exec(t);
  if (m) {
    const r = /^[ivxlc]+$/.test(m[1]) && (m[1].length > 1 || m[1] === 'i');
    return { num: r ? { kind: 'roman', label: `(${m[1]})`, parts: [romanValue(m[1])] } : { kind: 'alpha', label: `(${m[1]})`, parts: [m[1].charCodeAt(0) - 96] }, rest: t.slice(m[0].length) };
  }
  m = /^\[(\d{1,3})\]\s+/.exec(t);
  if (m) return { num: { kind: 'bracket', label: `[${m[1]}]`, parts: [Number(m[1])] }, rest: t.slice(m[0].length) };
  return { rest: text };
}

/** A block's number: automatic numbering first, then the start of its text, then a figure or table caption. */
export function numberOf(b: Block): Num | undefined {
  if (b.number) {
    const n = numberLabel(`${b.number} x`).num;
    if (n) return n;
    const letter = /^\(?([a-z])[.)]/i.exec(b.number);
    if (letter) return { kind: 'alpha', label: b.number, parts: [letter[1].toLowerCase().charCodeAt(0) - 96] };
  }
  if (b.type === 'tableCell') return undefined;
  return numberLabel(b.text).num;
}

export interface NumIssue { key: string; type: 'gap' | 'duplicate' | 'restart'; block: Block; detail: string }

/** Gaps, duplicates and restarts. Lists start again under each heading; heading, figure and table numbers run through the document. */
export function numberingIssues(d: NormalizedDoc): NumIssue[] {
  const refs = referenceBlockIds(d);
  const seqs = new Map<string, { prev: number; restarts: number }>();
  const out: NumIssue[] = [];
  for (const b of d.blocks) {
    if (b.type === 'heading') for (const k of [...seqs.keys()]) if (k.startsWith('list|')) seqs.delete(k);
    if (refs.has(b.id)) continue;
    const n = numberOf(b);
    if (!n) continue;
    const whole = n.kind === 'figure' || n.kind === 'table' || b.type === 'heading';
    // headings go by the depth of their number (1, 1.2), not their style level, so a heading moved to another level keeps its place
    const depth = b.type === 'heading' ? n.parts.length : (b.level ?? 0);
    const key = `${whole ? 'doc' : 'list'}|${n.kind}|${b.type}|${depth}|${n.parts.slice(0, -1).join('.')}`;
    const cur = n.parts[n.parts.length - 1];
    const s = seqs.get(key) ?? { prev: 0, restarts: 0 };
    const name = n.kind === 'figure' || n.kind === 'table' ? n.label : `number ${n.label}`;
    if (cur === s.prev) out.push({ key: `dup|${key}|${cur}`, type: 'duplicate', block: b, detail: `Numbering repeats: ${name} is used twice` });
    else if (cur > s.prev + 1 && !(s.prev === 0 && !whole)) out.push({ key: `gap|${key}|${s.prev}|${cur}`, type: 'gap', block: b, detail: s.prev ? `Numbering gap: ${name} follows ${s.prev}` : `Numbering starts at ${name}` });
    else if (cur < s.prev) out.push({ key: `restart|${key}|${++s.restarts}`, type: 'restart', block: b, detail: `Numbering goes back: ${name} follows ${s.prev}` });
    s.prev = cur;
    seqs.set(key, s);
  }
  return out;
}

export const numbering: PostCheck = (a, b, ops) => {
  const out: NewChange[] = [];
  const refs = new Set([...referenceBlockIds(a), ...referenceBlockIds(b)]); // reference numbers: checks/references.ts
  const before = new Set(numberingIssues(a).map((i) => i.key));
  for (const i of numberingIssues(b)) {
    if (before.has(i.key)) continue;
    out.push({ category: 'numbering', severity: SEVERITY.numbering, location: locate(i.block, true), edited: i.block.text, detail: i.detail });
  }
  // the same paragraph with a different number: one grouped change, one child per paragraph
  const kids: NewChange[] = [];
  for (const op of ops) {
    if (op.kind === 'removed' || op.kind === 'added' || refs.has(op.a.id) || refs.has(op.b.id)) continue;
    const na = numberOf(op.a), nb = numberOf(op.b);
    if (!na || !nb || na.kind !== nb.kind || na.label === nb.label) continue;
    kids.push({ category: 'numbering', severity: SEVERITY.numbering, location: locate(op.b, true), original: op.a.text, edited: op.b.text, detail: `Renumbered: ${na.label} → ${nb.label}` });
  }
  if (kids.length) {
    const first = kids.slice(0, 3).map((k) => k.detail!.replace(/^Renumbered: /, '')).join(', ');
    out.push({ category: 'numbering', severity: SEVERITY.numbering, location: kids[0].location, detail: `Renumbered: ${kids.length} paragraph${kids.length === 1 ? '' : 's'} (${first}${kids.length > 3 ? ', …' : ''})`, children: kids });
  }
  return out;
};
