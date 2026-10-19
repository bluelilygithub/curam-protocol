'use strict';

// "Not sure what to ask for?": the person describes their video, or the sound they are after, in their own words, and the
// workspace's light model fills in the mood and tempo, or, when none of the ready-made moods fits (they named an instrument
// or a place, say "a cello in a cathedral"), writes a short description for the music model. The model only ever chooses from
// MOOD_PRESETS or writes that description; its answer is treated as untrusted. It sees only the typed words, never the video
// (the model call here takes text only).

// The model, settings and usage modules reach the database, so they are loaded only when a suggestion is really made
// (tests pass their own).
const { MOOD_PRESETS, CUSTOM_ID } = require('./musicPrompts');

const MAX_DESCRIPTION_CHARS = 600;
const MAX_PROMPT_CHARS = 400;

const SYSTEM = `You help someone ask an AI music generator for background music. They describe their video, or the sound they are after, in their own words. Reply with EITHER one ready-made mood OR a custom description.

Ready-made moods (use the id exactly). Most lean electronic or pop, so they suit a general feeling, not a particular instrument or place:
${MOOD_PRESETS.map((m) => `- ${m.id}: ${m.label} (usually about ${m.defaultBpm} BPM)`).join('\n')}

Use a ready-made mood ONLY when one genuinely fits the feeling AND the person has not asked for a particular instrument, setting or sound. If they name an instrument (cello, harp, acoustic guitar...), a place or acoustic (a cathedral, a forest, a small room...), or a sound that none of the moods match, answer with "mood":"custom" and write the description yourself.

A custom description is 8 to 40 words of comma-separated phrases for a music model: the instrument(s) first, then the feel, then the space or sound, then the pace. Describe only what is WANTED. NEVER use the words no, not, without, avoid or non-, and never name a sound that is not wanted, because naming it pulls the music towards it. Example: "solo cello, slow warm sustained notes, long stone-cathedral reverb, spacious and quiet, gentle rainy-day mood, ambient".

Also give a tempo in BPM between 60 and 160 when a pace is clear, otherwise null.

Reply with ONLY a JSON object, no other text:
{"mood":"<ready-made id, or custom>","prompt":"<the custom description, or an empty string for a ready-made mood>","bpm":<number or null>,"why":"one short plain sentence saying why this fits"}`;

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

const NEGATIVE_PHRASE = /\b(?:no|not|without|avoid|never|non-?\w*|don'?t)\b/i;

/**
 * A custom description made safe: one line, at most MAX_PROMPT_CHARS, and any comma-separated phrase that says what is NOT
 * wanted ("no drums") is dropped, whatever the model was told, because naming a sound pulls the music towards it.
 * Returns '' when nothing usable is left.
 */
function cleanCustomPrompt(raw) {
  const parts = String(raw || '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p && !NEGATIVE_PHRASE.test(p));
  const out = [];
  let len = 0;
  for (const p of parts) {
    len += p.length + 2;
    if (len > MAX_PROMPT_CHARS) break;
    out.push(p);
  }
  const text = out.join(', ');
  return text.length >= 5 ? text : '';
}

/**
 * The model's reply made safe. Either a known ready-made mood, or `custom` with a cleaned description; a tempo in range or
 * null; a short reason. Null when there is nothing usable.
 */
function normalizeMoodReply(raw) {
  const parsed = typeof raw === 'string' ? extractJson(raw) : raw;
  if (!parsed || typeof parsed !== 'object') return null;
  const n = Number(parsed.bpm);
  const bpm = Number.isFinite(n) && n >= 40 && n <= 220 ? Math.round(n) : null;
  const why = String(parsed.why || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const id = String(parsed.mood || '').trim();

  if (id === CUSTOM_ID) {
    const prompt = cleanCustomPrompt(parsed.prompt);
    if (!prompt) return null;
    return { mood: CUSTOM_ID, label: 'A description for you', prompt, bpm, why };
  }
  const preset = MOOD_PRESETS.find((m) => m.id === id);
  if (!preset) return null;
  return { mood: preset.id, label: preset.label, prompt: '', bpm, why };
}

async function suggestMood(userId, description, deps = {}) {
  const text = cleanDescription(description);
  if (text.length < 3) {
    const err = new Error('Say a little about your video or the sound you want first, for example "a rainy day, something like a slow cello in a cathedral".');
    err.status = 400;
    throw err;
  }
  const getModels = deps.getModels || require('../modelResolver').getModelsForUser;
  const call = deps.callModel || require('../callModel').callModel;
  const log = deps.logUsage || require('../../utils/logUsage').logUsage;
  const { light: modelId } = await getModels(userId);
  const result = await call(modelId, `What they wrote: ${text}`, {
    system: SYSTEM, maxTokens: 1500, returnUsage: true, timeoutMs: 45000,
  });
  log({ userId, model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, feature: 'music' });
  const reply = normalizeMoodReply(String(result.text || ''));
  if (!reply) {
    const err = new Error('I could not work that out. Try describing it a little differently, or choose a mood yourself.');
    err.status = 422;
    throw err;
  }
  return reply;
}

module.exports = { suggestMood, normalizeMoodReply, cleanCustomPrompt, cleanDescription, SYSTEM, MAX_DESCRIPTION_CHARS, MAX_PROMPT_CHARS };
