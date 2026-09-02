import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../utils/apiClient';
import useToastStore from '../store/toastStore';

// ── Music theory constants ────────────────────────────────────────────────────
const ROOTS = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
const QUALITY_LABELS = { '': '', 'm': 'm', '7': '7', 'maj7': 'maj7', 'm7': 'm7',
  'dim': 'dim', 'aug': '+', 'sus2': 'sus2', 'sus4': 'sus4', 'dim7': 'dim7', 'm7b5': 'ø' };

function transposeRoot(root, semitones) {
  const idx = ROOTS.indexOf(root);
  if (idx === -1) return root;
  return ROOTS[((idx + semitones) % 12 + 12) % 12];
}
function displayChord(root, quality, transposeOffset, capo) {
  const shift = transposeOffset - capo;
  const displayRoot = transposeRoot(root, shift);
  const q = QUALITY_LABELS[quality] ?? quality;
  return displayRoot + q;
}

// ── Chord shape SVG diagram ───────────────────────────────────────────────────
function ChordDiagram({ shape }) {
  if (!shape) return null;
  const frets = shape.fretPositions;
  const fingers = shape.fingerPositions || [];
  const base = shape.baseFret || 1;
  const W = 80, H = 90, padL = 18, padT = 16;
  const strings = 6, fretCount = 4;
  const colW = (W - padL - 6) / (strings - 1);
  const rowH = (H - padT - 8) / fretCount;

  const xOf = (s) => padL + s * colW;
  const yOf = (f) => padT + (f - 0.5) * rowH;

  return (
    <svg width={W} height={H} style={{ display: 'block' }}>
      {base > 1 && <text x={4} y={padT + rowH * 0.5} fontSize="8" fill="#6b7280">{base}fr</text>}
      {/* Fret lines */}
      {Array.from({ length: fretCount + 1 }).map((_, f) => (
        <line key={f} x1={xOf(0)} x2={xOf(strings - 1)}
          y1={padT + f * rowH} y2={padT + f * rowH}
          stroke={f === 0 && base === 1 ? '#1f2937' : '#d1d5db'}
          strokeWidth={f === 0 && base === 1 ? 3 : 1} />
      ))}
      {/* String lines */}
      {Array.from({ length: strings }).map((_, s) => (
        <line key={s} x1={xOf(s)} x2={xOf(s)} y1={padT} y2={padT + fretCount * rowH}
          stroke="#9ca3af" strokeWidth={1} />
      ))}
      {/* Fret markers */}
      {frets.map((f, s) => {
        if (f === -1) return <text key={s} x={xOf(strings - 1 - s)} y={padT - 5} textAnchor="middle" fontSize="9" fill="#dc2626">×</text>;
        if (f === 0)  return <circle key={s} cx={xOf(strings - 1 - s)} cy={padT - 5} r={3.5} fill="none" stroke="#6b7280" strokeWidth={1} />;
        const relF = f - base + 1;
        return (
          <g key={s}>
            <circle cx={xOf(strings - 1 - s)} cy={yOf(relF)} r={6}
              fill="var(--color-primary)" />
            {fingers[s] > 0 && (
              <text x={xOf(strings - 1 - s)} y={yOf(relF) + 3.5} textAnchor="middle"
                fontSize="7" fill="#fff">{fingers[s]}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ── SVG Fretboard (6 strings, 12 frets, highlights notes of chord/key) ────────
function Fretboard({ chordRoot, chordQuality, keyRoot }) {
  const TUNING = ['E2','A2','D3','G3','B3','E4'];
  const NOTE_TO_SEMI = { C:0,'C#':1,Db:1,D:2,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,Ab:8,A:9,Bb:10,B:11 };
  const openNotes = TUNING.map(n => {
    const root = n.replace(/\d/, '');
    return NOTE_TO_SEMI[root] ?? 0;
  });

  // Which semitones belong to this chord?
  const rootSemi  = NOTE_TO_SEMI[chordRoot] ?? 0;
  const qualIntervals = {
    '': [0,4,7], 'm': [0,3,7], '7': [0,4,7,10], 'maj7': [0,4,7,11],
    'm7': [0,3,7,10], 'dim': [0,3,6], 'aug': [0,4,8], 'sus2': [0,2,7], 'sus4': [0,5,7],
  };
  const intervals = qualIntervals[chordQuality] ?? [0,4,7];
  const chordSemis = new Set(intervals.map(i => (rootSemi + i) % 12));

  const FRETS = 12, STRINGS = 6;
  const W = 320, H = 110;
  const padL = 24, padR = 8, padT = 14, padB = 14;
  const fretW = (W - padL - padR) / FRETS;
  const strH  = (H - padT - padB) / (STRINGS - 1);

  const xOf = (fret) => padL + fret * fretW;
  const yOf = (str) => padT + str * strH;

  return (
    <svg width={W} height={H} style={{ display: 'block', width: '100%', maxWidth: W }}>
      {/* Fret lines */}
      {Array.from({ length: FRETS + 1 }).map((_, f) => (
        <line key={f} x1={xOf(f)} x2={xOf(f)} y1={padT} y2={H - padB}
          stroke={f === 0 ? '#374151' : '#e5e7eb'} strokeWidth={f === 0 ? 3 : 1} />
      ))}
      {/* String lines */}
      {Array.from({ length: STRINGS }).map((_, s) => (
        <line key={s} x1={xOf(0)} x2={xOf(FRETS)} y1={yOf(s)} y2={yOf(s)}
          stroke="#9ca3af" strokeWidth={STRINGS - s} />
      ))}
      {/* Fret markers (3,5,7,9,12) */}
      {[3,5,7,9].map(f => (
        <circle key={f} cx={xOf(f) - fretW / 2} cy={H / 2} r={3} fill="#e5e7eb" />
      ))}
      {/* Note dots */}
      {Array.from({ length: STRINGS }).map((_, s) =>
        Array.from({ length: FRETS + 1 }).map((_, f) => {
          const semi = (openNotes[STRINGS - 1 - s] + f) % 12;
          if (!chordSemis.has(semi)) return null;
          const isRoot = semi === rootSemi;
          return (
            <circle key={`${s}-${f}`} cx={f === 0 ? xOf(0) : xOf(f) - fretW / 2}
              cy={yOf(s)} r={5}
              fill={isRoot ? 'var(--color-primary)' : 'rgba(99,102,241,0.35)'}
              stroke={isRoot ? 'var(--color-primary)' : 'none'} />
          );
        })
      )}
      {/* String labels */}
      {TUNING.map((n, s) => (
        <text key={s} x={6} y={yOf(STRINGS - 1 - s) + 3.5} fontSize="7" fill="#9ca3af"
          textAnchor="middle">{n.replace(/\d/, '')}</text>
      ))}
    </svg>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl p-5 flex flex-col gap-4"
        style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
        onClick={e => e.stopPropagation()}>
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
      </div>
    </div>
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

// ── Main page ─────────────────────────────────────────────────────────────────
const TABS = ['Library', 'Player'];

export default function GuitarPage() {
  const [tab, setTab]           = useState('Library');
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
  const [loopName, setLoopName]   = useState('');
  const [fretboardChord, setFretboardChord] = useState(null);
  const playerRef  = useRef(null);
  const chartRef   = useRef(null);
  const rafRef     = useRef(null);
  const localTimer = useRef(null); // performance.now() at last YT sync
  const localBase  = useRef(0);    // YT time at last sync
  const pollRef    = useRef(null);
  const addToast   = useToastStore(s => s.addToast);

  const [addMode, setAddMode]               = useState('youtube'); // youtube | upload | manual
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

  const submitUrl = async () => {
    if (!urlInput.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res  = await api.post('/api/guitar/songs', { youtubeUrl: urlInput.trim() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUrlInput('');
      loadSongs();
      addToast('Processing started — chord detection takes 1–3 minutes', 'success');
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
    setCapoFret(song.capoOverride ?? song.capoSuggested ?? 0);
    setTab('Player');
    setLoadingChords(true);
    setChords([]);
    setLoops([]);
    setFretboardChord(null);
    setCurrentTimeSec(0);
    setActiveChordIdx(-1);
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
      const smoothTime = localBase.current + (now - (localTimer.current || now)) / 1000;
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

  const activateLoop = (loop) => {
    setLoopActive(loop);
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

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <div className="px-6 pt-4 pb-0">
          <div className="flex items-center gap-2 mb-3">
            <span style={{ fontSize: 20 }}>🎸</span>
            <h1 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>Guitar Learning</h1>
          </div>
          <div className="flex gap-0">
            {TABS.map(t => (
              <button key={t} onClick={() => setTab(t)}
                className="text-sm px-4 py-2 border-b-2 transition-colors flex-shrink-0"
                style={{
                  background: 'transparent',
                  color: tab === t ? 'var(--color-primary)' : 'var(--color-muted)',
                  borderBottomColor: tab === t ? 'var(--color-primary)' : 'transparent',
                  fontWeight: tab === t ? 600 : 400,
                }}>{t}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ── Library tab ──────────────────────────────────────────────── */}
        {tab === 'Library' && (
          <div className="p-6 max-w-3xl flex flex-col gap-6">
            {/* Add song — three modes */}
            <div>
              <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Add a song</h2>
              <div className="flex gap-1 mb-3">
                {[
                  { id: 'youtube', label: 'YouTube URL' },
                  { id: 'upload',  label: 'Upload audio' },
                  { id: 'manual',  label: 'Manual chart' },
                ].map(m => (
                  <button key={m.id} onClick={() => setAddMode(m.id)}
                    className="text-xs px-3 py-1.5 rounded-lg border"
                    style={{
                      borderColor: addMode === m.id ? 'var(--color-primary)' : 'var(--color-border)',
                      color: addMode === m.id ? 'var(--color-primary)' : 'var(--color-muted)',
                      background: addMode === m.id ? 'rgba(37,99,235,0.06)' : 'transparent',
                      fontWeight: addMode === m.id ? 600 : 400,
                    }}>{m.label}</button>
                ))}
              </div>

              {addMode === 'youtube' && (
                <div>
                  <div className="flex gap-2">
                    <input value={urlInput} onChange={e => setUrlInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && submitUrl()}
                      placeholder="Paste a YouTube URL…"
                      className="flex-1 text-sm px-3 py-2 rounded-lg border"
                      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }} />
                    <button onClick={submitUrl} disabled={submitting || !urlInput.trim()}
                      className="px-4 py-2 text-sm rounded-lg font-medium disabled:opacity-40"
                      style={{ background: 'var(--color-primary)', color: '#fff' }}>
                      {submitting ? 'Adding…' : 'Detect chords'}
                    </button>
                  </div>
                  <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                    Best for most guitar videos. If a video is age-restricted, use Upload audio instead.
                  </p>
                </div>
              )}

              {addMode === 'upload' && (
                <div className="flex flex-col gap-2">
                  <input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
                    onChange={e => {
                      const f = e.target.files?.[0] || null;
                      setUploadFile(f);
                      if (f && !uploadTitle) setUploadTitle(f.name.replace(/\.[^.]+$/, ''));
                    }}
                    className="text-sm" />
                  <div className="flex gap-2">
                    <input value={uploadTitle} onChange={e => setUploadTitle(e.target.value)}
                      placeholder="Title" className="flex-1 text-sm px-3 py-2 rounded-lg border"
                      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }} />
                    <input value={uploadArtist} onChange={e => setUploadArtist(e.target.value)}
                      placeholder="Artist (optional)" className="flex-1 text-sm px-3 py-2 rounded-lg border"
                      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }} />
                  </div>
                  <input value={uploadYtUrl} onChange={e => setUploadYtUrl(e.target.value)}
                    placeholder="Optional YouTube URL for video sync while practising"
                    className="text-sm px-3 py-2 rounded-lg border"
                    style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }} />
                  <button onClick={submitUpload} disabled={submitting || !uploadFile}
                    className="self-start px-4 py-2 text-sm rounded-lg font-medium disabled:opacity-40"
                    style={{ background: 'var(--color-primary)', color: '#fff' }}>
                    {submitting ? 'Uploading…' : 'Upload & detect'}
                  </button>
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    Reliable path for age-restricted or offline tracks. Max 25 MB (mp3, wav, m4a…).
                  </p>
                </div>
              )}

              {addMode === 'manual' && (
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    <input value={manualTitle} onChange={e => setManualTitle(e.target.value)}
                      placeholder="Song title" className="flex-1 text-sm px-3 py-2 rounded-lg border"
                      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }} />
                    <input value={manualArtist} onChange={e => setManualArtist(e.target.value)}
                      placeholder="Artist (optional)" className="flex-1 text-sm px-3 py-2 rounded-lg border"
                      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }} />
                  </div>
                  <input value={manualYtUrl} onChange={e => setManualYtUrl(e.target.value)}
                    placeholder="Optional YouTube URL for playback"
                    className="text-sm px-3 py-2 rounded-lg border"
                    style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }} />
                  <button onClick={submitManual} disabled={submitting || !manualTitle.trim()}
                    className="self-start px-4 py-2 text-sm rounded-lg font-medium disabled:opacity-40"
                    style={{ background: 'var(--color-primary)', color: '#fff' }}>
                    Create blank chart
                  </button>
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
              <div className="flex flex-col gap-2">
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
                          {song.sourceType === 'upload' ? 'upload' : song.sourceType === 'manual' ? 'manual' : 'youtube'}
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
                    <button onClick={e => deleteSong(song.id, e)}
                      className="text-xs px-2 py-1 rounded border"
                      style={{ borderColor: 'rgba(220,38,38,0.3)', color: '#dc2626', flexShrink: 0 }}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
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
                    </p>
                  </div>
                  {/* Transpose */}
                  <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                    <span>Transpose</span>
                    <button onClick={() => changeTranspose(transpose - 1)}
                      className="w-6 h-6 rounded border flex items-center justify-center font-mono"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>−</button>
                    <span className="w-6 text-center font-mono" style={{ color: 'var(--color-text)' }}>{transpose > 0 ? `+${transpose}` : transpose}</span>
                    <button onClick={() => changeTranspose(transpose + 1)}
                      className="w-6 h-6 rounded border flex items-center justify-center font-mono"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>+</button>
                  </div>
                  {/* Capo */}
                  <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                    <span>Capo</span>
                    <select value={capoFret} onChange={e => changeCapo(parseInt(e.target.value))}
                      className="text-xs px-2 py-1 rounded border"
                      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }}>
                      {Array.from({ length: 8 }).map((_, i) => (
                        <option key={i} value={i}>{i === 0 ? 'None' : `Fret ${i}`}
                          {i === activeSong.capoSuggested && i > 0 ? ' (suggested)' : ''}</option>
                      ))}
                    </select>
                  </div>
                  {/* Auto-scroll */}
                  <label className="flex items-center gap-1 text-xs cursor-pointer" style={{ color: 'var(--color-muted)' }}>
                    <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} />
                    Auto-scroll
                  </label>
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
                        No playback source — chart-only mode. Use “Add chord at playhead” with the time scrubber, or attach a YouTube URL when creating the song.
                      </p>
                    )}

                    {/* Chord chart */}
                    <div ref={chartRef} className="rounded-xl border p-3"
                      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                        <span className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
                          Chord Chart {loadingChords && <span style={{ color: 'var(--color-muted)' }}>· Loading…</span>}
                        </span>
                        <div className="flex items-center gap-2">
                          <button onClick={addChordAtPlayhead} disabled={addingChord}
                            className="text-xs px-2 py-1 rounded border"
                            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                            {addingChord ? 'Adding…' : 'Add chord at playhead'}
                          </button>
                          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                            Click to correct · Hover for diagram
                          </span>
                        </div>
                      </div>

                      {chords.length === 0 && !loadingChords && (
                        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                          No chords yet — wait for detection, or add them manually.
                        </p>
                      )}

                      <div className="flex flex-wrap gap-1.5">
                        {chords.map((ev, idx) => {
                          const label = displayChord(ev.chordRoot, ev.chordQuality || '', transpose, capoFret);
                          const isActive = idx === activeChordIdx;
                          const isLow    = !ev.isUserCorrected && ev.confidenceScore < 0.4;
                          return (
                            <div key={ev.id} data-chord-idx={idx} className="relative group">
                              <button
                                onClick={() => setCorrecting({ ...ev, songId: activeSong.id })}
                                className="flex flex-col items-center px-2 py-1 rounded-lg text-xs transition-all"
                                style={{
                                  background: isActive ? 'var(--color-primary)' : 'var(--color-bg)',
                                  color: isActive ? '#fff' : isLow ? '#d97706' : 'var(--color-text)',
                                  border: `1px solid ${isActive ? 'var(--color-primary)' : isLow ? '#d97706' : 'var(--color-border)'}`,
                                  fontWeight: isActive ? 700 : 400,
                                  minWidth: 40,
                                }}>
                                <span className="font-mono">{label}</span>
                                <span style={{ color: isActive ? 'rgba(255,255,255,0.7)' : 'var(--color-muted)', fontSize: 9 }}>
                                  {fmtTime(parseFloat(ev.timestampSec))}
                                </span>
                                {ev.isUserCorrected && (
                                  <span title="Manually corrected" style={{ fontSize: 8, color: isActive ? 'rgba(255,255,255,0.8)' : '#16a34a' }}>✓</span>
                                )}
                              </button>
                              {/* Diagram on hover */}
                              <div className="absolute z-30 hidden group-hover:block"
                                style={{ bottom: '100%', left: '50%', transform: 'translateX(-50%)', paddingBottom: 4 }}>
                                <QuickDiagram chordName={ev.chordRoot + (ev.chordQuality || '')} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Right: fretboard + loops */}
                  <div className="flex flex-col gap-4">
                    {/* Fretboard */}
                    <div className="rounded-xl border p-3"
                      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                      <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text)' }}>
                        Fretboard {fretboardChord && `— ${displayChord(fretboardChord.root, fretboardChord.quality, transpose, capoFret)}`}
                      </p>
                      {fretboardChord
                        ? <Fretboard chordRoot={transposeRoot(fretboardChord.root, transpose - capoFret)} chordQuality={fretboardChord.quality} />
                        : <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Play the song to see the active chord.</p>
                      }
                    </div>

                    {/* Practice loops */}
                    <div className="rounded-xl border p-3"
                      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                      <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Practice Loops</p>
                      <div className="flex gap-1 mb-2">
                        <input value={loopName} onChange={e => setLoopName(e.target.value)}
                          placeholder="Loop name…"
                          className="flex-1 text-xs px-2 py-1 rounded border"
                          style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }} />
                        <button onClick={saveLoop}
                          className="text-xs px-2 py-1 rounded border font-medium"
                          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                          + Save at current
                        </button>
                      </div>
                      {loops.length === 0
                        ? <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No loops yet.</p>
                        : loops.map(l => (
                          <div key={l.id} className="flex items-center gap-1 mb-1">
                            <button onClick={() => activateLoop(l)}
                              className="flex-1 text-xs px-2 py-1 rounded text-left truncate"
                              style={{
                                background: loopActive?.id === l.id ? 'var(--color-primary)' : 'var(--color-bg)',
                                color: loopActive?.id === l.id ? '#fff' : 'var(--color-text)',
                                border: '1px solid var(--color-border)',
                              }}>
                              {l.name} <span style={{ opacity: 0.7 }}>{fmtTime(l.startTimeSec)}–{fmtTime(l.endTimeSec)}</span>
                            </button>
                            {loopActive?.id === l.id && (
                              <button onClick={() => setLoopActive(null)}
                                className="text-xs px-1.5 py-1 rounded border"
                                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>✕</button>
                            )}
                            <button onClick={() => deleteLoop(l.id)}
                              className="text-xs px-1.5 py-1 rounded border"
                              style={{ borderColor: 'rgba(220,38,38,0.3)', color: '#dc2626' }}>🗑</button>
                          </div>
                        ))
                      }
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
    </div>
  );
}

// Quick diagram shown on chord hover (fetches lazily)
function QuickDiagram({ chordName }) {
  const [shapes, setShapes] = useState(null);
  useEffect(() => {
    api.get(`/api/guitar/chord-shapes/${encodeURIComponent(chordName)}`)
      .then(r => r.json()).then(d => setShapes(d)).catch(() => setShapes([]));
  }, [chordName]);

  if (!shapes || !shapes[0]) return null;
  return (
    <div className="rounded-lg shadow-xl p-2"
      style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
      <ChordDiagram shape={shapes[0]} />
    </div>
  );
}
