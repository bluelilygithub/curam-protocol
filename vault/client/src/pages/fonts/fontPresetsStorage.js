/**
 * "Parametric Stylesheets" — save the transform recipe (operations +
 * parameters), never a baked result, so a preset is reusable across
 * different base fonts. Browser-only tool (no backend in this phase), so
 * presets live in localStorage. Per-viewer only — not shared, not synced.
 */
const STORAGE_KEY = 'curam:fontCustomizer:presets';

function safeParse(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function loadPresets() {
  try {
    return safeParse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return []; // private window / blocked storage — degrade to no presets rather than throw
  }
}

export function savePreset(name, { transforms, kerning }) {
  const presets = loadPresets();
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: String(name || 'Untitled').trim() || 'Untitled',
    transforms: { ...transforms },
    kerning: {
      enabledGroupIds: [...(kerning.enabledGroupIds || [])],
      balance: kerning.balance,
      advancedPairs: { ...(kerning.advancedPairs || {}) },
    },
    savedAt: new Date().toISOString(),
  };
  const next = [...presets, entry];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // storage blocked/full — preset just won't persist across reloads
  }
  return next;
}

export function deletePreset(id) {
  const next = loadPresets().filter((p) => p.id !== id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}
