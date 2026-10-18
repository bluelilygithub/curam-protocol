import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { usePlan } from './Plan';
import { usePlaces } from './Places';

/** The card over the map while a route is being found, so nobody wonders whether anything is happening (the routing service can take a while). */
export function PlanWorking() {
  const planning = usePlan((s) => s.busy);
  const kind = usePlan((s) => s.kind);
  const looking = usePlaces((s) => s.status === 'loading');
  const busy = planning || looking;
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!busy) { setSeconds(0); return undefined; }
    const t = window.setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [busy]);
  if (!busy) return null;
  const what = looking && !planning ? 'places near your route' : kind === 'loop' ? 'your loop' : kind === 'detour' ? 'routes of that length' : 'your route';
  const limit = looking && !planning ? 'a minute' : '30 seconds';
  return (
    <div className="working" role="status" aria-live="polite" data-testid="plan-working">
      <Loader2 size={22} className="working-spin" aria-hidden="true" />
      <div>
        <strong>{looking && !planning ? 'Looking for' : 'Finding'} {what}…</strong>
        <p>{seconds < 8 ? 'This usually takes a few seconds.' : `Still working (${seconds} s). The map data service is slow right now, and can take up to ${limit}. Thanks for waiting.`}</p>
      </div>
    </div>
  );
}
