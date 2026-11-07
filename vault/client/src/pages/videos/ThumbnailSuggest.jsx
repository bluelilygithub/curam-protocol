import React, { useEffect, useRef, useState } from 'react';
import Tooltip from '../../components/Tooltip';
import { suggestFrames } from './sceneScan';

// Thumbnail tool: "Suggest good frames". Looks through the video IN THE BROWSER (nothing is uploaded, nothing costs anything) and offers a few sharp,
// different frames; pressing one fills in the time. See sceneCuts.mjs for how they are chosen.

const fmt = (t) => { const m = Math.floor(t / 60); const s = t - m * 60; return `${m}:${s.toFixed(1).padStart(4, '0')}`; };

export default function ThumbnailSuggest({ src, onPick, current }) {
  const [state, setState] = useState('idle'); // idle | working | done | failed
  const [frames, setFrames] = useState([]);
  const cancelRef = useRef(false);

  // a different video, or leaving the tool, stops any search and clears the offers
  useEffect(() => { cancelRef.current = false; setState('idle'); setFrames([]); return () => { cancelRef.current = true; }; }, [src]);

  const run = async () => {
    cancelRef.current = false;
    setState('working');
    try {
      const out = await suggestFrames(src, { count: 4, isCancelled: () => cancelRef.current });
      if (cancelRef.current) return;
      setFrames(out);
      setState('done');
    } catch (err) {
      if (!cancelRef.current) setState('failed');
    }
  };

  if (!src) return null;
  return (
    <div className="space-y-2" data-guide="thumb-suggest">
      <Tooltip text="Looks through your video in this browser (nothing is uploaded and it costs nothing) and offers a few sharp, different frames, skipping dark, blank and near-duplicate ones. Press one to use its time.">
        <button
          type="button"
          onClick={run}
          disabled={state === 'working'}
          className="px-3 py-1.5 rounded-lg border text-xs font-medium transition-opacity hover:opacity-70 disabled:opacity-50"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        >
          {state === 'working' ? 'Looking through the video…' : 'Suggest good frames'}
        </button>
      </Tooltip>
      {state === 'failed' && <p className="text-xs" role="alert" style={{ color: '#b45309' }}>This browser could not read the video to look through it. Type a time instead.</p>}
      {state === 'done' && frames.length === 0 && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Nothing stood out: the video looks dark, blank or very still. Type a time instead.</p>}
      {state === 'done' && frames.length > 0 && (
        <div>
          <p className="text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Best first. Press a frame to use its time.</p>
          <div className="flex flex-wrap gap-2">
            {frames.map((f) => (
              <Tooltip key={f.t} text={`Use ${fmt(f.t)} as the frame to export.`}>
                <button
                  type="button"
                  onClick={() => onPick(f.t)}
                  aria-pressed={Math.abs((Number(current) || 0) - f.t) < 0.05}
                  className="rounded-lg overflow-hidden border text-left transition-opacity hover:opacity-70"
                  style={{ borderColor: Math.abs((Number(current) || 0) - f.t) < 0.05 ? 'var(--color-primary)' : 'var(--color-border)', borderWidth: 2, width: 128 }}
                >
                  <img src={f.dataUrl} alt={`Frame at ${fmt(f.t)}`} className="block w-full h-auto" />
                  <span className="block text-[10px] font-mono px-1.5 py-0.5" style={{ color: 'var(--color-muted)' }}>{fmt(f.t)}</span>
                </button>
              </Tooltip>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
