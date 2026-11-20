import { diffArrays } from 'diff';
import type { Block } from '../readers/types';
import { ALL_RULES, normalize } from './normalize';
import { wordDice } from './textSim';

export type AlignOp =
  | { kind: 'equal'; a: Block; b: Block }
  | { kind: 'modified'; a: Block; b: Block; sim: number }
  | { kind: 'moved'; a: Block; b: Block }
  | { kind: 'removed'; a: Block }
  | { kind: 'added'; b: Block };

export const MODIFIED_MIN_SIM = 0.5;
const PAIR_WINDOW = 50; // how far ahead in a gap to look for a block's edited version

/**
 * Text after every trivial rule; blocks without text (images, page breaks) get a type marker so they still align,
 * and table cells carry their column so the same word in two columns ("Acme") can't cross-align rows.
 */
export const fingerprint = (b: Block) =>
  b.type === 'image' || b.type === 'pageBreak' ? `\u0000${b.type}`
    : b.location.table ? `\u0001${b.location.table.c}\u0001${normalize(b.text, ALL_RULES)}`
      : normalize(b.text, ALL_RULES);

/**
 * Aligns blocks: LCS over fingerprints gives the anchors; unmatched blocks between anchors are paired by fuzzy similarity
 * (in order); identical text removed in one place and added in another becomes one "moved".
 */
export function align(a: Block[], b: Block[]): AlignOp[] {
  const fa = a.map(fingerprint), fb = b.map(fingerprint);
  const ops: AlignOp[] = [];
  let ia = 0, ib = 0;
  let gapA: Block[] = [], gapB: Block[] = [];
  const flush = () => { pairGap(gapA, gapB, fa, fb, ops); gapA = []; gapB = []; };
  for (const part of diffArrays(fa, fb)) {
    const n = part.count ?? part.value.length;
    if (part.removed) { gapA.push(...a.slice(ia, ia + n)); ia += n; }
    else if (part.added) { gapB.push(...b.slice(ib, ib + n)); ib += n; }
    else { flush(); for (let k = 0; k < n; k++) ops.push({ kind: 'equal', a: a[ia + k], b: b[ib + k] }); ia += n; ib += n; }
  }
  flush();
  return detectMoves(ops, fa, fb);
}

function pairGap(ra: Block[], rb: Block[], fa: string[], fb: string[], ops: AlignOp[]): void {
  let j0 = 0;
  for (const blockA of ra) {
    const textA = fa[blockA.location.index];
    let best = -1, bestSim = 0;
    for (let j = j0; j < Math.min(rb.length, j0 + PAIR_WINDOW); j++) {
      if (isSpecial(blockA) !== isSpecial(rb[j])) continue;
      const s = wordDice(textA, fb[rb[j].location.index]);
      if (s >= MODIFIED_MIN_SIM && s > bestSim) { best = j; bestSim = s; }
    }
    if (best < 0) { ops.push({ kind: 'removed', a: blockA }); continue; }
    for (let j = j0; j < best; j++) ops.push({ kind: 'added', b: rb[j] });
    ops.push({ kind: 'modified', a: blockA, b: rb[best], sim: bestSim });
    j0 = best + 1;
  }
  for (let j = j0; j < rb.length; j++) ops.push({ kind: 'added', b: rb[j] });
}

const isSpecial = (b: Block) => b.type === 'image' || b.type === 'pageBreak';

function detectMoves(ops: AlignOp[], fa: string[], fb: string[]): AlignOp[] {
  const removedByFp = new Map<string, number[]>();
  ops.forEach((op, i) => {
    if (op.kind !== 'removed' || isSpecial(op.a)) return;
    const fp = fa[op.a.location.index];
    if (!fp) return;
    removedByFp.set(fp, [...(removedByFp.get(fp) ?? []), i]);
  });
  const drop = new Set<number>();
  ops.forEach((op, i) => {
    if (op.kind !== 'added' || isSpecial(op.b)) return;
    const queue = removedByFp.get(fb[op.b.location.index]);
    const ri = queue?.shift();
    if (ri === undefined) return;
    ops[ri] = { kind: 'moved', a: (ops[ri] as { a: Block }).a, b: op.b };
    drop.add(i);
  });
  return ops.filter((_, i) => !drop.has(i));
}
