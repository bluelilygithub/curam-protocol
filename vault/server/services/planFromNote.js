'use strict';

// Plans: turn a note into a draft plan. No AI and no database: a note is plain Markdown text, and the rules here are fixed.
// Tested with `node server/services/planFromNote.test.js`. See docs/plans.md "From a note".
//
//   buildDraft(text, { order })  -> steps (in the note's order), and what was left out
//
// The rules:
//   - a heading becomes a GROUP (a section of the plan) and the list items under it become its steps; a heading with nothing under it is
//     dropped (it is a title or a paragraph heading, not work);
//   - a list item (bullet, numbered or check-box) becomes a step; an item with indented items under it becomes a group of sub-steps;
//   - a ticked check-box is a step that is already Done;
//   - a length written at the end of a line is used and removed from the name: "(3 days)", "3d", "2 weeks" (a week is five working days);
//   - a line that starts "Milestone:" or "◆" is a milestone (no length);
//   - paragraphs, quotes, code and pictures are ignored; a "{task:12}" or "{picture:3}" marker is removed from names;
//   - ORDER decides what waits on what. 'lists' (the default): the items of a NUMBERED list run one after another and bullets run together;
//     'sequence': every item waits for the one before it in the same list (and a section for the section before); 'parallel': nothing waits.
//     An item with sub-steps counts as finished when all its sub-steps are.

const { PlanError } = require('./planErrors');

const MAX_CHARS = 30000;
const MAX_STEPS = 60;
const MAX_TITLE = 120;
const MAX_HINT_DAYS = 3650;
const ORDERS = ['lists', 'sequence', 'parallel'];

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/;
const FENCE = /^\s*(```|~~~)/;
const MARKERS = /\s*\{(?:task|picture):\d+\}\s*/g;
const DURATION = /\s*[(\[]?\s*~?\s*(\d+(?:\.\d+)?)\s*(d|days?|w|wks?|weeks?)\s*[)\]]?\s*$/i;
const MILESTONE = /^\s*(?:milestone\b\s*[:\-–—]?|◆)\s*/i;

const tidy = (s) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
// light Markdown clean-up of a name: bold/italic marks, inline code ticks and links keep their words
const plain = (s) => tidy(String(s).replace(MARKERS, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/(\*\*|__|`)/g, '').replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|$)/g, '$1$2'));

/** "Order tiles (3 days)" -> { title: 'Order tiles', days: 3 }. A hint is only taken from the END of a line and never leaves an empty name. */
function takeDuration(text) {
  const m = DURATION.exec(text);
  if (!m) return { title: text, days: null };
  const title = text.slice(0, m.index).replace(/[\s,:;\-–—(]+$/, '').trim();
  if (title.length < 2) return { title: text, days: null };
  const n = Number(m[1]);
  const days = /^w/i.test(m[2]) ? Math.ceil(n * 5) : Math.ceil(n);
  if (!(days >= 1)) return { title: text, days: null };
  return { title, days: Math.min(days, MAX_HINT_DAYS) };
}

/** The note's headings and lists as a tree: { kind: 'heading' | 'item', text, numbered, done, children }. */
function parseTree(text) {
  const root = { kind: 'root', children: [] };
  const heads = []; // { level, node }
  let lists = []; // { indent, node } for the list being read under the current heading
  let inFence = false;
  const lines = String(text == null ? '' : text).slice(0, MAX_CHARS).split(/\r?\n/);
  const addItem = (node) => {
    const parent = lists.length ? lists[lists.length - 1].node : (heads.length ? heads[heads.length - 1].node : root);
    parent.children.push(node);
  };
  for (const raw of lines) {
    if (FENCE.test(raw)) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (!raw.trim()) continue; // a blank line does not end a list
    const h = HEADING.exec(raw);
    if (h) {
      const level = h[1].length;
      while (heads.length && heads[heads.length - 1].level >= level) heads.pop();
      const node = { kind: 'heading', text: h[2], children: [] };
      (heads.length ? heads[heads.length - 1].node : root).children.push(node);
      heads.push({ level, node });
      lists = [];
      continue;
    }
    const it = ITEM.exec(raw);
    if (it) {
      if (!/[\p{L}\p{N}]/u.test(plain(it[4]))) continue; // an empty bullet (or one with only punctuation) is not a step
      const indent = it[1].replace(/\t/g, '    ').length;
      while (lists.length && lists[lists.length - 1].indent >= indent) lists.pop();
      const node = { kind: 'item', text: it[4], numbered: /^\d/.test(it[2]), done: it[3] === 'x' || it[3] === 'X', children: [] };
      addItem(node);
      lists.push({ indent, node });
      continue;
    }
    lists = []; // a paragraph ends the list
  }
  return root;
}

const isLeaf = (n) => n.kind === 'item' && !n.children.length;
const leavesOf = (n) => (isLeaf(n) ? [n] : n.children.flatMap(leavesOf));
const hasWork = (n) => leavesOf(n).length > 0;

function buildDraft(text, { order = 'lists' } = {}) {
  if (!ORDERS.includes(order)) throw new PlanError('That order is not known.');
  const root = parseTree(text);

  // A heading with no steps under it is dropped, together with anything that held none.
  const prune = (n) => { n.children = n.children.filter((c) => { prune(c); return c.kind === 'item' ? true : hasWork(c); }); };
  let emptyHeadings = 0;
  const count = (n) => { for (const c of n.children) { if (c.kind === 'heading' && !hasWork(c)) emptyHeadings++; count(c); } };
  count(root);
  prune(root);
  if (!root.children.some(hasWork)) throw new PlanError('There is nothing to make steps from. A plan is made from a list in the note: bulleted, numbered or check-box lines, with headings if you want sections.', 422);

  // Number every kept node in the note's order and turn it into a step.
  const steps = []; const refOf = new Map();
  const walk = (n, parentRef) => {
    for (const c of n.children) {
      const ref = `n${steps.length + 1}`;
      refOf.set(c, ref);
      const isGroup = c.children.length > 0;
      let title = plain(c.text); let isMilestone = false; let hintDays = null;
      if (c.kind === 'item') {
        if (MILESTONE.test(title)) { isMilestone = true; title = title.replace(MILESTONE, '').trim(); }
        if (!isGroup && !isMilestone) { const d = takeDuration(title); title = d.title; hintDays = d.days; }
      }
      steps.push({ ref, title: (title || 'Step').slice(0, MAX_TITLE), isMilestone: isMilestone && !isGroup, notes: '', waitsOn: [], parentRef, hintDays, status: c.kind === 'item' && c.done && !isGroup ? 'done' : 'todo', _node: c });
      walk(c, ref);
    }
  };
  walk(root, null);
  if (steps.length > MAX_STEPS) throw new PlanError(`That note makes more than ${MAX_STEPS} steps. Make a plan from part of it, or split the note.`, 413);

  // Who waits on whom, one list of siblings at a time. The links are kept to the minimum: a step waits on the LAST steps of the one before it
  // (those nothing else inside it waits on), and only the FIRST steps of the next one are linked (the rest already wait on those).
  const stepOf = new Map(steps.map((s) => [s._node, s]));
  const leafSteps = (n) => leavesOf(n).map((l) => stepOf.get(l));
  const lastOf = (n) => { const ls = leafSteps(n); const blocked = new Set(ls.flatMap((l) => l.waitsOn)); return ls.filter((l) => !blocked.has(l.ref)); };
  const firstOf = (n) => { const ls = leafSteps(n); const inside = new Set(ls.map((l) => l.ref)); return ls.filter((l) => !l.waitsOn.some((r) => inside.has(r))); };
  const chain = (prev, next) => {
    const before = lastOf(prev).map((l) => l.ref);
    for (const s of firstOf(next)) for (const b of before) if (!s.waitsOn.includes(b)) s.waitsOn.push(b);
  };
  const link = (siblings) => {
    if (order === 'parallel') return;
    for (let i = 1; i < siblings.length; i++) {
      const a = siblings[i - 1]; const b = siblings[i];
      if (order === 'sequence' || (a.kind === 'item' && a.numbered && b.kind === 'item' && b.numbered)) chain(a, b);
    }
  };
  const visit = (n) => { n.children.forEach(visit); link(n.children); }; // inside first, so a section's own order is known when it is linked to its neighbours
  visit(root);

  for (const s of steps) delete s._node;
  return { steps, emptyHeadings, stepCount: steps.length };
}

module.exports = { MAX_CHARS, MAX_STEPS, ORDERS, parseTree, takeDuration, buildDraft };
