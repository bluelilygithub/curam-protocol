import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { usePlan } from './Plan';

/** The card over the map while a route is being found, so nobody wonders whether anything is happening (the routing service can take a while). */
export function PlanWorking() {
  const busy = usePlan((s) => s.busy);
  const kind = usePlan((s) => s.kind);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!busy) { setSeconds(0); return undefined; }
    const t = window.setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [busy]);
  if (!busy) return null;
  const what = kind === 'loop' ? 'your loop' : kind === 'detour' ? 'routes of that length' : 'your route';
  return (
    <div className="working" role="status" aria-live="polite" data-testid="plan-working">
      <Loader2 size={22} className="working-spin" aria-hidden="true" />
      <div>
        <strong>Finding {what}…</strong>
        <p>{seconds < 8 ? 'This usually takes a few seconds.' : `Still working (${seconds} s). The routing service is slow right now, and can take up to 30 seconds. Thanks for waiting.`}</p>
      </div>
    </div>
  );
}
