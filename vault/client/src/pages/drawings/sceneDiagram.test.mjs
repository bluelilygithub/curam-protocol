// node client/src/pages/drawings/sceneDiagram.test.mjs
import assert from 'node:assert';
import { readDiagram, numberingInput } from './sceneDiagram.mjs';

const box = (id, type, x, y) => ({ id, type, x, y, width: 120, height: 60, isDeleted: false });
const txt = (id, container, text) => ({ id, type: 'text', containerId: container, text, isDeleted: false });
const arrow = (id, from, to, extra = {}) => ({ id, type: 'arrow', x: 0, y: 0, width: 1, height: 1, isDeleted: false, startBinding: { elementId: from }, endBinding: { elementId: to }, startArrowhead: null, endArrowhead: 'arrow', ...extra });

const els = [
  box('A', 'ellipse', 0, 0), txt('tA', 'A', 'Start'),
  box('B', 'rectangle', 0, 100), txt('tB', 'B', 'Send\ninvoice'),
  box('C', 'diamond', 0, 200), txt('tC', 'C', 'Deposit paid?'),
  box('D', 'rectangle', 0, 300), txt('tD', 'D', 'Start work'),
  arrow('e1', 'A', 'B'), arrow('e2', 'B', 'C'),
  arrow('e3', 'C', 'D'), txt('l3', 'e3', 'yes'),
  arrow('e4', 'C', 'B'), txt('l4', 'e4', 'no'),
  // things that are not part of a diagram
  { id: 'free', type: 'arrow', x: 5, y: 5, width: 50, height: 0, isDeleted: false, startBinding: null, endBinding: null },
  { id: 'note', type: 'text', x: 400, y: 0, text: 'hello', isDeleted: false },
  box('Z', 'rectangle', 600, 0), // a box with no writing is not a step
];

const r = readDiagram(els);
assert.strictEqual(r.count, 4, 'four steps found');
assert.deepStrictEqual(r.diagram.nodes.map((n) => [n.label, n.shape]), [['Start', 'start-end'], ['Send invoice', 'box'], ['Deposit paid?', 'decision'], ['Start work', 'box']], 'shapes and tidy labels, in reading order');
assert.strictEqual(r.diagram.direction, 'down');
const byLabel = (id) => r.diagram.nodes.find((n) => n.id === id).label;
const named = r.diagram.edges.map((e) => `${byLabel(e.from)}>${byLabel(e.to)}${e.label ? `:${e.label}` : ''}`);
assert.deepStrictEqual(named.sort(), ['Deposit paid?>Send invoice:no', 'Deposit paid?>Start work:yes', 'Send invoice>Deposit paid?', 'Start>Send invoice'].sort(), 'arrows, labels and the loop back are read');
for (const id of ['A', 'tA', 'B', 'tB', 'C', 'D', 'e1', 'e4', 'l3', 'l4']) assert.ok(r.ids.has(id), `${id} belongs to the diagram`);
for (const id of ['free', 'note', 'Z']) assert.ok(!r.ids.has(id), `${id} is left alone`);

// two-way arrow
const two = readDiagram([box('A', 'rectangle', 0, 0), txt('ta', 'A', 'Sales'), box('B', 'rectangle', 200, 0), txt('tb', 'B', 'Ops'), arrow('e', 'A', 'B', { startArrowhead: 'arrow' })]);
assert.strictEqual(two.diagram.edges[0].both, true, 'two-way arrow is read');
assert.strictEqual(two.diagram.direction, 'right', 'side by side reads as left to right');

// nothing to read
assert.strictEqual(readDiagram([]), null);
assert.strictEqual(readDiagram([box('A', 'rectangle', 0, 0), txt('ta', 'A', 'Lonely')]), null, 'one box is not a diagram');
assert.strictEqual(readDiagram([box('A', 'rectangle', 0, 0), txt('ta', 'A', 'x'), box('B', 'rectangle', 0, 100), txt('tb', 'B', 'y')]), null, 'boxes with no arrow between them are not a diagram');

// two diagrams on one drawing: the selected one, else the bigger one
const second = [box('P', 'rectangle', 800, 0), txt('tp', 'P', 'One'), box('Q', 'rectangle', 800, 100), txt('tq', 'Q', 'Two'), arrow('pq', 'P', 'Q')];
const both = [...els, ...second];
assert.strictEqual(readDiagram(both).count, 4, 'the bigger diagram when nothing is selected');
assert.strictEqual(readDiagram(both).others, 1, 'it says there is another');
const sel = readDiagram(both, { P: true });
assert.strictEqual(sel.count, 2, 'the selected diagram when something is selected');
assert.ok(sel.ids.has('pq') && !sel.ids.has('e1'));
assert.strictEqual(readDiagram(both, new Set(['pq'])).count, 2, 'selecting just an arrow picks its diagram');

// deleted pieces do not count
assert.strictEqual(readDiagram(els.map((e) => (e.id === 'D' || e.id === 'tD' ? { ...e, isDeleted: true } : e))).count, 3);

// too big
const many = []; for (let i = 0; i < 41; i++) { many.push(box(`b${i}`, 'rectangle', 0, i * 100), txt(`t${i}`, `b${i}`, `s${i}`)); if (i) many.push(arrow(`a${i}`, `b${i - 1}`, `b${i}`)); }
assert.strictEqual(readDiagram(many).tooBig, true, 'a diagram over the limit is reported, not cut');

// numbers on boxes are read, and offered for numbering
const numbered = els.map((e) => (e.id === 'B' ? { ...e, customData: { vaultNo: '2' } } : e.id === 'C' ? { ...e, customData: { vaultNo: '7' } } : e.id === 'Z' ? { ...e, isDeleted: true, customData: { vaultNo: '9' } } : e));
const rn = readDiagram(numbered);
assert.deepStrictEqual(rn.diagram.nodes.map((n) => n.num), [undefined, '2', '7', undefined], 'numbers are carried into the diagram');
const ni = numberingInput(numbered);
assert.deepStrictEqual(ni.boxes.map((b) => [b.id, b.num]), [['A', undefined], ['B', '2'], ['C', '7'], ['D', undefined]], 'boxes in reading order with their numbers');
assert.ok(ni.taken.includes('9') && ni.taken.includes('2'), 'the number of a deleted box is still counted as used');
assert.ok(ni.edges.some((e) => e.from === 'C' && e.to === 'B'), 'arrows between boxes are given');

const copy = els.map((e) => (e.id === 'B' || e.id === 'D' ? { ...e, customData: { vaultNo: '2' } } : e));
assert.deepStrictEqual(numberingInput(copy).boxes.map((b) => b.num), [undefined, '2', undefined, undefined], 'a copied box with a repeated number counts as unnumbered');

console.log('sceneDiagram tests: all ok');
