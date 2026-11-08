import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../utils/apiClient';
import Tooltip from '../../components/Tooltip';

const FIELD = 'px-2 py-1.5 rounded-lg border text-sm';
const FIELD_STYLE = { borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', maxWidth: '14rem' };
const LABEL_STYLE = { color: 'var(--color-muted)' };

/**
 * The person's CRM clients and client projects, for the pickers. `available` is false when the CRM is off for this person (the lists are then
 * empty and the pickers stay out of the way); null while loading.
 */
export function useClientOptions() {
  const [state, setState] = useState({ clients: [], projects: [], available: null });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cr, pr] = await Promise.all([api.get('/api/clients'), api.get('/api/client-projects')]);
        if (!cr.ok) { if (!cancelled) setState({ clients: [], projects: [], available: false }); return; }
        const clients = await cr.json().catch(() => []);
        const projects = pr.ok ? await pr.json().catch(() => []) : [];
        if (!cancelled) setState({ clients: Array.isArray(clients) ? clients : [], projects: Array.isArray(projects) ? projects : [], available: true });
      } catch (_) { if (!cancelled) setState({ clients: [], projects: [], available: false }); }
    })();
    return () => { cancelled = true; };
  }, []);
  return state;
}

/**
 * Choose the client a plan is for, and optionally one of that client's projects. Choosing a project also chooses its client (the server does
 * this), and changing the client drops a project of the old one. `onChange` always gets a consistent pair of what changed: { clientId, clientProjectId } when the
 * client changes (the project is cleared), { clientProjectId, clientId } when a project is chosen, or { clientProjectId: null } when it is cleared.
 * Shows nothing when the CRM is not available and the plan has no client.
 */
export default function PlanClientPicker({ clientId, clientProjectId, clientName, clientProjectName, onChange, disabled }) {
  const { clients, projects, available } = useClientOptions();
  // a client or project the lists do not hold (an archived client, say) is still shown by name, so the choice never looks empty
  const clientOptions = useMemo(() => (clientId && !clients.some((c) => c.id === clientId) ? [...clients, { id: clientId, name: clientName || `Client ${clientId}` }] : clients), [clients, clientId, clientName]);
  const shownProjects = useMemo(() => {
    const list = clientId ? projects.filter((p) => p.clientId === clientId) : projects;
    return clientProjectId && !list.some((p) => p.id === clientProjectId) ? [...list, { id: clientProjectId, name: clientProjectName || `Project ${clientProjectId}`, clientId, clientName }] : list;
  }, [projects, clientId, clientProjectId, clientProjectName, clientName]);

  if (available === null) return null;
  if (!available && !clientId) return null;

  return (
    <>
      <label className="space-y-1 block">
        <span className="text-xs block" style={LABEL_STYLE}>Client</span>
        <div className="flex items-center gap-1.5">
          <Tooltip text="The CRM client this plan is for. Plans made from a note start with the note's client. Tasks sent from the plan are filed under it.">
            <select value={clientId || ''} onChange={(e) => onChange({ clientId: e.target.value ? Number(e.target.value) : null, clientProjectId: null })} disabled={disabled} aria-label="Client for this plan" className={FIELD} style={FIELD_STYLE}>
              <option value="">No client</option>
              {clientOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Tooltip>
          {clientId && (
            <Tooltip text="Open this client's page, where their plans are listed.">
              <Link to={`/clients/${clientId}`} className="text-xs transition-opacity duration-200 hover:opacity-60" style={{ color: 'var(--color-primary)' }} aria-label="Open the client">Open</Link>
            </Tooltip>
          )}
        </div>
      </label>
      <label className="space-y-1 block">
        <span className="text-xs block" style={LABEL_STYLE}>Client project</span>
        <div className="flex items-center gap-1.5">
          <Tooltip text="One of this client's projects. Choosing a project also chooses its client. Tasks sent from the plan are filed under the project.">
            <select value={clientProjectId || ''} onChange={(e) => { const pid = e.target.value ? Number(e.target.value) : null; const proj = shownProjects.find((p) => p.id === pid); onChange(pid ? { clientProjectId: pid, clientId: (proj && proj.clientId) || clientId || null } : { clientProjectId: null }); }} disabled={disabled || (shownProjects.length === 0 && !clientProjectId)} aria-label="Client project for this plan" className={FIELD} style={FIELD_STYLE}>
              <option value="">{shownProjects.length === 0 ? 'No projects' : 'No project'}</option>
              {shownProjects.map((p) => <option key={p.id} value={p.id}>{clientId ? p.name : `${p.clientName ? `${p.clientName} · ` : ''}${p.name}`}</option>)}
            </select>
          </Tooltip>
          {clientProjectId && (
            <Tooltip text="Open this client project's page, where its plans are listed.">
              <Link to={`/client-projects/${clientProjectId}`} className="text-xs transition-opacity duration-200 hover:opacity-60" style={{ color: 'var(--color-primary)' }} aria-label="Open the client project">Open</Link>
            </Tooltip>
          )}
        </div>
      </label>
    </>
  );
}
