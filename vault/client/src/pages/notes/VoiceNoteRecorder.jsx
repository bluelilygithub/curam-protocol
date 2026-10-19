import React, { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import useToastStore from '../../store/toastStore';
import useProcessingStore from '../../store/processingStore';
import {
  MAX_RECORD_SEC, WARN_RECORD_SEC, pickMimeType, extensionForMime, formatTimer, describeMicError, canRecord,
} from './voiceNoteUtils.mjs';

/**
 * "New voice note": record from the microphone, then the words are written into a new note (the recording itself is turned
 * into text on the server and deleted; only the text is kept). Opened from the Notes page; `onCreated(note)` receives the new
 * note and the page selects it.
 *
 * States: idle -> recording <-> paused -> (stop) working -> done. If the upload or the writing-up fails, the recording is kept
 * in memory ('failed') so it can be tried again; nothing is lost until the person discards it.
 * Server: POST /api/notes/voice (docs/voice-notes.md).
 */

const muted = { color: 'var(--color-muted)' };

export default function VoiceNoteRecorder({ onClose, onCreated }) {
  const getIcon = useIcon();
  const addToast = useToastStore((s) => s.addToast);
  const { startProcessing, stopProcessing } = useProcessingStore();

  const supported = canRecord(typeof window !== 'undefined' ? window : undefined);
  const [phase, setPhase] = useState('idle'); // idle | recording | paused | working | failed
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [tidy, setTidy] = useState(true);
  const [error, setError] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const blobRef = useRef(null);
  const elapsedRef = useRef(0);
  const timerRef = useRef(null);
  const audioCtxRef = useRef(null);
  const rafRef = useRef(0);
  const sendOnStopRef = useRef(false);
  const mimeRef = useRef('');
  const phaseRef = useRef('idle');
  const tidyRef = useRef(true);
  tidyRef.current = tidy;
  phaseRef.current = phase;
  const callbacksRef = useRef({});
  callbacksRef.current = { onCreated, onClose };

  const releaseMic = useCallback(() => {
    clearInterval(timerRef.current);
    cancelAnimationFrame(rafRef.current);
    try { audioCtxRef.current?.close(); } catch (_) { /* already closed */ }
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setLevel(0);
  }, []);

  // Leaving the page while a recording exists would lose it.
  useEffect(() => {
    const warn = (e) => {
      if (['recording', 'paused', 'working', 'failed'].includes(phaseRef.current)) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  useEffect(() => () => {
    sendOnStopRef.current = false;
    try { if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop(); } catch (_) { /* already stopped */ }
    releaseMic();
  }, [releaseMic]);

  const send = useCallback(async () => {
    const blob = blobRef.current;
    if (!blob || !blob.size) { setError('There was nothing recorded. Try again.'); setPhase('failed'); return; }
    setPhase('working');
    setError('');
    startProcessing('Turning your voice into a note…', 'Listening to the recording and writing it up. A long recording can take a minute or two.');
    try {
      const fd = new FormData();
      fd.append('audio', blob, `recording.${extensionForMime(blob.type || mimeRef.current)}`);
      fd.append('tidy', tidyRef.current ? 'true' : 'false');
      const res = await api.postForm('/api/notes/voice', fd);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The note could not be made. Try again.');
      blobRef.current = null;
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
    rec.ondataavailable = (e) => { if (e.data?.size) chunksRef.current.push(e.data); };
    rec.onerror = () => { setError('The recording failed. Try again.'); releaseMic(); setPhase('idle'); };
    rec.onstop = () => {
      blobRef.current = new Blob(chunksRef.current, { type: mimeRef.current || 'audio/webm' });
      if (sendOnStopRef.current) { sendOnStopRef.current = false; send(); } else { setPhase('failed'); }
    };
    recorderRef.current = rec;
    rec.start(1000);
    setPhase('recording');
    watchLevel(stream);
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
    onClose?.();
  };

  const live = phase === 'recording' || phase === 'paused';
  const closeOrConfirm = () => {
    if (live || phase === 'failed') setConfirmDiscard(true); else onClose?.();
  };
  const nearlyFull = live && elapsed >= WARN_RECORD_SEC;

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div
        className="rounded-2xl p-6 max-w-md w-full shadow-xl space-y-4"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        role="dialog" aria-label="New voice note"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>New voice note</h3>
          <button
            type="button" aria-label="Close" onClick={closeOrConfirm} disabled={phase === 'working'}
            className="hover:opacity-60 transition-opacity duration-200 disabled:opacity-30"
            style={{ ...muted, background: 'none', border: 'none', cursor: 'pointer' }}
          >
            {getIcon('x', { size: 18 })}
          </button>
        </div>

        {!supported && (
          <p className="text-sm" style={{ color: '#b45309' }}>
            This browser can't record from a microphone here. Recording needs a secure page (https) and a browser that allows it, such as a current Chrome, Edge, Firefox or Safari.
          </p>
        )}

        {supported && phase === 'idle' && (
          <>
            <p className="text-sm" style={{ color: 'var(--color-text)' }}>
              Talk through a plan or an idea, or record a chat across the table. When you stop, your words are written into a new note.
            </p>
            <label className="flex items-start gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
              <input type="checkbox" checked={tidy} onChange={(e) => setTidy(e.target.checked)} className="mt-1" />
              <span>
                Tidy it up into a note (summary, ideas, plan, to-dos)
                <span className="block text-xs" style={muted}>Off keeps your words exactly as spoken. Either way, what was said is kept at the bottom of the note.</span>
              </span>
            </label>
            <p className="text-xs" style={muted}>
              Your recording is turned into text and then deleted; only the text is kept. If other people are talking, let them know you are recording.
            </p>
            {error && <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>}
            <button
              type="button" onClick={start}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium transition-opacity duration-200 hover:opacity-80"
              style={{ background: 'var(--color-primary)', color: '#fff' }}
            >
              {getIcon('mic', { size: 16 })} Start recording
            </button>
          </>
        )}

        {supported && live && (
          <div className="space-y-4">
            <div className="flex items-center justify-center gap-3">
              <span
                className="inline-block w-3 h-3 rounded-full"
                style={{ background: '#ef4444', opacity: phase === 'recording' ? 1 : 0.35, animation: phase === 'recording' ? 'pulse 1.2s ease-in-out infinite' : undefined }}
              />
              <span className="text-3xl font-semibold tabular-nums" style={{ color: 'var(--color-text)' }}>{formatTimer(elapsed)}</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }} aria-label="Microphone level">
              <div className="h-full transition-all duration-100" style={{ width: `${Math.round(level * 100)}%`, background: 'var(--color-primary)' }} />
            </div>
            <p className="text-xs text-center" style={muted}>
              {phase === 'paused' ? 'Paused' : level < 0.03 ? 'Listening… speak and the bar should move. If it stays flat, check your microphone.' : 'Recording'}
            </p>
            {nearlyFull && <p className="text-xs text-center" style={{ color: '#b45309' }}>Nearly at the one-hour limit. It stops by itself and makes the note.</p>}
            <div className="flex flex-wrap gap-2">
              <button
                type="button" onClick={togglePause}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm border transition-opacity duration-200 hover:opacity-70"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                {getIcon(phase === 'paused' ? 'play' : 'pause', { size: 14 })} {phase === 'paused' ? 'Resume' : 'Pause'}
              </button>
              <button
                type="button" onClick={stopAndMake}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-opacity duration-200 hover:opacity-80"
                style={{ background: 'var(--color-primary)', color: '#fff' }}
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
            {blobRef.current?.size ? <p className="text-xs" style={muted}>Your recording ({formatTimer(elapsed)}) is still here, so you can try again.</p> : null}
            <div className="flex gap-2">
              {blobRef.current?.size ? (
                <button
                  type="button" onClick={send}
                  className="flex-1 px-3 py-2.5 rounded-xl text-sm font-medium transition-opacity duration-200 hover:opacity-80"
                  style={{ background: 'var(--color-primary)', color: '#fff' }}
                >
                  Try again
                </button>
              ) : null}
              <button
                type="button" onClick={discard}
                className="flex-1 px-3 py-2.5 rounded-xl text-sm border transition-opacity duration-200 hover:opacity-70"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                Discard
              </button>
            </div>
          </div>
        )}

        {confirmDiscard && (
          <div className="flex items-center gap-3 text-sm" style={{ color: 'var(--color-text)' }}>
            <span>Discard this recording?</span>
            <button type="button" onClick={discard} className="font-medium transition-opacity duration-200 hover:opacity-70" style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}>Yes</button>
            <button type="button" onClick={() => setConfirmDiscard(false)} className="transition-opacity duration-200 hover:opacity-70" style={{ ...muted, background: 'none', border: 'none', cursor: 'pointer' }}>No</button>
          </div>
        )}
      </div>
    </div>
  );
}
