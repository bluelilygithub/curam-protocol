'use strict';

const path = require('path');
const { runtimeConfig } = require(path.join(__dirname, '..', '..', 'server', 'config', 'runtime'));
const { getModelsForUser, getVaultModelsConfigForUser } = require(path.join(__dirname, '..', '..', 'server', 'services', 'modelResolver'));
const { isOllamaAvailable } = require(path.join(__dirname, '..', '..', 'server', 'services', 'ollamaClient'));

const WORKSPACE_KEY = 'theme_builder_design_model';

function resolveVaultUserId(userId) {
  if (userId) return userId;
  const fromEnv = parseInt(process.env.THEME_BUILDER_VAULT_USER_ID || '', 10);
  return Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : null;
}

function getPool() {
  try {
    return require(path.join(__dirname, '..', '..', 'server', 'db')).pool;
  } catch {
    return null;
  }
}

async function loadWorkspaceDesignModel() {
  const pool = getPool();
  if (!pool) return null;
  try {
    const { rows } = await pool.query(
      'SELECT value FROM workspace_settings WHERE key=$1 LIMIT 1',
      [WORKSPACE_KEY]
    );
    return rows[0]?.value?.trim() || null;
  } catch {
    return null;
  }
}

async function saveWorkspaceDesignModel(model) {
  const pool = getPool();
  if (!pool) {
    const err = new Error('Database not available');
    err.status = 503;
    throw err;
  }
  const trimmed = String(model || '').trim();
  if (!trimmed) {
    await pool.query('DELETE FROM workspace_settings WHERE key=$1', [WORKSPACE_KEY]);
    return null;
  }
  await pool.query(
    `INSERT INTO workspace_settings (key, value, "updatedAt")
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = NOW()`,
    [WORKSPACE_KEY, trimmed]
  );
  return trimmed;
}

async function ensureModelAvailable(modelId) {
  const id = String(modelId || '').trim();
  if (!id) {
    const err = new Error('Design model id is empty');
    err.status = 503;
    throw err;
  }
  if (id.startsWith('ollama:') && !(await isOllamaAvailable())) {
    const err = new Error(
      `Design model ${id} requires Ollama. Start Ollama locally or choose a cloud model in Settings → AI & Chat.`
    );
    err.status = 503;
    throw err;
  }
  return id;
}

function localDefaultOllamaModel() {
  const raw = process.env.THEME_BUILDER_DEV_DESIGN_MODEL?.trim()
    || process.env.DEFAULT_LOCAL_MODEL
    || runtimeConfig.defaultLocalModel
    || 'qwen2.5-coder:14b';
  return raw.startsWith('ollama:') ? raw : `ollama:${raw}`;
}

/**
 * Theme builder Stage 1 (wireframe + homepage design) model resolution.
 *
 * Priority:
 * 1. explicit model argument (per request)
 * 2. THEME_BUILDER_DESIGN_MODEL / THEME_BUILDER_STAGE1_MODEL env (app override, all envs)
 * 3. THEME_BUILDER_DEV_DESIGN_MODEL when APP_ENV=local (app override for dev)
 * 4. workspace_settings.theme_builder_design_model (app override in Settings → AI & Chat)
 * 5. Vault default_model (workspace default unless app overrides above)
 * 6. Vault model tiers from vault_models
 * 7. Local Ollama default when APP_ENV=local and nothing else is configured
 */
async function resolveThemeBuilderDesignModel({ userId, model } = {}) {
  if (model?.trim()) {
    return ensureModelAvailable(model.trim());
  }

  const envModel = process.env.THEME_BUILDER_DESIGN_MODEL?.trim()
    || process.env.THEME_BUILDER_STAGE1_MODEL?.trim();
  if (envModel) {
    return ensureModelAvailable(envModel);
  }

  if (runtimeConfig.isLocal) {
    const devModel = process.env.THEME_BUILDER_DEV_DESIGN_MODEL?.trim();
    if (devModel) {
      return ensureModelAvailable(devModel);
    }
  }

  const workspaceModel = await loadWorkspaceDesignModel();
  if (workspaceModel) {
    return ensureModelAvailable(workspaceModel);
  }

  const vaultUserId = resolveVaultUserId(userId);
  const vaultConfig = await getVaultModelsConfigForUser(vaultUserId);
  if (vaultConfig.defaultModel) {
    return ensureModelAvailable(vaultConfig.defaultModel);
  }

  const tiers = await getModelsForUser(vaultUserId);
  const picked = runtimeConfig.isLocal
    ? (tiers.ollama || tiers.light || tiers.standard)
    : (tiers.standard || tiers.ollama || tiers.light);
  if (picked) {
    return ensureModelAvailable(picked);
  }

  if (runtimeConfig.isLocal) {
    return ensureModelAvailable(localDefaultOllamaModel());
  }

  const err = new Error(
    'No theme builder design model configured. Set Theme builder design model in Settings → AI & Chat, or set THEME_BUILDER_DESIGN_MODEL in the environment.'
  );
  err.status = 503;
  throw err;
}

async function describeThemeBuilderDesignModel({ userId, model } = {}) {
  if (model?.trim()) {
    return { model: await ensureModelAvailable(model.trim()), source: 'request' };
  }

  const envModel = process.env.THEME_BUILDER_DESIGN_MODEL?.trim()
    || process.env.THEME_BUILDER_STAGE1_MODEL?.trim();
  if (envModel) {
    return { model: await ensureModelAvailable(envModel), source: 'env' };
  }

  if (runtimeConfig.isLocal) {
    const devModel = process.env.THEME_BUILDER_DEV_DESIGN_MODEL?.trim();
    if (devModel) {
      return { model: await ensureModelAvailable(devModel), source: 'dev-env' };
    }
  }

  const workspaceModel = await loadWorkspaceDesignModel();
  if (workspaceModel) {
    return { model: await ensureModelAvailable(workspaceModel), source: 'workspace-settings' };
  }

  if (runtimeConfig.isLocal) {
    try {
      return { model: await ensureModelAvailable(localDefaultOllamaModel()), source: 'local-ollama-default' };
    } catch {
      // fall through
    }
  }

  const vaultUserId = resolveVaultUserId(userId);
  const vaultConfig = await getVaultModelsConfigForUser(vaultUserId);
  if (vaultConfig.defaultModel) {
    return { model: await ensureModelAvailable(vaultConfig.defaultModel), source: 'vault-default-model' };
  }

  const tiers = await getModelsForUser(vaultUserId);
  const picked = runtimeConfig.isLocal
    ? (tiers.ollama || tiers.light || tiers.standard)
    : (tiers.standard || tiers.ollama || tiers.light);
  if (picked) {
    return { model: await ensureModelAvailable(picked), source: 'vault-model-list' };
  }

  if (runtimeConfig.isLocal) {
    return { model: await ensureModelAvailable(localDefaultOllamaModel()), source: 'local-ollama-fallback' };
  }

  const err = new Error('No theme builder design model configured');
  err.status = 503;
  throw err;
}

module.exports = {
  WORKSPACE_KEY,
  loadWorkspaceDesignModel,
  saveWorkspaceDesignModel,
  resolveThemeBuilderDesignModel,
  describeThemeBuilderDesignModel,
  resolveVaultUserId,
};
