import type { Change, Tier } from '../report/model';

/**
 * The verdict and the review queue (addendum §6). Pure functions, so the rules are easy to test:
 *   red    "Not ready to submit"          a red item has no decision, or is marked Fix later
 *   amber  "Review recommended"           no open red items, but an amber item is not yet decided
 *   green  "No significant changes found" only info items, or everything decided
 * Never "safe", "correct" or "verified": DocCompare checks what changed, not whether it is true (tests enforce this).
 */

export type Decision = 'restore' | 'accept' | 'later';
export interface DecisionRecord { decision: Decision; decidedAt: string }
export type Decisions = Record<string, DecisionRecord>;
export type Verdict = 'red' | 'amber' | 'green';

export const VERDICT_TEXT: Record<Verdict, { title: string; icon: string }> = {
  red: { title: 'Not ready to submit', icon: '●' },
  amber: { title: 'Review recommended', icon: '▲' },
  green: { title: 'No significant changes found', icon: '✓' },
};

export const ACCURACY_NOTE = "This check shows what changed between your documents. It doesn't check whether the content is accurate.";

/** A key for a change that stays the same when the same files are compared again (it does not use the change's number). */
export function itemKey(c: Change): string {
  const s = `${c.category}|${c.group ?? ''}|${c.location}|${c.detail ?? ''}|${c.original ?? ''}|${c.edited ?? ''}`;
  // FNV-1a, 32-bit: short and stable; collisions only matter within one comparison
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return `${c.category}:${(h >>> 0).toString(36)}`;
}

const tierOf = (c: Change): Tier => c.tier ?? (c.severity === 'high' ? 'red' : c.severity === 'medium' ? 'amber' : 'info');

export interface ReviewItem { key: string; change: Change; tier: 'red' | 'amber'; decision?: DecisionRecord }

/** The review queue: red items, then amber, in document order; info and trivial changes stay under "Show all changes". */
export function reviewItems(changes: Change[], decisions: Decisions = {}): ReviewItem[] {
  const items = changes
    .filter((c) => !c.trivial && tierOf(c) !== 'info')
    .map((c) => { const key = itemKey(c); return { key, change: c, tier: tierOf(c) as 'red' | 'amber', decision: decisions[key] }; });
  return [...items.filter((i) => i.tier === 'red'), ...items.filter((i) => i.tier === 'amber')];
}

/** Open = still needs a decision. A red item marked Fix later stays open. */
export const isOpen = (i: ReviewItem) => !i.decision || i.decision.decision === 'later';

export function verdictOf(items: ReviewItem[]): Verdict {
  if (items.some((i) => i.tier === 'red' && isOpen(i))) return 'red';
  if (items.some((i) => i.tier === 'amber' && isOpen(i))) return 'amber';
  return 'green';
}

export function progress(items: ReviewItem[]) {
  const decided = items.filter((i) => i.decision && i.decision.decision !== 'later').length;
  return { decided, total: items.length, openRed: items.filter((i) => i.tier === 'red' && isOpen(i)).length };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (parts: string[]) => (parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);

/** One plain sentence from the counts, e.g. "The LLM removed 2 sections and 3 paragraphs, changed 1 figure, and added 2 passages that need checking." */
export function summarySentence(changes: Change[]): string {
  const real = changes.filter((c) => !c.trivial && tierOf(c) !== 'info');
  if (!real.length) return 'The LLM made no changes that need your attention.';
  const n = (f: (c: Change) => boolean) => real.filter(f).length;
  const removedSections = n((c) => c.category === 'removed' && c.group === 'section');
  const removedRows = n((c) => c.category === 'removed' && c.group === 'tableRow');
  const removedOther = n((c) => c.category === 'removed' && !c.group);
  const cut = n((c) => c.category === 'wording' && c.severity === 'high');
  const figures = n((c) => c.category === 'number');
  const added = n((c) => c.category === 'added');
  const reworded = n((c) => c.category === 'wording' && c.severity !== 'high');
  const moved = n((c) => c.category === 'moved');
  const structure = n((c) => c.category === 'formatting');
  const overall = real.find((c) => c.category === 'metadata' && /^Word count dropped by ([\d.]+)%/.test(c.detail ?? ''));
  const overallPct = overall ? Math.round(Number(/([\d.]+)%/.exec(overall.detail ?? '')?.[1] ?? 0)) : 0;
  const sectionsCut = n((c) => c.category === 'metadata' && /^Section .* lost/.test(c.detail ?? ''));

  const removed = [removedSections && plural(removedSections, 'section'), removedOther && plural(removedOther, 'paragraph'), removedRows && plural(removedRows, 'table row')].filter(Boolean) as string[];
  const clauses = [
    removed.length ? `removed ${list(removed)}` : '',
    cut ? `cut words from ${plural(cut, 'paragraph')}` : '',
    figures ? `changed ${plural(figures, 'figure')}` : '',
    reworded ? `reworded ${plural(reworded, 'paragraph')}` : '',
    moved ? `moved ${plural(moved, 'paragraph')}` : '',
    structure ? `changed the structure in ${plural(structure, 'place')}` : '',
    added ? `added ${plural(added, 'passage')} that need${added === 1 ? 's' : ''} checking` : '',
  ].filter(Boolean);
  const sectionsPart = sectionsCut ? `${plural(sectionsCut, 'section')} lost more than 15% of ${sectionsCut === 1 ? 'its' : 'their'} words` : '';
  const tail = overall
    ? ` The edited version is also ${overallPct}% shorter overall${sectionsPart ? `, and ${sectionsPart}` : ''}.`
    : sectionsPart ? ` Also, ${sectionsPart}.` : '';
  if (!clauses.length) return `The LLM made changes that need your attention.${tail}`;
  return `The LLM ${list(clauses)}.${tail}`;
}

/** "5 removals restored, 2 accepted, 1 left to fix" for the report. */
export function decisionsSummary(items: ReviewItem[]): string {
  const restored = items.filter((i) => i.decision?.decision === 'restore').length;
  const accepted = items.filter((i) => i.decision?.decision === 'accept').length;
  const later = items.filter((i) => i.decision?.decision === 'later').length;
  const undecided = items.filter((i) => !i.decision).length;
  const parts = [restored && `${restored} to restore`, accepted && `${accepted} accepted`, later && `${later} left to fix later`, undecided && `${undecided} not yet decided`].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Nothing needed a decision';
}
