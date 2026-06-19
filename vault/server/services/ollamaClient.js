'use strict';

const { runtimeConfig } = require('../config/runtime');

function ollamaBaseUrl() {
  return (process.env.OLLAMA_BASE_URL || runtimeConfig.ollamaBaseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
}

function isOllamaModel(modelId, provider = '') {
  return provider === 'ollama' || String(modelId || '').startsWith('ollama:');
}

function normalizeOllamaModel(modelId) {
  return String(modelId || '').replace(/^ollama:/, '');
}

async function isOllamaAvailable() {
  if (!runtimeConfig.isLocal) return false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${ollamaBaseUrl()}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch (_) {
    return false;
  }
}

async function callOllamaModel(modelId, messages, { temperature = 0.7, maxTokens = 500, stream = false } = {}) {
  if (!runtimeConfig.isLocal) {
    throw new Error('Local Ollama models are only available when APP_ENV=local');
  }
  const model = normalizeOllamaModel(modelId);
  if (!model) throw new Error('Ollama model id required');

  const res = await fetch(`${ollamaBaseUrl()}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream,
      options: {
        temperature,
        num_predict: maxTokens,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Ollama API error ${res.status}: ${body}`);
  }
  return res;
}

module.exports = {
  callOllamaModel,
  isOllamaAvailable,
  isOllamaModel,
  normalizeOllamaModel,
  ollamaBaseUrl,
};
