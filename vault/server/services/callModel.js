'use strict';

/**
 * Provider-agnostic non-streaming model call.
 * Routes to Anthropic, DeepSeek, Gemini, or local Ollama based on model ID prefix.
 *
 * @param {string} modelId
 * @param {string} userPrompt
 * @param {object} [opts]
 * @param {number} [opts.maxTokens=500]
 * @param {string} [opts.system]
 * @param {boolean} [opts.returnUsage=false] - if true, returns { text, inputTokens, outputTokens, diagnostics }
 * @param {Array<{mimeType:string,data:string}>} [opts.images] - pictures (base64, no data: prefix) shown to the model alongside the prompt.
 *   Only Anthropic and Gemini models can look at pictures; any other model throws.
 * @param {boolean} [opts.stream=false] - Anthropic only: stream the answer and return it whole when done. The SDK refuses a long
 *   non-streamed answer (max_tokens over about 21,000), so long outputs (PDF → HTML) set this. Other providers ignore it.
 * @param {(delta:string)=>void} [opts.onText] - with `stream`: called with each piece of text as it arrives (progress for long jobs).
 * @param {AbortSignal} [opts.signal] - with `stream`: abort the request (a cancelled background job).
 * @returns {Promise<string|{text:string,inputTokens:number,outputTokens:number,diagnostics?:object}>}
 */

function normalizeMessageContent(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part;
      if (part?.text) return part.text;
      if (part?.type === 'text' && part?.text) return part.text;
      return '';
    }).join('').trim();
  }
  return '';
}

function summarizeAnthropicContent(content) {
  return (content || []).map((b) => ({
    type: b?.type || typeof b,
    textLen: typeof b?.text === 'string' ? b.text.length : 0,
  }));
}

// The app files on the call stack (newest first, max 6), relative to the app folder, so a failed call can be traced to its tool.
function appCallers(stack) {
  const out = [];
  for (const line of String(stack || '').split('\n').slice(1)) {
    const m = line.match(/(?:\(|at (?:async )?)([^()]*?\.js):\d+:\d+\)?\s*$/);
    if (!m) continue;
    const f = m[1].replace(/\\/g, '/');
    const at = f.lastIndexOf('/server/');
    if (at < 0 || f.includes('/node_modules/') || f.endsWith('/services/callModel.js')) continue;
    const rel = f.slice(at + 1);
    if (!out.includes(rel)) out.push(rel);
    if (out.length >= 6) break;
  }
  return out.join('>');
}

// A failed call goes to model_call_errors for Code Map → Models: the model, the calling files and the message (cut short). Never the
// prompt or reply. A cancelled call is not a failure. Fire and forget: recording must never change what the caller sees.
function recordError(modelId, err, where, t0) {
  if (err && err.name === 'AbortError') return;
  try {
    require('../db').pool.query(
      'INSERT INTO model_call_errors (model_id, callers, error, latency_ms) VALUES ($1, $2, $3, $4)',
      [String(modelId), appCallers(where.stack), String((err && err.message) || err || 'failed').slice(0, 300), Date.now() - t0],
    ).catch(() => {});
  } catch { /* no database (tests): nothing to record */ }
}

async function callModel(modelId, userPrompt, opts = {}) {
  if (!modelId) throw new Error('callModel: modelId required');
  const where = new Error(); // the stack is only read if the call fails
  const t0 = Date.now();
  try {
    return await callModelTimed(modelId, userPrompt, opts);
  } catch (err) {
    recordError(modelId, err, where, t0);
    throw err;
  }
}

async function callModelTimed(modelId, userPrompt, { maxTokens = 500, system = null, returnUsage = false, timeoutMs = 0, images = null, stream = false, onText = null, signal = null } = {}) {

  // With returnUsage the result is an object; it also carries latencyMs so the caller can pass it to logUsage (Code Map → Models).
  const run = async () => {
    const t0 = Date.now();
    const result = await callModelInner(modelId, userPrompt, { maxTokens, system, returnUsage, images, stream, onText, signal });
    if (result && typeof result === 'object') result.latencyMs = Date.now() - t0;
    return result;
  };

  if (!timeoutMs || timeoutMs <= 0) return run();

  let timer;
  try {
    return await Promise.race([
      run(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Model call timed out after ${Math.round(timeoutMs / 1000)}s (${modelId})`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function callModelInner(modelId, userPrompt, { maxTokens = 500, system = null, returnUsage = false, images = null, stream = false, onText = null, signal = null } = {}) {
  const promptLen = String(userPrompt || '').length;
  const hasImages = Array.isArray(images) && images.length > 0;
  if (hasImages && !(modelId.startsWith('gemini-') || !/^(ollama:|deepseek-)/.test(modelId))) {
    throw new Error(`The model ${modelId} cannot look at pictures`);
  }

  if (modelId.startsWith('ollama:')) {
    const { callOllamaModel } = require('./ollamaClient');
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: userPrompt });
    const res = await callOllamaModel(modelId, messages, { maxTokens, stream: false });
    const data = await res.json();
    const text = data.message?.content?.trim() || '';
    const diagnostics = {
      provider: 'ollama',
      modelId,
      promptLen,
      textLen: text.length,
      empty: !text,
      httpOk: res.ok,
    };
    if (!text) console.warn('[callModel] empty ollama response', diagnostics);
    if (!returnUsage) return text;
    return {
      text,
      inputTokens: data.prompt_eval_count || 0,
      outputTokens: data.eval_count || 0,
      model: modelId,
      diagnostics,
    };
  }

  if (modelId.startsWith('gemini-')) {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY is not configured');
    const genai = new GoogleGenerativeAI(key);
    const gModel = genai.getGenerativeModel({
      model: modelId,
      ...(system ? { systemInstruction: system } : {}),
      generationConfig: { maxOutputTokens: maxTokens },
    });
    const result = await gModel.generateContent(hasImages
      ? [{ text: userPrompt }, ...images.map((im) => ({ inlineData: { mimeType: im.mimeType, data: im.data } }))]
      : userPrompt);
    let text = '';
    let finishReason = null;
    let blockTypes = [];
    try {
      text = result.response.text().trim();
    } catch (err) {
      const candidate = result.response.candidates?.[0];
      finishReason = candidate?.finishReason || candidate?.finish_reason || null;
      const parts = candidate?.content?.parts || [];
      blockTypes = parts.map((p) => (p.text != null ? 'text' : Object.keys(p || {}).join(',') || 'part'));
      text = parts.map((p) => p.text || '').join('').trim();
    }
    const diagnostics = {
      provider: 'gemini',
      modelId,
      promptLen,
      textLen: text.length,
      empty: !text,
      finishReason,
      blockTypes,
      maxTokens,
    };
    if (!text) {
      console.warn('[callModel] empty gemini response', diagnostics);
      // When caller wants usage/diagnostics, return empty instead of throwing so
      // Product Scout can fall back and log. Other callers still get a throw.
      if (!returnUsage) throw new Error('Gemini returned an empty response');
      return {
        text: '',
        inputTokens: result.response.usageMetadata?.promptTokenCount || 0,
        outputTokens: result.response.usageMetadata?.candidatesTokenCount || 0,
        model: modelId,
        diagnostics,
      };
    }
    if (!returnUsage) return text;
    return {
      text,
      inputTokens: result.response.usageMetadata?.promptTokenCount || 0,
      outputTokens: result.response.usageMetadata?.candidatesTokenCount || 0,
      model: modelId,
      diagnostics,
    };
  }

  if (modelId.startsWith('deepseek-')) {
    const key = process.env.DEEPSEEK_API_KEY;
    if (!key) throw new Error('DEEPSEEK_API_KEY is not configured');
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: userPrompt });

    async function deepseekCall(tokenBudget) {
      const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: modelId, messages, max_tokens: tokenBudget }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || `DeepSeek error ${res.status}`);
      const choice = data.choices?.[0];
      const text = normalizeMessageContent(choice?.message?.content);
      const reasoningContent = choice?.message?.reasoning_content;
      const reasoningTokens = data.usage?.completion_tokens_details?.reasoning_tokens ?? null;
      const diagnostics = {
        provider: 'deepseek',
        modelId,
        promptLen,
        textLen: text.length,
        empty: !text,
        finishReason: choice?.finish_reason || null,
        contentType: typeof choice?.message?.content,
        maxTokens: tokenBudget,
        reasoningContentLen: typeof reasoningContent === 'string' ? reasoningContent.length : null,
        completionTokens: data.usage?.completion_tokens ?? null,
        reasoningTokens,
      };
      return { text, data, diagnostics };
    }

    let { text, data, diagnostics } = await deepseekCall(maxTokens);

    // Reasoning-capable models (e.g. deepseek-v*-flash) can spend the entire max_tokens
    // budget on hidden reasoning_content and never reach the visible answer — that shows
    // up as textLen:0 + finishReason:'length' with reasoningTokens == maxTokens. Confirmed
    // via [callModel] empty deepseek response logs (reasoningTokens pinned to the budget).
    // Fix: retry once with a much larger budget so there's room left for the actual answer
    // after reasoning — cheaper than the caller giving up and falling back to pre_score/
    // default-only output.
    if (!text && diagnostics.finishReason === 'length' && diagnostics.reasoningTokens >= maxTokens) {
      const bumped = Math.min(Math.max(maxTokens * 4, maxTokens + 8192), 32768);
      console.warn('[callModel] deepseek reasoning consumed entire max_tokens — retrying with larger budget', {
        ...diagnostics,
        retryMaxTokens: bumped,
      });
      ({ text, data, diagnostics } = await deepseekCall(bumped));
    }

    if (!text) console.warn('[callModel] empty deepseek response', diagnostics);
    if (!returnUsage) return text;
    return {
      text,
      inputTokens: data.usage?.prompt_tokens || 0,
      outputTokens: data.usage?.completion_tokens || 0,
      model: modelId,
      diagnostics,
    };
  }

  // Anthropic
  const Anthropic = require('@anthropic-ai/sdk');
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not configured');
  const client = new Anthropic({ apiKey: key });
  const content = hasImages
    ? [...images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.mimeType, data: im.data } })), { type: 'text', text: String(userPrompt) }]
    : userPrompt;
  const params = { model: modelId, max_tokens: maxTokens, messages: [{ role: 'user', content }] };
  if (system) params.system = system;
  let response;
  if (stream) {
    const s = client.messages.stream(params, signal ? { signal } : undefined);
    if (typeof onText === 'function') s.on('text', (delta) => { try { onText(delta); } catch { /* a progress hook must never break the call */ } });
    response = await s.finalMessage();
  } else {
    response = await client.messages.create(params);
  }
  // Prefer all text blocks — content[0] may be thinking/tool_use on newer models.
  const blocks = response.content || [];
  const text = blocks
    .filter((b) => b?.type === 'text' || typeof b?.text === 'string')
    .map((b) => b.text || '')
    .join('')
    .trim();
  const diagnostics = {
    provider: 'anthropic',
    modelId,
    promptLen,
    textLen: text.length,
    empty: !text,
    stopReason: response.stop_reason || null,
    contentBlocks: summarizeAnthropicContent(blocks),
    maxTokens,
    usage: {
      input: response.usage?.input_tokens || 0,
      output: response.usage?.output_tokens || 0,
    },
  };
  if (!text) {
    console.warn('[callModel] empty anthropic response', JSON.stringify(diagnostics));
  }
  if (!returnUsage) return text;
  return {
    text,
    inputTokens: response.usage?.input_tokens || 0,
    outputTokens: response.usage?.output_tokens || 0,
    model: modelId,
    diagnostics,
  };
}

module.exports = { callModel, appCallers };
