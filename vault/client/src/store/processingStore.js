import { create } from 'zustand';

/**
 * Global processing state.
 *
 * Usage:
 *   const { startProcessing, stopProcessing, setProcessingSteps } = useProcessingStore();
 *   startProcessing('Running calculation…', 'Please don’t navigate away.', {
 *     steps: ['Validating inputs', 'Computing serviceability', 'Building report'],
 *   });
 *   // … await work; optionally setProcessingSteps([...]) or advanceProcessingStep()
 *   stopProcessing();
 *
 * ProcessingModal (rendered once in App.jsx) reads this store and blocks
 * the UI with an overlay while a message is set.
 */
const useProcessingStore = create((set, get) => ({
  message: null,
  detail: null,
  /** @type {{ id: string, label: string, status: 'pending'|'active'|'done'|'error' }[]} */
  steps: [],

  startProcessing: (message, detail = null, opts = {}) => {
    const labels = Array.isArray(opts.steps) ? opts.steps.filter(Boolean) : [];
    const steps = labels.map((label, i) => ({
      id: `step-${i}`,
      label,
      status: i === 0 ? 'active' : 'pending',
    }));
    set({ message, detail, steps });
  },

  setProcessingSteps: (labelsOrSteps) => {
    if (!Array.isArray(labelsOrSteps)) return;
    const steps = labelsOrSteps.map((item, i) => {
      if (typeof item === 'string') {
        return { id: `step-${i}`, label: item, status: i === 0 ? 'active' : 'pending' };
      }
      return {
        id: item.id || `step-${i}`,
        label: item.label,
        status: item.status || (i === 0 ? 'active' : 'pending'),
      };
    });
    set({ steps });
  },

  /** Mark the current active step done and activate the next pending one. */
  advanceProcessingStep: (nextLabel) => {
    const { steps } = get();
    if (!steps.length) {
      if (nextLabel) {
        set({
          steps: [{ id: `step-${Date.now()}`, label: nextLabel, status: 'active' }],
        });
      }
      return;
    }
    const activeIdx = steps.findIndex((s) => s.status === 'active');
    const idx = activeIdx >= 0 ? activeIdx : steps.findIndex((s) => s.status === 'pending');
    if (idx < 0) return;

    const next = steps.map((s, i) => {
      if (i < idx) return { ...s, status: 'done' };
      if (i === idx) return { ...s, status: 'done' };
      if (i === idx + 1) {
        return {
          ...s,
          status: 'active',
          label: nextLabel || s.label,
        };
      }
      return s;
    });

    // If we finished the last step and a new label was provided, append it
    if (idx === steps.length - 1 && nextLabel) {
      next.push({ id: `step-${Date.now()}`, label: nextLabel, status: 'active' });
    }

    set({ steps: next });
  },

  appendProcessingStep: (label, status = 'active') => {
    const { steps } = get();
    const marked = steps.map((s) => (
      s.status === 'active' ? { ...s, status: 'done' } : s
    ));
    marked.push({ id: `step-${Date.now()}`, label, status });
    set({ steps: marked });
  },

  completeAllProcessingSteps: () => {
    const { steps } = get();
    if (!steps.length) return;
    set({ steps: steps.map((s) => ({ ...s, status: 'done' })) });
  },

  stopProcessing: () => set({ message: null, detail: null, steps: [] }),
}));

export default useProcessingStore;

/**
 * Run an async job while showing a rolling step log in ProcessingModal.
 * Advances through `stepLabels` on a timer while `asyncFn` runs; finishes
 * remaining steps when the promise settles.
 *
 * @param {object} store — return value of useProcessingStore.getState() or hook
 * @param {string} title
 * @param {string|null} detail
 * @param {string[]} stepLabels
 * @param {() => Promise<T>} asyncFn
 * @returns {Promise<T>}
 */
export async function runWithStepLog(store, title, detail, stepLabels, asyncFn) {
  const labels = (stepLabels || []).filter(Boolean);
  store.startProcessing(title, detail, { steps: labels });

  let advanceTimer = null;
  let stepIndex = 0;

  const clearAdvance = () => {
    if (advanceTimer != null) {
      clearInterval(advanceTimer);
      advanceTimer = null;
    }
  };

  if (labels.length > 1) {
    advanceTimer = setInterval(() => {
      stepIndex += 1;
      if (stepIndex >= labels.length) {
        clearAdvance();
        return;
      }
      store.advanceProcessingStep();
    }, Math.max(450, Math.min(900, Math.floor(2800 / labels.length))));
  }

  try {
    const result = await asyncFn();
    clearAdvance();
    store.completeAllProcessingSteps();
    await new Promise((r) => setTimeout(r, 280));
    return result;
  } catch (err) {
    clearAdvance();
    throw err;
  } finally {
    clearAdvance();
    store.stopProcessing();
  }
}
