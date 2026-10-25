import { Download, Mail, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, type Track } from './api';
import { buildProfile, maptilerTiles } from './elevation';
import { bboxOf, formatDistance } from './geo';
import { captureMap } from './mapCapture';
import { Field, Mic } from './Mic';
import { captureSize, chooseOrientation } from './mapLayout';
import { useStore } from './store';
import { turnCues } from './turns';
import { spokenEmail } from './voice';

type State = { status: 'making'; step: string } | { status: 'error'; message: string } | { status: 'ready'; blob: Blob; kb: number; noHeights: boolean; withDirections: boolean };

const errText = (e: unknown): string => (e instanceof Error ? e.message : 'That did not work.');
const fileBase = (name: string): string => (name.replace(/[^\w\- .]+/g, '_').trim().slice(0, 80) || 'route-map');
const fmtDate = (iso: string): string => new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });

function readBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(new Error('Could not read the PDF.'));
    r.readAsDataURL(blob);
  });
}

/**
 * The map of a saved track as a PDF to download or email. The PDF is made in the browser (only it has the map pictures) as soon as the
 * dialog opens; the same file is then downloaded or sent, so what you email is exactly what you could print.
 */
export function ExportPdf({ track, onClose }: { track: Track; onClose: () => void }) {
  const { mapKey, styleId, units, emailEnabled, toast } = useStore();
  const [state, setState] = useState<State>({ status: 'making', step: 'Getting the map ready…' });
  const [to, setTo] = useState('');
  const [message, setMessage] = useState('');
  const [copy, setCopy] = useState(true);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  useEffect(() => {
    let dead = false;
    setState({ status: 'making', step: 'Getting the map ready…' });
    (async () => {
      const lines = track.geometry.coordinates;
      const bbox = bboxOf(lines);
      if (!bbox || !mapKey) throw new Error('This track has no route to draw.');
      const orientation = chooseOrientation(bbox);
      const size = captureSize(orientation);
      // heights are optional: a PDF without the profile is still a good map
      const profileP = buildProfile(lines, maptilerTiles(mapKey)).then((p) => ({ p, note: null as string | null })).catch((e: unknown) => ({ p: null, note: `Heights not included (${errText(e).replace(/\.$/, '')}).` }));
      if (!dead) setState({ status: 'making', step: 'Drawing the map… this takes a few seconds.' });
      const picture = await captureMap({ bbox, styleId, key: mapKey, width: size.width, height: size.height });
      if (dead) return;
      setState({ status: 'making', step: 'Putting the page together…' });
      const prof = await profileP;
      const cues = track.cues?.length ? track.cues : turnCues(lines);
      const { buildMapPdf } = await import('./mapPdf');
      const bytes = await buildMapPdf({
        title: track.name, notes: track.notes, dateLabel: fmtDate(track.createdAt), lines, color: track.color, units, orientation,
        image: { bytes: picture.bytes, type: picture.type }, center: picture.center, zoom: picture.zoom, profile: prof.p, profileNote: prof.note,
        cues, // the same directions the track shows: street names if it has them, else from the line's shape
      });
      if (dead) return;
      const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
      setState({ status: 'ready', blob, kb: Math.round(blob.size / 1024), noHeights: !prof.p, withDirections: cues.length > 1 });
    })().catch((e: unknown) => { if (!dead) setState({ status: 'error', message: errText(e) }); });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id, attempt]);

  function download(): void {
    if (state.status !== 'ready') return;
    const url = URL.createObjectURL(state.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileBase(track.name)}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function send(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (state.status !== 'ready' || sending) return;
    setSending(true); setProblem(''); setSent(null);
    try {
      const pdf = await readBase64(state.blob);
      await api.emailMap({ to: to.trim(), subject: `Route map: ${track.name}`, message: message.trim(), copyToMe: copy, filename: fileBase(track.name), pdf });
      setSent(to.trim());
      toast('ok', 'Email sent');
    } catch (err) { setProblem(errText(err)); } finally { setSending(false); }
  }

  const ready = state.status === 'ready';
  return (
    <div className="modal-back" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Map as PDF" data-testid="pdf-dialog">
        <div className="modal-head">
          <h2>Map as PDF</h2>
          <button ref={closeRef} type="button" aria-label="Close" title="Close this window (Escape does the same)" onClick={onClose}><X size={16} aria-hidden="true" /></button>
        </div>
        <p className="hint">{track.name} · {formatDistance(track.distanceM / 1000, units)}</p>
        {state.status === 'making' && <p role="status" data-testid="pdf-making">{state.step}</p>}
        {state.status === 'error' && (
          <>
            <p role="alert" data-testid="pdf-error">{state.message}</p>
            <div className="row"><button type="button" onClick={() => setAttempt((n) => n + 1)} title="Make the PDF again">Try again</button></div>
          </>
        )}
        {ready && (
          <>
            <p role="status" data-testid="pdf-ready">Ready: {state.withDirections ? 'the map on one A4 page, then the directions' : 'one A4 page'}, {state.kb.toLocaleString('en-AU')} KB.{state.noHeights ? ' Heights could not be added.' : ''}</p>
            <button type="button" className="primary wide" onClick={download} title="Save the PDF to this device" data-testid="pdf-download"><Download size={16} aria-hidden="true" /> Download PDF</button>
            <hr />
            <form className="stack" onSubmit={(e) => void send(e)} data-testid="pdf-email">
              <h3 className="sub">Email it</h3>
              {!emailEnabled && <p className="hint" data-testid="pdf-email-off">Email is not set up on this server yet, so only Download works for now.</p>}
              <Field label="To">{(id) => <span className="vwrap"><input id={id} type="email" required maxLength={254} autoComplete="email" disabled={!emailEnabled || sending} value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com" title="One email address to send the PDF to" /><Mic label="Say the address, for example: michael at example dot com" onDone={(t) => { setTo(spokenEmail(t).slice(0, 254)); }} /></span>}</Field>
              <Field label="Message (optional)">{(id) => <span className="vwrap vwrap-area"><textarea id={id} rows={3} maxLength={2000} disabled={!emailEnabled || sending} value={message} onChange={(e) => setMessage(e.target.value)} title="Added above the attachment. Plain text, up to 2,000 characters." /><Mic area label="Speak the message, added to the end" onDone={(t) => { setMessage((m) => `${m.trim() ? `${m.trim()} ` : ''}${t.trim()}`.slice(0, 2000)); }} /></span>}</Field>
              <label className="check"><input type="checkbox" checked={copy} disabled={!emailEnabled || sending} onChange={(e) => setCopy(e.target.checked)} title="Also send a copy to your own Vault email address" /> Send me a copy</label>
              {problem && <p role="alert" className="hint err" data-testid="pdf-email-error">{problem}</p>}
              {sent && <p role="status" className="hint ok" data-testid="pdf-email-sent">Sent to {sent}.</p>}
              <button type="submit" className="wide" disabled={!emailEnabled || sending || !to.trim()} title={emailEnabled ? 'Email the PDF as an attachment' : 'Email is not set up on this server yet'}><Mail size={16} aria-hidden="true" /> {sending ? 'Sending…' : 'Email PDF'}</button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
