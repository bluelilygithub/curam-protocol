import { Mail } from 'lucide-react';
import { useState } from 'react';
import { api, type Track } from './api';
import { Field, Mic } from './Mic';
import { useStore } from './store';
import { spokenEmail } from './voice';

type Format = 'gpx' | 'tcx' | 'kml';
const errText = (e: unknown): string => (e instanceof Error ? e.message : 'That did not work.');

/** Get a saved track onto a Zepp watch (Amazfit Bip 6 and similar): download the file or email it to yourself, then import it in the Zepp app. */
export function SendToWatch({ track }: { track: Track }) {
  const { emailEnabled, toast } = useStore();
  const [format, setFormat] = useState<Format>('gpx');
  const [to, setTo] = useState('');
  const [copy, setCopy] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [problem, setProblem] = useState('');

  async function download(f: Format): Promise<void> {
    try { await api.downloadFile(track.id, track.name, f); } catch (err) { toast('error', errText(err)); }
  }
  async function send(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (sending) return;
    setSending(true); setProblem(''); setSent(null);
    try {
      await api.emailFile(track.id, { to: to.trim(), format, copyToMe: copy });
      setSent(to.trim());
      toast('ok', 'Email sent');
    } catch (err) { setProblem(errText(err)); } finally { setSending(false); }
  }

  return (
    <div className="stack" role="group" aria-label="Send to a watch" data-testid="watch-panel">
      <p className="hint">Get the file onto your phone (download it there, or email it to yourself), then in the Zepp app go to <b>Profile → your watch → Routes</b> (the name varies by app version), choose <b>Import</b>, pick the file and sync the watch.</p>
      <div className="row" role="radiogroup" aria-label="File format">
        {(['gpx', 'tcx', 'kml'] as const).map((f) => (
          <label key={f} className="check" title={f === 'gpx' ? 'GPX: try this one first' : f === 'tcx' ? 'TCX course file, if GPX is not accepted' : 'KML file, if the others are not accepted'}>
            <input type="radio" name="watch-format" checked={format === f} onChange={() => setFormat(f)} /> {f.toUpperCase()}
          </label>
        ))}
      </div>
      <button type="button" onClick={() => void download(format)} title={`Save the ${format.toUpperCase()} file to this device`} data-testid="watch-download">Download {format.toUpperCase()}</button>
      <form className="stack" onSubmit={(e) => void send(e)} data-testid="watch-email">
        {!emailEnabled && <p className="hint" data-testid="watch-email-off">Email is not set up on this server yet, so only Download works for now.</p>}
        <Field label="Email the file to">{(id) => <span className="vwrap"><input id={id} type="email" required maxLength={254} autoComplete="email" disabled={!emailEnabled || sending} value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com" title="One email address to send the file to, such as your own" /><Mic label="Say the address, for example: michael at example dot com" onDone={(t) => { setTo(spokenEmail(t).slice(0, 254)); }} /></span>}</Field>
        <label className="check"><input type="checkbox" checked={copy} disabled={!emailEnabled || sending} onChange={(e) => setCopy(e.target.checked)} title="Also send a copy to your own Vault email address" /> Send me a copy</label>
        {problem && <p role="alert" className="hint err" data-testid="watch-email-error">{problem}</p>}
        {sent && <p role="status" className="hint ok" data-testid="watch-email-sent">Sent to {sent}.</p>}
        <button type="submit" disabled={!emailEnabled || sending || !to.trim()} title={emailEnabled ? `Email the ${format.toUpperCase()} file as an attachment` : 'Email is not set up on this server yet'}><Mail size={16} aria-hidden="true" /> {sending ? 'Sending…' : `Email ${format.toUpperCase()}`}</button>
      </form>
      <p className="hint">TCX times are placeholders so the file is valid; they are not a pace.</p>
    </div>
  );
}
