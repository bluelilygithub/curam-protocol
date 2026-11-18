'use strict';

// node server/services/pdfToHtmlModel.test.js   (no database: settings and model lists are stubs)
// PDF → HTML needs a model that can look at pictures. A DeepSeek default must not block it.

const assert = require('assert');
const { createPdfHtmlModelResolver, canSeePictures } = require('./pdfToHtmlModel');

function make({ models, standard, own = null, admin = null }) {
  const saved = {};
  const pool = {
    query: async (sql, params) => {
      if (/^SELECT value FROM settings/.test(sql)) return { rows: own ? [{ value: own }] : [] };
      if (/JOIN users/.test(sql)) return { rows: admin ? [{ value: admin }] : [] };
      if (/^INSERT/.test(sql)) { saved.value = params[2]; own = params[2]; return { rows: [] }; }
      if (/^DELETE/.test(sql)) { saved.value = null; own = null; return { rows: [] }; }
      throw new Error(`unexpected ${sql}`);
    },
  };
  const api = createPdfHtmlModelResolver({
    pool,
    getVaultModelsConfigForUser: async () => ({ models }),
    getModelsForUser: async () => ({ standard }),
    isNonTextModel: (m) => m.provider === 'image',
  });
  return { api, saved };
}

const LIST = [
  { id: 'deepseek-v4-flash' }, { id: 'gemini-3-pro' }, { id: 'claude-sonnet-x' }, { id: 'ollama:llama' }, { id: 'fal-ai/flux', provider: 'image' },
];

(async () => {
  assert.ok(canSeePictures('claude-sonnet-x') && canSeePictures('gemini-3-pro'));
  assert.ok(!canSeePictures('deepseek-v4-flash') && !canSeePictures('ollama:llama') && !canSeePictures(''));

  // the owner's case: DeepSeek is the default → automatic picks the first Claude model, not Gemini (listed earlier)
  {
    const { api } = make({ models: LIST, standard: 'deepseek-v4-flash' });
    assert.deepStrictEqual(await api.resolvePdfHtmlModel('u1'), { modelId: 'claude-sonnet-x', why: 'default-cannot-see', auto: true });
    const cfg = await api.getPdfHtmlModelConfig('u1');
    assert.deepStrictEqual(cfg.choices.map((m) => m.id), ['gemini-3-pro', 'claude-sonnet-x'], 'only models that can see pictures are offered');
    assert.strictEqual(cfg.standardCanSee, false);
    assert.strictEqual(cfg.effectiveModel, 'claude-sonnet-x');
  }
  // a default that can see pictures is used as is
  {
    const { api } = make({ models: LIST, standard: 'gemini-3-pro' });
    assert.strictEqual((await api.resolvePdfHtmlModel('u1')).modelId, 'gemini-3-pro');
  }
  // no Claude: Gemini
  {
    const { api } = make({ models: [{ id: 'deepseek-v4-flash' }, { id: 'gemini-3-pro' }], standard: 'deepseek-v4-flash' });
    assert.strictEqual((await api.resolvePdfHtmlModel('u1')).modelId, 'gemini-3-pro');
  }
  // nothing can see pictures
  {
    const { api } = make({ models: [{ id: 'deepseek-v4-flash' }, { id: 'ollama:llama' }], standard: 'deepseek-v4-flash' });
    assert.deepStrictEqual(await api.resolvePdfHtmlModel('u1'), { modelId: null, why: 'none', auto: true });
  }
  // the person's choice wins; an admin's choice is inherited; a stale or blind choice is ignored
  {
    const { api } = make({ models: LIST, standard: 'deepseek-v4-flash', own: 'gemini-3-pro' });
    assert.deepStrictEqual(await api.resolvePdfHtmlModel('u1'), { modelId: 'gemini-3-pro', auto: false, why: 'chosen' });
  }
  {
    const { api } = make({ models: LIST, standard: 'deepseek-v4-flash', admin: 'gemini-3-pro' });
    const cfg = await api.getPdfHtmlModelConfig('u2');
    assert.strictEqual(cfg.fromAdmin, true);
    assert.strictEqual(cfg.effectiveModel, 'gemini-3-pro');
  }
  {
    const { api } = make({ models: LIST, standard: 'deepseek-v4-flash', own: 'claude-removed' });
    assert.strictEqual((await api.resolvePdfHtmlModel('u1')).modelId, 'claude-sonnet-x');
    assert.strictEqual((await api.getPdfHtmlModelConfig('u1')).assignmentValid, false);
  }
  // saving: only a connected model that can see pictures; empty clears
  {
    const { api, saved } = make({ models: LIST, standard: 'deepseek-v4-flash' });
    await assert.rejects(api.savePdfHtmlModel('u1', 'deepseek-v4-flash'), /can look at pictures/);
    await assert.rejects(api.savePdfHtmlModel('u1', 'claude-not-connected'), /can look at pictures/);
    const cfg = await api.savePdfHtmlModel('u1', 'gemini-3-pro');
    assert.strictEqual(saved.value, 'gemini-3-pro');
    assert.strictEqual(cfg.effectiveModel, 'gemini-3-pro');
    const cleared = await api.savePdfHtmlModel('u1', '');
    assert.strictEqual(saved.value, null);
    assert.strictEqual(cleared.effectiveModel, 'claude-sonnet-x');
  }

  console.log('pdfToHtmlModel tests passed');
})().catch((err) => { console.error(err); process.exit(1); });
