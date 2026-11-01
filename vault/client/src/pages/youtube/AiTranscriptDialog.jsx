import React, { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../utils/apiClient';
import Dialog from '../../components/Dialog';
import { formatUsd, formatWait, formatLength, elapsedText, TRANSCRIPTS_CHANGED } from './youtubeFormat.mjs';

// "Generate a transcript with AI" for a video that has no captions. It first tells the person what it will cost and how long it will take, and
// does nothing until they press Generate. The work happens on the server in the background: closing this window does not stop it, and the finished
// transcript is saved with the video whether or not the window is open. Reopening it while a job is running picks up the progress.

const btn = { fontFamily: 'inherit', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem', padding: '0.5rem 1rem', borderRadius: '0.5rem', border: '1px solid var(--color-border)' };
const row = { display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '0.4rem 0', borderBottom: '1px solid var(--color-border)', fontSize: '0.85rem' };
const label = { color: 'var(--color-muted)' };
const value = { color: 'var(--color-text)', fontWeight: 600, textAlign: 'right' };

export default function AiTranscriptDialog({ video, onClose, onDone }) {
  const [phase, setPhase] = useState('loading'); // loading | confirm | unavailable | running | done | error
  const [plan, setPlan] = useState(null);
  const [message, setMessage] = useState('');
  const [startedAt, setStartedAt] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [result, setResult] = useState(null);
  const poll = useRef(null);
  const alive = useRef(true);
  // The parent hands in a new onDone every time it draws; keeping it in a ref stops that from restarting the polling.
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const finish = useCallback((saved) => {
    setResult(saved || null);
    setPhase('done');
    document.dispatchEvent(new CustomEvent(TRANSCRIPTS_CHANGED));
    if (doneRef.current) doneRef.current();
  }, []);

  const watch = useCallback(() => {
    clearInterval(poll.current);
    poll.current = setInterval(async () => {
      try {
        const d = await api.get(`/api/youtube/ai-transcript/${video.id}`).then((r) => r.json());
        if (!alive.current) return;
        if (d.job && d.job.status === 'done' && d.saved) { clearInterval(poll.current); finish(d.saved); }
        else if (d.job && d.job.status === 'error') { clearInterval(poll.current); setMessage(d.job.error || 'The transcript could not be written.'); setPhase('error'); }
        else if (!d.job && d.saved) { clearInterval(poll.current); finish(d.saved); }
        else if (!d.job && !d.saved) { clearInterval(poll.current); setMessage('The transcript job was lost (the server may have restarted). Nothing was saved or charged for. Please try again.'); setPhase('error'); }
      } catch (_) { /* a missed check is fine, the next one asks again */ }
    }, 3000);
  }, [video.id, finish]);

  useEffect(() => {
    alive.current = true;
    (async () => {
      try {
        const st = await api.get(`/api/youtube/ai-transcript/${video.id}`).then((r) => r.json());
        if (st.saved) { setResult(st.saved); setPhase('done'); return; }
        if (st.job && st.job.status === 'running') { setStartedAt(st.job.startedAt); setPhase('running'); watch(); return; }
        const p = await api.get(`/api/youtube/ai-transcript/${video.id}/plan`).then((r) => r.json());
        if (p.error) throw new Error(p.error);
        setPlan(p);
        if (p.saved) { setResult({}); setPhase('done'); return; }
        setPhase(p.available ? 'confirm' : 'unavailable');
        if (!p.available) setMessage(p.reason || 'This video cannot be transcribed.');
      } catch (e) {
        setMessage(e.message || 'Could not work out the cost just now.');
        setPhase('unavailable');
      }
    })();
    return () => { alive.current = false; clearInterval(poll.current); };
  }, [video.id, watch]);

  useEffect(() => {
    if (phase !== 'running') return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase]);

  async function generate() {
    setPhase('running');
    setStartedAt(Date.now());
    try {
      const res = await api.post('/api/youtube/ai-transcript', { videoId: video.id });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not start.');
      watch();
    } catch (e) {
      setMessage(e.message || 'Could not start.');
      setPhase('error');
    }
  }

  const footer = (() => {
    if (phase === 'confirm') {
      return (
        <>
          <button onClick={onClose} style={{ ...btn, background: 'var(--color-bg)', color: 'var(--color-muted)' }}>Cancel</button>
          <button onClick={generate} style={{ ...btn, background: 'var(--color-primary)', color: '#fff', borderColor: 'var(--color-primary)' }}>Generate transcript</button>
        </>
      );
    }
    if (phase === 'running') return <button onClick={onClose} style={{ ...btn, background: 'var(--color-bg)', color: 'var(--color-muted)' }}>Close, keep working</button>;
    if (phase === 'error') {
      return (
        <>
          <button onClick={onClose} style={{ ...btn, background: 'var(--color-bg)', color: 'var(--color-muted)' }}>Close</button>
          {plan && plan.available && <button onClick={generate} style={{ ...btn, background: 'var(--color-primary)', color: '#fff', borderColor: 'var(--color-primary)' }}>Try again</button>}
        </>
      );
    }
    return <button onClick={onClose} style={{ ...btn, background: 'var(--color-primary)', color: '#fff', borderColor: 'var(--color-primary)' }}>{phase === 'done' ? 'Done' : 'Close'}</button>;
  })();

  // Drawn in "raw" mode with inline styles so it always sits above the watch window and the transcript panel (they are positioned with inline z-index).
  // A click inside this window must not reach the windows underneath: React passes clicks up through the component tree, and the watch window and
  // the transcript panel close when they are clicked.
  return (
    <div onClick={(e) => e.stopPropagation()}>
    <Dialog
      raw
      onClose={onClose}
      label="Generate a transcript with AI"
      overlayStyle={{ position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', background: 'rgba(0,0,0,0.55)' }}
      panelStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '1rem', width: '100%', maxWidth: 480, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
    >
      <div style={{ padding: '0.9rem 1.1rem', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
        <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text)' }}>Generate a transcript with AI</h2>
        <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', fontSize: '1rem' }}>✕</button>
      </div>
      <div style={{ padding: '1rem 1.1rem', overflowY: 'auto', flex: 1 }}>
      <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: 'var(--color-text)', fontWeight: 600 }}>{(plan && plan.title) || video.title}</p>

      {phase === 'loading' && <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)', margin: 0 }}>Working out the cost…</p>}

      {phase === 'confirm' && plan && (
        <div>
          <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: 'var(--color-text)', lineHeight: 1.5 }}>
            This video has no captions Vault can read. Google&apos;s Gemini AI can listen to it and write a transcript with times. Nothing happens until you press Generate.
          </p>
          <div style={{ border: '1px solid var(--color-border)', borderRadius: '0.5rem', padding: '0.25rem 0.75rem', marginBottom: '0.75rem' }}>
            <div style={row}><span style={label}>Video length</span><span style={value}>{formatLength(plan.durationSec)}</span></div>
            <div style={row}><span style={label}>Estimated cost</span><span style={value}>about {formatUsd(plan.costUsd)} (up to {formatUsd(plan.costHighUsd)})</span></div>
            <div style={row}><span style={label}>Estimated wait</span><span style={value}>{formatWait(plan.waitLowSec, plan.waitHighSec)}</span></div>
            <div style={{ ...row, borderBottom: 'none' }}><span style={label}>AI model</span><span style={value}>{plan.model}</span></div>
          </div>
          <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.78rem', color: 'var(--color-muted)', lineHeight: 1.55 }}>
            <li>The cost is an estimate from the video&apos;s length and the model&apos;s published price. It is charged to your Gemini account, and the real figure is recorded under Usage &amp; Cost.</li>
            <li>It keeps working if you close this window, and the transcript is saved with the video when it is done.</li>
            <li>It listens to the sound, so it can mishear names and numbers. Check anything that matters.</li>
            <li>Works on public videos up to {formatLength(plan.maxSeconds)}.</li>
          </ul>
        </div>
      )}

      {phase === 'unavailable' && <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text)', lineHeight: 1.5 }}>{message}</p>}

      {phase === 'running' && (
        <div>
          <p style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', color: 'var(--color-text)' }}>Gemini is listening to the video and writing the transcript… <strong>{elapsedText(now - (startedAt || now))}</strong></p>
          {plan && <p style={{ margin: '0 0 0.5rem', fontSize: '0.78rem', color: 'var(--color-muted)' }}>Expected: {formatWait(plan.waitLowSec, plan.waitHighSec)}.</p>}
          <div role="progressbar" aria-label="Writing the transcript" style={{ height: 6, borderRadius: 3, background: 'var(--color-border)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: '40%', background: 'var(--color-primary)', animation: 'ytIndeterminate 1.4s ease-in-out infinite' }} />
          </div>
          <p style={{ margin: '0.75rem 0 0', fontSize: '0.78rem', color: 'var(--color-muted)' }}>You can close this window. It keeps working and saves the transcript with the video.</p>
          <style>{'@keyframes ytIndeterminate { 0% { margin-left: -40%; } 100% { margin-left: 100%; } }'}</style>
        </div>
      )}

      {phase === 'done' && (
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text)', lineHeight: 1.5 }}>
          The transcript is written and saved with this video{result && result.lines ? ` (${result.lines} lines${result.costUsd ? `, about ${formatUsd(result.costUsd)}` : ''})` : ''}. Open Transcript, Insights or Ask to use it. It was written by AI from the sound, so check anything important.
        </p>
      )}

      {phase === 'error' && <p style={{ margin: 0, fontSize: '0.85rem', color: '#b91c1c', lineHeight: 1.5 }}>{message}</p>}
      </div>
      <div style={{ padding: '0.75rem 1.1rem', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>{footer}</div>
    </Dialog>
    </div>
  );
}
