import { useState } from 'react';
import { openRedItems, timeline } from '../project/engine';
import type { Project } from '../project/model';
import { summaryLine } from '../project/track';
import { VERDICT_TEXT } from '../review/verdict';
import { fmtDate, fmtSize } from './ProjectsView';

/**
 * Timeline (addendum §7.6-7.8): one row per round, the original's history, and the round actions: open a round, make the latest round the
 * new original (reason required, open red items listed), delete rounds, compact old rounds, export.
 */
export function TimelineView({ project, viewing, warnMb, onOpenRound, onDeleteFrom, onNewOriginal, onCompact, onExport }: {
  project: Project;
  viewing?: number;
  warnMb: number;
  onOpenRound: (n: number) => void;
  onDeleteFrom: (n: number) => void;
  onNewOriginal: (reason: string) => void;
  onCompact: () => void;
  onExport: () => void;
}) {
  const rows = timeline(project);
  const last = project.rounds[project.rounds.length - 1];
  const [confirmDelete, setConfirmDelete] = useState<number>();
  const [newOriginal, setNewOriginal] = useState(false);
  const [reason, setReason] = useState('');
  const absorbing = last ? openRedItems(last) : [];
  const compactable = project.rounds.slice(0, -2).filter((r) => r.file.bytes);
  const big = (project.sizeBytes ?? 0) > warnMb * 1048576;

  return (
    <section aria-label="Timeline">
      <div className="saved-bar">
        <span><strong>{project.name}</strong> <span className="muted small">· {project.rounds.length} round{project.rounds.length === 1 ? '' : 's'} · {fmtSize(project.sizeBytes ?? 0)}</span></span>
        <button className="btn" onClick={onExport} title="Save the whole project (files, rounds and decisions) as one .doccompare file on this computer.">Export project</button>
        <button className="btn ghost" disabled={!compactable.length} onClick={onCompact} data-guide="compact"
          title={compactable.length ? `Delete the files of ${compactable.length} old round${compactable.length === 1 ? '' : 's'} to free space. Their changes, decisions and verdicts stay; the originals and the last two rounds keep their files.` : 'Nothing to compact: the originals and the last two rounds always keep their files.'}>Compact old rounds</button>
      </div>
      {big && <div className="gate gate-warn" role="alert">This project uses {fmtSize(project.sizeBytes ?? 0)}, over {warnMb} MB. Export it, then compact old rounds to free space.</div>}

      {rows.length === 0 ? (
        <div className="empty-view"><h2>No rounds yet</h2><p className="muted">Add the LLM's first draft in Compare documents. Each draft you add becomes the next round.</p></div>
      ) : (
        <div className="table-wrap" data-guide="timeline-table">
          <table className="timeline">
            <caption className="table-caption">Rounds, checked against your original{project.originalHistory.length ? ' (and the originals that replaced it)' : ''}. Press a round to open its results.</caption>
            <thead><tr><th scope="col">Round</th><th scope="col">Added</th><th scope="col">Note</th><th scope="col">Words</th><th scope="col">Sections</th><th scope="col">References</th><th scope="col">Fixed / not fixed / new</th><th scope="col">Red / amber / info</th><th scope="col">Verdict</th><th scope="col" /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.number} className={`${r.largestLoss ? 'flagged' : ''}${r.number === viewing ? ' current' : ''}`}>
                  <th scope="row"><button className="link" onClick={() => onOpenRound(r.number)} title={r.number === last?.number ? 'Open this round: decide its items.' : 'Open this round read-only (you can still undo an acceptance).'}>Round {r.number}</button>{r.compacted && <span className="muted small"> · File not kept</span>}</th>
                  <td>{fmtDate(r.addedAt)}</td>
                  <td>{r.note ?? '—'}{r.replacedOriginal && <div className="small"><strong>Became the new original</strong> ({fmtDate(r.replacedOriginal.replacedAt)}): {r.replacedOriginal.reason}. {r.replacedOriginal.absorbed} open issue{r.replacedOriginal.absorbed === 1 ? '' : 's'} accepted with it.</div>}</td>
                  <td>{r.words.toLocaleString('en-AU')}{r.wordsLost ? <span className="muted small"> (−{r.wordsLost.toLocaleString('en-AU')})</span> : ''}{r.largestLoss && <span className="small" title="The round that lost the most words."> ⚑ most lost</span>}</td>
                  <td>{r.sections}</td>
                  <td>{r.references}</td>
                  <td>{r.number === 1 ? '—' : `${r.summary.fixed} / ${r.summary.notFixed} / ${r.summary.new}`}</td>
                  <td>{r.counts.red} / {r.counts.amber} / {r.counts.info}</td>
                  <td><span className={`badge verdict-badge-${r.verdict}`}>{VERDICT_TEXT[r.verdict].icon} {VERDICT_TEXT[r.verdict].title}</span></td>
                  <td>
                    {confirmDelete === r.number ? (
                      <span className="inline confirm">Delete {r.number === last?.number ? `round ${r.number}` : `rounds ${r.number}–${last?.number}`}? <button className="btn danger" onClick={() => { onDeleteFrom(r.number); setConfirmDelete(undefined); }} title="This cannot be undone.">Yes</button><button className="btn ghost" onClick={() => setConfirmDelete(undefined)}>No</button></span>
                    ) : (
                      <button className="btn ghost" onClick={() => setConfirmDelete(r.number)}
                        title={r.number === last?.number ? 'Delete this round.' : `Each round is compared with the one before it, so deleting round ${r.number} also deletes rounds ${r.number + 1}–${last?.number}.`}>Delete</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {last && last.number > 1 && <p className="muted small">{summaryLine(last.number, last.summary)}</p>}

      {last && (
        <div className="meta" data-guide="new-original">
          {!newOriginal ? (
            <>
              <strong>Restructured the document on purpose?</strong> <span className="muted small">Make round {last.number} the new original, so later rounds are not flagged for the whole rewrite. This is always shown in the timeline and the report.</span>
              <div className="row"><button className="btn" disabled={!last.file.bytes} onClick={() => setNewOriginal(true)} title={last.file.bytes ? `Use round ${last.number} as the original from now on.` : 'This round\'s file is not kept.'}>Make round {last.number} the new original…</button></div>
            </>
          ) : (
            <div role="dialog" aria-labelledby="no-title">
              <h3 id="no-title">Make round {last.number} the new original</h3>
              <label className="field">Why? (required, shown in the timeline and the report)
                <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Restructured to follow the committee's terms of reference" />
              </label>
              {absorbing.length > 0 ? (
                <div className="gate gate-warn"><strong>Any open issues in this round will be accepted as part of the new original.</strong> These {absorbing.length} red item{absorbing.length === 1 ? ' is' : 's are'} still open:
                  <ul>{absorbing.map((i) => <li key={i.itemId}>{i.change.summary ?? i.change.detail}</li>)}</ul>
                </div>
              ) : <p className="muted small">No red items are open in this round.</p>}
              <div className="row">
                <button className="btn primary" disabled={!reason.trim()} onClick={() => { onNewOriginal(reason); setNewOriginal(false); setReason(''); }}>Make it the new original</button>
                <button className="btn ghost" onClick={() => { setNewOriginal(false); setReason(''); }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {project.originalHistory.length > 0 && (
        <div className="meta">
          <strong>Earlier originals</strong>
          <ul>
            {project.originalHistory.map((h) => (
              <li key={h.replacedAt}>{h.file.name}: replaced by round {h.replacedByRound} on {fmtDate(h.replacedAt)}. Reason: {h.reason}. {h.absorbed} open issue{h.absorbed === 1 ? '' : 's'} accepted with it{h.absorbedItems.length ? `: ${h.absorbedItems.join('; ')}` : ''}.</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
