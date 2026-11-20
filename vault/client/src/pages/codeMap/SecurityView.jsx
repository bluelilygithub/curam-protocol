import React, { useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import Skeleton from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import { Collapsible, Evidence, ExportButton, Pill, SEV_COLOR, ToolChip, card, fmt, fmtSecs, fmtWhen } from './shared';
import { liveMd, securityMd } from './exportRun.mjs';
import AiSecurityReview from './AiSecurityReview';

// Security tab. Three parts:
//   Code checks: plain pattern checks from server/services/codeMap/security.js, part of every analysis run (no AI, no cost).
//   Live site: server/services/codeMap/liveCheck.js probes the running site (headers, HTTPS, CORS, auth) when the admin presses the button.
//   AI security review (AiSecurityReview.jsx): the model reads every route file, button only, costs model calls.
// Gaps first, then checks, then lists for review, then what passes.

const toast = (message, type = 'error') => useToastStore.getState().addToast(message, type);
const STATUS = {
  fail: { color: '#ef4444', word: 'gap', tip: 'The problem this check looks for was found. Read the details before changing anything.' },
  warn: { color: '#f59e0b', word: 'check', tip: 'Worth a look: often fine, but each item should be confirmed.' },
  info: { color: 'var(--color-primary)', word: 'for review', tip: 'Not a problem in itself: a list to keep an eye on.' },
  pass: { color: '#16a34a', word: 'passes', tip: 'Nothing found. A check can miss things, so this is not proof.' },
  na: { color: 'var(--color-border)', word: 'not applicable', tip: 'Does not apply here (for example HTTPS on a local address).' },
};
const ORDER = ['fail', 'warn', 'info', 'pass', 'na'];
const sorted = (checks) => [...checks].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));

function Tile({ n, label, color }) {
  return (
    <div className="rounded-xl border px-4 py-3" style={{ ...card, borderLeft: `4px solid ${color}` }}>
      <div className="text-2xl font-semibold tabular-nums" style={{ color: 'var(--color-text)' }}>{fmt(n)}</div>
      <div className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</div>
    </div>
  );
}

function CheckCard({ x, byId, onOpenTool }) {
  const s = STATUS[x.status] || STATUS.warn;
  const tools = [...new Set((x.items || []).map((i) => i.tool).filter((t) => t && byId[t]))];
  const withFile = (x.items || []).filter((i) => i.file);
  const plain = (x.items || []).filter((i) => !i.file);
  return (
    <li className="rounded-xl border p-4" style={{ ...card, borderLeft: `4px solid ${s.color}` }}>
      <div className="flex flex-wrap items-center gap-2 mb-1.5">
        <Pill color={x.status === 'na' ? undefined : s.color} tip={s.tip}>{s.word}</Pill>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{x.label}</h3>
        <Tooltip text={`Severity if this check finds something: ${x.severity}.`}><span tabIndex={0} className="text-xs" style={{ color: SEV_COLOR[x.severity] }}>{x.severity}</span></Tooltip>
      </div>
      <p className="text-sm break-words" style={{ color: 'var(--color-text)' }}>{x.note}</p>
      <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--color-muted)' }}>{x.why}{x.status === 'fail' || x.status === 'warn' ? <> <strong>Fix:</strong> {x.fix}</> : null}</p>
      {tools.length > 0 && <div className="flex flex-wrap gap-1.5 mt-2">{tools.map((id) => <ToolChip key={id} tool={byId[id]} onOpen={onOpenTool} />)}</div>}
      {(x.items || []).length > 0 && (
        <div className="mt-2">
          <Collapsible label={`${x.status === 'info' ? 'List' : 'Details'} (${x.total})`} tip="Show what this check is based on." defaultOpen={x.status === 'fail'}>
            <Evidence items={withFile} wrap />
            {plain.length > 0 && (
              <ul className="mt-2 space-y-1">
                {plain.map((i, k) => <li key={k} className="font-mono text-xs rounded-md border px-2.5 py-1.5 break-all" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>{i.text}</li>)}
              </ul>
            )}
            {x.total > x.items.length && <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Showing the first {x.items.length} of {x.total}.</p>}
          </Collapsible>
        </div>
      )}
    </li>
  );
}

function LiveSite({ byId, onOpenTool }) {
  const getIcon = useIcon();
  const [live, setLive] = useState(undefined);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    api.get('/api/code-map/live-checks/latest').then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not load the last live check.');
      setLive(d.check || null);
    }).catch((err) => { setLive(null); toast(err.message); });
  }, []);

  const run = async () => {
    setRunning(true);
    try {
      const r = await api.post('/api/code-map/live-checks', {});
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'The live check failed.');
      setLive(d.check);
      const n = d.check.counts?.fail || 0;
      toast(n ? `Live check: ${n} gap${n === 1 ? '' : 's'} found.` : 'Live check: no gaps found.', n ? 'warn' : 'success');
    } catch (err) {
      toast(err.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="space-y-3" data-guide="live-check">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-3xl">
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Live site</h2>
          <p className="text-sm mt-1 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
            Checks the running site rather than the code: security headers, HTTPS and its certificate, whether other websites can call the API, that protected routes refuse anyone not signed in, and that errors do not show code details. About 15 harmless requests to this app's own address; no AI, no cost.
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
            {live ? <>Last checked {fmtWhen(live.createdAt)} · {live.base} · took {fmtSecs(live.durationMs)}</> : live === null ? 'Not checked yet.' : 'Loading…'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {live && <ExportButton label="Copy live checks" what="Live checks" getText={() => liveMd(live)} tip="Copy every live check as Markdown." />}
          <Tooltip text="Check the running site now. Takes a few seconds.">
            <button type="button" onClick={run} disabled={running} className="text-sm font-medium px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 hover:opacity-70 transition-opacity duration-200 disabled:opacity-50" style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}>
              {getIcon(running ? 'loader' : 'play', { size: 14, className: running ? 'animate-spin' : undefined })}{running ? 'Checking…' : 'Check the live site'}
            </button>
          </Tooltip>
        </div>
      </div>
      {live === undefined ? <Skeleton lines={3} label="Loading the last live check" />
        : live && <ol className="space-y-3">{sorted(live.checks).map((x) => <CheckCard key={x.id} x={x} byId={byId} onOpenTool={onOpenTool} />)}</ol>}
    </section>
  );
}

export default function SecurityView({ data, byId, onOpenTool }) {
  const sec = data.security;
  const c = (sec && sec.counts) || {};

  return (
    <div className="space-y-8">
      <section className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 max-w-3xl">
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Code checks</h2>
            <p className="text-sm mt-1 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
              Pattern checks for common security mistakes, run with every analysis (no AI, no cost). They point at code to read: a gap is not proof of a hole, and a pass is not proof there is none. High gaps also go to your Suggestions inbox. Secret values are never shown or stored.
            </p>
          </div>
          {sec && <ExportButton label="Copy security" what="Security checks" getText={() => securityMd(data)} tip="Copy every code check, gaps first, with the lines found, as Markdown." />}
        </div>
        {!sec ? (
          <EmptyState icon="code-map" title="No code checks in this run" body="This run was made before the Security tab existed. Run the analysis again to see them." />
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Tile n={c.fail || 0} label="gaps" color={STATUS.fail.color} />
              <Tile n={c.warn || 0} label="to check" color={STATUS.warn.color} />
              <Tile n={c.info || 0} label="lists for review" color={STATUS.info.color} />
              <Tile n={c.pass || 0} label="pass" color={STATUS.pass.color} />
            </div>
            <ol className="space-y-3" data-guide="security-checks">
              {sorted(sec.checks).map((x) => <CheckCard key={x.id} x={x} byId={byId} onOpenTool={onOpenTool} />)}
            </ol>
          </>
        )}
      </section>
      <LiveSite byId={byId} onOpenTool={onOpenTool} />
      <AiSecurityReview byId={byId} onOpenTool={onOpenTool} />
    </div>
  );
}
