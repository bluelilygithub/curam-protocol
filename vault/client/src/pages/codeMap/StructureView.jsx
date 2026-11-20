import React from 'react';
import EmptyState from '../../components/EmptyState';
import { ExportButton, card, fmt } from './shared';
import { structureMd } from './exportRun.mjs';

// Structure: the code as a whole rather than per tool. Largest files, import cycles, shared foundations, separate packages, possibly unused
// files. Hotspots (big files that change often) need commit history, which the server does not have; they come later (brief milestone 5).

function Panel({ title, sub, children, tour }) {
  return (
    <section className="rounded-2xl border p-5 space-y-2 overflow-x-auto" style={card} data-tour={tour}>
      <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h3>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>{sub}</p>
      {children}
    </section>
  );
}

function Table({ head, rows, empty }) {
  if (!rows.length) return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{empty}</p>;
  return (
    <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
      <thead>
        <tr>{head.map((h, i) => <th key={i} className={`py-1.5 px-1.5 border-b font-medium ${i ? 'text-right' : 'text-left'}`} style={{ color: 'var(--color-muted)', borderColor: 'var(--color-border)' }}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri}>
            {r.map((c, i) => (
              <td key={i} className={`py-1.5 px-1.5 border-b align-top ${i ? 'text-right tabular-nums whitespace-nowrap' : 'font-mono break-all'}`} style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const Bar = ({ value, max }) => (
  <div className="h-2 rounded-sm ml-auto" style={{ width: `${Math.max(2, (value / (max || 1)) * 90)}px`, background: 'var(--color-primary)', opacity: 0.7 }} />
);

export default function StructureView({ data }) {
  const largest = data.largest || [];
  const maxL = largest[0]?.loc || 1;
  const cycles = [...(data.cycles || [])].sort((a, b) => b.length - a.length);
  const core = [...(data.core || [])].sort((a, b) => b.n - a.n);
  const unused = [...(data.backups || []).map((b) => ({ file: b, loc: 'backup copy' })), ...(data.orphans || [])];
  const tools = (data.summary || {}).tools;

  return (
    <div className="space-y-3">
    <div className="flex justify-end">
      <ExportButton label="Copy structure" what="Structure" getText={() => structureMd(data)} tip="Copy the largest files, import cycles, shared foundations, packages and possibly unused files as Markdown." />
    </div>
    <div className="flex flex-col xl:grid xl:grid-cols-2 xl:items-start gap-4">
      <Panel title="Hotspots" sub="Large files that change often. They need commit history, which the running server does not have (git is not copied into the deploy).">
        {(data.hotspots || []).length
          ? <Table head={['File', 'Lines', 'Edits']} rows={data.hotspots.map((h) => [h.file, fmt(h.loc), h.changes])} empty="" />
          : <EmptyState icon="history" title="Not measured yet" body="Hotspots come with change history, a later addition. Largest files below is the nearest guide for now." className="py-4" />}
      </Panel>
      <Panel title="Largest files" sub="Source files by line count, tests left out. Big files are slower to change safely; splitting them pays off first.">
        <Table head={['File', 'Lines', '']} rows={largest.map((h) => [h.file, fmt(h.loc), <Bar key="b" value={h.loc} max={maxL} />])} empty="No files." />
      </Panel>
      <Panel title="Import cycles" sub="Files that import each other in a loop. Lazy requires inside functions still run, but the loop makes ownership unclear." tour="cm-cycles">
        {!cycles.length ? <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No import cycles.</p> : (
          <ul className="space-y-1.5">
            {cycles.map((c, i) => (
              <li key={i} className="rounded-xl border px-3 py-2 font-mono text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                <b className="font-sans">{c.length} files</b>
                {c.slice(0, 6).map((f) => <div key={f} className="break-all">{f}</div>)}
                {c.length > 6 && <div style={{ color: 'var(--color-muted)' }}>… and {c.length - 6} more</div>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Shared foundations" sub={`Core modules and how many of the ${tools ?? ''} tools reach them. A change here touches all of those tools.`}>
        <Table head={['Module', 'Tools', 'Importers', 'Lines']} rows={core.map((c) => [c.file, c.n, c.importers, fmt(c.loc)])} empty="No shared modules found." />
      </Panel>
      <Panel title="Separate packages" sub="Sub-apps beside client and server (their own package.json). They are not part of the tool checks.">
        <Table head={['Package', 'Files', 'Lines']} rows={(data.packages || []).map((p) => [`${p.name}/`, fmt(p.files), fmt(p.loc)])} empty="No separate packages." />
      </Panel>
      <Panel title="Possibly unused" sub="Backup copies, and files nothing imports or names. Check before deleting: a file can be loaded by a path built at runtime.">
        <Table head={['File', 'Lines']} rows={unused.map((o) => [o.file, typeof o.loc === 'number' ? fmt(o.loc) : o.loc])} empty="Nothing found." />
      </Panel>
    </div>
    </div>
  );
}
