import React, { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import useToastStore from '../../store/toastStore';
import useProcessingStore from '../../store/processingStore';
import Tooltip from '../../components/Tooltip';
import { NOTE_TIPS } from './noteTips.mjs';
import {
  MAX_RECORD_SEC, WARN_RECORD_SEC, pickMimeType, extensionForMime, formatTimer, describeMicError, canRecord,
  STYLE_CHOICES, KEEP_CHOICES, readPrefs, savePrefs, describeRecovered, describePrefs,
} from './voiceNoteUtils.mjs';
import * as recovery from './voiceRecovery';

/**
 * "New voice note": record from the microphone, then the words are written into a new note. The recording is turned into text on the
 * server and, unless the person chose to keep it (for 7 days, or until they delete it), thrown away; only the text is kept otherwise.
 * Opened from the Notes page; `onCreated(note)` receives the new note (with `todos`, `audio`, `audioNotKept`) and the page selects it.
 *
 * States: idle -> recording <-> paused -> (stop) working -> done. If the upload or the writing-up fails, or the phone stops the recording
 * (the screen locks, another app takes the microphone), what was recorded is kept ('failed') so it can be sent again. While recording, every
 * second of audio is also saved on this device (voiceRecovery.js), so a crash or a closed page does not lose it: next time the recorder
 * opens it offers to make the note from what was saved.
 * Server: POST /api/notes/voice (docs/voice-notes.md).
 */

const muted = { color: 'var(--color-muted)' };

export default function VoiceNoteRecorder({ onClose, onCreated, mobile = false }) {
  const getIcon = useIcon();
  const addToast = useToastStore((s) => s.addToast);
  const { startProcessing, stopProcessing } = useProcessingStore();

  const supported = canRecord(typeof window !== 'undefined' ? window : undefined);
  const [phase, setPhase] = useState('idle'); // idle | recording | paused | working | failed
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [prefs, setPrefsState] = useState(() => readPrefs(typeof localStorage !== 'undefined' ? localStorage : null));
  const [error, setError] = useState('');
  const [interrupted, setInterrupted] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [showOptions, setShowOptions] = useState(false); // the two choices are tucked away: Start comes first
  const [leftover, setLeftover] = useState(null); // an unfinished recording found on this device: { meta, blob }

  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const blobRef = useRef(null);
  const elapsedRef = useRef(0);
  const timerRef = useRef(null);
  const audioCtxRef = useRef(null);
  const rafRef = useRef(0);
  const wakeRef = useRef(null);
  const sendOnStopRef = useRef(false);
  const mimeRef = useRef('');
  const phaseRef = useRef('idle');
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  phaseRef.current = phase;
  const callbacksRef = useRef({});
  callbacksRef.current = { onCreated, onClose };

  const setPrefs = (patch) => {
    const next = { ...prefsRef.current, ...patch };
    setPrefsState(next);
    savePrefs(typeof localStorage !== 'undefined' ? localStorage : null, next);
  };

  // A leftover recording from a crash or a closed page? Offer it before anything else.
  useEffect(() => {
    let alive = true;
    recovery.loadLeftover().then((found) => {
      if (!alive || !found) return;
      if ((found.meta.elapsed || 0) < 2) { recovery.clear(); return; } // a stray second or two is not worth asking about
      if (phaseRef.current === 'idle') setLeftover(found);
    });
    return () => { alive = false; };
  }, []);

  // Keep the screen on while recording: a phone that locks its screen stops the recording.
  const holdScreen = useCallback(async () => {
    try { if (navigator.wakeLock && !wakeRef.current) wakeRef.current = await navigator.wakeLock.request('screen'); } catch { /* the screen may lock; the recording is still saved on the device */ }
  }, []);
  const releaseScreen = useCallback(() => {
    try { wakeRef.current?.release(); } catch { /* already released */ }
    wakeRef.current = null;
  }, []);

  const releaseMic = useCallback(() => {
    clearInterval(timerRef.current);
    cancelAnimationFrame(rafRef.current);
    try { audioCtxRef.current?.close(); } catch (_) { /* already closed */ }
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    releaseScreen();
    setLevel(0);
  }, [releaseScreen]);

  // Leaving the page while a recording exists would lose it (it is saved on this device, but it is better not to leave).
  useEffect(() => {
    const warn = (e) => {
      if (['recording', 'paused', 'working', 'failed'].includes(phaseRef.current)) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  // Coming back to the page: the screen lock releases the wake lock, and some phones stop the recorder. Take the screen again, and if the
  // recorder was stopped under us, keep what was recorded so far so the note can still be made.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (!['recording', 'paused'].includes(phaseRef.current)) return;
      holdScreen();
      const rec = recorderRef.current;
      if (rec && rec.state === 'inactive') {
        blobRef.current = new Blob(chunksRef.current, { type: mimeRef.current || 'audio/webm' });
        releaseMic();
        setInterrupted(true);
        setError('The recording was interrupted (the screen locked or another app used the microphone). What was recorded so far is kept.');
        setPhase('failed');
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [holdScreen, releaseMic]);

  useEffect(() => () => {
    sendOnStopRef.current = false;
    try { if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop(); } catch (_) { /* already stopped */ }
    releaseMic();
  }, [releaseMic]);

  const send = useCallback(async (blobOverride, mimeOverride) => {
    const blob = blobOverride || blobRef.current;
    if (!blob || !blob.size) { setError('There was nothing recorded. Try again.'); setPhase('failed'); return; }
    blobRef.current = blob;
    setPhase('working');
    setError('');
    setInterrupted(false);
    startProcessing('Turning your voice into a note…', 'Listening to the recording and writing it up. A long recording can take a minute or two.');
    try {
      const fd = new FormData();
      fd.append('audio', blob, `recording.${extensionForMime(blob.type || mimeOverride || mimeRef.current)}`);
      fd.append('style', prefsRef.current.style);
      fd.append('keep', prefsRef.current.keep);
      const res = await api.postForm('/api/notes/voice', fd);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The note could not be made. Try again.');
      blobRef.current = null;
      recovery.clear(); // the note exists now: the copy on this device is no longer needed
      addToast('Voice note saved', 'success');
      callbacksRef.current.onCreated?.(data);
      callbacksRef.current.onClose?.();
    } catch (err) {
      setError(err.message || 'The note could not be made. Try again.');
      setPhase('failed'); // the recording is kept, so it can be tried again
    } finally {
      stopProcessing();
    }
  }, [addToast, startProcessing, stopProcessing]);

  const stopAndMake = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec || rec.state === 'inactive') return;
    sendOnStopRef.current = true;
    rec.stop();
    releaseMic();
  }, [releaseMic]);

  const watchLevel = (stream) => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      let last = 0;
      const tick = (now) => {
        analyser.getByteTimeDomainData(data);
        if (now - last > 90) {
          last = now;
          let peak = 0;
          for (let i = 0; i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i] - 128));
          setLevel(Math.min(1, peak / 90));
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (_) { /* the level bar is a nicety; recording works without it */ }
  };

  const start = async () => {
    setError('');
    setInterrupted(false);
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      setError(describeMicError(err));
      return;
    }
    streamRef.current = stream;
    const mimeType = pickMimeType((t) => MediaRecorder.isTypeSupported(t));
    let rec;
    try {
      rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch (err) {
      releaseMic();
      setError(describeMicError(err));
      return;
    }
    mimeRef.current = rec.mimeType || mimeType || '';
    chunksRef.current = [];
    blobRef.current = null;
    elapsedRef.current = 0;
    setElapsed(0);
    setLeftover(null);
    recovery.begin({ mime: mimeRef.current, startedAt: new Date().toISOString() });
    let index = 0;
    rec.ondataavailable = (e) => {
      if (!e.data?.size) return;
      chunksRef.current.push(e.data);
      recovery.addChunk(index, e.data, elapsedRef.current); index += 1; // the copy on this device
    };
    rec.onerror = () => { setError('The recording failed. Try again.'); releaseMic(); setPhase('idle'); };
    rec.onstop = () => {
      blobRef.current = new Blob(chunksRef.current, { type: mimeRef.current || 'audio/webm' });
      if (sendOnStopRef.current) { sendOnStopRef.current = false; send(); } else { setPhase('failed'); }
    };
    recorderRef.current = rec;
    rec.start(1000);
    setPhase('recording');
    watchLevel(stream);
    holdScreen();
    timerRef.current = setInterval(() => {
      if (recorderRef.current?.state !== 'recording') return;
      elapsedRef.current += 0.25;
      setElapsed(elapsedRef.current);
      if (elapsedRef.current >= MAX_RECORD_SEC) stopAndMake();
    }, 250);
  };

  const togglePause = () => {
    const rec = recorderRef.current;
    if (!rec) return;
    if (rec.state === 'recording') { rec.pause(); setPhase('paused'); } else if (rec.state === 'paused') { rec.resume(); setPhase('recording'); }
  };

  const discard = () => {
    sendOnStopRef.current = false;
    try { if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop(); } catch (_) { /* already stopped */ }
    releaseMic();
    blobRef.current = null;
    chunksRef.current = [];
    recovery.clear();
    onClose?.();
  };

  const makeFromLeftover = () => {
    if (!leftover) return;
    elapsedRef.current = leftover.meta.elapsed || 0;
    setElapsed(elapsedRef.current);
    mimeRef.current = leftover.meta.mime || leftover.blob.type || '';
    const found = leftover;
    setLeftover(null);
    send(found.blob, found.meta.mime);
  };
  const dropLeftover = () => { recovery.clear(); setLeftover(null); };

  const live = phase === 'recording' || phase === 'paused';
  const closeOrConfirm = () => {
    if (live || phase === 'failed') setConfirmDiscard(true); else onClose?.();
  };
  const nearlyFull = live && elapsed >= WARN_RECORD_SEC;
  const field = { background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)', fontSize: 16, minHeight: mobile ? 48 : 36 };
  const hintFor = STYLE_CHOICES.find((c) => c.value === prefs.style)?.hint || '';

  return (
    <div className={`fixed inset-0 flex ${mobile ? 'items-end' : 'items-center'} justify-center z-50 ${mobile ? '' : 'p-4'}`} style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div
        className={`${mobile ? 'rounded-t-2xl' : 'rounded-2xl'} p-5 sm:p-6 max-w-md w-full shadow-xl space-y-4 max-h-full overflow-y-auto`}
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', paddingBottom: mobile ? 'max(20px, env(safe-area-inset-bottom))' : undefined }}
        role="dialog" aria-label="New voice note"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>New voice note</h3>
          <button
            type="button" aria-label="Close" onClick={closeOrConfirm} disabled={phase === 'working'}
            className="hover:opacity-60 transition-opacity duration-200 disabled:opacity-30 flex items-center justify-center"
            style={{ ...muted, background: 'none', border: 'none', cursor: 'pointer', minWidth: mobile ? 40 : 24, minHeight: mobile ? 40 : 24 }}
          >
            {getIcon('x', { size: 18 })}
          </button>
        </div>

        {!supported && (
          <p className="text-sm" style={{ color: '#b45309' }}>
            This browser can't record from a microphone here. Recording needs a secure page (https) and a browser that allows it, such as a current Chrome, Edge, Firefox or Safari.
          </p>
        )}

        {supported && phase === 'idle' && leftover && (
          <div className="rounded-xl p-3 space-y-2" style={{ background: 'var(--color-bg)', border: '1px solid #f59e0b' }} role="status">
            <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>You have an unfinished recording</p>
            <p className="text-xs" style={muted}>{describeRecovered(leftover.meta)}. It was kept on this device because the page closed before the note was made. Starting a new recording replaces it.</p>
            <div className="flex gap-2">
              <Tooltip text={NOTE_TIPS.voiceRecoverMake}>
                <button type="button" onClick={makeFromLeftover} className="flex-1 px-3 rounded-lg text-sm font-medium hover:opacity-80 transition-opacity duration-200" style={{ background: 'var(--color-primary)', color: '#fff', minHeight: mobile ? 48 : 36 }}>Make the note</button>
              </Tooltip>
              <Tooltip text={NOTE_TIPS.voiceRecoverDiscard}>
                <button type="button" onClick={dropLeftover} className="flex-1 px-3 rounded-lg text-sm hover:opacity-70 transition-opacity duration-200" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text)', minHeight: mobile ? 48 : 36 }}>Throw it away</button>
              </Tooltip>
            </div>
          </div>
        )}

        {supported && phase === 'idle' && (
          <>
            <p className="text-sm" style={{ color: 'var(--color-text)' }}>
              Press Start and talk. When you stop, your words are written into a new note.
            </p>
            {error && <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>}
            <button
              type="button" onClick={start}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-base font-medium transition-opacity duration-200 hover:opacity-80"
              style={{ background: 'var(--color-primary)', color: '#fff', minHeight: mobile ? 56 : 44 }}
            >
              {getIcon('mic', { size: 18 })} Start recording
            </button>
            <div className="text-xs space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span style={muted}>{describePrefs(prefs)}</span>
                <Tooltip text={NOTE_TIPS.voiceOptions}>
                  <button type="button" onClick={() => setShowOptions((v) => !v)} aria-expanded={showOptions} className="underline hover:opacity-70 transition-opacity duration-200 flex-shrink-0" style={{ color: 'var(--color-primary)', minHeight: mobile ? 36 : 24 }}>{showOptions ? 'Done' : 'Change'}</button>
                </Tooltip>
              </div>
              {showOptions && (
                <div className="space-y-3">
                  <label className="block space-y-1" style={muted}>
                    Write it up as
                    <Tooltip text={NOTE_TIPS.voiceStyle}>
                      <select value={prefs.style} onChange={(e) => setPrefs({ style: e.target.value })} className="w-full rounded-lg px-2 text-sm" style={field}>
                        {STYLE_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    </Tooltip>
                    <span className="block">{hintFor} You can write it up another way afterwards from the same words.</span>
                  </label>
                  <label className="block space-y-1" style={muted}>
                    The recording itself
                    <Tooltip text={NOTE_TIPS.voiceKeep}>
                      <select value={prefs.keep} onChange={(e) => setPrefs({ keep: e.target.value })} className="w-full rounded-lg px-2 text-sm" style={field}>
                        {KEEP_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    </Tooltip>
                    <span className="block">{prefs.keep === 'no' ? 'It is turned into text and then deleted. Only the text is kept.' : 'You can play it from the note. It counts towards your file storage.'} This has to be chosen before you record.</span>
                  </label>
                </div>
              )}
              <p style={muted}>If other people are talking, let them know you are recording.</p>
            </div>
          </>
        )}

        {supported && live && (
          <div className="space-y-4">
            <div className="flex items-center justify-center gap-3">
              <span
                className="inline-block w-3 h-3 rounded-full"
                style={{ background: '#ef4444', opacity: phase === 'recording' ? 1 : 0.35, animation: phase === 'recording' ? 'pulse 1.2s ease-in-out infinite' : undefined }}
              />
              <span className="text-4xl font-semibold tabular-nums" style={{ color: 'var(--color-text)' }}>{formatTimer(elapsed)}</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }} aria-label="Microphone level">
              <div className="h-full transition-all duration-100" style={{ width: `${Math.round(level * 100)}%`, background: 'var(--color-primary)' }} />
            </div>
            <p className="text-xs text-center" style={muted}>
              {phase === 'paused' ? 'Paused' : level < 0.03 ? 'Listening… speak and the bar should move. If it stays flat, check your microphone.' : 'Recording'}
            </p>
            <p className="text-xs text-center" style={muted}>Keep this page open while you record. It is also saved on this device as you go.</p>
            {nearlyFull && <p className="text-xs text-center" style={{ color: '#b45309' }}>Nearly at the one-hour limit. It stops by itself and makes the note.</p>}
            <div className="flex flex-wrap gap-2">
              <button
                type="button" onClick={togglePause}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 rounded-xl text-sm border transition-opacity duration-200 hover:opacity-70"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', minHeight: mobile ? 52 : 44 }}
              >
                {getIcon(phase === 'paused' ? 'play' : 'pause', { size: 14 })} {phase === 'paused' ? 'Resume' : 'Pause'}
              </button>
              <button
                type="button" onClick={stopAndMake}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 rounded-xl text-sm font-medium transition-opacity duration-200 hover:opacity-80"
                style={{ background: 'var(--color-primary)', color: '#fff', minHeight: mobile ? 52 : 44 }}
              >
                {getIcon('square', { size: 14 })} Stop and make the note
              </button>
            </div>
          </div>
        )}

        {phase === 'working' && (
          <p className="text-sm" style={muted}>Turning your recording into a note…</p>
        )}

        {phase === 'failed' && (
          <div className="space-y-3">
            <p className="text-sm" style={{ color: '#ef4444' }}>{error || 'The note could not be made.'}</p>
            {blobRef.current?.size ? <p className="text-xs" style={muted}>Your recording ({formatTimer(elapsed)}) is still here, so you can {interrupted ? 'make the note from it' : 'try again'}.</p> : null}
            <div className="flex gap-2">
              {blobRef.current?.size ? (
                <button
                  type="button" onClick={() => send()}
                  className="flex-1 px-3 rounded-xl text-sm font-medium transition-opacity duration-200 hover:opacity-80"
                  style={{ background: 'var(--color-primary)', color: '#fff', minHeight: mobile ? 52 : 44 }}
                >
                  {interrupted ? 'Make the note' : 'Try again'}
                </button>
              ) : null}
              <button
                type="button" onClick={discard}
                className="flex-1 px-3 rounded-xl text-sm border transition-opacity duration-200 hover:opacity-70"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', minHeight: mobile ? 52 : 44 }}
              >
                Discard
              </button>
            </div>
          </div>
        )}

        {confirmDiscard && (
          <div className="flex items-center gap-3 text-sm" style={{ color: 'var(--color-text)' }}>
            <span>Discard this recording?</span>
            <button type="button" onClick={discard} className="font-medium transition-opacity duration-200 hover:opacity-70" style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', minHeight: 32 }}>Yes</button>
            <button type="button" onClick={() => setConfirmDiscard(false)} className="transition-opacity duration-200 hover:opacity-70" style={{ ...muted, background: 'none', border: 'none', cursor: 'pointer', minHeight: 32 }}>No</button>
          </div>
        )}
      </div>
    </div>
  );
}
