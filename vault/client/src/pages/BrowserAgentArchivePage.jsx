import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { useIcon } from '../providers/IconProvider';
import api from '../utils/apiClient';
import Tooltip from '../components/Tooltip';

const MD_COMPONENTS = {
  p: ({ children }) => <span>{children}</span>,
  ul: ({ children }) => <ul className="list-disc pl-4">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-4">{children}</ol>,
  a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer" className="underline">{children}</a>,
};

const OUTCOME_LABEL = {
  handed_off: 'Handed off',
  cancelled: 'Cancelled',
  stopped: 'Stopped early',
  stuck: 'Stuck (repeated failure)',
  error: 'Error',
};

function formatDuration(startedAt, endedAt) {
  if (!startedAt || !endedAt) return null;
  const secs = Math.round((new Date(endedAt) - new Date(startedAt)) / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

export default function BrowserAgentArchivePage() {
  const getIcon = useIcon();
  const [runs, setRuns] = useState(null);
  const [expandedRun, setExpandedRun] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [deleting, setDeleting] = useState(false);

  const loadRuns = useCallback(() => {
    api.get('/api/browser-agent/runs').then((res) => (res.ok ? res.json() : [])).then(setRuns).catch(() => setRuns([]));
  }, []);

  useEffect(() => { loadRuns(); }, [loadRuns]);

  function toggleSelected(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === runs.length ? new Set() : new Set(runs.map((r) => r.id))));
  }

  async function deleteSelected() {
    if (!selected.size || deleting) return;
    setDeleting(true);
    try {
      await api.post('/api/browser-agent/runs/delete', { ids: [...selected] });
      setSelected(new Set());
      setExpandedRun(null);
      loadRuns();
    } finally {
      setDeleting(false);
    }
  }

  async function deleteOne(id) {
    await api.post('/api/browser-agent/runs/delete', { ids: [id] });
    setSelected((prev) => { const next = new Set(prev); next.delete(id); return next; });
    if (expandedRun === id) setExpandedRun(null);
    loadRuns();
  }

  return (
    <div className="max-w-3xl mx-auto p-5">
      <div className="flex items-center gap-3 mb-4">
        <Link to="/browser-agent" className="text-sm hover:opacity-60 flex items-center gap-1" style={{ color: 'var(--color-muted)' }}>
          {getIcon('arrow-left', { size: 15 })} Browser Agent
        </Link>
      </div>

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          {getIcon('archive', { size: 18 })} Archive
        </h1>
        {runs?.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-60"
              style={{ borderColor: 'var(--color-border)' }}
              onClick={toggleSelectAll}
            >
              {selected.size === runs.length ? 'Deselect all' : 'Select all'}
            </button>
            <button
              className="text-xs px-3 py-1.5 rounded-lg font-medium hover:opacity-70 disabled:opacity-40"
              style={{ background: '#ef4444', color: '#fff' }}
              disabled={!selected.size || deleting}
              onClick={deleteSelected}
            >
              Delete {selected.size > 0 ? `(${selected.size})` : ''}
            </button>
          </div>
        )}
      </div>

      {runs === null ? (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>
      ) : runs.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No attempts yet — runs are archived here after each one finishes.</p>
      ) : (
        <ul className="space-y-2">
          {runs.map((r) => (
            <li key={r.id} className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
              <div className="flex items-start gap-2.5 px-3 py-2.5">
                <input
                  type="checkbox"
                  className="mt-1 flex-none"
                  checked={selected.has(r.id)}
                  onChange={() => toggleSelected(r.id)}
                />
                <button
                  className="flex-1 min-w-0 text-left hover:opacity-70"
                  onClick={() => setExpandedRun(expandedRun === r.id ? null : r.id)}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded flex-none"
                      style={{
                        background: r.outcome === 'handed_off' ? '#f9e8cf' : (r.outcome === 'error' || r.outcome === 'stuck') ? '#fee2e2' : 'var(--color-bg)',
                        color: r.outcome === 'handed_off' ? '#9a5a12' : (r.outcome === 'error' || r.outcome === 'stuck') ? '#b91c1c' : 'var(--color-muted)',
                      }}
                    >
                      {OUTCOME_LABEL[r.outcome] || r.outcome}
                    </span>
                    <span className="text-xs truncate" style={{ color: 'var(--color-muted)' }}>
                      {new Date(r.startedAt).toLocaleString()}
                      {' · '}{r.steps ?? 0} step{r.steps === 1 ? '' : 's'}
                      {formatDuration(r.startedAt, r.endedAt) && ` · ${formatDuration(r.startedAt, r.endedAt)}`}
                    </span>
                  </div>
                  <p className="text-sm mt-1">{r.instruction}</p>
                </button>
                <Tooltip text="Delete this run">
                  <button
                    className="flex-none text-xs px-2 py-1 rounded-lg hover:opacity-60"
                    style={{ color: '#ef4444' }}
                    onClick={() => deleteOne(r.id)}
                  >
                    {getIcon('trash', { size: 14 })}
                  </button>
                </Tooltip>
              </div>
              {expandedRun === r.id && (
                <div className="px-3 pb-3 text-sm" style={{ borderTop: '1px solid var(--color-border)' }}>
                  {r.summary && <p className="mt-2 italic" style={{ color: 'var(--color-muted)' }}>{r.summary}</p>}
                  <RunLog runId={r.id} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RunLog({ runId }) {
  const [entries, setEntries] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api.get(`/api/browser-agent/runs/${runId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (!cancelled) setEntries(data?.log || []); })
      .catch(() => { if (!cancelled) setEntries([]); });
    return () => { cancelled = true; };
  }, [runId]);

  if (entries === null) return <p className="mt-2 text-xs" style={{ color: 'var(--color-muted)' }}>Loading…</p>;

  function copyLog() {
    const text = entries.filter((e) => e.kind !== 'error_screenshot').map((e) => `[${e.kind}] ${e.text}`).join('\n');
    navigator.clipboard?.writeText(text).catch(() => {});
  }
  function downloadLog() {
    const text = entries.filter((e) => e.kind !== 'error_screenshot').map((e) => `[${e.kind}] ${e.text}`).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `browser-agent-log-${runId}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <>
    {entries.length > 0 && (
      <div className="flex justify-end gap-2 mt-2">
        <button type="button" className="text-[11px] hover:opacity-60" style={{ color: 'var(--color-muted)' }} onClick={copyLog}>Copy</button>
        <button type="button" className="text-[11px] hover:opacity-60" style={{ color: 'var(--color-muted)' }} onClick={downloadLog}>Download</button>
      </div>
    )}
    <ol className="mt-2 space-y-1 text-xs">
      {entries.map((e, i) => (
        <li key={i} style={{ color: e.kind === 'error' ? '#ef4444' : e.kind === 'guard' ? '#9a5a12' : 'var(--color-muted)' }}>
          {e.kind === 'error_screenshot' ? (
            <img src={e.text} alt="Page at time of error" className="rounded-lg border w-full mt-1" style={{ borderColor: 'var(--color-border)' }} />
          ) : (
            <ReactMarkdown components={MD_COMPONENTS}>{e.text}</ReactMarkdown>
          )}
        </li>
      ))}
    </ol>
    </>
  );
}
