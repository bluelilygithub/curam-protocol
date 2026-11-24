import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import { VoiceInputProvider } from '../components/voiceInput/VoiceInput';
import ToolSidebar from '../components/ToolSidebar';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import Tooltip from '../components/Tooltip';
import { JobStart } from '../components/JobStart';
import NewTicketModal from './tickets/NewTicketModal';
import TicketDetail from './tickets/TicketDetail';
import TicketsTutorChat from './tickets/TicketsTutorChat';
import { GUIDE_TOOLS, HOW_IT_WORKS } from './tickets/ticketsTools.mjs';
import { TICKET_GOALS } from './tickets/ticketGoals.mjs';
import { startTicketsTour, TOUR_KEY as TICKETS_TOUR_KEY } from '../utils/tours/ticketsTour';
import { Btn, Chip, StatusBadge, TypeTag, PriorityDot, MUTED } from './tickets/ticketUi';
import { TYPES, PRIORITIES, TICKET_VIEWS, VIEW_GROUPS, viewOf, LAST_VIEW_KEY, listQuery, isOverdue, dueText, ticketNo, shortName, localToday, prefillFrom } from './tickets/ticketLogic.mjs';

const OPEN_ON_LAST_KEY = 'vault_tickets_open_on_last';
const read = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* storage blocked */ } };

// The left-hand menu: New ticket, then the lists (ticketLogic TICKET_VIEWS).
const MENU = [
  { label: 'Create', tip: 'Start a new ticket: type it, dictate it, or paste a request and let AI fill it in.', tools: [
    { id: 'new', label: 'New ticket', icon: 'plus', tip: 'Opens New ticket. Paste an email or message into AI from text and Fill in with AI fills the form for you to check.' },
  ] },
  ...VIEW_GROUPS.map((g) => ({ label: g.label, tip: g.tip, tools: TICKET_VIEWS.filter((v) => v.group === g.label) })),
];

/**
 * Tickets (docs/tickets.md): internal work items shared by everyone with the feature, laid out like Skill Scanner and PDF Tools: the menu on
 * the left (ToolSidebar) and "What do you want to do?" job tiles as the start screen. /tickets?view=<id> is a list (ticketLogic TICKET_VIEWS),
 * /tickets/:id one ticket, and /tickets?new=1&... opens New ticket filled in from another tool.
 */
export default function TicketsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const getIcon = useIcon();
  const info = useToolInfoModal('vault_tickets_info_seen');
  const [people, setPeople] = useState([]);
  useEffect(() => {
    api.get('/api/tickets/people').then((r) => (r.ok ? r.json() : null)).then((d) => setPeople(d?.people || [])).catch(() => {});
  }, []);

  // which screen: a list named in the address; a link from another tool (a new ticket or one client's tickets) shows Active;
  // otherwise the job tiles, or the last list when "open on the tool I used last" is ticked
  const [openOnLast, setOpenOnLast] = useState(() => read(OPEN_ON_LAST_KEY) === '1');
  const asked = params.get('view');
  const fromLink = params.get('new') === '1' || params.get('clientId') || params.get('clientProjectId');
  const view = id ? null
    : asked === 'start' ? 'start'
      : viewOf(asked) ? asked
        : fromLink ? 'active'
          : openOnLast ? (viewOf(read(LAST_VIEW_KEY)) ? read(LAST_VIEW_KEY) : 'active') : 'start';
  useEffect(() => { if (viewOf(view)) write(LAST_VIEW_KEY, view); }, [view]);

  // New ticket lives here so the menu can open it from a ticket too; a "new ticket" link is read once
  const [prefill, setPrefill] = useState(() => prefillFrom(params));
  const [showNew, setShowNew] = useState(() => !!prefillFrom(params));
  const openNew = (fields) => { setPrefill(fields); setShowNew(true); };
  useEffect(() => {
    if (params.get('new') === '1') setParams({ view: 'active' }, { replace: true });
    // Settings -> Tours opens /tickets?tour=1
    if (params.get('tour')) { setParams({ view: 'start' }, { replace: true }); setTimeout(() => startTicketsTour(), 300); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const showView = (v) => navigate(`/tickets?view=${v}`);
  const onSelect = (toolId) => (toolId === 'new' ? openNew(null) : showView(toolId));
  const pickJob = (goal) => (goal.newTicket ? openNew(goal.newTicket) : showView(goal.view));
  const toggleOpenOnLast = (on) => { setOpenOnLast(on); write(OPEN_ON_LAST_KEY, on ? '1' : '0'); };
  const startTour = () => { try { localStorage.removeItem(TICKETS_TOUR_KEY); } catch (_) { /* ignore */ } startTicketsTour(); };
  // the guide's Open buttons: a control on the list goes back to a list; one inside a ticket needs a ticket open, so it stays put
  const openToolById = (toolId) => {
    const target = GUIDE_TOOLS.find((t) => t.id === toolId);
    if (target && target.tool === 'list' && (id || view === 'start')) showView('active');
  };

  return (
    <VoiceInputProvider lang="en-AU">
      <div className="flex flex-col sm:flex-row min-h-[calc(100dvh-3rem)]">
        <ToolSidebar
          title="Tickets"
          icon="ticket"
          groups={MENU}
          current={view}
          onSelect={onSelect}
          onInfo={info.open}
          infoTip="How Tickets works: what a ticket is, who sees it, AI from text, tickets from other tools and the morning email."
          onTour={startTour}
          tourTip="Take the guided tour of Tickets."
        >
          <Tooltip text="Go back to the job tiles (log something, turn an email into a ticket, report a bug, park an idea, my tickets, overdue).">
            <button type="button" onClick={() => showView('start')}
              className="w-full flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-opacity hover:opacity-70"
              style={{ borderColor: view === 'start' ? 'var(--color-primary)' : 'var(--color-border)', color: view === 'start' ? 'var(--color-primary)' : 'var(--color-text)', background: 'var(--color-bg)' }}>
              {getIcon('layout-grid', { size: 13 })}
              What do you want to do?
            </button>
          </Tooltip>
        </ToolSidebar>

        <main className="flex-1 min-w-0 flex flex-col" style={{ background: 'var(--color-bg)' }}>
          {id && <TicketDetail id={id} people={people} />}
          {view === 'start' && (
            <div className="p-4 sm:p-6 max-w-5xl">
              <JobStart goals={TICKET_GOALS} appName="Tickets" tourId="tickets-jobs" onPick={pickJob}
                intro="Internal tickets for client work, bugs, admin and ideas. Pick a job, choose a list on the left, or ask the guide (round button, bottom right)."
                labelFor={(toolId) => GUIDE_TOOLS.find((t) => t.id === toolId)?.label || toolId}
                openOnLast={openOnLast} onToggleOpenOnLast={toggleOpenOnLast} />
            </div>
          )}
          {viewOf(view) && <TicketList key={view} view={viewOf(view)} people={people} onNew={() => openNew(null)} />}
        </main>
      </div>

      {showNew && (
        <NewTicketModal people={people} prefill={prefill} onClose={() => setShowNew(false)}
          onCreated={(t) => { setShowNew(false); navigate(`/tickets/${t.id}`); }} />
      )}

      {info.show && (
        <ToolInfoModal title="How Tickets works" onClose={info.close}>
          {HOW_IT_WORKS.map(([title, body]) => (
            <div key={title}>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h3>
              <p className="text-sm leading-relaxed" style={MUTED}>{body}</p>
            </div>
          ))}
        </ToolInfoModal>
      )}

      <TicketsTutorChat currentTool={id ? 'ticket' : 'list'} onOpenTool={openToolById} />
    </VoiceInputProvider>
  );
}

// One list: the menu chose its status, type, Mine or Overdue; search, priority and who has it narrow it further.
function TicketList({ view, people, onNew }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [extra, setExtra] = useState(() => ({
    q: '', type: '', priority: '', assigneeId: '',
    clientId: params.get('new') === '1' ? '' : params.get('clientId') || '', clientProjectId: params.get('new') === '1' ? '' : params.get('clientProjectId') || '',
  }));
  const today = localToday();
  const set = (k) => (v) => setExtra((f) => ({ ...f, [k]: v }));

  // a drop-down's choice wins over the list's own (a person over Mine, a type over a By type list)
  const query = useMemo(() => listQuery({ ...view.filters, ...extra, type: extra.type || view.filters.type || '', assigneeId: extra.assigneeId || view.filters.assigneeId || '' }), [view, extra]);
  const load = useCallback(async () => {
    try {
      const r = await api.get(`/api/tickets${query ? `?${query}` : ''}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Tickets could not be loaded.');
      setTickets(d.tickets || []); setError('');
    } catch (e) { setError(e.message); setTickets([]); } finally { setLoading(false); }
  }, [query]);
  // typing in the search waits a moment before asking the server
  useEffect(() => { const t = setTimeout(load, extra.q ? 250 : 0); return () => clearTimeout(t); }, [load, extra.q]);

  const narrowed = !!(extra.q || extra.type || extra.priority || extra.assigneeId || extra.clientId || extra.clientProjectId);
  const scopeName = (extra.clientId || extra.clientProjectId) && tickets[0] ? (extra.clientProjectId ? tickets[0].clientProjectName : tickets[0].clientName) : '';
  const fieldStyle = { background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>Tickets · {view.label}</h1>
          <p className="text-xs mt-0.5" style={MUTED}>{view.tip}</p>
        </div>
        <span data-tour="tickets-new"><Btn onClick={onNew}>+ New ticket</Btn></span>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-5" data-tour="tickets-filters">
        <input type="text" value={extra.q} onChange={(e) => set('q')(e.target.value)} placeholder="Search titles and details, or T-12…" aria-label="Search tickets"
          className="text-sm px-3 py-1.5 rounded-lg border outline-none sm:min-w-[260px]" style={fieldStyle} />
        <select value={extra.type} onChange={(e) => set('type')(e.target.value)} aria-label="Type filter" className="text-sm px-3 py-1.5 rounded-lg border" style={fieldStyle}>
          <option value="">{view.filters.type ? TYPES.find((t) => t.value === view.filters.type).label : 'Any type'}</option>
          {TYPES.filter((t) => t.value !== view.filters.type).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select value={extra.priority} onChange={(e) => set('priority')(e.target.value)} aria-label="Priority filter" className="text-sm px-3 py-1.5 rounded-lg border" style={fieldStyle}>
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <select value={extra.assigneeId} onChange={(e) => set('assigneeId')(e.target.value)} aria-label="Assignee filter" className="text-sm px-3 py-1.5 rounded-lg border" style={fieldStyle}>
          <option value="">{view.filters.assigneeId === 'me' ? 'Me' : 'Anyone'}</option>
          <option value="none">Nobody assigned</option>
          {people.map((p) => <option key={p.id} value={p.id}>{shortName(p.email)}</option>)}
        </select>
      </div>

      {(extra.clientId || extra.clientProjectId) && (
        <div className="flex items-center gap-2 mb-3 text-xs" style={MUTED}>
          <span>Only tickets for {scopeName || (extra.clientProjectId ? 'one client project' : 'one client')}</span>
          <Chip on onClick={() => { setExtra((f) => ({ ...f, clientId: '', clientProjectId: '' })); setParams({ view: view.id }, { replace: true }); }} tip="Show tickets for every client.">Show all ✕</Chip>
        </div>
      )}
      {loading && <p className="text-sm" style={MUTED}>Loading…</p>}
      {error && <p className="text-sm" role="alert" style={{ color: '#ef4444' }}>{error}</p>}

      {!loading && !error && tickets.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <p className="text-sm" style={MUTED}>{narrowed ? 'No tickets match those filters.' : view.id === 'active' ? 'No open tickets. Add one for anything that needs doing.' : 'Nothing here right now.'}</p>
          {view.id === 'active' && !narrowed && <Btn onClick={onNew}>+ New ticket</Btn>}
        </div>
      )}

      {!loading && tickets.length > 0 && (
        <div className="flex flex-col gap-2" data-tour="tickets-list">
          {tickets.map((t) => <TicketRow key={t.id} t={t} today={today} onOpen={() => navigate(`/tickets/${t.id}`)} />)}
          {tickets.length >= 500 && <p className="text-xs" style={MUTED}>Showing the 500 most recently changed. Narrow the filters to see others.</p>}
        </div>
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
