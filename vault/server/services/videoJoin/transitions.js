'use strict';

// Join-point transitions. Each entry declares its kind and parameters; the graph builder
// (joinGraph.js) switches on `kind`, so a new transition of an existing kind is one entry here:
//   cut      hard cut, nothing between the clips
//   overlap  the clips overlap and an ffmpeg xfade blends them (audio: acrossfade)
//   dip      each side fades to ONE solid colour at a fixed level, optional hold, then fades up
//
// Dip to black/white is deliberately NOT two independent fades: both sides are blended toward the
// same solid colour, so at the dark point they are exactly that colour and match perfectly,
// whatever the clips' own brightness.

const { num, oneOf, round3, normalizeValue, describeParam } = require('./schema');

const CURVES = ['linear', 'ease_in', 'ease_out', 's_curve'];

const overlapParams = () => ({
  duration: num(0.1, 3, 0.6, 'length of the blend in seconds'),
});

const dipParams = () => ({
  fadeOut: num(0.05, 3, 0.5, 'seconds for the outgoing clip to fade to the dip colour'),
  hold: num(0, 3, 0, 'seconds to stay on the solid dip colour before the next clip appears'),
  fadeIn: num(0.05, 3, 0.5, 'seconds for the next clip to fade up from the dip colour'),
  level: num(0, 100, 0, 'brightness of the dip colour in percent: 0 = black, 5 = very dark grey, 100 = white'),
  curve: oneOf(CURVES, 'linear', 'shape of the fade: linear | ease_in (slow start) | ease_out (slow finish) | s_curve (slow start and finish)'),
});

const TRANSITIONS = {
  cut: { kind: 'cut', description: 'Hard cut. No blend between the clips (the default).', params: {} },
  crossfade: { kind: 'overlap', xfade: 'fade', description: 'Crossfade: the clips blend into each other.', params: overlapParams() },
  wipe_left: { kind: 'overlap', xfade: 'wipeleft', description: 'Wipe: the next clip is revealed moving right to left.', params: overlapParams() },
  wipe_right: { kind: 'overlap', xfade: 'wiperight', description: 'Wipe: the next clip is revealed moving left to right.', params: overlapParams() },
  wipe_up: { kind: 'overlap', xfade: 'wipeup', description: 'Wipe: the next clip is revealed moving bottom to top.', params: overlapParams() },
  wipe_down: { kind: 'overlap', xfade: 'wipedown', description: 'Wipe: the next clip is revealed moving top to bottom.', params: overlapParams() },
  slide_left: { kind: 'overlap', xfade: 'slideleft', description: 'Slide: the next clip pushes the current one off to the left.', params: overlapParams() },
  slide_right: { kind: 'overlap', xfade: 'slideright', description: 'Slide: the next clip pushes the current one off to the right.', params: overlapParams() },
  slide_up: { kind: 'overlap', xfade: 'slideup', description: 'Slide: the next clip pushes the current one off upward.', params: overlapParams() },
  slide_down: { kind: 'overlap', xfade: 'slidedown', description: 'Slide: the next clip pushes the current one off downward.', params: overlapParams() },
  dip_black: {
    kind: 'dip',
    color: 'black',
    description: 'Dip to black (fade to dark between the clips). Set level above 0 for a dark grey instead of pure black.',
    params: dipParams(),
  },
  dip_white: {
    kind: 'dip',
    color: 'white',
    description: 'Dip to white (flash to light between the clips). Lower the level for a light grey instead of pure white.',
    params: dipParams(),
    paramDefaults: { level: 100 },
  },
  // Older plans/UIs only. Accepted and validated, but not offered to the planner.
  dissolve: { kind: 'overlap', xfade: 'dissolve', hidden: true, description: 'Dissolve.', params: overlapParams() },
  fadeblack: { kind: 'overlap', xfade: 'fadeblack', hidden: true, description: 'Fade through black (legacy).', params: overlapParams() },
  circleopen: { kind: 'overlap', xfade: 'circleopen', hidden: true, description: 'Circle open.', params: overlapParams() },
  zoomin: { kind: 'overlap', xfade: 'zoomin', hidden: true, description: 'Zoom in.', params: overlapParams() },
};

// Names the old planner/UI used, plus phrasings a model is likely to produce.
const ALIASES = {
  fade: 'crossfade',
  cross_fade: 'crossfade',
  wipeleft: 'wipe_left',
  wiperight: 'wipe_right',
  wipeup: 'wipe_up',
  wipedown: 'wipe_down',
  slideleft: 'slide_left',
  slideright: 'slide_right',
  slideup: 'slide_up',
  slidedown: 'slide_down',
  dip_to_black: 'dip_black',
  fade_to_black: 'dip_black',
  fade_through_black: 'dip_black',
  dip_to_white: 'dip_white',
  fade_to_white: 'dip_white',
  none: 'cut',
  hard_cut: 'cut',
};

function resolveTransitionType(raw, fallback = 'cut') {
  const key = String(raw ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const id = ALIASES[key] || key;
  return Object.prototype.hasOwnProperty.call(TRANSITIONS, id) ? id : fallback;
}

/**
 * Validate + clamp one untrusted join. Returns the type plus every parameter that type has
 * (filled with defaults), so a plan is complete and the UI can edit it directly.
 */
function normalizeJoin(raw, fallbackType = 'cut') {
  const src = raw && typeof raw === 'object' ? raw : {};
  const type = resolveTransitionType(src.type ?? src.transition, fallbackType);
  const def = TRANSITIONS[type];
  const out = { type };
  const input = { ...src };
  // `duration` / `transitionSec` is the natural thing to say for a dip too: it sets both fades.
  const generic = src.duration ?? src.transitionSec;
  if (def.kind === 'dip' && generic != null) {
    if (input.fadeOut == null) input.fadeOut = generic;
    if (input.fadeIn == null) input.fadeIn = generic;
  }
  if (def.kind === 'overlap' && input.duration == null && src.transitionSec != null) {
    input.duration = src.transitionSec;
  }
  for (const [key, spec] of Object.entries(def.params)) {
    out[key] = normalizeValue(input[key], spec, def.paramDefaults?.[key]);
  }
  return out;
}

function joinsEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---- dip maths (pure; unit-tested) --------------------------------------------------------

/** ffmpeg expression for a 0..1 eased progress value `u` (itself an expression). */
function curveExpr(curve, u) {
  switch (curve) {
    case 'ease_in': return `pow(${u},2)`;
    case 'ease_out': return `(1-pow(1-(${u}),2))`;
    case 's_curve': return `((${u})*(${u})*(3-2*(${u})))`;
    default: return `(${u})`;
  }
}

/** Same curves as plain numbers, for tests. */
function curveValue(curve, u) {
  const x = Math.min(1, Math.max(0, u));
  switch (curve) {
    case 'ease_in': return x * x;
    case 'ease_out': return 1 - (1 - x) * (1 - x);
    case 's_curve': return x * x * (3 - 2 * x);
    default: return x;
  }
}

// afade curve names chosen so the audio follows the same shape as the picture. ffmpeg mirrors the
// curve for fade-outs, so ease_in/ease_out swap names between the two directions.
const AUDIO_CURVES = {
  in: { linear: 'tri', ease_in: 'qua', ease_out: 'ipar', s_curve: 'hsin' },
  out: { linear: 'tri', ease_in: 'ipar', ease_out: 'qua', s_curve: 'hsin' },
};

/** Level percent -> the solid colour as 0xRRGGBB. */
function dipColourHex(level) {
  const v = Math.round((Math.min(100, Math.max(0, level)) / 100) * 255);
  const h = v.toString(16).padStart(2, '0');
  return `0x${h}${h}${h}`;
}

/** Text for the AI planner's prompt, generated from the registry. */
function describeTransitions() {
  return Object.entries(TRANSITIONS)
    .filter(([, def]) => !def.hidden)
    .map(([id, def]) => [
      `- ${id}: ${def.description}`,
      ...Object.entries(def.params).map(([key, spec]) => `    ${describeParam(key, spec, def.paramDefaults?.[key])}`),
    ].join('\n'))
    .join('\n');
}

module.exports = {
  CURVES,
  TRANSITIONS,
  resolveTransitionType,
  normalizeJoin,
  joinsEqual,
  curveExpr,
  curveValue,
  AUDIO_CURVES,
  dipColourHex,
  describeTransitions,
  round3,
};
