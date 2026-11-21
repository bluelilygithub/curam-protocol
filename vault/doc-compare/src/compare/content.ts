import { diffWordsWithSpace } from 'diff';
import type { Block } from '../readers/types';
import type { Change, Edit } from '../report/model';
import { SEVERITY } from '../report/severity';
import type { TrivialRules } from '../settings';
import type { AlignOp } from './align';
import { numberLabel } from '../checks/numbering';
import { compareFormatting } from './formatting';
import { ALL_RULES, normalize } from './normalize';
import { levenshtein, truncate, words, wordDice } from './textSim';

export type NewChange = Omit<Change, 'id' | 'children'> & { children?: NewChange[] };

const FORMAT_MIN_SIM = 0.9;

/** Short fingerprint of a text after trivial differences are removed (FNV-1a). */
export function fingerprint(s: string): string {
  const t = normalize(s, ALL_RULES).toLowerCase().replace(/\s+/g, ' ').trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

/**
 * For an edited block, the id of the nearest original block before it (null: at the start). Added text is anchored there, so the same
 * addition in a later round of a project gets the same identity (addendum §7.5).
 */
export function precedingOriginal(ops: AlignOp[]): (b: Block) => string | null {
  const byB = new Map<number, string>();
  for (const o of ops) if ('a' in o && 'b' in o) byB.set(o.b.location.index, o.a.id);
  return (b) => { for (let i = b.location.index - 1; i >= 0; i--) { const id = byB.get(i); if (id) return id; } return null; };
}
export const addedAnchor = (after: string | null, b: Block) => `+${after ?? '^'}:${fingerprint(b.text)}`;
/** Blocks as they go into the accepted state: an edited block keeps the original's id; an added one is named after its anchor. */
const asInserted = (blocks: Block[], anchor: string): Block[] => blocks.map((b, k) => ({ ...b, id: `${anchor}#${k}` })); // formatting is compared on blocks whose text is equal or nearly equal

export function locate(b: Block, edited = false): string {
  const l = b.location;
  const parts: string[] = [];
  if (l.page) parts.push(`Page ${l.page}`);
  if (l.table) parts.push(`Table ${l.table.t + 1}, row ${l.table.r + 1}, col ${l.table.c + 1}`);
  else if (b.type === 'heading') parts.push(`Heading "${truncate(b.text.trim(), 50)}"`);
  else if (b.type === 'pageBreak') parts.push(l.section ? `${truncate(l.section, 50)}, page break` : 'Page break');
  else parts.push(l.section ? `${truncate(l.section, 50)}, para ${l.para}` : `Para ${l.para ?? l.index + 1}`);
  return parts.join(' · ') + (edited ? ' (edited)' : '');
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Word diff of two texts, classified as number / typo / wording, with escaped inline HTML for the detail view. */
export function classify(na: string, nb: string): { category: Change['category']; severity: Change['severity']; detail: string; diffHtml: string } {
  let html = '';
  const hunks: { del: string; ins: string }[] = [];
  let cur: { del: string; ins: string } | undefined;
  for (const p of diffWordsWithSpace(na, nb)) {
    if (p.added || p.removed) {
      cur ??= { del: '', ins: '' };
      if (p.removed) { cur.del += p.value; html += `<del>${esc(p.value)}</del>`; }
      else { cur.ins += p.value; html += `<ins>${esc(p.value)}</ins>`; }
    } else {
      if (cur) { hunks.push(cur); cur = undefined; }
      html += esc(p.value);
    }
  }
  if (cur) hunks.push(cur);
  const real = hunks.filter((h) => h.del.trim() || h.ins.trim());
  const pair = (h: { del: string; ins: string }) => `"${truncate(h.del.trim(), 40) || '∅'}" → "${truncate(h.ins.trim(), 40) || '∅'}"`;

  // a figure that was changed or removed; a figure only inserted is a new claim (addendum §4, checks/claims.ts), not a number change
  const numeric = real.filter((h) => /\d/.test(h.del));
  if (numeric.length) return { category: 'number', severity: SEVERITY.number, detail: numeric.slice(0, 3).map(pair).join('; ') + (numeric.length > 3 ? ` and ${numeric.length - 3} more` : ''), diffHtml: html };

  if (real.length === 1) {
    const d = real[0].del.trim(), i = real[0].ins.trim();
    if (d && i && !/\s/.test(d) && !/\s/.test(i) && levenshtein(d, i) <= 2) return { category: 'typo', severity: SEVERITY.typo, detail: pair(real[0]), diffHtml: html };
  }
  const delWords = real.reduce((s, h) => s + words(h.del).length, 0);
  const insWords = real.reduce((s, h) => s + words(h.ins).length, 0);
  // an LLM dropping a sentence inside a paragraph is "removed content", even though the paragraph itself survived
  const dropped = delWords >= Math.max(8, words(na).length * 0.25) && delWords > insWords * 2;
  return {
    category: 'wording',
    severity: dropped ? SEVERITY.removed : SEVERITY.wording,
    detail: `${real.length} change${real.length === 1 ? '' : 's'}: ${delWords} word${delWords === 1 ? '' : 's'} removed, ${insWords} added${dropped ? ' — content dropped' : ''}`,
    diffHtml: html,
  };
}

function removedOrAdded(b: Block, removed: boolean): NewChange {
  if (b.type === 'pageBreak') return { category: 'formatting', severity: SEVERITY.structure, location: locate(b, !removed), detail: `Page break ${removed ? 'removed' : 'added'}` };
  if (b.type === 'image') return { category: removed ? 'removed' : 'added', severity: removed ? SEVERITY.removed : SEVERITY.added, location: locate(b, !removed), detail: `Image ${removed ? 'removed' : 'added'}` };
  return { category: removed ? 'removed' : 'added', severity: removed ? SEVERITY.removed : SEVERITY.added, location: locate(b, !removed), [removed ? 'original' : 'edited']: b.text, detail: b.type === 'heading' ? `Heading ${removed ? 'removed' : 'added'}` : undefined };
}

/** Turns aligned blocks into changes. Returns the trivial count separately (trivial changes are included, flagged). */
export function compareContent(ops: AlignOp[], rules: TrivialRules): { changes: NewChange[]; trivialCount: number } {
  const changes: NewChange[] = [];
  let trivialCount = 0;
  const before = precedingOriginal(ops);
  // removed: anchored on the original block; added: on the original block before it
  const placed = (c: NewChange, blocks: Block[], removed: boolean): NewChange => {
    if (removed) return { ...c, anchor: blocks[0].id, edit: { remove: blocks.map((x) => x.id) } };
    const anchor = addedAnchor(before(blocks[0]), blocks[0]);
    return { ...c, anchor, edit: { insert: { after: before(blocks[0]), blocks: asInserted(blocks, anchor) } } };
  };

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.kind === 'removed' || op.kind === 'added') {
      const removed = op.kind === 'removed';
      const blk = removed ? op.a : op.b;
      const same = (o: AlignOp) => o.kind === op.kind;
      const get = (o: AlignOp) => (removed ? (o as { a: Block }).a : (o as { b: Block }).b);

      // a heading plus everything under it removed/added → one grouped change
      if (blk.type === 'heading') {
        let j = i + 1;
        while (j < ops.length && same(ops[j]) && !(get(ops[j]).type === 'heading' && (get(ops[j]).level ?? 9) <= (blk.level ?? 9))) j++;
        if (j > i + 1) {
          const kids = ops.slice(i, j).map((o) => removedOrAdded(get(o), removed));
          const n = j - i - 1;
          changes.push(placed({ category: removed ? 'removed' : 'added', severity: removed ? SEVERITY.removedSection : SEVERITY.addedSection, group: 'section', location: locate(blk, !removed), [removed ? 'original' : 'edited']: blk.text, detail: `Whole section ${removed ? 'removed' : 'added'}: heading + ${n} block${n === 1 ? '' : 's'}`, children: kids }, ops.slice(i, j).map(get), removed));
          i = j - 1;
          continue;
        }
      }
      // all cells of one table row removed/added → one change
      const t = blk.location.table;
      if (t) {
        let j = i + 1;
        while (j < ops.length && same(ops[j]) && get(ops[j]).location.table?.t === t.t && get(ops[j]).location.table?.r === t.r) j++;
        if (j > i + 1) {
          const cells = ops.slice(i, j).map(get);
          const text = cells.map((c) => c.text.trim()).join(' | ');
          changes.push(placed({ category: removed ? 'removed' : 'added', severity: removed ? SEVERITY.removedTableRow : SEVERITY.added, group: 'tableRow', location: `${blk.location.page ? `Page ${blk.location.page} · ` : ''}Table ${t.t + 1}, row ${t.r + 1}${removed ? '' : ' (edited)'}`, [removed ? 'original' : 'edited']: text, detail: `Table row ${removed ? 'removed' : 'added'} (${cells.length} cells)`, children: cells.map((c) => removedOrAdded(c, removed)) }, cells, removed));
          i = j - 1;
          continue;
        }
      }
      changes.push(placed(removedOrAdded(blk, removed), [blk], removed));
      continue;
    }

    if (op.kind === 'moved') {
      changes.push({ category: 'moved', severity: SEVERITY.moved, location: `${locate(op.a)} → ${locate(op.b)}`, original: op.a.text, edited: op.b.text, detail: 'Block moved', anchor: op.a.id, edit: { remove: [op.a.id], insert: { after: before(op.b), blocks: [{ ...op.b, id: op.a.id }] } } });
      continue;
    }

    // equal or modified pair
    const { a, b } = op;
    const replace: Edit = { replace: { id: a.id, block: { ...b, id: a.id } } };
    // a paragraph whose only change is its leading number ("3." -> "2.") is renumbering (checks/numbering.ts), not a changed figure
    const la = numberLabel(a.text), lb = numberLabel(b.text);
    const [ta, tb] = la.num && lb.num && la.num.kind === lb.num.kind ? [la.rest, lb.rest] : [a.text, b.text];
    const na = normalize(ta, rules), nb = normalize(tb, rules);
    if (na === nb) {
      if (ta !== tb) {
        trivialCount++;
        changes.push({ category: 'wording', severity: SEVERITY.trivial, trivial: true, location: locate(a), original: a.text, edited: b.text, detail: 'Only whitespace, quotes, dashes or invisible characters differ', diffHtml: classify(a.text, b.text).diffHtml, anchor: a.id, edit: replace });
      }
    } else {
      const c = classify(na, nb);
      changes.push({ ...c, location: locate(a), original: a.text, edited: b.text, anchor: a.id, edit: replace });
    }

    if (op.kind === 'equal' || wordDice(na, nb) >= FORMAT_MIN_SIM) {
      const f = compareFormatting(a, b);
      if (f.structural.length || f.inline.length) {
        changes.push({ category: 'formatting', severity: f.structural.length ? SEVERITY.structure : SEVERITY.inlineFormat, location: locate(a), original: truncate(a.text, 300), edited: truncate(b.text, 300), detail: [...f.structural, ...f.inline].join('; '), anchor: a.id, edit: replace });
      }
    }
  }
  return { changes, trivialCount };
}
