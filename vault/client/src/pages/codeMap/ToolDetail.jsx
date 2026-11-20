import React from 'react';
import Dialog from '../../components/Dialog';
import Tooltip from '../../components/Tooltip';
import { useIcon } from '../../providers/IconProvider';
import { Collapsible, Dot, Evidence, ExportButton, LifecyclePill, ToolChip, fmt } from './shared';
import { toolMd } from './exportRun.mjs';

// The side panel for one tool: every rule with its note and evidence, the APIs it owns, linked tools, its biggest files and the files it owns.
// Built on the shared Dialog (raw mode, pinned to the right) so focus, Escape and the dim background behave like every other modal.

function H({ children }) {
  return <h3 className="text-xs font-semibold uppercase tracking-wide mt-5 mb-2" style={{ color: 'var(--color-muted)' }}>{children}</h3>;
}

function FileList({ files }) {
  return (
    <ul className="font-mono text-xs mt-1 pl-4 space-y-0.5 list-disc break-all" style={{ color: 'var(--color-muted)' }}>
      {files.map((f) => <li key={f}>{f}</li>)}
    </ul>
  );
}

export default function ToolDetail({ tool: t, data, rules, byId, onOpenTool, onClose }) {
  const getIcon = useIcon();
  if (!t) return null;
  const links = (data.edges || []).filter((e) => e.a === t.id || e.b === t.id).map((e) => {
    const other = e.a === t.id ? e.b : e.a;
    const dirs = [...new Set((e.api || []).map((x) => (x.split('->')[0] === t.id ? 'calls its API' : 'is called by it')))];
    const shared = e.n ? `${e.n} shared file${e.n > 1 ? 's' : ''}` : '';
    return { other, text: [...dirs, shared].filter(Boolean).join(', ') };
  });
  const platform = (t.calls || []).filter((c) => c.startsWith('platform:')).map((c) => `/api/${c.slice(9)}`);
  const owned = (t.ownedClient || []).length + (t.ownedServer || []).length;

  return (
    <Dialog
      raw
      onClose={onClose}
      overlayClassName="fixed inset-0 z-50 flex justify-end"
      overlayStyle={{ background: 'rgba(0,0,0,0.35)' }}
      panelClassName="h-full w-full sm:w-[640px] max-w-full overflow-y-auto border-l px-5 pt-5 pb-10"
      panelStyle={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>{t.label} <LifecyclePill tool={t} /></h2>
          <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
            {t.group} · page <code>{t.path}</code>{t.featureKey ? <> · flag <code>{t.featureKey}</code></> : null}{t.adminOnly ? ' · admin only' : ''}
          </p>
        </div>
        <Tooltip text="Close (Escape)">
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 hover:opacity-60 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}>{getIcon('x', { size: 18 })}</button>
        </Tooltip>
      </div>
      <div className="flex flex-wrap gap-3 mt-3 text-xs tabular-nums" style={{ color: 'var(--color-muted)' }}>
        <span>{t.score}% of rules</span><span>{fmt(t.locClient)} client lines</span><span>{fmt(t.locServer)} server lines</span><span>{(t.tests || []).length} test files</span>
        <span className="ml-auto"><ExportButton label="Copy tool" what={t.label} getText={() => toolMd(t, rules)} tip={`Copy ${t.label}'s rules, evidence, APIs, owned files and tests as Markdown.`} /></span>
      </div>

      <H>Rules</H>
      <div>
        {rules.map((r) => {
          const c = (t.checks || {})[r.id] || { status: 'na', note: '', evidence: [] };
          return (
            <div key={r.id} className="grid gap-2 py-2 border-b text-sm" style={{ gridTemplateColumns: '14px minmax(90px, 140px) 1fr', borderColor: 'var(--color-border)' }}>
              <span className="mt-1"><Dot status={c.status} /></span>
              <Tooltip text={r.why}><span tabIndex={0} className="font-medium" style={{ color: 'var(--color-text)' }}>{r.label}</span></Tooltip>
              <div className="min-w-0" style={{ color: 'var(--color-text)' }}>
                {c.note}
                {(c.status === 'fail' || c.status === 'warn') && r.fix && <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Fix: {r.fix}</p>}
                <Evidence items={c.evidence} wrap />
              </div>
            </div>
          );
        })}
      </div>

      <H>API it owns</H>
      {(t.mounts || []).length ? (
        <ul className="space-y-1">
          {t.mounts.map((m) => (
            <li key={m.path} className="font-mono text-xs rounded-md border px-2.5 py-1.5 break-all" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
              <span style={{ color: 'var(--color-primary)' }}>{m.path}</span>
              <span style={{ color: 'var(--color-muted)' }}>{`  server/index.js:${m.line}`}{m.aiLimiter ? ' · aiLimiter' : ''}{m.public ? ' · before requireAuth' : ''}{m.admin ? ' · admin' : ''}{(m.features || []).length ? ` · flag ${m.features.join(', ')}` : ''}</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm" style={{ color: 'var(--color-muted)' }}>None of its own; it uses other tools' APIs.</p>}

      <H>Linked tools</H>
      {links.length ? (
        <ul className="space-y-1.5">
          {links.map((l) => (
            <li key={l.other} className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--color-muted)' }}>
              <ToolChip tool={byId[l.other]} onOpen={onOpenTool} /> {l.text}
            </li>
          ))}
        </ul>
      ) : <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No links to other tools.</p>}
      {platform.length > 0 && <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>Platform APIs used: {platform.join(', ')}</p>}

      <H>Biggest files</H>
      <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
        <tbody>
          {(t.biggest || []).map((b) => (
            <tr key={b.file}>
              <td className="py-1 pr-2 border-b font-mono break-all" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>{b.file}</td>
              <td className="py-1 border-b text-right tabular-nums" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>{fmt(b.loc)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <H>Files it owns ({owned})</H>
      <div className="space-y-1.5">
        <Collapsible label={`Client (${(t.ownedClient || []).length})`} tip="Client files only this tool (or one or two others) reaches."><FileList files={t.ownedClient || []} /></Collapsible>
        <Collapsible label={`Server (${(t.ownedServer || []).length})`} tip="Server files reached from this tool's own API mounts."><FileList files={t.ownedServer || []} /></Collapsible>
        <Collapsible label={`Tests (${(t.tests || []).length})`} tip="Test files that import this tool's code."><FileList files={t.tests || []} /></Collapsible>
      </div>
      <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>
        Also uses {t.sharedClientCount ?? 0} shared client files and {t.sharedServerCount ?? 0} shared server files (reached by three or more tools).
      </p>
    </Dialog>
  );
}
