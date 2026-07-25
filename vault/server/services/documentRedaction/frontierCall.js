'use strict';

/**
 * Call a frontier model with an optional PDF document attachment.
 * Model id comes from the document-redaction-agent frontier slot — never hardcoded.
 */

async function callFrontierModel(modelId, {
  system,
  textPrompt,
  pdfBase64 = null,
  maxTokens = 8000,
} = {}) {
  if (!modelId) throw new Error('callFrontierModel: modelId required');

  // Anthropic — native PDF document block
  if (!modelId.startsWith('ollama:') && !modelId.startsWith('gemini-') && !modelId.startsWith('deepseek-')) {
    const Anthropic = require('@anthropic-ai/sdk');
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY is not configured');
    const client = new Anthropic({ apiKey: key });
    const content = [];
    if (pdfBase64) {
      content.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
      });
    }
    content.push({ type: 'text', text: textPrompt });
    const params = {
      model: modelId,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content }],
    };
    if (system) params.system = system;
    const response = await client.messages.create(params);
    const text = (response.content || []).map((b) => b.text || '').join('').trim();
    return {
      text,
      inputTokens: response.usage?.input_tokens || 0,
      outputTokens: response.usage?.output_tokens || 0,
      mode: pdfBase64 ? 'pdf_document' : 'text',
      provider: 'anthropic',
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
    const parts = [];
    if (pdfBase64) {
      parts.push({ inlineData: { mimeType: 'application/pdf', data: pdfBase64 } });
    }
    parts.push({ text: textPrompt });
    const result = await gModel.generateContent({ contents: [{ role: 'user', parts }] });
    let text = '';
    try {
      text = result.response.text().trim();
    } catch {
      const p = result.response.candidates?.[0]?.content?.parts || [];
      text = p.map((x) => x.text || '').join('').trim();
    }
    return {
      text,
      inputTokens: result.response.usageMetadata?.promptTokenCount || 0,
      outputTokens: result.response.usageMetadata?.candidatesTokenCount || 0,
      mode: pdfBase64 ? 'pdf_inline' : 'text',
      provider: 'gemini',
    };
  }

  // DeepSeek / Ollama — text only (PDF extracted upstream into textPrompt)
  const { callModel } = require('../callModel');
  const text = await callModel(modelId, textPrompt, { system, maxTokens, returnUsage: true });
  if (typeof text === 'string') {
    return { text, inputTokens: 0, outputTokens: 0, mode: 'text_only', provider: modelId.split(':')[0] };
  }
  return {
    text: text.text,
    inputTokens: text.inputTokens || 0,
    outputTokens: text.outputTokens || 0,
    mode: 'text_only',
    provider: modelId.startsWith('ollama:') ? 'ollama' : 'deepseek',
  };
}

module.exports = { callFrontierModel };
