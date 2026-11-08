// "Draw it for me": turns the STRUCTURE of a diagram (boxes, arrows, labels, from server/services/drawingDiagram.js) into a tidy layout, as the
// "skeleton" elements Excalidraw's own convertToExcalidrawElements understands. The AI never chooses positions; this does. Pure, so it is
// unit-tested:  node client/src/pages/drawings/diagramLayout.test.mjs
//
// Layout: boxes go in layers (a flow top to bottom or left to right; an org chart or mind map from its first box outward), each layer
// centred, in an order that keeps arrows from crossing where it can be done cheaply. Boxes are sized to their wrapped labels.

const GAP_MAIN = 90; // between layers
const GAP_CROSS = 44; // between boxes in a layer
const MIN_W = 120;
const MAX_W = 270;
const CHAR_W = 9.6; // an average letter at the text size used
const LINE_H = 24;
const FONT = 18;

export const SHAPE_TO_TYPE = { box: 'rectangle', decision: 'diamond', 'start-end': 'ellipse' };

/** A label broken into lines of about `max` letters, on word boundaries (a very long word is cut). */
export function wrapLabel(text, max = 22) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (let w of words) {
    while (w.length > max) { if (cur) { lines.push(cur); cur = ''; } lines.push(w.slice(0, max)); w = w.slice(max); }
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= max) cur += ` ${w}`;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

/** The size of a box for its label and shape. A diamond and an ellipse need more room around the same words. */
export function nodeSize(node) {
  const lines = wrapLabel(node.label);
  const longest = Math.max(...lines.map((l) => l.length));
  let w = Math.min(MAX_W, Math.max(MIN_W, Math.round(longest * CHAR_W + 40)));
  let h = Math.max(60, lines.length * LINE_H + 34);
  if (node.shape === 'decision') { w = Math.round(w * 1.8); h = Math.round(h * 1.9); } // the writing has to fit inside the diamond's middle
  else if (node.shape === 'start-end') { w = Math.round(w * 1.1); h = Math.round(h * 1.15); }
  return { w, h, text: lines.join('\n') };
}

/**
 * Which layer each box is in. Arrows go from a lower layer to a higher one; an arrow that would loop back is ignored for the layering (so a
 * cycle, such as "no, try again", never breaks it). Boxes nothing leads to start layer 0; a diagram that is one big loop starts at its first box.
 */
export function assignLevels(nodes, edges) {
  const ids = nodes.map((n) => n.id);
  const out = new Map(ids.map((id) => [id, []]));
  const indeg = new Map(ids.map((id) => [id, 0]));
  for (const e of edges) { if (out.has(e.from) && out.has(e.to)) { out.get(e.from).push(e.to); indeg.set(e.to, indeg.get(e.to) + 1); } }
  // depth-first from the roots to find the forward arrows (the ones that do not return to a box still being visited)
  const state = new Map(); // 1 visiting, 2 done
  const forward = new Map(ids.map((id) => [id, []]));
  const visit = (start) => {
    const stack = [[start, 0]];
    state.set(start, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const [id, i] = top;
      const next = out.get(id)[i];
      if (next === undefined) { state.set(id, 2); stack.pop(); continue; }
      top[1] += 1;
      if (state.get(next) === 1) continue; // a back arrow: ignored
      forward.get(id).push(next);
      if (!state.has(next)) { state.set(next, 1); stack.push([next, 0]); }
    }
  };
  const roots = ids.filter((id) => indeg.get(id) === 0);
  for (const r of roots) if (!state.has(r)) visit(r);
  for (const id of ids) if (!state.has(id)) visit(id);
  // longest path from a root along the forward arrows (it is acyclic now), so every arrow points to a later layer
  const level = new Map(ids.map((id) => [id, 0]));
  const order = [];
  const seen = new Set();
  const topo = (id) => { if (seen.has(id)) return; seen.add(id); for (const n of forward.get(id)) topo(n); order.push(id); };
  for (const id of ids) topo(id);
  for (const id of order.reverse()) for (const n of forward.get(id)) level.set(n, Math.max(level.get(n), level.get(id) + 1));
  return level;
}

/**
 * @param {{ kind: string, direction: 'down'|'right', nodes: {id,label,shape}[], edges: {from,to,label?}[] }} diagram
 * @param {{ origin?: {x:number,y:number}, runId?: string }} [opts]  origin is where the top-left corner of the diagram goes
 * @returns {{ skeleton: object[], width: number, height: number, boxes: Map }}  skeleton goes to convertToExcalidrawElements
 */
export function layoutDiagram(diagram, { origin = { x: 0, y: 0 }, runId = 'run' } = {}) {
  const nodes = diagram.nodes;
  const edges = diagram.edges.filter((e) => nodes.some((n) => n.id === e.from) && nodes.some((n) => n.id === e.to));
  const horizontal = diagram.direction === 'right';
  const size = new Map(nodes.map((n) => [n.id, nodeSize(n)]));
  const level = assignLevels(nodes, edges);
  const maxLevel = Math.max(0, ...level.values());

  // the boxes of each layer, in the order given, then moved towards the average position of the boxes that lead to them
  const layers = Array.from({ length: maxLevel + 1 }, () => []);
  for (const n of nodes) layers[level.get(n.id)].push(n.id);
  const place = new Map();
  layers.forEach((layer, li) => {
    if (li > 0) {
      const bary = (id) => {
        const from = edges.filter((e) => e.to === id && level.get(e.from) < li).map((e) => place.get(e.from)).filter((v) => v !== undefined);
        return from.length ? from.reduce((a, b) => a + b, 0) / from.length : Infinity;
      };
      const ranked = layer.map((id, i) => ({ id, b: bary(id), i }));
      ranked.sort((a, b) => (a.b === b.b ? a.i - b.i : a.b - b.b));
      layer.splice(0, layer.length, ...ranked.map((r) => r.id));
    }
    layer.forEach((id, i) => place.set(id, i));
  });

  // along the layers (main axis) and across them (cross axis)
  const crossOf = (id) => (horizontal ? size.get(id).h : size.get(id).w);
  const mainOf = (id) => (horizontal ? size.get(id).w : size.get(id).h);
  const layerCross = layers.map((l) => l.reduce((a, id) => a + crossOf(id), 0) + GAP_CROSS * Math.max(0, l.length - 1));
  const layerMain = layers.map((l) => Math.max(0, ...l.map(mainOf)));
  const widest = Math.max(...layerCross);
  const boxes = new Map();
  let main = 0;
  layers.forEach((layer, li) => {
    let cross = (widest - layerCross[li]) / 2;
    for (const id of layer) {
      const s = size.get(id);
      const mainPos = main + (layerMain[li] - mainOf(id)) / 2;
      const x = origin.x + (horizontal ? mainPos : cross);
      const y = origin.y + (horizontal ? cross : mainPos);
      boxes.set(id, { x: Math.round(x), y: Math.round(y), w: s.w, h: s.h });
      cross += crossOf(id) + GAP_CROSS;
    }
    main += layerMain[li] + GAP_MAIN;
  });
  const width = horizontal ? main - GAP_MAIN : widest;
  const height = horizontal ? widest : main - GAP_MAIN;

  // An arrow that goes BACK to an earlier layer (a loop: "no, try again") is routed round the outside of the diagram, one lane each,
  // so it never runs through the boxes in between. A forward arrow that skips layers is routed the same way only when a straight line
  // would cross another box.
  const right = Math.max(...[...boxes.values()].map((b) => b.x + b.w));
  const bottom = Math.max(...[...boxes.values()].map((b) => b.y + b.h));
  let lanes = 0;
  let farRight = right;
  let farBottom = bottom;
  const routes = new Map(); // edge -> { start: [x, y], points: [[dx, dy], ...] } for the arrows that go round
  for (const e of edges) {
    const a = boxes.get(e.from);
    const b = boxes.get(e.to);
    const loop = level.get(e.to) < level.get(e.from);
    const [sx, sy, ex, ey] = edgePoints(a, b);
    const blocked = !loop && [...boxes.entries()].some(([id, box]) => id !== e.from && id !== e.to && segmentHitsBox(sx, sy, ex, ey, box));
    if (!loop && !blocked) continue;
    const k = lanes++;
    const others = [...boxes.entries()].filter(([id]) => id !== e.from && id !== e.to).map(([, box]) => box);
    const clear = (x1, y1, x2, y2) => !others.some((box) => segmentHitsBox(x1, y1, x2, y2, box));
    let path; // absolute points, first to last
    if (!horizontal) {
      const laneX = right + 50 + 30 * k;
      const t = [b.x + b.w, b.y + b.h / 2];
      const sideExit = [a.x + a.w, a.y + a.h / 2];
      if (clear(sideExit[0], sideExit[1], laneX, sideExit[1])) {
        path = [sideExit, [laneX, sideExit[1]], [laneX, t[1]], t]; // out of the right side, along the lane, back in
      } else { // a box sits beside this one: leave from underneath, in the gap before the next layer
        const rowBottom = Math.max(...layers[level.get(e.from)].map((id) => boxes.get(id).y + boxes.get(id).h));
        const gapY = rowBottom + 24;
        path = [[a.x + a.w / 2, a.y + a.h], [a.x + a.w / 2, gapY], [laneX, gapY], [laneX, t[1]], t];
      }
      farRight = Math.max(farRight, laneX);
    } else {
      const laneY = bottom + 50 + 30 * k;
      const t = [b.x + b.w / 2, b.y + b.h];
      const underExit = [a.x + a.w / 2, a.y + a.h];
      if (clear(underExit[0], underExit[1], underExit[0], laneY)) {
        path = [underExit, [underExit[0], laneY], [t[0], laneY], t]; // out of the bottom, along the lane, back up
      } else { // a box sits underneath: leave from the right side, in the gap before the next layer
        const colRight = Math.max(...layers[level.get(e.from)].map((id) => boxes.get(id).x + boxes.get(id).w));
        const gapX = colRight + 24;
        path = [[a.x + a.w, a.y + a.h / 2], [gapX, a.y + a.h / 2], [gapX, laneY], [t[0], laneY], t];
      }
      farBottom = Math.max(farBottom, laneY);
    }
    routes.set(e, { start: path[0], points: path.map(([px, py]) => [px - path[0][0], py - path[0][1]]) });
  }

  const tag = { vaultDiagram: { run: runId } };
  const skeleton = [];
  for (const n of nodes) {
    const b = boxes.get(n.id);
    skeleton.push({
      type: SHAPE_TO_TYPE[n.shape] || 'rectangle', id: `vd-${runId}-${n.id}`, x: b.x, y: b.y, width: b.w, height: b.h,
      label: { text: size.get(n.id).text, fontSize: FONT }, customData: n.num ? { ...tag, vaultNo: n.num } : tag, // the shape's number stays with it
    });
  }
  for (const e of edges) {
    const a = boxes.get(e.from);
    const b = boxes.get(e.to);
    const [sx, sy, ex, ey] = edgePoints(a, b);
    const route = routes.get(e);
    skeleton.push({
      type: 'arrow',
      ...(route ? { x: route.start[0], y: route.start[1], points: route.points, roundness: null } : { x: sx, y: sy, points: [[0, 0], [ex - sx, ey - sy]] }),
      start: { id: `vd-${runId}-${e.from}` }, end: { id: `vd-${runId}-${e.to}` }, endArrowhead: 'arrow', startArrowhead: e.both ? 'arrow' : null,
      ...(e.label ? { label: { text: e.label, fontSize: 16 } } : {}), customData: tag,
    });
  }
  return { skeleton, width: Math.max(width, farRight - origin.x), height: Math.max(height, farBottom - origin.y), boxes, routed: routes.size };
}

/** Does the straight line from (x1, y1) to (x2, y2) pass through the box (a few pixels in from its edge)? */
export function segmentHitsBox(x1, y1, x2, y2, box, inset = 4) {
  const minX = box.x + inset; const maxX = box.x + box.w - inset; const minY = box.y + inset; const maxY = box.y + box.h - inset;
  let t0 = 0; let t1 = 1;
  const dx = x2 - x1; const dy = y2 - y1;
  for (const [p, q] of [[-dx, x1 - minX], [dx, maxX - x1], [-dy, y1 - minY], [dy, maxY - y1]]) {
    if (p === 0) { if (q < 0) return false; } else {
      const r = q / p;
      if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
    }
  }
  return t0 < t1;
}

/** Where an arrow between two boxes starts and ends: the centre-to-centre line, clipped to each box's edge. */
export function edgePoints(a, b) {
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const clip = (box, from, to) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (!dx && !dy) return from;
    const tx = dx ? (box.w / 2) / Math.abs(dx) : Infinity;
    const ty = dy ? (box.h / 2) / Math.abs(dy) : Infinity;
    const t = Math.min(tx, ty);
    return { x: from.x + dx * t, y: from.y + dy * t };
  };
  const s = clip(a, ac, bc);
  const e = clip(b, bc, ac);
  return [Math.round(s.x), Math.round(s.y), Math.round(e.x), Math.round(e.y)];
}
