// node client/src/pages/skillScan/skillScanGoals.test.mjs — every job tile names real tools.
import assert from 'node:assert/strict';
import { SKILL_SCAN_GOALS } from './skillScanGoals.mjs';
import { SKILL_SCAN_TOOLS } from './skillScanTools.mjs';

const ids = new Set(SKILL_SCAN_TOOLS.map((t) => t.id));
assert.equal(new Set(SKILL_SCAN_GOALS.map((g) => g.id)).size, SKILL_SCAN_GOALS.length, 'job ids are unique');
for (const g of SKILL_SCAN_GOALS) {
  assert.ok(g.title && g.blurb && g.icon && g.steps.length >= 2, `${g.id} is complete`);
  for (const s of g.steps) assert.ok(ids.has(s.tool) && s.note, `${g.id}: ${s.tool} is a real tool with a note`);
}
console.log('skillScanGoals.test.mjs: all passed');
