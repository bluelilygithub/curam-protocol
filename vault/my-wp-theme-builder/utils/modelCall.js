const path = require('path');

const { callModel } = require(path.join(__dirname, '..', '..', 'server', 'services', 'callModel'));
const { runtimeConfig } = require(path.join(__dirname, '..', '..', 'server', 'config', 'runtime'));
const { isOllamaAvailable } = require(path.join(__dirname, '..', '..', 'server', 'services', 'ollamaClient'));
const { getModelsForUser } = require(path.join(__dirname, '..', '..', 'server', 'services', 'modelResolver'));
const { resolveThemeBuilderDesignModel } = require('./themeBuilderModel');

function toOllamaModelId(modelId) {
  const trimmed = String(modelId || '').trim();
  if (!trimmed) return null;
  return trimmed.startsWith('ollama:') ? trimmed : `ollama:${trimmed}`;
}

function isAnthropicModel(modelId) {
  return String(modelId || '').startsWith('claude-');
}

function isGeminiModel(modelId) {
  return String(modelId || '').startsWith('gemini-');
}

async function resolveOllamaModel() {
  const raw =
    process.env.THEME_BUILDER_ITERATE_MODEL
    || process.env.THEME_BUILDER_STAGE2_MODEL
    || process.env.THEME_BUILDER_MODEL
    || process.env.DEFAULT_LOCAL_MODEL
    || runtimeConfig.defaultLocalModel
    || 'qwen2.5-coder:14b';

  const modelId = toOllamaModelId(raw);
  if (!(await isOllamaAvailable())) return null;
  return modelId;
}

async function resolveLocalOllamaModel() {
  if (!runtimeConfig.isLocal) {
    return resolveOllamaModel();
  }

  const raw =
    process.env.THEME_BUILDER_STAGE2_MODEL
    || process.env.THEME_BUILDER_MODEL
    || process.env.DEFAULT_LOCAL_MODEL
    || runtimeConfig.defaultLocalModel
    || 'qwen2.5-coder:14b';

  const modelId = toOllamaModelId(raw);
  if (!(await isOllamaAvailable())) return null;
  return modelId;
}

async function resolveCssIterateModel({ model } = {}) {
  if (model?.startsWith('ollama:')) return model;

  const cssModel = process.env.THEME_BUILDER_CSS_ITERATE_MODEL?.trim();
  if (cssModel?.startsWith('ollama:') && await isOllamaAvailable()) {
    return cssModel;
  }

  const configured = process.env.THEME_BUILDER_ITERATE_MODEL
    || process.env.THEME_BUILDER_STAGE2_MODEL;
  if (configured?.trim().startsWith('ollama:')) {
    const id = configured.trim();
    if (await isOllamaAvailable()) return id;
  }

  const ollama = await resolveOllamaModel();
  if (ollama) return ollama;

  const err = new Error(
    'CSS updates use your local Qwen model (Ollama), not Claude. Start Ollama or set THEME_BUILDER_ITERATE_MODEL=ollama:qwen2.5-coder:14b in vault/.env.'
  );
  err.status = 503;
  throw err;
}

async function resolveStage1Model({ userId, model } = {}) {
  return resolveThemeBuilderDesignModel({ userId, model });
}

async function resolveStage2Model({ userId, model } = {}) {
  if (model) return model;

  if (process.env.THEME_BUILDER_STAGE2_MODEL) {
    const configured = process.env.THEME_BUILDER_STAGE2_MODEL.trim();
    if (configured.startsWith('ollama:')) {
      if (await isOllamaAvailable()) return configured;
    } else {
      return configured;
    }
  }

  const tiers = await getModelsForUser(userId);
  const fromDb = runtimeConfig.isLocal
    ? (tiers.ollama || tiers.light || tiers.standard)
    : (tiers.standard || tiers.ollama);
  if (fromDb) return fromDb;

  const local = await resolveLocalOllamaModel();
  if (local) return local;

  const err = new Error(
    'No Stage 2 model available. Set THEME_BUILDER_STAGE2_MODEL=ollama:qwen2.5-coder:14b or ensure Ollama is running.'
  );
  err.status = 503;
  throw err;
}

/** @deprecated use resolveStage1Model or resolveStage2Model */
async function resolveGenerationModel(opts = {}) {
  return resolveStage1Model(opts);
}

function anthropicMaxTokens(requested) {
  // Claude output cap — large HTML/CSS JSON needs headroom but avoid API rejection
  return Math.min(requested, Number(process.env.THEME_BUILDER_ANTHROPIC_MAX_TOKENS) || 16000);
}

async function createDesignMessage({
  system,
  user,
  model,
  userId,
  maxTokens = 16000,
  pages = [],
  onProgress,
  stage = 'stage1',
  abortSignal = null,
  temperature,
}) {
  const modelId = stage === 'stage2'
    ? await resolveStage2Model({ userId, model })
    : await resolveStage1Model({ userId, model });

  if (modelId.startsWith('ollama:')) {
    const { streamOllamaDesign } = require('./ollamaDesign');
    if (typeof onProgress === 'function') {
      onProgress(`Generating with ${modelId.replace(/^ollama:/, '')}…`);
    }
    const result = await streamOllamaDesign(modelId, {
      system,
      user,
      maxTokens,
      pages,
      onProgress,
      abortSignal,
      temperature: temperature ?? 0.7,
    });
    return result;
  }

  if (typeof onProgress === 'function') {
    onProgress(`Generating with ${modelId}…`);
  }

  const tokenLimit = isAnthropicModel(modelId) ? anthropicMaxTokens(maxTokens) : maxTokens;
  const text = await callModel(modelId, user, { maxTokens: tokenLimit, system });

  if (!text) {
    const err = new Error('Empty response from model');
    err.status = 502;
    throw err;
  }

  return { text, model: modelId };
}

async function resolveIterateModel({ userId, model, targeted = false, phase = 'design', cssOnly = false } = {}) {
  if (cssOnly) {
    return resolveCssIterateModel({ model });
  }

  return resolveThemeBuilderDesignModel({ userId, model });
}

module.exports = {
  resolveGenerationModel,
  resolveStage1Model,
  resolveStage2Model,
  resolveIterateModel,
  resolveCssIterateModel,
  resolveOllamaModel,
  resolveLocalOllamaModel,
  createDesignMessage,
  isAnthropicModel,
  isGeminiModel,
};
