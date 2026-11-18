import React from 'react';
import EmptyState from '../../components/EmptyState';
import { Evidence, Pill, SEV_COLOR, SEV_TIP, ToolChip, Collapsible, card, fmt } from './shared';

// Overview: the summary tiles and the ranked findings (severity first, then how many tools each touches; built in server/services/codeMap/findings.js).

function Tile({ n, label }) {
  return (
    <div className="rounded-xl border px-4 py-3" style={card}>
      <div className="text-2xl font-semibold tabular-nums" style={{ color: 'var(--color-text)' }}>{n}</div>
      <div className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</div>
    </div>
  );
}

export default function Overview({ data, byId, onOpenTool }) {
  const s = data.summary || {};
  const tiles = [
    [fmt(s.tools), 'tools in the navigation'],
    [fmt((s.locServer || 0) + (s.locClient || 0)), 'lines of app code (server + client)'],
    [fmt(s.tests), `test files (${fmt(s.locTests)} lines)`],
    [fmt(s.mounts), 'API mounts in server/index.js'],
    [fmt((data.cycles || []).length), 'import cycles'],
    [fmt(s.gaps), 'rule gaps across tools'],
  ];
  const findings = data.findings || [];
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        {tiles.map(([n, l]) => <Tile key={l} n={n} label={l} />)}
      </div>
      <section>
        <h2 className="text-base font-semibold mb-3" style={{ color: 'var(--color-text)' }}>What to improve, in order</h2>
        {!findings.length ? (
          <EmptyState icon="check" title="Nothing to improve" body="Every rule passes for every tool, and the structure checks found nothing." />
        ) : (
          <ol className="space-y-3">
            {findings.map((f, i) => {
              const tools = (f.tools || []).map((id) => byId[id]).filter(Boolean);
              const total = f.evidenceTotal || (f.evidence || []).length;
              return (
                <li key={f.id || i} data-tour={i === 0 ? 'cm-findings' : undefined} className="rounded-xl border p-4" style={{ ...card, borderLeft: `4px solid ${SEV_COLOR[f.sev] || 'var(--color-border)'}` }}>
                  <div className="flex flex-wrap items-center gap-2 mb-1.5">
                    <Pill color={SEV_COLOR[f.sev]} tip={SEV_TIP[f.sev]}>{f.sev}</Pill>
                    <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{i + 1}. {f.title}</h3>
                    {f.area && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{f.area}</span>}
                  </div>
                  {f.body && <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>{f.body}</p>}
                  {tools.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {tools.map((t) => <ToolChip key={t.id} tool={t} onOpen={onOpenTool} />)}
                    </div>
                  )}
                  {(f.evidence || []).length > 0 && (
                    <div className="mt-2">
                      <Collapsible label={`Evidence (${total})`} tip="Show the files and lines this finding is based on.">
                        <Evidence items={f.evidence} />
                        {total > f.evidence.length && <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Showing the first {f.evidence.length} of {total}; open a tool for all of its own.</p>}
                      </Collapsible>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
