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

async function callModel(modelId, userPrompt, { maxTokens = 500, system = null, returnUsage = false, timeoutMs = 0 } = {}) {
  if (!modelId) throw new Error('callModel: modelId required');

  const run = () => callModelInner(modelId, userPrompt, { maxTokens, system, returnUsage });

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

async function callModelInner(modelId, userPrompt, { maxTokens = 500, system = null, returnUsage = false } = {}) {
  const promptLen = String(userPrompt || '').length;

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
    const result = await gModel.generateContent(userPrompt);
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
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: modelId, messages, max_tokens: maxTokens }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `DeepSeek error ${res.status}`);
    const choice = data.choices?.[0];
    const text = normalizeMessageContent(choice?.message?.content);
    const diagnostics = {
      provider: 'deepseek',
      modelId,
      promptLen,
      textLen: text.length,
      empty: !text,
      finishReason: choice?.finish_reason || null,
      contentType: typeof choice?.message?.content,
      maxTokens,
    };
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
  const params = { model: modelId, max_tokens: maxTokens, messages: [{ role: 'user', content: userPrompt }] };
  if (system) params.system = system;
  const response = await client.messages.create(params);
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

module.exports = { callModel };
