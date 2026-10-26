'use strict';

// Topic Research: where a long action (a search, a brief, a draft) has got to, for the step list the page shows while it waits.
//
// The page sends a random `opId` with the request that starts the action, then asks GET /progress/:opId every second or so. The server
// records each step here as it really happens (never on a timer). Kept in memory only: a restart loses it, which at worst means the page shows
// no steps for an action that was running. Entries expire after ten minutes, belong to the person who started them (nobody else can read them)
// and are capped per person. A reporter that fails to record anything must never break the action it reports on: every call is safe to make
// with any arguments, and an invalid opId gives a reporter that does nothing.
// See docs/topic-research.md.

const OP_ID = /^[A-Za-z0-9_-]{8,64}$/;
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_PER_USER = 30;
const MAX_DETAIL = 200;

const NOOP = Object.freeze({ start() {}, done() {}, detail() {}, fail() {}, finish() {} });

const text = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_DETAIL);

function createProgressStore({ now = Date.now, ttlMs = DEFAULT_TTL_MS, maxPerUser = DEFAULT_MAX_PER_USER } = {}) {
  const ops = new Map(); // `${userId}:${opId}` -> { userId, createdAt, updatedAt, finished, steps }

  const sweep = () => {
    const t = now();
    for (const [k, op] of ops) if (t - op.updatedAt > ttlMs) ops.delete(k);
  };

  /** Starts recording an action. `steps` is [{ id, label }] in the order they will happen. */
  function begin(userId, opId, steps) {
    if (typeof opId !== 'string' || !OP_ID.test(opId) || !Array.isArray(steps) || !steps.length) return NOOP;
    sweep();
    const mine = [...ops.entries()].filter(([, op]) => String(op.userId) === String(userId));
    if (mine.length >= maxPerUser) {
      mine.sort((a, b) => a[1].createdAt - b[1].createdAt);
      for (const [k] of mine.slice(0, mine.length - maxPerUser + 1)) ops.delete(k);
    }
    const t = now();
    const op = {
      userId, createdAt: t, updatedAt: t, finished: false,
      steps: steps.map((s) => ({ id: String(s.id), label: text(s.label), status: 'pending', detail: '' })),
    };
    ops.set(`${userId}:${opId}`, op);
    const find = (id) => op.steps.find((s) => s.id === id);
    const touch = () => { op.updatedAt = now(); };
    const set = (id, patch) => { try { const s = find(id); if (s && !op.finished) { Object.assign(s, patch); touch(); } } catch { /* a progress note never breaks the action */ } };
    return {
      start: (id, detail = '') => set(id, { status: 'active', detail: text(detail) }),
      detail: (id, detail) => set(id, { detail: text(detail) }),
      done: (id, detail) => { const s = find(id); set(id, { status: 'done', ...(detail !== undefined ? { detail: text(detail) } : { detail: s ? s.detail : '' }) }); },
      fail: (id, message) => set(id, { status: 'error', detail: text(message) }),
      // the action is over: whatever was still going is done (an error stays an error), nothing more is recorded
      finish: () => {
        try {
          for (const s of op.steps) if (s.status === 'active' || s.status === 'pending') s.status = s.status === 'active' ? 'done' : 'skipped';
          op.finished = true; touch();
        } catch { /* ignore */ }
      },
    };
  }

  /** The steps of one action, or null when there is none (or it is somebody else's, or it has expired). */
  function get(userId, opId) {
    if (typeof opId !== 'string' || !OP_ID.test(opId)) return null;
    sweep();
    const op = ops.get(`${userId}:${opId}`);
    if (!op || String(op.userId) !== String(userId)) return null;
    return { finished: op.finished, steps: op.steps.map((s) => ({ ...s })) };
  }

  return { begin, get, size: () => ops.size };
}

module.exports = { createProgressStore, progress: createProgressStore(), NOOP, OP_ID };
