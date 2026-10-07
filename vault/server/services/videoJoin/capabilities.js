'use strict';

// Registry contents as plain JSON for the Join UI (GET /api/videos/join/capabilities), so the
// transition picker and the per-clip effect controls are rendered from the same registries the
// server validates against and the AI planner reads — a new entry shows up in all three.

const { TRANSITIONS } = require('./transitions');
const { CLIP_EFFECTS } = require('./clipEffects');

const titleCase = (id) => id.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

function paramsJson(params, overrides = {}) {
  return Object.entries(params).map(([key, spec]) => ({
    key,
    type: spec.type,
    min: spec.min,
    max: spec.max,
    values: spec.values,
    default: overrides[key] !== undefined ? overrides[key] : spec.default,
    description: spec.description,
  }));
}

function joinCapabilities() {
  return {
    transitions: Object.entries(TRANSITIONS)
      .filter(([, def]) => !def.hidden)
      .map(([id, def]) => ({
        id,
        label: titleCase(id),
        kind: def.kind,
        description: def.description,
        params: paramsJson(def.params, def.paramDefaults),
      })),
    clipEffects: CLIP_EFFECTS.map((effect) => ({
      id: effect.id,
      description: effect.description,
      params: paramsJson(effect.params),
    })),
  };
}

module.exports = { joinCapabilities };
