'use strict';

// Voice directions for Video Tools. The browser turns speech into text (shared useVoice); this module
// turns that text into field values for ONE tool. Each tool has a small schema; the output is always
// re-validated against it, so a bad model answer can never set a value the form would not accept.
// Clip and GIF times ("from 10 to 25 seconds", "1:30 to 2:45") are parsed in code first: instant, free.

const { callModel } = require('./callModel');
const { getModelsForUser } = require('./modelResolver');
const { logUsage } = require('../utils/logUsage');
const { parseModelJson } = require('../utils/parseModelJson');

const ASPECTS = ['9:16', '16:9', '1:1', '4:5'];
const FOCUS = ['center', 'top', 'bottom', 'left', 'right'];
const POSITIONS = ['top-left', 'top-center', 'top-right', 'center-left', 'center', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right'];
const WEIGHTS = ['normal', 'bold'];

const N = (desc, min, max, extra = {}) => ({ type: 'number', desc, min, max, ...extra });
const E = (desc, options) => ({ type: 'enum', desc, options });
const T = (desc, max = 200) => ({ type: 'text', desc, max });
const B = (desc) => ({ type: 'bool', desc });
const L = (desc, options) => ({ type: 'list', desc, options });
const COLOR = (desc) => ({ type: 'color', desc });

const TEXT_STYLE = {
  textFontSize: N('Font size in pixels', 8, 120, { int: true }),
  textFontColor: COLOR('Text colour as #RRGGBB'),
  textFontWeight: E('Font weight', WEIGHTS),
  textBackgroundColor: COLOR('Text background colour as #RRGGBB'),
  textBackgroundTransparent: B('true = no background behind the text'),
};

const TOOL_SCHEMAS = {
  generate: {
    label: 'Generate clip',
    fields: {
      brief: T('What the clip should show, as the person described it', 1200),
      style: T('Visual style, e.g. cinematic, product b-roll, animation', 80),
      aspect: E('Aspect ratio', ASPECTS),
      durationSec: N('Clip length in seconds', 3, 10, { int: true }),
      batchCount: N('How many takes to make', 1, 4, { int: true }),
    },
  },
  clip: {
    label: 'Clip / trim',
    fields: {
      startSec: N('Where the kept part starts, in seconds from the beginning', 0, 86400),
      endSec: N('Where the kept part ends, in seconds from the beginning', 0, 86400),
    },
  },
  'extend-ending': {
    label: 'Extend ending',
    fields: {
      holdSec: N('How many seconds to hold the last frame', 1, 30),
      fadeOutSec: N('How many seconds the music takes to fade out (0 = no fade)', 0, 60),
      musicVolume: N('How loud the music is compared with the voice, as a percent (30 is a good background level)', 5, 150, { int: true }),
      ducking: E('Whether the music dips while the voice speaks: off, light or strong', ['off', 'light', 'strong']),
    },
  },
  'mix-audio': {
    label: 'Mix audio',
    fields: {
      musicVolume: N('How loud the music is compared with the voice, as a percent (30 is a good background level, 100 is as loud as the voice)', 5, 150, { int: true }),
      ducking: E('Whether the music dips while the voice speaks: off, light or strong', ['off', 'light', 'strong']),
      leadInSec: N('Seconds the music plays before the voice starts', 0, 30),
      tailSec: N('Seconds the music keeps playing after the voice ends', 0, 60),
      format: E('File type of the result', ['mp3', 'wav']),
    },
  },
  'trim-audio': {
    label: 'Trim audio',
    fields: {
      startSec: N('Where the part starts, in seconds from the beginning of the recording', 0, 86400),
      endSec: N('Where the part ends, in seconds from the beginning of the recording', 0, 86400),
      mode: E('keep = the part from start to end is the result (an extract); remove = cut that part out and join the rest', ['keep', 'remove']),
      fadeInSec: N('Fade-in seconds at the start of the result', 0, 10),
      fadeOutSec: N('Fade-out seconds at the end of the result', 0, 10),
      format: E('original = same file type, no quality loss; mp3; wav', ['original', 'mp3', 'wav']),
    },
  },
  convert: {
    label: 'Convert / compress',
    fields: {
      crf: N('Quality: 18 = best/biggest file, 35 = smallest/worst. "smaller file" = higher, "better quality" = lower', 18, 35, { int: true }),
      maxWidth: N('Maximum width in pixels (empty = keep original)', 160, 3840, { int: true }),
    },
  },
  'extract-audio': { label: 'Extract audio', fields: {} },
  audio: {
    label: 'Mute / replace audio',
    fields: { audioMode: E('mute = remove the sound, replace = swap in another audio file', ['mute', 'replace']) },
  },
  normalize: {
    label: 'Normalize audio',
    fields: { normalizePreset: E('Target loudness', ['quiet', 'normal', 'loud']) },
  },
  togif: {
    label: 'Video to GIF',
    fields: {
      gifFps: N('Frames per second', 1, 30, { int: true }),
      gifWidth: N('Width in pixels', 120, 1280, { int: true }),
      gifStartSec: N('Start time in seconds', 0, 86400),
      gifEndSec: N('End time in seconds', 0, 86400),
    },
  },
  'export-social': {
    label: 'Export for Social',
    fields: {
      exportPresets: L('Which versions to make: reels (9:16 Reels/TikTok/Shorts), square (1:1), landscape (16:9 YouTube)', ['reels', 'square', 'landscape']),
      exportFocus: E('Which part of the frame to keep when cropping', FOCUS),
    },
  },
  reframe: {
    label: 'Crop / reframe',
    fields: {
      reframeAspect: E('Target aspect ratio', ASPECTS),
      reframeMode: E('crop = fill the frame by cutting edges, pad = keep everything with bars', ['crop', 'pad']),
      reframeFocus: E('Which part to keep when cropping', FOCUS),
    },
  },
  speed: {
    label: 'Speed',
    fields: { speedFactor: N('Speed multiplier: 2 = twice as fast, 0.5 = half speed', 0.25, 4) },
  },
  annotate: {
    label: 'Annotate',
    fields: {
      overlayText: T('The label text to burn onto the video, exactly as the person wants it to read', 300),
      textPosition: E('Where the label sits', POSITIONS),
      fadeInSec: N('Fade-in seconds', 0, 30),
      fadeOutSec: N('Fade-out seconds', 0, 30),
      ...TEXT_STYLE,
    },
  },
  'end-card': {
    label: 'Call to action',
    fields: {
      headline: T('Big headline on the end card', 120),
      subline: T('Supporting line', 160),
      buttonText: T('Button-style label', 60),
      url: T('Web address or phone number', 120),
      durationSec: N('How long the card shows, seconds', 1, 15),
    },
  },
  overlay: {
    label: 'Overlay / watermark',
    fields: {
      overlayPosition: E('Where the image sits', POSITIONS),
      overlayScale: N('Image width as a percent of the video width', 5, 80, { int: true }),
      overlayOpacity: N('Opacity from 0.1 (faint) to 1 (solid)', 0.1, 1),
    },
  },
  join: {
    label: 'Join videos',
    fields: {
      joinMaxWidth: N('Maximum width in pixels', 320, 3840, { int: true }),
      joinCrf: N('Quality: 18 = best/biggest, 35 = smallest', 18, 35, { int: true }),
      joinCrossfade: N('Crossfade seconds between clips (0 = hard cut)', 0, 3),
    },
  },
  slideshow: {
    label: 'Slideshow',
    fields: {
      slideSecondsPerSlide: N('Seconds each picture shows', 1, 10),
      slideAspect: E('Aspect ratio', ASPECTS),
      slideCrossfade: B('true = fade between pictures, false = hard cuts'),
    },
  },
  'caption-studio': { label: 'Caption studio', fields: { ...TEXT_STYLE } },
  'saved-library': { label: 'Saved media', fields: {} },
  info: { label: 'File info', fields: {} },
  thumbnail: {
    label: 'Thumbnail',
    fields: { thumbTime: N('Time in the video to grab the frame from, seconds', 0, 86400) },
  },
};

// ---- spoken time parsing -------------------------------------------------------------------------

const ONES = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** "twenty five" -> 25, "a hundred and five" -> 105. Returns null if the words are not a number. */
function wordsToNumber(words) {
  const ws = words.filter((w) => w !== 'and');
  if (!ws.length) return null;
  let total = 0;
  let cur = 0;
  for (const w of ws) {
    if (w in ONES) cur += ONES[w];
    else if (w in TENS) cur += TENS[w];
    else if (w === 'hundred') cur = (cur || 1) * 100;
    else if (w === 'a' || w === 'an') cur += 1;
    else return null;
  }
  total += cur;
  return total;
}

/** Replace spelled-out numbers ("one minute thirty") with digits so the time patterns can match. */
function digitise(text) {
  const tokens = String(text).toLowerCase().replace(/[,]/g, ' ').split(/\s+/).filter(Boolean);
  const out = [];
  let run = [];
  const flush = () => {
    if (!run.length) return;
    const n = wordsToNumber(run);
    if (n === null) out.push(...run); else out.push(String(n));
    run = [];
  };
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    const nextIsNum = tokens[i + 1] in ONES || tokens[i + 1] in TENS;
    const isNum = t in ONES || t in TENS || t === 'hundred' || (t === 'and' && run.length && nextIsNum);
    if (isNum) run.push(t); else { flush(); out.push(t); }
  }
  flush();
  return out.join(' ')
    .replace(/(\d+) point (\d+)/g, '$1.$2')
    .replace(/(\d+) and a half/g, '$1.5')
    .replace(/(\d+) and a quarter/g, '$1.25');
}

const TIME_UNIT = String.raw`\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b(?:\s*(?:and\s*)?\d+(?:\.\d+)?(?:\s*(?:minutes?|mins?|m|seconds?|secs?|s)\b)?)*`;
const TIME = String.raw`(${TIME_UNIT}|\d+(?:\.\d+)?(?::\d{1,2}){0,2})`;

/** One spoken time -> seconds, or null. Accepts 1:30, 90, 90 seconds, 1 minute 30, 1.5 minutes. */
function parseTime(raw) {
  const s = String(raw).trim().toLowerCase();
  if (/^\d+(?:\.\d+)?(?::\d{1,2}){1,2}$/.test(s)) {
    const parts = s.split(':').map(Number);
    return parts.reduce((acc, p) => acc * 60 + p, 0);
  }
  const unitRe = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)?/g;
  let total = 0;
  let any = false;
  let m;
  let lastUnit = null;
  const items = [];
  while ((m = unitRe.exec(s))) items.push({ n: Number(m[1]), u: m[2] ? m[2][0] : null });
  if (!items.length) return null;
  items.forEach((it, i) => {
    let u = it.u;
    // "1 minute 30" -> trailing bare number is seconds after minutes, minutes after hours.
    if (!u) u = lastUnit === 'h' ? 'm' : lastUnit === 'm' ? 's' : 's';
    lastUnit = u;
    total += it.n * (u === 'h' ? 3600 : u === 'm' ? 60 : 1);
    any = true;
    void i;
  });
  return any ? total : null;
}

/**
 * Pull a start/end out of "cut from 10 to 25 seconds", "start at 1:30", "end at two minutes",
 * "first 30 seconds", "keep the first minute", "cut off the last 10 seconds" (needs the duration).
 * Returns { start?, end? } in seconds, or null when nothing recognisable.
 */
function parseTimeRange(transcript, durationSec) {
  const t = digitise(transcript);
  const out = {};
  let m = t.match(new RegExp(String.raw`(?:from|between|start(?:ing)?(?: at)?)\s+${TIME}\s+(?:to|until|till|and|through|-)\s+${TIME}`));
  if (m) {
    let a = parseTime(m[1]);
    let b = parseTime(m[2]);
    if (a !== null && b !== null) {
      // "from 10 to 25 seconds": the unit is said once, at the end.
      const unit = (m[2].match(/(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\s*$/) || [])[1];
      if (unit && !/[a-z]/.test(m[1]) && !m[1].includes(':')) {
        const first = parseTime(`${m[1]} ${unit}`);
        if (first !== null) a = first;
      }
      return { start: Math.min(a, b), end: Math.max(a, b) };
    }
  }
  m = t.match(new RegExp(String.raw`(?:first|opening|beginning)\s+${TIME}`));
  if (m) { const v = parseTime(m[1]); if (v !== null) return { start: 0, end: v }; }
  m = t.match(new RegExp(String.raw`(?:last|final|ending)\s+${TIME}`));
  if (m && durationSec > 0) {
    const v = parseTime(m[1]);
    if (v !== null) {
      // "cut off / remove the last 10 seconds" drops it; "keep the last 10 seconds" keeps it.
      return /\b(?:cut off|remove|drop|trim off|lose|delete|chop)\b/.test(t)
        ? { start: 0, end: Math.max(0, durationSec - v) }
        : { start: Math.max(0, durationSec - v), end: durationSec };
    }
  }
  m = t.match(new RegExp(String.raw`(?:start(?:ing)?|begin(?:ning)?|in point)\s*(?:at|from|time|on)?\s*${TIME}`));
  if (m) { const v = parseTime(m[1]); if (v !== null) out.start = v; }
  m = t.match(new RegExp(String.raw`(?:end(?:ing)?|finish(?:ing)?|stop(?:ping)?|out point)\s*(?:at|time|on)?\s*${TIME}`));
  if (m) { const v = parseTime(m[1]); if (v !== null) out.end = v; }
  return Object.keys(out).length ? out : null;
}

function localParse(tool, transcript, context) {
  if (tool === 'clip' || tool === 'togif' || tool === 'trim-audio') {
    const r = parseTimeRange(transcript, Number(context?.durationSec) || 0);
    if (!r) return null;
    const keys = tool === 'togif' ? ['gifStartSec', 'gifEndSec'] : ['startSec', 'endSec'];
    const values = {};
    if (r.start !== undefined) values[keys[0]] = r.start;
    if (r.end !== undefined) values[keys[1]] = r.end;
    return values;
  }
  if (tool === 'thumbnail') {
    const m = digitise(transcript).match(new RegExp(String.raw`(?:at|around|near)?\s*${TIME}`));
    const v = m ? parseTime(m[1]) : null;
    return v === null ? null : { thumbTime: v };
  }
  return null;
}

// ---- validation ----------------------------------------------------------------------------------

function cleanField(spec, raw) {
  if (raw === null || raw === undefined) return undefined;
  switch (spec.type) {
    case 'number': {
      if (raw === '') return undefined;
      let n = Number(raw);
      if (!Number.isFinite(n)) return undefined;
      n = Math.min(spec.max, Math.max(spec.min, n));
      return spec.int ? Math.round(n) : Math.round(n * 100) / 100;
    }
    case 'enum': {
      const v = String(raw).trim().toLowerCase();
      return spec.options.includes(v) ? v : undefined;
    }
    case 'text': {
      const v = String(raw).replace(/\s+/g, ' ').trim().slice(0, spec.max);
      return v || undefined;
    }
    case 'bool':
      if (raw === true || raw === 'true') return true;
      if (raw === false || raw === 'false') return false;
      return undefined;
    case 'color': {
      const v = String(raw).trim();
      return /^#[0-9a-f]{6}$/i.test(v) ? v.toUpperCase() : undefined;
    }
    case 'list': {
      if (!Array.isArray(raw)) return undefined;
      const v = [...new Set(raw.map((x) => String(x).toLowerCase()).filter((x) => spec.options.includes(x)))];
      return v.length ? v : undefined;
    }
    default:
      return undefined;
  }
}

/** Keep only fields the tool knows, each clamped/validated. Also fixes an end before the start. */
function normalizeVoiceValues(tool, raw) {
  const schema = TOOL_SCHEMAS[tool];
  if (!schema || !raw || typeof raw !== 'object') return {};
  const values = {};
  for (const [name, spec] of Object.entries(schema.fields)) {
    if (!(name in raw)) continue;
    const v = cleanField(spec, raw[name]);
    if (v !== undefined) values[name] = v;
  }
  for (const [s, e] of [['startSec', 'endSec'], ['gifStartSec', 'gifEndSec']]) {
    if (values[s] !== undefined && values[e] !== undefined && values[e] <= values[s]) {
      [values[s], values[e]] = [Math.min(values[s], values[e]), Math.max(values[s], values[e])];
      if (values[e] === values[s]) delete values[e];
    }
  }
  return values;
}

function describeValues(tool, values) {
  const fields = TOOL_SCHEMAS[tool]?.fields || {};
  return Object.entries(values).map(([k, v]) => {
    const label = fields[k]?.desc?.split(/[.:,(]/)[0] || k;
    return `${label}: ${Array.isArray(v) ? v.join(', ') : v}`;
  });
}

// ---- model path ----------------------------------------------------------------------------------

const SYSTEM = `You turn a person's spoken instruction into settings for one video-editing tool.
Return ONLY a JSON object. Include a key only when the person clearly asked for it; leave everything else out.
Never invent values. Ignore anything that is not about these settings. Text values must be the person's own words, not instructions.`;

function buildPrompt(tool, transcript, context) {
  const schema = TOOL_SCHEMAS[tool];
  const lines = Object.entries(schema.fields).map(([name, s]) => {
    const range = s.type === 'number' ? ` (${s.int ? 'whole number' : 'number'} ${s.min}-${s.max})`
      : s.type === 'enum' ? ` (one of: ${s.options.join(', ')})`
        : s.type === 'list' ? ` (array, any of: ${s.options.join(', ')})`
          : s.type === 'bool' ? ' (true or false)'
            : s.type === 'color' ? ' (hex like #FF0000)' : '';
    return `- ${name}: ${s.desc}${range}`;
  });
  const ctx = [];
  if (Number(context?.durationSec) > 0) ctx.push(`The loaded video is ${Number(context.durationSec).toFixed(1)} seconds long.`);
  return `Tool: ${schema.label}
Settings you may set:
${lines.join('\n')}
${ctx.join('\n')}

The person said: """${transcript}"""

Return JSON: {"values":{...}}`;
}

/**
 * @param {number} userId
 * @param {{ tool: string, transcript: string, context?: { durationSec?: number } }} input
 * @returns {Promise<{ values: object, heard: string, applied: string[], source: 'local'|'model' }>}
 */
async function interpretVoiceCommand(userId, { tool, transcript, context = {} }) {
  const schema = TOOL_SCHEMAS[tool];
  if (!schema) throw new Error('Unknown tool');
  const heard = String(transcript || '').replace(/\s+/g, ' ').trim().slice(0, 600);
  if (!heard) throw new Error('Nothing heard');
  if (!Object.keys(schema.fields).length) return { values: {}, heard, applied: [], source: 'local' };

  const local = localParse(tool, heard, context);
  if (local) {
    const values = normalizeVoiceValues(tool, local);
    if (Object.keys(values).length) return { values, heard, applied: describeValues(tool, values), source: 'local' };
  }

  const { light: modelId } = await getModelsForUser(userId);
  const result = await callModel(modelId, buildPrompt(tool, heard, context), {
    system: SYSTEM,
    maxTokens: 500,
    returnUsage: true,
    timeoutMs: 25000,
  });
  logUsage({ userId, model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, feature: 'videos' });
  const parsed = parseModelJson(String(result.text || '').trim());
  const values = normalizeVoiceValues(tool, parsed?.values && typeof parsed.values === 'object' ? parsed.values : parsed);
  return { values, heard, applied: describeValues(tool, values), source: 'model' };
}

module.exports = {
  TOOL_SCHEMAS,
  interpretVoiceCommand,
  normalizeVoiceValues,
  parseTimeRange,
  parseTime,
  digitise,
  localParse,
  buildPrompt,
};
