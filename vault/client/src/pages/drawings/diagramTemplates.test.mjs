// node client/src/pages/drawings/diagramTemplates.test.mjs
import assert from 'node:assert';
import { TEMPLATES, TEMPLATE_GROUPS, MAX_NODES, buildTemplate, defaultValues } from './diagramTemplates.mjs';
import { layoutDiagram } from './diagramLayout.mjs';

const ids = new Set();
for (const t of TEMPLATES) {
  assert.ok(!ids.has(t.id), `unique id ${t.id}`); ids.add(t.id);
  assert.ok(TEMPLATE_GROUPS.includes(t.group), `${t.id} is in a known group`);
  // every template, at its defaults, at its smallest and at its largest, is a valid diagram within the voice-change limit
  const at = (pickFn) => Object.fromEntries(t.options.map((op) => [op.key, op.type === 'number' ? pickFn(op) : op.default]));
  for (const values of [defaultValues(t), at((op) => op.min), at((op) => op.max)]) {
    for (const dir of ['down', 'right']) {
      const d = buildTemplate(t.id, values, dir);
      assert.strictEqual(d.direction, dir);
      assert.ok(d.nodes.length >= 1 && d.nodes.length <= MAX_NODES, `${t.id} has 1..${MAX_NODES} boxes (got ${d.nodes.length})`);
      const nodeIds = new Set(d.nodes.map((n) => n.id));
      assert.strictEqual(nodeIds.size, d.nodes.length, `${t.id} node ids are unique`);
      for (const e of d.edges) assert.ok(nodeIds.has(e.from) && nodeIds.has(e.to) && e.from !== e.to, `${t.id} arrows join real boxes`);
      for (const n of d.nodes) assert.ok(n.label && n.label.length <= 60, `${t.id} labels are short`);
      assert.ok(layoutDiagram(d).skeleton.length > 0, `${t.id} lays out`);
    }
  }
}

// values are cleaned: out of range is clamped, rubbish falls back to the default, no direction means the template's own
const org = buildTemplate('org-standard', { managers: 99, staff: 'lots' });
assert.strictEqual(org.direction, 'down');
assert.strictEqual(org.nodes.filter((n) => n.label.startsWith('Manager')).length, 6);
assert.strictEqual(org.nodes.filter((n) => n.label.startsWith('Team member')).length, 6 * 2);
assert.deepStrictEqual(buildTemplate('timeline-months', { start: 'November', months: 3 }).nodes.map((n) => n.label), ['November', 'December', 'January']);
assert.deepStrictEqual(buildTemplate('timeline-quarters', { year: 2027, years: 1 }).nodes.map((n) => n.label), ['Q1 2027', 'Q2 2027', 'Q3 2027', 'Q4 2027']);
assert.strictEqual(buildTemplate('timeline-months', { start: 'Smarch' }).nodes.length, 6, 'an unknown month falls back to the default');
assert.throws(() => buildTemplate('nope'));

console.log(`diagramTemplates: ${TEMPLATES.length} templates ok`);
