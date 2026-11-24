import React from 'react';
import { useNavigate } from 'react-router-dom';
import Tooltip from '../../components/Tooltip';
import { useIcon } from '../../providers/IconProvider';
import useTicketsAllowed from './useTicketsAllowed';
import { newTicketHref } from './makeTicket.mjs';

/**
 * "Make a ticket" from another tool: opens Tickets' New ticket filled in with `ticket` (title, description, client, project, source) to check
 * and create. Hidden when the person cannot use Tickets. `beforeOpen` (optional, may be async) runs first, e.g. to save a note.
 */
export default function MakeTicketButton({ ticket, beforeOpen, tip, className, style, iconOnly = false, label = 'Make a ticket' }) {
  const allowed = useTicketsAllowed();
  const navigate = useNavigate();
  const getIcon = useIcon();
  if (!allowed) return null;
  const open = async () => {
    try { if (beforeOpen) await beforeOpen(); } catch (_) { /* the ticket can still be made from what is on screen */ }
    navigate(newTicketHref(typeof ticket === 'function' ? ticket() : ticket));
  };
  return (
    <Tooltip text={tip || 'Open a new ticket filled in from this, to check and create. The ticket links back here.'} side="bottom">
      <button type="button" onClick={open} aria-label={label}
        className={className || 'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md transition-opacity duration-200 hover:opacity-80 whitespace-nowrap'}
        style={style || { border: '1px solid var(--color-border)', color: 'var(--color-text)', background: 'var(--color-surface)' }}>
        {getIcon('ticket', { size: iconOnly ? 18 : 12 })}{!iconOnly && label}
      </button>
    </Tooltip>
  );
}
