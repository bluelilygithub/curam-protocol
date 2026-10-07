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
const { normalizeJoin, resolveTransitionType, describeTransitions, TRANSITIONS: JOIN_TRANSITIONS } = require('./videoJoin/transitions');
const { normalizeClipEffects, describeClipEffects } = require('./videoJoin/clipEffects');

const MAX_CLIPS = 12; // matches the upload.array('videos', 12) limit on POST /join

function pick(value, allowed, fallback) {
  const v = String(value ?? '').trim().toLowerCase();
  return allowed.includes(v) ? v : fallback;
}

/**
 * Per-clip effects, indexed by ORIGINAL upload index (stable when the order changes). Accepts a
 * sparse list of `{ clip: <index>, ...effects }` (what the planner returns) or a dense list.
 */
function normalizeClipsField(rawClips, count) {
  const out = Array.from({ length: count }, () => ({}));
  if (!Array.isArray(rawClips)) return out;
  rawClips.forEach((entry, pos) => {
    if (!entry || typeof entry !== 'object') return;
    const idx = entry.clip != null ? Number(entry.clip) : pos;
    if (!Number.isInteger(idx) || idx < 0 || idx >= count) return;
    out[idx] = { ...out[idx], ...normalizeClipEffects(entry) };
  });
  return out;
}

/**
 * Per-join transitions, one per gap in PLAY order (count - 1 of them). Every gap starts as the
 * plan's default transition. A sparse `{ after: <clip index>, type, ... }` entry overrides the gap
 * that follows that clip; a dense list without `after` is read by position.
 */
function normalizeJoinsField(rawJoins, order, defaultJoin) {
  const gaps = Math.max(0, order.length - 1);
  const out = Array.from({ length: gaps }, () => ({ ...defaultJoin }));
  if (Array.isArray(rawJoins)) {
    const dense = rawJoins.length === gaps;
    rawJoins.forEach((entry, pos) => {
      if (!entry || typeof entry !== 'object') return;
      let gap;
      if (entry.after != null) gap = order.indexOf(Number(entry.after));
      else if (dense) gap = pos;
      else return;
      if (!Number.isInteger(gap) || gap < 0 || gap >= gaps) return;
      out[gap] = normalizeJoin(entry, defaultJoin.type);
    });
  }
  return out.map((j, gap) => ({ after: order[gap], ...j }));
}

/**
 * Validate + clamp an untrusted join plan. `order` is always a permutation of 0..count-1: invalid
 * or duplicate indices are dropped and clips the plan forgot are appended in upload order.
 *
 * `transition`/`transitionSec` (the original single-transition plan) are kept as they were, and
 * also seed every join; `clips` and `joins` add per-clip effects and per-join transitions.
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

  const knownType = pick(src.transition, TRANSITIONS, null);
  const transition = knownType
    || (Object.prototype.hasOwnProperty.call(JOIN_TRANSITIONS, resolveTransitionType(src.transition, ''))
      ? resolveTransitionType(src.transition) : 'cut');
  const sec = Number(src.transitionSec);
  const transitionSec = transition === 'cut' ? 0 : (Number.isFinite(sec) ? Math.min(2, Math.max(0.2, sec)) : 0.6);
  const defaultJoin = normalizeJoin({ type: transition, duration: transitionSec || undefined }, 'cut');
  return {
    order,
    transition,
    transitionSec,
    clips: normalizeClipsField(src.clips, count),
    joins: normalizeJoinsField(src.joins, order, defaultJoin),
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

// The lists of transitions, effects and their ranges below are generated from the registries in
// videoJoin/, so a newly registered effect or transition is offered to the planner automatically.
function buildJoinPrompt(description, clips) {
  const list = clips
    .map((c, i) => `Clip ${i + 1} (index ${i}): ${String(c.name || `clip ${i + 1}`).slice(0, 80)}`)
    .join('\n');
  return `What the user wants:
"""${String(description).slice(0, 1500)}"""

Clips in upload order. People say "clip 1" for index 0, "clip 2" for index 1, and so on; use the index in your JSON:
${list}

Choose how to join them. Fields:
- order: array of every clip index exactly once, in PLAY order
- transition: the default transition for every join (one of the join types below, "cut" if the user did not ask for one)
- transitionSec: default blend length in seconds, 0.2-2 (ignored for "cut")
- joins: ONLY the joins that differ from the default. Each is {"after": <clip index>, "type": <join type>, ...its settings}. "after" is the clip that plays just before the join, so "between clips 1 and 2" is after index 0.
- clips: ONLY clips that need effects. Each is {"clip": <clip index>, ...its settings}.
Leave out anything the user did not ask for. Never invent settings; use only the names listed here.

Join types (set with "type" in a join, or "transition" for the default):
${describeTransitions()}

Clip effects (settings go straight on the clip object):
${describeClipEffects()}

Calm, elegant or cinematic → slower blends (crossfade, ~1-1.5s). Energetic or punchy → cut or a short wipe/slide (~0.3-0.5s).

Return JSON:
{"summary":"one sentence on what you chose and why","order":[0,1,2],"transition":"cut","transitionSec":0.6,"joins":[{"after":0,"type":"dip_black","hold":0.5}],"clips":[{"clip":2,"look":"bw"}]}`;
}

/**
 * @param {{ description: string, clips: Array<{name?: string}> }} input
 * @param {{ callModel?: Function, getModelsForUser?: Function, logUsage?: Function }} [deps] test seams
 */
async function planJoin(userId, { description, clips }, deps = {}) {
  const desc = String(description || '').trim();
  if (!desc) throw new Error('Describe how you want the videos joined first');
  if (!Array.isArray(clips) || clips.length < 2) throw new Error('Add at least two videos first');
  if (clips.length > MAX_CLIPS) throw new Error(`Maximum ${MAX_CLIPS} clips`);

  const call = deps.callModel || callModel;
  const { light: modelId } = await (deps.getModelsForUser || getModelsForUser)(userId);
  const result = await call(modelId, buildJoinPrompt(desc, clips), {
    system: PLANNER_SYSTEM,
    maxTokens: 1200,
    returnUsage: true,
    timeoutMs: 45000,
  });
  (deps.logUsage || logUsage)({
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
