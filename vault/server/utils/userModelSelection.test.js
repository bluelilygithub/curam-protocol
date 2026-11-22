'use strict';

// node server/utils/userModelSelection.test.js — no database, no network.

const assert = require('node:assert/strict');

// Stub the DB-backed modules before loading the helper; these tests only cover its decision logic.
const stub = (rel, exports) => { const p = require.resolve(rel); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
stub('../middleware/auth', { loadFeatureAccess: async () => ({ memberModelSelection: false }) });
stub('../services/modelResolver', {
  getVaultModelsConfigForUser: async () => ({ models: [] }),
  isNonTextModel: (m) => ['fal', 'seedance', 'replicate', 'serper', 'serpapi'].includes(String(m?.provider || '').toLowerCase()),
});

const { resolveRequestedModel } = require('./userModelSelection');

async function run() {
  const models = [
    { id: 'chosen-model', provider: 'anthropic' },
    { id: 'local-model', provider: 'ollama' },
    { id: 'shopping-search', provider: 'serper' },
  ];
  const config = async () => ({ models, defaultModel: 'chosen-model' });

  // No explicit id: no access query at all, caller keeps the resolver tier.
  assert.equal(await resolveRequestedModel({
    user: { isAdmin: false }, userId: 1, requestedModel: '',
    deps: { canSelectModel: () => { throw new Error('should not be called'); }, getVaultModelsConfigForUser: config },
  }), null);

  // Member flag off: even a valid id is ignored, so resolver/default behaviour stays in charge.
  assert.equal(await resolveRequestedModel({
    user: { isAdmin: false }, userId: 1, requestedModel: 'chosen-model',
    deps: { canSelectModel: async () => false, getVaultModelsConfigForUser: config },
  }), null);

  // Admin always may choose; members may when the flag is on.
  assert.equal(await resolveRequestedModel({
    user: { isAdmin: true }, userId: 1, requestedModel: 'local-model',
    deps: { canSelectModel: async () => false, getVaultModelsConfigForUser: config },
  }), 'local-model');
  assert.equal(await resolveRequestedModel({
    user: { isAdmin: false }, userId: 1, requestedModel: 'chosen-model',
    deps: { canSelectModel: async () => true, getVaultModelsConfigForUser: config },
  }), 'chosen-model');

  // Unknown ids and non-text providers are rejected rather than sent to a provider SDK.
  for (const bad of ['not-configured', 'shopping-search']) {
    await assert.rejects(() => resolveRequestedModel({
      user: { isAdmin: false }, userId: 1, requestedModel: bad,
      deps: { canSelectModel: async () => true, getVaultModelsConfigForUser: config },
    }), (err) => err.status === 400 && /text model configured/.test(err.message));
  }
}

run().then(() => console.log('user model selection tests passed')).catch((err) => { console.error(err); process.exitCode = 1; });
