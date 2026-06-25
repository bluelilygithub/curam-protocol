const path = require('path');

const { callModel } = require(path.join(__dirname, '..', '..', 'server', 'services', 'callModel'));
const { runtimeConfig } = require(path.join(__dirname, '..', '..', 'server', 'config', 'runtime'));
const { isOllamaAvailable } = require(path.join(__dirname, '..', '..', 'server', 'services', 'ollamaClient'));
const { getModelsForUser } = require(path.join(__dirname, '..', '..', 'server', 'services', 'modelResolver'));
const { resolveThemeBuilderDesignModel, resolveVaultUserId } = require('./themeBuilderModel');

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

function isDeepSeekModel(modelId) {
  return String(modelId || '').startsWith('deepseek-');
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

function deepseekMaxTokens(requested) {
  // DeepSeek hard-caps output at ~8K; requesting more returns a 400. Used for the
  // prompt-builder role (small output), so this clamp is a safety net only.
  return Math.min(requested, Number(process.env.THEME_BUILDER_DEEPSEEK_MAX_TOKENS) || 8000);
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

  let tokenLimit = maxTokens;
  if (isAnthropicModel(modelId)) tokenLimit = anthropicMaxTokens(maxTokens);
  else if (isDeepSeekModel(modelId)) tokenLimit = deepseekMaxTokens(maxTokens);
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

/**
 * Production-only "prompt builder" model. A cheap model (DeepSeek) rewrites the
 * wizard brief into a sharper creative brief that the design model (Claude) then
 * generates from. Returns null in local dev (Qwen path is unchanged) and when no
 * prompt model is configured, in which case enrichment is skipped entirely.
 *
 * Priority: THEME_BUILDER_PROMPT_MODEL env → Vault `deepseek` tier → null.
 */
async function resolvePromptModel({ userId } = {}) {
  if (runtimeConfig.isLocal) return null;

  const explicit = process.env.THEME_BUILDER_PROMPT_MODEL?.trim();
  if (explicit) {
    if (explicit.startsWith('ollama:') && !(await isOllamaAvailable())) return null;
    return explicit;
  }

  try {
    const tiers = await getModelsForUser(resolveVaultUserId(userId));
    return tiers.deepseek || null;
  } catch {
    return null;
  }
}

const PROMPT_BUILDER_SYSTEM = `You are a creative director who turns a structured website brief into a sharper, more vivid creative brief for a senior UI/UX designer.

Rewrite the brief so the designer has concrete art direction: tone and mood, layout language, typography feel, colour story, imagery style, and how to echo any reference sites. Be specific and inspiring, not generic.

HARD RULES:
- Preserve every fact exactly: site type, target audience, the exact page names, brand colours, and fonts. Never invent, rename, merge, or drop pages, sections, or features.
- Do NOT output any HTML, CSS, code, JSON, or markdown fences.
- Do NOT describe an output format or add headings such as "MANDATORY".
- Return ONLY the rewritten brief as plain prose.`;

/**
 * Split the deterministic brief into the creative portion (safe to rewrite) and
 * the locked portion (mandatory nav/functionality, region ids, wireframe HTML,
 * checklists) which must reach the design model verbatim. The first
 * "## MANDATORY" heading is the boundary.
 */
function splitBriefForEnrichment(userPrompt) {
  const text = String(userPrompt || '');
  const idx = text.indexOf('\n\n## MANDATORY');
  if (idx === -1) return { creative: text, locked: '' };
  return { creative: text.slice(0, idx), locked: text.slice(idx) };
}

/**
 * Production-only. Use the prompt-builder model to enrich the creative portion of
 * the brief, then re-attach the locked constraints verbatim. Fails open: any
 * error, empty/oversized output, or HTML leakage returns the original prompt, so
 * generation is never blocked by this step. Returns the user prompt string to
 * send to the design model (the design model's own system prompt is unchanged).
 */
async function enrichDesignPrompt({ system, user, userId, onProgress } = {}) {
  const promptModel = await resolvePromptModel({ userId });
  if (!promptModel) return user;

  const { creative, locked } = splitBriefForEnrichment(user);
  if (!creative.trim()) return user;

  try {
    if (typeof onProgress === 'function') {
      onProgress(`Refining brief with ${String(promptModel).replace(/^ollama:/, '')}…`);
    }
    const { text } = await createDesignMessage({
      system: PROMPT_BUILDER_SYSTEM,
      user: creative,
      model: promptModel,
      userId,
      maxTokens: Number(process.env.THEME_BUILDER_PROMPT_MAX_TOKENS) || 3000,
      temperature: 0.3,
      stage: 'stage1',
    });
    const enriched = String(text || '').trim();
    if (enriched.length < 40) return user;
    if (/<!doctype|<html[\s>]/i.test(enriched)) return user;
    return locked ? `${enriched}\n${locked}` : enriched;
  } catch (err) {
    if (typeof onProgress === 'function') {
      onProgress(`Brief refinement skipped (${err.message}) — using full brief`);
    }
    return user;
  }
}

module.exports = {
  resolveGenerationModel,
  resolveStage1Model,
  resolveStage2Model,
  resolveIterateModel,
  resolveCssIterateModel,
  resolveOllamaModel,
  resolveLocalOllamaModel,
  resolvePromptModel,
  createDesignMessage,
  enrichDesignPrompt,
  isAnthropicModel,
  isGeminiModel,
  isDeepSeekModel,
};
