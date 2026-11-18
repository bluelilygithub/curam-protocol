import React, { useState } from 'react';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import Skeleton from '../../components/Skeleton';
import Dialog from '../../components/Dialog';
import { money, compact, minutes, pct, totalTokens, brisbaneTime } from './ponytailFormat.mjs';

const COLUMNS = [
  { id: 'started', label: 'Started', tip: 'When the task started, Brisbane time.' },
  { id: 'project', label: 'Project', tip: 'The folder Claude Code was working in.' },
  { id: 'name', label: 'Name', tip: 'The task\'s name in the Claude Code sidebar, or its first prompt. Empty when "Send task names" is off in Ponytail.' },
  { id: 'model', label: 'Model', tip: 'The model that wrote most of the replies.' },
  { id: 'level', label: 'Level', tip: 'The ponytail level (lite, full, ultra, or off).' },
  { id: 'cost', label: 'Cost', tip: 'What the task cost so far.', right: true },
  { id: 'turns', label: 'Turns', tip: 'Replies Claude gave in the task.', right: true },
  { id: 'agentMs', label: 'Agent min', tip: 'Minutes Claude was working (not waiting for you).', right: true },
  { id: 'tokens', label: 'Tokens', tip: 'Input, output and cache tokens together.', right: true },
  { id: 'reuse', label: 'Reuse', tip: 'Functions used that already existed, out of those used or written (used / new). No share under 3.', right: true },
  { id: 'tests', label: 'Tests', tip: 'The last test run Ponytail saw.', sortable: false },
];

const cellStyle = { color: 'var(--color-text)' };
const BTN = 'px-3 py-1.5 rounded-lg text-xs border transition-opacity duration-200 hover:opacity-70 disabled:opacity-40';
const btnStyle = { borderColor: 'var(--color-border)', color: 'var(--color-text)' };

function Detail({ task, onClose, onDelete }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const t = task;
  const rows = [
    ['Name', t.name || '(no name)'], ['Project', t.project || '–'], ['Started', brisbaneTime(t.started)], ['Model', t.model || '–'], ['Level', t.level || '–'],
    ['Cost', `${money(t.cost)}${t.lastTurn === null ? '' : ` · last turn ${money(t.lastTurn)}`}`], ['Turns', String(t.turns)], ['Agent time', minutes(t.agentMs)],
    ['Tokens', `${compact(totalTokens(t.tokens))} (input ${compact(t.tokens.input)}, output ${compact(t.tokens.output)}, cache read ${compact(t.tokens.cacheRead)}, cache write ${compact(t.tokens.cacheWrite)})`],
    ['Reuse', `${pct(t.reuse)} (${t.reused} used, ${t.created} new)`], ['Callers open', String(t.callersOpen)], ['Tests', t.tests || '–'],
    ['Session', t.session || '–'], ['Key', t.key], ['Came from', t.source === 'csv' ? 'CSV import' : 'Webhook'],
    ['Updates received', String(t.updatesReceived)], ['First seen', brisbaneTime(t.firstSeenAt)], ['Last updated', brisbaneTime(t.lastSeenAt)],
  ];
  const remove = async () => { setBusy(true); try { await onDelete(t); } finally { setBusy(false); } };
  return (
    <Dialog title={t.name || 'Ponytail task'} onClose={onClose} size="lg" footer={confirming ? (
      <span className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
        Delete?
        <button type="button" onClick={remove} disabled={busy} className={BTN} style={{ borderColor: '#ef4444', color: '#ef4444' }}>Yes</button>
        <button type="button" onClick={() => setConfirming(false)} className={BTN} style={btnStyle}>No</button>
      </span>
    ) : (
      <Tooltip text="Moves this task to the recycle bin for 30 days. If the task is still running, Ponytail sends it again on its next turn.">
        <button type="button" onClick={() => setConfirming(true)} className={BTN} style={btnStyle}>Delete</button>
      </Tooltip>
    )}>
      <dl className="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-2 text-sm px-5 py-4 overflow-y-auto">
        {rows.map(([k, v]) => (
          <React.Fragment key={k}>
            <dt style={{ color: 'var(--color-muted)' }}>{k}</dt>
            <dd className="break-words" style={cellStyle}>{v}</dd>
          </React.Fragment>
        ))}
      </dl>
    </Dialog>
  );
}

// The tasks in the range, sorted on the server, 50 to a page. Click a row for every field.
export default function TasksTable({ data, sort, dir, onSort, page, onPage, onDelete }) {
  const getIcon = useIcon();
  const [open, setOpen] = useState(null);
  if (!data) return <Skeleton lines={6} label="Loading tasks" />;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return (
    <>
      <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--color-border)' }}>
        <table className="w-full text-xs">
          <thead style={{ background: 'var(--color-bg)' }}>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.id} className={`p-2 font-medium whitespace-nowrap ${c.right ? 'text-right' : 'text-left'}`} style={{ color: 'var(--color-muted)' }} aria-sort={sort === c.id ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                  {c.sortable === false ? <Tooltip text={c.tip}><span tabIndex={0}>{c.label}</span></Tooltip> : (
                    <Tooltip text={`${c.tip} Click to sort.`}>
                      <button type="button" onClick={() => onSort(c.id)} className="inline-flex items-center gap-1 transition-opacity duration-200 hover:opacity-70" style={{ color: sort === c.id ? 'var(--color-text)' : 'var(--color-muted)' }}>
                        {c.label}{sort === c.id && getIcon(dir === 'asc' ? 'chevron-up' : 'chevron-down', { size: 12 })}
                      </button>
                    </Tooltip>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.tasks.map((t) => (
              <tr
                key={t.id}
                tabIndex={0}
                onClick={() => setOpen(t)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(t); } }}
                className="border-t cursor-pointer transition-opacity duration-200 hover:opacity-70"
                style={{ borderColor: 'var(--color-border)' }}
                aria-label={`Open ${t.name || 'task'} from ${brisbaneTime(t.started)}`}
              >
                <td className="p-2 whitespace-nowrap" style={cellStyle}>{brisbaneTime(t.started)}</td>
                <td className="p-2 whitespace-nowrap" style={cellStyle}>{t.project || '–'}</td>
                <td className="p-2 max-w-[22rem] truncate" style={cellStyle} title={t.name}>{t.name || <span style={{ color: 'var(--color-muted)' }}>(no name)</span>}</td>
                <td className="p-2 whitespace-nowrap" style={cellStyle}>{(t.model || '–').replace(/^claude-/, '')}</td>
                <td className="p-2" style={cellStyle}>{t.level || '–'}</td>
                <td className="p-2 text-right" style={cellStyle}>{money(t.cost)}</td>
                <td className="p-2 text-right" style={cellStyle}>{t.turns}</td>
                <td className="p-2 text-right" style={cellStyle}>{(t.agentMs / 60000).toFixed(1)}</td>
                <td className="p-2 text-right" style={cellStyle}>{compact(totalTokens(t.tokens))}</td>
                <td className="p-2 text-right whitespace-nowrap" style={cellStyle}>{pct(t.reuse)} <span style={{ color: 'var(--color-muted)' }}>({t.reused}/{t.created})</span></td>
                <td className="p-2 whitespace-nowrap" style={{ color: /failed$/.test(t.tests) ? '#ef4444' : 'var(--color-text)' }}>{t.tests || '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs" style={{ color: 'var(--color-muted)' }}>
          <Tooltip text="Previous page of tasks."><button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className={BTN} style={btnStyle} aria-label="Previous page">{getIcon('chevron-left', { size: 14 })}</button></Tooltip>
          Page {page} of {pages} · {data.total} tasks
          <Tooltip text="Next page of tasks."><button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} className={BTN} style={btnStyle} aria-label="Next page">{getIcon('chevron-right', { size: 14 })}</button></Tooltip>
        </div>
      )}
      {open && <Detail task={open} onClose={() => setOpen(null)} onDelete={async (t) => { await onDelete(t); setOpen(null); }} />}
    </>
  );
}
