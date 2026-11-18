import React, { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import Skeleton from '../../components/Skeleton';
import Dialog from '../../components/Dialog';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import { brisbaneTime } from './ponytailFormat.mjs';

const BTN = 'px-3.5 py-1.5 rounded-lg text-sm border transition-opacity duration-200 hover:opacity-70 disabled:opacity-50';
const btnStyle = { borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const PRIMARY = 'px-3.5 py-1.5 rounded-lg text-sm font-medium transition-opacity duration-200 hover:opacity-80 disabled:opacity-50';
const primaryStyle = { background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' };
const mono = 'font-mono text-xs break-all rounded-lg border px-3 py-2';
const monoStyle = { borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' };
const STEP = 'text-sm leading-relaxed';

async function copy(text, addToast, what) {
  try { await navigator.clipboard.writeText(text); addToast(`${what} copied`, 'success'); } catch { addToast('Could not copy', 'error'); }
}

// Everything needed to connect Ponytail: a key (shown once), the address to paste, the steps in Claude Code, the key list, and a CSV backfill.
export default function SetupPanel({ onImported }) {
  const getIcon = useIcon();
  const addToast = useToastStore((s) => s.addToast);
  const [tokens, setTokens] = useState(null);
  const [label, setLabel] = useState('');
  const [made, setMade] = useState(null); // the key itself, only until the dialog is closed
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);
  const webhookUrl = `${window.location.origin}/api/ponytail/ingest`;

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/ponytail/tokens');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load the keys');
      setTokens(data.tokens);
    } catch (err) { addToast(err.message, 'error'); setTokens([]); }
  }, [addToast]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setBusy(true);
    try {
      const res = await api.post('/api/ponytail/tokens', { label: label.trim() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not make a key');
      setMade(data.token);
      setLabel('');
      load();
    } catch (err) { addToast(err.message, 'error'); } finally { setBusy(false); }
  };

  const revoke = async (id) => {
    try {
      const res = await api.delete(`/api/ponytail/tokens/${id}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not revoke');
      addToast('Key revoked', 'success');
      setRevoking(null);
      load();
    } catch (err) { addToast(err.message, 'error'); }
  };

  const importCsv = async (file) => {
    if (!file) return;
    setImporting(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.postForm('/api/ponytail/import', fd);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Import failed');
      setResult(data);
      addToast(`${data.added} added, ${data.updated} updated`, 'success');
      onImported?.();
    } catch (err) { addToast(err.message, 'error'); } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const active = (tokens || []).filter((t) => !t.revokedAt);

  return (
    <section id="ponytail-setup" className="rounded-2xl border p-5 space-y-5" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
      <div>
        <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Setup</h3>
        <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>Connect Ponytail in Claude Code to this page. It sends one row per task after every turn.</p>
      </div>

      <div className="flex flex-col xl:grid xl:grid-cols-2 xl:items-start gap-5">
        <div className="space-y-3">
          <h4 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>1. Make a key</h4>
          <div className="flex flex-col sm:flex-row gap-2">
            <Tooltip text="A name to tell your keys apart, such as the computer it is on. Optional.">
              <div className="flex-1 min-w-0"><VoiceInput value={label} onChange={setLabel} placeholder="Laptop" label="Key name" /></div>
            </Tooltip>
            <Tooltip text="Makes a new key. It is shown once: copy it into Ponytail straight away. Vault keeps only a fingerprint of it.">
              <button type="button" onClick={create} disabled={busy || active.length >= 5} className={PRIMARY} style={primaryStyle}>{busy ? 'Making…' : 'Make a key'}</button>
            </Tooltip>
          </div>

          <h4 className="text-sm font-semibold pt-2" style={{ color: 'var(--color-text)' }}>2. The webhook URL</h4>
          <div className="flex items-center gap-2">
            <code className={`${mono} flex-1`} style={monoStyle}>{webhookUrl}</code>
            <Tooltip text="Copy the address to paste into Ponytail's Webhook URL.">
              <button type="button" onClick={() => copy(webhookUrl, addToast, 'Webhook URL')} className={BTN} style={btnStyle} aria-label="Copy webhook URL">{getIcon('copy', { size: 14 })}</button>
            </Tooltip>
          </div>

          <h4 className="text-sm font-semibold pt-2" style={{ color: 'var(--color-text)' }}>3. In Claude Code</h4>
          <ol className={`${STEP} list-decimal pl-5 space-y-1`} style={{ color: 'var(--color-text)' }}>
            <li>Type <code>/plugin</code> and open <strong>Installed</strong>.</li>
            <li>Choose <strong>ponytail</strong>, then <strong>Configure</strong>.</li>
            <li>Paste the address above into <strong>Webhook URL</strong> and the key into <strong>Webhook token</strong>.</li>
            <li>Press <strong>Save</strong>. The next turn in any task arrives here.</li>
          </ol>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Turn &ldquo;Send task names&rdquo; off in the same place to send tasks without their names. To stop sending, clear the Webhook URL, or revoke the key below.</p>
        </div>

        <div className="space-y-3">
          <h4 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Your keys</h4>
          {!tokens ? <Skeleton lines={2} label="Loading keys" /> : !tokens.length ? (
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No keys yet.</p>
          ) : (
            <ul className="space-y-2">
              {tokens.map((t) => (
                <li key={t.id} className="rounded-xl border p-3 flex items-center gap-3 text-sm" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', opacity: t.revokedAt ? 0.6 : 1 }}>
                  <span style={{ color: 'var(--color-muted)' }}>{getIcon('key', { size: 14 })}</span>
                  <div className="flex-1 min-w-0">
                    <div style={{ color: 'var(--color-text)' }}>{t.label} <span className="font-mono text-xs" style={{ color: 'var(--color-muted)' }}>{t.hint}</span></div>
                    <div className="text-xs" style={{ color: 'var(--color-muted)' }}>
                      {t.revokedAt ? `Revoked ${brisbaneTime(t.revokedAt)}` : t.lastUsedAt ? `Last used ${brisbaneTime(t.lastUsedAt)}` : 'Not used yet'}
                    </div>
                  </div>
                  {!t.revokedAt && (revoking === t.id ? (
                    <span className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text)' }}>
                      Revoke?
                      <button type="button" onClick={() => revoke(t.id)} className="px-2 py-1 rounded-lg border text-xs transition-opacity duration-200 hover:opacity-70" style={{ borderColor: '#ef4444', color: '#ef4444' }}>Yes</button>
                      <button type="button" onClick={() => setRevoking(null)} className="px-2 py-1 rounded-lg border text-xs transition-opacity duration-200 hover:opacity-70" style={btnStyle}>No</button>
                    </span>
                  ) : (
                    <Tooltip text="Stops this key working at once. Ponytail then shows 'webhook answered 401' until it has a new key.">
                      <button type="button" onClick={() => setRevoking(t.id)} className="text-xs transition-opacity duration-200 hover:opacity-70" style={{ color: 'var(--color-muted)' }}>Revoke</button>
                    </Tooltip>
                  ))}
                </li>
              ))}
            </ul>
          )}

          <h4 className="text-sm font-semibold pt-2" style={{ color: 'var(--color-text)' }}>Backfill from the CSV</h4>
          <p className={STEP} style={{ color: 'var(--color-muted)' }}>
            Ponytail also keeps every task in a file per project. Import it to add tasks from before the webhook was set up. Importing the same file again only updates; it never makes copies, and never overwrites a task the webhook sent.
          </p>
          <div className="text-xs space-y-1" style={{ color: 'var(--color-muted)' }}>
            <div>Windows: <code className="font-mono" style={{ color: 'var(--color-text)' }}>%USERPROFILE%\.config\ponytail\band\&lt;project&gt;.csv</code></div>
            <div>macOS / Linux: <code className="font-mono" style={{ color: 'var(--color-text)' }}>~/.config/ponytail/band/&lt;project&gt;.csv</code></div>
          </div>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => importCsv(e.target.files?.[0])} />
          <Tooltip text="Choose a Ponytail ledger file (.csv, up to 2 MB). Rows that cannot be read are listed and skipped.">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={importing} className={`${BTN} inline-flex items-center gap-2`} style={btnStyle}>
              {getIcon('upload', { size: 14 })}{importing ? 'Importing…' : 'Import a CSV file'}
            </button>
          </Tooltip>
          {result && (
            <div className="rounded-xl border p-3 text-xs space-y-1" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }} role="status">
              <div>{result.added} added · {result.updated} updated · {result.kept} already sent by the webhook (left alone) · {result.skipped} skipped</div>
              {result.problems?.length > 0 && (
                <ul className="list-disc pl-4" style={{ color: 'var(--color-muted)' }}>
                  {result.problems.slice(0, 10).map((p) => <li key={p.line}>Line {p.line}: {p.reason}</li>)}
                  {result.problems.length > 10 && <li>and {result.problems.length - 10} more</li>}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      {made && (
        <Dialog title="Your new Ponytail key" onClose={() => setMade(null)} size="lg" closeOnBackdrop={false} footer={
          <button type="button" onClick={() => setMade(null)} className={PRIMARY} style={primaryStyle}>I have copied it</button>
        }>
          <div className="px-5 py-4 space-y-3">
            <p className="text-sm" style={{ color: 'var(--color-text)' }}>Copy it now and paste it into Ponytail&rsquo;s <strong>Webhook token</strong>. It is not shown again: Vault keeps only a fingerprint of it.</p>
            <div className="flex items-center gap-2">
              <code className={`${mono} flex-1`} style={monoStyle}>{made}</code>
              <Tooltip text="Copy the key.">
                <button type="button" onClick={() => copy(made, addToast, 'Key')} className={BTN} style={btnStyle} aria-label="Copy key">{getIcon('copy', { size: 14 })}</button>
              </Tooltip>
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
}
