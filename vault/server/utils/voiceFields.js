'use strict';

// Shared pieces for "tell this tool what to do" (voice or typed directions): each tool has a small schema of settings; the
// model's answer is parsed and re-validated against it, so a bad answer can never set a value the form would not accept.
// (Video Tools has its own older copy of this in services/videoVoiceCommand.js; new tools should use this one.)

const N = (desc, min, max, extra = {}) => ({ type: 'number', desc, min, max, ...extra });
const E = (desc, options) => ({ type: 'enum', desc, options });
const T = (desc, max = 200) => ({ type: 'text', desc, max });
const B = (desc) => ({ type: 'bool', desc });
const COLOR = (desc) => ({ type: 'color', desc });
const RANGE = (desc) => ({ type: 'range', desc });

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
      const v = String(raw).trim();
      const hit = spec.options.find((o) => String(o).toLowerCase() === v.toLowerCase());
      return hit === undefined ? undefined : hit;
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
    case 'range': { // "all" or page ranges like 1-3,5,7-9
      const v = String(raw).replace(/\s+/g, '').toLowerCase();
      if (v === 'all') return 'all';
      return /^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(v) && v.length <= 120 ? v : undefined;
    }
    default:
      return undefined;
  }
}

function normalizeValues(schemas, tool, raw) {
  const schema = schemas[tool];
  if (!schema || !raw || typeof raw !== 'object') return {};
  const values = {};
  for (const [name, spec] of Object.entries(schema.fields)) {
    if (!(name in raw)) continue;
    const v = cleanField(spec, raw[name]);
    if (v !== undefined) values[name] = v;
  }
  return values;
}

function describeValues(schemas, tool, values) {
  const fields = schemas[tool]?.fields || {};
  return Object.entries(values).map(([k, v]) => `${fields[k]?.desc?.split(/[.:,(]/)[0] || k}: ${v === true ? 'yes' : v === false ? 'no' : v}`);
}

function promptFor(schemas, tool, transcript, extraContext = []) {
  const schema = schemas[tool];
  const lines = Object.entries(schema.fields).map(([name, s]) => {
    const range = s.type === 'number' ? ` (${s.int ? 'whole number' : 'number'} ${s.min}-${s.max})`
      : s.type === 'enum' ? ` (one of: ${s.options.join(', ')})`
        : s.type === 'bool' ? ' (true or false)'
          : s.type === 'color' ? ' (hex like #FF0000)'
            : s.type === 'range' ? ' (all, or page ranges like 1-3,5,7-9)' : '';
    return `- ${name}: ${s.desc}${range}`;
  });
  return `Tool: ${schema.label}
Settings you may set:
${lines.join('\n')}
${extraContext.join('\n')}

The person said: """${transcript}"""

Return JSON: {"values":{...}}`;
}

module.exports = { N, E, T, B, COLOR, RANGE, cleanField, normalizeValues, describeValues, promptFor };
