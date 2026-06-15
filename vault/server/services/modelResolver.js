'use strict';

const { pool } = require('../db');
const { runtimeConfig } = require('../config/runtime');

const EMPTY_MODELS = {
  light: null,
  standard: null,
  gemini: null,
  deepseek: null,
  ollama: null,
};

function isImageProvider(provider) {
  return ['fal', 'seedance'].includes(String(provider || '').trim().toLowerCase());
}

function parseConfiguredModelIds(rawVaultModels) {
  if (!rawVaultModels) return [];
  let parsed;
  try {
    parsed = JSON.parse(rawVaultModels);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((m) => (m && typeof m.id === 'string' ? m.id.trim() : ''))
    .filter(Boolean);
}

function parseConfiguredModelEntries(rawVaultModels) {
  if (!rawVaultModels) return [];
  let parsed;
  try {
    parsed = JSON.parse(rawVaultModels);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((m) => ({
      id: m && typeof m.id === 'string' ? m.id.trim() : '',
      provider: m && typeof m.provider === 'string' ? m.provider.trim().toLowerCase() : '',
    }))
    .filter((m) => m.id);
}

function parseVaultModelsCatalog(rawVaultModels) {
  if (!rawVaultModels) return [];
  let parsed;
  try {
    parsed = JSON.parse(rawVaultModels);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((m) => m && typeof m.id === 'string' && String(m.id).trim());
}

function pickTiers(modelEntries, configuredDefault) {
  if (!Array.isArray(modelEntries) || modelEntries.length === 0) return { ...EMPTY_MODELS };
  const textModels = modelEntries.filter((m) => !isImageProvider(m.provider));
  const textModelIds = textModels.map((m) => m.id);
  const anthropicModels = textModels
    .filter((m) => m.provider === 'anthropic' || (!m.provider && !m.id.startsWith('gemini-') && !m.id.startsWith('deepseek-')))
    .map((m) => m.id);
  const geminiModels = textModels.filter((m) => m.provider === 'gemini' || m.id.startsWith('gemini-')).map((m) => m.id);
  const deepseekModels = textModels.filter((m) => m.provider === 'deepseek' || m.id.startsWith('deepseek-')).map((m) => m.id);
  const ollamaModels = textModels.filter((m) => m.provider === 'ollama' || m.id.startsWith('ollama:')).map((m) => m.id);
  const firstModel = textModelIds[0] || null;
  const standard = (configuredDefault && textModelIds.includes(configuredDefault)) ? configuredDefault : firstModel;
  const light = runtimeConfig.isLocal
    ? (ollamaModels[0] || deepseekModels[0] || geminiModels[0] || anthropicModels[0] || standard)
    : (anthropicModels[0] || deepseekModels[0] || geminiModels[0] || ollamaModels[0] || standard);
  return {
    light: light || null,
    standard: standard || null,
    gemini: geminiModels[0] || null,
    deepseek: deepseekModels[0] || null,
    ollama: ollamaModels[0] || null,
  };
}

async function loadSettingsForUser(targetUserId) {
  if (!targetUserId) return {};
  const { rows } = await pool.query(
    "SELECT key, value FROM settings WHERE \"userId\"=$1 AND key IN ('vault_models','default_model')",
    [targetUserId]
  );
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

async function loadFirstAdminSettings() {
  const { rows } = await pool.query(
    `SELECT s."userId", s.key, s.value
     FROM settings s
     JOIN users u ON u.id = s."userId"
     WHERE u."isAdmin" = TRUE
       AND s.key IN ('vault_models','default_model')
     ORDER BY s."userId" ASC`
  );
  if (!rows.length) return {};
  const firstAdminId = rows[0].userId;
  const firstAdminRows = rows.filter((r) => r.userId === firstAdminId);
  return Object.fromEntries(firstAdminRows.map((r) => [r.key, r.value]));
}

/** User settings, else first admin's vault_models / default_model. */
async function resolveVaultModelSettings(userId) {
  const userConfig = await loadSettingsForUser(userId);
  const userIds = parseConfiguredModelIds(userConfig.vault_models);
  if (userIds.length > 0) {
    return {
      vault_models: userConfig.vault_models,
      default_model: userConfig.default_model || null,
      fromAdmin: false,
    };
  }
  const adminConfig = await loadFirstAdminSettings();
  const adminIds = parseConfiguredModelIds(adminConfig.vault_models);
  if (adminIds.length > 0) {
    return {
      vault_models: adminConfig.vault_models,
      default_model: adminConfig.default_model || null,
      fromAdmin: true,
    };
  }
  return { vault_models: null, default_model: null, fromAdmin: false };
}

/**
 * Resolve the user's configured models into tier slots.
 * Resolution order: current user → first admin → nulls (no hardcoded ids).
 */
async function getModelsForUser(userId) {
  try {
    const { vault_models, default_model } = await resolveVaultModelSettings(userId);
    const modelEntries = parseConfiguredModelEntries(vault_models);
    if (!modelEntries.length) return { ...EMPTY_MODELS };
    return pickTiers(modelEntries, default_model || null);
  } catch {
    return { ...EMPTY_MODELS };
  }
}

/**
 * Full vault_models catalog + resolved default for UI (chat picker, preflight).
 * Same resolution order as getModelsForUser.
 */
async function getVaultModelsConfigForUser(userId) {
  try {
    const { vault_models, default_model, fromAdmin } = await resolveVaultModelSettings(userId);
    const models = parseVaultModelsCatalog(vault_models);
    const textIds = models
      .filter((m) => !isImageProvider(m.provider))
      .map((m) => String(m.id).trim())
      .filter(Boolean);
    const defaultModel = (default_model && textIds.includes(default_model))
      ? default_model
      : (textIds[0] || '');
    return { models, defaultModel, fromAdmin };
  } catch {
    return { models: [], defaultModel: '', fromAdmin: false };
  }
}

module.exports = { getModelsForUser, getVaultModelsConfigForUser };
