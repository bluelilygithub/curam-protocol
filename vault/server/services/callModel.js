'use strict';

/**
 * Provider-agnostic non-streaming model call.
 * Routes to Anthropic, DeepSeek, or Gemini based on model ID prefix —
 * same logic as the main chat streaming route, but for background tasks.
 *
 * @param {string} modelId
 * @param {string} userPrompt
 * @param {object} [opts]
 * @param {number} [opts.maxTokens=500]
 * @param {string} [opts.system]       - system prompt (all providers)
 * @returns {Promise<string>}
 */
async function callModel(modelId, userPrompt, { maxTokens = 500, system = null } = {}) {
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
    return result.response.text().trim();
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
    return data.choices?.[0]?.message?.content?.trim() || '';
  }

  // Anthropic
  const Anthropic = require('@anthropic-ai/sdk');
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not configured');
  const client = new Anthropic({ apiKey: key });
  const params = { model: modelId, max_tokens: maxTokens, messages: [{ role: 'user', content: userPrompt }] };
  if (system) params.system = system;
  const response = await client.messages.create(params);
  return response.content[0]?.text?.trim() || '';
}

module.exports = { callModel };
