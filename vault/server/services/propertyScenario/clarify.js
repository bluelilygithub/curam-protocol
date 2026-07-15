'use strict';

/**
 * Apply user answers to unresolved assumptions / missing fields so Stage 4 can run.
 * Does not call the LLM — answers come from the product UI (or E2E answer packs).
 */

/**
 * Set a dotted path on an object, creating intermediate plain objects as needed.
 * Supports numeric segments for array indices (e.g. events.0.fields.selling_costs).
 * Also accepts `events[0].fields.x` style paths.
 * @param {object} root
 * @param {string} path
 * @param {*} value
 */
function setByPath(root, path, value) {
  const parts = String(path)
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  if (!parts.length) return;
  let cur = root;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    const next = parts[i + 1];
    const nextIsIndex = /^\d+$/.test(next);
    if (cur[key] == null) {
      cur[key] = nextIsIndex ? [] : {};
    }
    cur = cur[key];
  }
  cur[parts[parts.length - 1]] = value;
}

/**
 * Resolve open assumptions and optional defaults.
 *
 * @param {import('./scenario').Scenario} scenario — mutated copy recommended
 * @param {object} [opts]
 * @param {Record<string, *>} [opts.answers] — map assumption id OR field_path → value
 * @param {number} [opts.selling_cost_pct] — e.g. 0.025 → set selling_costs on sell events missing it
 * @param {object} [opts.scenario_patch] — shallow-deep merge onto scenario (starting_properties / events by id)
 * @returns {{ scenario: import('./scenario').Scenario, applied: string[], remaining_required: object[] }}
 */
function applyClarifications(scenario, opts = {}) {
  const applied = [];
  const answers = opts.answers || {};

  // Patch by event/property id when provided
  if (opts.scenario_patch && typeof opts.scenario_patch === 'object') {
    const patch = opts.scenario_patch;
    const replace = Boolean(opts.replace_scenario);

    if (Array.isArray(patch.starting_properties)) {
      if (replace) {
        scenario.starting_properties = patch.starting_properties.map((p) => ({ ...p }));
        applied.push('scenario_patch.starting_properties:replace');
      } else {
        patch.starting_properties.forEach((p) => {
          const existing = (scenario.starting_properties || []).find((x) => x.id === p.id);
          if (existing) Object.assign(existing, p);
          else scenario.starting_properties.push({ ...p });
          applied.push(`scenario_patch.starting_properties:${p.id}`);
        });
      }
    }
    if (Array.isArray(patch.events)) {
      if (replace) {
        scenario.events = patch.events.map((e) => ({
          ...e,
          fields: { ...(e.fields || {}) },
        }));
        applied.push('scenario_patch.events:replace');
      } else {
        patch.events.forEach((ev) => {
          const existing = (scenario.events || []).find((x) => x.id === ev.id);
          if (existing) {
            Object.assign(existing, { ...ev, fields: { ...existing.fields, ...(ev.fields || {}) } });
          } else {
            scenario.events.push({ ...ev, fields: { ...(ev.fields || {}) } });
          }
          applied.push(`scenario_patch.events:${ev.id}`);
        });
      }
    }
    if (Array.isArray(patch.dependencies)) {
      scenario.dependencies = patch.dependencies.map((d) => ({ ...d }));
      applied.push('scenario_patch.dependencies');
    } else if (replace) {
      scenario.dependencies = [];
      applied.push('scenario_patch.dependencies:cleared_on_replace');
    }
    if (patch.timeline) {
      scenario.timeline = {
        gaps: Array.isArray(patch.timeline.gaps) ? patch.timeline.gaps.map((g) => ({ ...g })) : [],
        overlaps: Array.isArray(patch.timeline.overlaps)
          ? patch.timeline.overlaps.map((o) => ({ ...o }))
          : [],
      };
      applied.push('scenario_patch.timeline');
    } else if (replace) {
      // Drop parse-era gaps/overlaps that reference event ids we just replaced
      scenario.timeline = { gaps: [], overlaps: [] };
      applied.push('scenario_patch.timeline:cleared_on_replace');
    }
    if (patch.title != null) {
      scenario.title = patch.title;
      applied.push('scenario_patch.title');
    }
    if (Array.isArray(patch.unresolved_assumptions)) {
      scenario.unresolved_assumptions = patch.unresolved_assumptions.map((a) => ({ ...a }));
      applied.push('scenario_patch.unresolved_assumptions');
    }
  }

  if (opts.clear_assumptions) {
    scenario.unresolved_assumptions = [];
    applied.push('cleared_all_assumptions');
  }

  for (const [key, value] of Object.entries(answers)) {
    const assumption = (scenario.unresolved_assumptions || []).find(
      (a) => a.id === key || a.field_path === key
    );
    const path = assumption?.field_path || key;
    if (path && path !== 'clarifying_questions' && !path.startsWith('unknown')) {
      try {
        // Never overwrite a nested object (e.g. a whole loan snapshot) with a
        // scalar form answer — that was destroying balances during clarify.
        const parts = String(path)
          .replace(/\[(\d+)\]/g, '.$1')
          .split('.')
          .filter(Boolean);
        let existing = scenario;
        for (const p of parts) {
          if (existing == null) break;
          existing = existing[p];
        }
        const valueIsObject = value != null && typeof value === 'object';
        const existingIsObject = existing != null && typeof existing === 'object' && !Array.isArray(existing);
        if (existingIsObject && !valueIsObject) {
          applied.push(`skipped_object_path:${path}`);
        } else {
          setByPath(scenario, path, value);
          applied.push(path);
        }
      } catch {
        /* ignore bad paths */
      }
    }
    if (assumption) {
      scenario.unresolved_assumptions = scenario.unresolved_assumptions.filter(
        (a) => a.id !== assumption.id
      );
      applied.push(`cleared:${assumption.id}`);
    }
  }

  // Optional selling-cost default for sell events
  if (opts.selling_cost_pct != null && Number.isFinite(Number(opts.selling_cost_pct))) {
    const pct = Number(opts.selling_cost_pct);
    (scenario.events || []).forEach((e, i) => {
      if (e.type !== 'sell') return;
      if (e.fields.selling_costs != null) return;
      const price = Number(e.fields.property_value);
      if (!Number.isFinite(price) || price <= 0) return;
      e.fields.selling_costs = Math.round(price * pct * 100) / 100;
      applied.push(`events[${i}].fields.selling_costs@${pct}`);
      scenario.unresolved_assumptions = (scenario.unresolved_assumptions || []).filter(
        (a) => !String(a.field_path || '').includes('selling_costs')
      );
    });
  }

  // Drop optional assumptions when resolve_optional
  if (opts.resolve_optional) {
    scenario.unresolved_assumptions = (scenario.unresolved_assumptions || []).filter(
      (a) => a.severity === 'required'
    );
    applied.push('dropped_optional_assumptions');
  }

  const remaining_required = (scenario.unresolved_assumptions || []).filter(
    (a) => a.severity !== 'optional'
  );

  return { scenario, applied, remaining_required };
}

/**
 * Deep-ish clone of a Scenario for safe mutation during clarify / orchestrate.
 * @param {import('./scenario').Scenario} scenario
 * @returns {import('./scenario').Scenario}
 */
function cloneScenario(scenario) {
  return JSON.parse(JSON.stringify(scenario));
}

module.exports = {
  applyClarifications,
  setByPath,
  cloneScenario,
};
