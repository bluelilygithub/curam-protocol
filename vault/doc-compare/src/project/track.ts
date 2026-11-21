import { fingerprint } from '../compare/content';
import type { Change, Tier } from '../report/model';
import type { Verdict } from '../review/verdict';
import type { ItemStatus, Round, TrackedItem } from './model';

/**
 * Following each item from round to round (addendum §7.4-7.6).
 *
 * Identity (itemId): where the change sits in the original (its anchor: a block id, or the original block an addition follows) and what
 * kind of change it is, never the round's own paragraph numbers. Checks without an anchor (word limit, version, spelling, references …)
 * use their description, with counts left out where a count changing does not make it a different issue.
 * Content (key): the change itself; the same itemId with a different key changed again.
 */

const TEXT_CHANGE = new Set(['wording', 'typo', 'number']); // one paragraph, changed in some way: the same item even if the kind differs
const COUNTS_DONT_MATTER = new Set(['wordLimit', 'metadata', 'versionNumber', 'spelling', 'terminology']);

export function itemIdOf(c: Change): string {
  const kind = TEXT_CHANGE.has(c.category) ? 'text' : c.category;
  if (c.edit && c.anchor) return `${kind}|${c.group ?? ''}|${c.anchor}`;
  const noCounts = COUNTS_DONT_MATTER.has(c.category) || (c.category === 'numbering' && /^Renumbered: \d+ paragraph/.test(c.detail ?? ''));
  const detail = noCounts ? (c.detail ?? '').replace(/\d[\d,.×]*/g, '#') : (c.detail ?? '');
  return `${kind}|${c.anchor ?? ''}|${detail}${c.anchor ? '' : `|${fingerprint(c.original ?? '')}`}`;
}

export const contentKeyOf = (c: Change) => `${c.category}:${fingerprint(`${c.group ?? ''}|${c.detail ?? ''}|${c.original ?? ''}|${c.edited ?? ''}`)}`;

const tierOf = (c: Change): Tier => c.tier ?? (c.severity === 'high' ? 'red' : c.severity === 'medium' ? 'amber' : 'info');
/** The items a person decides on: red and amber, not trivial. */
export const reviewable = (c: Change) => !c.trivial && tierOf(c) !== 'info';
export const isOpenItem = (i: TrackedItem) => i.status !== 'fixed' && i.status !== 'accepted' && (!i.decision || i.decision === 'later');

const word = (c: Change) => (c.group === 'section' ? 'section' : c.group === 'tableRow' ? 'table row' : 'paragraph');

/** The line shown on a card for its status in this round. */
export function roundNote(i: TrackedItem, round: number): string | undefined {
  switch (i.status) {
    case 'new': return 'New in this round.';
    case 'changedAgain': return `Changed again since round ${round - 1}: review it again.`;
    case 'notFixed': {
      const was = i.decidedInRound ?? round - 1;
      const still = i.change.category === 'removed' ? 'still missing' : 'still changed';
      return i.decision === 'later' ? `You marked this Fix later in round ${was}, and it's ${still}.` : `You chose to restore this in round ${was}, but it's ${still}.`;
    }
    case 'open':
      if (i.firstRound >= round) return undefined;
      // drift: lost or changed in an earlier round and not back since
      return i.change.category === 'removed' ? `This ${word(i.change)} from your original was removed in round ${i.firstRound} and hasn't come back.` : `Changed in round ${i.firstRound} and still not decided.`;
    case 'fixed': return `Fixed in round ${i.fixedInRound ?? round}.`;
    case 'accepted': return i.absorbed ? 'Accepted when this round became the new original.' : `Accepted in round ${i.decidedInRound ?? round}.`;
    default: return undefined;
  }
}

/**
 * The tracked items of a round, from its changes against the accepted state, the previous round's items, and decisions already made in
 * this round (`own`, when a round is checked again after a decision changed).
 */
export function trackItems(round: number, changes: Change[], prev: TrackedItem[] | undefined, own: TrackedItem[] = []): TrackedItem[] {
  const prevById = new Map((prev ?? []).map((i) => [i.itemId, i]));
  const ownById = new Map(own.filter((i) => i.decision && i.decidedInRound === round).map((i) => [i.itemId, i]));
  const seen = new Set<string>();
  const out: TrackedItem[] = [];
  for (const c of changes.filter(reviewable)) {
    const itemId = itemIdOf(c), key = contentKeyOf(c);
    if (seen.has(itemId)) continue; // two changes with one identity: the first stands for both
    seen.add(itemId);
    const p = prevById.get(itemId);
    let status: ItemStatus;
    let carried: Partial<TrackedItem> = {};
    if (!p) status = prev ? 'new' : 'open';
    else if (p.status === 'fixed') status = 'new'; // fixed earlier, back again
    else if (p.key !== key) status = 'changedAgain';
    else if (p.decision === 'accept') { status = 'accepted'; carried = { decision: 'accept', decidedAt: p.decidedAt, decidedInRound: p.decidedInRound, absorbed: p.absorbed }; }
    else if (p.decision === 'restore' || p.decision === 'later') { status = 'notFixed'; carried = { decision: p.decision, decidedInRound: p.decidedInRound }; }
    else status = 'open';
    const item: TrackedItem = { itemId, key, change: c, status, firstRound: p && p.status !== 'fixed' ? p.firstRound : round, ...carried };
    // the earlier decision is the reason for the note; the item itself is open again until it is decided in this round
    if (status === 'notFixed') { item.change = { ...c, severity: 'high', tier: 'red' }; }
    item.change = { ...item.change, roundNote: roundNote(item, round) };
    if (status === 'notFixed') { item.decision = undefined; item.decidedAt = undefined; }
    const mine = ownById.get(itemId);
    if (mine && mine.key === key) Object.assign(item, { decision: mine.decision, decidedAt: mine.decidedAt, decidedInRound: round });
    out.push(item);
  }
  // decided in this round and now gone from the comparison (an accepted change is part of the accepted state): still accepted
  for (const i of ownById.values()) if (!seen.has(i.itemId) && i.decision === 'accept') { seen.add(i.itemId); out.push({ ...i, status: 'accepted' }); }
  for (const p of prev ?? []) {
    if (seen.has(p.itemId)) continue;
    if (p.status === 'accepted' || p.decision === 'accept') out.push({ ...p, status: 'accepted', change: { ...p.change, roundNote: roundNote({ ...p, status: 'accepted' }, round) } });
    else if (p.status !== 'fixed') {
      const fixed: TrackedItem = { ...p, status: 'fixed', fixedInRound: round };
      out.push({ ...fixed, change: { ...p.change, roundNote: roundNote(fixed, round) } });
    }
  }
  return out;
}

/** Notes for the cards: the comparison's changes carry their item's note, in the order the queue wants. */
const RANK: Record<ItemStatus, number> = { notFixed: 0, new: 1, changedAgain: 2, open: 3, accepted: 4, fixed: 5 };
export function queueOrder(items: TrackedItem[]): TrackedItem[] {
  return items.map((i, n) => ({ i, n })).sort((x, y) => RANK[x.i.status] - RANK[y.i.status] || x.n - y.n).map((x) => x.i);
}

export function roundVerdict(items: TrackedItem[]): Verdict {
  const open = items.filter(isOpenItem);
  if (open.some((i) => tierOf(i.change) === 'red')) return 'red';
  if (open.some((i) => tierOf(i.change) === 'amber')) return 'amber';
  return 'green';
}

export function countTiers(changes: Change[]): Round['counts'] {
  const real = changes.filter((c) => !c.trivial);
  return { red: real.filter((c) => tierOf(c) === 'red').length, amber: real.filter((c) => tierOf(c) === 'amber').length, info: real.filter((c) => tierOf(c) === 'info').length };
}

export function roundSummary(items: TrackedItem[], round: number): Round['summary'] {
  return {
    fixed: items.filter((i) => i.status === 'fixed' && i.fixedInRound === round).length,
    notFixed: items.filter((i) => i.status === 'notFixed').length,
    new: items.filter((i) => i.status === 'new').length,
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "Round 4: 3 issues fixed, 1 not fixed, 2 new changes." */
export const summaryLine = (round: number, s: Round['summary']) => `Round ${round}: ${plural(s.fixed, 'issue')} fixed, ${s.notFixed} not fixed, ${plural(s.new, 'new change')}.`;
