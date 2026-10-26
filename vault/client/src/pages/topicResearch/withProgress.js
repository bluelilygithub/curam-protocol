import api from '../../utils/apiClient';
import useProcessingStore from '../../store/processingStore';
import { stepsForModal } from './format.mjs';

const POLL_MS = 700;

const newOpId = () => {
  const c = typeof crypto !== 'undefined' ? crypto : null;
  if (c?.randomUUID) return c.randomUUID(); // 36 characters of letters, digits and hyphens: what the server accepts
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

/**
 * Run a long action (a search, a brief, a draft) with the blocking overlay showing the steps it REALLY reaches.
 * `run(opId)` makes the request and must send `opId` with it. While it is pending this asks the server for the steps every ~0.7 s and
 * shows them (the server records each step as it happens, server/services/topicResearch/progress.js: nothing here is a timer guess).
 * A missed or failed poll is ignored; the overlay always closes when the request settles. Returns what `run` returns.
 *
 * @param {{ title: string, detail?: string, steps: string[], poll?: boolean }} what   `steps` are the labels shown until the server reports; `poll: false` for a single quick call
 */
export async function withProgress({ title, detail = null, steps, poll: wantPoll = true }, run) {
  const store = useProcessingStore.getState();
  const opId = newOpId();
  store.startProcessing(title, detail, { steps });
  let live = true;
  let inFlight = false;
  const poll = async () => {
    if (!live || inFlight) return;
    inFlight = true;
    try {
      const r = await api.get(`/api/topic-research/progress/${opId}`);
      if (r.ok && live) {
        const d = await r.json();
        const next = stepsForModal(d.steps);
        if (next.length && live) useProcessingStore.getState().setProcessingSteps(next);
      }
    } catch { /* a missed poll just means the steps update a moment later */ } finally { inFlight = false; }
  };
  const timer = wantPoll ? setInterval(poll, POLL_MS) : null; // a one-call action with a single step has nothing to report in between
  try {
    return await run(opId);
  } finally {
    live = false;
    if (timer) clearInterval(timer);
    useProcessingStore.getState().stopProcessing();
  }
}
