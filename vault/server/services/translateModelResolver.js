'use strict';

/**
 * Translate agent — model card + runtime resolver.
 *
 * agentId: translate-agent
 * Slots:
 *   translate → translate_model  (primary translation)
 *   review    → translate_review_model (QA / polarity / cold-read)
 *
 * If unset, falls back to vault standard / secondary tiers from getModelsForUser.
 */

const { pool } = require('../db');
const { getVaultModelsConfigForUser, getModelsForUser, pickTextModel } = require('./modelResolver');

const AGENT_ID = 'translate-agent';

const SLOT_KEYS = {
  translate: 'translate_model',
  review: 'translate_review_model',
};

const AGENT_CARD = {
  agentId: AGENT_ID,
  title: 'Translate agent',
  slots: [
    {
      id: 'translate',
      settingsKey: SLOT_KEYS.translate,
      label: 'Translate model',
      required: false,
      inventory: 'any_connected',
    },
    {
      id: 'review',
      settingsKey: SLOT_KEYS.review,
      label: 'Review model',
      required: false,
      inventory: 'any_connected',
    },
  ],
};

async function loadSetting(userId, key) {
  if (!userId || !key) return null;
  const { rows } = await pool.query(
    'SELECT value FROM settings WHERE "userId"=$1 AND key=$2',
    [userId, key],
  );
  const v = rows[0]?.value;
  return v != null && String(v).trim() ? String(v).trim() : null;
}

async function loadFirstAdminSetting(key) {
  const { rows } = await pool.query(
    `SELECT s.value
     FROM settings s
     JOIN users u ON u.id = s."userId"
     WHERE u."isAdmin" = TRUE AND s.key = $1
     ORDER BY s."userId" ASC
     LIMIT 1`,
    [key],
  );
  const v = rows[0]?.value;
  return v != null && String(v).trim() ? String(v).trim() : null;
}

async function resolveSlotSetting(userId, key) {
  const own = await loadSetting(userId, key);
  if (own) return { modelId: own, fromAdmin: false, source: 'setting' };
  const admin = await loadFirstAdminSetting(key);
  if (admin) return { modelId: admin, fromAdmin: true, source: 'admin' };
  return { modelId: null, fromAdmin: false, source: null };
}

function catalogEntryById(models, modelId) {
  if (!modelId || !Array.isArray(models)) return null;
  return models.find((m) => m && String(m.id).trim() === modelId) || null;
}

function pickSecondaryFromTiers(tiers, primaryModel) {
  const candidates = [tiers.gemini, tiers.light, tiers.deepseek, tiers.standard].filter(Boolean);
  return candidates.find((m) => m && m !== primaryModel) || primaryModel;
}

/**
 * @param {{ userId: number|string, overrides?: { translateModelId?: string, reviewModelId?: string } }} ctx
 * @returns {{ agentId, ok, translate, review, errors, enableReviewDefault }}
 */
async function resolveTranslateModels(ctx = {}) {
  const userId = ctx.userId;
  if (!userId) {
    return {
      agentId: AGENT_ID,
      ok: false,
      translate: null,
      review: null,
      errors: ['userId required'],
    };
  }

  const errors = [];
  const { models } = await getVaultModelsConfigForUser(userId);
  const tiers = await getModelsForUser(userId);
  const overrides = ctx.overrides || {};

  const translateSlot = await resolveSlotSetting(userId, SLOT_KEYS.translate);
  const reviewSlot = await resolveSlotSetting(userId, SLOT_KEYS.review);

  // Per-job override wins when supplied and it's actually in this user's connected catalog —
  // never trust a raw client-supplied model id otherwise (falls through to the normal chain).
  let translateId = null;
  let translateSource = null;
  if (overrides.translateModelId && catalogEntryById(models, overrides.translateModelId)) {
    translateId = overrides.translateModelId;
    translateSource = 'override';
  }
  if (!translateId) {
    translateId = translateSlot.modelId;
    translateSource = translateSlot.source || 'setting';
  }
  if (!translateId) {
    translateId = pickTextModel(tiers, 'standard');
    translateSource = 'vault_default';
  }

  let reviewId = null;
  let reviewSource = null;
  if (overrides.reviewModelId && catalogEntryById(models, overrides.reviewModelId)) {
    reviewId = overrides.reviewModelId;
    reviewSource = 'override';
  }
  if (!reviewId) {
    reviewId = reviewSlot.modelId;
    reviewSource = reviewSlot.source || 'setting';
  }
  if (!reviewId) {
    reviewId = pickSecondaryFromTiers(tiers, translateId);
    reviewSource = 'vault_secondary';
  }

  const translateEntry = catalogEntryById(models, translateId);
  const reviewEntry = catalogEntryById(models, reviewId);

  if (!translateId || !translateEntry) {
    errors.push('No translate model available — assign one on the Translate agent card or configure vault models');
  }
  if (!reviewId || !reviewEntry) {
    // Soft: review can fall back to translate model
    if (translateId && translateEntry) {
      reviewId = translateId;
      reviewSource = 'same_as_translate';
    } else {
      errors.push('No review model available');
    }
  }

  return {
    agentId: AGENT_ID,
    ok: errors.length === 0,
    translate: translateId && translateEntry ? {
      slot: 'translate',
      modelId: translateId,
      provider: translateEntry.provider || null,
      name: translateEntry.name || null,
      source: translateSource,
      fromAdminFallback: translateSource !== 'override' && !!translateSlot.fromAdmin,
    } : null,
    review: reviewId ? {
      slot: 'review',
      modelId: reviewId,
      provider: (catalogEntryById(models, reviewId) || translateEntry)?.provider || null,
      name: (catalogEntryById(models, reviewId) || translateEntry)?.name || null,
      source: reviewSource,
      fromAdminFallback: reviewSource !== 'override' && !!reviewSlot.fromAdmin,
    } : null,
    errors,
  };
}

async function getTranslateAgentCardConfig(userId) {
  const resolved = await resolveTranslateModels({ userId });
  return {
    ...AGENT_CARD,
    translate: resolved.translate,
    review: resolved.review,
    ok: resolved.ok,
    errors: resolved.errors,
  };
}

module.exports = {
  AGENT_ID,
  SLOT_KEYS,
  AGENT_CARD,
  resolveTranslateModels,
  getTranslateAgentCardConfig,
};
