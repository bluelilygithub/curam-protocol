/**
 * Normalise Product Scout feature-brief items for the Step 2 UI.
 * Spec metadata (type, unit, options) comes from the LLM brief for THIS product
 * category — not from hardcoded laptop/RAM patterns.
 */

const VALID_SPEC_TYPES = new Set(['numeric_min', 'numeric_max', 'enum', 'text']);

function cleanOptions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((o) => (typeof o === 'number' ? o : String(o).trim()))
    .filter((o) => o !== '' && o != null);
}

export function normalizeBriefFeature(raw) {
  const f = { ...raw };
  const name = String(f.feature || '').trim();
  if (!name) return null;

  if (f.kind === 'spec' || f.spec_type) {
    f.kind = 'spec';
    f.spec_type = VALID_SPEC_TYPES.has(f.spec_type) ? f.spec_type : 'text';
    f.spec_unit = f.spec_unit != null && f.spec_unit !== '' ? String(f.spec_unit) : null;
    f.spec_options = cleanOptions(f.spec_options);

    if (f.spec_type === 'enum' && !f.spec_options.length) {
      f.spec_type = 'text';
    }

    if (f.spec_value == null && f.spec_value !== 0) {
      if (f.spec_options.length) {
        const mid = f.spec_options[Math.floor(f.spec_options.length / 2)];
        f.spec_value = mid;
      } else if (f.spec_type === 'text') {
        f.spec_value = '';
      }
    }

    if (f.importance === 'skip' && f.spec_value != null && f.spec_value !== '') {
      f.importance = 'must';
    }
    return f;
  }

  f.kind = 'feature';
  if (!['must', 'nice', 'skip'].includes(f.importance)) f.importance = 'nice';
  return f;
}

export function normalizeBriefFeatures(features) {
  return (features || [])
    .map(normalizeBriefFeature)
    .filter(Boolean);
}

export function partitionBriefFeatures(features) {
  const normalized = normalizeBriefFeatures(features);
  return {
    specs: normalized.filter((f) => f.kind === 'spec'),
    features: normalized.filter((f) => f.kind !== 'spec'),
  };
}

/** Human-readable line for prompts / display */
export function formatFeatureRequirement(f) {
  if (!f || f.importance === 'skip') return null;
  if (f.kind === 'spec' && f.spec_value != null && f.spec_value !== '') {
    const v = f.spec_value;
    const unit = f.spec_unit || '';
    if (f.spec_type === 'numeric_min') return `${f.feature}: at least ${v}${unit}`;
    if (f.spec_type === 'numeric_max') return `${f.feature}: at most ${v}${unit}`;
    if (f.spec_type === 'enum') {
      const any = String(v).toLowerCase() === 'any' || String(v).toLowerCase() === 'no preference';
      return any ? null : `${f.feature}: ${v}`;
    }
    if (f.spec_type === 'text') return `${f.feature}: ${v}`;
  }
  return f.feature;
}

export function cycleImportance(current) {
  if (current === 'skip') return 'nice';
  if (current === 'nice') return 'must';
  return 'skip';
}

export const IMPORTANCE_LABELS = {
  skip: 'Skip',
  nice: 'Nice',
  must: 'Must',
};
