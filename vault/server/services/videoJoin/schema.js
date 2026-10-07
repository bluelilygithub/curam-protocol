'use strict';

// Tiny parameter-schema helpers shared by the clip-effect and transition registries. A registry
// entry declares its parameters once; validation/clamping (API, UI, AI planner) and the planner's
// prompt text are all generated from that declaration, so a new effect needs no other edits.

const num = (min, max, def, description) => ({ type: 'number', min, max, default: def, description });
const oneOf = (values, def, description) => ({ type: 'enum', values, default: def, description });
const bool = (def, description) => ({ type: 'bool', default: def, description });

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

/** Validate one value against a spec; anything unusable falls back to the default. */
function normalizeValue(raw, spec, defaultOverride) {
  const def = defaultOverride !== undefined ? defaultOverride : spec.default;
  if (spec.type === 'number') {
    if (raw === '' || raw == null) return def;
    const v = Number(raw);
    if (!Number.isFinite(v)) return def;
    return round3(Math.min(spec.max, Math.max(spec.min, v)));
  }
  if (spec.type === 'enum') {
    const v = String(raw ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    return spec.values.includes(v) ? v : def;
  }
  if (spec.type === 'bool') {
    if (raw === true || raw === 1 || raw === 'true' || raw === '1') return true;
    if (raw === false || raw === 0 || raw === 'false' || raw === '0') return false;
    return def;
  }
  return def;
}

/** One-line description of a parameter for the planner prompt. */
function describeParam(key, spec, defaultOverride) {
  const def = defaultOverride !== undefined ? defaultOverride : spec.default;
  let kind;
  if (spec.type === 'number') kind = `number ${spec.min} to ${spec.max}`;
  else if (spec.type === 'enum') kind = spec.values.join(' | ');
  else kind = 'true | false';
  return `${key} (${kind}; default ${def}): ${spec.description}`;
}

module.exports = { num, oneOf, bool, round3, normalizeValue, describeParam };
