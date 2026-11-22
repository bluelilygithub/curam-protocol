import React from 'react';
import Tooltip from '../../components/Tooltip';
import { CARD, FIELD, FOCUS_RING, PrimaryButton, SecondaryButton, Badge, formatObligationTiming } from './shared';
import { useContractReview } from './context';

// Obligations: what each party has to do and when; send to Tasks, mark done, export to a calendar.
export default function ObligationsView() {
  const { getIcon, contract, obligations, obligationOwnerFilter, setObligationOwnerFilter, obligationStatusFilter, setObligationStatusFilter, obligationDueFrom, setObligationDueFrom, obligationDueTo, setObligationDueTo, addToTask, setObligationState, exportIcs, setObligationField } = useContractReview();

  return (
    <div className="rounded-lg border p-4" style={CARD} data-guide="obligations">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-base font-semibold">What you need to do</h2>
        <SecondaryButton data-guide="export-ics" onClick={exportIcs} className="flex items-center gap-1">
          {getIcon('calendar-check', { size: 14 })} Export .ics
        </SecondaryButton>
      </div>

      <div data-guide="obligation-filters" className="flex flex-wrap items-center gap-2 mb-3 pb-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <Tooltip text="Show only obligations owed by one party.">
          <select
            value={obligationOwnerFilter}
            onChange={(e) => setObligationOwnerFilter(e.target.value)}
            className={`rounded border px-2 py-1 text-xs ${FOCUS_RING}`} style={FIELD}
          >
            <option value="">All owners</option>
            <option value="unresolved">Obligor unresolved</option>
            {(contract.parties || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Tooltip>
        <Tooltip text="Filter by timing status — overdue, upcoming, unverified, or already marked done.">
          <select
            value={obligationStatusFilter}
            onChange={(e) => setObligationStatusFilter(e.target.value)}
            className={`rounded border px-2 py-1 text-xs ${FOCUS_RING}`} style={FIELD}
          >
            <option value="all">All statuses</option>
            <option value="overdue">Overdue</option>
            <option value="upcoming">Upcoming</option>
            <option value="recurring_or_relative">Recurring / relative</option>
            <option value="unverified">Unverified</option>
            <option value="done">Done</option>
          </select>
        </Tooltip>
        <Tooltip text="Only obligations with an exact due date falling in this range. Recurring or relatively-dated obligations (no exact date) are hidden while a range is set.">
          <div className="flex items-center gap-1.5">
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Due</span>
            <input
              type="date" value={obligationDueFrom} onChange={(e) => setObligationDueFrom(e.target.value)}
              className={`rounded border px-2 py-1 text-xs ${FOCUS_RING}`} style={FIELD}
            />
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>to</span>
            <input
              type="date" value={obligationDueTo} onChange={(e) => setObligationDueTo(e.target.value)}
              className={`rounded border px-2 py-1 text-xs ${FOCUS_RING}`} style={FIELD}
            />
          </div>
        </Tooltip>
        {(obligationOwnerFilter || obligationStatusFilter !== 'all' || obligationDueFrom || obligationDueTo) && (
          <button
            onClick={() => { setObligationOwnerFilter(''); setObligationStatusFilter('all'); setObligationDueFrom(''); setObligationDueTo(''); }}
            className={`text-xs hover:opacity-70 rounded ${FOCUS_RING}`} style={{ transition: 'opacity 200ms', color: 'var(--color-muted)' }}
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="space-y-2">
        {obligations
          .filter((o) => {
            if (obligationOwnerFilter === 'unresolved' && o.obligorPartyId != null) return false;
            if (obligationOwnerFilter && obligationOwnerFilter !== 'unresolved' && String(o.obligorPartyId) !== obligationOwnerFilter) return false;
            if (obligationStatusFilter === 'done') { if (o.userState !== 'handled') return false; }
            else if (obligationStatusFilter !== 'all') {
              if (o.userState === 'handled') return false;
              if (obligationStatusFilter === 'unverified') { if (o.derivedStatus !== 'unverified') return false; }
              else if (o.derivedStatus !== obligationStatusFilter) return false;
            }
            if (obligationDueFrom || obligationDueTo) {
              if (!o.absoluteDate) return false;
              const due = String(o.absoluteDate).slice(0, 10);
              if (obligationDueFrom && due < obligationDueFrom) return false;
              if (obligationDueTo && due > obligationDueTo) return false;
            }
            return true;
          })
          .map((o) => {
          const unverified = o.derivedStatus === 'unverified';
          const overdue = o.derivedStatus === 'overdue';
          const done = o.userState === 'handled';
          return (
            <div key={o.id} className="rounded-lg border p-3" style={{ ...FIELD, opacity: done ? 0.6 : 1, borderLeft: overdue && !done ? '3px solid #991b1b' : undefined }}>
              <div className="text-sm mb-2 font-medium" style={{ textDecoration: done ? 'line-through' : 'none' }}>{o.description}</div>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <Tooltip text="Who owes this obligation. Correct it here if the extraction couldn't resolve it automatically.">
                  <select
                    value={o.obligorPartyId != null ? String(o.obligorPartyId) : ''}
                    onChange={(e) => setObligationField(o, 'obligorPartyId', e.target.value)}
                    className={`rounded border px-2 py-1 text-xs ${FOCUS_RING}`} style={FIELD}
                  >
                    <option value="">Obligor unresolved</option>
                    {(contract.parties || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Tooltip>
                <Tooltip text="Set or correct an exact due date — needed before this obligation can export to .ics or link to a Task with a due date.">
                  <input
                    type="date"
                    value={o.absoluteDate ? String(o.absoluteDate).slice(0, 10) : ''}
                    onChange={(e) => { if (e.target.value) setObligationField(o, 'absoluteDate', e.target.value); }}
                    className={`rounded border px-2 py-1 text-xs ${FOCUS_RING}`} style={FIELD}
                  />
                </Tooltip>
                {!o.absoluteDate && (
                  <span className="text-xs" style={{ color: 'var(--color-muted)' }}>({formatObligationTiming(o)})</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {o.documentStatus !== 'executed' && <Badge bg="#e0e7ff" color="#3730a3">Draft — not active</Badge>}
                <Badge bg={overdue ? '#fee2e2' : 'var(--color-bg)'} color={overdue ? '#991b1b' : 'var(--color-muted)'}>{o.derivedStatus.replace(/_/g, ' ')}</Badge>
                {unverified && <Badge bg="#fef3c7" color="#92400e">Unverified — not exported/linkable until confirmed</Badge>}
                {o.userState && <Badge bg="#e0e7ff" color="#3730a3">{o.userState}</Badge>}
                <div className="flex gap-2 ml-auto">
                  {!o.linkedTaskId && (
                    <PrimaryButton onClick={() => addToTask(o)}>Send to Tasks</PrimaryButton>
                  )}
                  {!done && (
                    <SecondaryButton onClick={() => setObligationState(o.id, 'handled')}>Mark done</SecondaryButton>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {!obligations.length && <div className="text-sm" style={{ color: 'var(--color-muted)' }}>No obligations extracted for an active (executed) document yet.</div>}
      </div>
    </div>
  );
}
