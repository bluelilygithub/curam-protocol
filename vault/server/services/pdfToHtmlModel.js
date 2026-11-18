'use strict';

// PDF → HTML: which model writes the web page. The model must look at pictures (the page renders and the extracted images), so
// DeepSeek and local (ollama:) models cannot do this job: callModel refuses pictures for them.
//
//   setting `pdf_html_model` (empty / unset = automatic), chosen in Settings → PDF Tools; resolution: the person's own → the first admin's.
//   automatic: the workspace `standard` model when it can see pictures, else the first Claude model connected, else the first Gemini one.
//   a saved id that is no longer connected, or cannot see pictures, is ignored (falls back to automatic), so it never breaks the tool.
// NO model id is written in this code: everything comes from the connected list (vault_models). Injectable for tests.

const SETTINGS_KEY = 'pdf_html_model';

const clean = (v) => (v != null && String(v).trim() ? String(v).trim() : null);

/** Same rule callModel uses: Gemini and the Anthropic route take pictures; DeepSeek and ollama: do not. */
function canSeePictures(id) {
  const s = String(id || '').trim();
  if (!s) return false;
  return s.startsWith('gemini-') || !/^(ollama:|deepseek-)/.test(s);
}

function createPdfHtmlModelResolver(deps = {}) {
  const d = {
    pool: deps.pool || (() => require('../db').pool),
    getVaultModelsConfigForUser: deps.getVaultModelsConfigForUser || ((...a) => require('./modelResolver').getVaultModelsConfigForUser(...a)),
    getModelsForUser: deps.getModelsForUser || ((...a) => require('./modelResolver').getModelsForUser(...a)),
    isNonTextModel: deps.isNonTextModel || ((...a) => require('./modelResolver').isNonTextModel(...a)),
  };
  const getPool = () => (typeof d.pool === 'function' ? d.pool() : d.pool);

  async function chosen(userId) {
    const { rows } = await getPool().query('SELECT value FROM settings WHERE "userId" = $1 AND key = $2', [String(userId), SETTINGS_KEY]);
    const own = clean(rows[0]?.value);
    if (own) return { modelId: own, fromAdmin: false };
    const admin = await getPool().query(
      `SELECT s.value FROM settings s JOIN users u ON u.id::text = s."userId"::text WHERE u."isAdmin" = TRUE AND s.key = $1 ORDER BY s."userId" ASC LIMIT 1`,
      [SETTINGS_KEY],
    );
    const a = clean(admin.rows[0]?.value);
    return a ? { modelId: a, fromAdmin: true } : { modelId: null, fromAdmin: false };
  }

  /** Connected text models that can see pictures, in the order they are listed in Settings. */
  async function pictureModels(userId) {
    const { models } = await d.getVaultModelsConfigForUser(userId);
    return (models || []).filter((m) => m && !d.isNonTextModel(m) && canSeePictures(m.id));
  }

  async function automatic(userId, list) {
    const { standard } = await d.getModelsForUser(userId);
    if (standard && canSeePictures(standard) && list.some((m) => m.id === standard)) return { modelId: standard, why: 'default' };
    const claude = list.find((m) => String(m.id).startsWith('claude-'));
    if (claude) return { modelId: claude.id, why: standard ? 'default-cannot-see' : 'first' };
    const gemini = list.find((m) => String(m.id).startsWith('gemini-'));
    if (gemini) return { modelId: gemini.id, why: standard ? 'default-cannot-see' : 'first' };
    if (list[0]) return { modelId: list[0].id, why: standard ? 'default-cannot-see' : 'first' };
    return { modelId: null, why: 'none' };
  }

  /** { modelId, auto, why } — modelId null when no connected model can see pictures. */
  async function resolvePdfHtmlModel(userId) {
    const [list, pick] = await Promise.all([pictureModels(userId), chosen(userId)]);
    if (pick.modelId && list.some((m) => m.id === pick.modelId)) return { modelId: pick.modelId, auto: false, why: 'chosen' };
    return { ...(await automatic(userId, list)), auto: true };
  }

  /** What the Settings card and the tool need. */
  async function getPdfHtmlModelConfig(userId) {
    const [list, pick, tiers] = await Promise.all([pictureModels(userId), chosen(userId), d.getModelsForUser(userId)]);
    const valid = !pick.modelId || list.some((m) => m.id === pick.modelId);
    const auto = await automatic(userId, list);
    return {
      settingsKey: SETTINGS_KEY,
      modelId: pick.modelId || '',
      assignmentValid: valid,
      fromAdmin: pick.fromAdmin,
      standard: tiers?.standard || null,
      standardCanSee: !!(tiers?.standard && canSeePictures(tiers.standard)),
      automaticModel: auto.modelId,
      effectiveModel: pick.modelId && valid ? pick.modelId : auto.modelId,
      choices: list,
    };
  }

  /** Save the person's choice, or clear it (empty) for automatic. Only a connected model that can see pictures is accepted. */
  async function savePdfHtmlModel(userId, modelId) {
    const id = clean(modelId);
    if (id) {
      const list = await pictureModels(userId);
      if (!list.some((m) => m.id === id)) throw Object.assign(new Error('Choose a connected Claude or Gemini model: PDF → HTML needs one that can look at pictures.'), { status: 400 });
      await getPool().query(
        `INSERT INTO settings ("userId", key, value) VALUES ($1, $2, $3) ON CONFLICT ("userId", key) DO UPDATE SET value = EXCLUDED.value`,
        [String(userId), SETTINGS_KEY, id],
      );
    } else {
      await getPool().query('DELETE FROM settings WHERE "userId" = $1 AND key = $2', [String(userId), SETTINGS_KEY]);
    }
    return getPdfHtmlModelConfig(userId);
  }

  return { resolvePdfHtmlModel, getPdfHtmlModelConfig, savePdfHtmlModel };
}

module.exports = { createPdfHtmlModelResolver, canSeePictures, SETTINGS_KEY, ...createPdfHtmlModelResolver() };
