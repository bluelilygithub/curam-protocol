import React, { useEffect, useMemo, useState } from 'react';
import api from '../../utils/apiClient';
import Tooltip from '../../components/Tooltip';
import Skeleton from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import { Pill, SEV_COLOR, SEV_TIP, STATUS_COLOR, STATUS_WORD, ToolChip, card, fmt, fmtWhen } from './shared';

// Changes: what moved between two finished runs (GET /api/code-map/compare, server/services/codeMap/compare.js). The pickers default to
// the latest run and the one before. Worst first: score drops, new findings (high first), findings that got worse; then what improved.

const runLabel = (r) => `#${r.id} · ${fmtWhen(r.finishedAt || r.createdAt)}${r.commitHint ? ` · ${String(r.commitHint).slice(0, 7)}` : ''}`;

function Delta({ n, goodWhenDown = false, suffix = '' }) {
  if (n == null || n === 0) return <span style={{ color: 'var(--color-muted)' }}>no change</span>;
  const good = goodWhenDown ? n < 0 : n > 0;
  return <span style={{ color: good ? STATUS_COLOR.pass : STATUS_COLOR.fail }}>{n > 0 ? '+' : '−'}{fmt(Math.abs(n))}{suffix}</span>;
}

function Section({ title, sub, count, children, tour }) {
  return (
    <section className="rounded-2xl border p-5 space-y-3" style={card} data-tour={tour}>
      <div>
        <h3 className="text-base font-semibold flex items-baseline gap-2" style={{ color: 'var(--color-text)' }}>
          {title}<span className="text-xs font-normal" style={{ color: 'var(--color-muted)' }}>{count}</span>
        </h3>
        {sub && <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{sub}</p>}
      </div>
      {children}
    </section>
  );
}

function ItemList({ items, byId, onOpenTool, empty, showChange }) {
  if (!items.length) return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{empty}</p>;
  return (
    <ul className="space-y-2">
      {items.map((it) => (
        <li key={it.key} className="rounded-xl border px-3 py-2" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', borderLeft: `4px solid ${SEV_COLOR[it.sev] || 'var(--color-border)'}` }}>
          <div className="flex flex-wrap items-center gap-2">
            <Pill color={SEV_COLOR[it.sev]} tip={SEV_TIP[it.sev]}>{it.sev}</Pill>
            <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{it.what}</span>
            {it.toolId && byId[it.toolId] ? <ToolChip tool={byId[it.toolId]} onOpen={onOpenTool} /> : it.toolLabel ? <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{it.toolLabel}</span> : null}
            {showChange && (
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                <span style={{ color: STATUS_COLOR[it.fromStatus] }}>{STATUS_WORD[it.fromStatus] || it.fromStatus}</span> → <span style={{ color: STATUS_COLOR[it.status] }}>{STATUS_WORD[it.status] || it.status}</span>
              </span>
            )}
          </div>
          {it.note && <p className="text-xs mt-1" style={{ color: 'var(--color-text)' }}>{it.note}</p>}
          {(it.files || []).length > 0 && (
            <p className="text-xs mt-1 font-mono break-all" style={{ color: 'var(--color-muted)' }}>{it.files.slice(0, 4).join(' · ')}{it.files.length > 4 ? ` · and ${it.files.length - 4} more` : ''}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

function CycleList({ cycles, empty }) {
  if (!cycles.length) return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{empty}</p>;
  return (
    <ul className="space-y-1.5">
      {cycles.map((c) => (
        <li key={c.join('|')} className="rounded-xl border px-3 py-2 font-mono text-xs break-all" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
          <b className="font-sans">{c.length} files</b>
          {c.slice(0, 5).map((f) => <div key={f}>{f}</div>)}
          {c.length > 5 && <div style={{ color: 'var(--color-muted)' }}>… and {c.length - 5} more</div>}
        </li>
      ))}
    </ul>
  );
}

export default function ChangesView({ runs, byId, onOpenTool }) {
  const done = useMemo(() => (runs || []).filter((r) => r.status === 'done'), [runs]); // newest first
  const [toId, setToId] = useState(null);
  const [fromId, setFromId] = useState(null);
  const [diff, setDiff] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // default: the latest run against the one before; follow a new latest run when one finishes
  const latestId = done[0]?.id;
  useEffect(() => {
    if (done.length < 2) return;
    setToId(done[0].id);
    setFromId(done[1].id);
  }, [latestId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!fromId || !toId || fromId === toId) { setDiff(null); return undefined; }
    let stop = false;
    setLoading(true);
    setError(null);
    api.get(`/api/code-map/compare?from=${fromId}&to=${toId}`)
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Could not compare those runs.'); return d; })
      .then((d) => { if (!stop) setDiff(d); })
      .catch((err) => { if (!stop) { setDiff(null); setError(err.message); } })
      .finally(() => { if (!stop) setLoading(false); });
    return () => { stop = true; };
  }, [fromId, toId]);

  if (done.length < 2) {
    return <EmptyState icon="history" title="Nothing to compare yet" body="Changes needs two finished runs. Run the analysis again after the code changes (a run also happens every Sunday morning)." />;
  }

  const select = (value, onChange, label, tip) => (
    <Tooltip text={tip}>
      <select
        value={value || ''} onChange={(e) => onChange(Number(e.target.value))} aria-label={label}
        className="px-3 py-2 rounded-xl border text-sm max-w-full"
        style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
      >
        {done.map((r) => <option key={r.id} value={r.id}>{runLabel(r)}</option>)}
      </select>
    </Tooltip>
  );

  const s = diff?.summary || {};
  const lines = s.locServer && s.locClient ? s.locServer.delta + s.locClient.delta : null;
  const c = diff?.counts || {};
  const worse = (diff?.changedFindings || []).filter((x) => x.worse);
  const better = (diff?.changedFindings || []).filter((x) => !x.worse);
  const drops = (diff?.scores || []).filter((x) => x.delta < 0);
  const rises = (diff?.scores || []).filter((x) => x.delta > 0).sort((a, b) => b.delta - a.delta);

  const scoreRows = (list) => (
    <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
      <tbody>
        {list.map((x) => (
          <tr key={x.id}>
            <td className="py-1.5 pr-2 border-b" style={{ borderColor: 'var(--color-border)' }}>
              {byId[x.id] ? <ToolChip tool={byId[x.id]} onOpen={onOpenTool} /> : <span style={{ color: 'var(--color-text)' }}>{x.label}</span>}
            </td>
            <td className="py-1.5 border-b text-right tabular-nums whitespace-nowrap" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>{x.from}% → {x.to}%</td>
            <td className="py-1.5 pl-3 border-b text-right tabular-nums w-14" style={{ borderColor: 'var(--color-border)' }}><Delta n={x.delta} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2" data-tour="cm-changes" data-guide="run-pickers">
        <span className="text-sm" style={{ color: 'var(--color-muted)' }}>From</span>
        {select(fromId, setFromId, 'Older run', 'The run to compare from (usually the older one).')}
        <span className="text-sm" style={{ color: 'var(--color-muted)' }}>to</span>
        {select(toId, setToId, 'Newer run', 'The run to compare to (usually the newer one).')}
        <Tooltip text="Swap the two runs.">
          <button type="button" onClick={() => { setFromId(toId); setToId(fromId); }} aria-label="Swap the runs" className="text-sm px-3 py-1.5 rounded-lg border hover:opacity-70 transition-opacity duration-200" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Swap</button>
        </Tooltip>
      </div>

      {fromId === toId ? (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Pick two different runs.</p>
      ) : error ? (
        <p className="text-xs px-3 py-2 rounded-md" style={{ background: '#fff1f2', color: '#ef4444' }}>{error}</p>
      ) : loading || !diff ? (
        <Skeleton lines={6} className="h-10" label="Comparing the runs" />
      ) : (
        <>
          <div className="rounded-xl border px-4 py-3 text-sm flex flex-wrap gap-x-5 gap-y-1" style={card}>
            <span style={{ color: 'var(--color-text)' }}><b>{c.new}</b> new{c.newHigh ? <> (<span style={{ color: SEV_COLOR.high }}>{c.newHigh} high</span>)</> : null}</span>
            <span style={{ color: 'var(--color-text)' }}><b>{c.resolved}</b> resolved</span>
            <span style={{ color: 'var(--color-text)' }}><b>{c.worse}</b> got worse · <b>{c.better}</b> got better</span>
            <span style={{ color: 'var(--color-text)' }}><b>{c.scoresDown}</b> scores down · <b>{c.scoresUp}</b> up</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
            {[
              ['Tools', s.tools?.delta, false], ['Lines of app code', lines, null], ['Test files', s.tests?.delta, false],
              ['Rule gaps', s.gaps?.delta, true], ['Findings', s.findings?.delta, true], ['Import cycles', s.cycles?.delta, true],
            ].map(([label, n, down]) => (
              <div key={label} className="rounded-xl border px-4 py-3" style={card}>
                <div className="text-lg font-semibold tabular-nums">{down === null ? (n ? <span style={{ color: 'var(--color-text)' }}>{n > 0 ? '+' : '−'}{fmt(Math.abs(n))}</span> : <span style={{ color: 'var(--color-muted)' }}>no change</span>) : <Delta n={n} goodWhenDown={down} />}</div>
                <div className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-col xl:grid xl:grid-cols-2 xl:items-start gap-4">
            <Section title="Scores that dropped" count={drops.length} sub="Biggest drop first. Open a tool to see which rules it now misses.">
              {drops.length ? scoreRows(drops) : <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No tool's score went down.</p>}
            </Section>
            <Section title="New findings" count={diffCount(diff.newFindings)} sub="In the newer run but not the older one, high first. High ones are also in your Suggestions inbox.">
              <ItemList items={diff.newFindings} byId={byId} onOpenTool={onOpenTool} empty="Nothing new." />
            </Section>
            <Section title="Got worse" count={worse.length} sub="Still flagged, but moved from check (amber) to gap (red).">
              <ItemList items={worse} byId={byId} onOpenTool={onOpenTool} empty="Nothing got worse." showChange />
            </Section>
            <Section title="Resolved" count={diffCount(diff.resolvedFindings)} sub="Flagged in the older run, gone in the newer one.">
              <ItemList items={diff.resolvedFindings} byId={byId} onOpenTool={onOpenTool} empty="Nothing resolved." />
            </Section>
            <Section title="Got better" count={better.length + rises.length} sub="Moved from gap to check, and scores that went up.">
              {better.length > 0 && <ItemList items={better} byId={byId} onOpenTool={onOpenTool} empty="" showChange />}
              {rises.length ? scoreRows(rises) : !better.length ? <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Nothing improved.</p> : null}
            </Section>
            <Section title="Tools and cycles" count="" sub="Tools added to or removed from the menu, and import cycles that appeared or went away.">
              {(diff.toolsAdded.length > 0 || diff.toolsRemoved.length > 0) ? (
                <div className="text-sm space-y-1" style={{ color: 'var(--color-text)' }}>
                  {diff.toolsAdded.length > 0 && <p>Added: {diff.toolsAdded.map((x) => x.label).join(', ')}</p>}
                  {diff.toolsRemoved.length > 0 && <p>Removed: {diff.toolsRemoved.map((x) => x.label).join(', ')}</p>}
                </div>
              ) : <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No tools added or removed.</p>}
              <p className="text-xs font-semibold" style={{ color: 'var(--color-muted)' }}>New cycles ({diff.cyclesGained.length})</p>
              <CycleList cycles={diff.cyclesGained} empty="None." />
              <p className="text-xs font-semibold" style={{ color: 'var(--color-muted)' }}>Cycles gone ({diff.cyclesLost.length})</p>
              <CycleList cycles={diff.cyclesLost} empty="None." />
            </Section>
          </div>
        </>
      )}
    </div>
  );
}

const diffCount = (list) => (list || []).length;
