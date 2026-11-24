import React, { useState } from 'react';
import Tooltip from '../../components/Tooltip';
import { Btn, MUTED } from './ticketUi';

const when = (iso) => (iso ? new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const gmailHref = (threadId) => `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(threadId)}`;

/**
 * Related emails from the person's own Gmail: Regrab (with when it last ran), then each thread with Attach / ✕ (dismiss for this ticket).
 * Used by the New ticket form (choices kept in the form until Create) and the ticket page (each choice saves). Only the viewer sees these.
 * `emails` are { threadId, subject, from, date, snippet, status }; `excluded` the dismissed ones; `onSet(threadId, status)`.
 */
export default function TicketEmails({ emails, excluded = [], lastRunAt, busy, error, onRegrab, onSet, canRun = true }) {
  const [showDismissed, setShowDismissed] = useState(false);
  const attached = emails.filter((e) => e.status === 'attached');
  const suggested = emails.filter((e) => e.status === 'suggested');

  const row = (e, actions) => (
    <li key={e.threadId} className="rounded-lg border p-2 text-sm" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex items-start justify-between gap-2">
        <a href={gmailHref(e.threadId)} target="_blank" rel="noreferrer" className="font-medium hover:underline min-w-0 break-words" style={{ color: 'var(--color-text)' }}>{e.subject}</a>
        <div className="flex items-center gap-1 flex-shrink-0">{actions}</div>
      </div>
      <div className="text-xs mt-0.5 break-words" style={MUTED}>{e.from}{e.date && ` · ${day(e.date)}`}</div>
      {e.snippet && <div className="text-xs mt-1 line-clamp-2" style={MUTED}>{e.snippet}</div>}
    </li>
  );
  const small = 'text-xs px-2 py-0.5 rounded hover:opacity-70';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Tooltip text="Searches your own Gmail for threads about this ticket (title words, and the client's contacts and domains if the client is in your CRM). Only you see these emails. Dismissed ones stay hidden.">
          <Btn variant="secondary" onClick={onRegrab} disabled={busy || !canRun}>{busy ? 'Searching…' : lastRunAt ? 'Regrab emails' : 'Find emails'}</Btn>
        </Tooltip>
        <span className="text-xs" style={MUTED}>{lastRunAt ? `Last run ${when(lastRunAt)}` : 'Not run yet'}</span>
      </div>
      {error && <p className="text-xs" role="alert" style={{ color: '#ef4444' }}>{error}</p>}

      {attached.length > 0 && (
        <>
          <div className="text-xs font-medium mt-1" style={MUTED}>Attached ({attached.length})</div>
          <ul className="flex flex-col gap-2">
            {attached.map((e) => row(e, <button type="button" className={small} style={MUTED} onClick={() => onSet(e.threadId, 'suggested')} aria-label={`Detach ${e.subject}`}>Detach</button>))}
          </ul>
        </>
      )}

      {suggested.length > 0 && (
        <>
          <div className="text-xs font-medium mt-1" style={MUTED}>Possibly related ({suggested.length})</div>
          <ul className="flex flex-col gap-2">
            {suggested.map((e) => row(e, <>
              <button type="button" className={small} style={{ color: 'var(--color-primary)' }} onClick={() => onSet(e.threadId, 'attached')} aria-label={`Attach ${e.subject}`}>Attach</button>
              <button type="button" className={small} style={MUTED} onClick={() => onSet(e.threadId, 'excluded')} aria-label={`Dismiss ${e.subject}`} title="Dismiss: not suggested again on this ticket">✕</button>
            </>))}
          </ul>
        </>
      )}

      {lastRunAt && !busy && !attached.length && !suggested.length && <p className="text-xs" style={MUTED}>No related emails found.</p>}

      {excluded.length > 0 && (
        <div className="text-xs" style={MUTED}>
          <button type="button" className="underline hover:opacity-70" onClick={() => setShowDismissed((v) => !v)}>
            {showDismissed ? 'Hide' : 'Show'} dismissed ({excluded.length})
          </button>
          {showDismissed && (
            <ul className="flex flex-col gap-2 mt-2">
              {excluded.map((e) => row(e, <button type="button" className={small} style={MUTED} onClick={() => onSet(e.threadId, 'suggested')} aria-label={`Restore ${e.subject}`}>Restore</button>))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
