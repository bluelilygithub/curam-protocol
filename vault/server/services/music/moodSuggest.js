'use strict';

// "Not sure which mood?": the person describes their video in a sentence and the workspace's light model picks the closest of
// the ready-made moods (and a tempo). The model only ever chooses from MOOD_PRESETS; its answer is treated as untrusted. It sees
// only the typed sentence, never the video (the model call here takes text only).

// The model, settings and usage modules reach the database, so they are loaded only when a suggestion is really made
// (tests pass their own).
const { MOOD_PRESETS } = require('./musicPrompts');

const MAX_DESCRIPTION_CHARS = 600;

const SYSTEM = `You help someone choose background music for a video. They describe the video in a sentence or two. Choose the ONE mood from the list that fits best, and a tempo in BPM (beats per minute) between 60 and 160 that suits the video's energy.

Moods (use the id exactly):
${MOOD_PRESETS.map((m) => `- ${m.id}: ${m.label} (usually about ${m.defaultBpm} BPM)`).join('\n')}

Reply with ONLY a JSON object, no other text:
{"mood":"<id>","bpm":<number>,"why":"one short plain sentence saying why this fits"}`;

function cleanDescription(raw) {
  return String(raw || '').replace(/\s+/g, ' ').trim().slice(0, MAX_DESCRIPTION_CHARS);
}

function extractJson(text) {
  let s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try { return JSON.parse(s); } catch { /* fall through */ }
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a !== -1 && b > a) {
    try { return JSON.parse(s.slice(a, b + 1)); } catch { /* fall through */ }
  }
  return null;
}

/** The model's reply made safe: a known mood id, a tempo in range (or null), a short reason. Null when there is no usable mood. */
function normalizeMoodReply(raw) {
  const parsed = typeof raw === 'string' ? extractJson(raw) : raw;
  if (!parsed || typeof parsed !== 'object') return null;
  const preset = MOOD_PRESETS.find((m) => m.id === String(parsed.mood || '').trim());
  if (!preset) return null;
  const n = Number(parsed.bpm);
  const bpm = Number.isFinite(n) && n >= 40 && n <= 220 ? Math.round(n) : null;
  return {
    mood: preset.id,
    label: preset.label,
    bpm,
    why: String(parsed.why || '').replace(/\s+/g, ' ').trim().slice(0, 200),
  };
}

async function suggestMood(userId, description, deps = {}) {
  const text = cleanDescription(description);
  if (text.length < 3) {
    const err = new Error('Say a little about your video first, for example "a calm product tour for a skincare shop".');
    err.status = 400;
    throw err;
  }
  const getModels = deps.getModels || require('../modelResolver').getModelsForUser;
  const call = deps.callModel || require('../callModel').callModel;
  const log = deps.logUsage || require('../../utils/logUsage').logUsage;
  const { light: modelId } = await getModels(userId);
  const result = await call(modelId, `The video: ${text}`, {
    system: SYSTEM, maxTokens: 200, returnUsage: true, timeoutMs: 30000,
  });
  log({ userId, model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, feature: 'music' });
  const reply = normalizeMoodReply(String(result.text || ''));
  if (!reply) {
    const err = new Error('I could not pick a mood from that. Try describing the video a little differently, or choose a mood yourself.');
    err.status = 422;
    throw err;
  }
  return reply;
}

module.exports = { suggestMood, normalizeMoodReply, cleanDescription, SYSTEM, MAX_DESCRIPTION_CHARS };
