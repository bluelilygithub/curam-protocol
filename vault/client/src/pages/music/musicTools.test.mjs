import assert from 'node:assert';
import { TOOL_GROUPS, TOOL_TIPS, GROUP_TIPS, TOOL_HELP, DEFAULT_TOOL, filterGroups, groupOfTool } from './musicTools.mjs';

const toolIds = TOOL_GROUPS.flatMap((g) => g.tools.map((t) => t.id));
const groupIds = TOOL_GROUPS.map((g) => g.id);

assert.strictEqual(new Set(toolIds).size, toolIds.length, 'no duplicate tool ids');
assert.ok(toolIds.includes(DEFAULT_TOOL), 'the default tool exists');
assert.deepStrictEqual(Object.keys(TOOL_TIPS).sort(), [...toolIds].sort(), 'every sidebar item has a tooltip, and none is left over');
assert.deepStrictEqual(Object.keys(TOOL_HELP).sort(), [...toolIds].sort(), 'every sidebar item has a help entry, and none is left over');
assert.deepStrictEqual(Object.keys(GROUP_TIPS).sort(), [...groupIds].sort(), 'every group heading has a tooltip');
for (const id of toolIds) {
  const h = TOOL_HELP[id];
  assert.ok(h.title && h.what && h.features.length >= 3, `${id} help is filled in`);
}
for (const g of TOOL_GROUPS) {
  assert.ok(g.label && g.tools.length > 0, `${g.id} has a label and tools`);
  for (const t of g.tools) assert.ok(t.label && t.desc, `${t.id} has a label and description`);
}
const allText = [...Object.values(TOOL_TIPS), ...Object.values(GROUP_TIPS)].join('\n');
assert.ok(!/\b(LUFS|sidechain|ffmpeg|codec|bitrate|crossfade)\b/i.test(allText), 'tooltips use plain words');

// search
assert.strictEqual(filterGroups(TOOL_GROUPS, '  '), TOOL_GROUPS, 'empty search shows everything');
assert.deepStrictEqual(filterGroups(TOOL_GROUPS, 'NARRATION').map((g) => g.id), ['voice'], 'matches the description, any case');
assert.deepStrictEqual(filterGroups(TOOL_GROUPS, 'own').flatMap((g) => g.tools.map((t) => t.id)), ['own-track']);
assert.deepStrictEqual(filterGroups(TOOL_GROUPS, 'zzzz'), [], 'no match, no groups');
assert.strictEqual(groupOfTool(TOOL_GROUPS, 'voiceover'), 'voice');
assert.strictEqual(groupOfTool(TOOL_GROUPS, 'nope'), null);

console.log('ok - music tools: tips, help and groups agree; search works');
