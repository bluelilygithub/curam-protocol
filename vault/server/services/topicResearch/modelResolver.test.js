#!/usr/bin/env node
/**
 * Topic Research: which model writes the brief. The owner picks it in Settings -> Topic Research (like Product Scout); nothing is hardcoded.
 * Fakes stand in for the database and the workspace's model list, so it needs no database or network.
 *
 * Run: node server/services/topicResearch/modelResolver.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createModelResolver, SETTINGS_KEY } = require('./modelResolver');

// a fake settings table and the workspace's connected models
function world({ models = [{ id: 'model-a' }, { id: 'model-b' }, { id: 'model-c' }], standard = 'model-a', admins = [1], settings = [] } = {}) {
  const w = { rows: [...settings], models, standard };
  const key = (u) => String(u);
  const pool = {
    async query(sql, p = []) {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (/^SELECT value FROM settings WHERE "userId" = \$1 AND key = \$2/.test(s)) return { rows: w.rows.filter((r) => key(r.userId) === key(p[0]) && r.key === p[1]).map((r) => ({ value: r.value })) };
      if (/^SELECT s\.value FROM settings s JOIN users u/.test(s)) {
        const hit = w.rows.filter((r) => r.key === p[0] && admins.map(key).includes(key(r.userId))).sort((a, b) => Number(a.userId) - Number(b.userId))[0];
        return { rows: hit ? [{ value: hit.value }] : [] };
      }
      if (/^INSERT INTO settings/.test(s)) {
        const i = w.rows.findIndex((r) => key(r.userId) === key(p[0]) && r.key === p[1]);
        if (i >= 0) w.rows[i].value = p[2]; else w.rows.push({ userId: key(p[0]), key: p[1], value: p[2] });
        return { rows: [] };
      }
      if (/^DELETE FROM settings/.test(s)) { w.rows = w.rows.filter((r) => !(key(r.userId) === key(p[0]) && r.key === p[1])); return { rows: [] }; }
      throw new Error(`unhandled SQL: ${s.slice(0, 80)}`);
    },
  };
  w.resolver = createModelResolver({
    pool,
    getVaultModelsConfigForUser: async () => ({ models: w.models, defaultModel: w.standard || '', fromAdmin: false }),
    getModelsForUser: async () => ({ standard: w.standard, light: null, gemini: null, deepseek: null, ollama: null }),
    pickTextModel: (tiers) => tiers.standard || tiers.light || tiers.gemini || tiers.deepseek || tiers.ollama || null,
  });
  return w;
}
const set = (userId, value) => ({ userId: String(userId), key: SETTINGS_KEY, value });

async function main() {
  assert.strictEqual(SETTINGS_KEY, 'topic_research_model');

  // ------------------------------------------------------------ nothing chosen: the workspace default
  {
    const w = world();
    assert.strictEqual(await w.resolver.resolveTopicResearchModel(7), 'model-a');
    const c = await w.resolver.getTopicResearchModelConfig(7);
    assert.deepStrictEqual([c.modelId, c.assignmentValid, c.fromAdmin, c.globalStandard, c.effectiveModel], ['', true, false, 'model-a', 'model-a']);
    assert.deepStrictEqual(c.choices.map((m) => m.id), ['model-a', 'model-b', 'model-c'], 'the list to choose from is the workspace list');
  }

  // ------------------------------------------------------------ a choice is used
  {
    const w = world({ settings: [set(7, 'model-c')] });
    assert.strictEqual(await w.resolver.resolveTopicResearchModel(7), 'model-c');
    const c = await w.resolver.getTopicResearchModelConfig(7);
    assert.deepStrictEqual([c.modelId, c.effectiveModel, c.globalStandard], ['model-c', 'model-c', 'model-a']);
    assert.strictEqual(await w.resolver.resolveTopicResearchModel(8), 'model-a', "one person's choice is not another's");
    const spaced = world({ settings: [set(7, '  model-b \n')] });
    assert.strictEqual(await spaced.resolver.resolveTopicResearchModel(7), 'model-b', 'stray spaces in the saved value are ignored');
    assert.strictEqual(await world({ settings: [set(7, '   ')] }).resolver.resolveTopicResearchModel(7), 'model-a', 'a blank value means default');
  }

  // ------------------------------------------------------------ a model that is no longer connected never breaks the tool
  {
    const w = world({ settings: [set(7, 'removed-model')] });
    assert.strictEqual(await w.resolver.resolveTopicResearchModel(7), 'model-a', 'falls back to the default');
    const c = await w.resolver.getTopicResearchModelConfig(7);
    assert.deepStrictEqual([c.modelId, c.assignmentValid, c.effectiveModel], ['removed-model', false, 'model-a'], 'Settings is told the saved choice is stale');
  }

  // ------------------------------------------------------------ an admin's choice is the workspace's, the person's own wins
  {
    const w = world({ admins: [1], settings: [set(1, 'model-b')] });
    assert.strictEqual(await w.resolver.resolveTopicResearchModel(7), 'model-b', 'a member inherits the admin\'s choice');
    const c = await w.resolver.getTopicResearchModelConfig(7);
    assert.deepStrictEqual([c.modelId, c.fromAdmin], ['model-b', true]);
    const own = world({ admins: [1], settings: [set(1, 'model-b'), set(7, 'model-c')] });
    assert.strictEqual(await own.resolver.resolveTopicResearchModel(7), 'model-c', 'their own beats the admin\'s');
    assert.strictEqual((await own.resolver.getTopicResearchModelConfig(7)).fromAdmin, false);
    const notAdmin = world({ admins: [1], settings: [set(5, 'model-b')] });
    assert.strictEqual(await notAdmin.resolver.resolveTopicResearchModel(7), 'model-a', 'only an admin\'s setting is inherited');
    const stale = world({ admins: [1], settings: [set(1, 'gone')] });
    assert.strictEqual(await stale.resolver.resolveTopicResearchModel(7), 'model-a', 'a stale admin choice falls back too');
    const two = world({ admins: [1, 2], settings: [set(2, 'model-c'), set(1, 'model-b')] });
    assert.strictEqual(await two.resolver.resolveTopicResearchModel(7), 'model-b', 'the first admin');
  }

  // ------------------------------------------------------------ no model set up at all
  {
    const w = world({ models: [], standard: null });
    assert.strictEqual(await w.resolver.resolveTopicResearchModel(7), null);
    const c = await w.resolver.getTopicResearchModelConfig(7);
    assert.deepStrictEqual([c.effectiveModel, c.choices.length], [null, 0]);
    const staleOnly = world({ models: [], standard: null, settings: [set(7, 'x')] });
    assert.strictEqual(await staleOnly.resolver.resolveTopicResearchModel(7), null);
  }

  // ------------------------------------------------------------ saving
  {
    const w = world();
    await assert.rejects(() => w.resolver.saveTopicResearchModel(7, 'not-connected'), (e) => e.status === 400 && /connected/.test(e.message));
    assert.deepStrictEqual(w.rows, [], 'nothing was saved');
    let c = await w.resolver.saveTopicResearchModel(7, 'model-b');
    assert.deepStrictEqual([c.modelId, c.effectiveModel, c.assignmentValid], ['model-b', 'model-b', true]);
    assert.strictEqual(await w.resolver.resolveTopicResearchModel(7), 'model-b');
    c = await w.resolver.saveTopicResearchModel(7, 'model-c');
    assert.strictEqual(w.rows.filter((r) => r.key === SETTINGS_KEY).length, 1, 'saving again replaces, it does not add');
    assert.strictEqual(c.modelId, 'model-c');
    await w.resolver.saveTopicResearchModel(8, 'model-a');
    assert.strictEqual(await w.resolver.resolveTopicResearchModel(7), 'model-c', "saving for someone else leaves mine alone");
    c = await w.resolver.saveTopicResearchModel(7, '');
    assert.deepStrictEqual([c.modelId, c.effectiveModel], ['', 'model-a'], 'empty clears it: back to the default');
    assert.strictEqual(w.rows.filter((r) => r.userId === '7').length, 0);
    await w.resolver.saveTopicResearchModel(7, '   ');
    await w.resolver.saveTopicResearchModel(7, null);
    assert.strictEqual(await w.resolver.resolveTopicResearchModel(7), 'model-a');
    // a numeric user id (as the auth middleware gives it) and a string one are the same person
    const n = world();
    await n.resolver.saveTopicResearchModel(7, 'model-b');
    assert.strictEqual(await n.resolver.resolveTopicResearchModel('7'), 'model-b');
  }

  // ------------------------------------------------------------ the default follows the workspace, so changing it in Settings -> AI & Chat is felt here
  {
    const w = world({ standard: 'model-b' });
    assert.strictEqual(await w.resolver.resolveTopicResearchModel(7), 'model-b');
    w.standard = 'model-c';
    assert.strictEqual(await w.resolver.resolveTopicResearchModel(7), 'model-c');
  }

  // ------------------------------------------------------------ NO model id is written in Topic Research code
  {
    const root = path.join(__dirname, '..', '..');
    const files = [];
    const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (/\.js$/.test(e.name) && !/\.test\.js$/.test(e.name) && !/Fixtures\.js$/.test(e.name)) files.push(p); } };
    walk(__dirname);
    for (const f of ['routes/topicResearch.js', 'routes/topicResearchRouter.js', 'routes/topicResearchTutor.js', 'services/topicResearchTutor.js', 'cron/topicResearchCron.js']) { const p = path.join(root, f); if (fs.existsSync(p)) files.push(p); }
    assert.ok(files.length >= 15, `scanned ${files.length} files`);
    const ID = /['"`](claude|gemini|gpt|o[134]|deepseek|llama|mistral|ollama:)[a-z0-9._:-]*['"`]/i;
    const offenders = files.filter((f) => ID.test(fs.readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')));
    assert.deepStrictEqual(offenders.map((f) => path.relative(root, f)), [], 'a model id in the code: choose it in Settings instead');
  }

  console.log('topicResearch model resolver: all passed');
}

main().catch((err) => { console.error(err); process.exit(1); });
