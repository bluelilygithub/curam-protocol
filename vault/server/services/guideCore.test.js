'use strict';

// node server/services/guideCore.test.js — no database, no network.

const assert = require('node:assert/strict');
const { createGuide } = require('./guideCore');

const guide = createGuide({
  name: 'Test guide',
  feature: 'test_tutor',
  tier: 'standard',
  catalog: [{ id: 'create', label: 'Create', group: 'Make', does: 'Makes a thing.' }],
  rules: ['Only use the listed tool.'],
  notPossible: ['It does not do everything.'],
  system: 'Reply with JSON only.',
  fallbackAnswer: 'Try again.',
});

const messages = [{ role: 'user', content: 'What should I use?' }];
const replyJson = JSON.stringify({ verdict: 'doable', answer: 'Use Create.', steps: [{ tool: 'create', do: 'Make the thing.' }] });

async function run() {
  const seen = [];
  const usage = [];
  const deps = {
    getModels: async () => ({ light: 'light-tier', standard: 'standard-tier' }),
    callModel: async (modelId, prompt, opts) => {
      seen.push({ modelId, prompt, opts });
      return { text: replyJson, model: modelId, inputTokens: 10, outputTokens: 20 };
    },
    logUsage: async (entry) => { usage.push(entry); },
  };

  const tierReply = await guide.ask(7, { messages }, deps);
  assert.equal(tierReply.verdict, 'doable');
  assert.equal(seen[0].modelId, 'standard-tier', 'without an override the guide keeps the resolver tier');

  const pickedReply = await guide.ask(7, { messages, model: 'picked-model' }, deps);
  assert.equal(pickedReply.verdict, 'doable');
  assert.equal(seen[1].modelId, 'picked-model', 'the validated selection is honoured');
  assert.equal(usage[1].model, 'picked-model');

  const raw = '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_1"}';
  const badDeps = { ...deps, callModel: async () => { throw new Error(raw); } };
  await assert.rejects(() => guide.ask(7, { messages, model: 'picked-model' }, badDeps), (err) => {
    assert.equal(err.status, 502);
    assert.equal(err.code, 'model_call');
    assert.match(err.message, /rejected Vault's key/);
    assert.doesNotMatch(err.message, /request_id/);
    return true;
  });
}

run().then(() => console.log('guideCore model selection tests passed')).catch((err) => { console.error(err); process.exitCode = 1; });
