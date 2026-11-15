// node client/src/pages/restyle/restyleGoals.test.mjs
// Every Style editor job step must name a tool that really exists in RESTYLE_TOOLS, and every icon must be in iconMap.js.
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { RESTYLE_GOALS } from './restyleGoals.mjs';
import { RESTYLE_TOOLS } from './restyleTools.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const iconMap = fs.readFileSync(path.join(here, '..', '..', 'providers', 'iconMap.js'), 'utf8');
const tools = new Set(RESTYLE_TOOLS.map((t) => t.id));

const ids = new Set();
for (const g of RESTYLE_GOALS) {
  assert.ok(g.id && g.title && g.blurb && g.icon, `job ${g.id} needs id, title, blurb, icon`);
  assert.ok(new RegExp(`^\\s*'?${g.icon}'?:`, 'm').test(iconMap), `job ${g.id}: icon "${g.icon}" is not in iconMap.js`);
  assert.ok(!ids.has(g.id), `duplicate job id ${g.id}`);
  ids.add(g.id);
  assert.ok(g.steps.length >= 2, `job ${g.id} needs at least two steps`);
  const seen = new Set();
  for (const s of g.steps) {
    assert.ok(tools.has(s.tool), `job ${g.id}: "${s.tool}" is not a tool in RESTYLE_TOOLS`);
    assert.ok(s.note && s.note.length < 90, `job ${g.id}: step ${s.tool} needs a short note`);
    assert.ok(!seen.has(s.tool), `job ${g.id}: ${s.tool} appears twice`);
    seen.add(s.tool);
  }
}
console.log(`restyle goals: ok (${RESTYLE_GOALS.length} jobs, ${tools.size} tools)`);
