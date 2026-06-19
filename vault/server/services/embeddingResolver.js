'use strict';

/**
 * embeddingResolver — local Ollama embeddings for testing, Gemini via settings on Railway.
 */

const { pool } = require('../db');
const { runtimeConfig } = require('../config/runtime');
const { isOllamaAvailable, ollamaBaseUrl } = require('./ollamaClient');

const EMBEDDING_DIM = 768;

const GEMINI_EMBEDDING_OPTIONS = [
  { id: 'embedding-001', label: 'Gemini embedding-001' },
  { id: 'text-embedding-004', label: 'Gemini text-embedding-004' },
];

const DEFAULT_OLLAMA_EMBEDDING_MODEL = process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text';
const DEFAULT_GEMINI_EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'embedding-001';

async function loadUserEmbeddingModel(userId) {
  if (!userId) return null;
  const { rows } = await pool.query(
    `SELECT value FROM settings WHERE "userId" = $1 AND key = 'embedding_model'`,
    [userId]
  );
  return rows[0]?.value?.trim() || null;
}

async function loadAdminEmbeddingModel() {
  const { rows } = await pool.query(
    `SELECT s.value
     FROM settings s
     JOIN users u ON u.id = s."userId"
     WHERE u."isAdmin" = TRUE AND s.key = 'embedding_model'
     ORDER BY s."userId" ASC
     LIMIT 1`
  );
  return rows[0]?.value?.trim() || null;
}

async function resolveGeminiModel(userId) {
  const userModel = await loadUserEmbeddingModel(userId);
  if (userModel) return { model: userModel, fromAdmin: false };
  const adminModel = await loadAdminEmbeddingModel();
  if (adminModel) return { model: adminModel, fromAdmin: true };
  return { model: DEFAULT_GEMINI_EMBEDDING_MODEL, fromAdmin: false };
}

/**
 * Resolve embedding provider/model for the current runtime + user settings.
 */
async function resolveEmbeddingConfig(userId = null) {
  if (runtimeConfig.isLocal) {
    const model = DEFAULT_OLLAMA_EMBEDDING_MODEL;
    const available = await isOllamaAvailable();
    return {
      provider: 'ollama',
      model,
      sourceKey: `ollama:${model}`,
      dimensions: EMBEDDING_DIM,
      available,
      configuredBy: 'local',
      hint: available
        ? `Ollama ${model} at ${ollamaBaseUrl()}`
        : `Start Ollama and run: ollama pull ${model}`,
    };
  }

  const { model, fromAdmin } = await resolveGeminiModel(userId);
  const hasKey = !!process.env.GEMINI_API_KEY;
  return {
    provider: 'gemini',
    model,
    sourceKey: `gemini:${model}`,
    dimensions: EMBEDDING_DIM,
    available: hasKey,
    configuredBy: fromAdmin ? 'admin' : (userId ? 'user' : 'default'),
    hint: hasKey
      ? `Gemini ${model}`
      : 'Set GEMINI_API_KEY in Railway environment variables',
  };
}

function getGeminiEmbeddingOptions() {
  return GEMINI_EMBEDDING_OPTIONS;
}

module.exports = {
  EMBEDDING_DIM,
  resolveEmbeddingConfig,
  getGeminiEmbeddingOptions,
  DEFAULT_OLLAMA_EMBEDDING_MODEL,
  DEFAULT_GEMINI_EMBEDDING_MODEL,
};
