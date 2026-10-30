import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/apiClient';
import Tooltip from './Tooltip';
import { EF_TIPS } from '../pages/emailFollowUp/efTips.mjs';

// The Email Follow-Up cases linked to a CRM client, shown on that client's own page, each opening Email Follow-Up, plus a button that
// starts a new case for the client. This is the CRM side of the two-way link (Email Follow-Up's case page has Open in CRM going the other
// way). Quiet by design: nothing is drawn when the tool is off for the person or the request fails.

/** The client's cases, or null while loading or when Email Follow-Up is not available to this person. */
export function useLinkedEmailFollowUp(clientId) {
  const [cases, setCases] = useState(null);
  useEffect(() => {
    let live = true;
    setCases(null);
    (async () => {
      try {
        if (!clientId) return;
        const r = await api.get(`/api/email-follow-up?clientId=${clientId}`);
        if (!r.ok) return; // 403 when the tool is off for this person: draw nothing
        const d = await r.json();
        if (live && Array.isArray(d.cases)) setCases(d.cases);
      } catch { /* the section is a courtesy */ }
    })();
    return () => { live = false; };
  }, [clientId]);
  return cases;
}

/** The cases as a plain list (no frame), for a page that wraps it in its own section. */
export function EmailFollowUpList({ cases, clientId }) {
  const navigate = useNavigate();
  const muted = { color: 'var(--color-muted)' };
  return (
    <div className="space-y-3 pt-3" data-guide="linked-email-follow-up">
      {!cases.length && (
        <p className="text-sm" style={muted}>No Email Follow-Up cases are linked to this client yet. A case keeps track of what is owed in a matter, with the exact words from the emails.</p>
      )}
      {cases.map((c) => (
        <Tooltip key={c.id} text={EF_TIPS.clientCase}>
          <button
            type="button"
            onClick={() => navigate(`/email-follow-up?case=${c.id}`)}
            className="w-full text-left rounded-lg border p-3 hover:opacity-70 transition-opacity"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
          >
            <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{c.title}</span>
            <span className="block text-xs mt-0.5" style={muted}>
              {c.status} · {c.rowCount} in the ledger · {c.sourceCount} message{c.sourceCount === 1 ? '' : 's'}
              {c.pendingDrafts > 0 ? ` · ${c.pendingDrafts} draft${c.pendingDrafts === 1 ? '' : 's'} waiting` : ''}
            </span>
          </button>
        </Tooltip>
      ))}
      <Tooltip text={EF_TIPS.clientNewCase}>
        <button
          type="button"
          onClick={() => navigate(`/email-follow-up?new=1&clientId=${clientId}`)}
          className="rounded-lg px-3 py-1.5 text-xs font-medium border hover:opacity-70 transition-opacity"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}
        >
          New case for this client
        </button>
      </Tooltip>
    </div>
  );
}
