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
  cancellable: false,
  cancelHandler: null,

  startProcessing: (message, detail = null, opts = {}) => {
    const labels = Array.isArray(opts.steps) ? opts.steps.filter(Boolean) : [];
    const steps = labels.map((label, i) => ({
      id: `step-${i}`,
      label,
      status: i === 0 ? 'active' : 'pending',
    }));
    set({
      message,
      detail,
      steps,
      cancellable: Boolean(opts.onCancel),
      cancelHandler: typeof opts.onCancel === 'function' ? opts.onCancel : null,
    });
  },

  updateProcessingDetail: (detail) => set({ detail }),

  setActiveProcessingLabel: (label) => {
    if (!label) return;
    const { steps } = get();
    if (!steps.length) return;
    set({
      steps: steps.map((s) => (s.status === 'active' ? { ...s, label } : s)),
    });
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

  stopProcessing: () => set({
    message: null,
    detail: null,
    steps: [],
    cancellable: false,
    cancelHandler: null,
  }),
}));

export default useProcessingStore;

function formatElapsed(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/**
 * Run an async job while showing a rolling step log in ProcessingModal.
 * Advances through `stepLabels` on a timer while `asyncFn` runs; finishes
 * remaining steps when the promise settles. Updates elapsed time so long
 * model calls still feel alive.
 *
 * @param {object} store — return value of useProcessingStore.getState() or hook
 * @param {string} title
 * @param {string|null} detail
 * @param {string[]} stepLabels
 * @param {() => Promise<T>} asyncFn
 * @param {{ onCancel?: () => void, stepIntervalMs?: number, heartbeatMs?: number }} [opts]
 * @returns {Promise<T>}
 */
export async function runWithStepLog(store, title, detail, stepLabels, asyncFn, opts = {}) {
  const labels = (stepLabels || []).filter(Boolean);
  const baseLabels = [...labels];
  store.startProcessing(title, detail, {
    steps: labels,
    onCancel: opts.onCancel,
  });

  let advanceTimer = null;
  let heartbeatTimer = null;
  let stepIndex = 0;
  const startedAt = Date.now();
  const stepInterval = opts.stepIntervalMs
    ?? (labels.length > 1
      ? Math.max(800, Math.min(4500, Math.floor(12000 / labels.length)))
      : 0);

  const clearTimers = () => {
    if (advanceTimer != null) {
      clearInterval(advanceTimer);
      advanceTimer = null;
    }
    if (heartbeatTimer != null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const tickHeartbeat = () => {
    const elapsed = formatElapsed(Date.now() - startedAt);
    const activeIdx = Math.min(stepIndex, Math.max(0, baseLabels.length - 1));
    const base = baseLabels[activeIdx] || title;
    if (typeof store.setActiveProcessingLabel === 'function') {
      store.setActiveProcessingLabel(`${base} · ${elapsed}`);
    }
    if (typeof store.updateProcessingDetail === 'function') {
      const suffix = detail ? `${detail} · ` : '';
      store.updateProcessingDetail(`${suffix}Elapsed ${elapsed} — still working`);
    }
  };

  if (labels.length > 1 && stepInterval > 0) {
    advanceTimer = setInterval(() => {
      if (stepIndex >= labels.length - 1) {
        if (advanceTimer != null) {
          clearInterval(advanceTimer);
          advanceTimer = null;
        }
        return;
      }
      stepIndex += 1;
      store.advanceProcessingStep(baseLabels[stepIndex]);
    }, stepInterval);
  }

  heartbeatTimer = setInterval(tickHeartbeat, opts.heartbeatMs || 1000);
  tickHeartbeat();

  try {
    const result = await asyncFn();
    clearTimers();
    store.completeAllProcessingSteps();
    await new Promise((r) => setTimeout(r, 280));
    return result;
  } catch (err) {
    clearTimers();
    throw err;
  } finally {
    clearTimers();
    store.stopProcessing();
  }
}
