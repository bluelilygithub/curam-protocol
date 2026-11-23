// node client/src/pages/bip/bipGoals.test.mjs — every job tile names real tools, in a usable order.
import assert from 'node:assert/strict';
import { BIP_GOALS } from './bipGoals.mjs';
import { BIP_TOOLS, GROUPS, GROUP_TIPS, TOOL_TIPS, TOOL_BLURBS, GUIDE_TOOLS } from './bipTools.mjs';

const ids = new Set(BIP_TOOLS.map((t) => t.id));
assert.equal(new Set(BIP_GOALS.map((g) => g.id)).size, BIP_GOALS.length, 'job ids are unique');
for (const g of BIP_GOALS) {
  assert.ok(g.title && g.blurb && g.icon && g.steps.length >= 2, `${g.id} is complete`);
  for (const s of g.steps) assert.ok(ids.has(s.tool) && s.note, `${g.id}: ${s.tool} is a real tool with a note`);
  // a job can only reach a tool that needs an open profile after a step that opens one
  const first = BIP_TOOLS.find((t) => t.id === g.steps[0].tool);
  assert.ok(!first.needsProfile, `${g.id} starts where a profile can be made or opened`);
}
for (const t of BIP_TOOLS) {
  assert.ok(GROUPS.includes(t.group), `${t.id} is in a listed group`);
  assert.ok(TOOL_TIPS[t.id] && TOOL_BLURBS[t.id], `${t.id} has a tip and a blurb`);
}
for (const g of GROUPS) assert.ok(GROUP_TIPS[g], `${g} has a tip`);
assert.deepEqual(GUIDE_TOOLS.map((t) => t.tool), BIP_TOOLS.map((t) => t.id));
console.log('bipGoals.test.mjs: all passed');
