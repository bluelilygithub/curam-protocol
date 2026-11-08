// node client/src/pages/drawings/diagramLayout.test.mjs
import assert from 'node:assert';
import { wrapLabel, nodeSize, assignLevels, layoutDiagram, edgePoints, segmentHitsBox, SHAPE_TO_TYPE } from './diagramLayout.mjs';

const N = (id, label = id, shape = 'box') => ({ id, label, shape });
const E = (from, to, label) => (label ? { from, to, label } : { from, to });
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// ---- wrapping and sizing ----
assert.deepStrictEqual(wrapLabel('Book a visit'), ['Book a visit']);
assert.deepStrictEqual(wrapLabel('The surveyor attends the property and measures up'), ['The surveyor attends', 'the property and', 'measures up']);
assert.ok(wrapLabel('Supercalifragilisticexpialidocious'.repeat(2)).every((l) => l.length <= 22), 'a very long word is cut');
assert.deepStrictEqual(wrapLabel(''), ['']);
assert.deepStrictEqual(wrapLabel('  spaced   out  '), ['spaced out']);
const small = nodeSize(N('a', 'Hi'));
const big = nodeSize(N('b', 'A much longer label that needs more than one line'));
assert.ok(small.w >= 120 && big.h > small.h, 'more lines, taller box');
assert.ok(big.w <= 270, 'never wider than the limit');
const dia = nodeSize(N('c', 'Quote ok?', 'decision'));
const box = nodeSize(N('c', 'Quote ok?', 'box'));
assert.ok(dia.w > box.w && dia.h > box.h, 'a diamond gets more room for the same words');
assert.strictEqual(small.text, 'Hi');

// ---- layers ----
const chain = assignLevels([N('a'), N('b'), N('c')], [E('a', 'b'), E('b', 'c')]);
assert.deepStrictEqual([chain.get('a'), chain.get('b'), chain.get('c')], [0, 1, 2]);
// a diamond: a splits to b and c, which both lead to d (d is after the longer way)
const dmd = assignLevels([N('a'), N('b'), N('c'), N('d')], [E('a', 'b'), E('a', 'c'), E('b', 'd'), E('c', 'd')]);
assert.deepStrictEqual([dmd.get('a'), dmd.get('b'), dmd.get('c'), dmd.get('d')], [0, 1, 1, 2]);
// a loop back ("no, try again") does not break the layering
const loop = assignLevels([N('a'), N('b'), N('c')], [E('a', 'b'), E('b', 'c'), E('c', 'a')]);
assert.deepStrictEqual([loop.get('a'), loop.get('b'), loop.get('c')], [0, 1, 2], 'the arrow back to the start is ignored for layering');
const decisionLoop = assignLevels([N('s'), N('d'), N('x'), N('y')], [E('s', 'd'), E('d', 'x'), E('d', 'y'), E('y', 's')]);
assert.ok(decisionLoop.get('x') > decisionLoop.get('d') && decisionLoop.get('d') > decisionLoop.get('s'));
// no roots at all (one big circle), and boxes with no arrows
const circle = assignLevels([N('a'), N('b')], [E('a', 'b'), E('b', 'a')]);
assert.strictEqual(circle.get('a'), 0);
const lone = assignLevels([N('a'), N('b'), N('c')], [E('a', 'b')]);
assert.strictEqual(lone.get('c'), 0, 'a box with no arrows starts a layer of its own');
assert.strictEqual(assignLevels([N('a')], []).get('a'), 0);

// ---- the layout ----
const flow = { kind: 'flow', direction: 'down', nodes: [N('a', 'Customer calls', 'start-end'), N('b', 'Book a visit'), N('c', 'Surveyor attends'), N('d', 'Quote ok?', 'decision'), N('e', 'Send the quote'), N('f', 'Revise')],
  edges: [E('a', 'b'), E('b', 'c'), E('c', 'd'), E('d', 'e', 'yes'), E('d', 'f', 'no'), E('f', 'c')] };
const L = layoutDiagram(flow, { origin: { x: 100, y: 200 }, runId: 'r1' });
const boxesArr = [...L.boxes.entries()];
for (let i = 0; i < boxesArr.length; i += 1) for (let j = i + 1; j < boxesArr.length; j += 1) assert.ok(!overlap(boxesArr[i][1], boxesArr[j][1]), `${boxesArr[i][0]} and ${boxesArr[j][0]} do not overlap`);
assert.ok(L.boxes.get('a').y < L.boxes.get('b').y && L.boxes.get('b').y < L.boxes.get('c').y && L.boxes.get('c').y < L.boxes.get('d').y, 'a flow goes down');
assert.strictEqual(L.boxes.get('a').y, 200, 'the origin is the top left of the diagram');
assert.ok([...L.boxes.values()].every((b) => b.x >= 100 && b.y >= 200), 'nothing above or left of the origin');
assert.ok([...L.boxes.values()].every((b) => b.x + b.w <= 100 + L.width + 1 && b.y + b.h <= 200 + L.height + 1), 'the reported size holds everything');
assert.ok(L.boxes.get('e').y === L.boxes.get('f').y, 'the two answers of a decision share a layer');

// the skeleton
const ids = L.skeleton.filter((s) => s.id).map((s) => s.id);
assert.strictEqual(new Set(ids).size, ids.length, 'unique ids');
assert.deepStrictEqual(L.skeleton.filter((s) => s.type !== 'arrow').map((s) => s.type), ['ellipse', 'rectangle', 'rectangle', 'diamond', 'rectangle', 'rectangle'], 'shapes follow the AI\'s choice');
assert.strictEqual(L.skeleton.filter((s) => s.type === 'arrow').length, flow.edges.length);
for (const s of L.skeleton) assert.deepStrictEqual(s.customData, { vaultDiagram: { run: 'r1' } }, 'every piece is tagged with its run (so a change can replace it)');
for (const a of L.skeleton.filter((s) => s.type === 'arrow')) assert.ok(ids.includes(a.start.id) && ids.includes(a.end.id), 'arrows are bound to boxes that exist');
assert.strictEqual(L.skeleton.find((s) => s.type === 'arrow' && s.label && s.label.text === 'yes').label.fontSize, 16, 'an arrow label is kept');
assert.ok(L.skeleton.find((s) => s.id === 'vd-r1-d').label.text.includes('Quote ok?'));

// arrows start and end on the edges of their boxes, not in the middle
const first = L.skeleton.find((s) => s.type === 'arrow' && s.start.id === 'vd-r1-a');
const ba = L.boxes.get('a'); const bb = L.boxes.get('b');
assert.ok(Math.abs(first.y - (ba.y + ba.h)) <= 1, 'the arrow leaves the bottom of the first box');
assert.ok(Math.abs(first.y + first.points[1][1] - bb.y) <= 1, 'and arrives at the top of the next');
const ep = edgePoints({ x: 0, y: 0, w: 100, h: 50 }, { x: 300, y: 0, w: 100, h: 50 });
assert.deepStrictEqual(ep, [100, 25, 300, 25], 'side by side: right edge to left edge');
assert.deepStrictEqual(edgePoints({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 10, h: 10 }).length, 4, 'two boxes on the same spot do not crash');

// left to right
const R = layoutDiagram({ ...flow, direction: 'right' });
assert.ok(R.boxes.get('a').x < R.boxes.get('b').x && R.boxes.get('b').x < R.boxes.get('c').x, 'left to right goes along');
assert.ok(R.width > R.height * 0.5, 'and is wider');
const rb = [...R.boxes.values()];
for (let i = 0; i < rb.length; i += 1) for (let j = i + 1; j < rb.length; j += 1) assert.ok(!overlap(rb[i], rb[j]), 'no overlap left to right either');

// an org chart: the top box is centred over its reports
const org = layoutDiagram({ kind: 'org', direction: 'down', nodes: [N('ceo', 'Director'), N('m1', 'Sales'), N('m2', 'Operations'), N('m3', 'Finance')], edges: [E('ceo', 'm1'), E('ceo', 'm2'), E('ceo', 'm3')] });
const top = org.boxes.get('ceo'); const kids = ['m1', 'm2', 'm3'].map((k) => org.boxes.get(k));
assert.ok(Math.abs((top.x + top.w / 2) - (Math.min(...kids.map((k) => k.x)) + Math.max(...kids.map((k) => k.x + k.w))) / 2) <= 2, 'the director is centred over the team');

// the edge cases
const one = layoutDiagram({ kind: 'flow', direction: 'down', nodes: [N('a', 'Only one')], edges: [] });
assert.strictEqual(one.skeleton.length, 1);
assert.ok(one.width > 0 && one.height > 0);
const noEdgesRef = layoutDiagram({ kind: 'flow', direction: 'down', nodes: [N('a'), N('b')], edges: [E('a', 'zzz')] });
assert.strictEqual(noEdgesRef.skeleton.filter((s) => s.type === 'arrow').length, 0, 'an arrow to nothing is left out');

// the biggest diagram it is asked for: fast and without overlaps
const bigNodes = Array.from({ length: 40 }, (_, i) => N(`n${i + 1}`, `Step number ${i + 1} of the process`));
const bigEdges = Array.from({ length: 39 }, (_, i) => E(`n${i + 1}`, `n${i + 2}`)).concat([E('n1', 'n10'), E('n5', 'n30'), E('n40', 'n1')]);
const t0 = Date.now();
const B = layoutDiagram({ kind: 'flow', direction: 'down', nodes: bigNodes, edges: bigEdges });
assert.ok(Date.now() - t0 < 500, `40 boxes laid out quickly (${Date.now() - t0} ms)`);
const bb2 = [...B.boxes.values()];
for (let i = 0; i < bb2.length; i += 1) for (let j = i + 1; j < bb2.length; j += 1) assert.ok(!overlap(bb2[i], bb2[j]), 'no overlap in the biggest diagram');
// a star (mind map style) with 30 branches
const starNodes = [N('c', 'Centre'), ...Array.from({ length: 30 }, (_, i) => N(`b${i}`, `Branch ${i}`))];
const S = layoutDiagram({ kind: 'mindmap', direction: 'right', nodes: starNodes, edges: starNodes.slice(1).map((n) => E('c', n.id)) });
const sb = [...S.boxes.values()];
for (let i = 0; i < sb.length; i += 1) for (let j = i + 1; j < sb.length; j += 1) assert.ok(!overlap(sb[i], sb[j]), 'no overlap in a wide star');
// ---- loops and skipped steps go round the outside; two-way arrows have a head at each end ----
const loopDia = { kind: 'flow', direction: 'down', nodes: [N('a', 'Start', 'start-end'), N('b', 'Check the work'), N('c', 'Approved?', 'decision'), N('d', 'Fix it'), N('e', 'Finish', 'start-end')],
  edges: [E('a', 'b'), E('b', 'c'), E('c', 'e', 'yes'), E('c', 'd', 'no'), E('d', 'b', 'try again')] };
const LP = layoutDiagram(loopDia, { runId: 'lp' });
const rightmost = Math.max(...[...LP.boxes.values()].map((b) => b.x + b.w));
const loopArrow = LP.skeleton.find((s) => s.type === 'arrow' && s.start.id === 'vd-lp-d' && s.end.id === 'vd-lp-b');
assert.ok(loopArrow.points.length >= 4, 'a loop is a path with corners, not a straight line');
assert.strictEqual(loopArrow.roundness, null, 'with sharp corners');
const abs = loopArrow.points.map(([dx, dy]) => [loopArrow.x + dx, loopArrow.y + dy]);
const bd = LP.boxes.get('d'); const bb3 = LP.boxes.get('b');
assert.deepStrictEqual(abs[abs.length - 1], [bb3.x + bb3.w, bb3.y + bb3.h / 2], 'it returns to the right side of the earlier box');
assert.ok(abs.slice(1, -1).some(([x]) => x > rightmost), 'its way back runs outside every box');
assert.strictEqual(LP.routed, 1, 'only the loop is routed round; the other arrows stay straight');
assert.strictEqual(loopArrow.label.text, 'try again', 'a loop arrow keeps its label');
assert.ok(LP.width >= Math.max(...abs.map(([x]) => x)), 'the reported size includes the lane');
// in this diagram "Fix it" has "Finish" beside it, so the loop must NOT leave sideways through it: it leaves from underneath
assert.deepStrictEqual(abs[0], [bd.x + bd.w / 2, bd.y + bd.h], 'with a box beside it, the loop leaves from the bottom');
// and no part of any loop path runs through another box
const pathClear = (pts, from, to, boxesMap) => pts.slice(1).every((pt, i) => [...boxesMap.entries()].every(([id, bx]) => id === from || id === to || !segmentHitsBox(pts[i][0], pts[i][1], pt[0], pt[1], bx)));
assert.ok(pathClear(abs, 'd', 'b', LP.boxes), 'the loop path never passes through a box');
// with nothing beside it, a loop leaves the right side
const plain = layoutDiagram({ kind: 'flow', direction: 'down', nodes: [N('a'), N('b'), N('c')], edges: [E('a', 'b'), E('b', 'c'), E('c', 'a', 'again')] }, { runId: 'pl' });
const pArrow = plain.skeleton.find((s) => s.type === 'arrow' && s.start.id === 'vd-pl-c');
const pc = plain.boxes.get('c');
assert.deepStrictEqual([pArrow.x, pArrow.y], [pc.x + pc.w, pc.y + pc.h / 2], 'a loop with nothing beside it leaves the right side');
assert.strictEqual(pArrow.points.length, 4);
// two loops get their own lanes
const twoLoops = layoutDiagram({ kind: 'flow', direction: 'down', nodes: [N('a'), N('b'), N('c'), N('d')], edges: [E('a', 'b'), E('b', 'c'), E('c', 'd'), E('c', 'a', 'redo'), E('d', 'b', 'retry')] }, { runId: 't2' });
const lanesX = twoLoops.skeleton.filter((s) => s.type === 'arrow' && s.points.length >= 4).map((s) => Math.max(...s.points.map(([dx]) => s.x + dx)));
assert.strictEqual(new Set(lanesX).size, 2, 'two loops do not share a lane');
// a step that skips over another is routed round only when a straight line would cross a box
const skip = layoutDiagram({ kind: 'flow', direction: 'down', nodes: [N('a'), N('b'), N('c')], edges: [E('a', 'b'), E('b', 'c'), E('a', 'c', 'skip')] }, { runId: 'sk' });
assert.strictEqual(skip.skeleton.find((s) => s.type === 'arrow' && s.start.id === 'vd-sk-a' && s.end.id === 'vd-sk-c').points.length, 4, 'a line from first to last would cross the middle box');
const sideBySide = layoutDiagram({ kind: 'flow', direction: 'down', nodes: [N('a'), N('b'), N('c'), N('d')], edges: [E('a', 'b'), E('a', 'c'), E('b', 'd'), E('c', 'd')] }, { runId: 'sb' });
assert.strictEqual(sideBySide.routed, 0, 'an ordinary diagram has no routed arrows');
// left to right: the way back runs underneath
const lr = layoutDiagram({ ...loopDia, direction: 'right' }, { runId: 'lr' });
const lrArrow = lr.skeleton.find((s) => s.type === 'arrow' && s.start.id === 'vd-lr-d' && s.end.id === 'vd-lr-b');
const lrBottom = Math.max(...[...lr.boxes.values()].map((b) => b.y + b.h));
assert.ok(Math.max(...lrArrow.points.map(([, dy]) => lrArrow.y + dy)) > lrBottom, 'left to right: the loop goes below every box');
const lrAbs = lrArrow.points.map(([dx, dy]) => [lrArrow.x + dx, lrArrow.y + dy]);
assert.ok(pathClear(lrAbs, 'd', 'b', lr.boxes), 'left to right: the loop path never passes through a box either');
// the line test
assert.ok(segmentHitsBox(0, 50, 200, 50, { x: 80, y: 20, w: 40, h: 60 }), 'a line through a box hits it');
assert.ok(!segmentHitsBox(0, 0, 200, 0, { x: 80, y: 20, w: 40, h: 60 }), 'a line above it does not');
assert.ok(!segmentHitsBox(0, 50, 70, 50, { x: 80, y: 20, w: 40, h: 60 }), 'a line that stops short does not');
// a no-loop diagram still has no loops, and a two-way arrow has a head at both ends
const tw = layoutDiagram({ kind: 'flow', direction: 'down', nodes: [N('a'), N('b')], edges: [{ from: 'a', to: 'b', both: true }, ] }, { runId: 'tw' });
const twArrow = tw.skeleton.find((s) => s.type === 'arrow');
assert.deepStrictEqual([twArrow.startArrowhead, twArrow.endArrowhead], ['arrow', 'arrow'], 'a head at each end');
assert.deepStrictEqual([L.skeleton.find((s) => s.type === 'arrow').startArrowhead], [null], 'an ordinary arrow has none at the start');

assert.deepStrictEqual(SHAPE_TO_TYPE, { box: 'rectangle', decision: 'diamond', 'start-end': 'ellipse' });

const numLayout = layoutDiagram({ kind: 'flow', direction: 'down', nodes: [{ id: 'a', label: 'A', shape: 'box', num: '4.1' }, { id: 'b', label: 'B', shape: 'box' }], edges: [{ from: 'a', to: 'b' }] }, { runId: 'nm' });
const boxA = numLayout.skeleton.find((x) => x.id === 'vd-nm-a'); const boxB = numLayout.skeleton.find((x) => x.id === 'vd-nm-b');
assert.strictEqual(boxA.customData.vaultNo, '4.1', 'a box keeps its number');
assert.strictEqual(boxB.customData.vaultNo, undefined, 'a box with no number gets none from the layout');
console.log('diagramLayout tests: all ok');
