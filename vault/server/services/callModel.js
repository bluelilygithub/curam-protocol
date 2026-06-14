'use strict';

/**
 * Provider-agnostic non-streaming model call.
 * Routes to Anthropic, DeepSeek, or Gemini based on model ID prefix.
 *
 * @param {string} modelId
 * @param {string} userPrompt
 * @param {object} [opts]
 * @param {number} [opts.maxTokens=500]
 * @param {string} [opts.system]
 * @param {boolean} [opts.returnUsage=false] - if true, returns { text, inputTokens, outputTokens }
 * @returns {Promise<string|{text:string,inputTokens:number,outputTokens:number}>}
 */
async function callModel(modelId, userPrompt, { maxTokens = 500, system = null, returnUsage = false } = {}) {
  if (!modelId) throw new Error('callModel: modelId required');

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
    const text = result.response.text().trim();
    if (!returnUsage) return text;
    return {
      text,
      inputTokens: result.response.usageMetadata?.promptTokenCount || 0,
      outputTokens: result.response.usageMetadata?.candidatesTokenCount || 0,
      model: modelId,
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
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({ model: modelId, messages, max_tokens: maxTokens }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `DeepSeek error ${res.status}`);
    const text = data.choices?.[0]?.message?.content?.trim() || '';
    if (!returnUsage) return text;
    return {
      text,
      inputTokens: data.usage?.prompt_tokens || 0,
      outputTokens: data.usage?.completion_tokens || 0,
      model: modelId,
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
  const text = response.content[0]?.text?.trim() || '';
  if (!returnUsage) return text;
  return {
    text,
    inputTokens: response.usage?.input_tokens || 0,
    outputTokens: response.usage?.output_tokens || 0,
    model: modelId,
  };
}

module.exports = { callModel };
