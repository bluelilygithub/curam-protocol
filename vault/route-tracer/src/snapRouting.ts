import { useEffect } from 'react';
import { api, ApiError } from './api';
import { snapApply, snapFail, snapMarkPending, snapWanted } from './drawing';
import type { Line } from './geo';
import { useStore } from './store';

/**
 * The routing side of "Follow roads": whenever the route has legs that want a road (a click just made, a point dragged and let go, a point
 * added or deleted), ask the server for each one, a few at a time, and give the road to the leg when it arrives.
 *  - answers are remembered for the session, so an undo and redo, or the same two clicks again, costs nothing
 *  - a leg whose request is already out is not asked for twice, so this can run on every change without piling up requests
 *  - an answer goes to whichever leg now has that identity (the two clicked points and the way of travelling), so one that arrives after an
 *    undo, or after the point was moved on, is simply not used
 *  - if the service cannot follow a road there (no road near a click, out of quota, no answer) the leg stays a straight line, is marked as
 *    failed, and the person is told once; Try again in the sidebar asks again
 */
const MAX_AT_ONCE = 4;
const answers = new Map<string, Line>();
const inflight = new Set<string>();
let toldAt = 0;

export function useSnapRouting(): void {
  const route = useStore((s) => s.draw.snap);
  useEffect(() => {
    if (!route) return;
    const { apply, toast, draw } = useStore.getState();
    const wants = snapWanted(draw).filter((w) => !inflight.has(w.sig));
    if (!wants.length) return;
    const known = wants.filter((w) => answers.has(w.sig));
    if (known.length) apply((s) => known.reduce((st, w) => snapApply(st, w.sig, answers.get(w.sig)!), s));
    const ask = wants.filter((w) => !answers.has(w.sig)).slice(0, Math.max(0, MAX_AT_ONCE - inflight.size));
    if (!ask.length) return;
    ask.forEach((w) => inflight.add(w.sig));
    apply((s) => snapMarkPending(s, new Set(ask.map((w) => w.sig))));
    ask.forEach((w) => {
      api.leg({ from: w.from, to: w.to, profile: w.profile })
        .then((r) => { answers.set(w.sig, r.route.coordinates); useStore.getState().apply((s) => snapApply(s, w.sig, r.route.coordinates)); })
        .catch((e: unknown) => {
          useStore.getState().apply((s) => snapFail(s, w.sig));
          if (Date.now() - toldAt > 4000) {
            toldAt = Date.now();
            toast('error', `${e instanceof ApiError || e instanceof Error ? e.message : 'Could not follow a road there.'} That section is a straight line for now.`, 5000);
          }
        })
        .finally(() => { inflight.delete(w.sig); });
    });
  }, [route]);
}
