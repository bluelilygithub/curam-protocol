import React, { useEffect, useRef, useState } from 'react';
import Tooltip from '../../components/Tooltip';

// Frame picker for a finished Generate clip. The frame is grabbed in the browser from the clip already on
// screen (a blob URL, so the canvas is never tainted): nothing is uploaded or re-rendered. The slider starts
// a little before the very end because the last frames of AI clips often soften or drift.
// "Use as starting image" hands the frame to the Generate form's reference image, so the next clip starts
// exactly where this one ends.

const mutedStyle = { color: 'var(--color-muted)' };
const END_MARGIN = 0.05; // seeking exactly to the end can land past the last decoded frame
const DEFAULT_BACKOFF = 0.3;

function nameFor(time) {
  return `clip-frame-${time.toFixed(1)}s.jpg`;
}

export default function LastFramePicker({ videoUrl, onUse }) {
  const videoRef = useRef(null);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [frame, setFrame] = useState(null); // { url, blob }
  const [error, setError] = useState('');

  // New clip: forget the old frame/duration until its metadata loads.
  useEffect(() => {
    setDuration(0);
    setTime(0);
    setFrame(null);
    setError('');
  }, [videoUrl]);

  const maxT = Math.max(0, duration - END_MARGIN);

  useEffect(() => {
    if (!duration) return undefined;
    let cancelled = false;
    let objectUrl = '';
    const timer = setTimeout(async () => {
      const v = videoRef.current;
      if (!v) return;
      try {
        await new Promise((resolve) => {
          v.addEventListener('seeked', resolve, { once: true });
          v.currentTime = Math.min(maxT, Math.max(0, time));
        });
        if (cancelled) return;
        const scale = Math.min(1, 1920 / (v.videoWidth || 1920));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(v.videoWidth * scale);
        canvas.height = Math.round(v.videoHeight * scale);
        canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
        if (cancelled || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setFrame({ url: objectUrl, blob });
        setError('');
      } catch {
        if (!cancelled) setError("Your browser couldn't read a frame from this clip.");
      }
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [duration, time, maxT]);

  const setT = (t) => setTime(Math.min(maxT, Math.max(0, Number(t) || 0)));

  const btn = 'px-2 py-1 rounded-lg border text-xs transition-opacity hover:opacity-60';
  const btnStyle = { borderColor: 'var(--color-border)', color: 'var(--color-muted)' };

  return (
    <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
      <div>
        <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Take a frame from this clip</p>
        <p className="text-xs" style={mutedStyle}>
          Like how it ends? Use that exact frame as the start of the next clip for a seamless join. Pick a moment a little before the end if the last frames look soft.
        </p>
      </div>

      <video
        key={videoUrl}
        ref={videoRef}
        src={videoUrl}
        preload="auto"
        muted
        playsInline
        className="hidden"
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) {
            setDuration(d);
            setTime(Math.max(0, d - END_MARGIN - DEFAULT_BACKOFF));
          }
        }}
        onError={() => setError("Your browser couldn't read a frame from this clip.")}
      />

      {error && <p className="text-xs" style={{ color: '#ef4444' }}>{error}</p>}

      {duration > 0 && (
        <div className="flex gap-3 items-start">
          <div className="w-40 shrink-0 aspect-video rounded-lg border overflow-hidden flex items-center justify-center" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            {frame
              ? <img src={frame.url} alt={`Frame at ${time.toFixed(1)} seconds`} className="w-full h-full object-contain" />
              : <span className="text-[10px]" style={mutedStyle}>Loading frame…</span>}
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            <input
              type="range"
              min={0}
              max={maxT}
              step={0.05}
              value={Math.min(time, maxT)}
              onChange={(e) => setT(e.target.value)}
              className="w-full"
              aria-label="Frame time in seconds"
            />
            <div className="flex flex-wrap items-center gap-2 text-xs" style={mutedStyle}>
              <Tooltip text="Time in the clip, in seconds.">
                <input
                  type="number"
                  min={0}
                  max={maxT}
                  step={0.05}
                  value={Number(time.toFixed(2))}
                  onChange={(e) => setT(e.target.value)}
                  className="w-20 px-2 py-1 rounded-lg border text-xs"
                  style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  aria-label="Frame time in seconds"
                />
              </Tooltip>
              <span>of {duration.toFixed(1)} s</span>
              <button type="button" onClick={() => setT(0)} className={btn} style={btnStyle}>Start</button>
              <Tooltip text="Often safer than the very last frame, which can soften or drift."><button type="button" onClick={() => setT(maxT - 0.5)} className={btn} style={btnStyle}>0.5 s before end</button></Tooltip>
              <button type="button" onClick={() => setT(maxT)} className={btn} style={btnStyle}>Last frame</button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Tooltip text="Put this frame in the Reference image above (animate mode) so the next clip starts exactly here.">
                <button
                  type="button"
                  disabled={!frame}
                  onClick={() => onUse(new File([frame.blob], nameFor(time), { type: 'image/jpeg' }), time)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
                  style={{ background: 'var(--color-primary)' }}
                >
                  Use as starting image
                </button>
              </Tooltip>
              <Tooltip text="Save this frame as a JPEG.">
                {frame ? (
                  <a
                    href={frame.url}
                    download={nameFor(time)}
                    className="px-3 py-1.5 rounded-lg border text-xs transition-opacity hover:opacity-70"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  >
                    Download frame
                  </a>
                ) : (
                  <span className="px-3 py-1.5 rounded-lg border text-xs opacity-40" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Download frame</span>
                )}
              </Tooltip>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
