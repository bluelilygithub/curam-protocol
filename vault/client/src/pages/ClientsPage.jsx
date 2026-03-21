import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/apiClient';
import ConfirmModal from '../components/ConfirmModal';
import MoodDot from '../components/mood/MoodDot';
import useToastStore from '../store/toastStore';
import { useIcon } from '../providers/IconProvider';

// ── Formatters ─────────────────────────────────────────────────────────────────

function fmt(n) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(n || 0);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// ── Status config ──────────────────────────────────────────────────────────────

const STATUS_MAP = {
  prospect: { label: 'Prospect', bg: '#dbeafe', color: '#1e40af' },
  active:   { label: 'Active',   bg: '#d1fae5', color: '#065f46' },
  paused:   { label: 'Paused',   bg: '#fef3c7', color: '#92400e' },
  archived: { label: 'Archived', bg: 'var(--color-border)', color: 'var(--color-muted)' },
};

const COMM_PREFS  = ['Email', 'Phone', 'Video', 'In person', 'Slack'];
const STATUS_OPTS = Object.entries(STATUS_MAP).map(([v, { label }]) => ({ value: v, label }));

// ── Shared mini-components ─────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const s = STATUS_MAP[status] || STATUS_MAP.active;
  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full font-medium"
      style={{ background: s.bg, color: s.color }}
    >
      {s.label}
    </span>
  );
}

function Btn({ onClick, disabled, variant = 'primary', children, className = '' }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-opacity hover:opacity-80 disabled:opacity-40 ${className}`}
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

function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>{label}</label>
      {children}
    </div>
  );
}

function Input({ value, onChange, type = 'text', placeholder, rows, required }) {
  const base = 'text-sm px-3 py-2 rounded-lg border w-full outline-none';
  const style = { background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
  if (rows) {
    return <textarea rows={rows} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={base} style={style} />;
  }
  return <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} required={required} className={base} style={style} />;
}

function Sel({ value, onChange, children }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="text-sm px-3 py-2 rounded-lg border w-full"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
    >
      {children}
    </select>
  );
}

// ── Tag chip input ─────────────────────────────────────────────────────────────

function TagInput({ tags, onChange }) {
  const [input, setInput] = useState('');

  const add = () => {
    const val = input.trim();
    if (val && !tags.includes(val)) onChange([...tags, val]);
    setInput('');
  };

  const remove = (tag) => onChange(tags.filter(t => t !== tag));

  return (
    <div
      className="flex flex-wrap gap-1.5 p-2 rounded-lg border min-h-[38px]"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      {tags.map(tag => (
        <span
          key={tag}
          className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
          style={{ background: 'var(--color-border)', color: 'var(--color-text)' }}
        >
          {tag}
          <button
            type="button"
            onClick={() => remove(tag)}
            className="hover:opacity-60 leading-none"
            style={{ color: 'var(--color-muted)' }}
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
          if (e.key === 'Backspace' && !input && tags.length) remove(tags[tags.length - 1]);
        }}
        placeholder={tags.length ? '' : 'Add tag, press Enter'}
        className="text-sm outline-none flex-1 min-w-[80px] bg-transparent"
        style={{ color: 'var(--color-text)' }}
      />
    </div>
  );
}

// ── New / Edit Client Modal ────────────────────────────────────────────────────

const BLANK_FORM = {
  name: '', company: '', status: 'active', communicationPref: '',
  howTheyWork: '', startDate: '', tags: [], notes: '', clientType: 'company',
};

function ClientModal({ client, onClose, onSaved }) {
  const [form, setForm] = useState(client ? {
    name:              client.name || '',
    company:           client.company || '',
    status:            client.status || 'active',
    communicationPref: client.communicationPref || '',
    howTheyWork:       client.howTheyWork || '',
    startDate:         client.startDate ? String(client.startDate).slice(0, 10) : '',
    tags:              Array.isArray(client.tags) ? client.tags : (client.tags ? JSON.parse(client.tags) : []),
    notes:             client.notes || '',
    clientType:        client.clientType || 'company',
  } : { ...BLANK_FORM });

  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const addToast = useToastStore(s => s.addToast);

  const set = (k) => (v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError('');
    try {
      const payload = { ...form, tags: form.tags };
      if (client) {
        await api.put(`/api/clients/${client.id}`, payload).then(r => r.json());
        addToast('Client updated');
      } else {
        await api.post('/api/clients', payload).then(r => r.json());
        addToast('Client created');
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-12 px-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg rounded-xl shadow-xl overflow-y-auto"
        style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', maxHeight: '88vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <span className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>
            {client ? 'Edit client' : 'New client'}
          </span>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded hover:opacity-60 text-base"
            style={{ color: 'var(--color-muted)' }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
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
            <Field label={form.clientType === 'individual' ? 'Name *' : 'Name *'}>
              <Input
                value={form.name}
                onChange={set('name')}
                placeholder={form.clientType === 'individual' ? 'Person\'s name' : 'Client name'}
                required
              />
            </Field>
            {form.clientType === 'company' && (
              <Field label="Company">
                <Input value={form.company} onChange={set('company')} placeholder="Organisation" />
              </Field>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <Sel value={form.status} onChange={set('status')}>
                {STATUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Sel>
            </Field>
            <Field label="Communication preference">
              <Sel value={form.communicationPref} onChange={set('communicationPref')}>
                <option value="">— Not set —</option>
                {COMM_PREFS.map(p => <option key={p} value={p}>{p}</option>)}
              </Sel>
            </Field>
          </div>

          <Field label="How they work">
            <Input
              rows={3}
              value={form.howTheyWork}
              onChange={set('howTheyWork')}
              placeholder="e.g. Prefers email, responds within 24hrs, decisions made by the CEO not the contact..."
            />
          </Field>

          <Field label="Start date">
            <Input type="date" value={form.startDate} onChange={set('startDate')} />
          </Field>

          <Field label="Tags">
            <TagInput tags={form.tags} onChange={set('tags')} />
          </Field>

          <Field label="Notes">
            <Input rows={3} value={form.notes} onChange={set('notes')} placeholder="Anything else worth noting..." />
          </Field>

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

const STATUS_FILTERS = [
  { value: '',         label: 'All'      },
  { value: 'prospect', label: 'Prospect' },
  { value: 'active',   label: 'Active'   },
  { value: 'paused',   label: 'Paused'   },
  { value: 'archived', label: 'Archived' },
];

export default function ClientsPage() {
  const navigate   = useNavigate();
  const addToast   = useToastStore(s => s.addToast);

  const [clients,      setClients]      = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [search,       setSearch]       = useState('');
  const [modal,        setModal]        = useState(null); // null | 'new' | {client}
  const [confirmDel,   setConfirmDel]   = useState(null);

  const searchRef = useRef('');

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (search)       params.set('search', search);
      const res  = await api.get(`/api/clients?${params}`);
      const data = await res.json();
      setClients(Array.isArray(data) ? data : []);
    } catch {
      setClients([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = (client) => {
    setConfirmDel({
      client,
      onConfirm: async () => {
        try {
          await api.delete(`/api/clients/${client.id}`);
          setClients(prev => prev.filter(c => c.id !== client.id));
          addToast('Client deleted');
        } catch {
          addToast('Delete failed', 'error');
        }
        setConfirmDel(null);
      },
    });
  };

  const primaryContact = (client) => {
    if (!client.contacts) return null;
    return client.contacts?.find(c => c.isPrimary) || client.contacts?.[0] || null;
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>Clients</h1>
        <Btn onClick={() => setModal('new')}>+ New Client</Btn>
      </div>

      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row gap-2 mb-5">
        <div className="flex gap-1 flex-wrap">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className="px-3 py-1 text-xs rounded-full font-medium transition-colors"
              style={{
                background: statusFilter === f.value ? 'var(--color-primary)' : 'var(--color-surface)',
                color:      statusFilter === f.value ? '#fff'                  : 'var(--color-muted)',
                border:     '1px solid var(--color-border)',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or company…"
          className="text-sm px-3 py-1.5 rounded-lg border outline-none sm:min-w-[220px]"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        />
      </div>

      {/* Loading */}
      {loading && (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>
      )}

      {/* Empty state */}
      {!loading && clients.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            {search || statusFilter ? 'No clients match those filters.' : 'No clients yet. Add your first client to get started.'}
          </p>
          {!search && !statusFilter && (
            <Btn onClick={() => setModal('new')}>+ Add client</Btn>
          )}
        </div>
      )}

      {/* Client grid */}
      {!loading && clients.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {clients.map(client => (
            <ClientCard
              key={client.id}
              client={client}
              onEdit={() => setModal(client)}
              onDelete={() => handleDelete(client)}
              onClick={() => navigate(`/clients/${client.id}`)}
            />
          ))}
        </div>
      )}

      {/* New/Edit modal */}
      {modal && (
        <ClientModal
          client={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={load}
        />
      )}

      {/* Delete confirm */}
      {confirmDel && (
        <ConfirmModal
          title="Delete client"
          message={`Delete "${confirmDel.client.name}"? This will unlink all projects but will not delete them or their invoices.`}
          confirmLabel="Delete"
          danger
          onConfirm={confirmDel.onConfirm}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </div>
  );
}

// ── Client card ────────────────────────────────────────────────────────────────

function ClientCard({ client, onClick, onEdit, onDelete }) {
  const dominantEmotion = client.dominantMood ? { coreEmotion: client.dominantMood } : null;
  const getIcon = useIcon();
  const isIndividual = client.clientType === 'individual';

  return (
    <div
      className="group p-4 rounded-xl border cursor-pointer transition-opacity hover:opacity-90"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      onClick={onClick}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex-shrink-0" style={{ color: 'var(--color-muted)' }}>
            {getIcon(isIndividual ? 'user' : 'briefcase', { size: 14 })}
          </span>
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate" style={{ color: 'var(--color-text)' }}>
              {client.name}
            </div>
            {client.company && (
              <div className="text-xs truncate mt-0.5" style={{ color: 'var(--color-muted)' }}>
                {client.company}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <MoodDot
            entityType="client"
            entityId={String(client.id)}
            entityTitle={client.name}
            dominantEmotion={dominantEmotion}
          />
          <StatusBadge status={client.status} />
        </div>
      </div>

      {/* Contact */}
      {(client.primaryContactName || client.primaryContactEmail) && (
        <div className="text-xs mb-2 truncate" style={{ color: 'var(--color-muted)' }}>
          {[client.primaryContactName, client.primaryContactEmail].filter(Boolean).join(' · ')}
        </div>
      )}

      {/* Stats row */}
      <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--color-muted)' }}>
        {client.projectCount > 0 && (
          <span>{client.projectCount} project{client.projectCount !== 1 ? 's' : ''}</span>
        )}
        {parseFloat(client.totalInvoiced) > 0 && (
          <span>
            {fmt(client.totalInvoiced)} invoiced
            {parseFloat(client.outstanding) > 0 && (
              <span style={{ color: '#f59e0b' }}> · {fmt(client.outstanding)} outstanding</span>
            )}
          </span>
        )}
        {!client.projectCount && !parseFloat(client.totalInvoiced) && (
          <span>No activity yet</span>
        )}
      </div>

      {/* Hover actions */}
      <div
        className="flex gap-1 mt-3 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onEdit}
          className="text-xs px-2 py-1 rounded border hover:opacity-70 transition-opacity"
          style={{ color: 'var(--color-muted)', borderColor: 'var(--color-border)' }}
        >
          Edit
        </button>
        <button
          onClick={onDelete}
          className="text-xs px-2 py-1 rounded border hover:opacity-70 transition-opacity"
          style={{ color: '#ef4444', borderColor: '#fca5a5' }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
