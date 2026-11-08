// Reads a diagram back OUT of a drawing: the boxes (with writing in them) and the arrows joined to them become the same structure
// the AI works with (nodes and edges), so any diagram on the drawing can be changed by voice, however it was made and however long ago.
// Pure functions, no board: tested with `node client/src/pages/drawings/sceneDiagram.test.mjs`.

const SHAPE_OF = { rectangle: 'box', diamond: 'decision', ellipse: 'start-end' };
const MAX_NODES = 40;

const tidy = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/**
 * @param {Array} elements  the drawing's elements
 * @param {Set|Object} [selectedIds]  ids selected on the board: when there are some, the diagram that contains them is the one read
 * @returns {null | { diagram: object, ids: Set<string>, count: number, others: number }}
 *   diagram: { kind, direction, nodes, edges } ; ids: every piece that belongs to it (boxes, their writing, arrows, their labels);
 *   others: how many separate diagrams were found besides this one
 */
export function readDiagram(elements, selectedIds) {
  const live = (elements || []).filter((e) => e && !e.isDeleted);
  const textOf = new Map(); // container id -> writing inside it
  for (const e of live) if (e.type === 'text' && e.containerId) textOf.set(e.containerId, e);

  const nodes = [];
  const byId = new Map();
  for (const e of live) {
    const shape = SHAPE_OF[e.type];
    const t = textOf.get(e.id);
    if (!shape || !t || !tidy(t.text)) continue;
    const node = { el: e, text: t, shape, label: tidy(t.text) };
    nodes.push(node);
    byId.set(e.id, node);
  }
  if (nodes.length < 2) return null;

  const edges = [];
  for (const e of live) {
    if (e.type !== 'arrow') continue;
    const a = e.startBinding && byId.get(e.startBinding.elementId);
    const b = e.endBinding && byId.get(e.endBinding.elementId);
    if (!a || !b || a === b) continue;
    const lab = textOf.get(e.id);
    edges.push({ el: e, from: a, to: b, label: lab ? tidy(lab.text) : '', labelEl: lab || null, both: !!e.startArrowhead && !!e.endArrowhead });
  }
  if (!edges.length) return null;

  // separate diagrams on one drawing: groups of boxes joined by arrows
  const parent = new Map(nodes.map((n) => [n, n]));
  const find = (n) => { while (parent.get(n) !== n) { parent.set(n, parent.get(parent.get(n))); n = parent.get(n); } return n; };
  for (const e of edges) parent.set(find(e.from), find(e.to));
  const groups = new Map();
  for (const n of nodes) { const r = find(n); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(n); }
  const lists = [...groups.values()].filter((g) => g.length > 1);
  if (!lists.length) return null;

  const picked = selectedIds instanceof Set ? selectedIds : new Set(Object.keys(selectedIds || {}).filter((k) => selectedIds[k]));
  let group = null;
  if (picked.size) {
    group = lists.find((g) => g.some((n) => picked.has(n.el.id) || picked.has(n.text.id)))
      || lists.find((g) => edges.some((e) => picked.has(e.el.id) && g.includes(e.from)));
  }
  if (!group) group = lists.slice().sort((x, y) => y.length - x.length)[0]; // else the biggest one
  if (group.length > MAX_NODES) return { tooBig: true, count: group.length };

  const inGroup = new Set(group);
  const gEdges = edges.filter((e) => inGroup.has(e.from));
  // reading order, so the ids come out in the order a person would read the boxes
  const ordered = group.slice().sort((p, q) => (p.el.y - q.el.y) || (p.el.x - q.el.x));
  const idOf = new Map(ordered.map((n, i) => [n, `n${i + 1}`]));

  const xs = ordered.map((n) => n.el.x + n.el.width / 2);
  const ys = ordered.map((n) => n.el.y + n.el.height / 2);
  const spread = (v) => Math.max(...v) - Math.min(...v);
  const direction = spread(xs) > spread(ys) * 1.2 ? 'right' : 'down';

  const outEdges = []; const seen = new Set();
  for (const e of gEdges) {
    const key = `${idOf.get(e.from)}>${idOf.get(e.to)}`;
    if (seen.has(key)) continue; // two arrows between the same boxes the same way are one
    seen.add(key);
    outEdges.push({ from: idOf.get(e.from), to: idOf.get(e.to), ...(e.label ? { label: e.label } : {}), ...(e.both ? { both: true } : {}) });
  }

  const ids = new Set();
  for (const n of group) { ids.add(n.el.id); ids.add(n.text.id); }
  for (const e of gEdges) { ids.add(e.el.id); if (e.labelEl) ids.add(e.labelEl.id); }

  return {
    diagram: { kind: 'flow', direction, nodes: ordered.map((n) => ({ id: idOf.get(n), label: n.label, shape: n.shape })), edges: outEdges },
    ids,
    count: ordered.length,
    others: lists.length - 1,
  };
}
