'use strict';

// The Summary and Ask model is the person's choice in Settings, never a literal id in the code. Runs with a fake settings table (no database).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createModelResolver, SETTINGS_KEY } = require('./modelResolver');

let n = 0;
const check = (name, fn) => Promise.resolve().then(fn).then(() => { n += 1; }, (e) => { console.error(`FAIL ${name}: ${e.message}`); process.exitCode = 1; });

// settings rows: { userId, key, value }; user 9 is the admin
function make({ rows = [], models = [{ id: 'm-a' }, { id: 'm-b' }], standard = 'm-default' } = {}) {
  const table = rows.slice();
  const pool = { query: async (sql, args) => {
    if (/^SELECT value FROM settings/.test(sql)) return { rows: table.filter((r) => r.userId === args[0] && r.key === args[1]).map((r) => ({ value: r.value })) };
    if (/JOIN users/.test(sql)) return { rows: table.filter((r) => r.userId === '9' && r.key === args[0]).map((r) => ({ value: r.value })) };
    if (/^INSERT INTO settings/.test(sql)) {
      const i = table.findIndex((r) => r.userId === args[0] && r.key === args[1]);
      if (i >= 0) table[i].value = args[2]; else table.push({ userId: args[0], key: args[1], value: args[2] });
      return { rows: [] };
    }
    if (/^DELETE FROM settings/.test(sql)) { for (let i = table.length - 1; i >= 0; i -= 1) if (table[i].userId === args[0] && table[i].key === args[1]) table.splice(i, 1); return { rows: [] }; }
    throw new Error(`unexpected query ${sql}`);
  } };
  const r = createModelResolver({ pool, getVaultModelsConfigForUser: async () => ({ models }), getModelsForUser: async () => ({ standard }), pickTextModel: (tiers, tier) => tiers[tier] || null });
  return { r, table };
}
const own = (value) => ({ userId: '1', key: SETTINGS_KEY, value });

(async () => {
  await check('nothing chosen: the workspace default model', async () => {
    assert.strictEqual(await make().r.resolveAskModel(1), 'm-default');
  });
  await check('the person\'s own choice wins when it is a connected model', async () => {
    assert.strictEqual(await make({ rows: [own('m-b')] }).r.resolveAskModel(1), 'm-b');
  });
  await check('an admin\'s choice is inherited when the person has none', async () => {
    const { r } = make({ rows: [{ userId: '9', key: SETTINGS_KEY, value: 'm-a' }] });
    assert.strictEqual(await r.resolveAskModel(1), 'm-a');
    assert.strictEqual((await r.getAskModelConfig(1)).fromAdmin, true);
  });
  await check('a saved model that is no longer connected is ignored, not an error, and the Settings card says so', async () => {
    const { r } = make({ rows: [own('m-gone')] });
    assert.strictEqual(await r.resolveAskModel(1), 'm-default');
    const cfg = await r.getAskModelConfig(1);
    assert.strictEqual(cfg.assignmentValid, false);
    assert.strictEqual(cfg.modelId, 'm-gone');
    assert.strictEqual(cfg.effectiveModel, 'm-default');
  });
  await check('saving accepts only a connected model; empty clears back to the default', async () => {
    const { r, table } = make();
    await assert.rejects(() => r.saveAskModel(1, 'not-connected'), /connected in Settings/);
    assert.strictEqual(table.length, 0);
    const saved = await r.saveAskModel(1, 'm-b');
    assert.strictEqual(saved.effectiveModel, 'm-b');
    assert.strictEqual(await r.resolveAskModel(1), 'm-b');
    const cleared = await r.saveAskModel(1, '');
    assert.strictEqual(cleared.modelId, '');
    assert.strictEqual(await r.resolveAskModel(1), 'm-default');
  });
  await check('no model anywhere gives null (the caller says no model is set up)', async () => {
    assert.strictEqual(await make({ standard: null }).r.resolveAskModel(1), null);
  });
  await check('no model id is written in the Summary and Ask code', () => {
    for (const f of ['caseAsk.js', 'modelResolver.js']) {
      const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
      assert.ok(!/claude-|gemini-|gpt-|deepseek-/i.test(src), `${f} names a model`);
    }
  });
  if (!process.exitCode) console.log(`email-follow-up model setting: ${n} checks passed`);
})();
