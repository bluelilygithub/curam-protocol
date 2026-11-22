'use strict';

// Shared validation for an explicit model id sent by the browser. Mirrors the client rule in
// ChatPage: admins may always pick, members only when Feature Access → Model Selection (Members)
// is on. The id must be a text model from the user's resolved vault_models (admin fallback included).
// No model id is hard-coded here; callers still fall back to getModelsForUser's standard/light tiers.

const { loadFeatureAccess } = require('../middleware/auth');
const { getVaultModelsConfigForUser, isNonTextModel } = require('../services/modelResolver');

async function canSelectModel(user, userId, deps = {}) {
  if (user?.isAdmin) return true;
  const check = deps.canSelectModel || (async (id) => {
    const flags = await loadFeatureAccess(id);
    return flags.memberModelSelection !== false;
  });
  return check(userId);
}

/**
 * Return the requested model id when the caller may use it, otherwise null so the caller keeps the
 * resolver's tier fallback. A member with selection on who sends an unknown/non-text id gets a 400.
 */
async function resolveRequestedModel({ user, userId, requestedModel, deps = {} }) {
  const asked = typeof requestedModel === 'string' ? requestedModel.trim() : '';
  if (!asked) return null;
  if (!await canSelectModel(user, userId, deps)) return null;

  const getConfig = deps.getVaultModelsConfigForUser || getVaultModelsConfigForUser;
  const config = await getConfig(userId);
  const textIds = (Array.isArray(config?.models) ? config.models : [])
    .filter((m) => m && typeof m.id === 'string' && m.id.trim() && !isNonTextModel(m))
    .map((m) => m.id.trim());
  if (!textIds.includes(asked)) {
    throw Object.assign(new Error('Choose a text model configured for this workspace.'), { status: 400 });
  }
  return asked;
}

module.exports = { canSelectModel, resolveRequestedModel };
