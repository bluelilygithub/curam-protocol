import React, { useMemo, useState } from 'react';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import EmptyState from '../../components/EmptyState';
import Skeleton from '../../components/Skeleton';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import { LANGUAGES } from '../../utils/translateLanguages';
import { StatusBadge, Tip, Sel, isSpreadsheet } from './shared';
import { parseQa, resultVerdict, isStalled, VERDICT_COLOURS } from './qaReport';

// My translations: the counts at the top (press one to show only those), then every job with its verdict and the way into its result.

const langLabel = (code) => LANGUAGES.find((l) => l.code === code)?.label || code || '?';

const FILTERS = [
  { id: 'all', label: 'All', tip: 'Show every translation.' },
  { id: 'toread', label: 'Ready to read', tip: 'Drafts waiting for you: read them, run another pass if something needs changing, then press Keep this version. Press to show only these.' },
  { id: 'kept', label: 'Kept', tip: 'Translations you have kept, with their downloads. Press to show only these.' },
  { id: 'check', label: 'Need checking', tip: 'Ready to read or kept, but the checks listed something serious: meaning that may have changed, or garbled or unfinished parts. Press to show only these.' },
  { id: 'running', label: 'Running', tip: 'Still being translated, or having its files made. You can close the page; it carries on. Press to show only these.' },
  { id: 'stopped', label: 'Did not finish', tip: 'Failed, cancelled, or stopped part-way because the server restarted. Press to show only these.' },
];

// How long translations are kept (the person's own setting translate_keep_days; the server deletes older ones when it starts).
export const KEEP_OPTIONS = [
  { v: '90', label: '90 days' },
  { v: '365', label: '1 year' },
  { v: '0', label: 'Until I delete them' },
];

function bucketOf(job, activeJobId) {
  if (job.status === 'done') return 'kept';
  if (job.status === 'ready') return 'toread';
  if (job.status === 'failed' || job.status === 'cancelled' || isStalled(job, activeJobId)) return 'stopped';
  return 'running';
}

const SMALL_BTN = 'text-xs px-2.5 py-1 rounded-lg border inline-flex items-center gap-1 transition-opacity duration-200 hover:opacity-70';

export default function JobsDashboard({
  jobs, loading, activeJobId, deletingId, onOpen, onCancel, onDelete, onDownload, onDownloadNative, onNew, tooLargeId, onKeepTooLarge,
  keepDays, onKeepDays,
}) {
  const getIcon = useIcon();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);

  const rows = useMemo(() => jobs.map((job) => {
    const qa = parseQa(job);
    const bucket = bucketOf(job, activeJobId);
    const verdict = job.status === 'done' || job.status === 'ready' || qa ? resultVerdict(qa) : null;
    return { job, bucket, verdict, stalled: bucket === 'stopped' && !['failed', 'cancelled'].includes(job.status) };
  }), [jobs, activeJobId]);

  const needsCheck = (r) => (r.bucket === 'kept' || r.bucket === 'toread') && r.verdict?.level === 'check';
  const counts = useMemo(() => ({
    all: rows.length,
    toread: rows.filter((r) => r.bucket === 'toread').length,
    kept: rows.filter((r) => r.bucket === 'kept').length,
    check: rows.filter(needsCheck).length,
    running: rows.filter((r) => r.bucket === 'running').length,
    stopped: rows.filter((r) => r.bucket === 'stopped').length,
  }), [rows]);

  const q = search.trim().toLowerCase();
  const shown = rows.filter((r) => {
    if (q && !(r.job.filename || '').toLowerCase().includes(q)) return false;
    if (filter === 'all') return true;
    if (filter === 'check') return needsCheck(r);
    return r.bucket === filter;
  });

  if (loading) return <Skeleton lines={5} className="h-8" label="Loading your translations" />;

  if (!jobs.length) {
    return (
      <EmptyState
        icon="languages"
        title="No translations yet"
        body="Translations you run appear here with their downloads and what the checks found."
        action={(
          <button
            type="button"
            onClick={onNew}
            className="px-3.5 py-1.5 rounded-lg text-sm font-medium transition-opacity duration-200 hover:opacity-70"
            style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}
          >
            New translation
          </button>
        )}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3" data-tour="translate-counts">
        {FILTERS.map((f) => (
          <Tooltip key={f.id} text={f.tip}>
            <button
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className="text-left rounded-2xl border p-3 transition-opacity duration-200 hover:opacity-70"
              style={{ borderColor: filter === f.id ? 'var(--color-primary)' : 'var(--color-border)', background: 'var(--color-surface)' }}
            >
              <span className="block text-2xl font-semibold" style={{ color: f.id === 'check' && counts.check ? VERDICT_COLOURS.check : 'var(--color-text)' }}>
                {counts[f.id]}
              </span>
              <span className="block text-xs" style={{ color: 'var(--color-muted)' }}>{f.label}</span>
            </button>
          </Tooltip>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tip text="Show only the translations whose file name contains these words. The microphone lets you say it instead." className="w-full sm:max-w-sm">
          <VoiceInput value={search} onChange={setSearch} placeholder="Find by file name…" label="Find a translation by file name" className="!py-1.5" />
        </Tip>
        {onKeepDays && (
          <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-muted)' }}>
            Translations are kept for
            <Tip text="Translations older than this are deleted for good, with their files, the next time Vault starts. Choose Until I delete them to keep everything." className="w-44">
              <Sel value={keepDays} onChange={onKeepDays} aria-label="How long translations are kept">
                {KEEP_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
              </Sel>
            </Tip>
          </label>
        )}
      </div>

      {!shown.length ? (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          Nothing here{q ? ` matches “${search}”` : ''}.{' '}
          <button
            type="button"
            className="underline transition-opacity duration-200 hover:opacity-60"
            style={{ color: 'var(--color-primary)' }}
            onClick={() => { setFilter('all'); setSearch(''); }}
          >
            Show all
          </button>
        </p>
      ) : (
        <div className="rounded-2xl border overflow-x-auto" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }} data-tour="translate-jobs-table">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                {['File', 'Languages', 'Size', 'Date', 'Status', 'Actions'].map((h) => (
                  <th key={h} className={`px-3 py-2 text-xs font-medium ${h === 'Actions' ? 'text-right' : 'text-left'}`} style={{ color: 'var(--color-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map(({ job, verdict, stalled }) => {
                const finished = ['done', 'failed', 'cancelled', 'ready', 'generating'].includes(job.status) || stalled;
                const lowScan = job.avgOcrConfidence != null && job.avgOcrConfidence < 0.7;
                const kind = isSpreadsheet(job) ? 'Excel' : 'Word';
                return (
                  <tr key={job.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td className="px-3 py-2.5" style={{ color: 'var(--color-text)', maxWidth: 360 }}>
                      <Tooltip text={job.filename || 'document'}><span className="truncate block">{job.filename}</span></Tooltip>
                      {lowScan && (
                        <Tooltip text="The scanned pages were hard to read, so the translation of those pages may be wrong. Check them against the original.">
                          <span className="inline-flex items-center gap-1 text-xs" style={{ color: '#b45309' }}>
                            {getIcon('alert-triangle', { size: 12 })} Scan was hard to read
                          </span>
                        </Tooltip>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap" style={{ color: 'var(--color-muted)' }}>
                      {job.sourceLanguage ? langLabel(job.sourceLanguage) : '?'} → {langLabel(job.targetLanguage)}
                    </td>
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap" style={{ color: 'var(--color-muted)' }}>
                      {job.pageCount ? `${job.pageCount} page${job.pageCount === 1 ? '' : 's'}` : '—'}
                      {job.scannedPageCount > 0 ? ` (${job.scannedPageCount} scanned)` : ''}
                      {job.charCount > 0 ? <span className="block">{Number(job.charCount).toLocaleString()} characters</span> : null}
                    </td>
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap" style={{ color: 'var(--color-muted)' }}>
                      {new Date(job.createdAt).toLocaleDateString('en-AU')}
                    </td>
                    <td className="px-3 py-2.5">
                      {stalled ? (
                        <Tooltip text="This translation stopped part-way, usually because the server restarted while it ran. It cannot carry on. Delete it and run the document again.">
                          <span className="text-xs font-medium" style={{ color: '#b45309' }}>Stopped part-way</span>
                        </Tooltip>
                      ) : <StatusBadge status={job.status} />}
                      {bucketOf(job, activeJobId) === 'running' && !stalled && (
                        <span className="block text-xs mt-1" style={{ color: 'var(--color-muted)', maxWidth: 260 }}>
                          {job.stage || 'Waiting to start'}{job.progress != null ? ` · ${job.progress}%` : ''}
                          <span className="block h-1 rounded-full mt-1 overflow-hidden" style={{ background: 'var(--color-border)', width: 160 }}>
                            <span className="block h-1" style={{ width: `${Math.max(3, Math.min(100, Number(job.progress) || 0))}%`, background: 'var(--color-primary)', transition: 'width 200ms' }} />
                          </span>
                        </span>
                      )}
                      {job.runningPass && (
                        <span className="block text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                          Pass {job.runningPass.passNo} running{job.runningPass.progress != null ? ` · ${job.runningPass.progress}%` : ''}
                        </span>
                      )}
                      {job.status === 'ready' && job.errorMessage && (
                        <span className="block text-xs mt-1" style={{ color: '#991b1b', maxWidth: 260 }}>{job.errorMessage}</span>
                      )}
                      {(job.status === 'done' || job.status === 'ready') && verdict && (
                        <Tooltip text={`${verdict.detail} This says which kinds of problem the checks listed. It is not an accuracy score.`}>
                          <span className="block text-xs mt-1" style={{ color: VERDICT_COLOURS[verdict.level] }}>{verdict.label}</span>
                        </Tooltip>
                      )}
                      {job.status === 'failed' && job.errorMessage && (
                        <span className="block text-xs mt-1" style={{ color: '#991b1b', maxWidth: 260 }}>{job.errorMessage}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex gap-2 flex-wrap justify-end items-center">
                        {(job.status === 'done' || job.status === 'ready' || job.qaSummaryJson) && (
                          <Tooltip text={job.status === 'ready' ? 'Read this translation beside the original, run another pass if something needs changing, and keep it when you are happy.' : 'Open this translation: read it beside the original, what the checks found, and its downloads.'}>
                            <button
                              type="button"
                              onClick={() => onOpen(job)}
                              className="text-xs px-2.5 py-1 rounded-lg font-medium transition-opacity duration-200 hover:opacity-70"
                              style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}
                            >
                              Open result
                            </button>
                          </Tooltip>
                        )}
                        {job.status === 'done' && (
                          <Tooltip text="Download the translated PDF.">
                            <button type="button" onClick={() => onDownload(job)} aria-label="Download the translated PDF" className={SMALL_BTN} style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                              {getIcon('download', { size: 12 })} PDF
                            </button>
                          </Tooltip>
                        )}
                        {job.hasNativeOutput && (
                          <Tooltip text={`Download the translation as an editable ${kind} file that keeps the original file's formatting.`}>
                            <button type="button" onClick={() => onDownloadNative(job)} aria-label={`Download the ${kind} file`} className={SMALL_BTN} style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                              {getIcon('download', { size: 12 })} {kind}
                            </button>
                          </Tooltip>
                        )}
                        {!finished && (
                          <Tooltip text="Stop this translation. Work already done on it is thrown away.">
                            <button type="button" onClick={() => onCancel(job.id)} className={SMALL_BTN} style={{ borderColor: '#fca5a5', color: '#ef4444' }}>
                              Cancel
                            </button>
                          </Tooltip>
                        )}
                        {tooLargeId === job.id ? (
                          <span className="text-xs inline-flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                            Too big for the recycle bin. Delete for good?
                            <button
                              type="button"
                              disabled={deletingId === job.id}
                              className="underline transition-opacity duration-200 hover:opacity-60"
                              style={{ color: '#ef4444' }}
                              onClick={() => onDelete(job.id, { forever: true })}
                            >
                              Yes
                            </button>
                            <button
                              type="button"
                              className="underline transition-opacity duration-200 hover:opacity-60"
                              style={{ color: 'var(--color-muted)' }}
                              onClick={onKeepTooLarge}
                            >
                              No, keep it
                            </button>
                          </span>
                        ) : confirmDelete === job.id ? (
                          <span className="text-xs inline-flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                            Delete?
                            <button
                              type="button"
                              disabled={deletingId === job.id}
                              className="underline transition-opacity duration-200 hover:opacity-60"
                              style={{ color: '#ef4444' }}
                              onClick={() => { onDelete(job.id); setConfirmDelete(null); }}
                            >
                              Yes
                            </button>
                            <button
                              type="button"
                              className="underline transition-opacity duration-200 hover:opacity-60"
                              style={{ color: 'var(--color-muted)' }}
                              onClick={() => setConfirmDelete(null)}
                            >
                              No
                            </button>
                          </span>
                        ) : (
                          <Tooltip text="Delete this translation and its files. It asks first, then keeps them in the recycle bin for 30 days (Settings, Recycle bin) in case you want them back.">
                            <button type="button" onClick={() => setConfirmDelete(job.id)} aria-label={`Delete ${job.filename || 'this translation'}`} className={SMALL_BTN} style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
                              {getIcon('trash', { size: 13 })}
                            </button>
                          </Tooltip>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
