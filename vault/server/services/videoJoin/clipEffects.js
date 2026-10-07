'use strict';

// Per-clip effects for Join videos. Each entry declares its parameters and a build() that returns
// ffmpeg filter fragments for the video and audio chains. The prepare stage runs the entries in
// `order`, then normalises size / frame rate — so transitions always work on the final look.
//
// To add an effect: append one entry here. Validation, the prepare stage and the AI planner's
// description of what is available are all generated from this list; nothing else changes.

const { MOOD_FILTERS, buildAtempoChain } = require('../videoFfmpeg');
const { num, oneOf, round3, normalizeValue, describeParam } = require('./schema');

const f = (n) => String(round3(n));

// Looks reuse the slideshow's colour grades (plain ffmpeg filters, no LUT files).
const LOOKS = { bw: MOOD_FILTERS.mono, warm: MOOD_FILTERS.warm, cool: MOOD_FILTERS.cool };

/**
 * build(p, ctx) -> null | { v?: string[], a?: string[], dur?: number }
 *   p   validated params, non-default keys only
 *   ctx { srcDur, dur }  source length and the length so far (trim/speed change it)
 */
const CLIP_EFFECTS = [
  {
    id: 'trim',
    order: 10,
    description: 'Cut the start and/or end off a clip.',
    params: {
      trimStart: num(0, 86400, 0, 'seconds to remove from the start of the clip'),
      trimEnd: num(0, 86400, 0, 'time in the original clip where it should stop, in seconds (0 = play to the end)'),
    },
    build(p, ctx) {
      if (!p.trimStart && !p.trimEnd) return null;
      const end = p.trimEnd > 0 ? Math.min(p.trimEnd, ctx.srcDur) : ctx.srcDur;
      const start = Math.min(p.trimStart || 0, Math.max(0, end - 0.2));
      const args = `start=${f(start)}:end=${f(end)}`;
      return {
        v: [`trim=${args}`, 'setpts=PTS-STARTPTS'],
        a: [`atrim=${args}`, 'asetpts=PTS-STARTPTS'],
        dur: end - start,
      };
    },
  },
  {
    id: 'speed',
    order: 20,
    description: 'Slow motion (below 1) or fast forward (above 1). Audio speed follows.',
    params: {
      speed: num(0.25, 4, 1, 'playback speed multiplier, e.g. 0.5 = half speed, 2 = double speed'),
    },
    build(p, ctx) {
      if (!p.speed || p.speed === 1) return null;
      return {
        v: [`setpts=PTS/${f(p.speed)}`],
        a: [buildAtempoChain(p.speed)],
        dur: ctx.dur / p.speed,
      };
    },
  },
  {
    id: 'colour',
    order: 30,
    description: 'Brightness, contrast and saturation.',
    params: {
      brightness: num(-0.5, 0.5, 0, 'brightness shift; 0.1 = slightly brighter, -0.1 = slightly darker'),
      contrast: num(0.2, 3, 1, 'contrast multiplier; 1 = unchanged, 1.3 = punchier'),
      saturation: num(0, 3, 1, 'colour intensity; 1 = unchanged, 0 = greyscale, 1.5 = vivid'),
    },
    build(p) {
      const parts = [];
      if (p.brightness) parts.push(`brightness=${f(p.brightness)}`);
      if (p.contrast) parts.push(`contrast=${f(p.contrast)}`);
      if (p.saturation != null) parts.push(`saturation=${f(p.saturation)}`);
      return parts.length ? { v: [`eq=${parts.join(':')}`] } : null;
    },
  },
  {
    id: 'look',
    order: 40,
    description: 'A simple colour look.',
    params: {
      look: oneOf(['none', ...Object.keys(LOOKS)], 'none', 'bw = black and white, warm = warmer tones, cool = cooler tones'),
    },
    build(p) {
      return p.look && LOOKS[p.look] ? { v: [LOOKS[p.look]] } : null;
    },
  },
  {
    id: 'fade',
    order: 50,
    description: 'Fade the clip in from black at its start and/or out to black at its end (a clip fade, not a transition between clips).',
    params: {
      fadeIn: num(0, 10, 0, 'seconds to fade in at the start of the clip'),
      fadeOut: num(0, 10, 0, 'seconds to fade out at the end of the clip'),
    },
    build(p, ctx) {
      if (!p.fadeIn && !p.fadeOut) return null;
      let fi = Math.min(p.fadeIn || 0, ctx.dur);
      let fo = Math.min(p.fadeOut || 0, ctx.dur);
      if (fi + fo > ctx.dur) {
        const k = ctx.dur / (fi + fo);
        fi *= k;
        fo *= k;
      }
      const v = [];
      const a = [];
      if (fi > 0) {
        v.push(`fade=t=in:st=0:d=${f(fi)}`);
        a.push(`afade=t=in:st=0:d=${f(fi)}`);
      }
      if (fo > 0) {
        v.push(`fade=t=out:st=${f(ctx.dur - fo)}:d=${f(fo)}`);
        a.push(`afade=t=out:st=${f(ctx.dur - fo)}:d=${f(fo)}`);
      }
      return { v, a };
    },
  },
  {
    id: 'audio',
    order: 60,
    description: 'Clip volume, or mute it.',
    params: {
      volume: num(0, 2, 1, 'volume multiplier; 1 = unchanged, 0.5 = half, 1.5 = louder'),
      mute: { type: 'bool', default: false, description: 'true to silence the clip completely' },
    },
    build(p) {
      if (p.mute) return { a: ['volume=0'] };
      if (p.volume != null && p.volume !== 1) return { a: [`volume=${f(p.volume)}`] };
      return null;
    },
  },
];

// Read from the registry on every call, so an entry added to CLIP_EFFECTS is picked up everywhere.
const sortedEffects = () => [...CLIP_EFFECTS].sort((a, b) => a.order - b.order);

/** Flat key -> spec map across every registered effect. */
function clipParams() {
  const all = {};
  for (const effect of CLIP_EFFECTS) Object.assign(all, effect.params);
  return all;
}

/**
 * Validate + clamp untrusted per-clip effect settings. Returns only keys that differ from their
 * default, so `{}` means "no effects". Unknown keys are dropped; nothing from here reaches a
 * filtergraph except as a clamped number or an allow-listed name.
 */
function normalizeClipEffects(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const [key, spec] of Object.entries(clipParams())) {
    if (!(key in src)) continue;
    const v = normalizeValue(src[key], spec);
    if (v !== spec.default) out[key] = v;
  }
  // A trim end at or before the start is meaningless — treat as "to the end".
  if (out.trimEnd != null && out.trimEnd <= (out.trimStart || 0) + 0.1) delete out.trimEnd;
  return out;
}

function hasClipEffects(effects) {
  return Boolean(effects) && Object.keys(effects).length > 0;
}

/** Run every effect in order and collect the filter chains + resulting length. */
function buildClipChain(effects, srcDur) {
  const ctx = { srcDur, dur: srcDur };
  const v = [];
  const a = [];
  for (const effect of sortedEffects()) {
    const r = effect.build(effects || {}, ctx);
    if (!r) continue;
    if (r.v) v.push(...r.v);
    if (r.a) a.push(...r.a);
    if (r.dur != null) ctx.dur = Math.max(0.1, r.dur);
  }
  return { v, a, dur: ctx.dur };
}

/** Text for the AI planner's prompt, generated from the registry. */
function describeClipEffects() {
  return CLIP_EFFECTS.map((effect) => [
    `- ${effect.description}`,
    ...Object.entries(effect.params).map(([key, spec]) => `    ${describeParam(key, spec)}`),
  ].join('\n')).join('\n');
}

module.exports = {
  CLIP_EFFECTS,
  clipParams,
  normalizeClipEffects,
  hasClipEffects,
  buildClipChain,
  describeClipEffects,
};
