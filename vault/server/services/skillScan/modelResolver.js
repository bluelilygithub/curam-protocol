'use strict';

// Skill Scanner: which model writes the explanation and runs a Deep scan. Chosen in Settings -> AI & Chat ("Skill Scanner model"),
// the same way as Email Follow-Up's Summary and Ask model: a model from the connected list (vault_models), or "use the default".
// NO model id is written in this code.
//
//   setting `skill_scan_model` (empty / unset = use the workspace default)
//   resolution: the person's own setting -> the first admin's setting -> the workspace `standard` model
//   a saved id that is no longer connected is ignored (falls back), so removing a model never breaks the tool.
//
// A Deep scan runs SkillSpector with SKILLSPECTOR_PROVIDER=anthropic, so it needs an Anthropic (Claude) model. The explanation works with
// any connected text model, but an Anthropic model is recommended (strict JSON, resisting text in a skill written to mislead it).

const SETTINGS_KEY = 'skill_scan_model';

const clean = (v) => (v != null && String(v).trim() ? String(v).trim() : null);

/** Is this connected model an Anthropic (Claude) one? From its provider, or its id when no provider is stored. */
function isAnthropicModel(models, id) {
  if (!id) return false;
  const m = (Array.isArray(models) ? models : []).find((x) => String(x?.id).trim() === id);
  if (m?.provider) return String(m.provider).toLowerCase() === 'anthropic';
  return /^claude/i.test(id);
}

function createModelResolver(deps = {}) {
  const d = {
    pool: deps.pool || (() => require('../../db').pool),
    getVaultModelsConfigForUser: deps.getVaultModelsConfigForUser || ((...a) => require('../modelResolver').getVaultModelsConfigForUser(...a)),
    getModelsForUser: deps.getModelsForUser || ((...a) => require('../modelResolver').getModelsForUser(...a)),
    pickTextModel: deps.pickTextModel || ((...a) => require('../modelResolver').pickTextModel(...a)),
  };
  const getPool = () => (typeof d.pool === 'function' ? d.pool() : d.pool);

  async function chosen(userId) {
    if (userId) {
      const own = await getPool().query('SELECT value FROM settings WHERE "userId" = $1 AND key = $2', [String(userId), SETTINGS_KEY]);
      if (clean(own.rows[0]?.value)) return { modelId: clean(own.rows[0].value), fromAdmin: false };
    }
    const { rows } = await getPool().query(
      `SELECT s.value FROM settings s JOIN users u ON u.id::text = s."userId"::text WHERE u."isAdmin" = TRUE AND s.key = $1 ORDER BY s."userId" ASC LIMIT 1`,
      [SETTINGS_KEY],
    );
    return clean(rows[0]?.value) ? { modelId: clean(rows[0].value), fromAdmin: true } : { modelId: null, fromAdmin: false };
  }

  const inList = (models, id) => Array.isArray(models) && models.some((m) => String(m?.id).trim() === id);

  /** The model Skill Scanner uses for this person, and whether it is an Anthropic one (needed for a Deep scan). */
  async function resolveModel(userId) {
    const [{ models }, { modelId }] = await Promise.all([d.getVaultModelsConfigForUser(userId), chosen(userId)]);
    const id = modelId && inList(models, modelId) ? modelId : d.pickTextModel(await d.getModelsForUser(userId), 'standard');
    return { modelId: id || null, anthropic: isAnthropicModel(models, id) };
  }

  /** What the Settings card needs. */
  async function getModelConfig(userId) {
    const [{ models }, { modelId, fromAdmin }] = await Promise.all([d.getVaultModelsConfigForUser(userId), chosen(userId)]);
    const fallback = d.pickTextModel(await d.getModelsForUser(userId), 'standard');
    const valid = !modelId || inList(models, modelId);
    const effectiveModel = modelId && valid ? modelId : fallback;
    return {
      settingsKey: SETTINGS_KEY, modelId: modelId || '', assignmentValid: valid, fromAdmin, globalStandard: fallback, effectiveModel,
      effectiveIsAnthropic: isAnthropicModel(models, effectiveModel),
      anthropicChoices: (models || []).filter((m) => isAnthropicModel(models, String(m?.id).trim())).map((m) => m.id),
    };
  }

  /** Save the person's choice, or clear it (empty) to use the default. Only a connected model is accepted. */
  async function saveModel(userId, modelId) {
    const id = clean(modelId);
    if (id) {
      const { models } = await d.getVaultModelsConfigForUser(userId);
      if (!inList(models, id)) throw Object.assign(new Error('Choose one of the models connected in Settings -> AI & Chat.'), { status: 400 });
      await getPool().query(
        `INSERT INTO settings ("userId", key, value) VALUES ($1, $2, $3) ON CONFLICT ("userId", key) DO UPDATE SET value = EXCLUDED.value`,
        [String(userId), SETTINGS_KEY, id],
      );
    } else {
      await getPool().query('DELETE FROM settings WHERE "userId" = $1 AND key = $2', [String(userId), SETTINGS_KEY]);
    }
    return getModelConfig(userId);
  }

  return { resolveModel, getModelConfig, saveModel };
}

module.exports = { createModelResolver, SETTINGS_KEY, isAnthropicModel };
