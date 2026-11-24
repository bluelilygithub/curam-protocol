'use strict';

// node server/services/codeMap/models/inventory.test.js   No database or model needed. The drift tests run Code Map's analyzer on this repo.

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x@127.0.0.1:1/x';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const inv = require('./inventory');
const { MODEL_NEEDS, SHARED_FEATURES, toolForFeature } = require('../../../config/modelNeeds');
const { modelInfo, modelFamily, calculateCost } = require('../../costCalculator');

// ---- capability list ----
const sonnet = modelInfo('claude-sonnet-4-6');
assert.strictEqual(sonnet.vision, true);
assert.strictEqual(sonnet.priced, true);
assert.strictEqual(sonnet.capabilitySource, 'family');
assert.strictEqual(modelInfo('claude-3-5-haiku-20241022').vision, false, 'per-id correction beats the family');
assert.strictEqual(modelInfo('claude-3-5-haiku-20241022').capabilitySource, 'table');
assert.strictEqual(modelInfo('deepseek-chat').vision, false, 'DeepSeek takes no images (callModel refuses them)');
const odd = modelInfo('ollama:llama3');
assert.deepStrictEqual([odd.vision, odd.context, odd.json, odd.capabilitySource], [null, null, null, 'unknown'], 'unknown is unknown, never guessed');
assert.strictEqual(calculateCost('claude-sonnet-4-6', 1e6, 0), 3, 'adding capabilities did not change pricing');
assert.deepStrictEqual(modelFamily('claude-opus-5-5'), { provider: 'anthropic', family: 'opus', version: [5, 5] });
assert.deepStrictEqual(modelFamily('claude-haiku-4-5-20251001'), { provider: 'anthropic', family: 'haiku', version: [4, 5] });
assert.deepStrictEqual(modelFamily('claude-opus-5'), { provider: 'anthropic', family: 'opus', version: [5, 0] });
assert.deepStrictEqual(modelFamily('claude-3-5-sonnet-20241022'), { provider: 'anthropic', family: 'sonnet', version: [3, 5] });
assert.deepStrictEqual(modelFamily('gemini-2.5-flash'), { provider: 'gemini', family: 'flash', version: [2, 5] });
assert.strictEqual(modelFamily('ollama:llama3'), null);

// ---- reading a tool's code ----
const scan = inv.scanSources(`
  const tiers = await getModelsForUser(userId); const m = tiers.light;
  const x = pickTextModel(tiers, 'standard');
  const KEY = 'skill_scan_model'; q('vault_models'); q("default_model"); q('news_digest_fallback_model');`);
assert.deepStrictEqual(scan.tiers, ['standard', 'light']);
assert.deepStrictEqual(scan.keys, ['news_digest_fallback_model', 'skill_scan_model'], 'workspace keys are not tool keys');
assert.deepStrictEqual(inv.scanSources('pickTextModel(tiers)').tiers, ['standard'], 'pickTextModel with no preference means standard');
assert.deepStrictEqual(inv.scanSources('nothing here').tiers, []);

assert.strictEqual(inv.providerOf('gemini-2.5-pro'), 'gemini');
assert.strictEqual(inv.providerOf('claude-opus-5'), 'anthropic');
assert.strictEqual(inv.providerOf('my-model', [{ id: 'my-model', provider: 'DeepSeek' }]), 'deepseek', 'the catalog provider wins');

// ---- one tool's row ----
const catalog = [{ id: 'claude-sonnet-4-6', provider: 'anthropic' }, { id: 'claude-haiku-4-5' }, { id: 'deepseek-chat', provider: 'deepseek' }];
const tiers = { standard: 'claude-sonnet-4-6', light: 'claude-haiku-4-5', gemini: null, deepseek: 'deepseek-chat', ollama: null };
const env = { ANTHROPIC_API_KEY: 'x', DEEPSEEK_API_KEY: '' };
const row = inv.inventoryTool({
  tool: { id: 'skillScan', label: 'Skill Scanner' },
  sourceText: "tiers.light; 'skill_scan_model'; 'news_digest_fallback_model'; 'translate_model'",
  needs: MODEL_NEEDS.skillScan, tiers, catalog,
  settings: { skill_scan_model: 'deepseek-chat', news_digest_fallback_model: 'gone-model' },
  env,
});
const byVia = Object.fromEntries(row.models.map((m) => [m.via, m]));
assert.strictEqual(byVia['tier:light'].modelId, 'claude-haiku-4-5');
assert.strictEqual(byVia['tier:light'].role, 'default');
assert.strictEqual(byVia['setting:skill_scan_model'].modelId, 'deepseek-chat');
assert.strictEqual(byVia['setting:skill_scan_model'].role, 'dedicated');
assert.strictEqual(byVia['setting:skill_scan_model'].providerKey, false, 'empty DEEPSEEK_API_KEY counts as missing');
assert.strictEqual(byVia['setting:skill_scan_model'].info.vision, false);
const gone = byVia['setting:news_digest_fallback_model'];
assert.strictEqual(gone.role, 'backup');
assert.strictEqual(gone.savedId, 'gone-model');
assert.strictEqual(gone.modelId, 'claude-sonnet-4-6', 'a saved id no longer in the list falls back to the default, like the resolvers');
assert.match(gone.resolvedFrom, /not in the model list/);
assert.match(byVia['setting:translate_model'].resolvedFrom, /not set/);
assert.strictEqual(byVia['setting:translate_model'].modelId, 'claude-sonnet-4-6');
assert.strictEqual(row.needsDeclared, true);

// ---- whole inventory ----
const files = { 'server/a.js': 'tiers.standard', 'server/b.js': 'nothing' };
const built = inv.buildInventory({
  run: { tools: [{ id: 'notes', label: 'Notes', ownedServer: ['server/a.js'] }, { id: 'mystery', label: 'Mystery', ownedServer: ['server/a.js', 'missing.js'] }, { id: 'fonts', label: 'Fonts', ownedServer: ['server/b.js'] }] },
  readFile: (rel) => { if (!(rel in files)) throw new Error('missing'); return files[rel]; },
  tiers, catalog, env, needsMap: { notes: MODEL_NEEDS.notes, fonts: MODEL_NEEDS.fonts, gone: MODEL_NEEDS.notes },
});
assert.deepStrictEqual(built.tools.map((t) => t.tool), ['notes', 'mystery', 'fonts'], 'fonts is listed because it declares needs');
assert.deepStrictEqual(built.undeclared, ['mystery'], 'a tool that calls a model with no needs entry is reported');
assert.deepStrictEqual(built.unknownNeeds, ['gone'], 'a needs entry for a tool that does not exist is reported');

// a claimed key is dropped from other tools, kept for its owner
const claimedMap = new Map([['contract_review_model', 'contractReview']]);
const other = inv.inventoryTool({ tool: { id: 'tasks', label: 'Tasks' }, sourceText: "'contract_review_model'", needs: MODEL_NEEDS.tasks, tiers, catalog, settings: {}, env, claimed: claimedMap });
assert.strictEqual(other.models.length, 0);
const owner = inv.inventoryTool({ tool: { id: 'contractReview', label: 'CR' }, sourceText: "'contract_review_model'", needs: MODEL_NEEDS.contractReview, tiers, catalog, settings: {}, env, claimed: claimedMap });
assert.strictEqual(owner.models.length, 1);

// ---- feature → tool ----
assert.strictEqual(toolForFeature('skill_scan_summary'), 'skillScan');
assert.strictEqual(toolForFeature('shares'), 'shares');
assert.strictEqual(toolForFeature('shares_thesis_check'), 'shares');
assert.strictEqual(toolForFeature('recipes_named_expand'), 'recipes');
assert.strictEqual(toolForFeature('seo_ads'), 'googleAds');
assert.strictEqual(toolForFeature('no_such_feature'), null);

// ---- drift: the needs list matches the real code ----
const root = path.resolve(__dirname, '../../../..');
const run = require('../index').analyze({ root, log: { info() {}, warn() {}, error() {} } });
const toolIds = new Set(run.tools.map((t) => t.id));
for (const id of Object.keys(MODEL_NEEDS)) assert.ok(toolIds.has(id), `modelNeeds.js: "${id}" is not a Code Map tool id`);
for (const t of run.tools) {
  if (t.checks.modelResolver.status !== 'na') assert.ok(MODEL_NEEDS[t.id], `${t.id} calls a model but has no entry in server/config/modelNeeds.js`);
}

// the real inventory: walking requires reaches resolvers in shared files, but not other tools' settings
const realInv = inv.buildInventory({ run, readFile: (f) => fs.readFileSync(path.resolve(root, f), 'utf8'), tiers, catalog, env });
const keysOf = (id) => (realInv.tools.find((t) => t.tool === id)?.models || []).map((m) => m.via);
assert.ok(keysOf('contractReview').includes('setting:contract_review_model'), 'Contract Review reaches its resolver through contractService');
assert.ok(!keysOf('tasks').includes('setting:contract_review_model'), 'Tasks does not get the Contract Review model');
assert.ok(keysOf('fonts').includes('tier:standard'), 'a guide chat with no tier uses standard (createGuide)');
assert.ok(keysOf('newsDigest').includes('setting:news_digest_fallback_model'), 'News digest has the one real backup setting');
assert.strictEqual(realInv.tools.find((t) => t.tool === 'newsDigest').models.find((m) => m.via === 'setting:news_digest_fallback_model').role, 'backup');

// every feature name written in server code maps to a tool (or is listed as shared)
const featureNames = new Set();
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['node_modules', '__fixtures__'].includes(e.name)) walk(p); continue; }
    if (!e.name.endsWith('.js') || /\.test\.js$/.test(e.name)) continue;
    for (const m of fs.readFileSync(p, 'utf8').matchAll(/\b(?:FEATURE|_FEATURE|feature)\s*[:=]\s*'([a-z][a-z0-9_]*)'/g)) featureNames.add(m[1]);
  }
};
walk(path.join(root, 'server'));
assert.ok(featureNames.size > 50, 'found the logged feature names');
const unmapped = [...featureNames].filter((f) => !toolForFeature(f) && !SHARED_FEATURES.includes(f));
assert.deepStrictEqual(unmapped, [], `features logged in code with no tool in modelNeeds.js: ${unmapped.join(', ')}`);

console.log(`inventory.test.js: all passed (${Object.keys(MODEL_NEEDS).length} tools declared, ${featureNames.size} feature names mapped)`);
process.exit(0);
