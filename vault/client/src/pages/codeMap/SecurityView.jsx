import React from 'react';
import Tooltip from '../../components/Tooltip';
import EmptyState from '../../components/EmptyState';
import { Collapsible, Evidence, ExportButton, Pill, SEV_COLOR, ToolChip, card, fmt } from './shared';
import { securityMd } from './exportRun.mjs';

// Security tab: the plain pattern checks from server/services/codeMap/security.js, part of every analysis run (no AI, no cost).
// Gaps first, then checks, then items for review, then what passes. Each check names why it matters, the fix and the lines it found.

const STATUS = {
  fail: { color: '#ef4444', word: 'gap', tip: 'The pattern this check looks for was found. Read the lines before changing anything.' },
  warn: { color: '#f59e0b', word: 'check', tip: 'Worth a look: often fine (for example shared data), but each line should be confirmed.' },
  info: { color: 'var(--color-primary)', word: 'for review', tip: 'Not a problem in itself: a list to keep an eye on.' },
  pass: { color: '#16a34a', word: 'passes', tip: 'Nothing found. Pattern checks can miss things, so this is not proof.' },
};
const ORDER = ['fail', 'warn', 'info', 'pass'];

function Tile({ n, label, color }) {
  return (
    <div className="rounded-xl border px-4 py-3" style={{ ...card, borderLeft: `4px solid ${color}` }}>
      <div className="text-2xl font-semibold tabular-nums" style={{ color: 'var(--color-text)' }}>{fmt(n)}</div>
      <div className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</div>
    </div>
  );
}

export default function SecurityView({ data, byId, onOpenTool }) {
  const sec = data.security;
  if (!sec) return <EmptyState icon="code-map" title="No security checks in this run" body="This run was made before the Security tab existed. Run the analysis again to see them." />;
  const checks = [...sec.checks].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  const c = sec.counts || {};

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm leading-relaxed max-w-3xl" style={{ color: 'var(--color-muted)' }}>
          Pattern checks for common security mistakes, run with every analysis (no AI, no cost). They point at code to read: a gap is not proof of a hole, and a pass is not proof there is none. High gaps also go to your Suggestions inbox. Secret values are never shown or stored.
        </p>
        <ExportButton label="Copy security" what="Security checks" getText={() => securityMd(data)} tip="Copy every security check, gaps first, with the lines found, as Markdown." />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile n={c.fail || 0} label="gaps" color={STATUS.fail.color} />
        <Tile n={c.warn || 0} label="to check" color={STATUS.warn.color} />
        <Tile n={c.info || 0} label="lists for review" color={STATUS.info.color} />
        <Tile n={c.pass || 0} label="pass" color={STATUS.pass.color} />
      </div>
      <ol className="space-y-3" data-guide="security-checks">
        {checks.map((x) => {
          const s = STATUS[x.status] || STATUS.warn;
          const tools = [...new Set((x.items || []).map((i) => i.tool).filter((t) => t && byId[t]))];
          return (
            <li key={x.id} className="rounded-xl border p-4" style={{ ...card, borderLeft: `4px solid ${s.color}` }}>
              <div className="flex flex-wrap items-center gap-2 mb-1.5">
                <Pill color={s.color} tip={s.tip}>{s.word}</Pill>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{x.label}</h3>
                <Tooltip text={`Severity if this check finds something: ${x.severity}.`}><span tabIndex={0} className="text-xs" style={{ color: SEV_COLOR[x.severity] }}>{x.severity}</span></Tooltip>
              </div>
              <p className="text-sm" style={{ color: 'var(--color-text)' }}>{x.note}</p>
              <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--color-muted)' }}>{x.why}{x.status !== 'pass' && x.status !== 'info' ? <> <strong>Fix:</strong> {x.fix}</> : null}</p>
              {tools.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">{tools.map((id) => <ToolChip key={id} tool={byId[id]} onOpen={onOpenTool} />)}</div>
              )}
              {(x.items || []).length > 0 && (
                <div className="mt-2">
                  <Collapsible label={`${x.status === 'info' ? 'List' : 'Lines found'} (${x.total})`} tip="Show the files and lines this check is based on." defaultOpen={x.status === 'fail'}>
                    <Evidence items={x.items} wrap />
                    {x.total > x.items.length && <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Showing the first {x.items.length} of {x.total}.</p>}
                  </Collapsible>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
