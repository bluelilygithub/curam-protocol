import React, { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../utils/apiClient';
import Dialog from '../../components/Dialog';
import Tooltip from '../../components/Tooltip';
import { useIcon } from '../../providers/IconProvider';
import { TRANSITIONS, readJson } from './shared';
import { fitScale, keyStep, slidePages } from './slideshowKeys.mjs';

// Full-screen slideshow of the current deck. Slides come from the same server renderer as the preview and the PDF
// (POST /api/presentations/preview), split into one frame per slide so the show can animate between them.
// Keys (slideshow.mjs): → Space PageDown next, ← Backspace PageUp back, Home End, a number then Enter jumps, Escape leaves.

const SIZES = { '16:9': [1280, 720], '4:3': [960, 720], '1:1': [900, 900] };
const ANIM_MS = 550;
const IDLE_MS = 2500;

const CSS = `
.ss-layer { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; }
.ss-in-fade { animation: ss-fade-in ${ANIM_MS}ms ease both; }
.ss-out-fade { animation: ss-fade-out ${ANIM_MS}ms ease both; }
.ss-in-push-f { animation: ss-push-in-f ${ANIM_MS}ms ease both; } .ss-out-push-f { animation: ss-push-out-f ${ANIM_MS}ms ease both; }
.ss-in-push-b { animation: ss-push-in-b ${ANIM_MS}ms ease both; } .ss-out-push-b { animation: ss-push-out-b ${ANIM_MS}ms ease both; }
.ss-in-wipe-f { animation: ss-wipe-f ${ANIM_MS}ms ease both; } .ss-in-wipe-b { animation: ss-wipe-b ${ANIM_MS}ms ease both; }
.ss-in-zoom { animation: ss-zoom-in ${ANIM_MS}ms ease both; } .ss-out-zoom { animation: ss-fade-out ${ANIM_MS}ms ease both; }
@keyframes ss-fade-in { from { opacity:0 } to { opacity:1 } }
@keyframes ss-fade-out { from { opacity:1 } to { opacity:0 } }
@keyframes ss-push-in-f { from { transform:translateX(100%) } to { transform:none } }
@keyframes ss-push-out-f { from { transform:none } to { transform:translateX(-100%) } }
@keyframes ss-push-in-b { from { transform:translateX(-100%) } to { transform:none } }
@keyframes ss-push-out-b { from { transform:none } to { transform:translateX(100%) } }
@keyframes ss-wipe-f { from { clip-path:inset(0 100% 0 0) } to { clip-path:inset(0 0 0 0) } }
@keyframes ss-wipe-b { from { clip-path:inset(0 0 0 100%) } to { clip-path:inset(0 0 0 0) } }
@keyframes ss-zoom-in { from { transform:scale(.6); opacity:0 } to { transform:none; opacity:1 } }
`;

const inClass = (t, dir) => ({ fade: 'ss-in-fade', push: `ss-in-push-${dir}`, wipe: `ss-in-wipe-${dir}`, zoom: 'ss-in-zoom' }[t] || '');
const outClass = (t, dir) => ({ fade: 'ss-out-fade', push: `ss-out-push-${dir}`, zoom: 'ss-out-zoom' }[t] || '');

function SlideFrame({ page, w, h, scale }) {
  return (
    <div style={{ width: w * scale, height: h * scale, overflow: 'hidden', boxShadow: '0 10px 40px rgba(0,0,0,0.5)' }}>
      <iframe
        title="Slide"
        srcDoc={page}
        sandbox="allow-same-origin"
        tabIndex={-1}
        style={{ width: w, height: h, border: 0, transform: `scale(${scale})`, transformOrigin: 'top left', pointerEvents: 'none', display: 'block' }}
      />
    </div>
  );
}

export default function Slideshow({ deck, applyBrand, start = 0, onClose, onTransition }) {
  const getIcon = useIcon();
  const panelRef = useRef(null);
  const [pages, setPages] = useState(null);
  const [error, setError] = useState('');
  const [index, setIndex] = useState(start);
  const [prev, setPrev] = useState(null); // { index, dir } while the last slide animates out
  const [dir, setDir] = useState('f');
  const [digits, setDigits] = useState('');
  const [box, setBox] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [controls, setControls] = useState(true);
  const [isFull, setIsFull] = useState(false);
  const idleTimer = useRef(null);
  const leavingByButton = useRef(false);
  const transition = deck.transition || 'fade';
  const [w, h] = SIZES[deck.aspect] || SIZES['16:9'];
  const count = pages?.length || deck.slides.length;

  // Build the slides once, from the deck as it is when the show starts.
  useEffect(() => {
    let live = true;
    api.post('/api/presentations/preview', { deck, applyBrand })
      .then((res) => readJson(res, 'Could not build the slideshow.'))
      .then((data) => { if (live) setPages(slidePages(data.html, (x) => new DOMParser().parseFromString(x, 'text/html'))); })
      .catch((err) => { if (live) setError(err.message || 'Could not build the slideshow.'); });
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Full screen on open; leaving full screen with Escape ends the show, like PowerPoint.
  useEffect(() => {
    const el = panelRef.current;
    if (el?.requestFullscreen) el.requestFullscreen().catch(() => {});
    const onChange = () => {
      const full = Boolean(document.fullscreenElement);
      setIsFull(full);
      if (!full && !leavingByButton.current) onClose();
      leavingByButton.current = false;
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onResize = () => setBox({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const goTo = useCallback((next) => {
    setIndex((cur) => {
      const target = Math.max(0, Math.min(count - 1, next));
      if (target === cur) return cur;
      const d = target > cur ? 'f' : 'b';
      setDir(d);
      if (transition !== 'none') setPrev({ index: cur, dir: d });
      return target;
    });
  }, [count, transition]);

  useEffect(() => {
    if (!prev) return undefined;
    const t = setTimeout(() => setPrev(null), ANIM_MS);
    return () => clearTimeout(t);
  }, [prev]);

  const wake = useCallback(() => {
    setControls(true);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setControls(false), IDLE_MS);
  }, []);
  useEffect(() => { wake(); return () => clearTimeout(idleTimer.current); }, [wake]);

  // Keyboard. Escape is left to the dialog (and to the browser in full screen); a focused select keeps its own arrow keys.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' || e.defaultPrevented) return;
      const tag = e.target?.tagName;
      if (tag === 'SELECT' || ((e.key === ' ' || e.key === 'Enter') && tag === 'BUTTON')) return;
      const step = keyStep(e.key, { index, count, digits });
      if (step.index === index && step.digits === digits) return;
      e.preventDefault();
      setDigits(step.digits);
      if (step.index !== index) goTo(step.index);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, count, digits, goTo]);

  const toggleFull = () => {
    if (document.fullscreenElement) { leavingByButton.current = true; document.exitFullscreen().catch(() => {}); } else panelRef.current?.requestFullscreen?.().catch(() => {});
  };

  const scale = fitScale(w, h, box.w, box.h - (controls ? 64 : 0));
  const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-opacity duration-200 hover:opacity-70 disabled:opacity-30';
  const btnStyle = { color: '#fff', background: 'rgba(255,255,255,0.12)' };
  const selStyle = { color: '#fff', background: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.25)' };

  return (
    <Dialog
      raw
      onClose={onClose}
      label={`Slideshow: ${deck.title || 'deck'}`}
      panelRef={panelRef}
      overlayClassName="fixed inset-0 z-[9000]"
      overlayStyle={{ background: '#000' }}
      panelClassName="relative w-full h-full"
      panelStyle={{ background: '#000', cursor: controls ? 'default' : 'none' }}
      onMouseMove={wake}
    >
      <style>{CSS}</style>
      <div className="absolute inset-x-0 top-0" style={{ bottom: controls ? 64 : 0 }} onClick={() => goTo(index + 1)} role="presentation">
        {error && <p className="absolute inset-0 flex items-center justify-center text-sm" style={{ color: '#fca5a5' }}>{error}</p>}
        {!pages && !error && <p className="absolute inset-0 flex items-center justify-center text-sm" style={{ color: 'rgba(255,255,255,0.7)' }}>Building the slideshow…</p>}
        {pages && prev && pages[prev.index] && (
          <div key={`out-${prev.index}`} className={`ss-layer ${outClass(transition, prev.dir)}`}>
            <SlideFrame page={pages[prev.index]} w={w} h={h} scale={scale} />
          </div>
        )}
        {pages && pages[index] && (
          <div key={`in-${index}`} className={`ss-layer ${prev ? inClass(transition, dir) : ''}`}>
            <SlideFrame page={pages[index]} w={w} h={h} scale={scale} />
          </div>
        )}
        {digits && (
          <span className="absolute top-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded-lg text-sm" style={{ background: 'rgba(0,0,0,0.7)', color: '#fff' }} aria-live="polite">
            Go to slide {digits}… press Enter
          </span>
        )}
      </div>

      <div
        className="absolute inset-x-0 bottom-0 h-16 px-4 flex flex-wrap items-center justify-center gap-2 transition-opacity duration-200"
        style={{ background: 'rgba(0,0,0,0.85)', opacity: controls ? 1 : 0 }}
        onFocus={wake}
      >
        <Tooltip text="Previous slide (← or Page Up).">
          <button type="button" onClick={() => goTo(index - 1)} disabled={index === 0} aria-label="Previous slide" className={btn} style={btnStyle}>
            {getIcon('chevron-left', { size: 16 })}
          </button>
        </Tooltip>
        <Tooltip text="Go to a slide. You can also type its number and press Enter.">
          <select value={index} onChange={(e) => goTo(Number(e.target.value))} aria-label="Go to slide" className="px-3 py-1.5 rounded-lg border text-sm max-w-[16rem]" style={selStyle}>
            {Array.from({ length: count }, (_, i) => (
              <option key={i} value={i} style={{ color: '#000' }}>{i + 1}. {deck.slides[i]?.title || `Slide ${i + 1}`}</option>
            ))}
          </select>
        </Tooltip>
        <span className="text-sm tabular-nums" style={{ color: 'rgba(255,255,255,0.75)' }}>{index + 1} / {count}</span>
        <Tooltip text="Next slide (→, Space or Page Down). Clicking the slide also goes forward.">
          <button type="button" onClick={() => goTo(index + 1)} disabled={index >= count - 1} aria-label="Next slide" className={btn} style={btnStyle}>
            {getIcon('chevron-right', { size: 16 })}
          </button>
        </Tooltip>
        <span className="w-px h-6 mx-1" style={{ background: 'rgba(255,255,255,0.25)' }} />
        <Tooltip text="How the show moves between slides. Saved with the deck.">
          <select value={transition} onChange={(e) => onTransition(e.target.value)} aria-label="Transition" className="px-3 py-1.5 rounded-lg border text-sm" style={selStyle}>
            {TRANSITIONS.map((t) => <option key={t.id} value={t.id} style={{ color: '#000' }}>{t.label}</option>)}
          </select>
        </Tooltip>
        <Tooltip text={isFull ? 'Leave full screen but keep the slideshow open.' : 'Fill the whole screen.'}>
          <button type="button" onClick={toggleFull} aria-label={isFull ? 'Leave full screen' : 'Full screen'} className={btn} style={btnStyle}>
            {getIcon(isFull ? 'minimize-2' : 'maximize-2', { size: 16 })}
          </button>
        </Tooltip>
        <Tooltip text="End the slideshow (Escape).">
          <button type="button" onClick={onClose} className={btn} style={btnStyle}>
            {getIcon('x', { size: 16 })} End show
          </button>
        </Tooltip>
      </div>
    </Dialog>
  );
}
