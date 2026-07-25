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

/**
 * Installed Ollama tags (local runtime only). Never invents models.
 * @returns {{ available: boolean, isLocalRuntime: boolean, baseUrl: string, models: Array<{ name: string, id: string, size: number|null }> }}
 */
async function listOllamaModels() {
  const baseUrl = ollamaBaseUrl();
  const isLocalRuntime = Boolean(runtimeConfig.isLocal);
  if (!isLocalRuntime) {
    return {
      available: false,
      isLocalRuntime: false,
      baseUrl,
      models: [],
      reason: 'Ollama is only available when APP_ENV=local',
    };
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      return {
        available: false,
        isLocalRuntime: true,
        baseUrl,
        models: [],
        reason: `Ollama responded with HTTP ${res.status}`,
      };
    }
    const data = await res.json().catch(() => ({}));
    const models = (Array.isArray(data.models) ? data.models : [])
      .map((m) => {
        const name = String(m?.name || m?.model || '').trim();
        if (!name) return null;
        return {
          name,
          id: name.startsWith('ollama:') ? name : `ollama:${name}`,
          size: typeof m.size === 'number' ? m.size : null,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      available: true,
      isLocalRuntime: true,
      baseUrl,
      models,
      reason: null,
    };
  } catch (err) {
    return {
      available: false,
      isLocalRuntime: true,
      baseUrl,
      models: [],
      reason: err.name === 'AbortError' ? 'Ollama did not respond in time' : (err.message || 'Ollama unreachable'),
    };
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
  listOllamaModels,
  isOllamaModel,
  normalizeOllamaModel,
  ollamaBaseUrl,
};
