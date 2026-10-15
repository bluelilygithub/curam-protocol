import React, { useCallback, useEffect, useRef, useState } from 'react';
import Tooltip from '../../components/Tooltip';
import {
  clampStart, clampEnd, nudge, reachedEnd, normalizeRange, clampBlockStart, blockStartFromPointer,
  MIN_SPAN, clampView, zoomView, wholeView, isWhole, viewForSelection, ensureVisible, timeFromXView, pctView, visiblePct, stripTimes, lastFrameTime,
} from './clipRange.mjs';

/**
 * The Clip / trim timeline, wired to the video player above it.
 *
 *  - a strip of frames from the video, so you can SEE roughly where you are (a guide: a still every few seconds; zoom in and the
 *    pictures get closer together);
 *  - ZOOM: show just a window of the video (zoom in / out / to the selection / whole video, and a scroll bar);
 *  - two EXACT pictures, the real frame at the start and at the end of the selection, taken from the video itself;
 *  - a playhead that follows the video; click or drag on the strip to scrub (the video jumps there);
 *  - two markers (in / out): drag them and the video shows the exact frame at that marker;
 *    keyboard too (arrow keys 0.1 s, Shift+arrow 1 s);
 *  - buttons to take the point you are watching as the start or the end, to preview just the selection, and to jump to a marker.
 *
 * `videoRef` is the page's <video>; `src` its URL (used only to draw the frame strip from a hidden copy).
 *
 * `blockSec`: when given (> 0) the selection is ONE block of exactly that length that slides along the video as a whole (Replace a
 * section, where the replacement clip's length is fixed). Only `startSec` / `onStartChange` are used then; the end is start + blockSec.
 */

function fmt(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00.0';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

const STRIP_COUNT = 16;

/**
 * A row of small frames spread across the visible window, made by seeking a hidden copy of the video. Each picture is the frame at the
 * middle of its tile, so it is only a guide (it is closest to the truth when zoomed in). Rebuilt (after a short pause) when the window
 * changes. Quietly gives up if it cannot.
 */
function useFrameStrip(src, duration, view, count = STRIP_COUNT) {
  const [frames, setFrames] = useState([]);
  useEffect(() => {
    if (!src || !(duration > 0) || !(view.span > 0)) { setFrames([]); return undefined; }
    let cancelled = false;
    setFrames([]);
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.playsInline = true;
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

    // wait a moment so clicking zoom a few times does not start a build for every click
    const timer = setTimeout(() => {
      v.src = src;
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
          const times = stripTimes(view, count, duration);
          for (let i = 0; i < times.length; i += 1) {
            if (cancelled) return;
            await grab(times[i]);
            if (!cancelled) setFrames([...out]);
          }
        } catch { /* the plain bar still works without pictures */ }
      })();
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      v.removeAttribute('src');
      v.load();
    };
  }, [src, duration, view.start, view.span, count]);
  return frames;
}

/**
 * The real frame of the video at `timeSec`, drawn into a canvas (`canvasRef`). Uses its own hidden copy of the video so dragging
 * never disturbs the player; while the video is still seeking, only the newest wanted time is kept (no queue builds up).
 */
function useExactFrame(src, timeSec) {
  const canvasRef = useRef(null);
  const st = useRef({ video: null, ready: false, seeking: false, wanted: null, drawn: null, target: null, guard: 0 });
  const [failed, setFailed] = useState(false);

  const draw = useCallback(() => {
    const v = st.current.video;
    const c = canvasRef.current;
    if (!v || !c || !v.videoWidth) return;
    if (c.width !== 480) { c.width = 480; c.height = Math.max(90, Math.round((480 * v.videoHeight) / v.videoWidth)); }
    try { c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); } catch { setFailed(true); }
  }, []);

  const request = useCallback(() => {
    const s = st.current;
    if (!s.video || !s.ready || s.seeking || s.wanted == null || s.drawn === s.wanted) return;
    s.seeking = true;
    s.target = s.wanted;
    // some browsers do not fire "seeked" when asked for the time they are already at, so do not wait forever
    clearTimeout(s.guard);
    s.guard = setTimeout(() => { if (s.seeking) { s.seeking = false; draw(); s.drawn = s.target; } }, 3000);
    s.video.currentTime = s.wanted;
  }, [draw]);

  useEffect(() => {
    if (!src) return undefined;
    const s = st.current;
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.playsInline = true;
    s.video = v;
    s.ready = false;
    s.seeking = false;
    s.drawn = null;
    setFailed(false);
    const onLoaded = () => { s.ready = true; request(); };
    const onSeeked = () => { clearTimeout(s.guard); s.seeking = false; draw(); s.drawn = s.target; request(); };
    const onError = () => setFailed(true);
    v.addEventListener('loadeddata', onLoaded);
    v.addEventListener('seeked', onSeeked);
    v.addEventListener('error', onError);
    v.src = src;
    return () => {
      clearTimeout(s.guard);
      v.removeEventListener('loadeddata', onLoaded);
      v.removeEventListener('seeked', onSeeked);
      v.removeEventListener('error', onError);
      v.removeAttribute('src');
      v.load();
      s.video = null;
    };
  }, [src, draw, request]);

  useEffect(() => {
    st.current.wanted = Number.isFinite(timeSec) ? timeSec : null;
    request();
  }, [timeSec, request]);

  return { canvasRef, failed };
}

/** One exact picture with its caption and time. */
function ExactFrame({ label, time, canvasRef, failed }) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex justify-between gap-2 text-[10px]" style={{ color: 'var(--color-muted)' }}>
        <span className="font-medium truncate">{label}</span>
        <span className="font-mono shrink-0">{fmt(time)}</span>
      </div>
      {failed ? (
        <div className="w-full aspect-video rounded-lg flex items-center justify-center text-[10px] text-center px-2" style={{ background: 'var(--color-surface)', color: 'var(--color-muted)' }}>
          Cannot show this picture here. The player above still shows the exact frame.
        </div>
      ) : (
        <canvas ref={canvasRef} className="w-full h-auto rounded-lg" style={{ background: '#000', aspectRatio: '16 / 9' }} aria-label={`${label} at ${fmt(time)}`} />
      )}
    </div>
  );
}

export default function ClipTimeline({
  src, videoRef, duration, startSec, endSec, onStartChange, onEndChange, blockSec = 0,
}) {
  const trackRef = useRef(null);
  const dragRef = useRef(null); // 'start' | 'end' | 'block' | 'scrub'
  const grabRef = useRef(0); // block mode: how far into the block it was grabbed, in seconds
  const previewingRef = useRef(false);
  const [now, setNow] = useState(0);
  const ranged = normalizeRange(startSec, endSec, duration);
  const dur = ranged.dur;
  const blockMode = Number(blockSec) > 0 && dur > 0;
  const block = blockMode ? Math.min(Number(blockSec), dur) : 0;
  const start = blockMode ? clampBlockStart(startSec, block, dur) : ranged.start;
  const end = blockMode ? start + block : ranged.end;
  const endRef = useRef(end);
  endRef.current = end;

  // the window of the video the track shows (null = the whole video until the person zooms)
  const [viewState, setViewState] = useState(null);
  const view = dur > 0 ? clampView(viewState || wholeView(dur), dur) : { start: 0, span: 0 };
  const whole = isWhole(view, dur);
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => { setViewState(null); }, [src, dur]);
  // when the selection is moved some way other than dragging (typed times, buttons, keys), keep it on screen
  useEffect(() => {
    if (dragRef.current || !(dur > 0)) return;
    const cur = viewRef.current;
    const next = ensureVisible(cur, start, end, dur);
    if (next.start !== cur.start || next.span !== cur.span) setViewState(next);
  }, [start, end, dur]);

  const frames = useFrameStrip(src, dur, view);
  const startFrame = useExactFrame(src, dur > 0 ? start : null);
  const endFrame = useExactFrame(src, dur > 0 ? lastFrameTime(start, end) : null);

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
      const t = timeFromXView(e.clientX, trackRef.current?.getBoundingClientRect(), viewRef.current);
      if (mode === 'block') {
        const next = blockStartFromPointer(t, grabRef.current, block, dur);
        onStartChange(next);
        seek(next); // show the picture the new clip will start on
      } else if (mode === 'start') {
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
  }, [dur, start, end, block, onStartChange, onEndChange, seek]);

  if (!dur) {
    return (
      <p className="text-xs rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
        Load a video to see the timeline and set the start and end points.
      </p>
    );
  }

  const video = () => videoRef?.current;
  const startRaw = pctView(start, view);
  const endRaw = pctView(end, view);
  const startPct = Math.max(0, Math.min(100, startRaw));
  const endPct = Math.max(0, Math.min(100, endRaw));
  const nowRaw = pctView(now, view);
  const shown = visiblePct(start, end, view); // the part of the selection inside the window, or null
  const startOn = startRaw >= -0.01 && startRaw <= 100.01;
  const endOn = endRaw >= -0.01 && endRaw <= 100.01;
  const zoomCentre = (start + end) / 2;
  const zoomTo = (v) => setViewState(clampView(v, dur));

  const markerKeys = (which) => (e) => {
    const dir = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : 0;
    if (!dir) return;
    e.preventDefault();
    if (which === 'block') { const n = clampBlockStart(nudge(start, dir, e.shiftKey), block, dur); onStartChange(n); seek(n); }
    else if (which === 'start') { const n = clampStart(nudge(start, dir, e.shiftKey), end); onStartChange(n); seek(n); }
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
          seek(timeFromXView(e.clientX, trackRef.current?.getBoundingClientRect(), view));
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
        {shown && (
          <div
            className="absolute top-0 bottom-0 border-y-2 pointer-events-none"
            style={{ left: `${shown.left}%`, width: `${shown.width}%`, borderColor: 'var(--color-primary)' }}
          />
        )}
        {/* the playhead */}
        {nowRaw >= 0 && nowRaw <= 100 && (
          <div className="absolute -top-1 -bottom-1 w-0.5 pointer-events-none" style={{ left: `${nowRaw}%`, background: '#fff', boxShadow: '0 0 0 1px rgba(0,0,0,0.6)' }} />
        )}

        {blockMode ? (
          <Tooltip text={`This block is exactly as long as your replacement clip (${fmt(block)}). Drag it along the video to where the new clip should go; the video above shows the picture at its start. Arrow keys nudge it (Shift = a whole second). Use the zoom buttons for finer control.`}>
            <div
              data-marker="block"
              role="slider"
              tabIndex={0}
              aria-label="Replacement clip position"
              aria-valuemin={0}
              aria-valuemax={Math.max(0, dur - block)}
              aria-valuenow={start}
              aria-valuetext={`${fmt(start)} to ${fmt(end)}`}
              className="absolute -top-1 -bottom-1 rounded-md cursor-grab active:cursor-grabbing touch-none flex items-center justify-center focus:outline-none focus-visible:ring-2"
              style={{ left: `${shown ? shown.left : startPct}%`, width: `${shown ? shown.width : 0}%`, background: 'rgba(204,120,92,0.28)', border: '2px solid var(--color-primary)', minWidth: 14, display: shown ? undefined : 'none' }}
              onKeyDown={markerKeys('block')}
              onPointerDown={(e) => {
                e.stopPropagation();
                dragRef.current = 'block';
                grabRef.current = Math.max(0, timeFromXView(e.clientX, trackRef.current?.getBoundingClientRect(), view) - start);
                seek(start);
              }}
            >
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded pointer-events-none" style={{ background: 'var(--color-primary)', color: '#fff', whiteSpace: 'nowrap' }}>
                ⇄ {fmt(block)}
              </span>
            </div>
          </Tooltip>
        ) : (
          <>
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
            style={{ left: `${startPct}%`, background: 'var(--color-primary)', display: startOn ? undefined : 'none' }}
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
            style={{ left: `${endPct}%`, background: 'var(--color-primary)', display: endOn ? undefined : 'none' }}
            onKeyDown={markerKeys('end')}
            onPointerDown={(e) => { e.stopPropagation(); dragRef.current = 'end'; seek(end); }}
          >
            <span className="w-0.5 h-5 rounded bg-white/80" />
          </div>
        </Tooltip>
          </>
        )}
      </div>

      <div className="flex justify-between text-[10px] font-mono" style={{ color: 'var(--color-muted)' }}>
        <span>{fmt(view.start)}</span>
        <span>{whole ? 'Whole video' : `Showing ${fmt(view.span)} of ${fmt(dur)}`}</span>
        <span>{fmt(view.start + view.span)}</span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Tooltip text="Show less of the video, so each part of the bar is wider and the pictures are closer together in time. Easier to place the block or markers exactly.">
          <button type="button" className={btn} style={btnStyle} disabled={view.span <= Math.min(MIN_SPAN, dur) + 1e-6} onClick={() => zoomTo(zoomView(view, 0.5, zoomCentre, dur))}>Zoom in</button>
        </Tooltip>
        <Tooltip text="Show more of the video.">
          <button type="button" className={btn} style={btnStyle} disabled={whole} onClick={() => zoomTo(zoomView(view, 2, zoomCentre, dur))}>Zoom out</button>
        </Tooltip>
        <Tooltip text="Zoom so the selection fills about a third of the bar, with some video either side so you can see what is around it.">
          <button type="button" className={btn} style={btnStyle} onClick={() => zoomTo(viewForSelection(start, end, dur))}>Zoom to selection</button>
        </Tooltip>
        <Tooltip text="Show the whole video again.">
          <button type="button" className={btn} style={btnStyle} disabled={whole} onClick={() => setViewState(null)}>Whole video</button>
        </Tooltip>
      </div>
      {!whole && (
        <Tooltip text="Slide this to move the zoomed window along the video. The block or markers stay where they are.">
          <input
            type="range"
            aria-label="Scroll along the video"
            min={0}
            max={Math.max(0, dur - view.span)}
            step={0.1}
            value={view.start}
            onChange={(e) => zoomTo({ start: Number(e.target.value), span: view.span })}
            className="w-full"
          />
        </Tooltip>
      )}

      <div className="grid grid-cols-2 gap-2">
        <ExactFrame label={blockMode ? 'First frame replaced' : 'Starts on this frame'} time={start} canvasRef={startFrame.canvasRef} failed={startFrame.failed} />
        <ExactFrame label={blockMode ? 'Last frame replaced' : 'Ends after this frame'} time={lastFrameTime(start, end)} canvasRef={endFrame.canvasRef} failed={endFrame.failed} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Tooltip text="Pause the video where you want the clip to begin, then press this. The start marker moves to the picture you are looking at.">
          <button type="button" className={btn} style={btnStyle} onClick={() => { const v = video(); if (!v) return; onStartChange(blockMode ? clampBlockStart(v.currentTime, block, dur) : clampStart(v.currentTime, end)); }}>Set start here</button>
        </Tooltip>
        <Tooltip text="Pause the video where you want the clip to finish, then press this. The end marker moves to the picture you are looking at.">
          <button type="button" className={btn} style={btnStyle} onClick={() => { const v = video(); if (!v) return; if (blockMode) onStartChange(clampBlockStart(v.currentTime - block, block, dur)); else onEndChange(clampEnd(v.currentTime, start, dur)); }}>Set end here</button>
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
        {blockMode
          ? `Click or drag along the bar to move through the video. Drag the coloured block (exactly ${fmt(block)} long, the length of your clip) to where the new clip should go. The two big pictures are the exact frames at each end of the block. The small pictures in the bar are only a guide (one every few seconds), so zoom in to line things up.`
          : 'Click or drag along the bar to move through the video. Drag the two coloured end markers to choose the part to keep. The two big pictures are the exact frames at each marker. The small pictures in the bar are only a guide (one every few seconds), so zoom in to line things up.'}
      </p>
      {Number(blockSec) > dur && dur > 0 && (
        <p className="text-[11px]" style={{ color: '#ef4444' }} role="alert">Your clip ({fmt(Number(blockSec))}) is longer than this whole video ({fmt(dur)}), so it cannot replace a section of it.</p>
      )}
    </div>
  );
}
