import { countWords } from '../readers/finalize';
import type { Block, NormalizedDoc } from '../readers/types';
import type { Edit } from '../report/model';
import type { Project } from './model';

/**
 * The accepted state (addendum §7.3): the current original plus every change the person accepted since it became the original, applied in
 * the order the rounds came in. Derived, never stored, and rebuilt whenever a decision changes; the stored original is never edited.
 * Blocks keep the original's ids (inserted ones are named after their anchor), so later rounds anchor their changes to the same places.
 */

/** Section, position and counts again after blocks were removed, inserted or replaced (the same rules as readers/finalize.ts). */
export function relocate(doc: NormalizedDoc, blocks: Block[]): NormalizedDoc {
  let section: string | undefined;
  let para = 0, words = 0, chars = 0, headings = 0, images = 0;
  const out = blocks.map((b, index) => {
    if (b.type === 'heading') { section = b.text.trim().slice(0, 80) || section; para = 0; headings++; }
    else if (b.type !== 'pageBreak') para++;
    if (b.type === 'image') images++;
    words += countWords(b.text);
    chars += b.text.length;
    return { ...b, location: { ...b.location, index, section: b.type === 'heading' ? undefined : section, para: b.type === 'heading' ? undefined : para } };
  });
  return { ...doc, blocks: out, metadata: { ...doc.metadata, wordCount: words, charCount: chars, headingCount: headings, imageCount: images } };
}

export function applyEdits(original: NormalizedDoc, edits: Edit[]): NormalizedDoc {
  if (!edits.length) return original;
  let blocks = original.blocks.slice();
  for (const e of edits) {
    if (e.replace) { const i = blocks.findIndex((b) => b.id === e.replace!.id); if (i >= 0) blocks[i] = e.replace.block; }
    if (e.remove) { const gone = new Set(e.remove); blocks = blocks.filter((b) => !gone.has(b.id)); }
    if (e.insert) {
      const have = new Set(blocks.map((b) => b.id));
      const add = e.insert.blocks.filter((b) => !have.has(b.id));
      // the block it followed may itself have gone: then it goes at the end, so the accepted text is never lost
      const after = e.insert.after === null ? 0 : blocks.findIndex((b) => b.id === e.insert!.after) + 1 || blocks.length;
      blocks.splice(after, 0, ...add);
    }
  }
  return relocate(original, blocks);
}

/**
 * The edits behind the accepted state, in order. An accepted paragraph is held back while a red item in it (an invented claim, a changed
 * quote) is still open in the same round: accepting the paragraph must not quietly accept the claim.
 */
export function acceptedEdits(p: Project, upToRound = Infinity): Edit[] {
  const edits: Edit[] = [];
  for (const r of p.rounds) {
    if (r.number <= p.baseRound || r.number > upToRound) continue;
    const blocked = new Set(r.items.filter((i) => !i.change.edit && i.change.anchor && i.change.severity === 'high' && i.decision !== 'accept' && i.status !== 'fixed').map((i) => i.change.anchor!));
    const mine = r.items.filter((i) => i.decision === 'accept' && i.decidedInRound === r.number && i.change.edit && !blocked.has(i.change.anchor ?? ''));
    mine.sort((x, y) => (x.decidedAt ?? '').localeCompare(y.decidedAt ?? ''));
    edits.push(...mine.map((i) => i.change.edit!));
  }
  return edits;
}

export const acceptedState = (p: Project, upToRound = Infinity): NormalizedDoc => applyEdits(p.original.doc, acceptedEdits(p, upToRound));
