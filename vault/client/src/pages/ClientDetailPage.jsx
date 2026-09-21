import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import api from '../utils/apiClient';
import ConfirmModal from '../components/ConfirmModal';
import MoodDot from '../components/mood/MoodDot';
import useToastStore from '../store/toastStore';
import useProcessingStore from '../store/processingStore';
import { useIcon } from '../providers/IconProvider';
import { FOLLOW_UP_CATEGORY } from '../utils/taskCategories';
import AttachmentChip from '../components/AttachmentChip';
import { startCrmTour, TOUR_KEY as CRM_TOUR_KEY } from '../utils/tours/crmTour';
import CrmInfoModal, { INFO_SEEN_KEY as CRM_INFO_SEEN_KEY } from '../components/CrmInfoModal';

// ── Formatters ─────────────────────────────────────────────────────────────────

function fmt(n) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(n || 0);
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function fmtRelative(dateStr) {
  if (!dateStr) return '';
  const d    = new Date(String(dateStr).slice(0, 10) + 'T00:00:00');
  const now  = new Date();
  const diff = Math.round((now - d) / 86400000);
  if (diff === 0)  return 'Today';
  if (diff === 1)  return 'Yesterday';
  if (diff < 7)   return `${diff} days ago`;
  if (diff < 30)  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Status config ──────────────────────────────────────────────────────────────

const STATUS_MAP = {
  prospect: { label: 'Prospect', bg: '#dbeafe', color: '#1e40af' },
  active:   { label: 'Active',   bg: '#d1fae5', color: '#065f46' },
  paused:   { label: 'Paused',   bg: '#fef3c7', color: '#92400e' },
  archived: { label: 'Archived', bg: 'var(--color-border)', color: 'var(--color-muted)' },
};

const STATUS_OPTS   = Object.entries(STATUS_MAP).map(([v, { label }]) => ({ value: v, label }));

const DEAL_STAGE_MAP = {
  lead:        { label: 'Lead',        bg: 'var(--color-border)', color: 'var(--color-muted)' },
  qualified:   { label: 'Qualified',   bg: '#dbeafe', color: '#1e40af' },
  proposal:    { label: 'Proposal',    bg: '#fef3c7', color: '#92400e' },
  negotiation: { label: 'Negotiation', bg: '#fde68a', color: '#78350f' },
  won:         { label: 'Won',         bg: '#d1fae5', color: '#065f46' },
  lost:        { label: 'Lost',        bg: '#fee2e2', color: '#991b1b' },
};
const DEAL_STAGE_OPTS = Object.entries(DEAL_STAGE_MAP).map(([v, { label }]) => ({ value: v, label }));

function DealStageBadge({ stage }) {
  const s = DEAL_STAGE_MAP[stage] || DEAL_STAGE_MAP.lead;
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}
const COMM_PREFS    = ['Email', 'Phone', 'Video', 'In person', 'Slack'];
const TOUCHPOINT_TYPES = [
  { value: 'call',      label: '📞 Call'      },
  { value: 'email',     label: '✉️ Email'     },
  { value: 'meeting',   label: '👥 Meeting'   },
  { value: 'decision',  label: '✓ Decision'   },
  { value: 'milestone', label: '🏁 Milestone' },
  { value: 'other',     label: '• Other'      },
];

function tpIcon(type) {
  return { call: '📞', email: '✉️', meeting: '👥', decision: '✓', milestone: '🏁', other: '•' }[type] || '•';
}

// ── Shared UI ──────────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const s = STATUS_MAP[status] || STATUS_MAP.active;
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}

function Btn({ onClick, disabled, variant = 'primary', size = 'md', children, className = '' }) {
  const pad = size === 'sm' ? 'px-2.5 py-1' : 'px-3 py-1.5';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${pad} text-sm rounded-lg font-medium transition-opacity hover:opacity-80 disabled:opacity-40 ${className}`}
      style={{
        background: variant === 'primary' ? 'var(--color-primary)' : 'transparent',
        color:      variant === 'primary' ? '#fff' : 'var(--color-text)',
        border:     variant === 'secondary' ? '1px solid var(--color-border)' : 'none',
      }}
    >
      {children}
    </button>
  );
}

function Input({ value, onChange, type = 'text', placeholder, rows, className = '' }) {
  const base = `text-sm px-3 py-2 rounded-lg border w-full outline-none ${className}`;
  const style = { background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
  if (rows) return <textarea rows={rows} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={base} style={style} />;
  return <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={base} style={style} />;
}

function Sel({ value, onChange, children }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className="text-sm px-3 py-2 rounded-lg border w-full" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
      {children}
    </select>
  );
}

function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>{label}</label>
      {children}
    </div>
  );
}

// ── Tag chip display ──────────────────────────────────────────────────────────

function TagInput({ tags, onChange }) {
  const [input, setInput] = useState('');
  const add = () => {
    const v = input.trim();
    if (v && !tags.includes(v)) onChange([...tags, v]);
    setInput('');
  };
  const remove = (t) => onChange(tags.filter(x => x !== t));
  return (
    <div className="flex flex-wrap gap-1.5 p-2 rounded-lg border min-h-[38px]" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      {tags.map(t => (
        <span key={t} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--color-border)', color: 'var(--color-text)' }}>
          {t}
          <button type="button" onClick={() => remove(t)} className="hover:opacity-60" style={{ color: 'var(--color-muted)' }}>×</button>
        </span>
      ))}
      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
          if (e.key === 'Backspace' && !input && tags.length) remove(tags[tags.length - 1]);
        }}
        placeholder={tags.length ? '' : 'Add tag…'}
        className="text-sm outline-none flex-1 min-w-[80px] bg-transparent"
        style={{ color: 'var(--color-text)' }}
      />
    </div>
  );
}

// ── Collapsible section wrapper ────────────────────────────────────────────────

function Section({ title, open, onToggle, children, action, sectionRef, flash, tourId }) {
  const getIcon = useIcon();
  return (
    <div
      ref={sectionRef}
      className="rounded-xl border transition-colors"
      style={{ borderColor: flash ? 'var(--color-primary)' : 'var(--color-border)', boxShadow: flash ? '0 0 0 3px color-mix(in srgb, var(--color-primary) 25%, transparent)' : 'none' }}
    >
      <button
        onClick={onToggle}
        data-tour-toggle={tourId || undefined}
        className="w-full flex items-center gap-2 px-4 py-3 text-left"
        style={{ background: 'transparent', cursor: 'pointer' }}
      >
        {getIcon(open ? 'chevron-down' : 'chevron-right', { size: 14, style: { color: 'var(--color-muted)', flexShrink: 0 } })}
        <span className="text-sm font-semibold flex-1" style={{ color: 'var(--color-text)' }}>{title}</span>
        {action && <span onClick={e => e.stopPropagation()}>{action}</span>}
      </button>
      {open && (
        <div data-tour={tourId || undefined} className="px-4 pb-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ── Edit client modal ──────────────────────────────────────────────────────────

function EditModal({ client, onClose, onSaved }) {
  const [form, setForm] = useState({
    name:              client.name              || '',
    company:           client.company           || '',
    status:            client.status            || 'active',
    communicationPref: client.communicationPref || '',
    howTheyWork:       client.howTheyWork        || '',
    startDate:         client.startDate ? String(client.startDate).slice(0, 10) : '',
    tags:              Array.isArray(client.tags) ? client.tags : (client.tags ? JSON.parse(client.tags) : []),
    notes:             client.notes             || '',
    clientType:        client.clientType        || 'company',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const addToast = useToastStore(s => s.addToast);
  const set = (k) => (v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    try {
      await api.put(`/api/clients/${client.id}`, form).then(r => r.json());
      addToast('Client updated');
      onSaved();
      onClose();
    } catch (e) {
      setError(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-12 px-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="relative w-full max-w-lg rounded-xl shadow-xl overflow-y-auto" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', maxHeight: '88vh' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <span className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>Edit client</span>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded hover:opacity-60 text-base" style={{ color: 'var(--color-muted)' }}>✕</button>
        </div>
        <div className="p-5 flex flex-col gap-4">
          {/* Type toggle */}
          <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
            {['company', 'individual'].map(t => (
              <button
                key={t}
                type="button"
                onClick={() => set('clientType')(t)}
                className="flex-1 py-2 text-sm font-medium transition-colors capitalize"
                style={{
                  background: form.clientType === t ? 'var(--color-primary)' : 'var(--color-surface)',
                  color:      form.clientType === t ? '#fff' : 'var(--color-muted)',
                }}
              >
                {t === 'company' ? 'Company' : 'Individual'}
              </button>
            ))}
          </div>
          <div className={form.clientType === 'individual' ? '' : 'grid grid-cols-2 gap-3'}>
            <Field label="Name *"><Input value={form.name} onChange={set('name')} placeholder={form.clientType === 'individual' ? "Person's name" : 'Client name'} /></Field>
            {form.clientType === 'company' && (
              <Field label="Company"><Input value={form.company} onChange={set('company')} /></Field>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status"><Sel value={form.status} onChange={set('status')}>{STATUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</Sel></Field>
            <Field label="Communication preference"><Sel value={form.communicationPref} onChange={set('communicationPref')}><option value="">— Not set —</option>{COMM_PREFS.map(p => <option key={p} value={p}>{p}</option>)}</Sel></Field>
          </div>
          <Field label="How they work"><Input rows={3} value={form.howTheyWork} onChange={set('howTheyWork')} placeholder="e.g. Prefers email, responds within 24hrs…" /></Field>
          <Field label="Start date"><Input type="date" value={form.startDate} onChange={set('startDate')} /></Field>
          <Field label="Tags"><TagInput tags={form.tags} onChange={set('tags')} /></Field>
          <Field label="Notes"><Input rows={3} value={form.notes} onChange={set('notes')} /></Field>
          {error && <p className="text-xs" style={{ color: '#ef4444' }}>{error}</p>}
          <div className="flex gap-2 justify-end pt-1">
            <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
            <Btn onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function ClientDetailPage() {
  const { id }   = useParams();
  const navigate = useNavigate();
  const addToast = useToastStore(s => s.addToast);
  const getIcon  = useIcon();

  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [gmailStatus, setGmailStatus] = useState(null);
  const [editModal,   setEditModal]   = useState(false);
  const [confirmDel,  setConfirmDel]  = useState(false);
  const [summary,     setSummary]     = useState(null); // { summary, generatedAt } | null
  const { startProcessing, stopProcessing } = useProcessingStore();

  // Info modal — auto-shows on first visit, always reachable via the header (i) button
  const [showCrmInfo, setShowCrmInfo] = useState(() => {
    try { return !localStorage.getItem(CRM_INFO_SEEN_KEY); } catch { return false; }
  });
  const closeCrmInfo = () => {
    setShowCrmInfo(false);
    try { localStorage.setItem(CRM_INFO_SEEN_KEY, '1'); } catch { /* private window — just won't remember */ }
  };

  const [sections, setSections] = useState({
    activity:       true,
    deals:          true,
    contacts:       true,
    projects:       false,
    tasks:          true,
    touchpoints:    false,
    communications: false,
  });

  const toggleSection = (key) => setSections(s => ({ ...s, [key]: !s[key] }));

  const dealsRef    = useRef(null);
  const projectsRef = useRef(null);
  const sectionRefs = { deals: dealsRef, projects: projectsRef };
  const [flashSection, setFlashSection] = useState(null);

  const goToSection = (key) => {
    setSections(s => ({ ...s, [key]: true }));
    setTimeout(() => sectionRefs[key]?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    setFlashSection(key);
    setTimeout(() => setFlashSection(null), 1200);
  };

  // Bumped on every load() so ActivityFeed (which fetches its own endpoint,
  // since it merges sources GET /api/clients/:id doesn't return) knows to
  // refetch whenever any section mutates something the feed would show.
  const [activityRefresh, setActivityRefresh] = useState(0);

  const load = useCallback(async () => {
    try {
      const res  = await api.get(`/api/clients/${id}`);
      const json = await res.json();
      if (json.error) { navigate('/clients'); return; }
      setData(json);
      setActivityRefresh(n => n + 1);
    } catch {
      navigate('/clients');
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.get('/api/gmail/status').then(r => r.json()).then(setGmailStatus).catch(() => {});
  }, []);

  if (loading) {
    return <div className="p-6 text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</div>;
  }
  if (!data) return null;

  const { client, contacts, touchpoints, projects, tasks, deals, finance, mood } = data;
  const openPipelineValue = (deals || [])
    .filter(d => d.stage !== 'won' && d.stage !== 'lost')
    .reduce((sum, d) => sum + (parseFloat(d.value) || 0), 0);
  const tags = Array.isArray(client.tags) ? client.tags : (client.tags ? JSON.parse(client.tags) : []);

  const handleDelete = async () => {
    try {
      await api.delete(`/api/clients/${id}`);
      addToast('Client deleted');
      navigate('/clients');
    } catch {
      addToast('Delete failed', 'error');
    }
  };

  const generateSummary = async () => {
    startProcessing('Summarizing client activity…', 'Reading deals, touchpoints, and finance history.');
    try {
      const res = await api.post(`/api/clients/${id}/summary`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Summary failed');
      setSummary(json);
    } catch (e) {
      addToast(e.message || 'Summary failed', 'error');
    } finally {
      stopProcessing();
    }
  };

  // Derive per-project task status
  const projectStatus = (projectId) => {
    const ptasks = (tasks || []).filter(t => t.projectId === projectId);
    if (!ptasks.length) return null;
    const today = todayStr();
    const hasOverdue = ptasks.some(t => t.dueDate && String(t.dueDate).slice(0, 10) < today);
    if (hasOverdue) return { color: '#f59e0b', label: 'Has overdue tasks' };
    const hasInProgress = ptasks.some(t => t.status === 'in-progress');
    if (hasInProgress) return { color: '#3b82f6', label: 'In progress' };
    return { color: '#22c55e', label: 'On track' };
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto p-4 sm:p-6">

        {/* Back nav */}
        <Link
          to="/clients"
          className="inline-flex items-center gap-1 text-sm mb-5 hover:opacity-70 transition-opacity"
          style={{ color: 'var(--color-muted)' }}
        >
          ← CRM
        </Link>

        {/* Header */}
        <div data-tour="crm-header" className="flex items-start justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <span style={{ color: 'var(--color-muted)' }}>
                {getIcon(client.clientType === 'individual' ? 'user' : 'briefcase', { size: 18 })}
              </span>
              <h1 className="text-xl font-bold" style={{ color: 'var(--color-text)' }}>{client.name}</h1>
              <button
                onClick={() => { localStorage.removeItem(CRM_TOUR_KEY); startCrmTour(); }}
                title="Take the CRM tour"
                style={{ color: 'var(--color-muted)', lineHeight: 1, background: 'none', border: 'none', padding: 0, cursor: 'pointer', transition: 'opacity 0.2s' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-primary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-muted)'; }}
              >
                {getIcon('compass', { size: 13 })}
              </button>
              <button
                onClick={() => setShowCrmInfo(true)}
                title="How touchpoints, follow-ups, and tasks work here"
                style={{ color: 'var(--color-muted)', lineHeight: 1, background: 'none', border: 'none', padding: 0, cursor: 'pointer', transition: 'opacity 0.2s' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-primary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-muted)'; }}
              >
                {getIcon('info', { size: 13 })}
              </button>
            </div>
            {client.company && (
              <p className="text-sm mt-0.5 ml-7" style={{ color: 'var(--color-muted)' }}>{client.company}</p>
            )}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <StatusBadge status={client.status} />
              {client.communicationPref && (
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}>
                  Prefers {client.communicationPref}
                </span>
              )}
              {tags.map(t => (
                <span key={t} className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}>{t}</span>
              ))}
            </div>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <Btn variant="secondary" size="sm" onClick={generateSummary}>
              {getIcon('sparkles', { size: 14, style: { marginRight: 4 } })}Summarize
            </Btn>
            <Btn variant="secondary" size="sm" onClick={() => setEditModal(true)}>Edit</Btn>
            <button
              onClick={() => setConfirmDel(true)}
              className="px-2.5 py-1 text-sm rounded-lg border hover:opacity-70 transition-opacity"
              style={{ color: '#ef4444', borderColor: '#fca5a5' }}
            >
              Delete
            </button>
          </div>
        </div>

        {showCrmInfo && <CrmInfoModal onClose={closeCrmInfo} />}

        {/* AI summary */}
        {summary && (
          <div className="rounded-xl border p-4 mb-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium flex items-center gap-1.5" style={{ color: 'var(--color-muted)' }}>
                {getIcon('sparkles', { size: 12 })} AI summary
              </p>
              <button onClick={() => setSummary(null)} className="text-xs hover:opacity-60" style={{ color: 'var(--color-muted)' }}>✕</button>
            </div>
            <p className="text-sm" style={{ color: 'var(--color-text)' }}>{summary.summary}</p>
          </div>
        )}

        {/* Stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
          <StatCard label="Open pipeline" value={fmt(openPipelineValue)}
                    sub={`${(deals || []).filter(d => d.stage !== 'won' && d.stage !== 'lost').length} open deal${(deals || []).filter(d => d.stage !== 'won' && d.stage !== 'lost').length !== 1 ? 's' : ''}`}
                    onClick={() => goToSection('deals')} />
          <StatCard label="Projects"      value={projects?.length ?? 0}
                    onClick={() => goToSection('projects')} />
          <StatCard label="Invoiced YTD"  value={fmt(finance?.invoicedYTD)}
                    sub={`${finance?.invoiceCount || 0} invoices`}
                    onClick={() => navigate(`/finance?tab=Invoices&clientId=${id}`)} />
          <StatCard label="Outstanding"   value={fmt(finance?.outstanding)}
                    warn={parseFloat(finance?.outstanding) > 0}
                    onClick={() => navigate(`/finance?tab=Invoices&clientId=${id}`)} />
          <StatCard label="Client since"  value={client.startDate ? fmtDate(client.startDate) : '—'} />
        </div>

        {/* Notes / how they work */}
        {(client.notes || client.howTheyWork) && (
          <div className="rounded-xl border p-4 mb-4 flex flex-col gap-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            {client.howTheyWork && (
              <div>
                <p className="text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>How they work</p>
                <p className="text-sm" style={{ color: 'var(--color-text)' }}>{client.howTheyWork}</p>
              </div>
            )}
            {client.notes && (
              <div>
                <p className="text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Notes</p>
                <p className="text-sm" style={{ color: 'var(--color-text)' }}>{client.notes}</p>
              </div>
            )}
          </div>
        )}

        {/* Sections */}
        <div className="flex flex-col gap-3">

          {/* -1. Activity — merged touchpoints/deal stage-changes/contact
               add-remove/task create-complete, one chronological feed. See
               GET /api/clients/:id/activity in server/routes/clients.js. */}
          <Section tourId="crm-activity" title="Activity" open={sections.activity} onToggle={() => toggleSection('activity')}>
            <ActivityFeed clientId={id} refreshKey={activityRefresh} />
          </Section>

          {/* 0. Deals */}
          <Section sectionRef={dealsRef} flash={flashSection === 'deals'} title={`Deals${deals?.length ? ` (${deals.length})` : ''}`} open={sections.deals} onToggle={() => toggleSection('deals')}>
            <DealsSection
              clientId={id}
              deals={deals || []}
              onRefresh={load}
            />
          </Section>

          {/* 1. Contacts */}
          <Section title={`Contacts${contacts?.length ? ` (${contacts.length})` : ''}`} open={sections.contacts} onToggle={() => toggleSection('contacts')}>
            <ContactsSection
              clientId={id}
              contacts={contacts || []}
              onRefresh={load}
            />
          </Section>

          {/* 2. Projects */}
          <Section sectionRef={projectsRef} flash={flashSection === 'projects'} title={`Projects${projects?.length ? ` (${projects.length})` : ''}`} open={sections.projects} onToggle={() => toggleSection('projects')}>
            <ProjectsSection
              clientId={id}
              projects={projects || []}
              tasks={tasks || []}
              projectStatus={projectStatus}
              onRefresh={load}
            />
          </Section>

          {/* 2b. Tasks — every open task linked to this client, whether via a
               project or directly (tasks.clientId, e.g. a touchpoint
               follow-up). ProjectsSection's own task counts only match
               task.projectId, so a directly-linked task (no project) was
               otherwise invisible on this page even though the server has
               always returned it in data.tasks. */}
          <Section tourId="crm-tasks" title={`Tasks${tasks?.length ? ` (${tasks.length})` : ''}`} open={sections.tasks} onToggle={() => toggleSection('tasks')}>
            <ClientTasksSection clientId={id} tasks={tasks || []} onRefresh={load} />
          </Section>

          {/* 3. Touchpoints */}
          <Section tourId="crm-touchpoints" title={`Touchpoints${touchpoints?.length ? ` (${touchpoints.length})` : ''}`} open={sections.touchpoints} onToggle={() => toggleSection('touchpoints')}>
            <TouchpointsSection
              clientId={id}
              clientName={client?.name}
              touchpoints={touchpoints || []}
              contacts={contacts || []}
              deals={deals || []}
              onRefresh={load}
            />
          </Section>

          {/* 4. Communications (Gmail) */}
          <Section tourId="crm-communications" title="Communications" open={sections.communications} onToggle={() => toggleSection('communications')}>
            <CommunicationsSection
              clientId={id}
              clientName={client.name}
              contacts={contacts || []}
              gmailStatus={gmailStatus}
            />
          </Section>

        </div>
      </div>

      {/* Edit modal */}
      {editModal && (
        <EditModal client={client} onClose={() => setEditModal(false)} onSaved={load} />
      )}

      {/* Delete confirm */}
      {confirmDel && (
        <ConfirmModal
          title="Delete client"
          message={`Delete "${client.name}"? This will unlink all projects but will not delete them or their invoices.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleDelete}
          onCancel={() => setConfirmDel(false)}
        />
      )}
    </div>
  );
}

// ── Activity feed ──────────────────────────────────────────────────────────────

const ACTIVITY_ICON = { touchpoint: '💬', deal: '🤝', contact: '👤', task: '✓' };

function ActivityFeed({ clientId, refreshKey }) {
  const [items, setItems]     = useState(null); // null = loading
  const [error, setError]     = useState('');

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    api.get(`/api/clients/${clientId}/activity`)
      .then(r => r.json())
      .then(json => { if (!cancelled) setItems(Array.isArray(json) ? json : []); })
      .catch(() => { if (!cancelled) setError('Failed to load activity'); });
    return () => { cancelled = true; };
  }, [clientId, refreshKey]);

  if (error) return <p className="text-sm pt-3" style={{ color: '#ef4444' }}>{error}</p>;
  if (items === null) return <p className="text-sm pt-3" style={{ color: 'var(--color-muted)' }}>Loading…</p>;
  if (!items.length) return <p className="text-sm pt-3" style={{ color: 'var(--color-muted)' }}>No activity yet — log a touchpoint or create a deal to see it here.</p>;

  return (
    <div className="pt-3">
      {items.map(it => (
        <div key={it.id} className="flex items-start gap-3 py-2.5 border-b last:border-b-0" style={{ borderColor: 'var(--color-border)' }}>
          <span className="text-base flex-shrink-0 mt-0.5">{ACTIVITY_ICON[it.kind] || '•'}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm" style={{ color: 'var(--color-text)' }}>{it.title}</span>
              {it.meta?.dealTitle && (
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>🤝 {it.meta.dealTitle}</span>
              )}
            </div>
            {it.detail && <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>{it.detail}</p>}
          </div>
          <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{fmtRelative(it.ts)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Stat card ──────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, warn, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={`p-4 rounded-xl border text-left w-full transition-opacity ${onClick ? 'hover:opacity-70 cursor-pointer' : ''}`}
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      <div className="text-xs mb-1" style={{ color: 'var(--color-muted)' }}>{label}</div>
      <div className="text-lg font-bold" style={{ color: warn ? '#f59e0b' : 'var(--color-text)' }}>{value}</div>
      {sub && <div className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{sub}</div>}
    </Tag>
  );
}

// ── Deals section ──────────────────────────────────────────────────────────────

const BLANK_DEAL = { title: '', stage: 'lead', value: '', expectedCloseDate: '', notes: '' };

function DealsSection({ clientId, deals, onRefresh }) {
  const [showForm, setShowForm]     = useState(false);
  const [editTarget, setEditTarget] = useState(null); // deal being edited
  const [form, setForm]             = useState(BLANK_DEAL);
  const [saving, setSaving]         = useState(false);
  const [lostReason, setLostReason] = useState('');
  const addToast = useToastStore(s => s.addToast);

  const set = (k) => (v) => setForm(f => ({ ...f, [k]: v }));

  const openNew = () => { setForm(BLANK_DEAL); setEditTarget(null); setLostReason(''); setShowForm(true); };
  const openEdit = (d) => {
    setForm({
      title: d.title,
      stage: d.stage,
      value: d.value != null ? String(d.value) : '',
      expectedCloseDate: d.expectedCloseDate ? String(d.expectedCloseDate).slice(0, 10) : '',
      notes: d.notes || '',
    });
    setLostReason(d.lostReason || '');
    setEditTarget(d);
    setShowForm(true);
  };
  const cancel = () => { setShowForm(false); setEditTarget(null); };

  const save = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    const payload = { ...form, value: form.value ? parseFloat(form.value) : null, lostReason: form.stage === 'lost' ? lostReason : null };
    try {
      if (editTarget) {
        await api.put(`/api/deals/${editTarget.id}`, payload).then(r => r.json());
        addToast('Deal updated');
      } else {
        await api.post('/api/deals', { ...payload, clientId }).then(r => r.json());
        addToast('Deal created');
      }
      onRefresh();
      cancel();
    } catch (e) {
      addToast(e.message || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const del = async (deal) => {
    try {
      await api.delete(`/api/deals/${deal.id}`);
      addToast('Deal deleted');
      onRefresh();
    } catch {
      addToast('Delete failed', 'error');
    }
  };

  return (
    <div className="pt-3">
      {deals.length === 0 && !showForm && (
        <p className="text-sm mb-3" style={{ color: 'var(--color-muted)' }}>No deals yet.</p>
      )}

      {deals.map(d => (
        <div
          key={d.id}
          className="group flex items-start justify-between py-2.5 border-b last:border-b-0"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{d.title}</span>
              <DealStageBadge stage={d.stage} />
            </div>
            <div className="flex items-center gap-3 mt-0.5 flex-wrap">
              {d.value != null && (
                <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>{fmt(d.value)}</span>
              )}
              {d.expectedCloseDate && (
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  {d.stage === 'won' || d.stage === 'lost' ? 'Closed' : 'Expected'} {fmtDate(d.actualCloseDate || d.expectedCloseDate)}
                </span>
              )}
              {d.stage === 'lost' && d.lostReason && (
                <span className="text-xs italic" style={{ color: 'var(--color-muted)' }}>{d.lostReason}</span>
              )}
            </div>
          </div>
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
            <button onClick={() => openEdit(d)} className="text-xs px-2 py-1 rounded hover:opacity-60" style={{ color: 'var(--color-muted)' }}>Edit</button>
            <button onClick={() => del(d)} className="text-xs px-2 py-1 rounded hover:opacity-60" style={{ color: '#ef4444' }}>✕</button>
          </div>
        </div>
      ))}

      {showForm && (
        <div
          className="mt-3 p-3 rounded-lg border flex flex-col gap-2"
          style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
        >
          <Input value={form.title} onChange={set('title')} placeholder="Deal title *" />
          <div className="grid grid-cols-2 gap-2">
            <Sel value={form.stage} onChange={set('stage')}>
              {DEAL_STAGE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Sel>
            <Input type="number" value={form.value} onChange={set('value')} placeholder="Value ($ AUD)" />
          </div>
          <Field label="Expected close date"><Input type="date" value={form.expectedCloseDate} onChange={set('expectedCloseDate')} /></Field>
          {form.stage === 'lost' && (
            <Input value={lostReason} onChange={setLostReason} placeholder="Why was this lost? (optional)" />
          )}
          <Input rows={2} value={form.notes} onChange={set('notes')} placeholder="Notes" />
          <div className="flex gap-2 justify-end">
            <button onClick={cancel} className="text-xs px-3 py-1.5 rounded-lg border" style={{ color: 'var(--color-muted)', borderColor: 'var(--color-border)' }}>Cancel</button>
            <button onClick={save} disabled={saving || !form.title.trim()} className="text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-40" style={{ background: 'var(--color-primary)', color: '#fff' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {!showForm && (
        <button
          onClick={openNew}
          className="mt-3 text-sm hover:opacity-70 transition-opacity"
          style={{ color: 'var(--color-primary)' }}
        >
          + Add deal
        </button>
      )}
    </div>
  );
}

// ── Contacts section ──────────────────────────────────────────────────────────

const BLANK_CONTACT = { name: '', role: '', email: '', phone: '', isPrimary: false };

function ContactsSection({ clientId, contacts, onRefresh }) {
  const [showForm, setShowForm]       = useState(false);
  const [editTarget, setEditTarget]   = useState(null); // contact being edited
  const [form, setForm]               = useState(BLANK_CONTACT);
  const [saving, setSaving]           = useState(false);
  const addToast = useToastStore(s => s.addToast);

  const set = (k) => (v) => setForm(f => ({ ...f, [k]: v }));

  const openNew  = () => { setForm(BLANK_CONTACT); setEditTarget(null); setShowForm(true); };
  const openEdit = (c) => { setForm({ name: c.name, role: c.role||'', email: c.email||'', phone: c.phone||'', isPrimary: !!c.isPrimary }); setEditTarget(c); setShowForm(true); };
  const cancel   = () => { setShowForm(false); setEditTarget(null); };

  const save = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editTarget) {
        await api.put(`/api/clients/${clientId}/contacts/${editTarget.id}`, form).then(r => r.json());
        addToast('Contact updated');
      } else {
        await api.post(`/api/clients/${clientId}/contacts`, form).then(r => r.json());
        addToast('Contact added');
      }
      onRefresh();
      cancel();
    } catch (e) {
      addToast(e.message || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const del = async (contact) => {
    try {
      await api.delete(`/api/clients/${clientId}/contacts/${contact.id}`);
      addToast('Contact removed');
      onRefresh();
    } catch {
      addToast('Delete failed', 'error');
    }
  };

  return (
    <div className="pt-3">
      {contacts.length === 0 && !showForm && (
        <p className="text-sm mb-3" style={{ color: 'var(--color-muted)' }}>No contacts yet.</p>
      )}

      {contacts.map(c => (
        <div
          key={c.id}
          className="group flex items-start justify-between py-2.5 border-b last:border-b-0"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{c.name}</span>
              {c.role && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{c.role}</span>}
              {c.isPrimary && (
                <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: '#dbeafe', color: '#1e40af' }}>Primary</span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-0.5">
              {c.email && (
                <a href={`mailto:${c.email}`} className="text-xs hover:underline" style={{ color: 'var(--color-primary)' }} onClick={e => e.stopPropagation()}>
                  {c.email}
                </a>
              )}
              {c.phone && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{c.phone}</span>}
            </div>
          </div>
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => openEdit(c)} className="text-xs px-2 py-1 rounded hover:opacity-60" style={{ color: 'var(--color-muted)' }}>Edit</button>
            <button onClick={() => del(c)} className="text-xs px-2 py-1 rounded hover:opacity-60" style={{ color: '#ef4444' }}>✕</button>
          </div>
        </div>
      ))}

      {showForm && (
        <div
          className="mt-3 p-3 rounded-lg border flex flex-col gap-2"
          style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
        >
          <div className="grid grid-cols-2 gap-2">
            <Input value={form.name}  onChange={set('name')}  placeholder="Name *" />
            <Input value={form.role}  onChange={set('role')}  placeholder="Role" />
            <Input value={form.email} onChange={set('email')} placeholder="Email" />
            <Input value={form.phone} onChange={set('phone')} placeholder="Phone" />
          </div>
          <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-muted)' }}>
            <input type="checkbox" checked={form.isPrimary} onChange={e => set('isPrimary')(e.target.checked)} />
            Primary contact
          </label>
          <div className="flex gap-2 justify-end">
            <button onClick={cancel} className="text-xs px-3 py-1.5 rounded-lg border" style={{ color: 'var(--color-muted)', borderColor: 'var(--color-border)' }}>Cancel</button>
            <button onClick={save} disabled={saving || !form.name.trim()} className="text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-40" style={{ background: 'var(--color-primary)', color: '#fff' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {!showForm && (
        <button
          onClick={openNew}
          className="mt-3 text-sm hover:opacity-70 transition-opacity"
          style={{ color: 'var(--color-primary)' }}
        >
          + Add contact
        </button>
      )}
    </div>
  );
}

// ── Projects section ──────────────────────────────────────────────────────────

// All open tasks linked to this client — via a project or directly
// (tasks.clientId). Supports creating a task, breaking it into subtasks
// (tasks.parentTaskId — a checklist for a multi-step process like "lodge an
// application"), toggling "waiting on client" (tasks.activityStatus), and
// marking done. Full editing (priority, tags, attachments, calendar export)
// stays in Tasks.
const BLANK_TASK = { title: '', dueDate: '', notes: '' };

function ClientTasksSection({ clientId, tasks, onRefresh }) {
  const navigate = useNavigate();
  const addToast = useToastStore(s => s.addToast);
  const [togglingId, setTogglingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(BLANK_TASK);
  const [saving, setSaving] = useState(false);
  const [addingStepFor, setAddingStepFor] = useState(null); // parent task id
  const [stepTitle, setStepTitle] = useState('');
  const set = (k) => (v) => setForm(f => ({ ...f, [k]: v }));

  const toggleDone = async (task) => {
    setTogglingId(task.id);
    try {
      await api.put(`/api/tasks/${task.id}`, { status: task.status === 'done' ? 'todo' : 'done' });
      onRefresh();
    } catch {
      addToast('Failed to update task', 'error');
    } finally {
      setTogglingId(null);
    }
  };

  const toggleWaiting = async (task) => {
    setTogglingId(task.id);
    try {
      await api.put(`/api/tasks/${task.id}`, { activityStatus: task.activityStatus === 'waiting' ? 'none' : 'waiting' });
      onRefresh();
    } catch {
      addToast('Failed to update task', 'error');
    } finally {
      setTogglingId(null);
    }
  };

  const createTask = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      await api.post('/api/tasks', { title: form.title.trim(), dueDate: form.dueDate || null, notes: form.notes || null, clientId }).then(r => r.json());
      addToast('Task created');
      setForm(BLANK_TASK);
      setShowForm(false);
      onRefresh();
    } catch (e) {
      addToast(e.message || 'Failed to create task', 'error');
    } finally {
      setSaving(false);
    }
  };

  const addStep = async (parentTask) => {
    if (!stepTitle.trim()) return;
    setSaving(true);
    try {
      await api.post('/api/tasks', { title: stepTitle.trim(), clientId, parentTaskId: parentTask.id }).then(r => r.json());
      setStepTitle('');
      setAddingStepFor(null);
      onRefresh();
    } catch (e) {
      addToast(e.message || 'Failed to add step', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Parents (or unrelated top-level tasks) first, each followed by its own
  // subtasks — a lightweight checklist, not a full tree (one level is enough
  // for "application steps" style tracking).
  const parents  = tasks.filter(t => !t.parentTaskId);
  const byParent = tasks.reduce((m, t) => {
    if (t.parentTaskId) (m[t.parentTaskId] = m[t.parentTaskId] || []).push(t);
    return m;
  }, {});

  const TaskRow = ({ t, indent }) => (
    <div className="flex items-center gap-3 py-2.5 border-b last:border-b-0" style={{ borderColor: 'var(--color-border)', paddingLeft: indent ? 24 : 0 }}>
      <input
        type="checkbox"
        checked={t.status === 'done'}
        disabled={togglingId === t.id}
        onChange={() => toggleDone(t)}
        className="flex-shrink-0"
      />
      <div className="flex-1 min-w-0">
        <button
          onClick={() => navigate('/tasks')}
          className="text-sm text-left hover:opacity-70 transition-opacity truncate block"
          style={{ color: 'var(--color-text)' }}
        >
          {t.title}
        </button>
        <div className="flex items-center gap-2 text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
          {t.projectName && <span>{t.projectName}</span>}
          {t.category && <><span>·</span><span className="capitalize">{t.category}</span></>}
          {t.dueDate && <><span>·</span><span>Due {fmtDate(t.dueDate)}</span></>}
        </div>
      </div>
      {t.activityStatus === 'waiting' && (
        <span className="text-xs px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: '#fef3c7', color: '#92400e' }}>Waiting on client</span>
      )}
      {t.priority === 'high' && (
        <span className="text-xs flex-shrink-0" style={{ color: '#ef4444' }}>High</span>
      )}
      <button
        onClick={() => toggleWaiting(t)}
        disabled={togglingId === t.id}
        className="text-xs px-1.5 py-1 rounded hover:opacity-60 flex-shrink-0"
        style={{ color: 'var(--color-muted)' }}
        title="Toggle waiting on client"
      >
        ⏳
      </button>
      {!indent && (
        <button
          onClick={() => setAddingStepFor(addingStepFor === t.id ? null : t.id)}
          className="text-xs px-1.5 py-1 rounded hover:opacity-60 flex-shrink-0"
          style={{ color: 'var(--color-primary)' }}
          title="Add a step"
        >
          + step
        </button>
      )}
    </div>
  );

  return (
    <div className="pt-3">
      {!tasks.length && !showForm && (
        <p className="text-sm mb-3" style={{ color: 'var(--color-muted)' }}>No open tasks.</p>
      )}

      {parents.map(t => (
        <React.Fragment key={t.id}>
          <TaskRow t={t} indent={false} />
          {(byParent[t.id] || []).map(sub => <TaskRow key={sub.id} t={sub} indent />)}
          {addingStepFor === t.id && (
            <div className="flex items-center gap-2 py-2" style={{ paddingLeft: 24 }}>
              <Input value={stepTitle} onChange={setStepTitle} placeholder="Step title…" />
              <button onClick={() => addStep(t)} disabled={saving || !stepTitle.trim()} className="text-xs px-2 py-1.5 rounded-lg font-medium disabled:opacity-40 flex-shrink-0" style={{ background: 'var(--color-primary)', color: '#fff' }}>Add</button>
              <button onClick={() => { setAddingStepFor(null); setStepTitle(''); }} className="text-xs px-2 py-1 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>Cancel</button>
            </div>
          )}
        </React.Fragment>
      ))}

      {showForm ? (
        <div className="mt-3 p-3 rounded-lg border flex flex-col gap-2" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
          <Input value={form.title} onChange={set('title')} placeholder="Task title *" />
          <Field label="Due date"><Input type="date" value={form.dueDate} onChange={set('dueDate')} /></Field>
          <Input rows={2} value={form.notes} onChange={set('notes')} placeholder="Notes" />
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setShowForm(false); setForm(BLANK_TASK); }} className="text-xs px-3 py-1.5 rounded-lg border" style={{ color: 'var(--color-muted)', borderColor: 'var(--color-border)' }}>Cancel</button>
            <button onClick={createTask} disabled={saving || !form.title.trim()} className="text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-40" style={{ background: 'var(--color-primary)', color: '#fff' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowForm(true)} className="mt-3 text-sm hover:opacity-70 transition-opacity" style={{ color: 'var(--color-primary)' }}>
          + Add task
        </button>
      )}
    </div>
  );
}

function ProjectsSection({ clientId, projects, tasks, projectStatus, onRefresh }) {
  const navigate   = useNavigate();
  const addToast   = useToastStore(s => s.addToast);

  const [allProjects,     setAllProjects]     = useState(null);
  const [showLinkPanel,   setShowLinkPanel]   = useState(false);
  const [linkSearch,      setLinkSearch]      = useState('');
  const [linking,         setLinking]         = useState(false);

  const openLinkPanel = async () => {
    if (!allProjects) {
      const res = await api.get('/api/projects').then(r => r.json());
      setAllProjects(Array.isArray(res) ? res : []);
    }
    setShowLinkPanel(true);
  };

  const linkedIds = new Set(projects.map(p => p.id));

  const unlinkable = (allProjects || []).filter(p =>
    !linkedIds.has(p.id) &&
    !p.archived_at &&
    (!linkSearch || p.name.toLowerCase().includes(linkSearch.toLowerCase()))
  );

  const linkProject = async (project) => {
    setLinking(true);
    try {
      await api.patch(`/api/clients/${clientId}/assign-project`, { projectId: project.id });
      addToast(`${project.name} linked`);
      onRefresh();
      setShowLinkPanel(false);
      setLinkSearch('');
      setAllProjects(null);
    } catch {
      addToast('Failed to link project', 'error');
    } finally {
      setLinking(false);
    }
  };

  const unlinkProject = async (project) => {
    try {
      await api.patch(`/api/clients/${clientId}/assign-project`, { projectId: project.id, unassign: true });
      addToast(`${project.name} unlinked`);
      onRefresh();
    } catch {
      addToast('Failed to unlink project', 'error');
    }
  };

  const taskCount = (projectId) => (tasks || []).filter(t => t.projectId === projectId).length;

  return (
    <div className="pt-3">
      {projects.length === 0 && (
        <p className="text-sm mb-3" style={{ color: 'var(--color-muted)' }}>No linked projects.</p>
      )}

      {projects.map(p => {
        const status  = projectStatus(p.id);
        const nTasks  = taskCount(p.id);
        const archived = !!p.archived_at;
        return (
          <div
            key={p.id}
            className="group flex items-center justify-between py-2.5 border-b last:border-b-0"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <div
              className="flex items-center gap-2 min-w-0 cursor-pointer hover:opacity-80 flex-1"
              onClick={() => navigate(`/projects/${p.id}`)}
            >
              {status && !archived && (
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: status.color }} title={status.label} />
              )}
              {archived && (
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: 'var(--color-muted)' }} title="Archived" />
              )}
              <span className="text-sm truncate" style={{ color: archived ? 'var(--color-muted)' : 'var(--color-text)' }}>
                {p.name}
                {archived && <span className="ml-1 text-xs">(archived)</span>}
              </span>
              {nTasks > 0 && (
                <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-muted)' }}>
                  {nTasks} task{nTasks !== 1 ? 's' : ''}
                </span>
              )}
              <MoodDot entityType="project" entityId={String(p.id)} entityTitle={p.name} />
            </div>
            <button
              onClick={() => unlinkProject(p)}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-xs px-2 py-1 rounded hover:opacity-60"
              style={{ color: 'var(--color-muted)', flexShrink: 0 }}
            >
              Unlink
            </button>
          </div>
        );
      })}

      {!showLinkPanel ? (
        <button onClick={openLinkPanel} className="mt-3 text-sm hover:opacity-70 transition-opacity" style={{ color: 'var(--color-primary)' }}>
          + Link existing project
        </button>
      ) : (
        <div className="mt-3 p-3 rounded-lg border" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
          <input
            autoFocus
            value={linkSearch}
            onChange={e => setLinkSearch(e.target.value)}
            placeholder="Search projects…"
            className="w-full text-sm px-3 py-2 rounded-lg border outline-none mb-2"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          />
          {unlinkable.length === 0 ? (
            <p className="text-xs py-1" style={{ color: 'var(--color-muted)' }}>
              {linkSearch ? 'No matching projects.' : 'All active projects are already linked.'}
            </p>
          ) : (
            <div className="flex flex-col gap-0.5 max-h-40 overflow-y-auto">
              {unlinkable.map(p => (
                <button
                  key={p.id}
                  onClick={() => linkProject(p)}
                  disabled={linking}
                  className="w-full text-left text-sm px-3 py-2 rounded-lg hover:opacity-70 transition-opacity disabled:opacity-40"
                  style={{ color: 'var(--color-text)' }}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
          <div className="flex justify-end mt-2">
            <button onClick={() => { setShowLinkPanel(false); setLinkSearch(''); }} className="text-xs px-2 py-1 rounded" style={{ color: 'var(--color-muted)' }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Touchpoints section ────────────────────────────────────────────────────────

const BLANK_TP = { type: 'call', date: '', contactId: '', dealId: '', note: '' };

// Default follow-up due date: one week out, editable in the inline picker.
function inOneWeek() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

function TouchpointsSection({ clientId, clientName, touchpoints, contacts, deals, onRefresh }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]         = useState({ ...BLANK_TP, date: todayStr() });
  const [saving, setSaving]     = useState(false);
  const [followUpId, setFollowUpId] = useState(null); // touchpoint id currently showing the follow-up picker
  const [followUpDate, setFollowUpDate] = useState('');
  const [followUpNote, setFollowUpNote] = useState('');
  const [schedulingId, setSchedulingId] = useState(null);
  const [channelFilter, setChannelFilter] = useState('');
  const [uploadTargetId, setUploadTargetId] = useState(null);
  const [uploadingId, setUploadingId] = useState(null);
  const fileInputRef = useRef(null);
  const addToast = useToastStore(s => s.addToast);
  const set = (k) => (v) => setForm(f => ({ ...f, [k]: v }));

  // Attachments (docs/crm-deals-schema.md §10). One hidden <input type=file>
  // shared by every row — openAttach() records which touchpoint it's for,
  // then programmatically clicks it.
  const openAttach = (tp) => {
    setUploadTargetId(tp.id);
    fileInputRef.current?.click();
  };

  const onFileChosen = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same filename later
    if (!file || !uploadTargetId) return;
    setUploadingId(uploadTargetId);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.postForm(`/api/clients/${clientId}/touchpoints/${uploadTargetId}/attachments`, formData);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Upload failed');
      }
      addToast('File attached');
      onRefresh();
    } catch (err) {
      addToast(err.message || 'Upload failed', 'error');
    } finally {
      setUploadingId(null);
      setUploadTargetId(null);
    }
  };

  const deleteAttachment = async (attachment) => {
    try {
      await api.delete(`/api/attachments/${attachment.id}`);
      onRefresh();
    } catch (e) {
      addToast(e.message || 'Failed to remove attachment', 'error');
    }
  };

  // Communication-history phase 1 (docs/crm-deals-schema.md §9): filter the
  // existing log by type/channel, reusing the same field the log form
  // already writes — no new column. Only offer chips for channels actually
  // present, so the row doesn't show empty options for a client with no
  // meetings logged, say.
  const channelsPresent = [...new Set(touchpoints.map(tp => tp.type))];
  const visibleTouchpoints = channelFilter
    ? touchpoints.filter(tp => tp.type === channelFilter)
    : touchpoints;

  const openFollowUp = (tp) => {
    setFollowUpId(tp.id);
    setFollowUpDate(inOneWeek());
    setFollowUpNote(tp.note || ''); // prefilled from the touchpoint, editable — not locked to it
  };

  // Bridge: touchpoint (past) → task (future). One direction only — the
  // touchpoint itself never grows scheduling fields. Always sends both
  // clientId and dealId (dealId null if the touchpoint isn't deal-tagged);
  // both are already in scope here since this section only ever renders on
  // ClientDetailPage. See docs/crm-migration.md / crm-deals-schema.md §5.
  const scheduleFollowUp = async (tp) => {
    if (!followUpDate) return;
    setSchedulingId(tp.id);
    try {
      await api.post('/api/tasks', {
        title: `Follow up: ${tp.contactName || clientName || 'client'}${tp.dealTitle ? ` — ${tp.dealTitle}` : ''}`,
        notes: followUpNote.trim() || null,
        dueDate: followUpDate,
        category: FOLLOW_UP_CATEGORY,
        clientId,
        dealId: tp.dealId || null,
      }).then(r => r.json());
      addToast('Follow-up scheduled');
      setFollowUpId(null);
      onRefresh();
    } catch (e) {
      addToast(e.message || 'Failed to schedule follow-up', 'error');
    } finally {
      setSchedulingId(null);
    }
  };

  const save = async () => {
    if (!form.date || !form.type) return;
    setSaving(true);
    try {
      await api.post(`/api/clients/${clientId}/touchpoints`, {
        ...form,
        contactId: form.contactId || null,
        dealId: form.dealId || null,
      }).then(r => r.json());
      addToast('Touchpoint logged');
      onRefresh();
      setShowForm(false);
      setForm({ ...BLANK_TP, date: todayStr() });
    } catch (e) {
      addToast(e.message || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const del = async (tp) => {
    try {
      await api.delete(`/api/clients/${clientId}/touchpoints/${tp.id}`);
      onRefresh();
    } catch {
      addToast('Delete failed', 'error');
    }
  };

  return (
    <div className="pt-3">
      <input ref={fileInputRef} type="file" className="hidden" onChange={onFileChosen} />

      {touchpoints.length === 0 && !showForm && (
        <p className="text-sm mb-3" style={{ color: 'var(--color-muted)' }}>No touchpoints logged.</p>
      )}

      {channelsPresent.length > 1 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          <button
            onClick={() => setChannelFilter('')}
            className="text-xs px-2.5 py-1 rounded-full border capitalize"
            style={channelFilter === ''
              ? { background: 'var(--color-primary)', borderColor: 'var(--color-primary)', color: '#fff' }
              : { color: 'var(--color-muted)', borderColor: 'var(--color-border)' }}
          >
            All
          </button>
          {channelsPresent.map(ch => (
            <button
              key={ch}
              onClick={() => setChannelFilter(ch === channelFilter ? '' : ch)}
              className="text-xs px-2.5 py-1 rounded-full border capitalize"
              style={channelFilter === ch
                ? { background: 'var(--color-primary)', borderColor: 'var(--color-primary)', color: '#fff' }
                : { color: 'var(--color-muted)', borderColor: 'var(--color-border)' }}
            >
              {tpIcon(ch)} {ch}
            </button>
          ))}
        </div>
      )}

      {channelFilter && visibleTouchpoints.length === 0 && (
        <p className="text-sm mb-3" style={{ color: 'var(--color-muted)' }}>No {channelFilter} touchpoints.</p>
      )}

      {visibleTouchpoints.map(tp => (
        <div
          key={tp.id}
          className="group flex items-start gap-3 py-2.5 border-b last:border-b-0"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <span className="text-base flex-shrink-0 mt-0.5">{tpIcon(tp.type)}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-muted)' }}>
              <span className="font-medium capitalize">{tp.type}</span>
              <span>·</span>
              <span>{fmtRelative(tp.date)}</span>
              {tp.contactName && <><span>·</span><span>{tp.contactName}</span></>}
              {tp.dealTitle && <><span>·</span><span>🤝 {tp.dealTitle}</span></>}
            </div>
            {tp.note && (
              <p className="text-sm mt-0.5" style={{ color: 'var(--color-text)' }}>{tp.note}</p>
            )}
            {tp.attachments?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {tp.attachments.map(a => (
                  <AttachmentChip key={a.id} attachment={a} onDelete={deleteAttachment} />
                ))}
              </div>
            )}
            {followUpId === tp.id && (
              <div className="flex flex-col gap-2 mt-2">
                <Input rows={2} value={followUpNote} onChange={setFollowUpNote} placeholder="What's this follow-up about…" />
                <div className="flex items-center gap-2">
                  <Input type="date" value={followUpDate} onChange={setFollowUpDate} />
                  <button
                    onClick={() => scheduleFollowUp(tp)}
                    disabled={schedulingId === tp.id || !followUpDate}
                    className="text-xs px-2 py-1 rounded-lg font-medium disabled:opacity-40 flex-shrink-0"
                    style={{ background: 'var(--color-primary)', color: '#fff' }}
                  >
                    {schedulingId === tp.id ? 'Scheduling…' : 'Save'}
                  </button>
                  <button onClick={() => setFollowUpId(null)} className="text-xs hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
          {followUpId !== tp.id && (
            <button
              onClick={() => openFollowUp(tp)}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-xs px-2 py-1 rounded-lg border hover:opacity-60 flex-shrink-0"
              style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}
            >
              + Follow up
            </button>
          )}
          <button
            onClick={() => openAttach(tp)}
            disabled={uploadingId === tp.id}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-xs px-2 py-1 rounded-lg hover:opacity-60 flex-shrink-0 disabled:opacity-100"
            style={{ color: 'var(--color-muted)' }}
            title="Attach a file"
          >
            {uploadingId === tp.id ? '…' : '📎'}
          </button>
          <button
            onClick={() => del(tp)}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-xs px-1 py-1 rounded hover:opacity-60 flex-shrink-0"
            style={{ color: '#ef4444' }}
          >
            ✕
          </button>
        </div>
      ))}

      {showForm && (
        <div className="mt-3 p-3 rounded-lg border flex flex-col gap-2" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
          <div className="grid grid-cols-2 gap-2">
            <Sel value={form.type} onChange={set('type')}>
              {TOUCHPOINT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Sel>
            <Input type="date" value={form.date} onChange={set('date')} />
          </div>
          {contacts.length > 0 && (
            <Sel value={form.contactId} onChange={set('contactId')}>
              <option value="">— No specific contact —</option>
              {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Sel>
          )}
          {deals.length > 0 && (
            <Sel value={form.dealId} onChange={set('dealId')}>
              <option value="">— Not tied to a deal —</option>
              {deals.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
            </Sel>
          )}
          <Input rows={3} value={form.note} onChange={set('note')} placeholder="What happened or was decided…" />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="text-xs px-3 py-1.5 rounded-lg border" style={{ color: 'var(--color-muted)', borderColor: 'var(--color-border)' }}>Cancel</button>
            <button onClick={save} disabled={saving || !form.date} className="text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-40" style={{ background: 'var(--color-primary)', color: '#fff' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {!showForm && (
        <button onClick={() => setShowForm(true)} className="mt-3 text-sm hover:opacity-70 transition-opacity" style={{ color: 'var(--color-primary)' }}>
          + Log touchpoint
        </button>
      )}
    </div>
  );
}

// ── Communications section (Gmail) ────────────────────────────────────────────

// Fetches and displays the full email thread (not just the search snippet)
// via the existing GET /api/gmail/thread/:threadId endpoint (already used
// by GmailIntelPage) — the read-more escape hatch for CRM email search.
function EmailThreadModal({ threadId, subject, onClose }) {
  const [thread,  setThread]  = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    let cancelled = false;
    api.get(`/api/gmail/thread/${threadId}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setThread(d); })
      .catch(e => { if (!cancelled) setError(e.message || 'Failed to load thread'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [threadId]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-12 px-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="relative w-full max-w-2xl rounded-xl shadow-xl overflow-y-auto" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', maxHeight: '80vh' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <span className="font-semibold text-sm truncate pr-3" style={{ color: 'var(--color-text)' }}>{subject || '(no subject)'}</span>
          <div className="flex items-center gap-3 flex-shrink-0">
            <a
              href={`https://mail.google.com/mail/u/0/#all/${threadId}`}
              target="_blank" rel="noreferrer"
              className="text-xs hover:opacity-70 transition-opacity"
              style={{ color: 'var(--color-primary)' }}
            >
              Open in Gmail →
            </a>
            <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded hover:opacity-60 text-base" style={{ color: 'var(--color-muted)' }}>✕</button>
          </div>
        </div>
        <div className="p-5">
          {loading && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>}
          {error && <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>}
          {thread?.messages?.map(m => (
            <div key={m.id} className="mb-4 last:mb-0 pb-4 last:pb-0 border-b last:border-b-0" style={{ borderColor: 'var(--color-border)' }}>
              <div className="text-xs mb-1" style={{ color: 'var(--color-muted)' }}>
                <span className="font-medium" style={{ color: 'var(--color-text)' }}>{m.from}</span> → {m.to}
                <span className="ml-2">{m.date}</span>
              </div>
              <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>{m.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CommunicationsSection({ clientId, clientName, contacts, gmailStatus }) {
  const [query,    setQuery]    = useState('');
  const [results,  setResults]  = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [lastQ,    setLastQ]    = useState('');
  const [openThread, setOpenThread] = useState(null); // { threadId, subject } | null

  const contactsWithEmail = contacts.filter(c => c.email);

  if (!gmailStatus) {
    return <div className="pt-3 text-sm" style={{ color: 'var(--color-muted)' }}>Checking Gmail…</div>;
  }

  if (!gmailStatus.connected) {
    return (
      <div className="pt-3 text-sm" style={{ color: 'var(--color-muted)' }}>
        <Link to="/settings" className="hover:underline" style={{ color: 'var(--color-primary)' }}>Connect Gmail in Settings</Link>
        {' '}to search communications with this client.
      </div>
    );
  }

  if (contactsWithEmail.length === 0) {
    return (
      <div className="pt-3 text-sm" style={{ color: 'var(--color-muted)' }}>
        Add contact email addresses to search communications.
      </div>
    );
  }

  const search = async () => {
    setLoading(true);
    setResults(null);
    try {
      const params = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
      const res  = await api.get(`/api/clients/${clientId}/gmail-search${params}`);
      const data = await res.json();
      if (data.error === 'gmail_not_connected') {
        setResults({ error: 'Gmail disconnected. Reconnect in Settings.' });
      } else if (data.error === 'no_contacts') {
        setResults({ error: 'No contact email addresses found.' });
      } else {
        setResults(data);
        setLastQ(data.translatedQuery || '');
      }
    } catch (e) {
      setResults({ error: e.message || 'Search failed' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="pt-3">
      {/* Search bar */}
      <div className="flex gap-2 mb-3">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search()}
          placeholder={`Search emails from ${clientName}…`}
          className="flex-1 text-sm px-3 py-2 rounded-lg border outline-none"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        />
        <button
          onClick={search}
          disabled={loading}
          className="px-3 py-2 text-sm rounded-lg font-medium disabled:opacity-40 hover:opacity-80"
          style={{ background: 'var(--color-primary)', color: '#fff' }}
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
      </div>

      {lastQ && (
        <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>
          Query: <code style={{ background: 'var(--color-border)', padding: '0 4px', borderRadius: 3 }}>{lastQ}</code>
        </p>
      )}

      {/* Error */}
      {results?.error && (
        <p className="text-sm" style={{ color: '#ef4444' }}>{results.error}</p>
      )}

      {/* Results */}
      {results && !results.error && results.results?.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No emails found.</p>
      )}

      {results?.results?.length > 0 && (
        <div className="flex flex-col rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          {results.results.map(r => (
            <button
              key={r.id}
              onClick={() => setOpenThread({ threadId: r.threadId, subject: r.subject })}
              className="text-left w-full px-3 py-2.5 border-b last:border-b-0 hover:opacity-70 transition-opacity"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>{r.subject}</p>
                <p className="text-xs flex-shrink-0" style={{ color: 'var(--color-muted)' }}>
                  {r.date ? new Date(r.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : ''}
                </p>
              </div>
              <p className="text-xs truncate mt-0.5" style={{ color: 'var(--color-muted)' }}>{r.from}</p>
              {r.snippet && (
                <p className="text-xs mt-0.5 line-clamp-1" style={{ color: 'var(--color-muted)' }}>{r.snippet}</p>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Prompt to search */}
      {!results && !loading && (
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          Searching {contactsWithEmail.length} contact email{contactsWithEmail.length !== 1 ? 's' : ''}. Leave blank to see all recent emails.
        </p>
      )}

      {openThread && (
        <EmailThreadModal
          threadId={openThread.threadId}
          subject={openThread.subject}
          onClose={() => setOpenThread(null)}
        />
      )}
    </div>
  );
}
