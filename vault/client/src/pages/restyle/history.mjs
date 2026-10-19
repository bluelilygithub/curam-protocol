// The CSS tool's history of this session: every change you make is an entry, and you can go back to any point, go forward again, or take
// back just one entry while keeping the ones after it. Pure functions on plain data (no DOM), tested in node in
// server/services/restyle/restyleHistory.test.js. It lives in memory for the session only (loading another page, or reloading, clears it).
//
//   state   = { edits, tokens }                  what the tool holds (see editModel.mjs); never changed in place
//   entry   = { id, label, at, mergeKey, before, after, changes }
//   history = { entries, cursor, nextId }        entries[0..cursor-1] are applied, the rest are "undone" and can be gone forward to
//
// Dragging a slider makes dozens of changes a second: entries with the same mergeKey within MERGE_WINDOW_MS become one entry.

import { tokenRef } from './editModel.mjs';

export const MAX_ENTRIES = 200;
export const MERGE_WINDOW_MS = 1500;

export const emptyHistory = () => ({ entries: [], cursor: 0, nextId: 1 });
export const canUndo = (h) => h.cursor > 0;
export const canRedo = (h) => h.cursor < h.entries.length;

const propKey = (e, prop) => `${e.media}\u0001${e.selector}\u0001${e.state}\u0001${prop}`;

function propMap(edits) {
  const map = new Map();
  edits.forEach((e) => Object.entries(e.props).forEach(([prop, v]) => map.set(propKey(e, prop), { target: { selector: e.selector, state: e.state, media: e.media, label: e.label }, prop, value: v.value, was: v.was })));
  return map;
}

/** What differs between two states, one item per property or brand colour/font that was added, changed or removed. */
export function diffStates(before, after) {
  const changes = [];
  const a = propMap(before.edits);
  const b = propMap(after.edits);
  new Set([...a.keys(), ...b.keys()]).forEach((key) => {
    const from = a.get(key) || null;
    const to = b.get(key) || null;
    if ((from && from.value) === (to && to.value)) return;
    const src = to || from;
    changes.push({ kind: 'prop', target: src.target, prop: src.prop, from: from && { value: from.value, was: from.was }, to: to && { value: to.value, was: to.was } });
  });
  const ta = new Map(before.tokens.map((t) => [t.id, t]));
  const tb = new Map(after.tokens.map((t) => [t.id, t]));
  new Set([...ta.keys(), ...tb.keys()]).forEach((id) => {
    const from = ta.get(id) || null;
    const to = tb.get(id) || null;
    if (from && to && from.name === to.name && from.value === to.value && from.kind === to.kind) return;
    changes.push({ kind: 'token', id, from, to });
  });
  return changes;
}

/**
 * Adds an entry for a change from `before` to `after`. Anything that was undone and not yet gone forward to is dropped (a new change
 * starts a new line of history). An entry with the same mergeKey as the last one, soon after it, is folded into it.
 * @param {object} h
 * @param {{label:string, before:object, after:object, at:number, mergeKey?:string|null}} e
 */
export function record(h, e) {
  const changes = diffStates(e.before, e.after);
  if (!changes.length) return h;
  const applied = h.entries.slice(0, h.cursor);
  const last = applied[applied.length - 1];
  if (last && e.mergeKey && last.mergeKey === e.mergeKey && e.at - last.at <= MERGE_WINDOW_MS) {
    const merged = { ...last, after: e.after, at: e.at, label: e.label, changes: diffStates(last.before, e.after) };
    if (merged.changes.length) applied[applied.length - 1] = merged; else applied.pop(); // dragged back to where it started: no entry
    return { ...h, entries: applied, cursor: applied.length };
  }
  const entries = [...applied, { id: h.nextId, label: e.label, at: e.at, mergeKey: e.mergeKey || null, before: e.before, after: e.after, changes }];
  while (entries.length > MAX_ENTRIES) entries.shift();
  return { entries, cursor: entries.length, nextId: h.nextId + 1 };
}

/** Back one entry. @returns {{history:object, state:object}|null} */
export function undo(h) {
  if (!canUndo(h)) return null;
  return { history: { ...h, cursor: h.cursor - 1 }, state: h.entries[h.cursor - 1].before };
}

/** Forward one entry. @returns {{history:object, state:object}|null} */
export function redo(h) {
  if (!canRedo(h)) return null;
  return { history: { ...h, cursor: h.cursor + 1 }, state: h.entries[h.cursor].after };
}

/** Go to a point: 0 is the start (before the first entry), entries.length is the latest. @returns {{history:object, state:object}|null} */
export function goTo(h, cursor) {
  if (!h.entries.length || cursor < 0 || cursor > h.entries.length || cursor === h.cursor) return null;
  return { history: { ...h, cursor }, state: cursor === 0 ? h.entries[0].before : h.entries[cursor - 1].after };
}

// ---- taking back one entry while keeping the later ones ----

function cloneEdits(edits) { return edits.map((e) => ({ ...e, props: { ...e.props } })); }

/** Sets (or, with `entry` null, removes) exactly one property of one rule, making or dropping the rule as needed. */
function putProp(edits, target, prop, entry) {
  const next = cloneEdits(edits);
  const same = (e) => e.selector === target.selector && e.state === target.state && e.media === target.media;
  let rule = next.find(same);
  if (!entry) {
    if (rule) delete rule.props[prop];
  } else {
    if (!rule) { rule = { selector: target.selector, label: target.label || target.selector, state: target.state, media: target.media, props: {} }; next.push(rule); }
    rule.props[prop] = { value: entry.value, was: entry.was };
  }
  return next.filter((e) => Object.keys(e.props).length > 0);
}

const currentProp = (edits, target, prop) => {
  const rule = edits.find((e) => e.selector === target.selector && e.state === target.state && e.media === target.media);
  return rule && rule.props[prop] ? rule.props[prop] : null;
};

/**
 * Takes back what one entry did, leaving later entries alone. A change is only taken back if it is still as that entry left it; if a
 * later entry changed the same thing, it is kept and reported. Returns the new state, what was kept, and how many things were taken back.
 * @returns {{state:object, reverted:number, kept:string[]}}
 */
export function revertEntry(h, index, current) {
  const entry = h.entries[index];
  let edits = current.edits;
  let tokens = current.tokens;
  let reverted = 0;
  const kept = [];
  entry.changes.forEach((c) => {
    if (c.kind === 'prop') {
      const now = currentProp(edits, c.target, c.prop);
      const asLeft = (now && now.value) === (c.to && c.to.value);
      if (!asLeft) { kept.push(`${c.target.label}: ${c.prop}`); return; }
      edits = putProp(edits, c.target, c.prop, c.from);
      reverted += 1;
      return;
    }
    const now = tokens.find((t) => t.id === c.id) || null;
    if (!c.from && c.to) { // a brand colour or font was added
      const inUse = edits.some((e) => Object.values(e.props).some((p) => now && p.value === tokenRef(now)));
      if (!now || inUse) { kept.push(`brand ${c.to.kind === 'color' ? 'colour' : 'font'} ${c.to.name}`); return; }
      tokens = tokens.filter((t) => t.id !== c.id);
      reverted += 1;
    } else if (c.from && !c.to) { // one was removed
      if (now) { kept.push(`brand ${c.from.kind === 'color' ? 'colour' : 'font'} ${c.from.name}`); return; }
      tokens = [...tokens, c.from];
      reverted += 1;
    } else if (now && now.name === c.to.name && now.value === c.to.value) { // one was changed
      tokens = tokens.map((t) => (t.id === c.id ? c.from : t));
      reverted += 1;
    } else {
      kept.push(`brand ${c.to.kind === 'color' ? 'colour' : 'font'} ${c.to.name}`);
    }
  });
  return { state: { edits, tokens }, reverted, kept };
}
