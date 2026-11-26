import React from 'react';
import Tooltip from '../../components/Tooltip';
import { PrimaryButton, SecondaryButton, Badge, formatDate } from './shared';
import { LINE_STATUS } from './htmlContentCheckTools.mjs';

// The request beside the changes (Changes screen), for the page on show: its own lines and the lines with no page (matched against every
// page). Match to request asks the AI, page by page, which changes look like they answer each line; code works out the rest. A line's
// state (`lines`, from the server) is across the whole round: linked on any page in its scope, no change found, held over, or a Keep
// check. Click a normal line to see its changes on this page; Change links lets the person link and unlink by hand (kept over any later
// AI run). Nothing here says an edit is right or done.
const TONE = { noChange: '#991b1b', unreadable: '#b45309', keepChanged: '#991b1b', keepNotOnStartingPage: '#b45309' };

export default function RequestPanel({ job, pageId, pageName, lines, matches, selected, setSelected, editing, setEditing, onMatch, canMatch, canLink, busy, linkedCount, unasked }) {
  const byRef = Object.fromEntries(lines.map((l) => [l.ref, l]));
  const multi = (job.pages || []).length > 1;
  const scope = job.items.filter((it) => it.pageId == null || it.pageId === pageId);
  const others = job.items.length - scope.length;
  const unmatched = lines.filter((l) => l.status === 'noChange' || l.status === 'unreadable').map((l) => l.ref);
  const keepWarn = lines.filter((l) => l.status === 'keepChanged').map((l) => l.ref);
  const held = lines.filter((l) => l.status === 'held').map((l) => l.ref);
  const matchedOnce = lines.some((l) => l.status !== 'notMatched' && l.kind === 'request_line');
  return (
    <section className="rounded-2xl border p-6 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }} data-guide="match">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>The request{pageName ? `: ${pageName}` : ''}</h2>
        <PrimaryButton disabled={!canMatch || busy} onClick={onMatch}
          tip={canMatch ? `The AI suggests, ${multi ? 'page by page, ' : ''}which changes look like they answer each line, with a short reason. Held-over and Keep lines are not sent. It never says an edit is right or done; you judge that. Lines you linked by hand are kept.` : 'Check the pages again after the edits first: matching needs a round after the starting point.'}>
          {matchedOnce ? 'Match again' : 'Match to request'}
        </PrimaryButton>
      </div>
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
        {matches?.at ? `Matched ${formatDate(matches.at)} against the changes since the starting point. Suggestions only: you judge each edit.` : 'Matching links each line to the changes since the starting point that seem to answer it.'}
        {matches?.usage?.changesLeftOut ? ` This page has many changes: ${matches.usage.changesLeftOut} were not sent to the AI (real changes went first); link those by hand if needed.` : ''}
        {multi && others ? ` ${others} line${others === 1 ? ' is' : 's are'} on other pages.` : ''}
      </p>
      <ol className="space-y-1.5">
        {scope.map((it) => {
          const st = byRef[it.ref];
          const m = matches?.items?.[it.ref];
          const kind = it.kind || 'request_line';
          const pickable = kind === 'request_line';
          const on = selected === it.ref;
          const hereLinks = (st?.links || []).filter((l) => l.pageId === pageId).length;
          const elsewhere = (st?.links || []).length - hereLinks;
          let text = st ? LINE_STATUS[st.status] : '';
          if (st?.status === 'linked') text = `${hereLinks ? `${hereLinks} change${hereLinks === 1 ? '' : 's'} linked here` : 'Linked'}${elsewhere ? `${hereLinks ? ', ' : ' '}${elsewhere} on other pages` : ''}${m?.by === 'person' ? ' (by you)' : m?.reason && hereLinks ? `: ${m.reason}` : ''}`;
          if (st?.status === 'noChange' && m?.reason) text = `${text}: ${m.reason}`;
          const body = (
            <>
              <span className="flex gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
                <span className="text-xs font-semibold w-8 shrink-0 pt-0.5" style={{ color: 'var(--color-primary)' }}>{it.ref}</span>
                <span className="flex-1">{it.lineText}</span>
              </span>
              <span className="flex flex-wrap items-center gap-1.5 mt-1 pl-10">
                {kind === 'held_over' && <Badge>Held over</Badge>}
                {kind === 'keep' && <Badge>Keep</Badge>}
                {multi && it.pageId == null && <Badge>All pages</Badge>}
                {text && <span className="text-xs" style={{ color: TONE[st?.status] || 'var(--color-muted)' }}>{text}</span>}
              </span>
            </>
          );
          return (
            <li key={it.id}>
              {pickable ? (
                <Tooltip text={on ? 'Show every change again.' : 'Highlight the changes on this page linked to this line.'}>
                  <button type="button" onClick={() => setSelected(on ? null : it.ref)} aria-pressed={on}
                    className="w-full text-left rounded-xl border p-2.5 transition-opacity duration-200 hover:opacity-70"
                    style={{ borderColor: on ? 'var(--color-primary)' : 'var(--color-border)', background: 'var(--color-bg)' }}>{body}</button>
                </Tooltip>
              ) : (
                <Tooltip text={kind === 'held_over' ? 'Held over: the client has not decided yet, so this line is shown but never checked.' : 'Keep: this text must stay as it is. Code checks it is still on the page, word for word.'}>
                  <div className="rounded-xl border p-2.5" tabIndex={0} style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', opacity: kind === 'held_over' ? 0.75 : 1 }}>{body}</div>
                </Tooltip>
              )}
            </li>
          );
        })}
      </ol>
      {(matchedOnce || keepWarn.length > 0 || held.length > 0) && (
        <div className="text-xs space-y-1" style={{ color: 'var(--color-muted)' }}>
          {matchedOnce && <p><strong style={{ color: 'var(--color-text)' }}>Lines with no change found{multi ? ' (all pages)' : ''}:</strong> {unmatched.length ? unmatched.join(', ') : 'none'}</p>}
          {matches?.at && <p><strong style={{ color: 'var(--color-text)' }}>Changes nobody asked for{pageName ? ` on ${pageName}` : ''}:</strong> {unasked}. {linkedCount} change{linkedCount === 1 ? ' is' : 's are'} linked to the request here.</p>}
          {keepWarn.length > 0 && <p style={{ color: '#991b1b' }}><strong>Keep lines changed or removed:</strong> {keepWarn.join(', ')}</p>}
          {held.length > 0 && <p><strong style={{ color: 'var(--color-text)' }}>Held over, not checked:</strong> {held.join(', ')}</p>}
        </div>
      )}
      {selected && canLink && (
        <div data-guide="change-links">{editing
          ? <SecondaryButton tip="Stop changing links." onClick={() => setEditing(false)}>Done linking</SecondaryButton>
          : <SecondaryButton tip={`Link or unlink changes on this page for ${selected} by hand. Your links are kept when matching again.`} onClick={() => setEditing(true)}>Change links for {selected}</SecondaryButton>}</div>
      )}
    </section>
  );
}
