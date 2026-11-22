import React, { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../utils/apiClient';
import Dialog from '../../components/Dialog';

// Download a video or its audio with yt-dlp on the server (server/services/youtubeDownload.js). The person picks a quality and confirms they may
// download it; the server saves it in the background (progress shown), then Save file sends it to the browser once and deletes it from the server.
// Closing the window does not stop it: the job id is remembered per video for this visit, so reopening picks the progress up again.

const KINDS = [
  { id: 'video720', label: 'Video, up to 720p (MP4)', hint: 'Smaller file. Good for most uses.' },
  { id: 'video1080', label: 'Video, up to 1080p (MP4)', hint: 'Sharper, about twice the size.' },
  { id: 'audio', label: 'Audio only (MP3)', hint: 'Just the sound: talks, podcasts, music practice.' },
];
const jobsByVideo = new Map(); // videoId -> job id, for this visit

const btn = { fontFamily: 'inherit', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem', padding: '0.5rem 1rem', borderRadius: '0.5rem', border: '1px solid var(--color-border)' };
const primary = { ...btn, background: 'var(--color-primary)', color: '#fff', borderColor: 'var(--color-primary)' };
const plain = { ...btn, background: 'var(--color-bg)', color: 'var(--color-muted)' };
const fmtSize = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${Math.max(0.1, n / 1e6).toFixed(1)} MB`);

export default function DownloadDialog({ video, onClose }) {
  const [phase, setPhase] = useState('choose'); // choose | running | done | saving | saved | error
  const [kind, setKind] = useState('video720');
  const [rights, setRights] = useState(false);
  const [job, setJob] = useState(null);
  const [message, setMessage] = useState('');
  const poll = useRef(null);
  const alive = useRef(true);

  const watch = useCallback((id) => {
    clearInterval(poll.current);
    const check = async () => {
      try {
        const res = await api.get(`/api/youtube/download/${id}`);
        const d = await res.json();
        if (!alive.current) return;
        if (!res.ok) { clearInterval(poll.current); jobsByVideo.delete(video.id); setMessage(d.error || 'That download is gone.'); setPhase('error'); return; }
        setJob(d.job);
        if (d.job.status === 'done') { clearInterval(poll.current); setPhase('done'); }
        else if (d.job.status === 'error') { clearInterval(poll.current); jobsByVideo.delete(video.id); setMessage(d.job.error); setPhase('error'); }
      } catch (_) { /* a missed check is fine, the next one asks again */ }
    };
    check();
    poll.current = setInterval(check, 2000);
  }, [video.id]);

  useEffect(() => {
    alive.current = true;
    const known = jobsByVideo.get(video.id);
    if (known) { setPhase('running'); watch(known); }
    return () => { alive.current = false; clearInterval(poll.current); };
  }, [video.id, watch]);

  async function start() {
    setMessage('');
    try {
      const res = await api.post('/api/youtube/download', { videoId: video.id, kind, title: video.title, confirmRights: rights });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not start the download.');
      jobsByVideo.set(video.id, d.job.id);
      setJob(d.job);
      setPhase('running');
      watch(d.job.id);
    } catch (e) {
      setMessage(e.message);
      setPhase('error');
    }
  }

  async function save() {
    setPhase('saving');
    try {
      await api.download(`/api/youtube/download/${job.id}/file`, job.filename || 'youtube-video');
      jobsByVideo.delete(video.id);
      setPhase('saved');
    } catch (e) {
      jobsByVideo.delete(video.id);
      setMessage(e.message || 'Could not fetch the file.');
      setPhase('error');
    }
  }

  const footer = {
    choose: (<><button onClick={onClose} style={plain}>Cancel</button><button onClick={start} disabled={!rights} style={{ ...primary, opacity: rights ? 1 : 0.5, cursor: rights ? 'pointer' : 'not-allowed' }}>Download</button></>),
    running: <button onClick={onClose} style={plain}>Close, keep downloading</button>,
    done: (<><button onClick={onClose} style={plain}>Later</button><button onClick={save} style={primary}>Save file</button></>),
    saving: <button disabled style={{ ...plain, cursor: 'wait' }}>Saving…</button>,
    saved: <button onClick={onClose} style={primary}>Done</button>,
    error: (<><button onClick={onClose} style={plain}>Close</button><button onClick={() => { setPhase('choose'); setMessage(''); }} style={primary}>Try again</button></>),
  }[phase];

  // Raw mode with inline z-index so it sits above the watch window; clicks inside must not reach the window underneath (it closes on click).
  return (
    <div onClick={(e) => e.stopPropagation()}>
    <Dialog
      raw
      onClose={onClose}
      label="Download this video"
      overlayStyle={{ position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', background: 'rgba(0,0,0,0.55)' }}
      panelStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '1rem', width: '100%', maxWidth: 480, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
    >
      <div style={{ padding: '0.9rem 1.1rem', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
        <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text)' }}>Download</h2>
        <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', fontSize: '1rem' }}>✕</button>
      </div>
      <div style={{ padding: '1rem 1.1rem', overflowY: 'auto', flex: 1 }}>
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: 'var(--color-text)', fontWeight: 600 }}>{video.title}</p>

        {phase === 'choose' && (
          <div>
            <fieldset style={{ border: 'none', margin: '0 0 0.75rem', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <legend style={{ fontSize: '0.78rem', color: 'var(--color-muted)', marginBottom: '0.35rem' }}>What to download</legend>
              {KINDS.map((k) => (
                <label key={k.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', fontSize: '0.85rem', color: 'var(--color-text)', cursor: 'pointer', padding: '0.45rem 0.6rem', borderRadius: '0.5rem', border: `1px solid ${kind === k.id ? 'var(--color-primary)' : 'var(--color-border)'}` }}>
                  <input type="radio" name="yt-dl-kind" value={k.id} checked={kind === k.id} onChange={() => setKind(k.id)} style={{ marginTop: 3 }} />
                  <span><strong>{k.label}</strong><br /><span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>{k.hint}</span></span>
                </label>
              ))}
            </fieldset>
            <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', fontSize: '0.8rem', color: 'var(--color-text)', lineHeight: 1.45, cursor: 'pointer' }}>
              <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} style={{ marginTop: 3 }} />
              <span>I may download this video: it is mine, it has a Creative Commons licence, or its owner has given permission.</span>
            </label>
            <p style={{ margin: '0.75rem 0 0', fontSize: '0.75rem', color: 'var(--color-muted)', lineHeight: 1.5 }}>
              YouTube&apos;s terms allow downloading only with permission. The server fetches the file (up to 2 GB), then you save it; it is deleted from the server once saved, or after 30 minutes. YouTube sometimes blocks cloud servers, so a download can fail.
            </p>
          </div>
        )}

        {phase === 'running' && (
          <div>
            <p style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', color: 'var(--color-text)' }}>Downloading on the server… <strong>{job && job.percent ? `${Math.round(job.percent)}%` : 'starting'}</strong></p>
            <div role="progressbar" aria-label="Download progress" aria-valuenow={Math.round((job && job.percent) || 0)} aria-valuemin={0} aria-valuemax={100} style={{ height: 6, borderRadius: 3, background: 'var(--color-border)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${(job && job.percent) || 2}%`, background: 'var(--color-primary)', transition: 'width 0.4s' }} />
            </div>
            <p style={{ margin: '0.75rem 0 0', fontSize: '0.78rem', color: 'var(--color-muted)' }}>Video and sound come down separately, so the bar can run twice, then they are joined. You can close this window and open Download again to come back to it.</p>
          </div>
        )}

        {phase === 'done' && job && <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text)', lineHeight: 1.5 }}>Ready: <strong>{job.filename}</strong> ({fmtSize(job.size || 0)}). Press Save file to put it in your downloads. It can be saved once, within 30 minutes.</p>}
        {phase === 'saving' && <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text)' }}>Sending the file to your browser…</p>}
        {phase === 'saved' && <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text)', lineHeight: 1.5 }}>Saved to your downloads, and deleted from the server.</p>}
        {phase === 'error' && <p style={{ margin: 0, fontSize: '0.85rem', color: '#b91c1c', lineHeight: 1.5 }}>{message}</p>}
      </div>
      <div style={{ padding: '0.75rem 1.1rem', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>{footer}</div>
    </Dialog>
    </div>
  );
}
