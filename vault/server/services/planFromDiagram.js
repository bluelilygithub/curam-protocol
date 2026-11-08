'use strict';

// Plans: turn a diagram into a draft plan. No AI and no database: the diagram is the structure read out of a drawing in the browser
// (client/src/pages/drawings/sceneDiagram.mjs: nodes with a label and a shape, arrows with an optional label), and the rules here are fixed.
// Tested with `node server/services/planFromDiagram.test.js`. See docs/plans.md.
//
//   buildDraft(diagram, { includeNo })        -> the steps, what they wait on, and what was left out and why
//   applyDurations(steps, durations)          -> every step with a length (default 1 working day, a milestone 0)
//   place(steps, { startDate, ... })          -> where every step lands and whether it fits, by the same rules as a saved plan
//
// The rules:
//   - a box becomes a step; a decision, and an end shape, become milestones (a point in time, no length); a start shape with nothing
//     before it is dropped (it is not work);
//   - an arrow means "the next one waits on the one before";
//   - an arrow that goes back to an earlier step (a loop, "no, try again") would make a circle, so it is left out and counted;
//   - DECISIONS ARE ASSUMED TO BE YES: an arrow leaving a decision with a "no"-sounding label is left out, and so is any step that can
//     then only be reached through it (unless includeNo is true). Unlabelled arrows are kept.

const sched = require('./planSchedule');
const { PlanError } = require('./planErrors');

const MAX_NODES = 40;
const MAX_EDGES = 80;
const MAX_LABEL = 60;
const MAX_NOTES = 4000;
const MAX_DURATION_DAYS = 3650;
const SHAPES = new Set(['box', 'decision', 'start-end']);
const NO_BRANCH = /^\s*(no|n|nope|false|reject\w*|declin\w*|den(?:y|ied)|fail\w*|cancel\w*|refus\w*|not)\b/i;
const START_WORD = /^\s*(start|begin|commence|kick[- ]?off)\b/i;

const tidy = (s) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();

/** The diagram arrives from the browser, so it is checked like any other input: sizes, shapes, and arrows only between real boxes. */
function cleanDiagram(diagram) {
  if (!diagram || typeof diagram !== 'object' || !Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges)) throw new PlanError('That diagram could not be read.');
  if (diagram.nodes.length < 2) throw new PlanError('A plan needs at least two boxes joined by an arrow.');
  if (diagram.nodes.length > MAX_NODES) throw new PlanError(`That diagram has more than ${MAX_NODES} boxes. Pick a smaller part of it.`, 413);
  if (diagram.edges.length > MAX_EDGES) throw new PlanError(`That diagram has more than ${MAX_EDGES} arrows. Pick a smaller part of it.`, 413);
  const nodes = []; const seen = new Set();
  for (const n of diagram.nodes) {
    const id = tidy(n && n.id).slice(0, 40);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    nodes.push({ id, label: tidy(n.label).slice(0, MAX_LABEL) || 'Step', shape: SHAPES.has(n.shape) ? n.shape : 'box' });
  }
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const edges = []; const pairs = new Set();
  for (const e of diagram.edges) {
    const from = tidy(e && e.from); const to = tidy(e && e.to);
    if (!index.has(from) || !index.has(to) || from === to) continue;
    const key = `${from}>${to}`;
    if (pairs.has(key)) continue; // two arrows the same way between the same boxes are one
    pairs.add(key);
    edges.push({ from, to, label: tidy(e.label).slice(0, MAX_LABEL) }); // a two-headed arrow is read as one way, in the direction it was drawn
  }
  if (nodes.length < 2 || !edges.length) throw new PlanError('A plan needs at least two boxes joined by an arrow.');
  return { nodes, edges, index };
}

function buildDraft(diagram, { includeNo = false } = {}) {
  const { nodes, edges, index } = cleanDiagram(diagram);
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // 1. No circles: arrows that go forward in reading order first, then the rest, each kept only if it closes no circle. What is refused is a loop.
  const ordered = [...edges.filter((e) => index.get(e.from) < index.get(e.to)), ...edges.filter((e) => index.get(e.from) >= index.get(e.to))];
  const acyclic = []; const deps = []; let droppedLoops = 0;
  for (const e of ordered) {
    if (sched.wouldCycle(deps, e.to, e.from)) { droppedLoops++; continue; }
    deps.push({ stepId: e.to, blockedByStepId: e.from });
    acyclic.push(e);
  }

  // 2. Decisions are assumed to be yes.
  const incoming = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of acyclic) incoming.set(e.to, incoming.get(e.to) + 1);
  const roots = nodes.filter((n) => incoming.get(n.id) === 0).map((n) => n.id);
  const isNo = (e) => byId.get(e.from).shape === 'decision' && NO_BRANCH.test(e.label);
  const kept = includeNo ? acyclic : acyclic.filter((e) => !isNo(e));

  // 3. Keep only what can be reached from a beginning along the arrows that were kept.
  const out = new Map(nodes.map((n) => [n.id, []]));
  for (const e of kept) out.get(e.from).push(e);
  const reached = new Set(roots);
  for (const stack = [...roots]; stack.length;) for (const e of out.get(stack.pop())) if (!reached.has(e.to)) { reached.add(e.to); stack.push(e.to); }

  // 4. A start shape with nothing before it is not work: drop it (what followed it now begins the plan).
  const dropped = new Set(nodes.filter((n) => n.shape === 'start-end' && roots.includes(n.id) && START_WORD.test(n.label) && out.get(n.id).length).map((n) => n.id));
  const live = nodes.filter((n) => reached.has(n.id) && !dropped.has(n.id));
  const liveIds = new Set(live.map((n) => n.id));

  const steps = live.map((n) => {
    const into = kept.filter((e) => e.to === n.id && liveIds.has(e.from));
    const notes = into.filter((e) => e.label).map((e) => `After "${byId.get(e.from).label}": ${e.label}`).join('; ').slice(0, MAX_NOTES);
    return { ref: n.id, title: n.label, isMilestone: n.shape !== 'box', notes, waitsOn: into.map((e) => e.from) };
  });
  const leftOut = nodes.filter((n) => !reached.has(n.id)).map((n) => n.label);
  return { steps, droppedLoops, leftOut, nodeCount: nodes.length };
}

function cleanDuration(v, label) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > MAX_DURATION_DAYS) throw new PlanError(`Days for "${label}" must be a whole number from 1 to ${MAX_DURATION_DAYS}.`);
  return n;
}

/** Give every step its length: the person's number when they gave one, otherwise one working day (a milestone has none). */
function applyDurations(steps, durations) {
  const given = durations && typeof durations === 'object' ? durations : {};
  return steps.map((s) => ({ ...s, durationDays: s.isMilestone ? 0 : (given[s.ref] == null || given[s.ref] === '' ? 1 : cleanDuration(given[s.ref], s.title)) }));
}

/** Where every step lands, by the same rules as a saved plan. Keyed by the step's ref. */
function place(steps, { startDate = null, targetEndDate = null, workWeek = 'weekdays' } = {}) {
  const idOf = new Map(steps.map((s, i) => [s.ref, i + 1]));
  const flat = steps.map((s) => ({ id: idOf.get(s.ref), parentStepId: null, startDate: null, durationDays: s.durationDays, isMilestone: s.isMilestone }));
  const deps = [];
  for (const s of steps) for (const b of s.waitsOn) deps.push({ stepId: idOf.get(s.ref), blockedByStepId: idOf.get(b) });
  const r = sched.schedule({ steps: flat, deps, startDate, targetEndDate, workWeek });
  const placed = {};
  for (const s of steps) { const x = r.steps.get(idOf.get(s.ref)); placed[s.ref] = { start: x.start, end: x.end }; }
  const suggestedStart = !startDate && targetEndDate ? sched.startFromEnd({ steps: flat, deps, targetEndDate, workWeek }) : null;
  return { steps: placed, projectStart: r.projectStart, projectEnd: r.projectEnd, workDays: r.workDays, scheduled: r.scheduled, fit: r.fit, suggestedStart };
}

module.exports = { MAX_NODES, MAX_EDGES, cleanDiagram, buildDraft, applyDurations, place };
