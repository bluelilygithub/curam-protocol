'use strict';

// How the recycle bin handles Tickets. The delete route (server/routes/tickets.js) snapshots the ticket row and its history and calls
// moveToBin(); this puts them back under the same T-number when it is free. Tasks made from it stay in Tasks but are not linked again
// (shortcut: the link is not kept in the snapshot; keep task ids in it if people miss the link). See docs/recycle-bin.md and docs/tickets.md.

const { register } = require('../index');
const { insertRow } = require('../rowRestore');

register('ticket', {
  label: 'Ticket',
  async restore(db, userId, payload) {
    const ticket = payload?.ticket;
    if (!ticket || typeof ticket.title !== 'string') throw new Error('This deleted ticket has nothing to restore.');
    // a client, project or person that has gone since is emptied by insertRow (it checks every reference)
    const ticketId = await insertRow(db, 'tickets', ticket);
    for (const e of Array.isArray(payload.events) ? payload.events : []) {
      await insertRow(db, 'ticket_events', e, { keepId: false, override: { ticketId } });
    }
    return { entityId: ticketId };
  },
});
