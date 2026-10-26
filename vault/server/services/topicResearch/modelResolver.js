'use strict';

// Topic Research: which model writes the research brief. Chosen by the owner in Settings -> Topic Research, the same way as Product Scout and
// the other apps: a model from the workspace's connected list (vault_models), or "use the default". NO model id is written in this code.
//
//   setting `topic_research_model` (empty / unset = use the workspace default)
//   resolution: the person's own setting -> the first admin's setting -> the workspace `standard` model (then whatever text model exists)
//   a saved id that is no longer in the connected list is ignored (falls back), so removing a model never breaks the tool.
//
// Small jobs (relevance checks, trade-term suggestions) use the workspace's `light` model when there is one (resolveCheapModel).
//
// Everything outside is injectable so tests need no database. See docs/topic-research.md.

const SETTINGS_KEY = 'topic_research_model';

const clean = (v) => (v != null && String(v).trim() ? String(v).trim() : null);

function createModelResolver(deps = {}) {
  const d = {
    pool: deps.pool || (() => require('../../db').pool),
    getVaultModelsConfigForUser: deps.getVaultModelsConfigForUser || ((...a) => require('../modelResolver').getVaultModelsConfigForUser(...a)),
    getModelsForUser: deps.getModelsForUser || ((...a) => require('../modelResolver').getModelsForUser(...a)),
    pickTextModel: deps.pickTextModel || ((...a) => require('../modelResolver').pickTextModel(...a)),
  };
  const getPool = () => (typeof d.pool === 'function' ? d.pool() : d.pool);

  async function ownSetting(userId) {
    if (!userId) return null;
    const { rows } = await getPool().query('SELECT value FROM settings WHERE "userId" = $1 AND key = $2', [String(userId), SETTINGS_KEY]);
    return clean(rows[0]?.value);
  }

  async function firstAdminSetting() {
    const { rows } = await getPool().query(
      `SELECT s.value FROM settings s JOIN users u ON u.id::text = s."userId"::text WHERE u."isAdmin" = TRUE AND s.key = $1 ORDER BY s."userId" ASC LIMIT 1`,
      [SETTINGS_KEY],
    );
    return clean(rows[0]?.value);
  }

  async function chosen(userId) {
    const own = await ownSetting(userId);
    if (own) return { modelId: own, fromAdmin: false };
    const admin = await firstAdminSetting();
    return admin ? { modelId: admin, fromAdmin: true } : { modelId: null, fromAdmin: false };
  }

  const inList = (models, id) => Array.isArray(models) && models.some((m) => String(m?.id).trim() === id);

  /** The model id that writes a brief for this person, or null when no model is set up at all. */
  async function resolveTopicResearchModel(userId) {
    const [{ models }, { modelId }] = await Promise.all([d.getVaultModelsConfigForUser(userId), chosen(userId)]);
    if (modelId && inList(models, modelId)) return modelId;
    return d.pickTextModel(await d.getModelsForUser(userId), 'standard');
  }

  /**
   * The model for the SMALL jobs (is this article about the topic, suggest trade words): the workspace's cheaper `light` model when it has one,
   * else the person's own choice, else the `standard` model. A short answer from many articles does not need the model that writes a brief.
   * Null when no model is set up at all.
   */
  async function resolveCheapModel(userId) {
    const tiers = await d.getModelsForUser(userId);
    if (tiers?.light) return tiers.light;
    return resolveTopicResearchModel(userId);
  }

  /** What the Settings tab needs: the saved choice (even a stale one), whether it is still valid, the list to choose from and the default. */
  async function getTopicResearchModelConfig(userId) {
    const [{ models }, { modelId, fromAdmin }] = await Promise.all([d.getVaultModelsConfigForUser(userId), chosen(userId)]);
    const fallback = d.pickTextModel(await d.getModelsForUser(userId), 'standard');
    const valid = !modelId || inList(models, modelId);
    return {
      settingsKey: SETTINGS_KEY,
      modelId: modelId || '',
      assignmentValid: valid,
      fromAdmin,
      globalStandard: fallback,
      effectiveModel: modelId && valid ? modelId : fallback,
      choices: models,
    };
  }

  /** Save the person's choice, or clear it (empty) to use the default. Only a connected model is accepted. */
  async function saveTopicResearchModel(userId, modelId) {
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
    return getTopicResearchModelConfig(userId);
  }

  return { resolveTopicResearchModel, resolveCheapModel, getTopicResearchModelConfig, saveTopicResearchModel };
}

module.exports = { createModelResolver, SETTINGS_KEY, ...createModelResolver() };
