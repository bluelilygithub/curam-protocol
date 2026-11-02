import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Tooltip from '../components/Tooltip';
import ChordDiagram from './guitar/ChordDiagram';
import { GlossaryTerm } from './guitar/GlossaryTerm';
import { GT, ADD_TIPS, tabTip } from './guitar/guitarTips.mjs';
import api from '../utils/apiClient';
import useToastStore from '../store/toastStore';
import Dialog from '../components/Dialog';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import { useIcon } from '../providers/IconProvider';
import GuitarTutorChat from './guitar/GuitarTutorChat';
import { HOW_IT_WORKS, GUITAR_TOOLS, GUIDE_TOOLS } from './guitar/guitarTools.mjs';
import { startGuitarTour, TOUR_KEY as GUITAR_TOUR_KEY } from '../utils/tours/guitarTour';
import { useSearchParams } from 'react-router-dom';
import TempoTrainer from './guitar/TempoTrainer';
import { snapRate, songTimeAfter } from './guitar/trainerRules.mjs';
import TheoryPanel, { KIND_STYLE } from './guitar/TheoryPanel';
import SimplifyPanel from './guitar/SimplifyPanel';
import { simplifySong, thinChanges } from './guitar/simplify.mjs';
import TransitionDrills from './guitar/TransitionDrills';
import CoachView from './guitar/CoachView';
import LearnView from './guitar/LearnView';
import EarTraining from './guitar/EarTraining';
import StrumTrainer from './guitar/StrumTrainer';
import { GentleTips, MilestonesCard } from './guitar/ProgressCards';
import GigMode from './guitar/GigMode';
import SetLists from './guitar/SetLists';
import ExplainDialog from './guitar/ExplainDialog';
import { analyseSong, shapeAtCapo } from './guitar/theory.mjs';
import { playChordSound, audioContextFrom } from './guitar/chordSound.js';

// ── Music theory constants ────────────────────────────────────────────────────
const ROOTS = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
const NOTE_TO_SEMI = { C:0,'C#':1,Db:1,D:2,Eb:3,'D#':3,E:4,F:5,'F#':6,Gb:6,G:7,Ab:8,'G#':8,A:9,Bb:10,'A#':10,B:11 };
const QUALITY_LABELS = { '': '', 'm': 'm', '7': '7', 'maj7': 'maj7', 'm7': 'm7',
  'dim': 'dim', 'aug': '+', 'sus2': 'sus2', 'sus4': 'sus4', 'dim7': 'dim7', 'm7b5': 'ø' };

function normalizeRoot(root) {
  if (!root) return 'C';
  const r = root.trim();
  // Prefer sharp/flat names we use in ROOTS
  const map = { 'Db':'C#', 'D#':'Eb', 'Gb':'F#', 'G#':'Ab', 'A#':'Bb' };
  return map[r] || r;
}

function transposeRoot(root, semitones) {
  const n = normalizeRoot(root);
  const idx = ROOTS.indexOf(n);
  if (idx === -1) return root;
  return ROOTS[((idx + semitones) % 12 + 12) % 12];
}

/** Chart display: transpose only. Capo is a fingering instruction — it must not rewrite chord names. */
function displayChord(root, quality, transposeOffset = 0) {
  const displayRoot = transposeRoot(root, transposeOffset);
  const q = QUALITY_LABELS[quality] ?? quality;
  return displayRoot + q;
}

function chordLabel(root, quality) {
  return normalizeRoot(root) + (quality || '');
}

/**
 * Generate playable open + barre voicings along the neck (UG-style).
 * fretPositions: [lowE, A, D, G, B, highE]  -1=mute, 0=open, N=fret
 */
function generateVoicings(root, quality = '') {
  const r = NOTE_TO_SEMI[normalizeRoot(root)];
  if (r == null) return [];
  const q = quality || '';
  const shapes = [];

  // Open shapes keyed by chord name (concert pitch)
  const OPEN = {
    C:  { fret: [-1,3,2,0,1,0], finger: [0,3,2,0,1,0] },
    D:  { fret: [-1,-1,0,2,3,2], finger: [0,0,0,1,3,2] },
    E:  { fret: [0,2,2,1,0,0], finger: [0,2,3,1,0,0] },
    G:  { fret: [3,2,0,0,0,3], finger: [2,1,0,0,0,3] },
    A:  { fret: [-1,0,2,2,2,0], finger: [0,0,1,2,3,0] },
    Am: { fret: [-1,0,2,2,1,0], finger: [0,0,2,3,1,0] },
    Dm: { fret: [-1,-1,0,2,3,1], finger: [0,0,0,2,3,1] },
    Em: { fret: [0,2,2,0,0,0], finger: [0,1,2,0,0,0] },
    F:  { fret: [1,3,3,2,1,1], finger: [1,3,4,2,1,1] },
    B:  { fret: [-1,2,4,4,4,2], finger: [0,1,2,3,4,1] },
    Bm: { fret: [-1,2,4,4,3,2], finger: [0,1,3,4,2,1] },
    E7: { fret: [0,2,0,1,0,0], finger: [0,2,0,1,0,0] },
    A7: { fret: [-1,0,2,0,2,0], finger: [0,0,1,0,2,0] },
    D7: { fret: [-1,-1,0,2,1,2], finger: [0,0,0,2,1,3] },
    G7: { fret: [3,2,0,0,0,1], finger: [3,2,0,0,0,1] },
    C7: { fret: [-1,3,2,3,1,0], finger: [0,2,1,3,4,0] },
  };

  const name = chordLabel(root, q);
  if (OPEN[name]) {
    shapes.push({
      id: `${name}-open`,
      voicingType: 'open',
      label: 'Open',
      fretPositions: OPEN[name].fret,
      fingerPositions: OPEN[name].finger,
      baseFret: 1,
    });
  }

  // E-shape movable barre (root on low E). F major at fret 1 → rootFret = r - 5 (E=4) wait
  // At fret n, low-E string notes (n % 12). Open E = 4. So root at fret ((r - 4 + 12) % 12) or +12.
  const eRootFret = ((r - 4) + 12) % 12;
  const eFrets = eRootFret === 0 ? [12] : [eRootFret];
  if (eRootFret !== 0) eFrets.push(eRootFret + 12);
  else eFrets.push(12);

  for (const n of eFrets) {
    if (n < 1 || n > 12) continue;
    let frets, fingers, type;
    if (q === '' || q === 'maj') {
      frets = [n, n+2, n+2, n+1, n, n];
      fingers = [1, 3, 4, 2, 1, 1];
      type = 'E-shape barre';
    } else if (q === 'm') {
      frets = [n, n+2, n+2, n, n, n];
      fingers = [1, 3, 4, 1, 1, 1];
      type = 'Em-shape barre';
    } else if (q === '7') {
      frets = [n, n+2, n, n+1, n, n];
      fingers = [1, 3, 1, 2, 1, 1];
      type = 'E7-shape barre';
    } else if (q === 'm7') {
      frets = [n, n+2, n, n, n, n];
      fingers = [1, 3, 1, 1, 1, 1];
      type = 'Em7-shape barre';
    } else if (q === 'maj7') {
      frets = [n, n+2, n+2, n+1, n, n+2];
      fingers = [1, 3, 4, 2, 1, 4];
      type = 'Emaj7 barre';
    } else if (q === 'sus4') {
      frets = [n, n+2, n+2, n+2, n, n];
      fingers = [1, 2, 3, 4, 1, 1];
      type = 'Esus4 barre';
    } else if (q === 'sus2') {
      frets = [n, n+2, n+2, n, n, n]; // approx Em shape for sus2 isn't ideal; use add9-ish
      fingers = [1, 3, 4, 1, 1, 1];
      type = 'Esus2-ish';
    } else {
      // Fallback: major barre
      frets = [n, n+2, n+2, n+1, n, n];
      fingers = [1, 3, 4, 2, 1, 1];
      type = 'E-shape';
    }
    shapes.push({
      id: `${name}-e-${n}`,
      voicingType: type,
      label: `Fret ${n}`,
      fretPositions: frets,
      fingerPositions: fingers,
      baseFret: n,
    });
  }

  // A-shape movable barre (root on A string). Open A = 9.
  const aRootFret = ((r - 9) + 12) % 12;
  const aFrets = aRootFret === 0 ? [12] : [aRootFret];
  if (aRootFret > 0 && aRootFret + 12 <= 12) aFrets.push(aRootFret + 12);
  else if (aRootFret === 0) { /* only 12 */ }
  else if (aRootFret + 12 <= 14) aFrets.push(Math.min(aRootFret + 12, 12));

  for (const n of aFrets) {
    if (n < 1 || n > 12) continue;
    // Skip if we already have an identical open shape at this fret for well-known opens
    let frets, fingers, type;
    if (q === '' || q === 'maj') {
      frets = [-1, n, n+2, n+2, n+2, n];
      fingers = [0, 1, 2, 3, 4, 1];
      type = 'A-shape barre';
    } else if (q === 'm') {
      frets = [-1, n, n+2, n+2, n+1, n];
      fingers = [0, 1, 3, 4, 2, 1];
      type = 'Am-shape barre';
    } else if (q === '7') {
      frets = [-1, n, n+2, n, n+2, n];
      fingers = [0, 1, 3, 1, 4, 1];
      type = 'A7-shape barre';
    } else if (q === 'm7') {
      frets = [-1, n, n+2, n, n+1, n];
      fingers = [0, 1, 3, 1, 2, 1];
      type = 'Am7-shape barre';
    } else {
      frets = [-1, n, n+2, n+2, n+2, n];
      fingers = [0, 1, 2, 3, 4, 1];
      type = 'A-shape';
    }
    shapes.push({
      id: `${name}-a-${n}`,
      voicingType: type,
      label: `Fret ${n}`,
      fretPositions: frets,
      fingerPositions: fingers,
      baseFret: n,
    });
  }

  // Deduplicate by fret pattern string
  const seen = new Set();
  return shapes.filter(s => {
    const key = s.fretPositions.join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Chord shape SVG diagram ───────────────────────────────────────────────────
/** UG-style voicing browser: open + barre shapes along the neck */
function VoicingBrowser({ chordRoot, chordQuality, transposeOffset = 0 }) {
  const displayRoot = transposeRoot(chordRoot, transposeOffset);
  const voicings = useMemo(
    () => generateVoicings(displayRoot, chordQuality || ''),
    [displayRoot, chordQuality]
  );
  const [idx, setIdx] = useState(0);

  useEffect(() => { setIdx(0); }, [displayRoot, chordQuality]);

  if (!voicings.length) {
    return <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No shapes for this chord.</p>;
  }

  const shape = voicings[Math.min(idx, voicings.length - 1)];
  const label = displayChord(chordRoot, chordQuality || '', transposeOffset);

  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-2">
        <span className="text-sm font-bold font-mono" style={{ color: 'var(--color-text)' }}>{label}</span>
        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
          {idx + 1} / {voicings.length}
        </span>
      </div>
      <div className="flex items-center justify-center gap-2 mb-2">
        <Tooltip text={GT.prevShape}>
          <button type="button" disabled={idx <= 0} onClick={() => setIdx(i => i - 1)}
            className="text-xs px-2 py-1 rounded border disabled:opacity-30"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>‹</button>
        </Tooltip>
        <div className="flex flex-col items-center">
          <ChordDiagram shape={shape} />
          <span className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
            {shape.voicingType}{shape.baseFret > 1 ? ` · ${shape.label}` : ''}
          </span>
        </div>
        <Tooltip text={GT.nextShape}>
          <button type="button" disabled={idx >= voicings.length - 1} onClick={() => setIdx(i => i + 1)}
            className="text-xs px-2 py-1 rounded border disabled:opacity-30"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>›</button>
        </Tooltip>
      </div>
      <div className="flex flex-wrap gap-1 justify-center">
        {voicings.map((v, i) => (
          <Tooltip text={GT.pickShape} key={v.id}>
            <button type="button" onClick={() => setIdx(i)}
              className="text-xs px-1.5 py-0.5 rounded border"
              style={{
                borderColor: i === idx ? 'var(--color-primary)' : 'var(--color-border)',
                background: i === idx ? 'rgba(37,99,235,0.1)' : 'transparent',
                color: i === idx ? 'var(--color-primary)' : 'var(--color-muted)',
                fontWeight: i === idx ? 600 : 400,
              }}>
              {v.baseFret === 1 && v.voicingType === 'open' ? 'open' : `fr${v.baseFret}`}
            </button>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

// ── YouTube player wrapper ────────────────────────────────────────────────────
function YouTubePlayer({ videoId, onReady, playerRef }) {
  const containerRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!videoId) return;
    let player;

    const initPlayer = () => {
      if (!containerRef.current) return;
      player = new window.YT.Player(containerRef.current, {
        videoId,
        height: '100%',
        width: '100%',
        playerVars: { controls: 1, modestbranding: 1, rel: 0 },
        events: {
          onReady: () => {
            playerRef.current = player;
            setReady(true);
            onReady?.(player);
          },
        },
      });
    };

    if (window.YT?.Player) {
      initPlayer();
    } else {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
      window.onYouTubeIframeAPIReady = initPlayer;
    }

    return () => {
      if (player?.destroy) player.destroy();
      playerRef.current = null;
    };
  }, [videoId]);

  return (
    <div style={{ position: 'relative', paddingBottom: '56.25%', background: '#000', borderRadius: 8, overflow: 'hidden' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
    </div>
  );
}

// ── HTML5 audio player (upload / offline path) ────────────────────────────────
function HtmlAudioPlayer({ songId, onReady, playerRef }) {
  const audioRef = useRef(null);
  const [src, setSrc] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let objectUrl = null;
    let cancelled = false;
    setErr(null);
    setSrc(null);
    (async () => {
      try {
        const res = await api.get(`/api/guitar/songs/${songId}/audio`);
        if (!res.ok) throw new Error('Audio not available');
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      } catch (e) {
        if (!cancelled) setErr(e.message);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      playerRef.current = null;
    };
  }, [songId]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !src) return;
    const shim = {
      getCurrentTime: () => el.currentTime || 0,
      seekTo: (t) => { el.currentTime = t; },
      // Same names as the YouTube player so the tempo trainer has one code path
      playVideo: () => { el.play().catch(() => {}); },
      pauseVideo: () => { el.pause(); },
      setPlaybackRate: (r) => {
        el.preservesPitch = true; el.mozPreservesPitch = true; el.webkitPreservesPitch = true; // slower without a lower voice
        el.playbackRate = r;
      },
      getPlaybackRate: () => el.playbackRate,
    };
    playerRef.current = shim;
    onReady?.(shim);
  }, [src]);

  if (err) {
    return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No playable audio for this song.</p>;
  }
  if (!src) {
    return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading audio…</p>;
  }
  return (
    <audio ref={audioRef} src={src} controls className="w-full"
      style={{ borderRadius: 8, background: 'var(--color-surface)' }} />
  );
}

// ── Chord correction modal ────────────────────────────────────────────────────
function CorrectionModal({ event, onSave, onClose }) {
  const [root, setRoot]     = useState(event.chordRoot);
  const [quality, setQuality] = useState(event.chordQuality || '');
  const [section, setSection] = useState(event.sectionName || '');
  const addToast = useToastStore(s => s.addToast);

  const save = async () => {
    try {
      const res  = await api.patch(`/api/guitar/songs/${event.songId}/chords/${event.id}`,
        { chordRoot: root, chordQuality: quality, sectionName: section || null });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onSave(data);
    } catch (e) { addToast(e.message, 'error'); }
  };

  return (
    <Dialog raw onClose={onClose}
        overlayClassName="fixed inset-0 z-50 flex items-center justify-center px-4"
        overlayStyle={{ background: 'rgba(0,0,0,0.5)' }}
        panelClassName="w-full max-w-sm rounded-xl p-5 flex flex-col gap-4"
        panelStyle={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
          Correct chord at {Number(event.timestampSec).toFixed(1)}s
        </h3>
        <div className="flex gap-2">
          <select value={root} onChange={e => setRoot(e.target.value)}
            className="flex-1 text-sm px-3 py-2 rounded-lg border"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }}>
            {ROOTS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={quality} onChange={e => setQuality(e.target.value)}
            className="flex-1 text-sm px-3 py-2 rounded-lg border"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }}>
            {Object.entries(QUALITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v || 'maj'}</option>)}
          </select>
        </div>
        <input value={section} onChange={e => setSection(e.target.value)}
          placeholder="Section label (Verse, Chorus…)" className="text-sm px-3 py-2 rounded-lg border"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }} />
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="text-sm px-3 py-1.5 rounded-lg border"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Cancel</button>
          <button onClick={save} className="text-sm px-3 py-1.5 rounded-lg font-medium"
            style={{ background: 'var(--color-primary)', color: '#fff' }}>Save</button>
        </div>
      </Dialog>
  );
}

// ── Chord shape popover ───────────────────────────────────────────────────────
function ShapePopover({ chord, anchorRef, onClose }) {
  const [shapes, setShapes] = useState([]);
  const ref = useRef(null);

  useEffect(() => {
    if (!chord) return;
    api.get(`/api/guitar/chord-shapes/${encodeURIComponent(chord)}`)
      .then(r => r.json()).then(setShapes).catch(() => setShapes([]));
  }, [chord]);

  useEffect(() => {
    const fn = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [onClose]);

  return (
    <div ref={ref} className="absolute z-40 rounded-xl shadow-xl p-3 min-w-max"
      style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)',
               top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: 4 }}>
      <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text)' }}>{chord}</p>
      {shapes.length === 0
        ? <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No shapes found</p>
        : <div className="flex gap-3 flex-wrap">
            {shapes.map(s => (
              <div key={s.id} className="flex flex-col items-center gap-1">
                <ChordDiagram shape={s} />
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{s.voicingType}</span>
              </div>
            ))}
          </div>
      }
    </div>
  );
}

const PRACTICE_STATES = {
  learning:  { label: 'Learning',  color: '#2563eb', bg: 'rgba(37,99,235,0.1)' },
  polishing: { label: 'Polishing', color: '#b45309', bg: 'rgba(245,158,11,0.15)' },
  ready:     { label: 'Ready',     color: '#16a34a', bg: 'rgba(22,163,74,0.1)' },
  rusty:     { label: 'Rusty',     color: '#dc2626', bg: 'rgba(220,38,38,0.1)' },
};

function PracticeBadge({ state }) {
  const s = PRACTICE_STATES[state] || PRACTICE_STATES.learning;
  return <span className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0" style={{ color: s.color, background: s.bg }}>{s.label}</span>;
}

/** One-tap "I played this", with optional minutes, a 1-5 confidence score and a note. */
function PracticeDialog({ song, loop, onClose, onSaved }) {
  const [minutes, setMinutes] = useState('');
  const [confidence, setConfidence] = useState(0);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const addToast = useToastStore(s => s.addToast);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await api.post('/api/guitar/practice', {
        songId: song.id, loopId: loop?.id ?? null,
        minutes: minutes === '' ? null : parseInt(minutes, 10),
        confidence: confidence || null, note: note.trim() || null,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      addToast(`Logged "${song.title}"`, 'success');
      onSaved?.(data);
      onClose();
    } catch (e) { addToast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const field = { background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' };
  return (
    <Dialog title="I played this" size="sm" onClose={onClose}
      footer={
        <button onClick={save} disabled={saving}
          className="px-4 py-2 text-sm rounded-lg font-medium disabled:opacity-40 hover:opacity-70 transition-opacity duration-200"
          style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      }>
      <div className="p-5 flex flex-col gap-4">
        <p className="text-sm" style={{ color: 'var(--color-text)' }}>
          {song.title}{loop ? ` · ${loop.name}` : ''}
        </p>
        <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--color-muted)' }}>
          Minutes (optional)
          <input type="number" min="0" max="600" value={minutes} onChange={e => setMinutes(e.target.value)}
            className="text-sm px-3 py-2 rounded-lg border" style={field} />
        </label>
        <div className="flex flex-col gap-1 text-xs" style={{ color: 'var(--color-muted)' }}>
          How clean was it? (optional)
          <div className="flex gap-1" role="radiogroup" aria-label="Confidence from 1 to 5">
            {[1, 2, 3, 4, 5].map(n => (
              <button key={n} type="button" role="radio" aria-checked={confidence === n}
                onClick={() => setConfidence(confidence === n ? 0 : n)}
                className="w-9 h-9 rounded-lg border text-sm font-medium hover:opacity-70 transition-opacity duration-200"
                style={{ borderColor: confidence === n ? 'var(--color-primary)' : 'var(--color-border)',
                         background: confidence === n ? 'var(--color-primary)' : 'var(--color-surface)',
                         color: confidence === n ? 'var(--color-on-primary, #fff)' : 'var(--color-text)' }}>{n}</button>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--color-muted)' }}>
          Note (optional)
          <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} maxLength={1000}
            placeholder="e.g. F barre still buzzing"
            className="text-sm px-3 py-2 rounded-lg border resize-none" style={field} />
        </label>
      </div>
    </Dialog>
  );
}

/** Today: "I have 20 minutes, what should I do?" */
function TodayView({ songs, onOpenSong, onPlayed, onStartDrill, refreshKey }) {
  const [queue, setQueue] = useState(null);
  const [logging, setLogging] = useState(null); // { song, loop }
  const [saved, setSaved] = useState(0);         // bumped when a practice is logged, so the milestones and tips look again

  const load = useCallback(() => {
    api.get('/api/guitar/practice/queue').then(r => r.json()).then(d => setQueue(d))
      .catch(() => setQueue({ items: [], week: { sessions: 0, minutes: 0 } }));
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  if (!queue) return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>;
  const songOf = (id) => songs.find(s => s.id === id);
  const KIND = { learning: 'Learn', loop: 'Work up a loop', rusty: 'Revive', polishing: 'Polish', transition: 'Chord change drill' };

  return (
    <div className="flex flex-col gap-4">
      <GentleTips refreshKey={`${refreshKey}-${saved}`} />
      <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
        This week: {queue.week.sessions} {queue.week.sessions === 1 ? 'session' : 'sessions'}
        {queue.week.minutes ? `, ${queue.week.minutes} min logged` : ''}.
      </p>
      {queue.items.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          Nothing due. Songs you are learning, polishing or letting go rusty will show up here. Set a song's status in the Library tab.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {queue.items.map((it, i) => {
            const song = songOf(it.songId);
            return (
              <div key={`${it.kind}-${it.songId}-${i}`} className="rounded-xl border p-4 flex items-center gap-3 flex-wrap"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>{KIND[it.kind]}</p>
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
                    {it.title}{it.loopName ? ` · ${it.loopName}` : ''}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    {it.reason}{it.daysIdle != null ? ` · last played ${it.daysIdle === 0 ? 'today' : `${it.daysIdle}d ago`}` : ''}
                  </p>
                </div>
                {it.kind === 'transition' ? (
                  <Tooltip text={GT.startDrill}>
                    <button onClick={() => onStartDrill({ a: it.a, b: it.b })}
                      className="text-xs px-3 py-1.5 rounded-lg font-medium hover:opacity-70 transition-opacity duration-200"
                      style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}>Start drill</button>
                  </Tooltip>
                ) : (
                  <>
                    <PracticeBadge state={it.state} />
                    {song && (
                      <Tooltip text={GT.openSong}>
                        <button onClick={() => onOpenSong(song)}
                          className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-70 transition-opacity duration-200"
                          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Open</button>
                      </Tooltip>
                    )}
                    <Tooltip text={GT.played}>
                      <button onClick={() => setLogging({ song: { id: it.songId, title: it.title }, loop: it.loopId ? { id: it.loopId, name: it.loopName } : null })}
                        className="text-xs px-3 py-1.5 rounded-lg font-medium hover:opacity-70 transition-opacity duration-200"
                        style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}>I played this</button>
                    </Tooltip>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
      <MilestonesCard refreshKey={`${refreshKey}-${saved}`} onTipsChange={() => setSaved(n => n + 1)} />
      {logging && <PracticeDialog song={logging.song} loop={logging.loop} onClose={() => setLogging(null)} onSaved={() => { load(); setSaved(n => n + 1); onPlayed?.(); }} />}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
const TABS = ['Today', 'Learn', 'Coach', 'Drills', 'Ear', 'Strum', 'Library', 'Player'];

export default function GuitarPage() {
  const getIcon = useIcon();
  const info = useToolInfoModal('vault_guitar_info_seen');
  const [params, setParams] = useSearchParams();
  const [tab, setTab]           = useState('Today');
  const [practiceDialog, setPracticeDialog] = useState(null); // song being logged from Library / Player
  const [practiceTick, setPracticeTick]     = useState(0);
  const [songs, setSongs]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [urlInput, setUrlInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [activeSong, setActiveSong] = useState(null);
  const [chords, setChords]     = useState([]);
  const [loadingChords, setLoadingChords] = useState(false);
  const [transpose, setTranspose] = useState(0);
  const [capoFret, setCapoFret] = useState(0);
  const [autoScroll, setAutoScroll] = useState(false);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [activeChordIdx, setActiveChordIdx] = useState(-1);
  const [correcting, setCorrecting] = useState(null);
  const [shapesFor, setShapesFor] = useState(null);
  const [loops, setLoops]         = useState([]);
  const [loopActive, setLoopActive] = useState(null);
  const [loopPasses, setLoopPasses] = useState(0); // times the active loop has come round
  const rateRef = useRef(1);                       // playback speed, 1 = normal; song time moves at this rate
  const [easyMode, setEasyMode]         = useState('off');  // 'off' | 'exact' | 'easier': the chart shows the shapes to finger
  const [easyFewer, setEasyFewer]       = useState(false);  // dim chords that change too fast (songs detected from audio)
  const prevCapo = useRef(0);                                  // the capo to go back to when Make it easier is turned off
  const [gig, setGig] = useState(null);                 // { queue, startIndex } while play mode is open
  const [explaining, setExplaining] = useState(null);   // { song, analysis } while the Explain this song window is open
  const [drillPair, setDrillPair]       = useState(null);   // { a, b } chord pair opened from Today
  const [keyChoice, setKeyChoice]       = useState('auto'); // 'auto' or 'Root|mode'
  const [showNumerals, setShowNumerals] = useState(true);
  const [showShapes, setShowShapes]     = useState(true);
  const [loopName, setLoopName]   = useState('');
  const [fretboardChord, setFretboardChord] = useState(null);
  const playerRef   = useRef(null);
  const chartRef    = useRef(null);
  const rafRef      = useRef(null);
  const localTimer  = useRef(null);
  const localBase   = useRef(0);
  const pollRef     = useRef(null);
  const audioCtxRef = useRef(null);
  const addToast    = useToastStore(s => s.addToast);

  const playChordAudio = useCallback((root, quality) => {
    try { playChordSound(audioContextFrom(audioCtxRef), root, quality); } catch (_) { /* audio not available */ }
  }, []);

  const [addMode, setAddMode]               = useState('ug'); // ug | upload | manual
  const [ugUrl, setUgUrl]                   = useState('');
  const [uploadFile, setUploadFile]         = useState(null);
  const [uploadTitle, setUploadTitle]       = useState('');
  const [uploadArtist, setUploadArtist]     = useState('');
  const [uploadYtUrl, setUploadYtUrl]       = useState('');
  const [manualTitle, setManualTitle]       = useState('');
  const [manualArtist, setManualArtist]     = useState('');
  const [manualYtUrl, setManualYtUrl]       = useState('');
  const [addingChord, setAddingChord]       = useState(false);

  const loadSongs = useCallback(() => {
    setLoading(true);
    api.get('/api/guitar/songs').then(r => r.json()).then(d => {
      setSongs(Array.isArray(d) ? d : []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadSongs(); }, [loadSongs]);

  const setLearnStatus = async (song, learnStatus) => {
    setSongs(list => list.map(x => x.id === song.id ? { ...x, learnStatus } : x));
    try {
      const res = await api.patch(`/api/guitar/library/${song.id}`, { learnStatus });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSongs(list => list.map(x => x.id === song.id ? { ...x, learnStatus: data.learnStatus, practiceState: data.practiceState } : x));
      setPracticeTick(t => t + 1);
    } catch (e) { addToast(e.message, 'error'); loadSongs(); }
  };

  const submitUg = async () => {
    if (!ugUrl.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res  = await api.post('/api/guitar/songs/ug', { ugUrl: ugUrl.trim() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUgUrl('');
      loadSongs();
      addToast(`Imported "${data.title}" — ${data.chordCount} chords ready`, 'success');
    } catch (e) { addToast(e.message, 'error'); }
    finally { setSubmitting(false); }
  };

  const submitUpload = async () => {
    if (!uploadFile || submitting) return;
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('audio', uploadFile);
      if (uploadTitle.trim()) fd.append('title', uploadTitle.trim());
      if (uploadArtist.trim()) fd.append('artist', uploadArtist.trim());
      if (uploadYtUrl.trim()) fd.append('youtubeUrl', uploadYtUrl.trim());
      const res = await api.postForm('/api/guitar/songs/upload', fd);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUploadFile(null);
      setUploadTitle('');
      setUploadArtist('');
      setUploadYtUrl('');
      loadSongs();
      addToast('Upload received — detecting chords…', 'success');
    } catch (e) { addToast(e.message, 'error'); }
    finally { setSubmitting(false); }
  };

  const submitManual = async () => {
    if (!manualTitle.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await api.post('/api/guitar/songs/manual', {
        title: manualTitle.trim(),
        artist: manualArtist.trim() || null,
        youtubeUrl: manualYtUrl.trim() || null,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setManualTitle('');
      setManualArtist('');
      setManualYtUrl('');
      loadSongs();
      addToast('Blank chart created — open it from the list and add chords', 'success');
    } catch (e) { addToast(e.message, 'error'); }
    finally { setSubmitting(false); }
  };

  // Poll processing songs
  useEffect(() => {
    const processingIds = songs.filter(s => s.status === 'processing' || s.status === 'pending').map(s => s.id);
    if (!processingIds.length) return;
    clearInterval(pollRef.current);
    pollRef.current = setInterval(() => loadSongs(), 5000);
    return () => clearInterval(pollRef.current);
  }, [songs, loadSongs]);

  const openSong = async (song) => {
    setActiveSong(song);
    setTranspose(song.transposeOffset ?? 0);
    setCapoFret(song.capoOverride ?? 0); // Capo does not rewrite chart chord names
    setTab('Player');
    setKeyChoice('auto');
    setEasyMode('off'); setEasyFewer(false);
    setLoopActive(null); // a loop belongs to one song; also puts the speed back to normal
    rateRef.current = 1;
    setLoadingChords(true);
    setChords([]);
    setLoops([]);
    setFretboardChord(null);
    setCurrentTimeSec(0);
    setActiveChordIdx(-1);
    setAutoScroll(false);
    try {
      const [cRes, lRes] = await Promise.all([
        api.get(`/api/guitar/songs/${song.id}/chords`),
        api.get(`/api/guitar/loops/${song.id}`),
      ]);
      const cData = await cRes.json();
      const lData = await lRes.json();
      setChords(Array.isArray(cData) ? cData : []);
      setLoops(Array.isArray(lData) ? lData : []);
    } catch {}
    finally { setLoadingChords(false); }
  };

  const deleteSong = async (id, e) => {
    e.stopPropagation();
    if (!confirm('Remove this song?')) return;
    await api.delete(`/api/guitar/songs/${id}`);
    setSongs(prev => prev.filter(s => s.id !== id));
  };

  // ── Scroll sync engine ─────────────────────────────────────────────────────
  const startRaf = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const tick = () => {
      const player = playerRef.current;
      if (!player) { rafRef.current = null; return; }

      // Reconcile with YT every ~2s; smooth using local timer in between
      const now = performance.now();
      if (!localTimer.current || now - localTimer.current > 2000) {
        try {
          const ytTime = player.getCurrentTime?.();
          if (ytTime != null) { localBase.current = ytTime; localTimer.current = now; }
        } catch {}
      }
      const smoothTime = songTimeAfter(localBase.current, (now - (localTimer.current || now)) / 1000, rateRef.current);
      setCurrentTimeSec(smoothTime);

      // Find active chord
      if (chords.length) {
        let idx = 0;
        for (let i = 0; i < chords.length; i++) {
          if (parseFloat(chords[i].timestampSec) <= smoothTime) idx = i;
          else break;
        }
        setActiveChordIdx(idx);
        const ch = chords[idx];
        if (ch) setFretboardChord({ root: ch.chordRoot, quality: ch.chordQuality || '' });

        // Auto-scroll chart
        if (autoScroll && chartRef.current) {
          const el = chartRef.current.querySelector(`[data-chord-idx="${idx}"]`);
          el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }

      // Loop boundary
      if (loopActive) {
        const { startTimeSec: s, endTimeSec: e } = loopActive;
        if (smoothTime >= parseFloat(e)) {
          try { player.seekTo(parseFloat(s), true); localBase.current = parseFloat(s); localTimer.current = performance.now(); } catch {}
          setLoopPasses(n => n + 1);
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [chords, autoScroll, loopActive]);

  useEffect(() => {
    if (tab === 'Player' && activeSong?.status === 'done' && playerRef.current) startRaf();
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [tab, activeSong, startRaf]);

  const onPlayerReady = () => { startRaf(); };

  // ── Transpose / capo persistence ──────────────────────────────────────────
  const savePrefs = useCallback(async (tp, cp) => {
    if (!activeSong) return;
    await api.patch(`/api/guitar/library/${activeSong.id}`,
      { transposeOffset: tp, capoOverride: cp }).catch(() => {});
  }, [activeSong]);

  const changeTranspose = (v) => {
    setTranspose(v);
    savePrefs(v, capoFret);
  };
  const changeCapo = (v) => {
    setCapoFret(v);
    savePrefs(transpose, v);
  };

  // Key, Roman numerals and the capo suggestion. Numerals do not change when the chart is transposed.
  const theory = useMemo(() => {
    const [name, mode] = keyChoice === 'auto' ? [] : keyChoice.split('|');
    const keyOverride = name ? { tonic: NOTE_TO_SEMI[name], mode } : null;
    return analyseSong({ keyDetected: activeSong?.keyDetected, chords, transpose, keyOverride });
  }, [activeSong?.keyDetected, chords, transpose, keyChoice]);

  // ── Chord correction ───────────────────────────────────────────────────────
  const saveCorrection = (updated) => {
    setChords(prev => prev.map(c => c.id === updated.id ? { ...c, ...updated } : c));
    setCorrecting(null);
  };

  const addChordAtPlayhead = async () => {
    if (!activeSong || addingChord) return;
    setAddingChord(true);
    try {
      let t = currentTimeSec;
      try { t = playerRef.current?.getCurrentTime?.() ?? t; } catch {}
      const res = await api.post(`/api/guitar/songs/${activeSong.id}/chords`, {
        timestampSec: Math.max(0, Number(t.toFixed(2))),
        chordRoot: 'C',
        chordQuality: '',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setChords(prev => [...prev, data].sort((a, b) => parseFloat(a.timestampSec) - parseFloat(b.timestampSec)));
      setCorrecting({ ...data, songId: activeSong.id });
    } catch (e) { addToast(e.message, 'error'); }
    finally { setAddingChord(false); }
  };

  // ── Practice loop ──────────────────────────────────────────────────────────
  const saveLoop = async () => {
    if (!activeSong || !loopName.trim()) { addToast('Enter a loop name', 'error'); return; }
    const player = playerRef.current;
    const t = player?.getCurrentTime?.() ?? 0;
    const start = Math.max(0, t - 5);
    const end   = t;
    try {
      const res  = await api.post(`/api/guitar/loops/${activeSong.id}`,
        { name: loopName.trim(), startTimeSec: start, endTimeSec: end });
      const loop = await res.json();
      setLoops(prev => [...prev, loop]);
      setLoopName('');
      addToast('Loop saved', 'success');
    } catch (e) { addToast(e.message, 'error'); }
  };

  const deleteLoop = async (id) => {
    await api.delete(`/api/guitar/loops/${id}`);
    setLoops(prev => prev.filter(l => l.id !== id));
    if (loopActive?.id === id) setLoopActive(null);
  };

  // Set the playback speed (percent). Returns the percent the player really runs at: YouTube only has fixed rates.
  // The clock is re-based first so the chart stays in step across the change.
  const setPlaybackSpeed = useCallback((pct) => {
    const player = playerRef.current;
    let rate = pct / 100;
    try {
      if (player?.getCurrentTime) { localBase.current = player.getCurrentTime(); localTimer.current = performance.now(); }
      if (player?.setPlaybackRate) {
        rate = snapRate(rate, player.getAvailablePlaybackRates?.());
        player.setPlaybackRate(rate);
      }
    } catch (_) { /* player not ready */ }
    rateRef.current = rate;
    return Math.round(rate * 100);
  }, []);

  const seekToLoopStart = useCallback(() => {
    const p = playerRef.current;
    if (!p?.seekTo || !loopActive) return;
    const s = parseFloat(loopActive.startTimeSec);
    p.seekTo(s, true);
    localBase.current = s;
    localTimer.current = performance.now();
  }, [loopActive]);

  const activateLoop = (loop) => {
    setLoopActive(loop);
    setLoopPasses(0);
    const player = playerRef.current;
    if (player?.seekTo) { player.seekTo(parseFloat(loop.startTimeSec), true); localBase.current = parseFloat(loop.startTimeSec); localTimer.current = performance.now(); }
  };

  // ── Extract YouTube video ID ───────────────────────────────────────────────
  const videoIdOf = (url) => {
    if (!url) return null;
    const m = url.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
    return m?.[1] ?? null;
  };

  const fmtTime = (s) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2,'0')}`;
  };

  // ── Status badge ──────────────────────────────────────────────────────────
  const StatusBadge = ({ status }) => {
    const map = {
      pending:    { l: 'Pending',    c: 'var(--color-muted)', bg: 'rgba(0,0,0,0.06)' },
      processing: { l: 'Processing', c: '#2563eb', bg: 'rgba(37,99,235,0.1)' },
      done:       { l: 'Ready',      c: '#16a34a', bg: 'rgba(22,163,74,0.1)' },
      failed:     { l: 'Failed',     c: '#dc2626', bg: 'rgba(220,38,38,0.1)' },
    };
    const s = map[status] || map.pending;
    return <span className="text-xs px-2 py-0.5 rounded-full font-medium"
      style={{ color: s.c, background: s.bg }}>{s.l}</span>;
  };

  // Settings -> Guitar Tour opens /guitar?tour=1
  useEffect(() => {
    if (params.get('tour')) {
      const next = new URLSearchParams(params); next.delete('tour');
      setParams(next, { replace: true });
      setTimeout(() => startGuitarTour({ goTab: setTab }), 300);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startTour = () => {
    try { localStorage.removeItem(GUITAR_TOUR_KEY); } catch (_) { /* ignore */ }
    startGuitarTour({ goTab: setTab });
  };

  // The guide's "Open" buttons: switch to the tab that holds the control.
  const openToolById = (id) => {
    const target = GUIDE_TOOLS.find((t) => t.id === id);
    const tool = GUITAR_TOOLS.find((t) => t.id === (target ? target.tool : id));
    if (tool) setTab(tool.tab);
  };

  // A set list opens in play mode with its songs in order
  const playSetList = (ids) => {
    const queue = ids.map(id => songs.find(s => s.id === id)).filter(Boolean);
    if (!queue.length) { addToast('That set list has no songs yet', 'error'); return; }
    setGig({ queue, startIndex: 0 });
  };

  // Make it easier: the shapes to finger for this song, at the same sound or with easier chords. Chords as they sound (transposed).
  const easyPlans = useMemo(() => {
    const played = chords.map(c => ({ root: transposeRoot(c.chordRoot, transpose), quality: c.chordQuality || '' }));
    return { exact: simplifySong(played, { level: 'exact' }), easier: simplifySong(played, { level: 'easier' }) };
  }, [chords, transpose]);
  const easyPlan = easyMode === 'off' ? null : easyPlans[easyMode];
  const easyMap = useMemo(() => new Map((easyPlan?.chords || []).map(c => [c.concert, c])), [easyPlan]);
  const canThin = !!(activeSong && activeSong.sourceType === 'upload' && activeSong.bpm);
  const thinSet = useMemo(() => (easyFewer && canThin
    ? thinChanges(chords.map(c => ({ id: c.id, timestampSec: c.timestampSec })), activeSong.bpm) : new Set()), [easyFewer, canThin, chords, activeSong]);

  const chooseEasy = (mode) => {
    if (mode !== 'off' && easyMode === 'off') prevCapo.current = capoFret;
    if (mode === 'off' && easyMode !== 'off') changeCapo(prevCapo.current);
    setEasyMode(mode);
  };
  // Keep the capo where the plan wants it (also when the chart is transposed while it is on)
  const easyCapo = easyPlan ? easyPlan.capo : null;
  useEffect(() => { if (easyCapo != null && easyCapo !== capoFret) changeCapo(easyCapo); }, [easyCapo]); // eslint-disable-line react-hooks/exhaustive-deps

  // What the Player already knows about the song, sent along so the coach explains the same key and numerals the person sees
  const explainThisSong = () => {
    if (!activeSong) return;
    const nums = [];
    for (const ev of chords) {
      const n = theory?.byId.get(ev.id)?.numeral;
      if (n && nums[nums.length - 1] !== n) nums.push(n);
    }
    setExplaining({
      song: activeSong,
      analysis: theory ? {
        key: `${ROOTS[theory.key.tonic]} ${theory.key.mode}`,
        progression: nums.slice(0, 16),
        flagged: theory.flagged.map(f => ({ label: f.label, numeral: f.numeral, note: f.note })),
        capo: theory.advice,
      } : {},
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <div className="px-6 pt-4 pb-0">
          <div className="flex items-center gap-2 mb-3">
            <span style={{ fontSize: 20 }}>🎸</span>
            <h1 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>Guitar</h1>
            <Tooltip text={GT.howItWorks}>
              <button type="button" aria-label="How Guitar works" onClick={info.open}
                className="opacity-60 hover:opacity-100 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}>
                {getIcon('info', { size: 16 })}
              </button>
            </Tooltip>
            <Tooltip text={GT.tour}>
              <button type="button" aria-label="Take the guided tour of Guitar" onClick={startTour}
                className="opacity-60 hover:opacity-100 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}>
                {getIcon('compass', { size: 16 })}
              </button>
            </Tooltip>
          </div>
          <div className="flex gap-0" data-tour="guitar-tabs">
            {TABS.map(t => (
              <Tooltip text={tabTip(t)} key={t}>
                <button onClick={() => setTab(t)}
                  className="text-sm px-4 py-2 border-b-2 transition-colors flex-shrink-0"
                  style={{
                    background: 'transparent',
                    color: tab === t ? 'var(--color-primary)' : 'var(--color-muted)',
                    borderBottomColor: tab === t ? 'var(--color-primary)' : 'transparent',
                    fontWeight: tab === t ? 600 : 400,
                  }}>{t}</button>
              </Tooltip>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ── Today tab ────────────────────────────────────────────────── */}
        {tab === 'Today' && (
          <div className="p-6 max-w-3xl" data-tour="guitar-today">
            <TodayView songs={songs} refreshKey={practiceTick} onOpenSong={openSong} onPlayed={() => loadSongs()}
              onStartDrill={(pair) => { setDrillPair(pair); setTab('Drills'); }} />
          </div>
        )}

        {/* ── Learn tab ────────────────────────────────────────────────── */}
        {tab === 'Learn' && (
          <div className="p-6 max-w-3xl" data-tour="guitar-learn">
            <LearnView songs={songs} onOpenSong={openSong} />
          </div>
        )}

        {/* ── Coach tab ────────────────────────────────────────────────── */}
        {tab === 'Coach' && (
          <div className="p-6 max-w-3xl">
            <CoachView songs={songs} onOpenSong={openSong}
              onStartDrill={(pair) => { setDrillPair(pair); setTab('Drills'); }}
              onLog={(target) => setPracticeDialog(target)} />
          </div>
        )}

        {/* ── Drills tab ───────────────────────────────────────────────── */}
        {tab === 'Drills' && (
          <div className="p-6 max-w-3xl" data-tour="guitar-drills">
            <TransitionDrills initialPair={drillPair} onChanged={() => setPracticeTick(t => t + 1)} onOpenEar={() => setTab('Ear')} />
          </div>
        )}

        {/* ── Ear tab ──────────────────────────────────────────────────── */}
        {tab === 'Ear' && (
          <div className="p-6 max-w-3xl" data-tour="guitar-ear">
            <EarTraining />
          </div>
        )}

        {/* ── Strum tab ────────────────────────────────────────────────── */}
        {tab === 'Strum' && (
          <div className="p-6 max-w-3xl">
            <StrumTrainer songs={songs} />
          </div>
        )}

        {/* ── Library tab ──────────────────────────────────────────────── */}
        {tab === 'Library' && (
          <div className="p-6 max-w-3xl flex flex-col gap-6">
            {/* Add song — three modes */}
            <div data-tour="guitar-add">
              <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Add a song</h2>
              <div className="flex gap-1 mb-3">
                {[
                  { id: 'ug',     label: 'Ultimate Guitar' },
                  { id: 'upload', label: 'Upload audio' },
                  { id: 'manual', label: 'Manual chart' },
                ].map(m => (
                  <Tooltip text={ADD_TIPS[m.id]} key={m.id}>
                    <button onClick={() => setAddMode(m.id)}
                      className="text-xs px-3 py-1.5 rounded-lg border"
                      style={{
                        borderColor: addMode === m.id ? 'var(--color-primary)' : 'var(--color-border)',
                        color: addMode === m.id ? 'var(--color-primary)' : 'var(--color-muted)',
                        background: addMode === m.id ? 'rgba(37,99,235,0.06)' : 'transparent',
                        fontWeight: addMode === m.id ? 600 : 400,
                      }}>{m.label}</button>
                  </Tooltip>
                ))}
              </div>

              {addMode === 'ug' && (
                <div>
                  <div className="flex gap-2">
                    <Tooltip text={GT.ugUrl}>
                      <input value={ugUrl} onChange={e => setUgUrl(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && submitUg()}
                        placeholder="Paste an Ultimate Guitar Chords tab URL…"
                        className="flex-1 text-sm px-3 py-2 rounded-lg border"
                        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }} />
                    </Tooltip>
                    <Tooltip text={GT.ugImport}>
                      <button onClick={submitUg} disabled={submitting || !ugUrl.trim()}
                        className="px-4 py-2 text-sm rounded-lg font-medium disabled:opacity-40"
                        style={{ background: 'var(--color-primary)', color: '#fff' }}>
                        {submitting ? 'Importing…' : 'Import chords'}
                      </button>
                    </Tooltip>
                  </div>
                  <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                    Go to <a href="https://www.ultimate-guitar.com" target="_blank" rel="noopener noreferrer" className="underline">ultimate-guitar.com</a>, search for your song, open a free <strong>Chords</strong> tab, and paste its URL here.
                    Pro tabs and Guitar Pro files are not supported.
                  </p>
                </div>
              )}

              {addMode === 'upload' && (
                <div className="flex flex-col gap-2">
                  <Tooltip text={GT.audioFile}>
                    <input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
                      onChange={e => {
                        const f = e.target.files?.[0] || null;
                        setUploadFile(f);
                        if (f && !uploadTitle) setUploadTitle(f.name.replace(/\.[^.]+$/, ''));
                      }}
                      className="text-sm" />
                  </Tooltip>
                  <div className="flex gap-2">
                    <Tooltip text={GT.uploadTitle}>
                      <input value={uploadTitle} onChange={e => setUploadTitle(e.target.value)}
                        placeholder="Title" className="flex-1 text-sm px-3 py-2 rounded-lg border"
                        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }} />
                    </Tooltip>
                    <Tooltip text={GT.uploadArtist}>
                      <input value={uploadArtist} onChange={e => setUploadArtist(e.target.value)}
                        placeholder="Artist (optional)" className="flex-1 text-sm px-3 py-2 rounded-lg border"
                        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }} />
                    </Tooltip>
                  </div>
                  <Tooltip text={GT.youtubeUrl}>
                    <input value={uploadYtUrl} onChange={e => setUploadYtUrl(e.target.value)}
                      placeholder="Optional YouTube URL for video sync while practising"
                      className="text-sm px-3 py-2 rounded-lg border"
                      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }} />
                  </Tooltip>
                  <Tooltip text={GT.uploadGo}>
                    <button onClick={submitUpload} disabled={submitting || !uploadFile}
                      className="self-start px-4 py-2 text-sm rounded-lg font-medium disabled:opacity-40"
                      style={{ background: 'var(--color-primary)', color: '#fff' }}>
                      {submitting ? 'Uploading…' : 'Upload & detect'}
                    </button>
                  </Tooltip>
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    Reliable path for age-restricted or offline tracks. Max 25 MB (mp3, wav, m4a…).
                  </p>
                </div>
              )}

              {addMode === 'manual' && (
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    <Tooltip text={GT.manualTitle}>
                      <input value={manualTitle} onChange={e => setManualTitle(e.target.value)}
                        placeholder="Song title" className="flex-1 text-sm px-3 py-2 rounded-lg border"
                        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }} />
                    </Tooltip>
                    <Tooltip text={GT.manualArtist}>
                      <input value={manualArtist} onChange={e => setManualArtist(e.target.value)}
                        placeholder="Artist (optional)" className="flex-1 text-sm px-3 py-2 rounded-lg border"
                        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }} />
                    </Tooltip>
                  </div>
                  <Tooltip text={GT.youtubeUrl}>
                    <input value={manualYtUrl} onChange={e => setManualYtUrl(e.target.value)}
                      placeholder="Optional YouTube URL for playback"
                      className="text-sm px-3 py-2 rounded-lg border"
                      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }} />
                  </Tooltip>
                  <Tooltip text={GT.manualGo}>
                    <button onClick={submitManual} disabled={submitting || !manualTitle.trim()}
                      className="self-start px-4 py-2 text-sm rounded-lg font-medium disabled:opacity-40"
                      style={{ background: 'var(--color-primary)', color: '#fff' }}>
                      Create blank chart
                    </button>
                  </Tooltip>
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    Skip detection — enter chords yourself while practising.
                  </p>
                </div>
              )}
            </div>

            {/* Song list */}
            {loading ? (
              <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>
            ) : songs.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
                No songs yet — add a YouTube URL, upload audio, or create a manual chart.
              </p>
            ) : (
              <div className="flex flex-col gap-2" data-tour="guitar-songs">
                {songs.map(song => (
                  <div key={song.id}
                    onClick={() => song.status === 'done' && openSong(song)}
                    className="rounded-xl border p-4 flex items-center gap-4 transition-opacity"
                    style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)',
                             cursor: song.status === 'done' ? 'pointer' : 'default',
                             opacity: song.status === 'failed' ? 0.6 : 1 }}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
                        {song.title || 'Processing…'}
                        <span className="ml-2 text-xs font-normal" style={{ color: 'var(--color-muted)' }}>
                          {{ upload: 'upload', manual: 'manual', 'ultimate-guitar': 'UG', youtube: 'youtube' }[song.sourceType] ?? song.sourceType}
                        </span>
                      </p>
                      <p className="text-xs truncate" style={{ color: 'var(--color-muted)' }}>
                        {song.artist || ''}
                        {song.keyDetected ? ` · Key: ${song.keyDetected}` : ''}
                        {song.bpm ? ` · ${song.bpm} BPM` : ''}
                        {song.duration ? ` · ${fmtTime(song.duration)}` : ''}
                      </p>
                      {song.status === 'failed' && song.errorMessage && (
                        <p className="text-xs mt-0.5" style={{ color: '#dc2626' }}>
                          {song.errorMessage}
                          {song.errorMessage.includes('cobalt.tools') && song.youtubeUrl && (
                            <> — <a
                              href={`https://cobalt.tools/?url=${encodeURIComponent(song.youtubeUrl)}`}
                              target="_blank" rel="noopener noreferrer"
                              className="underline"
                              onClick={e => e.stopPropagation()}>
                              Download at cobalt.tools
                            </a>, then Upload audio</>
                          )}
                        </p>
                      )}
                    </div>
                    <StatusBadge status={song.status} />
                    {song.status === 'done' && (
                      <>
                        <PracticeBadge state={song.practiceState} />
                        <Tooltip text={GT.songStatus}>
                          <select aria-label={`Status for ${song.title || 'song'}`}
                            value={song.learnStatus || 'learning'}
                            onClick={e => e.stopPropagation()}
                            onChange={e => setLearnStatus(song, e.target.value)}
                            className="text-xs px-2 py-1 rounded border flex-shrink-0"
                            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }}>
                            <option value="learning">Learning</option>
                            <option value="polishing">Polishing</option>
                            <option value="ready">Ready</option>
                          </select>
                        </Tooltip>
                        <Tooltip text={GT.played}>
                          <button onClick={e => { e.stopPropagation(); setPracticeDialog({ song }); }}
                            className="text-xs px-2 py-1 rounded border flex-shrink-0 hover:opacity-70 transition-opacity duration-200"
                            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>I played this</button>
                        </Tooltip>
                      </>
                    )}
                    <Tooltip text={GT.removeSong}>
                      <button onClick={e => deleteSong(song.id, e)}
                        className="text-xs px-2 py-1 rounded border"
                        style={{ borderColor: 'rgba(220,38,38,0.3)', color: '#dc2626', flexShrink: 0 }}>
                        Remove
                      </button>
                    </Tooltip>
                  </div>
                ))}
              </div>
            )}
            <SetLists songs={songs} onPlay={playSetList} />
          </div>
        )}

        {/* ── Player tab ───────────────────────────────────────────────── */}
        {tab === 'Player' && (
          <div className="p-4 flex flex-col gap-4 max-w-5xl">
            {!activeSong ? (
              <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
                Select a song from the Library tab.
              </p>
            ) : (
              <>
                {/* Song info bar */}
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate" style={{ color: 'var(--color-text)' }}>
                      {activeSong.title}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                      {activeSong.artist}
                      {activeSong.keyDetected ? ` · Key: ${activeSong.keyDetected}` : ''}
                      {activeSong.bpm ? ` · ${activeSong.bpm} BPM` : ''}
                      {activeSong.capoSuggested > 0 ? ` · Capo ${activeSong.capoSuggested} (per tab)` : ''}
                    </p>
                  </div>
                  <Tooltip text={GT.playMode}>
                    <button onClick={() => setGig({ queue: [activeSong], startIndex: 0 })}
                      className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-70 transition-opacity duration-200"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Play mode</button>
                  </Tooltip>
                  <Tooltip text={GT.explainSong}>
                    <button onClick={explainThisSong}
                      className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-70 transition-opacity duration-200"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Explain this song</button>
                  </Tooltip>
                  <Tooltip text={GT.played}>
                    <button onClick={() => setPracticeDialog({ song: activeSong })}
                      className="text-xs px-3 py-1.5 rounded-lg font-medium hover:opacity-70 transition-opacity duration-200"
                      style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}>I played this</button>
                  </Tooltip>
                  {/* Transpose */}
                  <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                    <span><GlossaryTerm id="transpose">Transpose</GlossaryTerm></span>
                    <Tooltip text={GT.transposeDown}>
                      <button onClick={() => changeTranspose(transpose - 1)}
                        className="w-6 h-6 rounded border flex items-center justify-center font-mono"
                        style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>−</button>
                    </Tooltip>
                    <span className="w-6 text-center font-mono" style={{ color: 'var(--color-text)' }}>{transpose > 0 ? `+${transpose}` : transpose}</span>
                    <Tooltip text={GT.transposeUp}>
                      <button onClick={() => changeTranspose(transpose + 1)}
                        className="w-6 h-6 rounded border flex items-center justify-center font-mono"
                        style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>+</button>
                    </Tooltip>
                  </div>
                  {/* Capo — fingering note only; does not rename chords on the chart */}
                  <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                    <span><GlossaryTerm id="capo">Capo</GlossaryTerm></span>
                    <Tooltip text={GT.capo}>
                      <select value={capoFret} onChange={e => changeCapo(parseInt(e.target.value))}
                        className="text-xs px-2 py-1 rounded border"
                        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }}>
                        {Array.from({ length: 8 }).map((_, i) => (
                          <option key={i} value={i}>{i === 0 ? 'None' : `Fret ${i}`}
                            {i === activeSong.capoSuggested && i > 0 ? ' (tab)' : ''}</option>
                        ))}
                      </select>
                    </Tooltip>
                  </div>
                  {/* Auto-scroll only useful with playback */}
                  {(activeSong.hasAudio || videoIdOf(activeSong.youtubeUrl)) && (
                    <label className="flex items-center gap-1 text-xs cursor-pointer" style={{ color: 'var(--color-muted)' }}>
                      <Tooltip text={GT.autoScroll}>
                        <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} />
                      </Tooltip>
                      Auto-scroll
                    </label>
                  )}
                </div>

                <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 320px' }}>
                  {/* Left: player + chord chart */}
                  <div className="flex flex-col gap-4">
                    {/* Prefer YouTube when linked; otherwise stream stored upload audio */}
                    {videoIdOf(activeSong.youtubeUrl) ? (
                      <YouTubePlayer
                        videoId={videoIdOf(activeSong.youtubeUrl)}
                        playerRef={playerRef}
                        onReady={onPlayerReady}
                      />
                    ) : activeSong.hasAudio ? (
                      <HtmlAudioPlayer
                        songId={activeSong.id}
                        playerRef={playerRef}
                        onReady={onPlayerReady}
                      />
                    ) : (
                      <p className="text-xs rounded-lg border p-3" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
                        Chart-only mode — no audio attached. Scroll through chords while you play, or add this song via Upload audio to enable playback sync.
                      </p>
                    )}

                    {/* Chord chart */}
                    <div ref={chartRef} data-tour="guitar-chart" className="rounded-xl border p-3"
                      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                        <span className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
                          Chord Chart {loadingChords && <span style={{ color: 'var(--color-muted)' }}>· Loading…</span>}
                        </span>
                        <div className="flex items-center gap-2">
                          <Tooltip text={GT.addChord}>
                            <button onClick={addChordAtPlayhead} disabled={addingChord}
                              className="text-xs px-2 py-1 rounded border"
                              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                              {addingChord ? 'Adding…' : 'Add chord at playhead'}
                            </button>
                          </Tooltip>
                          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                            Click to hear · double-click to edit · hover for diagram
                          </span>
                        </div>
                      </div>

                      {chords.length === 0 && !loadingChords && (
                        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                          No chords yet.
                        </p>
                      )}

                      {/* Song-sheet layout: grouped by section and lyric line */}
                      {(() => {
                        // Build sections → lines structure
                        const sections = [];
                        let curSec = null;
                        let curLine = null;
                        chords.forEach((ev, flatIdx) => {
                          const sName = (ev.sectionName && !/^capo\b/i.test(ev.sectionName))
                            ? ev.sectionName
                            : null;
                          const lIdx  = ev.lineIdx ?? flatIdx;
                          if (!curSec || curSec.name !== sName) {
                            curSec = { name: sName, lines: [] };
                            sections.push(curSec);
                            curLine = null;
                          }
                          if (!curLine || curLine.key !== lIdx) {
                            curLine = { key: lIdx, lyric: ev.lyricText ?? null, evs: [] };
                            curSec.lines.push(curLine);
                          }
                          if (ev.lyricText && !curLine.lyric) curLine.lyric = ev.lyricText;
                          curLine.evs.push({ ev, flatIdx });
                        });

                        return sections.map((sec, si) => (
                          <div key={si} style={{ marginBottom: '1rem' }}>
                            {sec.name && (
                              <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase',
                                letterSpacing: '0.1em', color: 'var(--color-primary)', marginBottom: 6, opacity: 0.85 }}>
                                {sec.name}
                              </p>
                            )}
                            {sec.lines.map((line, li) => (
                              <div key={li} style={{ marginBottom: '0.75rem' }}>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 2 }}>
                                  {line.evs.map(({ ev, flatIdx }) => {
                                    const label    = displayChord(ev.chordRoot, ev.chordQuality || '', transpose);
                                    const easy     = easyMap.get(label) || null;
                                    const shown    = easy ? easy.play : label;      // what to finger when Make it easier is on
                                    const skipped  = thinSet.has(ev.id);
                                    const isActive = flatIdx === activeChordIdx;
                                    return (
                                      <div key={ev.id} data-chord-idx={flatIdx} className="relative group">
                                        <Tooltip text={skipped ? `${shown}. This change is too fast to land: hold the chord before it. ${GT.chord}` : `${shown}${easy && shown !== label ? ` (sounds as ${label})` : ''}. ${GT.chord}`}>
                                          <button
                                            onClick={() => {
                                              setFretboardChord({ root: ev.chordRoot, quality: ev.chordQuality || '' });
                                              playChordAudio(ev.chordRoot, ev.chordQuality || '');
                                            }}
                                            onDoubleClick={() => setCorrecting({ ...ev, songId: activeSong.id })}
                                            style={{
                                              fontFamily: 'monospace', fontSize: '0.8rem', fontWeight: 700,
                                              padding: '2px 8px', borderRadius: 6, cursor: 'pointer',
                                              background: isActive ? 'var(--color-primary)' : 'var(--color-bg)',
                                              color: isActive ? '#fff' : 'var(--color-primary)',
                                              border: `1.5px solid ${isActive ? 'var(--color-primary)' : 'var(--color-primary)'}`,
                                              opacity: skipped ? 0.3 : isActive ? 1 : 0.85,
                                              textDecoration: skipped ? 'line-through' : 'none',
                                            }}>
                                            {shown}
                                          </button>
                                        </Tooltip>
                                        {(() => {
                                          const th = showNumerals ? theory?.byId.get(ev.id) : null;
                                          const shape = !easy && showShapes && capoFret > 0
                                            ? shapeAtCapo(ev.chordRoot, ev.chordQuality, transpose, capoFret) : null;
                                          const sounds = easy && shown !== label ? label : null;
                                          if (!th && !shape && !sounds) return null;
                                          return (
                                            <Tooltip text={th ? (th.note ? `${th.note}.` : GT.numeral) : GT.shapeChip}>
                                              <div style={{ textAlign: 'center', fontSize: '0.65rem', lineHeight: 1.2, marginTop: 1 }}>
                                                {th && <span style={{ fontFamily: 'monospace', color: KIND_STYLE[th.kind].color,
                                                  fontWeight: th.kind === 'diatonic' ? 400 : 700 }}>{th.numeral}</span>}
                                                {th && shape && ' '}
                                                {shape && <span style={{ color: 'var(--color-muted)' }}>({shape})</span>}
                                                {sounds && <span style={{ color: 'var(--color-muted)' }}>{th ? ' · ' : ''}sounds {sounds}</span>}
                                              </div>
                                            </Tooltip>
                                          );
                                        })()}
                                        <div className="absolute z-30 hidden group-hover:block"
                                          style={{ bottom: '100%', left: '50%', transform: 'translateX(-50%)', paddingBottom: 4 }}>
                                          <QuickDiagram root={ev.chordRoot} quality={ev.chordQuality || ''} transpose={transpose} />
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                                {line.lyric && (
                                  <p style={{ fontSize: '0.8rem', color: 'var(--color-text)', margin: 0, lineHeight: 1.5, paddingLeft: 2 }}>
                                    {line.lyric}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        ));
                      })()}
                    </div>
                  </div>

                  {/* Right: fretboard + loops */}
                  <div className="flex flex-col gap-4">
                    <div data-tour="guitar-theory">
                      <TheoryPanel theory={theory} keyChoice={keyChoice} onKeyChoice={setKeyChoice}
                        showNumerals={showNumerals} onShowNumerals={setShowNumerals}
                        showShapes={showShapes} onShowShapes={setShowShapes}
                        capoFret={capoFret} onUseCapo={changeCapo} />
                    </div>
                    <SimplifyPanel mode={easyMode} onMode={chooseEasy} plans={easyPlans} canThin={canThin} fewer={easyFewer} onFewer={setEasyFewer} skipped={thinSet.size} />
                    {/* Chord voicings (UG-style) */}
                    <div className="rounded-xl border p-3"
                      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                      <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text)' }}>
                        Chord shapes
                      </p>
                      {fretboardChord
                        ? <VoicingBrowser
                            chordRoot={fretboardChord.root}
                            chordQuality={fretboardChord.quality}
                            transposeOffset={transpose}
                          />
                        : <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Click any chord to browse shapes along the neck.</p>
                      }
                    </div>

                    {/* Practice loops */}
                    <div data-tour="guitar-loops" className="rounded-xl border p-3"
                      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                      <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Practice Loops</p>
                      {!activeSong?.hasAudio && !activeSong?.youtubeUrl ? (
                        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                          Practice loops need an audio source. Upload an mp3 for this song via Upload audio to enable loops.
                        </p>
                      ) : (
                      <>
                      <div className="flex gap-1 mb-2">
                        <Tooltip text={GT.loopName}>
                          <input value={loopName} onChange={e => setLoopName(e.target.value)}
                            placeholder="Loop name…"
                            className="flex-1 text-xs px-2 py-1 rounded border"
                            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }} />
                        </Tooltip>
                        <Tooltip text={GT.saveLoop}>
                          <button onClick={saveLoop}
                            className="text-xs px-2 py-1 rounded border font-medium"
                            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                            + Save at current
                          </button>
                        </Tooltip>
                      </div>
                      {loops.length === 0
                        ? <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No loops yet.</p>
                        : loops.map(l => (
                          <div key={l.id} className="flex items-center gap-1 mb-1">
                            <Tooltip text={GT.playLoop}>
                              <button onClick={() => activateLoop(l)}
                                className="flex-1 text-xs px-2 py-1 rounded text-left truncate"
                                style={{
                                  background: loopActive?.id === l.id ? 'var(--color-primary)' : 'var(--color-bg)',
                                  color: loopActive?.id === l.id ? '#fff' : 'var(--color-text)',
                                  border: '1px solid var(--color-border)',
                                }}>
                                {l.name} <span style={{ opacity: 0.7 }}>{fmtTime(l.startTimeSec)}–{fmtTime(l.endTimeSec)}</span>
                              </button>
                            </Tooltip>
                            {loopActive?.id === l.id && (
                              <Tooltip text={GT.clearLoop}>
                                <button onClick={() => setLoopActive(null)}
                                  className="text-xs px-1.5 py-1 rounded border"
                                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>✕</button>
                              </Tooltip>
                            )}
                            <Tooltip text={GT.deleteLoop}>
                              <button onClick={() => deleteLoop(l.id)}
                                className="text-xs px-1.5 py-1 rounded border"
                                style={{ borderColor: 'rgba(220,38,38,0.3)', color: '#dc2626' }}>🗑</button>
                            </Tooltip>
                          </div>
                        ))
                      }
                      {loopActive && (
                        <TempoTrainer
                          loop={loopActive} song={activeSong} passes={loopPasses}
                          onSpeed={setPlaybackSpeed}
                          onPlay={() => { try { playerRef.current?.playVideo?.(); } catch (_) { /* player not ready */ } }}
                          onPause={() => { try { playerRef.current?.pauseVideo?.(); } catch (_) { /* player not ready */ } }}
                          onSeek={seekToLoopStart} />
                      )}
                      </>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Chord correction modal */}
      {correcting && (
        <CorrectionModal event={correcting} onSave={saveCorrection} onClose={() => setCorrecting(null)} />
      )}
      {info.show && (
        <ToolInfoModal title="How Guitar Works" onClose={info.close}>
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>
            Learn songs, keep them sharp and practise the hard parts. Not sure where to start? Press the round button at the bottom right and tell the guide what you want to do.
          </p>
          <div className="rounded-lg p-3 text-sm space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            {HOW_IT_WORKS.map(([heading, text]) => (
              <p key={heading} style={{ color: 'var(--color-text)' }}><strong>{heading}</strong> — {text}</p>
            ))}
          </div>
        </ToolInfoModal>
      )}
      {gig && <GigMode queue={gig.queue} startIndex={gig.startIndex} onClose={() => setGig(null)} />}
      {explaining && <ExplainDialog song={explaining.song} analysis={explaining.analysis} onClose={() => setExplaining(null)} />}
      <GuitarTutorChat currentTool={tab.toLowerCase()} onOpenTool={openToolById} />
      {practiceDialog && (
        <PracticeDialog song={practiceDialog.song} loop={null} onClose={() => setPracticeDialog(null)}
          onSaved={() => { loadSongs(); setPracticeTick(t => t + 1); }} />
      )}
    </div>
  );
}

// Quick diagram on chord hover — generated shapes, works for C#m etc.
function QuickDiagram({ root, quality, transpose = 0 }) {
  const shapes = useMemo(
    () => generateVoicings(transposeRoot(root, transpose), quality || ''),
    [root, quality, transpose]
  );
  if (!shapes[0]) return null;
  return (
    <div className="rounded-lg shadow-xl p-2"
      style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
      <ChordDiagram shape={shapes[0]} />
      {shapes.length > 1 && (
        <p className="text-center mt-1" style={{ fontSize: 9, color: 'var(--color-muted)' }}>
          +{shapes.length - 1} more — click chord
        </p>
      )}
    </div>
  );
}
