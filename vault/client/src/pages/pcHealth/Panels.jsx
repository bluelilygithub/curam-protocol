import React, { useMemo, useState } from 'react';
import Tooltip from '../../components/Tooltip';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import { parseSpokenNumber } from '../../utils/units/numbers.mjs';
import { Card, PrimaryButton, SecondaryButton, FOCUS_RING } from '../measurements/shared';
import { fmtMB, fmtGB, fmtWhen, fmtDay, SEVERITY, LEFTOVER_LABEL, STATUS_LABEL } from './format.mjs';
import { buildReportText } from './reportText.mjs';

// Every panel here only DISPLAYS a report. Nothing on this page deletes, moves or changes a file on the PC.

const muted = { color: 'var(--color-muted)' };
const text = { color: 'var(--color-text)' };

function Empty({ children }) {
  return <p className="text-sm" style={muted}>{children}</p>;
}

function Badge({ severity }) {
  const s = SEVERITY[severity] || SEVERITY.info;
  return (
    <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-md border" style={{ color: s.color || 'var(--color-muted)', borderColor: s.color || 'var(--color-border)' }}>
      {s.label}
    </span>
  );
}

function CopyPath({ path }) {
  const [done, setDone] = useState(false);
  return (
    <Tooltip text="Copy this location so you can look at it yourself in File Explorer. Nothing is opened or changed.">
      <button
        type="button"
        onClick={() => { navigator.clipboard?.writeText(path).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => {}); }}
        className={`text-[11px] underline hover:opacity-60 transition-opacity duration-200 ${FOCUS_RING}`}
        style={muted}
      >
        {done ? 'Copied ✓' : 'Copy location'}
      </button>
    </Tooltip>
  );
}

function MoreInfo({ more }) {
  return (
    <div className="mt-2 rounded-xl p-3 space-y-2 text-xs" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', ...text }}>
      <p><strong>What it is.</strong> {more.what}</p>
      <p><strong>Why it matters.</strong> {more.why}</p>
      {more.options?.length > 0 && (
        <div>
          <p><strong>What you could do</strong> <span style={muted}>(your decision; PC Health never does it for you)</span></p>
          <ul className="list-disc pl-5 mt-1 space-y-0.5">{more.options.map((o) => <li key={o}>{o}</li>)}</ul>
        </div>
      )}
      {more.caution && <p style={{ color: '#f59e0b' }}><strong>Check first.</strong> {more.caution}</p>}
    </div>
  );
}

function FindingRow({ f }) {
  const [open, setOpen] = useState(false);
  const hasMore = !!f.more?.what;
  return (
    <li className="py-2.5 flex gap-3 items-start border-b last:border-b-0" style={{ borderColor: 'var(--color-border)' }}>
      <Badge severity={f.severity} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium" style={text}>{f.title}</p>
        <p className="text-xs mt-0.5" style={muted}>{f.detail}</p>
        {f.path && (
          <p className="text-[11px] mt-1 font-mono break-all" style={muted}>{f.path} <span className="ml-1 font-sans"><CopyPath path={f.path} /></span></p>
        )}
        {hasMore && (
          <>
            <Tooltip text="What this is, why it matters, and what you could consider doing. It only explains; nothing is changed for you.">
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className={`mt-1.5 text-[11px] font-medium hover:opacity-60 transition-opacity duration-200 ${FOCUS_RING}`}
                style={{ color: 'var(--color-primary)' }}
              >
                {open ? '▼ Less info' : '▶ More info'}
              </button>
            </Tooltip>
            {open && <MoreInfo more={f.more} />}
          </>
        )}
      </div>
    </li>
  );
}

function FindingList({ findings, empty }) {
  if (!findings.length) return <Empty>{empty}</Empty>;
  return <ul>{findings.map((f) => <FindingRow key={f.id} f={f} />)}</ul>;
}

function Bar({ pct, color }) {
  return (
    <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }} role="presentation">
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color || 'var(--color-primary)' }} />
    </div>
  );
}

const barColor = (usedPct) => (usedPct >= 90 ? '#ef4444' : usedPct >= 80 ? '#f59e0b' : null);

function CopyReport({ scan }) {
  const [done, setDone] = useState('');
  const copy = (withMore, key) => {
    navigator.clipboard?.writeText(buildReportText(scan, { withMore })).then(() => { setDone(key); setTimeout(() => setDone(''), 1800); }).catch(() => {});
  };
  return (
    <div className="flex flex-wrap gap-2" data-tour="pch-copy">
      <Tooltip text="Copies this report as plain text so you can paste it into a chat, an email or a note. Findings, drives, memory, biggest folders and top programs.">
        <SecondaryButton onClick={() => copy(false, 'short')}>{done === 'short' ? 'Copied ✓' : 'Copy report'}</SecondaryButton>
      </Tooltip>
      <Tooltip text="The same report, with each finding's explanation and options written out. Longer, and best for asking someone what to do about it.">
        <SecondaryButton onClick={() => copy(true, 'full')}>{done === 'full' ? 'Copied ✓' : 'Copy with explanations'}</SecondaryButton>
      </Tooltip>
    </div>
  );
}

function NoScan({ goTo }) {
  return (
    <Card>
      <p className="text-sm" style={text}>There is no finished scan yet.</p>
      <p className="text-xs" style={muted}>First connect the helper on your PC, then ask it for a scan. Nothing on your PC is changed by either step.</p>
      <div className="flex gap-2">
        <SecondaryButton onClick={() => goTo('helper')}>Set up the helper</SecondaryButton>
        <PrimaryButton onClick={() => goTo('scan')}>Run a scan</PrimaryButton>
      </div>
    </Card>
  );
}

function ScanHeader({ scan }) {
  const s = scan.summary || {};
  const r = scan.report || {};
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium" style={text}>
        {r.machine?.hostname || 'Your PC'} · scanned {fmtWhen(scan.finishedAt)}
      </p>
      <p className="text-xs" style={muted}>
        {s.high || 0} high · {s.watch || 0} to watch · {r.scan?.filesSeen?.toLocaleString?.('en-AU') || 0} files looked at in {r.scan?.seconds || 0}s
      </p>
      {r.scan?.truncated && (
        <p className="text-xs" style={{ color: '#f59e0b' }}>This scan hit its time limit and stopped early, so sizes may be too low. Run it again with a longer time limit or a narrower place to look.</p>
      )}
      {r.scan?.skipped > 0 && (
        <p className="text-xs" style={muted}>{r.scan.skipped.toLocaleString('en-AU')} folders could not be read (Windows keeps them private), so their sizes are not counted.</p>
      )}
    </div>
  );
}

// ── Overview ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function OverviewPanel({ scan, goTo }) {
  const [all, setAll] = useState(false);
  if (!scan) return <NoScan goTo={goTo} />;
  const findings = scan.findings?.findings || [];
  const important = findings.filter((f) => f.severity !== 'info');
  const shown = all ? important : important.slice(0, 12);
  const r = scan.report;
  const used = r.machine.ramTotalMB ? ((r.machine.ramTotalMB - r.machine.ramFreeMB) / r.machine.ramTotalMB) * 100 : 0;
  return (
    <div className="space-y-4" data-tour="pch-overview">
      <Card>
        <ScanHeader scan={scan} />
        <CopyReport scan={scan} />
        <div data-tour="pch-findings">
          <FindingList findings={shown} empty="Nothing needs a look in this scan." />
          {important.length > 12 && (
            <SecondaryButton className="mt-2" onClick={() => setAll((v) => !v)}>{all ? 'Show fewer' : `Show all ${important.length}`}</SecondaryButton>
          )}
        </div>
      </Card>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-xs font-semibold" style={muted}>Drives</p>
          {r.drives.map((d) => {
            const usedPct = d.sizeGB ? ((d.sizeGB - d.freeGB) / d.sizeGB) * 100 : 0;
            return (
              <div key={d.name} className="space-y-1">
                <p className="text-xs" style={text}>{d.name} {d.label} · {fmtGB(d.freeGB)} free of {fmtGB(d.sizeGB)}</p>
                <Bar pct={usedPct} color={barColor(usedPct)} />
              </div>
            );
          })}
        </Card>
        <Card>
          <p className="text-xs font-semibold" style={muted}>Memory</p>
          <p className="text-sm" style={text}>{fmtMB(r.machine.ramTotalMB - r.machine.ramFreeMB)} used of {fmtMB(r.machine.ramTotalMB)}</p>
          <Bar pct={used} color={barColor(used)} />
        </Card>
        <Card>
          <p className="text-xs font-semibold" style={muted}>Processor</p>
          <p className="text-sm" style={text}>{Math.round(r.machine.cpuLoadPct)}% busy when scanned</p>
          <Bar pct={r.machine.cpuLoadPct} color={barColor(r.machine.cpuLoadPct)} />
          <p className="text-[11px]" style={muted}>{r.machine.cpuName} · {r.machine.cores} threads · on for {r.machine.uptimeHours} h</p>
        </Card>
      </div>
    </div>
  );
}

// ── Run a scan ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function ScanPanel({ status, onStart, onCancel, goTo }) {
  const [wholeDrive, setWholeDrive] = useState(false);
  const [largeMB, setLargeMB] = useState('500');
  const [minutes, setMinutes] = useState('10');
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  const active = status?.active;
  const helper = status?.helper;

  const start = async () => {
    setBusy(true);
    try {
      await onStart({
        wholeDrive,
        roots: wholeDrive ? [] : extra.split('\n').map((l) => l.trim()).filter(Boolean),
        largeFileMB: Number(largeMB) || 500,
        minutes: Number(minutes) || 10,
      });
    } finally { setBusy(false); }
  };

  const num = (t) => { const n = parseSpokenNumber(t); return n === null ? null : String(n); };
  const step = !active ? null : active.status === 'queued' ? 1 : 2;

  return (
    <div className="space-y-4">
      {helper && !helper.configured && (
        <Card><p className="text-sm" style={text}>The helper is not set up yet, so a scan cannot start.</p><SecondaryButton onClick={() => goTo('helper')}>Set up the helper</SecondaryButton></Card>
      )}
      {helper?.configured && !helper.online && !active && (
        <Card><p className="text-sm" style={{ color: '#f59e0b' }}>The helper has not checked in lately. Start it on your PC, or a scan will wait until it does.</p><SecondaryButton onClick={() => goTo('helper')}>Helper details</SecondaryButton></Card>
      )}

      {active ? (
        <Card data-tour="pch-progress">
          <p className="text-sm font-medium" style={text}>{STATUS_LABEL[active.status]}…</p>
          <ol className="text-xs space-y-1" style={muted}>
            <li style={step === 1 ? text : undefined}>1. Waiting for the helper on your PC to pick the request up (it checks every 30 seconds)</li>
            <li style={step === 2 ? text : undefined}>2. The helper looks at your PC, which can take several minutes for a big drive</li>
            <li>3. The report opens here by itself</li>
          </ol>
          <Tooltip text="Stops the request. If the helper is already scanning, its report is thrown away. Nothing on your PC is affected either way.">
            <SecondaryButton onClick={() => onCancel(active.id)}>Cancel this scan</SecondaryButton>
          </Tooltip>
        </Card>
      ) : (
        <Card data-tour="pch-scan-options">
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium mb-1" style={muted}>Where to look</legend>
            <Tooltip text="Your user folder (including Local Sites), Public, ProgramData and the Windows temp and log folders, plus the known temp and cache places. Quick.">
              <label className="flex items-start gap-2 text-sm cursor-pointer" style={text}>
                <input type="radio" name="pch-scope" checked={!wholeDrive} onChange={() => setWholeDrive(false)} className="mt-1" />
                <span>The usual places <span style={muted}>(quick)</span></span>
              </label>
            </Tooltip>
            <Tooltip text="Everything on the C: drive. Much slower; it stops when the time limit is reached and says so.">
              <label className="flex items-start gap-2 text-sm cursor-pointer" style={text}>
                <input type="radio" name="pch-scope" checked={wholeDrive} onChange={() => setWholeDrive(true)} className="mt-1" />
                <span>The whole C: drive <span style={muted}>(slow)</span></span>
              </label>
            </Tooltip>
          </fieldset>

          {!wholeDrive && (
            <div>
              <p className="text-xs font-medium mb-1" style={muted}>Extra folders to include <span className="font-normal">(optional, one per line, like D:\Projects)</span></p>
              <Tooltip text="Add other folders or drives to look at as well as the usual places. You can type, or press the microphone and say them.">
                <div><VoiceInput type="textarea" append rows={2} value={extra} onChange={setExtra} placeholder="D:\Projects" label="Extra folders to include" /></div>
              </Tooltip>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium mb-1" style={muted}>Large-file size (MB, 50 to 5000)</p>
              <Tooltip text="Files at least this big are listed under Large files. 500 MB is a good start.">
                <div><VoiceInput type="number" value={largeMB} onChange={setLargeMB} parse={num} label="Large-file size in megabytes" /></div>
              </Tooltip>
            </div>
            <div>
              <p className="text-xs font-medium mb-1" style={muted}>Time limit (minutes, 1 to 30)</p>
              <Tooltip text="The scan stops looking after this long, and the report says if it was cut short.">
                <div><VoiceInput type="number" value={minutes} onChange={setMinutes} parse={num} label="Time limit in minutes" /></div>
              </Tooltip>
            </div>
          </div>

          <Tooltip text="Asks the helper on your PC for a fresh look. The helper only reads; nothing is deleted, moved or changed.">
            <PrimaryButton onClick={start} disabled={busy} data-tour="pch-scan-button">{busy ? 'Asking…' : 'Run a scan'}</PrimaryButton>
          </Tooltip>
        </Card>
      )}
    </div>
  );
}

// ── Disk space ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function DiskPanel({ scan, goTo }) {
  if (!scan) return <NoScan goTo={goTo} />;
  const r = scan.report;
  const findings = (scan.findings?.findings || []).filter((f) => f.area === 'disk');
  return (
    <div className="space-y-4">
      <Card>
        <FindingList findings={findings} empty="No drive is nearly full." />
        {r.drives.map((d) => {
          const usedPct = d.sizeGB ? ((d.sizeGB - d.freeGB) / d.sizeGB) * 100 : 0;
          return (
            <div key={d.name} className="space-y-1">
              <p className="text-sm" style={text}>{d.name} {d.label} · {fmtGB(d.freeGB)} free of {fmtGB(d.sizeGB)} ({Math.round(usedPct)}% used)</p>
              <Bar pct={usedPct} color={barColor(usedPct)} />
            </div>
          );
        })}
      </Card>
      <Card>
        <p className="text-xs font-semibold" style={muted}>Biggest folders found</p>
        <p className="text-[11px]" style={muted}>Up to three levels deep, from the places that were scanned. Bigger folders contain the smaller ones below them.</p>
        <PathTable rows={r.folders.slice(0, 60).map((f) => [f.path, fmtMB(f.sizeMB)])} head={['Folder', 'Size']} />
      </Card>
    </div>
  );
}

function PathTable({ rows, head }) {
  if (!rows.length) return <Empty>Nothing to show.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead><tr>{head.map((h, i) => <th key={h} className={`py-1 pr-3 font-medium ${i === 0 ? 'text-left' : 'text-right'}`} style={muted}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
              {cells.map((c, j) => <td key={j} className={`py-1.5 pr-3 align-top ${j === 0 ? 'font-mono break-all whitespace-pre-wrap text-left' :'text-right whitespace-nowrap'}`} style={text}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Large files ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function FilesPanel({ scan, goTo }) {
  const [q, setQ] = useState('');
  const all = (scan?.findings?.findings || []).filter((f) => f.area === 'files');
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (t ? all.filter((f) => String(f.path || '').toLowerCase().includes(t)) : all).slice(0, 200);
  }, [all, q]);
  if (!scan) return <NoScan goTo={goTo} />;
  return (
    <Card>
      <p className="text-xs" style={muted}>Files of {fmtMB(scan.options?.largeFileMB || 500)} or more, biggest first. Open More info on any file for what it probably is and what you could consider. Whether it is safe to remove is for you to decide; PC Health never removes anything.</p>
      <Tooltip text="Narrow the list by part of a file name or folder. You can say it instead of typing.">
        <div><VoiceInput value={q} onChange={setQ} placeholder="Search by name or folder" label="Search large files" /></div>
      </Tooltip>
      <FindingList findings={shown} empty={all.length ? 'Nothing matches that search.' : 'No file was above the large-file size.'} />
    </Card>
  );
}

// ── Logs and leftovers ─────────────────────────────────────────────────────────────────────────────────────────────────────

export function LogsPanel({ scan, goTo }) {
  if (!scan) return <NoScan goTo={goTo} />;
  const { logs, leftovers } = scan.report;
  const byKind = {};
  leftovers.forEach((l) => { (byKind[l.kind] = byKind[l.kind] || []).push(l); });
  const flagged = (scan.findings?.findings || []).filter((f) => f.area === 'logs');
  return (
    <div className="space-y-4">
      <Card>
        <p className="text-xs font-semibold" style={muted}>Worth a look</p>
        <FindingList findings={flagged} empty="No log or leftover was large enough to flag." />
      </Card>
      <Card>
        <p className="text-xs font-semibold" style={muted}>Log files</p>
        <p className="text-sm" style={text}>{logs.count.toLocaleString('en-AU')} log files, {fmtMB(logs.totalMB)} in total.</p>
        <PathTable head={['Biggest logs', 'Last written', 'Size']} rows={logs.files.slice(0, 40).map((f) => [f.path, fmtDay(f.modified), fmtMB(f.sizeMB)])} />
      </Card>
      <Card>
        <p className="text-xs font-semibold" style={muted}>Left behind</p>
        {leftovers.length === 0 && <Empty>Nothing large that looks left behind.</Empty>}
        {Object.keys(byKind).map((kind) => (
          <div key={kind} className="space-y-1">
            <p className="text-xs font-medium" style={text}>{LEFTOVER_LABEL[kind] || kind}</p>
            <PathTable head={['Location', 'Size']} rows={byKind[kind].map((l) => [l.note ? `${l.path}\n${l.note}` : l.path, fmtMB(l.sizeMB)])} />
          </div>
        ))}
      </Card>
    </div>
  );
}

// ── Growth ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function GrowthPanel({ scan, goTo }) {
  if (!scan) return <NoScan goTo={goTo} />;
  const f = scan.findings || {};
  const growth = f.growth || [];
  return (
    <Card>
      {!f.hadPrevious && <Empty>This was the first scan, so there is nothing to compare with yet. Run another scan later and folders that got bigger will show here.</Empty>}
      {f.hadPrevious && growth.length === 0 && <Empty>Nothing grew by much since the previous scan.</Empty>}
      {growth.length > 0 && (
        <PathTable
          head={['Folder', 'Was', 'Now', 'Grew', 'Per day']}
          rows={growth.map((g) => [g.path, g.isNew ? 'new' : fmtMB(g.wasMB), fmtMB(g.nowMB), fmtMB(g.grewMB), fmtMB(g.perDayMB)])}
        />
      )}
    </Card>
  );
}

// ── Memory and processor ───────────────────────────────────────────────────────────────────────────────────────────────────

export function PerformancePanel({ scan, goTo }) {
  if (!scan) return <NoScan goTo={goTo} />;
  const r = scan.report;
  const findings = (scan.findings?.findings || []).filter((f) => f.area === 'ram' || f.area === 'cpu');
  const used = r.machine.ramTotalMB ? ((r.machine.ramTotalMB - r.machine.ramFreeMB) / r.machine.ramTotalMB) * 100 : 0;
  const byRam = [...r.processes].sort((a, b) => b.ramMB - a.ramMB).slice(0, 20);
  const byCpu = [...r.processes].filter((p) => p.cpuPct > 0).sort((a, b) => b.cpuPct - a.cpuPct).slice(0, 10);
  return (
    <div className="space-y-4">
      <Card>
        <FindingList findings={findings} empty="Memory and processor use looked normal." />
        <p className="text-sm" style={text}>Memory: {fmtMB(r.machine.ramTotalMB - r.machine.ramFreeMB)} used of {fmtMB(r.machine.ramTotalMB)} ({Math.round(used)}%)</p>
        <Bar pct={used} color={barColor(used)} />
        <p className="text-sm" style={text}>Processor: {Math.round(r.machine.cpuLoadPct)}% busy when the scan started</p>
        <Bar pct={r.machine.cpuLoadPct} color={barColor(r.machine.cpuLoadPct)} />
        <p className="text-[11px]" style={muted}>Processor use is a few seconds of activity, not an average over the day. Copies of one program (a browser, for example) are added together.</p>
      </Card>
      <Card>
        <p className="text-xs font-semibold" style={muted}>Using the most memory</p>
        <PathTable head={['Program', 'Copies', 'Memory']} rows={byRam.map((p) => [p.name, String(p.count), fmtMB(p.ramMB)])} />
      </Card>
      <Card>
        <p className="text-xs font-semibold" style={muted}>Using the most processor time</p>
        <PathTable head={['Program', 'Copies', 'Processor']} rows={byCpu.map((p) => [p.name, String(p.count), `${p.cpuPct}%`])} />
      </Card>
    </div>
  );
}

// ── Past scans ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function HistoryPanel({ scans, openId, onOpen }) {
  if (!scans.length) return <Card><Empty>No scans yet.</Empty></Card>;
  return (
    <Card>
      <ul>
        {scans.map((s) => (
          <li key={s.id} className="py-2 flex items-center gap-3 border-b last:border-b-0" style={{ borderColor: 'var(--color-border)' }}>
            <div className="min-w-0 flex-1">
              <p className="text-sm" style={text}>{fmtWhen(s.finishedAt || s.requestedAt)} {openId === s.id && <span className="text-[11px]" style={muted}>(open)</span>}</p>
              <p className="text-xs" style={muted}>
                {STATUS_LABEL[s.status] || s.status}
                {s.status === 'done' && ` · ${s.summary?.high || 0} high · ${s.summary?.watch || 0} watch${s.summary?.truncated ? ' · cut short' : ''}`}
                {s.error ? ` · ${s.error}` : ''}
              </p>
            </div>
            {s.status === 'done' && (
              <Tooltip text="Read this scan again on the Overview page."><SecondaryButton onClick={() => onOpen(s.id)}>Open</SecondaryButton></Tooltip>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ── Set up the helper ──────────────────────────────────────────────────────────────────────────────────────────────────────

export function HelperPanel({ status, onCreateKey, onRemoveKey, onDownload }) {
  const [token, setToken] = useState(null);
  const [confirm, setConfirm] = useState(null); // 'replace' | 'remove'
  const [copied, setCopied] = useState(false);
  const helper = status?.helper;
  const command = token ? `powershell -ExecutionPolicy Bypass -File .\\pc-health-helper.ps1 -Server ${window.location.origin} -Token ${token}` : '';

  const create = async () => { setConfirm(null); setToken(await onCreateKey()); };
  const remove = async () => { setConfirm(null); setToken(null); await onRemoveKey(); };

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-sm font-medium" style={text}>
          {!helper?.configured && 'No helper key yet.'}
          {helper?.configured && helper.online && `Connected${helper.hostname ? ` (${helper.hostname})` : ''}.`}
          {helper?.configured && !helper.online && 'A key exists, but the helper is not running right now.'}
        </p>
        {helper?.lastSeenAt && <p className="text-xs" style={muted}>Last checked in {fmtWhen(helper.lastSeenAt)}.</p>}
        <p className="text-xs" style={muted}>The helper is a small PowerShell program that runs on your PC. It only reads: it measures the drive, memory and processor and lists large files and logs, then sends that report here. It does not delete, move, rename or change anything, and it writes no files.</p>
      </Card>

      <Card data-tour="pch-helper-steps">
        <p className="text-xs font-semibold" style={muted}>Steps</p>
        <ol className="text-sm space-y-3" style={text}>
          <li>
            1. Download the helper to a folder on your PC.
            <div className="mt-1"><Tooltip text="Saves pc-health-helper.ps1. Open it in Notepad first if you want to read what it does; it is short and read-only."><SecondaryButton onClick={onDownload}>Download helper</SecondaryButton></Tooltip></div>
          </li>
          <li>
            2. Make its key. The key is shown once, so you copy the command below straight away.
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {confirm === 'replace' ? (
                <span className="text-xs" style={text}>Replace the key? The helper using the old one stops working. <button type="button" className={`underline ${FOCUS_RING}`} onClick={create}>Yes</button> / <button type="button" className={`underline ${FOCUS_RING}`} onClick={() => setConfirm(null)}>No</button></span>
              ) : (
                <Tooltip text="Makes a secret key that lets the helper on your PC talk to your Vault. It lets a program send a report here; it cannot read anything else in Vault."><PrimaryButton onClick={helper?.configured ? () => setConfirm('replace') : create}>{helper?.configured ? 'Make a new key' : 'Create helper key'}</PrimaryButton></Tooltip>
              )}
              {helper?.configured && (confirm === 'remove' ? (
                <span className="text-xs" style={text}>Switch the helper off? <button type="button" className={`underline ${FOCUS_RING}`} onClick={remove}>Yes</button> / <button type="button" className={`underline ${FOCUS_RING}`} onClick={() => setConfirm(null)}>No</button></span>
              ) : (
                <Tooltip text="Deletes the key. The helper stops working until you make a new one."><SecondaryButton onClick={() => setConfirm('remove')}>Remove key</SecondaryButton></Tooltip>
              ))}
            </div>
          </li>
          {token && (
            <li>
              3. In PowerShell, in the folder you downloaded to, run this. Leave the window open; it waits for your scans. Press Ctrl+C to stop it.
              <pre className="mt-1 p-3 rounded-xl text-[11px] whitespace-pre-wrap break-all" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>{command}</pre>
              <div className="mt-1 flex items-center gap-2">
                <SecondaryButton onClick={() => { navigator.clipboard?.writeText(command).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}>{copied ? 'Copied ✓' : 'Copy command'}</SecondaryButton>
                <span className="text-xs" style={{ color: '#f59e0b' }}>This key will not be shown again. Keep the command somewhere private.</span>
              </div>
            </li>
          )}
          {!token && helper?.configured && <li className="text-xs" style={muted}>3. Run the command you saved when you made the key. If you lost it, make a new key.</li>}
        </ol>
      </Card>
    </div>
  );
}
