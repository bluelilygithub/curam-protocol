import React, { useCallback, useEffect, useRef, useState } from 'react';
import Tooltip from '../../components/Tooltip';
import {
  clampStart, clampEnd, nudge, timeFromX, pct, reachedEnd, normalizeRange,
} from './clipRange.mjs';

/**
 * The Clip / trim timeline, wired to the video player above it.
 *
 *  - a strip of frames from the video, so you can SEE where you are;
 *  - a playhead that follows the video; click or drag on the strip to scrub (the video jumps there);
 *  - two markers (in / out): drag them and the video shows the exact frame at that marker;
 *    keyboard too (arrow keys 0.1 s, Shift+arrow 1 s);
 *  - buttons to take the point you are watching as the start or the end, to preview just the selection, and to jump to a marker.
 *
 * `videoRef` is the page's <video>; `src` its URL (used only to draw the frame strip from a hidden copy).
 */

function fmt(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00.0';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

/** A row of small frames spread across the video's length, made by seeking a hidden copy of it. Quietly gives up if it cannot. */
function useFrameStrip(src, duration, count = 12) {
  const [frames, setFrames] = useState([]);
  useEffect(() => {
    if (!src || !(duration > 0)) { setFrames([]); return undefined; }
    let cancelled = false;
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.playsInline = true;
    v.src = src;
    const canvas = document.createElement('canvas');
    const out = [];

    const grab = (t) => new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        v.removeEventListener('seeked', onSeeked);
        clearTimeout(guard);
        resolve();
      };
      const onSeeked = () => {
        try {
          const ctx = canvas.getContext('2d');
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
          out.push(canvas.toDataURL('image/jpeg', 0.55));
        } catch { out.push(''); }
        finish();
      };
      const guard = setTimeout(() => { out.push(''); finish(); }, 4000);
      v.addEventListener('seeked', onSeeked);
      v.currentTime = t;
    });

    (async () => {
      try {
        if (v.readyState < 1) {
          await new Promise((resolve, reject) => {
            v.addEventListener('loadedmetadata', resolve, { once: true });
            v.addEventListener('error', () => reject(new Error('unsupported')), { once: true });
          });
        }
        canvas.width = 96;
        canvas.height = Math.max(24, Math.round(96 * ((v.videoHeight || 9) / (v.videoWidth || 16))));
        for (let i = 0; i < count; i += 1) {
          if (cancelled) return;
          await grab(Math.min(duration - 0.05, ((i + 0.5) * duration) / count));
          if (!cancelled) setFrames([...out]);
        }
      } catch { /* the plain bar still works without pictures */ }
    })();

    return () => {
      cancelled = true;
      v.removeAttribute('src');
      v.load();
    };
  }, [src, duration, count]);
  return frames;
}

export default function ClipTimeline({
  src, videoRef, duration, startSec, endSec, onStartChange, onEndChange,
}) {
  const trackRef = useRef(null);
  const dragRef = useRef(null); // 'start' | 'end' | 'scrub'
  const previewingRef = useRef(false);
  const [now, setNow] = useState(0);
  const { dur, start, end } = normalizeRange(startSec, endSec, duration);
  const endRef = useRef(end);
  endRef.current = end;
  const frames = useFrameStrip(src, dur);

  const seek = useCallback((t) => {
    const v = videoRef?.current;
    if (!v || !Number.isFinite(t)) return;
    const to = Math.max(0, Math.min(t, dur));
    v.currentTime = to;
    setNow(to);
  }, [videoRef, dur]);

  // The playhead follows the video, smoothly while it plays; "play selection" stops itself at the out point.
  useEffect(() => {
    const v = videoRef?.current;
    if (!v) return undefined;
    let raf = 0;
    const tick = () => {
      setNow(v.currentTime);
      if (previewingRef.current && reachedEnd(v.currentTime, endRef.current)) {
        v.pause();
        previewingRef.current = false;
      }
      if (!v.paused && !v.ended) raf = requestAnimationFrame(tick);
    };
    const onPlay = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); };
    const onOther = () => { setNow(v.currentTime); };
    v.addEventListener('play', onPlay);
    v.addEventListener('seeked', onOther);
    v.addEventListener('timeupdate', onOther);
    v.addEventListener('pause', onOther);
    if (!v.paused) onPlay();
    return () => {
      cancelAnimationFrame(raf);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('seeked', onOther);
      v.removeEventListener('timeupdate', onOther);
      v.removeEventListener('pause', onOther);
    };
  }, [videoRef, src, dur]);

  // Dragging (a marker, or scrubbing the playhead) keeps working when the pointer leaves the bar.
  useEffect(() => {
    const onMove = (e) => {
      const mode = dragRef.current;
      if (!mode || !dur) return;
      const t = timeFromX(e.clientX, trackRef.current?.getBoundingClientRect(), dur);
      if (mode === 'start') {
        const next = clampStart(t, end);
        onStartChange(next);
        seek(next); // show the exact frame the clip will start on
      } else if (mode === 'end') {
        const next = clampEnd(t, start, dur);
        onEndChange(next);
        seek(next); // show the exact frame the clip will end on
      } else {
        seek(t);
      }
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dur, start, end, onStartChange, onEndChange, seek]);

  if (!dur) {
    return (
      <p className="text-xs rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
        Load a video to see the timeline and set the start and end points.
      </p>
    );
  }

  const video = () => videoRef?.current;
  const startPct = pct(start, dur);
  const endPct = pct(end, dur);
  const nowPct = pct(now, dur);

  const markerKeys = (which) => (e) => {
    const dir = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : 0;
    if (!dir) return;
    e.preventDefault();
    if (which === 'start') { const n = clampStart(nudge(start, dir, e.shiftKey), end); onStartChange(n); seek(n); }
    else { const n = clampEnd(nudge(end, dir, e.shiftKey), start, dur); onEndChange(n); seek(n); }
  };

  const btn = 'px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-opacity hover:opacity-70 disabled:opacity-40';
  const btnStyle = { borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-surface)' };

  return (
    <div className="space-y-2 rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
      <div className="flex justify-between text-[10px] font-mono" style={{ color: 'var(--color-muted)' }}>
        <span>Start {fmt(start)}</span>
        <span>Now {fmt(now)}</span>
        <span>Length {fmt(end - start)}</span>
        <span>End {fmt(end)}</span>
      </div>

      <div
        ref={trackRef}
        className="relative h-14 rounded-lg select-none touch-none cursor-pointer overflow-visible"
        style={{ background: 'var(--color-surface)' }}
        onPointerDown={(e) => {
          if (e.target.closest('[data-marker]')) return;
          dragRef.current = 'scrub';
          seek(timeFromX(e.clientX, trackRef.current?.getBoundingClientRect(), dur));
        }}
      >
        {/* pictures from the video */}
        <div className="absolute inset-0 flex overflow-hidden rounded-lg pointer-events-none" aria-hidden="true">
          {frames.map((f, i) => (f
            ? <img key={i} src={f} alt="" draggable={false} className="h-full flex-1 min-w-0 object-cover" />
            : <span key={i} className="h-full flex-1" />))}
        </div>
        {/* dim what will be cut off; frame the part that is kept */}
        <div className="absolute top-0 bottom-0 left-0 rounded-l-lg pointer-events-none" style={{ width: `${startPct}%`, background: 'rgba(0,0,0,0.55)' }} />
        <div className="absolute top-0 bottom-0 right-0 rounded-r-lg pointer-events-none" style={{ width: `${100 - endPct}%`, background: 'rgba(0,0,0,0.55)' }} />
        <div
          className="absolute top-0 bottom-0 border-y-2 pointer-events-none"
          style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%`, borderColor: 'var(--color-primary)' }}
        />
        {/* the playhead */}
        <div className="absolute -top-1 -bottom-1 w-0.5 pointer-events-none" style={{ left: `${nowPct}%`, background: '#fff', boxShadow: '0 0 0 1px rgba(0,0,0,0.6)' }} />

        <Tooltip text="Drag to choose where the clip starts. The video above jumps to that exact picture. Arrow keys fine-tune it (Shift = a whole second).">
          <div
            data-marker="start"
            role="slider"
            tabIndex={0}
            aria-label="Start marker"
            aria-valuemin={0}
            aria-valuemax={dur}
            aria-valuenow={start}
            aria-valuetext={fmt(start)}
            className="absolute -top-1 -bottom-1 w-4 -ml-3 rounded-l-md cursor-ew-resize touch-none flex items-center justify-center focus:outline-none focus-visible:ring-2"
            style={{ left: `${startPct}%`, background: 'var(--color-primary)' }}
            onKeyDown={markerKeys('start')}
            onPointerDown={(e) => { e.stopPropagation(); dragRef.current = 'start'; seek(start); }}
          >
            <span className="w-0.5 h-5 rounded bg-white/80" />
          </div>
        </Tooltip>
        <Tooltip text="Drag to choose where the clip ends. The video above jumps to that exact picture. Arrow keys fine-tune it (Shift = a whole second).">
          <div
            data-marker="end"
            role="slider"
            tabIndex={0}
            aria-label="End marker"
            aria-valuemin={0}
            aria-valuemax={dur}
            aria-valuenow={end}
            aria-valuetext={fmt(end)}
            className="absolute -top-1 -bottom-1 w-4 rounded-r-md cursor-ew-resize touch-none flex items-center justify-center focus:outline-none focus-visible:ring-2"
            style={{ left: `${endPct}%`, background: 'var(--color-primary)' }}
            onKeyDown={markerKeys('end')}
            onPointerDown={(e) => { e.stopPropagation(); dragRef.current = 'end'; seek(end); }}
          >
            <span className="w-0.5 h-5 rounded bg-white/80" />
          </div>
        </Tooltip>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Tooltip text="Pause the video where you want the clip to begin, then press this. The start marker moves to the picture you are looking at.">
          <button type="button" className={btn} style={btnStyle} onClick={() => { const v = video(); if (v) onStartChange(clampStart(v.currentTime, end)); }}>Set start here</button>
        </Tooltip>
        <Tooltip text="Pause the video where you want the clip to finish, then press this. The end marker moves to the picture you are looking at.">
          <button type="button" className={btn} style={btnStyle} onClick={() => { const v = video(); if (v) onEndChange(clampEnd(v.currentTime, start, dur)); }}>Set end here</button>
        </Tooltip>
        <Tooltip text="Play only the part you have selected, from the start marker to the end marker, so you can check it before you export.">
          <button
            type="button"
            className={btn}
            style={btnStyle}
            onClick={() => { const v = video(); if (!v) return; seek(start); previewingRef.current = true; v.play().catch(() => { previewingRef.current = false; }); }}
          >
            Play selection
          </button>
        </Tooltip>
        <Tooltip text="Jump the video to the start marker.">
          <button type="button" className={btn} style={btnStyle} onClick={() => seek(start)}>Go to start</button>
        </Tooltip>
        <Tooltip text="Jump the video to the end marker.">
          <button type="button" className={btn} style={btnStyle} onClick={() => seek(end)}>Go to end</button>
        </Tooltip>
      </div>
      <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
        Click or drag along the pictures to move through the video. Drag the two coloured end markers to choose the part to keep; the video shows the picture at each marker.
      </p>
    </div>
  );
}
