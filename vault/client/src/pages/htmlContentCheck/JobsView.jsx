import React, { useState } from 'react';
import Tooltip from '../../components/Tooltip';
import Skeleton from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import { CARD, FIELD_CLASS, FIELD_STYLE, SecondaryButton, Badge, formatDate } from './shared';
import { STATUS_LABELS, KIND_LABELS } from './htmlContentCheckTools.mjs';

// Your jobs: newest first, searchable by name or address. Delete is inline Yes / No; the job goes to the recycle bin (Undo in the toast).
export default function JobsView({ jobs, search, setSearch, openJob, deleteJob, newJob }) {
  const [pendingDelete, setPendingDelete] = useState(null);
  return (
    <section className="rounded-2xl border p-6 space-y-4" style={CARD}>
      <Tooltip text="Find a job by its name or page address. Every word you type is searched as one phrase.">
        <VoiceInput value={search} onChange={setSearch} label="Search jobs" placeholder="Search by name or address" className={FIELD_CLASS} style={FIELD_STYLE} />
      </Tooltip>
      {jobs === null && <Skeleton lines={4} />}
      {jobs?.length === 0 && (search
        ? <EmptyState icon="search" title="No job matches" body="Try part of the page address or the job name." />
        : <EmptyState icon="list-checks" title="No jobs yet" body="A job is one web page: the change request you were sent, checked against the page." action={<SecondaryButton tip="Start a new job." onClick={newJob}>New job</SecondaryButton>} />)}
      <ul className="flex flex-col xl:grid xl:grid-cols-2 gap-3">
        {jobs?.map((j) => (
          <li key={j.id} className="group rounded-xl border p-4 flex gap-3 items-start" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <Tooltip text="Open this job.">
              <button type="button" onClick={() => openJob(j.id)} className="flex-1 min-w-0 text-left transition-opacity duration-200 hover:opacity-70">
                <span className="block text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{j.name}</span>
                <span className="block text-xs truncate" style={{ color: 'var(--color-muted)' }}>{j.url}</span>
                <span className="flex flex-wrap gap-1.5 mt-2">
                  <Badge>{KIND_LABELS[j.kind] || j.kind}</Badge>
                  <Badge>{STATUS_LABELS[j.status] || j.status}</Badge>
                  {j.pageCount > 1 && <Badge>{j.pageCount} pages</Badge>}
                  {j.kind === 'request' && <Badge>{j.itemCount} line{j.itemCount === 1 ? '' : 's'}</Badge>}
                  <Badge>{j.roundCount ? `${j.roundCount} round${j.roundCount === 1 ? '' : 's'}, last ${formatDate(j.lastFetchedAt)}` : 'Not fetched yet'}</Badge>
                  {j.openNotes > 0 && <Badge>{j.openNotes} open client note{j.openNotes === 1 ? '' : 's'}</Badge>}
                </span>
                <span className="block text-[11px] mt-1.5" style={{ color: 'var(--color-muted)' }}>Updated {formatDate(j.updatedAt)}</span>
              </button>
            </Tooltip>
            {pendingDelete === j.id ? (
              <span className="flex items-center gap-1 text-xs shrink-0" style={{ color: 'var(--color-text)' }}>
                Delete?
                <SecondaryButton tip="Yes: delete it. It stays in the recycle bin for 30 days." danger onClick={() => { setPendingDelete(null); deleteJob(j); }}>Yes</SecondaryButton>
                <SecondaryButton tip="No: keep it." onClick={() => setPendingDelete(null)}>No</SecondaryButton>
              </span>
            ) : (
              <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 shrink-0">
                <SecondaryButton tip="Delete this job, with its request lines and rounds. It stays in the recycle bin for 30 days." onClick={() => setPendingDelete(j.id)}>Delete</SecondaryButton>
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
