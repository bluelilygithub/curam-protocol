'use strict';

// "Describe how to join" planner for Video Tools → Join videos. The user describes the result in
// plain English; a light-tier model turns that into a small plan: the order to play the clips in
// and the transition between them. The plan is returned for review/editing, then sent back with
// POST /api/videos/join, which re-validates it with normalizeJoinPlan() — model output and client
// edits are both untrusted.
//
// The model only sees the description and the clip FILE NAMES (callModel is text-only and the
// footage is never uploaded for planning), so the UI says so.

const { callModel } = require('./callModel');
const { getModelsForUser } = require('./modelResolver');
const { logUsage } = require('../utils/logUsage');
const { parseModelJson } = require('../utils/parseModelJson');
const { TRANSITIONS } = require('./videoSlideshowPlan');

const MAX_CLIPS = 12; // matches the upload.array('videos', 12) limit on POST /join

function pick(value, allowed, fallback) {
  const v = String(value ?? '').trim().toLowerCase();
  return allowed.includes(v) ? v : fallback;
}

/**
 * Validate + clamp an untrusted join plan. `order` is always a permutation of 0..count-1: invalid
 * or duplicate indices are dropped and clips the plan forgot are appended in upload order.
 */
function normalizeJoinPlan(raw, clipCount) {
  const count = Math.max(0, Math.min(MAX_CLIPS, Number(clipCount) || 0));
  const src = raw && typeof raw === 'object' ? raw : {};

  const seen = new Set();
  const order = [];
  for (const v of Array.isArray(src.order) ? src.order : []) {
    const i = Number(v);
    if (!Number.isInteger(i) || i < 0 || i >= count || seen.has(i)) continue;
    seen.add(i);
    order.push(i);
  }
  for (let i = 0; i < count; i += 1) if (!seen.has(i)) order.push(i);

  const transition = pick(src.transition, TRANSITIONS, 'cut');
  const sec = Number(src.transitionSec);
  return {
    order,
    transition,
    transitionSec: transition === 'cut' ? 0 : (Number.isFinite(sec) ? Math.min(2, Math.max(0.2, sec)) : 0.6),
    summary: String(src.summary ?? '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300),
  };
}

const PLANNER_SYSTEM = `You plan how to join several video clips into one video with ffmpeg.
You cannot see the footage — only the user's description and the clip file names. Never invent what a clip shows; only reorder clips when the description or the file names clearly say what the order should be, otherwise keep the upload order.
Return ONLY valid JSON, no markdown fences.`;

function buildJoinPrompt(description, clips) {
  const list = clips.map((c, i) => `${i}: ${String(c.name || `clip ${i + 1}`).slice(0, 80)}`).join('\n');
  return `What the user wants:
"""${String(description).slice(0, 1500)}"""

Clips in upload order (index: file name):
${list}

Choose how to join them. Allowed values:
- order: array of every clip index exactly once, in PLAY order
- transition: ${TRANSITIONS.join(' | ')} ("cut" = hard cut, no blend)
- transitionSec: 0.2-2 (ignored for "cut")
Calm, elegant or cinematic → slower blends (fade/dissolve, ~1-1.5s). Energetic or punchy → cut or a short wipe/slide (~0.3-0.5s).

Return JSON:
{"summary":"one sentence on what you chose and why","order":[0,1,2],"transition":"fade","transitionSec":0.8}`;
}

/** @param {{ description: string, clips: Array<{name?: string}> }} input */
async function planJoin(userId, { description, clips }) {
  const desc = String(description || '').trim();
  if (!desc) throw new Error('Describe how you want the videos joined first');
  if (!Array.isArray(clips) || clips.length < 2) throw new Error('Add at least two videos first');
  if (clips.length > MAX_CLIPS) throw new Error(`Maximum ${MAX_CLIPS} clips`);

  const { light: modelId } = await getModelsForUser(userId);
  const result = await callModel(modelId, buildJoinPrompt(desc, clips), {
    system: PLANNER_SYSTEM,
    maxTokens: 600,
    returnUsage: true,
    timeoutMs: 45000,
  });
  logUsage({
    userId,
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    feature: 'videos',
  });

  const parsed = parseModelJson(String(result.text || '').trim());
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('The planner returned something unreadable — try rewording your description.');
  }
  return normalizeJoinPlan(parsed, clips.length);
}

module.exports = { planJoin, normalizeJoinPlan, buildJoinPrompt, MAX_CLIPS };
