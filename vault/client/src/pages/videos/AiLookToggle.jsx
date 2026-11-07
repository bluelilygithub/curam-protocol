import React, { useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import Tooltip from '../../components/Tooltip';
import { visionSummary } from './visionFrames.mjs';

// The "Let the AI look" tick box shared by the Slideshow and Join planners. OFF every time: nothing is sent to the AI model unless the person ticks it.
// What it would send, and what it would cost, is written under the box BEFORE anything happens (the price comes from GET /api/videos/vision-info).
// See docs/video-tools.md, "Let the AI look".

let cached = null;
/** The price and limits of the AI look, fetched once per page load. null while loading. */
export function useVisionInfo() {
  const [info, setInfo] = useState(cached);
  useEffect(() => {
    if (cached) return undefined;
    let live = true;
    api.get('/api/videos/vision-info')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) cached = d; if (live) setInfo(d || { available: false, problem: 'Could not check the AI look just now.' }); })
      .catch(() => { if (live) setInfo({ available: false, problem: 'Could not check the AI look just now.' }); });
    return () => { live = false; };
  }, []);
  return info;
}

export default function AiLookToggle({ what, count, look, onChange, info, disabled = false }) {
  const summary = visionSummary(info, what, count);
  const usable = summary.ok && count >= 2 && !disabled;
  const label = what === 'clips' ? 'Let the AI look at a few frames from each clip' : 'Let the AI look at my pictures';
  return (
    <div className="space-y-1" data-guide="ai-look">
      <Tooltip text={what === 'clips'
        ? 'The planner normally works from your words and the file names only. Tick this and your browser also sends two small frames from each clip, so the AI can suggest a sensible order. It costs a little more, and your videos themselves stay in your browser. It is off unless you tick it.'
        : 'The planner normally works from your words and the file names only. Tick this and your browser also sends one small copy of each picture, so the AI can suggest a sensible order and fitting captions. It costs a little more, and your original pictures stay in your browser. It is off unless you tick it.'}>
        <label className="flex items-center gap-2 text-xs w-fit" style={{ color: 'var(--color-text)', opacity: usable || look ? 1 : 0.7 }}>
          <input type="checkbox" checked={look && usable} disabled={!usable} onChange={(e) => onChange(e.target.checked)} />
          {label}
        </label>
      </Tooltip>
      <p className="text-xs" role="status" style={{ color: summary.ok || !info ? 'var(--color-muted)' : '#b45309' }}>
        {count < 2 ? `Add at least two ${what === 'clips' ? 'clips' : 'pictures'} first.` : summary.text}
      </p>
    </div>
  );
}
