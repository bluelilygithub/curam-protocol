import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import api from '../utils/apiClient';
import { VoiceInputProvider } from '../components/voiceInput/VoiceInput';
import { JobStart } from '../components/JobStart';
import NewTicketModal from './tickets/NewTicketModal';
import TicketDetail from './tickets/TicketDetail';
import TicketsTutorChat from './tickets/TicketsTutorChat';
import { GUIDE_TOOLS } from './tickets/ticketsTools.mjs';
import { TICKET_GOALS } from './tickets/ticketGoals.mjs';
import { startTicketsTour, TOUR_KEY as TICKETS_TOUR_KEY } from '../utils/tours/ticketsTour';
import { Btn, Chip, StatusBadge, TypeTag, PriorityDot, MUTED } from './tickets/ticketUi';
import { TYPES, PRIORITIES, STATUS_FILTERS, listQuery, isOverdue, dueText, ticketNo, shortName, localToday, prefillFrom } from './tickets/ticketLogic.mjs';

/**
 * Tickets (docs/tickets.md): internal work items shared by everyone with the feature. /tickets is the list (looks like the CRM page);
 * /tickets/:id is one ticket. /tickets?new=1&... opens New ticket filled in from another tool.
 */
export default function TicketsPage() {
  const { id } = useParams();
  const [people, setPeople] = useState([]);
  useEffect(() => {
    api.get('/api/tickets/people').then((r) => (r.ok ? r.json() : null)).then((d) => setPeople(d?.people || [])).catch(() => {});
  }, []);
  const navigate = useNavigate();
  // the guide's Open buttons: a control on the list goes back to the list; one inside a ticket needs a ticket open, so it stays put
  const openToolById = (toolId) => {
    const target = GUIDE_TOOLS.find((t) => t.id === toolId);
    if (target && target.tool === 'list' && id) navigate('/tickets');
  };
  return (
    <VoiceInputProvider lang="en-AU">
      {id ? <TicketDetail id={id} people={people} /> : <TicketList people={people} />}
      <TicketsTutorChat currentTool={id ? 'ticket' : 'list'} onOpenTool={openToolById} />
    </VoiceInputProvider>
  );
}

const JOBS_KEY = 'vault_tickets_jobs_hidden';

function TicketList({ people }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState(() => ({
    q: '', status: 'active', type: '', priority: '', assigneeId: '', overdue: false,
    clientId: params.get('new') === '1' ? '' : params.get('clientId') || '', clientProjectId: params.get('new') === '1' ? '' : params.get('clientProjectId') || '',
  }));
  const [prefill, setPrefill] = useState(() => prefillFrom(params));
  const [showNew, setShowNew] = useState(() => !!prefillFrom(params));
  const today = localToday();
  const set = (k) => (v) => setFilters((f) => ({ ...f, [k]: v }));
  // the job tiles can be hidden per browser (a convenience, so a failed read just shows them)
  const [jobsHidden, setJobsHidden] = useState(() => { try { return localStorage.getItem(JOBS_KEY) === '1'; } catch (_) { return false; } });
  const hideJobs = (hidden) => { setJobsHidden(hidden); try { localStorage.setItem(JOBS_KEY, hidden ? '1' : '0'); } catch (_) { /* ignore */ } };
  // a job either opens New ticket filled in, or replaces the filters (and any client scope) with its own
  const pickJob = (goal) => {
    if (goal.newTicket) { setPrefill(goal.newTicket); setShowNew(true); return; }
    setFilters({ q: '', status: 'active', type: '', priority: '', assigneeId: '', overdue: false, clientId: '', clientProjectId: '', ...goal.filters });
    setParams({}, { replace: true });
  };

  // a "new ticket" link from another tool is read once, then removed from the address so a reload does not open it again;
  // Settings -> Tours opens /tickets?tour=1
  useEffect(() => {
    if (params.get('new') === '1') setParams({}, { replace: true });
    if (params.get('tour')) { setParams({}, { replace: true }); setTimeout(() => startTicketsTour(), 300); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const query = useMemo(() => listQuery(filters), [filters]);
  const load = useCallback(async () => {
    try {
      const r = await api.get(`/api/tickets${query ? `?${query}` : ''}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Tickets could not be loaded.');
      setTickets(d.tickets || []); setError('');
    } catch (e) { setError(e.message); setTickets([]); } finally { setLoading(false); }
  }, [query]);
  // typing in the search waits a moment before asking the server
  useEffect(() => { const t = setTimeout(load, filters.q ? 250 : 0); return () => clearTimeout(t); }, [load, filters.q]);

  const filtered = !!(filters.q || filters.type || filters.priority || filters.assigneeId || filters.overdue || filters.clientId || filters.clientProjectId || filters.status !== 'active');
  const scopeName = (filters.clientId || filters.clientProjectId) && tickets[0] ? (filters.clientProjectId ? tickets[0].clientProjectName : tickets[0].clientName) : '';

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>Tickets</h1>
        <div className="flex items-center gap-2">
          {jobsHidden && <Btn variant="secondary" title="Show the What do you want to do? tiles again" onClick={() => hideJobs(false)}>Jobs</Btn>}
          <Btn variant="secondary" title="Take the Tickets tour" onClick={() => { try { localStorage.removeItem(TICKETS_TOUR_KEY); } catch (_) { /* ignore */ } startTicketsTour(); }}>Tour</Btn>
          <span data-tour="tickets-new"><Btn onClick={() => { setPrefill(null); setShowNew(true); }}>+ New ticket</Btn></span>
        </div>
      </div>

      {!jobsHidden && (
        <div className="mb-6">
          <JobStart goals={TICKET_GOALS} intro="Pick a job: it opens New ticket filled in, or shows the right tickets." onPick={pickJob}
            labelFor={(toolId) => GUIDE_TOOLS.find((t) => t.id === toolId)?.label || toolId} tourId="tickets-jobs" />
          <button type="button" onClick={() => hideJobs(true)} className="text-xs mt-2 underline hover:opacity-60" style={MUTED}>
            Hide these (the Jobs button at the top brings them back)
          </button>
        </div>
      )}

      <div className="flex flex-col gap-2 mb-5" data-tour="tickets-filters">
        <div className="flex gap-1 flex-wrap">
          {STATUS_FILTERS.map((f) => <Chip key={f.value || 'all'} on={filters.status === f.value} onClick={() => set('status')(f.value)}>{f.label}</Chip>)}
        </div>
        <div className="flex gap-1 flex-wrap items-center">
          <Chip on={!filters.type} onClick={() => set('type')('')}>Every type</Chip>
          {TYPES.map((t) => <Chip key={t.value} on={filters.type === t.value} onClick={() => set('type')(t.value)} tip={t.tip}>{t.label}</Chip>)}
          <span className="mx-1" />
          <Chip on={filters.assigneeId === 'me'} onClick={() => set('assigneeId')(filters.assigneeId === 'me' ? '' : 'me')} tip="Only tickets assigned to you.">Mine</Chip>
          <Chip on={filters.overdue} onClick={() => set('overdue')(!filters.overdue)} tip="Due before today and not done.">Overdue</Chip>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input type="text" value={filters.q} onChange={(e) => set('q')(e.target.value)} placeholder="Search titles and details, or T-12…" aria-label="Search tickets"
            className="text-sm px-3 py-1.5 rounded-lg border outline-none sm:min-w-[260px]" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
          <select value={filters.priority} onChange={(e) => set('priority')(e.target.value)} aria-label="Priority filter" className="text-sm px-3 py-1.5 rounded-lg border" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
            <option value="">Any priority</option>
            {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          <select value={filters.assigneeId === 'me' ? '' : filters.assigneeId} onChange={(e) => set('assigneeId')(e.target.value)} aria-label="Assignee filter" className="text-sm px-3 py-1.5 rounded-lg border" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
            <option value="">Anyone</option>
            <option value="none">Nobody assigned</option>
            {people.map((p) => <option key={p.id} value={p.id}>{shortName(p.email)}</option>)}
          </select>
        </div>
      </div>

      {(filters.clientId || filters.clientProjectId) && (
        <div className="flex items-center gap-2 mb-3 text-xs" style={MUTED}>
          <span>Only tickets for {scopeName || (filters.clientProjectId ? 'one client project' : 'one client')}</span>
          <Chip on onClick={() => { setFilters((f) => ({ ...f, clientId: '', clientProjectId: '' })); setParams({}, { replace: true }); }} tip="Show tickets for every client.">Show all ✕</Chip>
        </div>
      )}
      {loading && <p className="text-sm" style={MUTED}>Loading…</p>}
      {error && <p className="text-sm" role="alert" style={{ color: '#ef4444' }}>{error}</p>}

      {!loading && !error && tickets.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <p className="text-sm" style={MUTED}>{filtered ? 'No tickets match those filters.' : 'No open tickets. Add one for anything that needs doing.'}</p>
          {!filtered && <Btn onClick={() => { setPrefill(null); setShowNew(true); }}>+ New ticket</Btn>}
        </div>
      )}

      {!loading && tickets.length > 0 && (
        <div className="flex flex-col gap-2" data-tour="tickets-list">
          {tickets.map((t) => <TicketRow key={t.id} t={t} today={today} onOpen={() => navigate(`/tickets/${t.id}`)} />)}
          {tickets.length >= 500 && <p className="text-xs" style={MUTED}>Showing the 500 most recently changed. Narrow the filters to see others.</p>}
        </div>
      )}

      {showNew && (
        <NewTicketModal people={people} prefill={prefill} onClose={() => setShowNew(false)}
          onCreated={(t) => { setShowNew(false); navigate(`/tickets/${t.id}`); }} />
      )}
    </div>
  );
}

function TicketRow({ t, today, onOpen }) {
  const overdue = isOverdue(t, today);
  const due = dueText(t, today);
  return (
    <button type="button" onClick={onOpen} className="text-left p-4 rounded-xl border transition-opacity hover:opacity-90 w-full"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', opacity: t.status === 'done' ? 0.75 : 1 }}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <PriorityDot priority={t.priority} />
          <span className="text-xs flex-shrink-0" style={MUTED}>{ticketNo(t)}</span>
          <span className="font-semibold text-sm truncate" style={{ color: 'var(--color-text)', textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>{t.title}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <TypeTag type={t.type} />
          <StatusBadge status={t.status} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs mt-2" style={MUTED}>
        {t.clientName && <span>{t.clientName}{t.clientProjectName ? ` · ${t.clientProjectName}` : ''}</span>}
        <span>{t.assigneeEmail ? `Assigned to ${shortName(t.assigneeEmail)}` : 'Nobody assigned'}</span>
        {due && <span style={overdue ? { color: '#ef4444', fontWeight: 600 } : undefined}>{due}</span>}
        {t.commentCount > 0 && <span>{t.commentCount} comment{t.commentCount === 1 ? '' : 's'}</span>}
      </div>
    </button>
  );
}
