import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import Tooltip from './Tooltip';
import { newTicketHref } from '../pages/tickets/makeTicket.mjs';
import { statusOf, typeOf, ticketNo, dueText, isOverdue, localToday, shortName } from '../pages/tickets/ticketLogic.mjs';

const BTN = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs border transition-opacity duration-200 hover:opacity-60';
const BTN_STYLE = { borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-surface)' };

/**
 * The tickets linked to one client (clientId) or client project (clientProjectId), not done first. `available` is false when Tickets is
 * off for this person (the page leaves the section out); null while loading. Mirrors components/ClientPlans.jsx. See docs/tickets.md.
 */
export function useClientTickets({ clientId, clientProjectId }) {
  const [state, setState] = useState({ tickets: null, available: null });
  const load = useCallback(async () => {
    const q = clientProjectId ? `clientProjectId=${clientProjectId}` : `clientId=${clientId}`;
    try {
      const res = await api.get(`/api/tickets?${q}&status=`);
      if (!res.ok) { setState({ tickets: [], available: false }); return; }
      const data = await res.json().catch(() => ({}));
      const list = Array.isArray(data.tickets) ? data.tickets : [];
      // open work first, then done; each newest change first (the server's order)
      setState({ tickets: [...list.filter((t) => t.status !== 'done'), ...list.filter((t) => t.status === 'done')], available: true });
    } catch (_) { setState({ tickets: [], available: false }); }
  }, [clientId, clientProjectId]);
  useEffect(() => { setState({ tickets: null, available: null }); load(); }, [load]);
  return { ...state, reload: load };
}

/** The list, a New ticket button already filed under the client (and project), and a link to the Tickets list filtered to them. */
export function ClientTicketsBody({ tickets, clientId, clientProjectId, name }) {
  const getIcon = useIcon();
  const today = localToday();
  const open = (tickets || []).filter((t) => t.status !== 'done').length;
  const href = newTicketHref({
    clientId, clientProjectId,
    sourceKind: clientProjectId ? 'client_project' : 'client', sourceId: clientProjectId || clientId, sourceLabel: name,
  });
  const allLink = clientProjectId ? `/tickets?clientProjectId=${clientProjectId}` : `/tickets?clientId=${clientId}`;

  return (
    <div className="space-y-3">
      {tickets === null ? <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p> : tickets.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No tickets for {name || 'this client'} yet.</p>
      ) : (
        <>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{open} open of {tickets.length}</p>
          <ul className="space-y-1.5">
            {tickets.slice(0, 25).map((t) => {
              const s = statusOf(t.status);
              const due = dueText(t, today);
              return (
                <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', opacity: t.status === 'done' ? 0.7 : 1 }}>
                  <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{ticketNo(t)}</span>
                  <Link to={`/tickets/${t.id}`} className="text-sm font-medium transition-opacity duration-200 hover:opacity-60" style={{ color: 'var(--color-primary)' }}>{t.title}</Link>
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: s.bg, color: s.color }}>{s.label}</span>
                  <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    {typeOf(t.type).label}
                    {t.assigneeEmail ? ` · ${shortName(t.assigneeEmail)}` : ''}
                    {!clientProjectId && t.clientProjectName ? ` · ${t.clientProjectName}` : ''}
                  </span>
                  {due && <span className="text-xs" style={isOverdue(t, today) ? { color: '#ef4444', fontWeight: 600 } : { color: 'var(--color-muted)' }}>{due}</span>}
                </li>
              );
            })}
          </ul>
        </>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip text={`Open a new ticket filed under ${name || 'this client'}, to fill in and create.`}>
          <Link to={href} className={BTN} style={BTN_STYLE}>{getIcon('plus', { size: 13 })} New ticket</Link>
        </Tooltip>
        <Tooltip text="Open the Tickets list showing only these tickets.">
          <Link to={allLink} className="text-xs transition-opacity duration-200 hover:opacity-60" style={{ color: 'var(--color-primary)' }}>Open in Tickets →</Link>
        </Tooltip>
      </div>
    </div>
  );
}
