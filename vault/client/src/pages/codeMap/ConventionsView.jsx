import React, { useMemo, useState } from 'react';
import Tooltip from '../../components/Tooltip';
import { Dot, Evidence, Legend, STATUS_COLOR, STATUS_WORD, ToolChip, card } from './shared';

// Conventions: tools down the side, the rules across the top (sticky header and first column). Clicking a cell shows its note and evidence below.

export default function ConventionsView({ data, rules, byId, onOpenTool }) {
  const tools = data.tools || [];
  const [cell, setCell] = useState(null); // { toolId, ruleId }
  const rows = useMemo(() => [...tools].sort((a, b) => a.score - b.score || a.label.localeCompare(b.label)), [tools]);
  const counts = useMemo(() => Object.fromEntries(rules.map((r) => {
    const c = { pass: 0, warn: 0, fail: 0 };
    for (const t of tools) { const s = (t.checks || {})[r.id]?.status; if (s in c) c[s]++; }
    return [r.id, c];
  })), [rules, tools]);

  const sel = cell && byId[cell.toolId];
  const selRule = cell && rules.find((r) => r.id === cell.ruleId);
  const selCheck = sel && (sel.checks || {})[cell.ruleId];
  const sticky = { background: 'var(--color-surface)' };

  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed max-w-3xl" style={{ color: 'var(--color-muted)' }}>
        Each column is a rule from CLAUDE.md, checked against the code each tool owns. Click a cell for what was found, or a tool name for its full detail. Amber cells are worth a look, not necessarily wrong.
      </p>
      <Legend />
      <div className="overflow-auto rounded-xl border max-h-[70vh]" style={card} data-tour="cm-matrix" data-guide="matrix-cell">
        <table className="text-xs" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-[3] text-left px-2 py-2 border-b font-semibold align-bottom" style={{ ...sticky, borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Tool</th>
              <th className="sticky top-0 z-[2] px-2 py-2 border-b font-semibold align-bottom" style={{ ...sticky, borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Score</th>
              {rules.map((r) => (
                <th key={r.id} className="sticky top-0 z-[2] px-1.5 py-2 border-b font-semibold align-bottom min-w-[76px]" style={{ ...sticky, borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                  <Tooltip text={`${r.why} Fix: ${r.fix}`}><span tabIndex={0} className="block">{r.label}</span></Tooltip>
                  <span className="block font-normal tabular-nums" style={{ color: 'var(--color-muted)' }}>{counts[r.id].fail} gap · {counts[r.id].warn} check</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <th className="sticky left-0 z-[1] text-left px-2 py-1 border-b font-medium whitespace-nowrap" style={{ ...sticky, borderColor: 'var(--color-border)' }}>
                  <Tooltip text={`Open ${t.label}.`}>
                    <button type="button" onClick={() => onOpenTool(t.id)} className="hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-text)' }}>{t.label}</button>
                  </Tooltip>
                </th>
                <td className="px-2 py-1 border-b text-center tabular-nums" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>{t.score}%</td>
                {rules.map((r) => {
                  const c = (t.checks || {})[r.id] || { status: 'na' };
                  const on = cell && cell.toolId === t.id && cell.ruleId === r.id;
                  return (
                    <td key={r.id} className="px-1.5 py-1 border-b text-center" style={{ borderColor: 'var(--color-border)' }}>
                      <Tooltip text={`${t.label} · ${r.label}: ${STATUS_WORD[c.status] || c.status}. Click for the evidence.`}>
                        <button
                          type="button" onClick={() => setCell({ toolId: t.id, ruleId: r.id })} aria-pressed={!!on}
                          aria-label={`${t.label}, ${r.label}: ${STATUS_WORD[c.status] || c.status}`}
                          className="w-[22px] h-[22px] rounded-md hover:opacity-70 transition-opacity duration-200"
                          style={{ background: STATUS_COLOR[c.status] || STATUS_COLOR.na, outline: on ? '2px solid var(--color-text)' : undefined, outlineOffset: 1 }}
                        />
                      </Tooltip>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rounded-xl border px-4 py-3 min-h-[52px]" style={card} aria-live="polite">
        {!selCheck ? (
          <span className="text-sm" style={{ color: 'var(--color-muted)' }}>Click a cell to see what was found.</span>
        ) : (
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Dot status={selCheck.status} />
              <b className="text-sm" style={{ color: 'var(--color-text)' }}>{sel.label} · {selRule?.label}</b>
              <ToolChip tool={sel} onOpen={onOpenTool} label="Open tool" />
            </div>
            <p className="text-sm mt-1.5" style={{ color: 'var(--color-text)' }}>{selCheck.note}</p>
            {selCheck.status !== 'pass' && selCheck.status !== 'na' && selRule?.fix && (
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Fix: {selRule.fix}</p>
            )}
            <Evidence items={selCheck.evidence} />
          </div>
        )}
      </div>
    </div>
  );
}
