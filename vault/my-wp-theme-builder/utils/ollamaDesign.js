'use strict';

const path = require('path');
const { runtimeConfig } = require(path.join(__dirname, '..', '..', 'server', 'config', 'runtime'));

let ollamaAgent = null;

function getOllamaAgent() {
  if (ollamaAgent !== null) return ollamaAgent;
  try {
    const { Agent } = require('undici');
    ollamaAgent = new Agent({
      headersTimeout: 0,
      bodyTimeout: 0,
      connectTimeout: 120_000,
    });
  } catch {
    ollamaAgent = undefined;
  }
  return ollamaAgent || null;
}

function ollamaBaseUrl() {
  return (process.env.OLLAMA_BASE_URL || runtimeConfig.ollamaBaseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
}

function slugifyPage(page) {
  return String(page || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

function buildProgressTrackers(pages = []) {
  const reported = new Set();
  const checks = [
    { id: 'html', pattern: /"html"\s*:\s*"/, label: 'HTML document' },
    { id: 'doctype', pattern: /<!DOCTYPE/i, label: 'Page structure' },
    { id: 'header', pattern: /<header[\s>]/i, label: 'Header' },
    { id: 'nav', pattern: /<nav[\s>]/i, label: 'Navigation menu' },
    ...pages.map((page) => ({
      id: `page-${page}`,
      pattern: new RegExp(`<section[^>]*id=["']${slugifyPage(page)}["']`, 'i'),
      label: `${page} page`,
    })),
    { id: 'hero', pattern: /class=["'][^"']*hero/i, label: 'Hero section' },
    { id: 'form', pattern: /<form[\s>]/i, label: 'Forms' },
    { id: 'search', pattern: /type=["']search["']/i, label: 'Search field' },
    { id: 'newsletter', pattern: /newsletter|subscribe/i, label: 'Newsletter signup' },
    { id: 'footer', pattern: /<footer[\s>]/i, label: 'Footer' },
    { id: 'css', pattern: /"css"\s*:\s*"/, label: 'CSS stylesheet' },
  ];

  return {
    scan(text, onItem) {
      for (const check of checks) {
        if (reported.has(check.id)) continue;
        if (check.pattern.test(text)) {
          reported.add(check.id);
          onItem(check.label);
        }
      }
    },
  };
}

async function streamOllamaDesign(modelId, { system, user, maxTokens = 20000, pages = [], onProgress, abortSignal, temperature = 0.7 } = {}) {
  const model = String(modelId).replace(/^ollama:/, '');
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: user });

  const agent = getOllamaAgent();
  const fetchOpts = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      options: { temperature, num_predict: maxTokens },
    }),
  };
  if (agent) fetchOpts.dispatcher = agent;
  if (abortSignal) fetchOpts.signal = abortSignal;

  const res = await fetch(`${ollamaBaseUrl()}/api/chat`, fetchOpts);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Ollama error ${res.status}: ${body}`);
  }

  const tracker = buildProgressTrackers(pages);
  let fullText = '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    if (abortSignal?.aborted) {
      try { reader.cancel(); } catch { /* ignore */ }
      const err = new Error('Generation cancelled');
      err.status = 499;
      err.cancelled = true;
      throw err;
    }
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        const piece = data.message?.content || '';
        if (!piece) continue;
        fullText += piece;
        tracker.scan(fullText, (label) => {
          if (typeof onProgress === 'function') onProgress(label);
        });
      } catch {
        // ignore partial NDJSON lines
      }
    }
  }

  if (!fullText.trim()) {
    throw new Error('Empty response from Ollama');
  }

  return { text: fullText.trim(), model: `ollama:${model}` };
}

module.exports = {
  streamOllamaDesign,
};
