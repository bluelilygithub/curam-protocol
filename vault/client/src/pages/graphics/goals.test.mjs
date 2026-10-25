// node client/src/pages/graphics/goals.test.mjs   (npm run test:graphics-goals)
// Every goal step must name a tool that really exists in the Graphics page, and have a note.
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GOALS, stepIndex } from './goals.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const page = fs.readFileSync(path.join(here, '..', 'GraphicsPage.jsx'), 'utf8');
const registry = fs.readFileSync(path.join(here, 'toolRegistry.js'), 'utf8');
const modes = new Set([...page.slice(page.indexOf('const MODES = ['), page.indexOf('];', page.indexOf('const MODES = ['))).matchAll(/id: '([a-z0-9]+)'/g)].map((m) => m[1]));
const registered = new Set([...registry.matchAll(/^\s{2}([a-z0-9]+): lazy/gm)].map((m) => m[1]));
assert.ok(modes.size > 30, 'could not read MODES from GraphicsPage.jsx');

const ids = new Set();
for (const g of GOALS) {
  assert.ok(g.id && g.title && g.blurb && g.icon, `goal ${g.id} needs id, title, blurb, icon`);
  assert.ok(!ids.has(g.id), `duplicate goal id ${g.id}`);
  ids.add(g.id);
  assert.ok(g.steps.length >= 2, `goal ${g.id} needs at least two steps`);
  const seen = new Set();
  for (const s of g.steps) {
    assert.ok(modes.has(s.tool), `goal ${g.id}: "${s.tool}" is not a tool in MODES`);
    assert.ok(registered.has(s.tool), `goal ${g.id}: "${s.tool}" is not in toolRegistry.js`);
    assert.ok(s.note && s.note.length < 90, `goal ${g.id}: step ${s.tool} needs a short note`);
    assert.ok(!seen.has(s.tool), `goal ${g.id}: ${s.tool} appears twice`);
    seen.add(s.tool);
  }
}
assert.strictEqual(stepIndex(GOALS[0], 'watermark'), 1);
assert.strictEqual(stepIndex(GOALS[0], 'convert'), -1);
assert.strictEqual(stepIndex(null, 'convert'), -1);
console.log(`graphics goals: ok (${GOALS.length} goals)`);
