// The link that opens Tickets' New ticket already filled in (read by ticketLogic.prefillFrom). Used by the Make a ticket buttons in Notes,
// client and client project pages and Email Follow-Up. Pure. Run: node client/src/pages/tickets/ticketLogic.test.mjs

/** { title, description, type, clientId, clientProjectId, sourceKind, sourceId, sourceLabel } -> '/tickets?new=1&...' (empty values left out) */
export function newTicketHref(v = {}) {
  const p = new URLSearchParams({ new: '1' });
  const put = (k, val, max) => { if (val != null && val !== '') p.set(k, String(val).slice(0, max || 200)); };
  put('title', v.title);
  // a long note is cut: the link stays a sensible length, and the ticket links back to the full source
  put('description', v.description, 1500);
  put('type', v.type);
  put('clientId', v.clientId);
  put('clientProjectId', v.clientProjectId);
  if (v.sourceKind && v.sourceId) { put('sourceKind', v.sourceKind); put('sourceId', v.sourceId); put('sourceLabel', v.sourceLabel); }
  return `/tickets?${p.toString()}`;
}
