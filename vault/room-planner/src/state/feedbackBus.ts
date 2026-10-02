import type { DimLine } from '../engine/liveDimensions';
import type { SnapCandidate, ValidationViolation, Fixture, FurnitureInstance, Vec2 } from '../engine/types';

/**
 * High-frequency interaction feedback: drag/ghost/resize/rotate previews, live dimensions, the constraint message, the
 * marquee. This is NOT a Zustand store and nothing here is React state: the renderer subscribes imperatively and mutates Konva
 * nodes directly (A12: pointer movement must not touch persistent state or trigger React-wide renders).
 */
export interface PreviewObject {
  /** Existing object id being dragged, or a synthetic id for a ghost. */
  id: string;
  kind: 'furniture' | 'fixture';
  /** Furniture preview transform (position/rotation/size already include the live edit). */
  instance?: FurnitureInstance;
  fixture?: Fixture;
  valid: boolean;
  violations: ValidationViolation[];
  /** A ghost (not yet an object in the project) is drawn translucent. */
  ghost: boolean;
  /** A fixture ghost that is not near any wall yet: a plain marker at the pointer ("move next to a wall"). */
  freeAt?: Vec2;
  freeWidth?: number;
}

export interface FeedbackState {
  previews: PreviewObject[];
  /** Committed objects hidden while their preview is drawn in the overlay. */
  hiddenIds: string[];
  dims: DimLine[];
  snap: SnapCandidate | null;
  marquee: { a: Vec2; b: Vec2 } | null;
  measure: { a: Vec2; b: Vec2 | null } | null;
  /** Live constraint message (throttled to once per 100 ms, B5). */
  message: { text: string; severity: 'hard' | 'soft'; violations: ValidationViolation[] } | null;
  /** Set once on an invalid release: the renderer animates previews back to the committed state, then clears. */
  animateBack: boolean;
  cursor: string;
}

export const EMPTY_FEEDBACK: FeedbackState = {
  previews: [], hiddenIds: [], dims: [], snap: null, marquee: null, measure: null, message: null, animateBack: false, cursor: 'default',
};

export const MESSAGE_THROTTLE_MS = 100;

type Listener = (s: FeedbackState) => void;

export interface FeedbackBus {
  get(): FeedbackState;
  subscribe(fn: Listener): () => void;
  /** Merge a patch and notify. Counts as one publish. */
  set(patch: Partial<FeedbackState>): void;
  /** Throttled message update (at most one change per 100 ms; the latest value always lands). */
  setMessage(m: FeedbackState['message']): void;
  reset(): void;
  /** Number of notifications so far (tests). */
  readonly publishCount: number;
}

export function createFeedbackBus(now: () => number = () => performance.now()): FeedbackBus {
  let state: FeedbackState = EMPTY_FEEDBACK;
  const listeners = new Set<Listener>();
  let publishes = 0;
  let lastMessageAt = -Infinity;
  let pending: { m: FeedbackState['message'] } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const emit = (): void => {
    publishes++;
    for (const l of listeners) l(state);
  };

  const flush = (): void => {
    timer = null;
    if (!pending) return;
    const { m } = pending;
    pending = null;
    lastMessageAt = now();
    state = { ...state, message: m };
    emit();
  };

  return {
    get: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    set(patch) {
      state = { ...state, ...patch };
      emit();
    },
    setMessage(m) {
      const same = (state.message?.text ?? null) === (m?.text ?? null) && state.message?.severity === m?.severity;
      if (same && !pending) return;
      const elapsed = now() - lastMessageAt;
      if (elapsed >= MESSAGE_THROTTLE_MS) {
        pending = null;
        if (timer) { clearTimeout(timer); timer = null; }
        lastMessageAt = now();
        state = { ...state, message: m };
        emit();
      } else {
        pending = { m };
        if (!timer) timer = setTimeout(flush, MESSAGE_THROTTLE_MS - elapsed);
      }
    },
    reset() {
      pending = null;
      if (timer) { clearTimeout(timer); timer = null; }
      lastMessageAt = -Infinity;
      state = EMPTY_FEEDBACK;
      emit();
    },
    get publishCount() { return publishes; },
  };
}
