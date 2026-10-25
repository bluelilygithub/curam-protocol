// The step list behind the Adjust tool: every change to a slider (or a loaded preset, or Reset) is a STEP. A step can be ticked off on its
// own, without undoing the ones after it, and ticked back on. The sliders always show the result of the ticked steps, in order.
// Pure, so it is tested with node:  node client/src/pages/graphics/adjustHistory.test.mjs   (npm run test:graphics-adjust-history)

export const ADJUST_DEFAULTS = {
  brightness: 1, contrast: 1, saturation: 1, hue: 0, sharpness: 0, temperature: 0, vignette: 0,
  blackPoint: 0, whitePoint: 255, gamma: 1, blur: 0, denoise: 0,
};

export const MAX_STEPS = 200; // the oldest are dropped past this; nobody makes this many by hand

export const initialHistory = () => ({ steps: [], nextId: 1 });

/** Slider values after the ticked steps, in order. `upTo` (an index) stops early: the values just AFTER that step. */
export function valuesOf(state, upTo = Infinity) {
  const out = { ...ADJUST_DEFAULTS };
  state.steps.forEach((s, i) => { if (s.on && i <= upTo) Object.assign(out, s.sets); });
  return out;
}

const sameValues = (a, b) => Object.keys(ADJUST_DEFAULTS).every((k) => Number(a[k]) === Number(b[k]));
const lastOnIndex = (steps) => { for (let i = steps.length - 1; i >= 0; i -= 1) if (steps[i].on) return i; return -1; };

/**
 * Actions:
 *   { type: 'change', sets: { brightness: 1.2 }, label? }  a new step (ignored when it changes nothing)
 *   { type: 'toggle', id }                                  tick / untick one step
 *   { type: 'undo' }                                        untick the latest ticked step
 *   { type: 'redo' }                                        tick the next unticked step after the last ticked one
 *   { type: 'backTo', id }                                  untick every step after this one
 *   { type: 'clear' }                                       a new picture: start over
 */
export function reducer(state, action) {
  switch (action.type) {
    case 'change': {
      const sets = {};
      for (const [k, v] of Object.entries(action.sets || {})) if (k in ADJUST_DEFAULTS && Number.isFinite(Number(v))) sets[k] = Number(v);
      if (!Object.keys(sets).length) return state;
      // Unticked steps at the very end are the "redo" tail: a new change replaces them (like any undo). Earlier unticked ones stay.
      const keep = state.steps.slice(0, lastOnIndex(state.steps) + 1);
      const before = valuesOf({ steps: keep });
      const after = { ...before, ...sets };
      if (sameValues(before, after)) return state;
      const steps = [...keep, { id: state.nextId, sets, label: action.label || null, on: true }].slice(-MAX_STEPS);
      return { steps, nextId: state.nextId + 1 };
    }
    case 'toggle':
      return { ...state, steps: state.steps.map((s) => (s.id === action.id ? { ...s, on: !s.on } : s)) };
    case 'undo': {
      const i = lastOnIndex(state.steps);
      if (i < 0) return state;
      return { ...state, steps: state.steps.map((s, n) => (n === i ? { ...s, on: false } : s)) };
    }
    case 'redo': {
      const from = lastOnIndex(state.steps) + 1;
      const i = state.steps.findIndex((s, n) => n >= from && !s.on);
      if (i < 0) return state;
      return { ...state, steps: state.steps.map((s, n) => (n === i ? { ...s, on: true } : s)) };
    }
    case 'backTo': {
      const at = state.steps.findIndex((s) => s.id === action.id);
      if (at < 0) return state;
      return { ...state, steps: state.steps.map((s, n) => (n > at ? { ...s, on: false } : s)) };
    }
    case 'clear':
      return initialHistory();
    default:
      return state;
  }
}

export const canUndo = (state) => lastOnIndex(state.steps) >= 0;
export const canRedo = (state) => state.steps.some((s, n) => n > lastOnIndex(state.steps) && !s.on);

/**
 * The list the person sees, newest last: [{ id, on, text }]. `labels` maps a setting to its name, `format` to how its value reads.
 * A one-setting step reads "Brightness: 1.00 → 1.25" (from the value just before it); a preset or Reset uses its own label.
 */
export function describeSteps(state, labels, format = {}) {
  return state.steps.map((s, i) => {
    const keys = Object.keys(s.sets);
    const fmt = (k, v) => (format[k] ? format[k](v) : String(v));
    let text = s.label;
    if (!text) {
      if (keys.length === 1) {
        const k = keys[0];
        // what the setting read just before this step, counting only ticked steps before it
        const prior = valuesOf({ steps: state.steps.slice(0, i) });
        text = `${labels[k] || k}: ${fmt(k, prior[k])} → ${fmt(k, s.sets[k])}`;
      } else {
        text = `${keys.length} settings changed`;
      }
    }
    return { id: s.id, on: s.on, text };
  });
}
