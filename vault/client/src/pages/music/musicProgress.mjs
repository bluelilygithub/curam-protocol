// Turns a music job (as returned by GET /api/music/jobs/:id) into the step list shown by the global
// ProcessingModal. Pure and dependency-free so it is unit-tested
// (node client/src/pages/music/musicProgress.test.mjs).
//
// Step statuses are 'pending' | 'active' | 'done' | 'error' — the ProcessingModal's own vocabulary.

const FALLBACK_COUNT = 3;

/** One row per option, driven by the server's real per-option status. */
function optionStep(option) {
  const n = option.n + 1;
  switch (option.status) {
    case 'ready': return { id: `option-${option.n}`, label: `Option ${n} is ready`, status: 'done' };
    case 'failed': return { id: `option-${option.n}`, label: `Option ${n} failed${option.error ? `: ${String(option.error).slice(0, 90)}` : ''}`, status: 'error' };
    case 'fitting': return { id: `option-${option.n}`, label: `Cutting option ${n} to your video's length…`, status: 'active' };
    case 'generating': return { id: `option-${option.n}`, label: `Composing option ${n}…`, status: 'active' };
    default: return { id: `option-${option.n}`, label: `Option ${n} — waiting to start`, status: 'pending' };
  }
}

/**
 * @param {{ options?: Array<{n:number,status:string,error?:string}>, durationS?: number, hasAudio?: boolean } | null} job
 */
export function musicProgressSteps(job) {
  const options = Array.isArray(job?.options) && job.options.length
    ? job.options
    : Array.from({ length: FALLBACK_COUNT }, (_, n) => ({ n, status: 'pending' }));
  const settled = options.filter((o) => o.status === 'ready' || o.status === 'failed').length;
  const length = Number.isFinite(job?.durationS) ? `${Math.round(job.durationS)}s` : null;

  return [
    { id: 'upload', label: 'Video uploaded', status: 'done' },
    { id: 'length', label: length ? `Video length read (${length})${job?.hasAudio ? '' : ' — no sound of its own'}` : 'Reading video length…', status: length ? 'done' : 'active' },
    ...options.map(optionStep),
    {
      id: 'finish',
      label: settled === options.length ? 'Finishing up' : 'Preparing previews',
      status: settled === options.length ? 'active' : 'pending',
    },
  ];
}

/** Overall 0-100 — used only for tests/other callers; the modal derives its own bar from the steps. */
export function musicProgressPercent(job) {
  const options = job?.options || [];
  if (!options.length) return 0;
  const weight = { pending: 0, generating: 0.35, fitting: 0.85, ready: 1, failed: 1 };
  const sum = options.reduce((n, o) => n + (weight[o.status] ?? 0), 0);
  return Math.round((sum / options.length) * 100);
}

export function formatElapsed(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(sec / 60);
  return m > 0 ? `${m}m ${sec % 60}s` : `${sec}s`;
}
