import React, { useCallback, useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import Tooltip from '../../components/Tooltip';
import { Card, PrimaryButton, SecondaryButton, FOCUS_RING } from '../measurements/shared';
import { fmtMB, fmtWhen } from './format.mjs';

// Safe clean-up: the ONE place PC Health can change anything on the PC. It can only empty the short fixed list the server offers
// (Temp, npm, pip and Yarn caches), only items the person switches on and confirms, and only when the helper was started with
// -AllowCleanup. The server sends item names to the helper, never paths. See docs/pc-health.md.

const muted = { color: 'var(--color-muted)' };
const text = { color: 'var(--color-text)' };
const toast = (message, type = 'error') => useToastStore.getState().addToast(message, type);

function Switch({ on, onChange, label, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative shrink-0 w-10 h-6 rounded-full transition-colors duration-200 disabled:opacity-40 ${FOCUS_RING}`}
      style={{ background: on ? 'var(--color-primary)' : 'var(--color-border)' }}
    >
      <span className="absolute top-0.5 w-5 h-5 rounded-full transition-all duration-200" style={{ left: on ? '1.15rem' : '0.125rem', background: '#fff' }} />
    </button>
  );
}

export default function CleanupPanel({ status, goTo }) {
  const [data, setData] = useState(null);
  const [picked, setPicked] = useState({});
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/api/pc-health/cleanup');
      if (r.ok) setData(await r.json());
    } catch (_) { /* next poll */ }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { // poll while a clean-up is waiting or running
    if (!data?.active) return undefined;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [data?.active, load]);

  const candidates = data?.candidates || [];
  const chosen = candidates.filter((c) => picked[c.id]);
  const totalMB = chosen.reduce((a, c) => a + c.sizeMB, 0);
  const allowed = !!data?.helperAllowsCleanup;
  const online = !!status?.helper?.online;

  const start = async () => {
    setBusy(true);
    try {
      const r = await api.post('/api/pc-health/cleanups', { items: chosen.map((c) => c.id), confirm: true });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) toast(d.error || 'Could not start the clean-up.');
      else { setPicked({}); }
    } finally { setBusy(false); setConfirming(false); load(); }
  };
  const cancel = async (id) => {
    const r = await api.post(`/api/pc-health/cleanups/${id}/cancel`, {});
    if (!r.ok) toast('It had already started, so it cannot be cancelled.');
    load();
  };

  if (!data) return <p className="text-sm" style={muted}>Loading…</p>;

  const active = data.active;
  const last = data.history?.[0];
  const command = `powershell -ExecutionPolicy Bypass -File .\\pc-health-helper.ps1 -Server ${window.location.origin} -Token <your key> -AllowCleanup`;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl p-4 space-y-1" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderLeft: '4px solid #f59e0b' }} role="note" data-tour="pch-cleanup-note">
        <p className="text-sm font-semibold" style={text}>This is the only place PC Health can change anything.</p>
        <p className="text-xs" style={muted}>
          It can only empty the short list below: your Temp folder (files over a day old) and the npm, pip and Yarn download caches. All of them rebuild themselves.
          Nothing else is ever offered or removed. Deleting is permanent: these files do not go to the Recycle Bin, and projects, documents and installed programs are never touched.
        </p>
      </div>

      {!data.scanId && (
        <Card><p className="text-sm" style={text}>There is no finished scan yet, so nothing can be offered.</p><SecondaryButton onClick={() => goTo('scan')}>Run a scan</SecondaryButton></Card>
      )}

      {data.scanId && !allowed && (
        <Card data-tour="pch-cleanup-allow">
          <p className="text-sm font-medium" style={{ color: '#f59e0b' }}>The helper on your PC is not allowed to clean up.</p>
          <p className="text-xs" style={muted}>As a second lock, the helper only carries out a clean-up if you start it with the extra word <strong>-AllowCleanup</strong>. Stop it (Ctrl+C in its window), then run your usual command with that added at the end:</p>
          <pre className="p-3 rounded-xl text-[11px] whitespace-pre-wrap break-all" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', ...text }}>{command}</pre>
          <p className="text-xs" style={muted}>{online ? 'The helper is connected, so this page updates by itself when it restarts.' : 'The helper is not running right now.'} If you no longer have your key, make a new one on <button type="button" className={`underline ${FOCUS_RING}`} onClick={() => goTo('helper')}>Set up the helper</button>.</p>
          <SecondaryButton onClick={load}>Check again</SecondaryButton>
        </Card>
      )}

      {data.scanId && (
        <Card data-tour="pch-cleanup-list">
          <p className="text-xs font-semibold" style={muted}>Safe to clear, from your latest scan</p>
          {candidates.length === 0 && <p className="text-sm" style={muted}>Nothing on the safe list was big enough to show in the latest scan. Nothing to do.</p>}
          <ul>
            {candidates.map((c) => (
              <li key={c.id} className="py-3 flex gap-3 items-start border-b last:border-b-0" style={{ borderColor: 'var(--color-border)' }}>
                <Tooltip text={picked[c.id] ? 'On: this will be cleared when you confirm.' : 'Off: this will be left alone.'}>
                  <span><Switch on={!!picked[c.id]} onChange={(v) => setPicked((p) => ({ ...p, [c.id]: v }))} label={`Clear ${c.label}`} disabled={!!active || !allowed} /></span>
                </Tooltip>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium" style={text}>{c.label} <span className="font-normal" style={muted}>· about {fmtMB(c.sizeMB)}</span></p>
                  <p className="text-[11px] font-mono break-all" style={muted}>{c.path}</p>
                  <div className="text-xs mt-1 space-y-0.5" style={text}>
                    <p><strong>What is removed.</strong> {c.removes}</p>
                    <p><strong>Why it is safe.</strong> {c.safe}</p>
                    <p><strong>Afterwards.</strong> {c.after}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {candidates.length > 0 && !active && (
            <div className="pt-1 space-y-2">
              {confirming ? (
                <div className="text-sm space-y-2" style={text}>
                  <p>Clear {chosen.length} item{chosen.length === 1 ? '' : 's'} (about {fmtMB(totalMB)}) now? This cannot be undone.</p>
                  <div className="flex gap-2">
                    <PrimaryButton onClick={start} disabled={busy}>{busy ? 'Starting…' : 'Yes, clear them'}</PrimaryButton>
                    <SecondaryButton onClick={() => setConfirming(false)}>No</SecondaryButton>
                  </div>
                </div>
              ) : (
                <Tooltip text={!allowed ? 'The helper must be started with -AllowCleanup first (see the box above).' : chosen.length ? 'Asks for a final confirmation before anything is cleared.' : 'Switch on at least one item first.'}>
                  <PrimaryButton onClick={() => setConfirming(true)} disabled={!allowed || chosen.length === 0} data-tour="pch-cleanup-button">
                    {chosen.length ? `Clear ${chosen.length} selected (about ${fmtMB(totalMB)})` : 'Switch on the items to clear'}
                  </PrimaryButton>
                </Tooltip>
              )}
            </div>
          )}
        </Card>
      )}

      {active && (
        <Card>
          <p className="text-sm font-medium" style={text}>{active.status === 'queued' ? 'Waiting for the helper…' : 'Clearing…'}</p>
          <p className="text-xs" style={muted}>The helper picks it up within 30 seconds and the result appears here. Clearing {(active.items || []).length} item{(active.items || []).length === 1 ? '' : 's'}.</p>
          {active.status === 'queued' && <SecondaryButton onClick={() => cancel(active.id)}>Cancel before it starts</SecondaryButton>}
        </Card>
      )}

      {last && !active && (
        <Card>
          <p className="text-xs font-semibold" style={muted}>Last clean-up · {fmtWhen(last.finishedAt)}</p>
          {last.status === 'done' ? (
            <ul className="text-sm space-y-1" style={text}>
              {(last.results || []).map((r) => (
                <li key={r.id}>
                  {r.ok ? '✓' : '✗'} {r.label}: {fmtMB(r.freedMB)} freed ({r.filesRemoved.toLocaleString('en-AU')} files){r.skipped ? `, ${r.skipped.toLocaleString('en-AU')} left alone` : ''}{r.note ? ` — ${r.note}` : ''}
                </li>
              ))}
              <li className="text-xs pt-1" style={muted}>Run a new scan to see the new drive figures.</li>
            </ul>
          ) : <p className="text-sm" style={text}>{last.status}{last.error ? `: ${last.error}` : ''}</p>}
        </Card>
      )}
    </div>
  );
}
