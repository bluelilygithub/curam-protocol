import React from 'react';
import Tooltip from '../../components/Tooltip';
import { PrimaryButton, SecondaryButton, formatDate } from './shared';

// The request beside the changes (Changes screen). Match to request asks the AI which changes look like they answer each line; code
// lists the lines with no change found and the changes nobody asked for. Click a line to see its changes; Change links lets the person
// link and unlink by hand (kept over any later AI run). Nothing here says an edit is right or done.
export default function RequestPanel({ job, matches, selected, setSelected, editing, setEditing, onMatch, canMatch, busy, linkedCount, unasked }) {
  const line = (it) => matches?.items?.[it.ref];
  return (
    <section className="rounded-2xl border p-6 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>The request</h2>
        <PrimaryButton disabled={!canMatch || busy} onClick={onMatch}
          tip={canMatch ? 'The AI suggests which changes look like they answer each line, with a short reason. It never says an edit is right or done; you judge that. Lines you linked by hand are kept.' : 'Check the page again after the edits first: matching needs a round after the starting point.'}>
          {matches?.at ? 'Match again' : 'Match to request'}
        </PrimaryButton>
      </div>
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
        {matches?.at ? `Matched ${formatDate(matches.at)} against the changes since the starting point. Suggestions only: you judge each edit.` : 'Matching links each line to the changes since the starting point that seem to answer it.'}
        {matches?.usage?.changesLeftOut ? ` This page has many changes: ${matches.usage.changesLeftOut} were not sent to the AI (real changes went first); link those by hand if needed.` : ''}
      </p>
      <ol className="space-y-1.5">
        {job.items.map((it) => {
          const m = line(it);
          const on = selected === it.ref;
          return (
            <li key={it.id}>
              <Tooltip text={on ? 'Show every change again.' : 'Highlight the changes linked to this line.'}>
                <button type="button" onClick={() => setSelected(on ? null : it.ref)} aria-pressed={on}
                  className="w-full text-left rounded-xl border p-2.5 transition-opacity duration-200 hover:opacity-70"
                  style={{ borderColor: on ? 'var(--color-primary)' : 'var(--color-border)', background: 'var(--color-bg)' }}>
                  <span className="flex gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
                    <span className="text-xs font-semibold w-8 shrink-0 pt-0.5" style={{ color: 'var(--color-primary)' }}>{it.ref}</span>
                    <span className="flex-1">{it.lineText}</span>
                  </span>
                  {m && (
                    <span className="block text-xs mt-1 pl-10" style={{ color: m.unreadable ? '#b45309' : m.changeIds.length ? 'var(--color-muted)' : '#991b1b' }}>
                      {m.unreadable ? 'Could not read this line in the AI\'s answer. Link its changes by hand, or match again.'
                        : m.changeIds.length ? `${m.changeIds.length} change${m.changeIds.length === 1 ? '' : 's'} linked${m.by === 'person' ? ' by you' : m.reason ? `: ${m.reason}` : ''}`
                          : `No change found${m.by === 'person' ? ' (unlinked by you)' : m.reason ? `: ${m.reason}` : ''}`}
                    </span>
                  )}
                </button>
              </Tooltip>
            </li>
          );
        })}
      </ol>
      {matches?.at && (
        <div className="text-xs space-y-1" style={{ color: 'var(--color-muted)' }}>
          <p><strong style={{ color: 'var(--color-text)' }}>Lines with no change found:</strong> {matches.unmatchedItems.length ? matches.unmatchedItems.join(', ') : 'none'}</p>
          <p><strong style={{ color: 'var(--color-text)' }}>Changes nobody asked for:</strong> {unasked}. {linkedCount} change{linkedCount === 1 ? ' is' : 's are'} linked to the request.</p>
        </div>
      )}
      {selected && (
        editing
          ? <SecondaryButton tip="Stop changing links." onClick={() => setEditing(false)}>Done linking</SecondaryButton>
          : <SecondaryButton tip={`Link or unlink changes for ${selected} by hand. Your links are kept when matching again.`} onClick={() => setEditing(true)}>Change links for {selected}</SecondaryButton>
      )}
    </section>
  );
}
