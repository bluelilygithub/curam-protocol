'use strict';

/**
 * Real AI-assistant checks for the AI Visibility audit.
 *
 * Each buyer question is put to real assistants that search the web themselves, the way a
 * person using them would get an answer:
 *   - Claude with Anthropic's web search tool (the first Anthropic model in Settings → Models);
 *   - Gemini grounded with Google Search (the first Gemini model in Settings → Models);
 *   - Perplexity's Sonar API, when a PERPLEXITY_API_KEY is set (environment or Settings).
 *
 * Each one returns its own answer and the sources it used. The audit then checks, per
 * assistant, whether the business was named and whether a page on the site was among the
 * sources. That is a sample of what these assistants said for this question at this moment,
 * not a guarantee of what they say to everyone: answers vary by run, account and location.
 *
 * Model ids come from the workspace model list, never hardcoded (CLAUDE.md, Model
 * selection). Perplexity is not in that list, so its model is the setting
 * `ai_visibility_perplexity_model`, defaulting to Perplexity's own entry model "sonar".
 */

const https = require('https');
const { getVaultModelsConfigForUser, getModelsForUser, isNonTextModel } = require('../modelResolver');
const { getSettingForUser } = require('../../utils/settingsLookup');

const ASSISTANT_TIMEOUT_MS = 120000;
const MAX_ANSWER_CHARS = 12000;
const MAX_SOURCES = 15;

const LABELS = {
  claude: 'Claude (web search)',
  gemini: 'Gemini (Google Search)',
  perplexity: 'Perplexity',
};

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} did not answer within ${Math.round(ms / 1000)} seconds.`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function isAnthropicEntry(m) {
  const id = String(m.id || '');
  if (m.provider) return m.provider === 'anthropic';
  return id.startsWith('claude-');
}

async function perplexityKey(userId) {
  try {
    const stored = await getSettingForUser(userId, 'PERPLEXITY_API_KEY');
    if (stored) return String(stored).trim();
  } catch { /* settings are optional */ }
  return String(process.env.PERPLEXITY_API_KEY || '').trim();
}

/**
 * Which assistants this person can run, and why not when one is unavailable. The page shows
 * this list as checkboxes, so nothing is asked of a provider that is not connected.
 */
async function listAssistants(userId) {
  const { models, defaultModel } = await getVaultModelsConfigForUser(userId);
  const text = (models || []).filter((m) => !isNonTextModel(m));
  const anthropic = text.filter(isAnthropicEntry).map((m) => String(m.id).trim());
  const claudeModel = anthropic.includes(defaultModel) ? defaultModel : (anthropic[0] || '');
  const tiers = await getModelsForUser(userId);
  const geminiModel = tiers.gemini || '';
  const pplxKey = await perplexityKey(userId);
  let pplxModel = 'sonar';
  try {
    const stored = await getSettingForUser(userId, 'ai_visibility_perplexity_model');
    if (stored) pplxModel = String(stored).trim();
  } catch { /* default */ }

  const out = [];
  out.push({
    id: 'claude',
    label: LABELS.claude,
    model: claudeModel,
    available: !!(claudeModel && process.env.ANTHROPIC_API_KEY),
    reason: !claudeModel ? 'No Anthropic model in Settings → Models.' : !process.env.ANTHROPIC_API_KEY ? 'ANTHROPIC_API_KEY is not set.' : '',
  });
  out.push({
    id: 'gemini',
    label: LABELS.gemini,
    model: geminiModel,
    available: !!(geminiModel && process.env.GEMINI_API_KEY),
    reason: !geminiModel ? 'No Gemini model in Settings → Models.' : !process.env.GEMINI_API_KEY ? 'GEMINI_API_KEY is not set.' : '',
  });
  out.push({
    id: 'perplexity',
    label: LABELS.perplexity,
    model: pplxKey ? pplxModel : '',
    available: !!pplxKey,
    reason: pplxKey ? '' : 'Add PERPLEXITY_API_KEY (environment or Settings) to include Perplexity.',
  });
  return out;
}

// ── Claude ──────────────────────────────────────────────────────────────────

/** Pull the answer text and the sources out of a Messages API response. Pure. */
function readClaudeContent(content) {
  const textParts = [];
  const cited = [];
  const seen = [];
  for (const block of content || []) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text') {
      textParts.push(block.text || '');
      for (const c of block.citations || []) {
        if (c && c.url) cited.push({ url: c.url, title: c.title || '' });
      }
    } else if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const r of block.content) {
        if (r && r.type === 'web_search_result' && r.url) seen.push({ url: r.url, title: r.title || '' });
      }
    }
  }
  return { text: textParts.join('').trim(), cited, seen };
}

async function askClaude(model, question) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const messages = [{ role: 'user', content: question }];
  const tools = [{
    type: 'web_search_20250305',
    name: 'web_search',
    max_uses: 3,
    user_location: { type: 'approximate', country: 'AU', timezone: 'Australia/Sydney' },
  }];
  const all = { text: '', cited: [], seen: [] };
  // A long server-side search turn can pause; continue it a couple of times at most.
  for (let turn = 0; turn < 3; turn += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await client.messages.create({ model, max_tokens: 2000, messages, tools });
    const part = readClaudeContent(res.content);
    all.text = `${all.text}${part.text}`;
    all.cited.push(...part.cited);
    all.seen.push(...part.seen);
    if (res.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: res.content });
  }
  // Cited sources first: they are what the answer actually leans on.
  return { answer: all.text, sources: [...all.cited, ...all.seen], citedSources: all.cited };
}

// ── Gemini ──────────────────────────────────────────────────────────────────

/**
 * Gemini's grounding chunks point at a Google redirect address; the chunk title is the
 * source's domain. Keep both so the site can be matched by either. Pure.
 */
function readGeminiGrounding(response) {
  const cand = (response && response.candidates && response.candidates[0]) || {};
  const meta = cand.groundingMetadata || {};
  const chunks = meta.groundingChunks || meta.groundingChuncks || [];
  return chunks
    .map((c) => (c && c.web) || null)
    .filter(Boolean)
    .map((w) => ({ url: w.uri || '', title: w.title || '', domain: w.title || '' }));
}

async function askGemini(model, question) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const gModel = genai.getGenerativeModel({
    model,
    tools: [{ googleSearch: {} }],
    generationConfig: { maxOutputTokens: 2000 },
  });
  const result = await gModel.generateContent(question);
  const response = result.response;
  let text = '';
  try { text = response.text(); } catch { text = ''; }
  const sources = readGeminiGrounding(response);
  return { answer: String(text || '').trim(), sources, citedSources: sources };
}

// ── Perplexity ──────────────────────────────────────────────────────────────

function postPerplexity(apiKey, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.perplexity.ai',
      path: '/chat/completions',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: ASSISTANT_TIMEOUT_MS,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let data;
        try { data = JSON.parse(Buffer.concat(chunks).toString()); } catch {
          reject(new Error(`Perplexity returned an unreadable reply (HTTP ${res.statusCode}).`));
          return;
        }
        if (res.statusCode >= 400) {
          const msg = (data && data.error && (data.error.message || data.error.type)) || `HTTP ${res.statusCode}`;
          reject(new Error(`Perplexity: ${msg}`));
          return;
        }
        resolve(data);
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Perplexity request timed out.')); });
    req.write(payload);
    req.end();
  });
}

/** Pure: Perplexity's answer and its sources. */
function readPerplexity(data) {
  const text = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  const results = Array.isArray(data && data.search_results) ? data.search_results : [];
  const fromResults = results.filter((r) => r && r.url).map((r) => ({ url: r.url, title: r.title || '' }));
  const fromCitations = (Array.isArray(data && data.citations) ? data.citations : [])
    .filter((u) => typeof u === 'string')
    .map((u) => ({ url: u, title: '' }));
  const sources = fromResults.length ? fromResults : fromCitations;
  return { answer: String(text).trim(), sources, citedSources: sources };
}

async function askPerplexity(model, question, userId) {
  const key = await perplexityKey(userId);
  if (!key) throw new Error('PERPLEXITY_API_KEY is not set.');
  const data = await postPerplexity(key, {
    model,
    messages: [{ role: 'user', content: question }],
  });
  return readPerplexity(data);
}

// ── One assistant, one question ─────────────────────────────────────────────

/**
 * A readable one-line reason from a provider error. The SDKs put raw JSON in the message
 * ("401 {"type":"error","error":{"message":"invalid x-api-key"}}", or Gemini's
 * "[GoogleGenerativeAI Error]: ... [400 Bad Request] API key not valid. ... [{...}]"). Pure.
 */
function friendlyError(err) {
  const raw = String((err && err.message) || err || 'Unknown error');
  const jsonAt = raw.indexOf('{');
  if (jsonAt >= 0) {
    try {
      const data = JSON.parse(raw.slice(jsonAt));
      const msg = (data.error && (data.error.message || data.error.type)) || data.message;
      const status = raw.slice(0, jsonAt).trim().match(/^\d{3}/);
      if (msg) return `${status ? `${status[0]}: ` : ''}${msg}`;
    } catch { /* not JSON; fall through */ }
  }
  const gemini = raw.match(/\[(\d{3})[^\]]*\]\s*([^[]+)/);
  if (gemini) return `${gemini[1]}: ${gemini[2].trim()}`;
  return raw.slice(0, 300);
}

/**
 * Ask one assistant one question. Never throws: a failure is recorded on the result and
 * that assistant is left out of the score for this question, rather than counted as zero.
 */
async function askAssistant(assistant, question, { userId } = {}) {
  const base = {
    id: assistant.id,
    label: assistant.label || LABELS[assistant.id] || assistant.id,
    model: assistant.model || '',
    answer: '',
    sources: [],
    error: '',
  };
  try {
    let run;
    if (assistant.id === 'claude') run = askClaude(assistant.model, question);
    else if (assistant.id === 'gemini') run = askGemini(assistant.model, question);
    else if (assistant.id === 'perplexity') run = askPerplexity(assistant.model, question, userId);
    else throw new Error(`Unknown assistant: ${assistant.id}`);
    const out = await withTimeout(run, ASSISTANT_TIMEOUT_MS, base.label);
    base.answer = String(out.answer || '').slice(0, MAX_ANSWER_CHARS);
    const dedup = new Map();
    for (const s of out.sources || []) {
      const key = s.url || s.title;
      if (key && !dedup.has(key)) dedup.set(key, s);
    }
    base.sources = [...dedup.values()].slice(0, MAX_SOURCES);
    if (!base.answer) base.error = `${base.label} returned no answer text.`;
  } catch (err) {
    base.error = friendlyError(err).slice(0, 400);
  }
  return base;
}

module.exports = {
  LABELS,
  listAssistants,
  askAssistant,
  friendlyError,
  readClaudeContent,
  readGeminiGrounding,
  readPerplexity,
};
