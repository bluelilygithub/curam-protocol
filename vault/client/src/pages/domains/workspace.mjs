// The set being worked on: what it holds, what gets saved, and the few ways it changes. Pure (no network, no React), so the rules can be
// tested: merging a new round into the pool, the shortlist, the more-like-this / less-like-this feedback, and what counts as unsaved.

import { BLANK_BRIEF } from './constants.mjs';

export const MAX_POOL = 150;

export const BLANK_WS = {
  id: null, name: '', brief: BLANK_BRIEF, pool: [], shortlist: [], preferred: '',
  feedback: { more: [], less: [] }, seen: [], rounds: 0, checks: {}, legacy: null, lastCounts: null, savedJson: null,
};

/** What gets saved: everything the person would want back, nothing about the screen. */
export function dataOf(ws) {
  return {
    schemaVersion: 2,
    brief: ws.brief, pool: ws.pool, shortlist: ws.shortlist, preferred: ws.preferred,
    feedback: ws.feedback, seen: ws.seen, rounds: ws.rounds, checks: ws.checks,
    ...(ws.legacy ? { legacy: ws.legacy } : {}),
  };
}
export const jsonOf = (ws) => JSON.stringify(dataOf(ws));

const hasContent = (ws) => !!(ws.brief.what || ws.brief.own || ws.pool.length);
/** Unsaved: never saved and there is something to lose, or changed since the last save. */
export const isDirty = (ws) => (ws.savedJson === null ? hasContent(ws) : ws.savedJson !== jsonOf(ws));

/** A set as the server sends it (always version 2) into the working set. */
export function fromSet(set) {
  const d = (set && set.data) || {};
  const next = {
    ...BLANK_WS,
    id: set.id, name: set.name,
    brief: { ...BLANK_BRIEF, ...(d.brief || {}), tone: { ...BLANK_BRIEF.tone, ...((d.brief && d.brief.tone) || {}) }, required: { ...BLANK_BRIEF.required, ...((d.brief && d.brief.required) || {}) } },
    pool: d.pool || [], shortlist: d.shortlist || [], preferred: d.preferred || '',
    feedback: { more: (d.feedback && d.feedback.more) || [], less: (d.feedback && d.feedback.less) || [] },
    seen: d.seen || [], rounds: d.rounds || 0, checks: d.checks || {}, legacy: d.legacy || null,
  };
  return { ...next, savedJson: jsonOf(next) };
}

/**
 * Add a round's cards to the pool. A name already there is updated in place (its newest check wins) and keeps its first round; the pool
 * is capped, dropping the oldest names that are not the person's own, not shortlisted and not preferred. Every name the round looked at
 * goes into `seen`, so the next round never offers it again.
 */
export function mergeRound(ws, result) {
  const incoming = (result && result.cards) || [];
  const byName = new Map(ws.pool.map((c) => [c.name, c]));
  const added = [];
  for (const c of incoming) {
    const old = byName.get(c.name);
    if (old) byName.set(c.name, { ...c, round: old.round, ...(old.own ? { own: true } : {}) });
    else { byName.set(c.name, c); added.push(c.name); }
  }
  let pool = [...byName.values()];
  if (pool.length > MAX_POOL) {
    const keep = (c) => c.own || ws.shortlist.includes(c.name) || ws.preferred === c.name;
    const droppable = pool.filter((c) => !keep(c)).sort((a, b) => a.round - b.round);
    const drop = new Set(droppable.slice(0, pool.length - MAX_POOL).map((c) => c.name));
    pool = pool.filter((c) => !drop.has(c.name));
  }
  const seen = [...new Set([...ws.seen, ...((result && result.checkedNames) || []), ...incoming.map((c) => c.name)])].slice(-300);
  return { ...ws, pool, seen, rounds: ws.rounds + 1, lastCounts: result ? { ...(result.counts || {}), added: added.length, credits: result.creditsUsed || 0 } : ws.lastCounts };
}

/** The pool as shown: the person's own names first, then the newest round first, otherwise in the order they came. */
export function orderedPool(pool) {
  return (pool || []).map((c, i) => [c, i]).sort(([a, ai], [b, bi]) => (!!b.own - !!a.own) || (b.round - a.round) || (ai - bi)).map(([c]) => c);
}

export function toggleShortlist(ws, name) {
  const on = ws.shortlist.includes(name);
  return { ...ws, shortlist: on ? ws.shortlist.filter((n) => n !== name) : [...ws.shortlist, name].slice(0, 16), preferred: on && ws.preferred === name ? '' : ws.preferred };
}

/** More like this / less like this: one or the other, or neither. Pressing the same one again clears it. */
export function toggleFeedback(ws, name, kind) {
  const other = kind === 'more' ? 'less' : 'more';
  const has = ws.feedback[kind].includes(name);
  return { ...ws, feedback: { [kind]: has ? ws.feedback[kind].filter((n) => n !== name) : [...ws.feedback[kind], name], [other]: ws.feedback[other].filter((n) => n !== name) } };
}

export const feedbackOf = (ws, name) => (ws.feedback.more.includes(name) ? 'more' : ws.feedback.less.includes(name) ? 'less' : '');
