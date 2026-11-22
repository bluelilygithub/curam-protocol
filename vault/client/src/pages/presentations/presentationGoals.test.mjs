// node client/src/pages/presentations/presentationGoals.test.mjs
// Every job step must name a tool that really exists in toolRegistry.js.
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PRESENTATION_GOALS, stepIndex } from './presentationGoals.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const registry = fs.readFileSync(path.join(here, 'toolRegistry.js'), 'utf8');
const registered = new Set([...registry.matchAll(/^\s{2}([a-z0-9]+):\s*lazy\(/gm)].map((m) => m[1]));

for (const id of ['create', 'import', 'templates', 'slides', 'export', 'decks']) {
  assert.ok(registered.has(id), `toolRegistry.js is missing "${id}"`);
}
assert.strictEqual(registered.size, 6, 'Presentations should have exactly six tools');

// The four start-screen jobs are fixed by the product spec.
const expected = {
  brief: ['create', 'slides', 'export'],
  document: ['import', 'create', 'slides', 'export'],
  brand: ['templates', 'create', 'slides', 'export'],
  saved: ['decks', 'slides', 'export'],
};
assert.deepStrictEqual(PRESENTATION_GOALS.map((g) => g.id), Object.keys(expected));
assert.strictEqual(stepIndex(null, 'slides'), -1);

for (const goal of PRESENTATION_GOALS) {
  assert.ok(goal.title && goal.blurb && goal.icon, `goal ${goal.id} needs a title, blurb and icon`);
  assert.deepStrictEqual(goal.steps.map((s) => s.tool), expected[goal.id], `wrong steps for ${goal.id}`);
  for (const step of goal.steps) {
    assert.ok(registered.has(step.tool), `goal ${goal.id}: "${step.tool}" is not in toolRegistry.js`);
    assert.ok(step.note && step.note.length < 100, `goal ${goal.id}: step ${step.tool} needs a short note`);
  }
}

console.log(`presentation goals: ok (${PRESENTATION_GOALS.length} goals, all steps are registered tools)`);
