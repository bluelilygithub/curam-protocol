import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import api from '../utils/apiClient';
import ConfirmModal from '../components/ConfirmModal';
import useToastStore from '../store/toastStore';

// ── Formatters ─────────────────────────────────────────────────────────────────

function fmt(n) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(n || 0);
}

function fmtDate(d) {
  if (!d) return '—';
  const s = String(d).slice(0, 10);
  return new Date(s + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Shared UI ──────────────────────────────────────────────────────────────────

function Btn({ onClick, disabled, variant = 'primary', children, className = '' }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-opacity hover:opacity-80 disabled:opacity-40 ${className}`}
      style={{
        background: variant === 'primary' ? 'var(--color-primary)' : 'transparent',
        color: variant === 'primary' ? '#fff' : 'var(--color-text)',
        border: variant === 'secondary' ? '1px solid var(--color-border)' : 'none',
      }}
    >
      {children}
    </button>
  );
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-12 px-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className={`relative w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} rounded-xl shadow-xl overflow-y-auto`}
        style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', maxHeight: '85vh' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <span className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>{title}</span>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded hover:opacity-60 text-base"
            style={{ color: 'var(--color-muted)' }}
          >✕</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
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

function Input({ value, onChange, type = 'text', placeholder, className = '' }) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`text-sm px-3 py-2 rounded-lg border w-full ${className}`}
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }}
    />
  );
}

function Textarea({ value, onChange, placeholder, rows = 3 }) {
  return (
    <textarea
      rows={rows}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="text-sm px-3 py-2 rounded-lg border w-full"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none', resize: 'vertical' }}
    />
  );
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

function displayStatus(inv) {
  if (inv.status === 'sent' && inv.dueDate) {
    const due = new Date(String(inv.dueDate).slice(0, 10) + 'T00:00:00');
    if (due < new Date()) return 'overdue';
  }
  return inv.status;
}

function StatusBadge({ status }) {
  const map = {
    draft:    { bg: 'var(--color-surface)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' },
    sent:     { bg: '#dbeafe', color: '#1e40af' },
    paid:     { bg: '#d1fae5', color: '#065f46' },
    void:     { bg: '#fee2e2', color: '#991b1b' },
    overdue:  { bg: '#fee2e2', color: '#991b1b' },
    accepted: { bg: '#d1fae5', color: '#065f46' },
    declined: { bg: '#fee2e2', color: '#991b1b' },
  };
  const s = map[status] || map.draft;
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium capitalize" style={s}>
      {status}
    </span>
  );
}

function ErrMsg({ msg }) {
  if (!msg) return null;
  return <p className="text-xs" style={{ color: '#ef4444' }}>{msg}</p>;
}

function CategoryInput({ value, onChange }) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    api.get('/api/finance/expenses/categories')
      .then(r => r.json())
      .then(d => setSuggestions(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  const filtered = suggestions.filter(s => s.toLowerCase().includes((value || '').toLowerCase()) && s !== value);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input
        type="text"
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Software, Travel…"
        className="text-sm px-3 py-2 rounded-lg border w-full"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }}
      />
      {open && filtered.length > 0 && (
        <div
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
            borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.12)', marginTop: 2,
          }}
        >
          {filtered.map(s => (
            <button
              key={s}
              type="button"
              onMouseDown={e => { e.preventDefault(); onChange(s); setOpen(false); }}
              className="w-full text-left text-sm px-3 py-1.5 hover:opacity-70 transition-opacity"
              style={{ color: 'var(--color-text)' }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SupplierInput({ value, onChange }) {
  const [suppliers, setSuppliers] = useState([]);
  const [open, setOpen]           = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    api.get('/api/finance/suppliers?activeOnly=true')
      .then(r => r.json())
      .then(d => setSuppliers(Array.isArray(d) ? d.map(s => s.name) : []))
      .catch(() => {});
  }, []);

  const filtered = suppliers.filter(s => s.toLowerCase().includes((value || '').toLowerCase()) && s !== value);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input
        type="text"
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Supplier name…"
        className="text-sm px-3 py-2 rounded-lg border w-full"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }}
      />
      {open && filtered.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
          background: 'var(--color-surface)', border: '1px solid var(--color-border)',
          borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.12)', marginTop: 2,
        }}>
          {filtered.map(s => (
            <button
              key={s}
              type="button"
              onMouseDown={e => { e.preventDefault(); onChange(s); setOpen(false); }}
              className="w-full text-left text-sm px-3 py-1.5 hover:opacity-70 transition-opacity"
              style={{ color: 'var(--color-text)' }}
            >{s}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function TxCodeSelect({ value, onChange, type, placeholder = 'No code' }) {
  const [codes, setCodes] = useState([]);
  useEffect(() => {
    api.get(`/api/finance/tx-codes?type=${type}`)
      .then(r => r.json())
      .then(d => setCodes(Array.isArray(d) ? d.filter(c => c.isActive) : []))
      .catch(() => {});
  }, [type]);
  return (
    <select
      value={value || ''}
      onChange={e => onChange(e.target.value ? parseInt(e.target.value) : null)}
      className="text-xs px-2 py-1 rounded-lg border w-full"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: value ? 'var(--color-text)' : 'var(--color-muted)' }}
    >
      <option value="">{placeholder}</option>
      {codes.map(c => (
        <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
      ))}
    </select>
  );
}

// ── Date range ────────────────────────────────────────────────────────────────

function getPresetRange(preset) {
  const now = new Date();
  const y   = now.getFullYear();
  const m   = now.getMonth(); // 0-indexed
  const pad = n => String(n).padStart(2, '0');
  const str = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

  if (preset === 'week') {
    const mon = new Date(now); mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return { from: str(mon), to: str(sun) };
  }
  if (preset === 'month') {
    return { from: `${y}-${pad(m+1)}-01`, to: str(new Date(y, m+1, 0)) };
  }
  if (preset === 'quarter') {
    const q = Math.floor(m / 3);
    return { from: `${y}-${pad(q*3+1)}-01`, to: str(new Date(y, q*3+3, 0)) };
  }
  if (preset === 'year') {
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
  return { from: '', to: '' }; // 'all' / 'custom' — no auto range
}

const DATE_PRESETS = [
  { key: 'week',    label: 'Week'    },
  { key: 'month',   label: 'Month'   },
  { key: 'quarter', label: 'Quarter' },
  { key: 'year',    label: 'Year'    },
  { key: 'custom',  label: 'Custom'  },
  { key: 'all',     label: 'All'     },
];

function DateRangePicker({ value, onChange }) {
  const { preset, from, to } = value;
  const select = (key) => {
    if (key === 'custom') { onChange({ preset: 'custom', from, to }); return; }
    onChange({ preset: key, ...getPresetRange(key) });
  };
  return (
    <div className="flex items-center gap-2 flex-wrap px-6 py-2 border-b" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
      <div className="flex gap-1 flex-wrap">
        {DATE_PRESETS.map(p => (
          <button
            key={p.key}
            onClick={() => select(p.key)}
            className="text-xs px-2.5 py-1 rounded-full font-medium transition-colors"
            style={{
              background:   preset === p.key ? 'var(--color-primary)' : 'transparent',
              color:        preset === p.key ? '#fff' : 'var(--color-muted)',
              border:       '1px solid var(--color-border)',
            }}
          >{p.label}</button>
        ))}
      </div>
      {preset === 'custom' && (
        <div className="flex items-center gap-1.5">
          <input
            type="date" value={from}
            onChange={e => onChange({ preset: 'custom', from: e.target.value, to })}
            className="text-xs px-2 py-1 rounded-lg border outline-none"
            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          />
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>–</span>
          <input
            type="date" value={to}
            onChange={e => onChange({ preset: 'custom', from, to: e.target.value })}
            className="text-xs px-2 py-1 rounded-lg border outline-none"
            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          />
        </div>
      )}
      {preset !== 'all' && preset !== 'custom' && from && to && (
        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{fmtDate(from)} – {fmtDate(to)}</span>
      )}
    </div>
  );
}

// ── Dashboard ──────────────────────────────────────────────────────────────────

function DashboardTab({ from, to }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to)   params.set('to', to);
    api.get(`/api/finance/dashboard?${params}`)
      .then(r => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [from, to]);

  if (loading) return <div className="p-6 text-sm" style={{ color: 'var(--color-muted)' }}>Loading...</div>;
  if (!data) return null;

  const net = parseFloat((data.yearRevenue - data.yearExpenses - data.yearWages).toFixed(2));

  const cards = [
    { label: 'Revenue',          value: fmt(data.yearRevenue),       sub: `${data.paidInvoices} paid invoices`                           },
    { label: 'Outstanding',      value: fmt(data.outstandingAmount), sub: `${data.outstandingCount} sent, not yet due`, warn: data.outstandingCount > 0 },
    { label: 'Overdue',          value: fmt(data.overdueAmount),     sub: `${data.overdueCount} past due date`,         neg: data.overdueCount > 0    },
    { label: 'Expenses',         value: fmt(data.yearExpenses),      sub: 'ex GST'                                                        },
    { label: 'Wages',            value: fmt(data.yearWages),         sub: 'gross wages'                                                   },
    { label: 'Net Profit (est)', value: fmt(net),                    sub: 'revenue − expenses − wages',                 neg: net < 0                  },
  ];

  return (
    <div data-tour="finance-dashboard" className="p-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {cards.map(c => (
          <div
            key={c.label}
            className="p-4 rounded-xl border"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
          >
            <div className="text-xs mb-1" style={{ color: 'var(--color-muted)' }}>{c.label}</div>
            <div
              className="text-xl font-bold"
              style={{ color: c.warn ? '#f59e0b' : c.neg ? '#ef4444' : 'var(--color-text)' }}
            >{c.value}</div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{c.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Clients ────────────────────────────────────────────────────────────────────

function ClientsTab() {
  const [clients, setClients] = useState([]);
  const [modal, setModal] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);
  const [form, setForm] = useState({ name: '', contactName: '', email: '', phone: '', address: '', abn: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const addToast = useToastStore(s => s.addToast);

  const load = useCallback(() => {
    api.get('/api/finance/clients').then(r => r.json()).then(d => setClients(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const openNew  = () => { setForm({ name: '', contactName: '', email: '', phone: '', address: '', abn: '' }); setError(''); setModal('new'); };
  const openEdit = (c) => { setForm({ name: c.name, contactName: c.contactName||'', email: c.email||'', phone: c.phone||'', address: c.address||'', abn: c.abn||'' }); setError(''); setModal(c); };

  const save = async () => {
    if (!form.name.trim()) { setError('Name required'); return; }
    setSaving(true);
    try {
      if (modal === 'new') {
        await api.post('/api/finance/clients', form);
      } else {
        await api.put(`/api/finance/clients/${modal.id}`, form);
      }
      load();
      setModal(null);
      addToast(modal === 'new' ? 'Client created' : 'Client updated');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (c) => {
    const next = !c.isActive;
    await api.patch(`/api/finance/clients/${c.id}`, { isActive: next });
    setClients(prev => prev.map(x => x.id === c.id ? { ...x, isActive: next } : x));
    addToast(next ? 'Client set to active' : 'Client deactivated');
  };

  const del = (id, name) => {
    setConfirmModal({
      message: `Delete "${name}"? This cannot be undone.`,
      onConfirm: async () => {
        setConfirmModal(null);
        await api.delete(`/api/finance/clients/${id}`);
        setClients(prev => prev.filter(c => c.id !== id));
        addToast('Client deleted');
      },
    });
  };

  return (
    <div className="p-6">
      <div className="mb-4 px-3 py-2.5 rounded-lg text-xs flex items-center justify-between" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
        <span>Client relationships are now managed in the Clients module.</span>
        <Link to="/clients" className="font-medium hover:opacity-70 transition-opacity" style={{ color: 'var(--color-primary)' }}>Go to Clients →</Link>
      </div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold" style={{ color: 'var(--color-text)' }}>Billing records</h2>
        <Btn onClick={openNew}>+ New</Btn>
      </div>

      {clients.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No clients yet.</p>
      ) : (
        <div className="flex flex-col gap-2 max-w-2xl">
          {clients.map(c => (
            <div
              key={`${c.source || 'fin'}-${c.id}`}
              className="flex items-center justify-between p-3 rounded-lg border"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
            >
              <div>
                <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{c.name}</div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                  {[c.contactName, c.email, c.abn && `ABN ${c.abn}`].filter(Boolean).join(' · ') || 'No contact info'}
                </div>
              </div>
              <div className="flex gap-2">
                {c.source === 'crm' ? (
                  <Link to={`/clients/${c.id}`} className="text-xs px-2 py-1 rounded border hover:opacity-70 transition-opacity" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>View →</Link>
                ) : (
                  <>
                    <button
                      onClick={() => toggleActive(c)}
                      className="text-xs px-2 py-1 rounded border hover:opacity-70 transition-opacity"
                      style={c.isActive
                        ? { color: '#92400e', borderColor: '#fde68a', background: '#fef3c7' }
                        : { color: '#065f46', borderColor: '#6ee7b7', background: '#d1fae5' }}
                    >{c.isActive ? 'Deactivate' : 'Set active'}</button>
                    <Btn variant="secondary" onClick={() => openEdit(c)}>Edit</Btn>
                    <button
                      onClick={() => del(c.id, c.name)}
                      className="text-xs px-2 py-1 rounded border hover:opacity-70 transition-opacity"
                      style={{ color: '#ef4444', borderColor: '#fca5a5' }}
                    >Delete</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <Modal title={modal === 'new' ? 'New Client' : 'Edit Client'} onClose={() => setModal(null)}>
          <div className="flex flex-col gap-3">
            <Field label="Name *"><Input value={form.name} onChange={v => setForm(p => ({...p, name: v}))} placeholder="Client name" /></Field>
            <Field label="Contact Name"><Input value={form.contactName} onChange={v => setForm(p => ({...p, contactName: v}))} placeholder="Primary contact person" /></Field>
            <Field label="Email"><Input type="email" value={form.email} onChange={v => setForm(p => ({...p, email: v}))} placeholder="email@example.com" /></Field>
            <Field label="Phone"><Input value={form.phone} onChange={v => setForm(p => ({...p, phone: v}))} placeholder="+61 4xx xxx xxx" /></Field>
            <Field label="ABN"><Input value={form.abn} onChange={v => setForm(p => ({...p, abn: v}))} placeholder="12 345 678 901" /></Field>
            <Field label="Address"><Input value={form.address} onChange={v => setForm(p => ({...p, address: v}))} placeholder="Street, City, State" /></Field>
            <ErrMsg msg={error} />
            <div className="flex gap-2 justify-end pt-1">
              <Btn variant="secondary" onClick={() => setModal(null)}>Cancel</Btn>
              <Btn onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Btn>
            </div>
          </div>
        </Modal>
      )}

      {confirmModal && (
        <ConfirmModal
          title="Delete Client"
          message={confirmModal.message}
          confirmLabel="Delete"
          danger
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}
    </div>
  );
}

// ── Invoices ──────────────────────────────────────────────────────────────────

const BLANK_ITEM = { description: '', qty: '1', unitPrice: '', gstCode: 'GST', txCodeId: null };

function calcTotals(items) {
  let subtotal = 0, gst = 0;
  for (const item of items) {
    const amt = (parseFloat(item.qty) || 0) * (parseFloat(item.unitPrice) || 0);
    subtotal += amt;
    const code = item.gstCode || (item.gstApplies === false ? 'NT' : 'GST');
    if (code === 'GST') gst += amt * 0.1;
  }
  return { subtotal: subtotal.toFixed(2), gst: gst.toFixed(2), total: (subtotal + gst).toFixed(2) };
}

function InvoicesTab({ from, to, docType = 'invoice' }) {
  const isQuoteTab = docType === 'quote';
  const [invoices, setInvoices] = useState([]);
  const [clients, setClients] = useState([]);
  const [incomeCodes, setIncomeCodes] = useState([]);
  const [modal, setModal] = useState(null);
  const [viewInvoice, setViewInvoice] = useState(null);
  const [sendModal, setSendModal] = useState(null); // invoice to send
  const [sendTo, setSendTo] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmModal, setConfirmModal] = useState(null);
  const [paidModal, setPaidModal] = useState(null); // { inv, date }
  const [pdfLoading, setPdfLoading] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [converting, setConverting]     = useState(null);
  const addToast = useToastStore(s => s.addToast);

  const blankForm = () => ({ clientRef: '', issueDate: todayStr(), dueDate: '', notes: '', paidAt: '', items: [{ ...BLANK_ITEM }], docType });
  const [form, setForm] = useState(blankForm);

  const load = useCallback(async () => {
    const [invs, cls] = await Promise.all([
      api.get('/api/finance/invoices').then(r => r.json()),
      api.get('/api/finance/clients?activeOnly=true').then(r => r.json()),
    ]);
    setInvoices(Array.isArray(invs) ? invs : []);
    setClients(Array.isArray(cls) ? cls : []);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get('/api/finance/tx-codes?type=income').then(r => r.json()).then(d => setIncomeCodes(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  const incomeCodeMap = Object.fromEntries(incomeCodes.map(c => [c.id, c]));

  const openNew = () => { setForm({ ...blankForm() }); setError(''); setModal('new'); };

  const openEdit = async (inv) => {
    if (inv.isLocked) return;
    const data = await api.get(`/api/finance/invoices/${inv.id}`).then(r => r.json());
    setForm({
      clientRef: data.clientRef ? `crm:${data.clientRef}` : data.clientId ? `fin:${data.clientId}` : '',
      issueDate: data.issueDate ? String(data.issueDate).slice(0,10) : todayStr(),
      dueDate:   data.dueDate  ? String(data.dueDate).slice(0,10)  : '',
      notes:     data.notes || '',
      paidAt:    data.paidAt  ? String(data.paidAt).slice(0,10)   : '',
      docType:   data.docType || 'invoice',
      items:     data.items.length
        ? data.items.map(i => ({ description: i.description, qty: String(i.qty), unitPrice: String(i.unitPrice), gstCode: i.gstCode || (parseFloat(i.gst) > 0 ? 'GST' : 'NT'), txCodeId: i.txCodeId || null }))
        : [{ ...BLANK_ITEM }],
    });
    setError('');
    setModal(inv);
  };

  const setItem = (idx, key, val) => setForm(p => ({
    ...p,
    items: p.items.map((item, i) => i === idx ? { ...item, [key]: val } : item),
  }));
  const addItem    = () => setForm(p => ({ ...p, items: [...p.items, { ...BLANK_ITEM }] }));
  const removeItem = (idx) => setForm(p => ({ ...p, items: p.items.filter((_, i) => i !== idx) }));

  const totals = calcTotals(form.items);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const [src, rawId] = form.clientRef ? form.clientRef.split(':') : [null, null];
      const clientId  = src === 'fin' ? parseInt(rawId, 10) : null;
      const clientRef = src === 'crm' ? parseInt(rawId, 10) : null;
      const payload = { ...form, clientRef, clientId, paidAt: form.paidAt || null };
      const label = form.docType === 'quote' ? 'Quote' : 'Invoice';
      if (modal === 'new') {
        const res = await api.post('/api/finance/invoices', payload);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Failed to create ${label.toLowerCase()}`);
        }
      } else {
        const res = await api.put(`/api/finance/invoices/${modal.id}`, { ...payload, status: modal.status });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Failed to update ${label.toLowerCase()}`);
        }
      }
      await load();
      setModal(null);
      addToast(modal === 'new' ? `${label} created` : `${label} updated`);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const markPaid = (inv) => {
    setPaidModal({ inv, date: todayStr() });
  };

  const confirmMarkPaid = async () => {
    const { inv, date } = paidModal;
    setPaidModal(null);
    try {
      await api.post(`/api/finance/invoices/${inv.id}/mark-paid`, { paidAt: date });
      await load();
      if (viewInvoice?.id === inv.id) setViewInvoice(null);
      addToast(`${inv.number} marked paid`);
    } catch (e) {
      addToast(e.message, 'error');
    }
  };

  const openSend = (inv) => {
    setSendTo(inv.clientEmail || '');
    setSendError('');
    setSendModal(inv);
  };

  const confirmSend = async () => {
    if (!sendTo.trim()) { setSendError('Email address required'); return; }
    setSending(true);
    setSendError('');
    try {
      const result = await api.post(`/api/finance/invoices/${sendModal.id}/send`, { to: sendTo.trim() }).then(r => r.json());
      if (result.error) throw new Error(result.error);
      await load();
      setSendModal(null);
      addToast(`Invoice sent to ${sendTo.trim()}`);
    } catch (e) {
      setSendError(e.message);
    } finally {
      setSending(false);
    }
  };

  const del = (inv) => {
    setConfirmModal({
      title: 'Delete Invoice',
      message: `Delete ${inv.number}? This cannot be undone.`,
      confirmLabel: 'Delete',
      onConfirm: async () => {
        setConfirmModal(null);
        await api.delete(`/api/finance/invoices/${inv.id}`);
        setInvoices(prev => prev.filter(i => i.id !== inv.id));
        addToast('Invoice deleted');
      },
    });
  };

  const viewDetail = async (inv) => {
    const data = await api.get(`/api/finance/invoices/${inv.id}`).then(r => r.json());
    setViewInvoice(data);
  };

  const downloadPdf = async (inv) => {
    setPdfLoading(inv.id);
    try {
      const res = await api.get(`/api/finance/invoices/${inv.id}/pdf`);
      if (!res.ok) throw new Error('PDF generation failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${inv.number}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setPdfLoading(null);
    }
  };

  const convertQuote = async (inv) => {
    setConverting(inv.id);
    try {
      const res  = await api.post(`/api/finance/invoices/${inv.id}/convert`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Conversion failed');
      await load();
      addToast(`Quote ${inv.number} converted → ${body.invoice.number}`);
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setConverting(null);
    }
  };

  return (
    <div data-tour="finance-invoices" className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold" style={{ color: 'var(--color-text)' }}>
          {isQuoteTab ? 'Quotes' : 'Invoices'}
        </h2>
        <Btn onClick={openNew}>{isQuoteTab ? '+ New Quote' : '+ New Invoice'}</Btn>
      </div>

      <div className="flex gap-1 mb-3 flex-wrap">
        {(isQuoteTab
          ? ['all','draft','sent','accepted','declined']
          : ['all','draft','sent','overdue','paid']
        ).map(s => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className="text-xs px-2.5 py-1 rounded-md capitalize transition-colors"
            style={{
              background:  filterStatus === s ? 'var(--color-primary)' : 'var(--color-surface)',
              color:       filterStatus === s ? '#fff' : 'var(--color-muted)',
              border:      '1px solid var(--color-border)',
            }}
          >{s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}</button>
        ))}
      </div>

      {(() => {
        const filtered = invoices.filter(inv => {
          if (isQuoteTab ? inv.docType !== 'quote' : inv.docType === 'quote') return false;
          if (filterStatus !== 'all' && displayStatus(inv) !== filterStatus) return false;
          const d = String(inv.issueDate).slice(0, 10);
          if (from && d < from) return false;
          if (to   && d > to)   return false;
          return true;
        });
        return filtered.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No {isQuoteTab ? 'quotes' : 'invoices'} match this filter.</p>
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
                {['Number', 'Client', 'Issued', 'Due', isQuoteTab ? 'Accepted' : 'Paid', 'Total', 'Status', ''].map(h => (
                  <th key={h} className="text-left py-2 px-2 text-xs font-semibold" style={{ color: 'var(--color-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(inv => (
                <tr key={inv.id} className="border-b hover:opacity-80 transition-opacity" style={{ borderColor: 'var(--color-border)' }}>
                  <td className="py-2 px-2">
                    <button onClick={() => viewDetail(inv)} className="font-medium hover:underline" style={{ color: 'var(--color-primary)' }}>
                      {inv.number}
                    </button>
                  </td>
                  <td className="py-2 px-2" style={{ color: 'var(--color-text)' }}>{inv.clientName || '—'}</td>
                  <td className="py-2 px-2 text-xs" style={{ color: 'var(--color-muted)' }}>{fmtDate(inv.issueDate)}</td>
                  <td className="py-2 px-2 text-xs" style={{ color: 'var(--color-muted)' }}>{fmtDate(inv.dueDate)}</td>
                  <td className="py-2 px-2 text-xs" style={{ color: inv.paidAt ? '#065f46' : 'var(--color-muted)' }}>{inv.paidAt ? fmtDate(inv.paidAt) : '—'}</td>
                  <td className="py-2 px-2 font-medium" style={{ color: 'var(--color-text)' }}>{fmt(inv.total)}</td>
                  <td className="py-2 px-2"><StatusBadge status={displayStatus(inv)} /></td>
                  <td className="py-2 px-2">
                    <div className="flex gap-1 flex-wrap">
                      {isQuoteTab ? (
                        <>
                          {(inv.status === 'draft' || inv.status === 'sent') && (
                            <button onClick={() => openSend(inv)} className="text-xs px-2 py-0.5 rounded border hover:opacity-70" style={{ color: '#1e40af', borderColor: '#bfdbfe' }}>
                              {inv.status === 'draft' ? 'Send' : 'Resend'}
                            </button>
                          )}
                          {!inv.isLocked && inv.status !== 'accepted' && (
                            <button onClick={() => openEdit(inv)} className="text-xs px-2 py-0.5 rounded border hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Edit</button>
                          )}
                          {inv.status !== 'accepted' && inv.status !== 'declined' && (
                            <button
                              onClick={() => convertQuote(inv)}
                              disabled={converting === inv.id}
                              className="text-xs px-2 py-0.5 rounded border hover:opacity-70 disabled:opacity-40"
                              style={{ color: '#065f46', borderColor: '#a7f3d0' }}
                            >{converting === inv.id ? '…' : 'Convert →'}</button>
                          )}
                          {inv.status !== 'accepted' && (
                            <button onClick={() => del(inv)} className="text-xs px-2 py-0.5 rounded border hover:opacity-70" style={{ color: '#ef4444', borderColor: '#fca5a5' }}>Del</button>
                          )}
                          <button
                            onClick={() => downloadPdf(inv)}
                            disabled={pdfLoading === inv.id}
                            className="text-xs px-2 py-0.5 rounded border hover:opacity-70 disabled:opacity-40"
                            style={{ color: '#6b7280', borderColor: '#d1d5db' }}
                          >{pdfLoading === inv.id ? '…' : 'PDF'}</button>
                        </>
                      ) : (
                        <>
                          {inv.status === 'draft' && (
                            <button onClick={() => openSend(inv)} className="text-xs px-2 py-0.5 rounded border hover:opacity-70" style={{ color: '#1e40af', borderColor: '#bfdbfe' }}>Send</button>
                          )}
                          {inv.status === 'sent' && (
                            <button onClick={() => openSend(inv)} className="text-xs px-2 py-0.5 rounded border hover:opacity-70" style={{ color: '#1e40af', borderColor: '#bfdbfe' }}>Resend</button>
                          )}
                          {!inv.isLocked && (
                            <button onClick={() => openEdit(inv)} className="text-xs px-2 py-0.5 rounded border hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Edit</button>
                          )}
                          {inv.status !== 'paid' && inv.status !== 'void' && (
                            <button onClick={() => markPaid(inv)} className="text-xs px-2 py-0.5 rounded border hover:opacity-70" style={{ color: '#065f46', borderColor: '#a7f3d0' }}>Paid</button>
                          )}
                          {inv.status !== 'paid' && (
                            <button onClick={() => del(inv)} className="text-xs px-2 py-0.5 rounded border hover:opacity-70" style={{ color: '#ef4444', borderColor: '#fca5a5' }}>Del</button>
                          )}
                          <button
                            onClick={() => downloadPdf(inv)}
                            disabled={pdfLoading === inv.id}
                            className="text-xs px-2 py-0.5 rounded border hover:opacity-70 disabled:opacity-40"
                            style={{ color: '#6b7280', borderColor: '#d1d5db' }}
                          >{pdfLoading === inv.id ? '…' : 'PDF'}</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        );
      })()}

      {/* Invoice builder modal */}
      {modal && (
        <Modal
          title={modal === 'new'
            ? (form.docType === 'quote' ? 'New Quote' : 'New Invoice')
            : `Edit ${modal.number}`}
          onClose={() => setModal(null)} wide>
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Client">
                <Sel value={form.clientRef} onChange={v => setForm(p => ({...p, clientRef: v}))}>
                  <option value="">— No client —</option>
                  {clients.map(c => <option key={`${c.source}:${c.id}`} value={`${c.source}:${c.id}`}>{c.name}</option>)}
                </Sel>
              </Field>
              <Field label="Issue Date">
                <Input type="date" value={form.issueDate} onChange={v => setForm(p => ({...p, issueDate: v}))} />
              </Field>
              <Field label="Due Date">
                <Input type="date" value={form.dueDate} onChange={v => setForm(p => ({...p, dueDate: v}))} />
              </Field>
              {modal !== 'new' && modal?.status === 'paid' && (
                <Field label="Payment Date">
                  <Input type="date" value={form.paidAt} onChange={v => setForm(p => ({...p, paidAt: v}))} />
                </Field>
              )}
            </div>
            <Field label="Notes">
              <Textarea value={form.notes} onChange={v => setForm(p => ({...p, notes: v}))} placeholder="Payment terms, reference…" rows={3} />
            </Field>

            {/* Line items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Line Items</span>
                <button
                  onClick={addItem}
                  className="text-xs px-2 py-1 rounded border"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}
                >+ Add item</button>
              </div>
              <div className="text-xs mb-1 grid gap-1" style={{ gridTemplateColumns: '1fr 60px 90px 80px 24px', color: 'var(--color-muted)' }}>
                <span>Description</span><span>Qty</span><span>Unit Price</span><span className="text-center">Tax</span><span />
              </div>
              <div className="flex flex-col gap-2">
                {form.items.map((item, idx) => (
                  <div key={idx} className="grid gap-1 items-start" style={{ gridTemplateColumns: '1fr 60px 90px 80px 24px' }}>
                    <div className="flex flex-col gap-1">
                      <Textarea value={item.description} onChange={v => setItem(idx, 'description', v)} placeholder="Description" rows={2} />
                      <TxCodeSelect value={item.txCodeId} onChange={v => setItem(idx, 'txCodeId', v)} type="income" placeholder="— income code —" />
                    </div>
                    <input
                      type="number" min="1" step="1"
                      value={item.qty}
                      onChange={e => setItem(idx, 'qty', e.target.value.replace(/\./g, ''))}
                      className="text-sm px-3 py-2 rounded-lg border w-full"
                      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }}
                    />
                    <Input value={item.unitPrice}   onChange={v => setItem(idx, 'unitPrice', v)}   type="number" placeholder="0.00" />
                    <div className="flex items-center justify-center pt-2">
                      <select
                        value={item.gstCode || 'GST'}
                        onChange={e => setItem(idx, 'gstCode', e.target.value)}
                        className="text-xs px-1.5 py-1.5 rounded border w-full"
                        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }}
                      >
                        <option value="GST">GST 10%</option>
                        <option value="NT">N-T</option>
                      </select>
                    </div>
                    <button onClick={() => removeItem(idx)} className="text-xs rounded hover:opacity-60 text-center pt-2" style={{ color: '#ef4444' }}>✕</button>
                  </div>
                ))}
              </div>
            </div>

            {/* Totals */}
            <div className="border-t pt-3 flex flex-col items-end gap-1" style={{ borderColor: 'var(--color-border)' }}>
              <div className="flex gap-8 text-sm">
                <span style={{ color: 'var(--color-muted)' }}>Subtotal</span>
                <span style={{ color: 'var(--color-text)', minWidth: 70, textAlign: 'right' }}>{fmt(totals.subtotal)}</span>
              </div>
              <div className="flex gap-8 text-sm">
                <span style={{ color: 'var(--color-muted)' }}>GST (10%)</span>
                <span style={{ color: 'var(--color-text)', minWidth: 70, textAlign: 'right' }}>{fmt(totals.gst)}</span>
              </div>
              <div className="flex gap-8 text-sm font-bold">
                <span style={{ color: 'var(--color-text)' }}>Total</span>
                <span style={{ color: 'var(--color-text)', minWidth: 70, textAlign: 'right' }}>{fmt(totals.total)}</span>
              </div>
            </div>

            <ErrMsg msg={error} />
            <div className="flex gap-2 justify-end">
              <Btn variant="secondary" onClick={() => setModal(null)}>Cancel</Btn>
              <Btn onClick={save} disabled={saving}>
                {saving ? 'Saving…' : (form.docType === 'quote' ? 'Save Quote' : 'Save Invoice')}
              </Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* Send invoice modal */}
      {sendModal && (
        <Modal title={`Send ${sendModal.number}`} onClose={() => setSendModal(null)}>
          <div className="flex flex-col gap-3">
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
              The invoice will be emailed as an HTML document using your MailChannels API key.
            </p>
            <Field label="Recipient email">
              <Input
                type="email"
                value={sendTo}
                onChange={setSendTo}
                placeholder="client@example.com"
              />
            </Field>
            <ErrMsg msg={sendError} />
            <div className="flex gap-2 justify-end pt-1">
              <Btn variant="secondary" onClick={() => setSendModal(null)}>Cancel</Btn>
              <Btn onClick={confirmSend} disabled={sending}>{sending ? 'Sending…' : 'Send Invoice'}</Btn>
            </div>
          </div>
        </Modal>
      )}

      {confirmModal && (
        <ConfirmModal
          title={confirmModal.title || 'Confirm'}
          message={confirmModal.message}
          confirmLabel={confirmModal.confirmLabel || 'Confirm'}
          danger={confirmModal.confirmLabel === 'Delete'}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}

      {paidModal && (
        <Modal title={`Mark ${paidModal.inv.number} as Paid`} onClose={() => setPaidModal(null)}>
          <div className="flex flex-col gap-4">
            <Field label="Date payment was received">
              <Input type="date" value={paidModal.date} onChange={v => setPaidModal(p => ({ ...p, date: v }))} />
            </Field>
            <div className="flex gap-2 justify-end">
              <Btn variant="secondary" onClick={() => setPaidModal(null)}>Cancel</Btn>
              <Btn onClick={confirmMarkPaid}>Mark Paid</Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* Invoice detail */}
      {viewInvoice && (
        <Modal title={viewInvoice.number} onClose={() => setViewInvoice(null)} wide>
          <div className="flex flex-col gap-4 text-sm" style={{ color: 'var(--color-text)' }}>
            <div className="flex justify-between gap-4 flex-wrap">
              <div>
                <div className="font-semibold text-base">{viewInvoice.clientName || 'No client'}</div>
                {viewInvoice.clientAddress && <div className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{viewInvoice.clientAddress}</div>}
                {viewInvoice.clientAbn     && <div className="text-xs" style={{ color: 'var(--color-muted)' }}>ABN {viewInvoice.clientAbn}</div>}
              </div>
              <div className="text-right">
                <StatusBadge status={viewInvoice.status} />
                <div className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Issued {fmtDate(viewInvoice.issueDate)}</div>
                {viewInvoice.dueDate && <div className="text-xs" style={{ color: 'var(--color-muted)' }}>Due {fmtDate(viewInvoice.dueDate)}</div>}
              </div>
            </div>

            <table className="w-full text-sm border-collapse">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  {['Description', 'Qty', 'Unit Price', 'GST', 'Amount'].map(h => (
                    <th key={h} className={`py-1.5 text-xs font-semibold ${h === 'Description' ? 'text-left' : 'text-right'}`} style={{ color: 'var(--color-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(viewInvoice.items || []).map((item, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td className="py-1.5">
                      <span style={{ whiteSpace: 'pre-wrap' }}>{item.description}</span>
                      {item.txCodeId && incomeCodeMap[item.txCodeId] && (
                        <span className="block text-xs font-mono mt-0.5" style={{ color: 'var(--color-muted)' }}>
                          {incomeCodeMap[item.txCodeId].code}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 text-right">{item.qty}</td>
                    <td className="py-1.5 text-right">{fmt(item.unitPrice)}</td>
                    <td className="py-1.5 text-right">
                      {(item.gstCode || (parseFloat(item.gst) > 0 ? 'GST' : 'NT')) === 'NT'
                        ? <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>N-T</span>
                        : fmt(item.gst)}
                    </td>
                    <td className="py-1.5 text-right">{fmt(item.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex flex-col items-end gap-1 border-t pt-2" style={{ borderColor: 'var(--color-border)' }}>
              <div className="flex gap-8"><span style={{ color: 'var(--color-muted)' }}>Subtotal</span><span>{fmt(viewInvoice.subtotal)}</span></div>
              <div className="flex gap-8"><span style={{ color: 'var(--color-muted)' }}>GST</span><span>{fmt(viewInvoice.gst)}</span></div>
              <div className="flex gap-8 font-bold"><span>Total</span><span>{fmt(viewInvoice.total)}</span></div>
            </div>

            {viewInvoice.notes && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{viewInvoice.notes}</p>}

            <div className="flex gap-2 justify-end">
              {viewInvoice.status !== 'paid' && viewInvoice.status !== 'void' && (
                <Btn onClick={() => markPaid(viewInvoice)}>Mark Paid</Btn>
              )}
              <Btn variant="secondary" onClick={() => setViewInvoice(null)}>Close</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Expenses ──────────────────────────────────────────────────────────────────

const BLANK_EXPENSE = { date: '', description: '', amount: '', gstIncluded: true, category: '', supplier: '', txCodeId: null, paidViaId: null };

function ExpensesTab({ from, to }) {
  const [expenses, setExpenses]     = useState([]);
  const [expenseCodes, setExpenseCodes] = useState([]);
  const [paymentAccounts, setPaymentAccounts] = useState([]);
  const [showForm, setShowForm]     = useState(false);
  const [editingExpense, setEditing] = useState(null);
  const [form, setForm]             = useState({ ...BLANK_EXPENSE, date: todayStr() });
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');
  const [confirmModal, setConfirmModal] = useState(null);
  const [ccPayModal, setCcPayModal]     = useState(null);   // { expense, account } — pay CC modal
  const [ccPayDate, setCcPayDate]       = useState(todayStr());
  const [ccPaySaving, setCcPaySaving]   = useState(false);
  const [ccStatement, setCcStatement]   = useState(null);   // { accounts, expenses } — statement modal
  const [ccStmtDate, setCcStmtDate]     = useState(todayStr());
  const [ccStmtAccountId, setCcStmtAccountId] = useState('');
  const [ccStmtSelected, setCcStmtSelected]   = useState(new Set());
  const [ccStmtSaving, setCcStmtSaving] = useState(false);
  const [receiptModal, setReceiptModal] = useState(null);   // { expense } — upload modal
  const [viewReceiptModal, setViewReceiptModal] = useState(null); // { expense, url, isPdf }
  const [receiptUploading, setReceiptUploading] = useState(false);
  const receiptInputRef = useRef(null);
  const addToast = useToastStore(s => s.addToast);

  const autoGst = form.gstIncluded && form.amount
    ? (parseFloat(form.amount) / 11).toFixed(2)
    : '0.00';

  const codeMap    = Object.fromEntries(expenseCodes.map(c => [c.id, c]));
  const accountMap = Object.fromEntries(paymentAccounts.map(a => [a.id, a]));

  const load = useCallback(() => {
    api.get('/api/finance/expenses').then(r => r.json()).then(d => setExpenses(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get('/api/finance/tx-codes?type=expense').then(r => r.json()).then(d => setExpenseCodes(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);
  useEffect(() => {
    api.get('/api/finance/accounts').then(r => r.json())
      .then(d => setPaymentAccounts(Array.isArray(d) ? d.filter(a => a.type === 'asset' || a.type === 'liability') : []))
      .catch(() => {});
  }, []);

  const openNew = () => {
    setEditing(null);
    setForm({ ...BLANK_EXPENSE, date: todayStr() });
    setError('');
    setShowForm(true);
  };

  const openEdit = (exp) => {
    setEditing(exp);
    // amount col stores ex-GST; totalPaid = amount + gst
    const totalPaid = (parseFloat(exp.amount) + parseFloat(exp.gst || 0)).toFixed(2);
    setForm({
      date:        String(exp.date).slice(0, 10),
      description: exp.description,
      amount:      totalPaid,
      gstIncluded: parseFloat(exp.gst) > 0,
      category:    exp.category || '',
      supplier:    exp.supplier || '',
      txCodeId:    exp.txCodeId || null,
      paidViaId:   exp.paidViaId || null,
    });
    setError('');
    setShowForm(true);
  };

  const cancelForm = () => { setShowForm(false); setEditing(null); setError(''); };

  const save = async () => {
    if (!form.description.trim() || !form.amount) { setError('Description and amount required'); return; }
    setSaving(true);
    setError('');
    try {
      if (editingExpense) {
        await api.put(`/api/finance/expenses/${editingExpense.id}`, form);
        addToast('Expense updated');
      } else {
        await api.post('/api/finance/expenses', form);
        addToast('Expense saved');
      }
      load();
      cancelForm();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const del = (exp) => {
    setConfirmModal({
      message: `Delete "${exp.description}"?`,
      onConfirm: async () => {
        setConfirmModal(null);
        await api.delete(`/api/finance/expenses/${exp.id}`);
        setExpenses(prev => prev.filter(e => e.id !== exp.id));
        addToast('Expense deleted');
      },
    });
  };

  const openUploadModal = (exp) => { setReceiptModal({ expense: exp }); };

  const uploadReceipt = async (file) => {
    if (!receiptModal || !file) return;
    setReceiptUploading(true);
    try {
      const fd = new FormData();
      fd.append('receipt', file);
      const res = await api.postForm(`/api/finance/expenses/${receiptModal.expense.id}/receipt`, fd);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      addToast('Receipt uploaded');
      setReceiptModal(null);
      load();
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setReceiptUploading(false);
    }
  };

  const openViewReceipt = async (exp) => {
    try {
      const res = await api.get(`/api/finance/expenses/${exp.id}/receipt`);
      if (!res.ok) { addToast('Receipt not found', 'error'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const isPdf = exp.receipt_path?.toLowerCase().endsWith('.pdf') || blob.type === 'application/pdf';
      setViewReceiptModal({ expense: exp, url, isPdf });
    } catch (e) {
      addToast(e.message, 'error');
    }
  };

  const openCcPay = (exp) => {
    const account = accountMap[exp.paidViaId];
    setCcPayDate(todayStr());
    setCcPayModal({ expense: exp, account });
  };

  const confirmCcPay = async () => {
    if (!ccPayModal) return;
    setCcPaySaving(true);
    try {
      await api.post(`/api/finance/expenses/${ccPayModal.expense.id}/cc-pay`, { date: ccPayDate });
      addToast('CC payment recorded');
      setCcPayModal(null);
      load();
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setCcPaySaving(false);
    }
  };

  const openCcStatement = () => {
    const unsettled = expenses.filter(e => e.paidViaId && accountMap[e.paidViaId]?.type === 'liability' && !e.ccSettled);
    if (!unsettled.length) return;
    const ccAccounts = [...new Map(unsettled.map(e => [e.paidViaId, accountMap[e.paidViaId]])).entries()]
      .map(([, a]) => a).filter(Boolean);
    const firstId = String(ccAccounts[0]?.id || '');
    setCcStmtDate(todayStr());
    setCcStmtAccountId(firstId);
    setCcStmtSelected(new Set(unsettled.filter(e => String(e.paidViaId) === firstId).map(e => e.id)));
    setCcStatement({ accounts: ccAccounts, expenses: unsettled });
  };

  const confirmCcStatement = async () => {
    if (!ccStatement) return;
    const ids = [...ccStmtSelected];
    if (!ids.length) return;
    setCcStmtSaving(true);
    try {
      const res = await api.post('/api/finance/expenses/cc-statement-pay', {
        accountId: parseInt(ccStmtAccountId),
        date: ccStmtDate,
        expenseIds: ids,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      addToast(`CC statement paid — ${data.count} item${data.count > 1 ? 's' : ''}, ${fmt(data.total)}`);
      setCcStatement(null);
      load();
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setCcStmtSaving(false);
    }
  };

  const removeReceipt = (exp) => {
    setConfirmModal({
      message: `Remove receipt for "${exp.description}"?`,
      onConfirm: async () => {
        setConfirmModal(null);
        await api.delete(`/api/finance/expenses/${exp.id}/receipt`);
        addToast('Receipt removed');
        if (viewReceiptModal?.expense?.id === exp.id) {
          URL.revokeObjectURL(viewReceiptModal.url);
          setViewReceiptModal(null);
        }
        load();
      },
    });
  };

  return (
    <div data-tour="finance-expenses" className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold" style={{ color: 'var(--color-text)' }}>Expenses</h2>
        <div className="flex gap-2">
          {expenses.some(e => e.paidViaId && accountMap[e.paidViaId]?.type === 'liability' && !e.ccSettled) && (
            <Btn variant="secondary" onClick={openCcStatement}>Pay CC Statement</Btn>
          )}
          <Btn onClick={showForm ? cancelForm : openNew}>{showForm ? 'Cancel' : '+ Add Expense'}</Btn>
        </div>
      </div>

      {showForm && (
        <div className="mb-5 p-4 rounded-xl border" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <Field label="Date"><Input type="date" value={form.date} onChange={v => setForm(p => ({...p, date: v}))} /></Field>
            <Field label="Supplier"><SupplierInput value={form.supplier} onChange={v => setForm(p => ({...p, supplier: v}))} /></Field>
            <div className="col-span-2">
              <Field label="Description"><Textarea value={form.description} onChange={v => setForm(p => ({...p, description: v}))} placeholder="What was purchased" rows={2} /></Field>
            </div>
            <Field label="Category"><CategoryInput value={form.category} onChange={v => setForm(p => ({...p, category: v}))} /></Field>
            <Field label="Expense Code">
              <TxCodeSelect value={form.txCodeId} onChange={v => setForm(p => ({...p, txCodeId: v}))} type="expense" placeholder="— select code —" />
            </Field>
            <Field label="Paid via">
              <select
                value={form.paidViaId || ''}
                onChange={e => setForm(p => ({...p, paidViaId: e.target.value ? parseInt(e.target.value) : null}))}
                className="text-sm px-3 py-2 rounded-lg border w-full"
                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                <option value="">Bank / Cash (default)</option>
                {paymentAccounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
              </select>
            </Field>
            <Field label="Total Amount Paid ($)">
              <Input type="number" value={form.amount} onChange={v => setForm(p => ({...p, amount: v}))} placeholder="0.00" />
            </Field>
            <Field label="GST">
              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="exp-gst"
                  checked={form.gstIncluded}
                  onChange={e => setForm(p => ({...p, gstIncluded: e.target.checked}))}
                />
                <label htmlFor="exp-gst" className="text-sm" style={{ color: 'var(--color-text)' }}>GST Included (10%)</label>
                {form.gstIncluded && form.amount && (
                  <span className="text-xs ml-2" style={{ color: 'var(--color-muted)' }}>GST = ${autoGst}</span>
                )}
              </div>
            </Field>
          </div>
          <ErrMsg msg={error} />
          <div className="mt-2 flex gap-2">
            <Btn onClick={save} disabled={saving}>{saving ? 'Saving…' : editingExpense ? 'Update Expense' : 'Save Expense'}</Btn>
          </div>
        </div>
      )}

      {expenses.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No expenses recorded.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
                {['Date', 'Description', 'Supplier', 'Ex-GST', 'GST', 'Total', 'Category', 'Code', 'Paid via', '', ''].map(h => (
                  <th key={h} className="text-left py-2 px-2 text-xs font-semibold" style={{ color: 'var(--color-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {expenses.filter(e => {
                const d = String(e.date).slice(0, 10);
                if (from && d < from) return false;
                if (to   && d > to)   return false;
                return true;
              }).map(e => (
                <tr key={e.id} className="border-b hover:opacity-80" style={{ borderColor: 'var(--color-border)' }}>
                  <td className="py-2 px-2 text-xs whitespace-nowrap" style={{ color: 'var(--color-muted)' }}>{fmtDate(e.date)}</td>
                  <td className="py-2 px-2" style={{ color: 'var(--color-text)' }}>{e.description}</td>
                  <td className="py-2 px-2 text-xs" style={{ color: 'var(--color-muted)' }}>{e.supplier || '—'}</td>
                  <td className="py-2 px-2 font-medium" style={{ color: 'var(--color-text)' }}>{fmt(e.amount)}</td>
                  <td className="py-2 px-2" style={{ color: 'var(--color-muted)' }}>{fmt(e.gst)}</td>
                  <td className="py-2 px-2 font-medium" style={{ color: 'var(--color-text)' }}>{fmt(parseFloat(e.amount) + parseFloat(e.gst || 0))}</td>
                  <td className="py-2 px-2 text-xs" style={{ color: 'var(--color-muted)' }}>{e.category || '—'}</td>
                  <td className="py-2 px-2 text-xs font-mono" style={{ color: 'var(--color-muted)' }}>
                    {e.txCodeId && codeMap[e.txCodeId] ? codeMap[e.txCodeId].code : '—'}
                  </td>
                  <td className="py-2 px-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                    {e.paidViaId && accountMap[e.paidViaId] ? accountMap[e.paidViaId].name : 'Bank / Cash'}
                  </td>
                  <td className="py-2 px-1">
                    <button
                      onClick={() => e.receipt_path ? openViewReceipt(e) : openUploadModal(e)}
                      title={e.receipt_path ? 'View receipt' : 'Attach receipt'}
                      className="text-sm hover:opacity-60 transition-opacity"
                      style={{ color: e.receipt_path ? '#f59e0b' : 'var(--color-muted)' }}
                    >📎</button>
                  </td>
                  <td className="py-2 px-2">
                    <div className="flex gap-2">
                      {e.paidViaId && accountMap[e.paidViaId]?.type === 'liability' && !e.ccSettled && (
                        <button onClick={() => openCcPay(e)} className="text-xs hover:opacity-60" style={{ color: '#f59e0b' }} title="Record payment of this card charge from bank">Pay CC</button>
                      )}
                      {e.ccSettled && (
                        <button
                          className="text-xs hover:opacity-60"
                          style={{ color: '#065f46' }}
                          title="Unsettle — removes the settled flag only. Reverse the journal entry manually in the Journal tab if the amount was wrong."
                          onClick={() => setConfirmModal({
                            message: 'Unsettle this expense? The settlement journal entry is NOT reversed — delete it manually in the Journal tab if the amount was wrong.',
                            onConfirm: async () => {
                              setConfirmModal(null);
                              try {
                                await api.post(`/api/finance/expenses/${e.id}/cc-unsettle`);
                                addToast('Expense unsettled');
                                load();
                              } catch (err) {
                                addToast(err.message, 'error');
                              }
                            },
                          })}
                        >Settled ↩</button>
                      )}
                      <button onClick={() => openEdit(e)} className="text-xs hover:opacity-60" style={{ color: 'var(--color-primary)' }}>Edit</button>
                      <button onClick={() => del(e)} className="text-xs hover:opacity-60" style={{ color: '#ef4444' }}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirmModal && (
        <ConfirmModal
          title="Confirm"
          message={confirmModal.message}
          confirmLabel="Delete"
          danger
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}

      {/* Pay CC modal */}
      {ccPayModal && (
        <Modal title="Record Credit Card Payment" onClose={() => setCcPayModal(null)}>
          <div className="flex flex-col gap-4">
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
              This will post a journal entry to clear <strong>{ccPayModal.account?.name}</strong> and debit <strong>Bank / Cash</strong> for{' '}
              <strong>{fmt(parseFloat(ccPayModal.expense.amount) + parseFloat(ccPayModal.expense.gst || 0))}</strong>.
            </p>
            <Field label="Payment Date">
              <Input type="date" value={ccPayDate} onChange={setCcPayDate} />
            </Field>
            <div className="rounded-lg p-3 text-xs font-mono flex flex-col gap-1" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
              <div className="flex justify-between"><span>DR {ccPayModal.account?.code} — {ccPayModal.account?.name}</span><span>{fmt(parseFloat(ccPayModal.expense.amount) + parseFloat(ccPayModal.expense.gst || 0))}</span></div>
              <div className="flex justify-between"><span>CR 1000 — Bank / Cash</span><span>{fmt(parseFloat(ccPayModal.expense.amount) + parseFloat(ccPayModal.expense.gst || 0))}</span></div>
            </div>
            <div className="flex gap-2 justify-end">
              <Btn variant="secondary" onClick={() => setCcPayModal(null)}>Cancel</Btn>
              <Btn onClick={confirmCcPay} disabled={ccPaySaving}>{ccPaySaving ? 'Posting…' : 'Post Entry'}</Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* Pay CC Statement modal */}
      {ccStatement && (() => {
        const filteredExpenses = ccStatement.expenses.filter(e => String(e.paidViaId) === ccStmtAccountId);
        const selectedTotal = filteredExpenses
          .filter(e => ccStmtSelected.has(e.id))
          .reduce((s, e) => s + parseFloat(e.amount) + parseFloat(e.gst || 0), 0);
        const toggleAll = (checked) => {
          setCcStmtSelected(checked ? new Set(filteredExpenses.map(e => e.id)) : new Set());
        };
        const toggleOne = (id, checked) => {
          setCcStmtSelected(prev => {
            const next = new Set(prev);
            checked ? next.add(id) : next.delete(id);
            return next;
          });
        };
        return (
          <Modal title="Pay CC Statement" wide onClose={() => setCcStatement(null)}>
            <div className="flex flex-col gap-4">
              {ccStatement.accounts.length > 1 && (
                <Field label="Credit Card Account">
                  <Sel value={ccStmtAccountId} onChange={v => {
                    setCcStmtAccountId(v);
                    const next = ccStatement.expenses.filter(e => String(e.paidViaId) === v);
                    setCcStmtSelected(new Set(next.map(e => e.id)));
                  }}>
                    {ccStatement.accounts.map(a => (
                      <option key={a.id} value={String(a.id)}>{a.code} — {a.name}</option>
                    ))}
                  </Sel>
                </Field>
              )}
              <Field label="Payment Date">
                <Input type="date" value={ccStmtDate} onChange={setCcStmtDate} />
              </Field>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>
                    Unsettled items ({filteredExpenses.length})
                  </span>
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--color-muted)' }}>
                    <input type="checkbox"
                      checked={filteredExpenses.length > 0 && filteredExpenses.every(e => ccStmtSelected.has(e.id))}
                      onChange={e => toggleAll(e.target.checked)}
                    />
                    Select all
                  </label>
                </div>
                <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ background: 'var(--color-surface)' }}>
                        <th className="w-8 px-3 py-2"></th>
                        <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--color-muted)' }}>Date</th>
                        <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--color-muted)' }}>Description</th>
                        <th className="text-right px-3 py-2 font-medium" style={{ color: 'var(--color-muted)' }}>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredExpenses.map(e => {
                        const total = parseFloat(e.amount) + parseFloat(e.gst || 0);
                        return (
                          <tr key={e.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                            <td className="px-3 py-2 text-center">
                              <input type="checkbox"
                                checked={ccStmtSelected.has(e.id)}
                                onChange={ev => toggleOne(e.id, ev.target.checked)}
                              />
                            </td>
                            <td className="px-3 py-2" style={{ color: 'var(--color-muted)' }}>{fmtDate(e.date)}</td>
                            <td className="px-3 py-2" style={{ color: 'var(--color-text)' }}>{e.description}</td>
                            <td className="px-3 py-2 text-right font-mono" style={{ color: 'var(--color-text)' }}>{fmt(total)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="rounded-lg p-3 text-xs font-mono flex flex-col gap-1" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                <div className="flex justify-between">
                  <span>DR {ccStatement.accounts.find(a => String(a.id) === ccStmtAccountId)?.code} — {ccStatement.accounts.find(a => String(a.id) === ccStmtAccountId)?.name}</span>
                  <span>{fmt(selectedTotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span>CR 1000 — Bank / Cash</span>
                  <span>{fmt(selectedTotal)}</span>
                </div>
              </div>
              <div className="flex gap-2 justify-between items-center">
                <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  Total: {fmt(selectedTotal)} ({[...ccStmtSelected].filter(id => filteredExpenses.find(e => e.id === id)).length} items)
                </span>
                <div className="flex gap-2">
                  <Btn variant="secondary" onClick={() => setCcStatement(null)}>Cancel</Btn>
                  <Btn onClick={confirmCcStatement} disabled={ccStmtSaving || ccStmtSelected.size === 0}>
                    {ccStmtSaving ? 'Posting…' : 'Post Payment'}
                  </Btn>
                </div>
              </div>
            </div>
          </Modal>
        );
      })()}

      {/* Upload receipt modal */}
      {receiptModal && (
        <Modal title="Attach Receipt" onClose={() => setReceiptModal(null)}>
          <div className="flex flex-col gap-3">
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
              Upload a receipt for "{receiptModal.expense.description}". Accepted: JPG, PNG, GIF, WebP, PDF (max 5 MB).
            </p>
            <input
              ref={receiptInputRef}
              type="file"
              accept="image/*,.pdf"
              style={{ display: 'none' }}
              onChange={e => { if (e.target.files[0]) uploadReceipt(e.target.files[0]); }}
            />
            <div
              className="flex flex-col items-center justify-center gap-2 p-6 rounded-xl border-2 border-dashed cursor-pointer hover:opacity-70 transition-opacity"
              style={{ borderColor: 'var(--color-border)' }}
              onClick={() => receiptInputRef.current?.click()}
              onDrop={e => { e.preventDefault(); if (e.dataTransfer.files[0]) uploadReceipt(e.dataTransfer.files[0]); }}
              onDragOver={e => e.preventDefault()}
            >
              <span className="text-2xl">📎</span>
              <span className="text-sm" style={{ color: 'var(--color-muted)' }}>
                {receiptUploading ? 'Uploading…' : 'Click or drag & drop a file'}
              </span>
            </div>
            <div className="flex justify-end">
              <Btn variant="secondary" onClick={() => setReceiptModal(null)}>Cancel</Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* View receipt modal */}
      {viewReceiptModal && (
        <Modal title={`Receipt — ${viewReceiptModal.expense.description}`} onClose={() => { URL.revokeObjectURL(viewReceiptModal.url); setViewReceiptModal(null); }} wide>
          <div className="flex flex-col gap-3">
            {viewReceiptModal.isPdf ? (
              <iframe src={viewReceiptModal.url} title="Receipt" className="w-full rounded border" style={{ height: 500, borderColor: 'var(--color-border)' }} />
            ) : (
              <img src={viewReceiptModal.url} alt="Receipt" className="w-full rounded border object-contain" style={{ maxHeight: 500, borderColor: 'var(--color-border)' }} />
            )}
            <div className="flex gap-2 justify-between">
              <button
                onClick={() => removeReceipt(viewReceiptModal.expense)}
                className="text-xs px-2 py-1 rounded border hover:opacity-70"
                style={{ color: '#ef4444', borderColor: '#fca5a5' }}
              >Remove Receipt</button>
              <Btn variant="secondary" onClick={() => { URL.revokeObjectURL(viewReceiptModal.url); setViewReceiptModal(null); }}>Close</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Wages ─────────────────────────────────────────────────────────────────────

function WagesTab({ from, to }) {
  const [wages, setWages]       = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]         = useState({ date: todayStr(), employee: '', gross: '', tax: '', superannuation: '', net: '' });
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [confirmModal, setConfirmModal] = useState(null);
  const addToast = useToastStore(s => s.addToast);

  const load = useCallback(() => {
    api.get('/api/finance/wages').then(r => r.json()).then(d => setWages(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleGrossChange = (v) => {
    const tax = parseFloat(form.tax) || 0;
    setForm(p => ({ ...p, gross: v, net: String(((parseFloat(v) || 0) - tax).toFixed(2)) }));
  };
  const handleTaxChange = (v) => {
    const gross = parseFloat(form.gross) || 0;
    setForm(p => ({ ...p, tax: v, net: String((gross - (parseFloat(v) || 0)).toFixed(2)) }));
  };

  const save = async () => {
    if (!form.employee.trim() || !form.gross) { setError('Employee and gross required'); return; }
    setSaving(true);
    setError('');
    try {
      await api.post('/api/finance/wages', { ...form, superAmount: form.superannuation });
      load();
      setForm({ date: todayStr(), employee: '', gross: '', tax: '', superannuation: '', net: '' });
      setShowForm(false);
      addToast('Wage entry saved');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const del = (wage) => {
    setConfirmModal({
      message: `Delete wage entry for ${wage.employee}?`,
      onConfirm: async () => {
        setConfirmModal(null);
        await api.delete(`/api/finance/wages/${wage.id}`);
        setWages(prev => prev.filter(w => w.id !== wage.id));
        addToast('Wage entry deleted');
      },
    });
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold" style={{ color: 'var(--color-text)' }}>Wages</h2>
        <Btn onClick={() => { setShowForm(v => !v); setError(''); }}>{showForm ? 'Cancel' : '+ Add Wages'}</Btn>
      </div>

      {showForm && (
        <div className="mb-5 p-4 rounded-xl border" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <Field label="Date"><Input type="date" value={form.date} onChange={v => setForm(p => ({...p, date: v}))} /></Field>
            <Field label="Employee"><Input value={form.employee} onChange={v => setForm(p => ({...p, employee: v}))} placeholder="Employee name" /></Field>
            <Field label="Gross ($)"><Input type="number" value={form.gross} onChange={handleGrossChange} placeholder="0.00" /></Field>
            <Field label="Tax Withheld ($)"><Input type="number" value={form.tax} onChange={handleTaxChange} placeholder="0.00" /></Field>
            <Field label="Superannuation ($)"><Input type="number" value={form.superannuation} onChange={v => setForm(p => ({...p, superannuation: v}))} placeholder="0.00" /></Field>
            <Field label="Net Pay ($)"><Input type="number" value={form.net} onChange={v => setForm(p => ({...p, net: v}))} placeholder="0.00" /></Field>
          </div>
          <ErrMsg msg={error} />
          <div className="mt-2"><Btn onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Wages'}</Btn></div>
        </div>
      )}

      {wages.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No wage entries.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
                {['Date', 'Employee', 'Gross', 'Tax', 'Super', 'Net', ''].map(h => (
                  <th key={h} className="text-left py-2 px-2 text-xs font-semibold" style={{ color: 'var(--color-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {wages.filter(w => {
                const d = String(w.date).slice(0, 10);
                if (from && d < from) return false;
                if (to   && d > to)   return false;
                return true;
              }).map(w => (
                <tr key={w.id} className="border-b hover:opacity-80" style={{ borderColor: 'var(--color-border)' }}>
                  <td className="py-2 px-2 text-xs whitespace-nowrap" style={{ color: 'var(--color-muted)' }}>{fmtDate(w.date)}</td>
                  <td className="py-2 px-2" style={{ color: 'var(--color-text)' }}>{w.employee}</td>
                  <td className="py-2 px-2 font-medium" style={{ color: 'var(--color-text)' }}>{fmt(w.gross)}</td>
                  <td className="py-2 px-2" style={{ color: 'var(--color-muted)' }}>{fmt(w.tax)}</td>
                  <td className="py-2 px-2" style={{ color: 'var(--color-muted)' }}>{fmt(w.superannuation)}</td>
                  <td className="py-2 px-2 font-medium" style={{ color: 'var(--color-text)' }}>{fmt(w.net)}</td>
                  <td className="py-2 px-2">
                    <button onClick={() => del(w)} className="text-xs hover:opacity-60" style={{ color: '#ef4444' }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirmModal && (
        <ConfirmModal
          title="Delete Wage Entry"
          message={confirmModal.message}
          confirmLabel="Delete"
          danger
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}
    </div>
  );
}

// ── Interest Income ───────────────────────────────────────────────────────────

function InterestTab({ from, to }) {
  const [entries, setEntries]   = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]         = useState({ date: todayStr(), amount: '', description: 'Bank interest' });
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [confirmModal, setConfirmModal] = useState(null);
  const addToast = useToastStore(s => s.addToast);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to)   params.set('to', to);
    api.get(`/api/finance/interest?${params}`)
      .then(r => r.json())
      .then(d => setEntries(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form.amount || parseFloat(form.amount) <= 0) { setError('Valid amount required'); return; }
    setSaving(true); setError('');
    try {
      const res  = await api.post('/api/finance/interest', form);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      addToast('Interest recorded');
      setForm({ date: todayStr(), amount: '', description: 'Bank interest' });
      setShowForm(false);
      load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const del = (entry) => {
    setConfirmModal({
      message: `Delete interest entry "${entry.description}" (${fmt(entry.amount)})?`,
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await api.delete(`/api/finance/interest/${entry.id}`);
          addToast('Entry deleted');
          load();
        } catch (e) { addToast(e.message, 'error'); }
      },
    });
  };

  const total = entries.reduce((s, e) => s + parseFloat(e.amount), 0);

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-semibold" style={{ color: 'var(--color-text)' }}>Interest Income</h2>
          {entries.length > 0 && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
              {entries.length} entr{entries.length === 1 ? 'y' : 'ies'} · total {fmt(total)}
            </p>
          )}
        </div>
        <Btn onClick={() => { setShowForm(p => !p); setError(''); }}>
          {showForm ? 'Cancel' : '+ Record Interest'}
        </Btn>
      </div>

      {showForm && (
        <div className="mb-5 p-4 rounded-xl border" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <Field label="Date"><Input type="date" value={form.date} onChange={v => setForm(p => ({ ...p, date: v }))} /></Field>
            <Field label="Amount (AUD)"><Input type="number" value={form.amount} onChange={v => setForm(p => ({ ...p, amount: v }))} placeholder="0.00" /></Field>
            <div className="col-span-2">
              <Field label="Description"><Input value={form.description} onChange={v => setForm(p => ({ ...p, description: v }))} placeholder="Bank interest" /></Field>
            </div>
          </div>
          <div className="rounded-lg p-3 text-xs font-mono flex flex-col gap-1 mb-3" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
            <div className="flex justify-between"><span>DR 1000 — Bank / Cash</span><span>{form.amount ? fmt(parseFloat(form.amount)) : '—'}</span></div>
            <div className="flex justify-between"><span>CR 4100 — Interest Income</span><span>{form.amount ? fmt(parseFloat(form.amount)) : '—'}</span></div>
          </div>
          <ErrMsg msg={error} />
          <div className="flex justify-end mt-2">
            <Btn onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Post Entry'}</Btn>
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No interest entries yet.</p>
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr style={{ background: 'var(--color-surface)' }}>
                <th className="text-left px-4 py-2 text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Date</th>
                <th className="text-left px-4 py-2 text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Description</th>
                <th className="text-right px-4 py-2 text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Amount</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                  <td className="px-4 py-2 text-xs" style={{ color: 'var(--color-muted)' }}>{fmtDate(e.date)}</td>
                  <td className="px-4 py-2" style={{ color: 'var(--color-text)' }}>{e.description}</td>
                  <td className="px-4 py-2 text-right font-mono text-sm" style={{ color: '#065f46' }}>{fmt(e.amount)}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => del(e)} className="text-xs hover:opacity-60" style={{ color: '#ef4444' }}>Delete</button>
                  </td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid var(--color-border)', background: 'var(--color-surface)' }}>
                <td colSpan={2} className="px-4 py-2 text-xs font-semibold text-right" style={{ color: 'var(--color-muted)' }}>Total</td>
                <td className="px-4 py-2 text-right font-mono font-semibold" style={{ color: '#065f46' }}>{fmt(total)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {confirmModal && (
        <ConfirmModal message={confirmModal.message} onConfirm={confirmModal.onConfirm} onCancel={() => setConfirmModal(null)} />
      )}
    </div>
  );
}

// ── Accounts ─────────────────────────────────────────────────────────────────

const ACCOUNT_TYPES = ['asset','liability','equity','income','expense'];
const BLANK_ACCOUNT = { code: '', name: '', type: 'liability' };

function AccountsTab() {
  const [accounts, setAccounts]   = useState([]);
  const [showForm, setShowForm]   = useState(false);
  const [editing, setEditing]     = useState(null);
  const [form, setForm]           = useState({ ...BLANK_ACCOUNT });
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [confirmModal, setConfirmModal] = useState(null);
  const addToast = useToastStore(s => s.addToast);

  const load = useCallback(() => {
    api.get('/api/finance/accounts').then(r => r.json()).then(d => setAccounts(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const openNew   = () => { setEditing(null); setForm({ ...BLANK_ACCOUNT }); setError(''); setShowForm(true); };
  const openEdit  = (a) => { if (a.isSystem) return; setEditing(a); setForm({ code: a.code, name: a.name, type: a.type }); setError(''); setShowForm(true); };
  const cancelForm = () => { setShowForm(false); setEditing(null); setError(''); };

  const save = async () => {
    if (!form.code.trim() || !form.name.trim()) { setError('Code and name required'); return; }
    setSaving(true); setError('');
    try {
      if (editing) {
        await api.put(`/api/finance/accounts/${editing.id}`, form);
        addToast('Account updated');
      } else {
        await api.post('/api/finance/accounts', form);
        addToast('Account added');
      }
      load(); cancelForm();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const del = (a) => {
    if (a.isSystem) return;
    setConfirmModal({
      message: `Delete account "${a.code} — ${a.name}"? This will fail if the account has journal entries.`,
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await api.delete(`/api/finance/accounts/${a.id}`);
          setAccounts(prev => prev.filter(x => x.id !== a.id));
          addToast('Account deleted');
        } catch (e) { addToast(e.message, 'error'); }
      },
    });
  };

  const af = k => v => setForm(p => ({ ...p, [k]: v }));
  const visible = accounts.filter(a => typeFilter === 'all' || a.type === typeFilter);
  const typeGroups = ACCOUNT_TYPES.reduce((g, t) => { g[t] = visible.filter(a => a.type === t); return g; }, {});

  const typeBadgeColor = { asset: '#dbeafe', liability: '#fee2e2', equity: '#f3e8ff', income: '#d1fae5', expense: '#fef3c7' };
  const typeBadgeText  = { asset: '#1e40af', liability: '#991b1b', equity: '#6d28d9', income: '#065f46', expense: '#92400e' };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold" style={{ color: 'var(--color-text)' }}>Chart of Accounts</h2>
        <Btn onClick={showForm ? cancelForm : openNew}>{showForm ? 'Cancel' : '+ Add Account'}</Btn>
      </div>

      <div className="flex gap-1 mb-4 flex-wrap">
        {[['all','All'], ...ACCOUNT_TYPES.map(t => [t, t.charAt(0).toUpperCase() + t.slice(1)])].map(([k,l]) => (
          <button key={k} onClick={() => setTypeFilter(k)}
            className="text-xs px-3 py-1 rounded-full font-medium transition-colors"
            style={{ background: typeFilter === k ? 'var(--color-primary)' : 'transparent', color: typeFilter === k ? '#fff' : 'var(--color-muted)', border: '1px solid var(--color-border)' }}
          >{l}</button>
        ))}
      </div>

      {showForm && (
        <div className="mb-5 p-4 rounded-xl border" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <Field label="Code *"><Input value={form.code} onChange={af('code')} placeholder="2100" /></Field>
            <Field label="Type">
              <Sel value={form.type} onChange={af('type')}>
                {ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </Sel>
            </Field>
            <div className="col-span-1" style={{ gridColumn: 'span 1' }}>
              {/* spacer */}
            </div>
            <div className="col-span-3">
              <Field label="Account Name *"><Input value={form.name} onChange={af('name')} placeholder="e.g. Owner Loan" /></Field>
            </div>
          </div>
          <ErrMsg msg={error} />
          <div className="flex gap-2 mt-2">
            <Btn onClick={save} disabled={saving}>{saving ? 'Saving…' : editing ? 'Update' : 'Add Account'}</Btn>
          </div>
        </div>
      )}

      {ACCOUNT_TYPES.filter(t => typeFilter === 'all' || t === typeFilter).map(t => {
        const group = typeGroups[t];
        if (!group.length) return null;
        return (
          <div key={t} className="mb-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
                style={{ background: typeBadgeColor[t], color: typeBadgeText[t] }}>
                {t}
              </span>
            </div>
            <table className="w-full text-sm border-collapse">
              <tbody>
                {group.map(a => (
                  <tr key={a.id} className="border-b hover:opacity-80" style={{ borderColor: 'var(--color-border)' }}>
                    <td className="py-2 px-2 font-mono text-xs w-20" style={{ color: 'var(--color-muted)' }}>{a.code}</td>
                    <td className="py-2 px-2 font-medium" style={{ color: 'var(--color-text)' }}>
                      {a.name}
                      {a.isSystem && <span className="ml-2 text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>system</span>}
                    </td>
                    <td className="py-2 px-2 text-right">
                      {!a.isSystem && (
                        <div className="flex gap-2 justify-end">
                          <button onClick={() => openEdit(a)} className="text-xs hover:opacity-60" style={{ color: 'var(--color-primary)' }}>Edit</button>
                          <button onClick={() => del(a)} className="text-xs hover:opacity-60" style={{ color: '#ef4444' }}>Delete</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      {confirmModal && (
        <ConfirmModal title="Confirm" message={confirmModal.message} confirmLabel="Delete" danger
          onConfirm={confirmModal.onConfirm} onCancel={() => setConfirmModal(null)} />
      )}
    </div>
  );
}

// ── Journal ───────────────────────────────────────────────────────────────────

const BLANK_JOURNAL_LINE = { accountId: '', debit: '', credit: '' };

function JournalTab({ from, to }) {
  const [entries, setEntries]   = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]         = useState({ date: todayStr(), description: '', lines: [{ ...BLANK_JOURNAL_LINE }, { ...BLANK_JOURNAL_LINE }] });
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [confirmModal, setConfirmModal] = useState(null);
  const addToast = useToastStore(s => s.addToast);

  const loadEntries = useCallback(() => {
    api.get('/api/finance/journal')
      .then(r => r.json())
      .then(d => setEntries(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadEntries(); }, [loadEntries]);
  useEffect(() => {
    api.get('/api/finance/accounts').then(r => r.json()).then(d => setAccounts(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  const setLine = (idx, key, val) => setForm(p => ({
    ...p,
    lines: p.lines.map((l, i) => i === idx ? { ...l, [key]: val } : l),
  }));
  const addLine    = () => setForm(p => ({ ...p, lines: [...p.lines, { ...BLANK_JOURNAL_LINE }] }));
  const removeLine = (idx) => setForm(p => ({ ...p, lines: p.lines.filter((_, i) => i !== idx) }));

  const totalDebits  = form.lines.reduce((s, l) => s + (parseFloat(l.debit)  || 0), 0);
  const totalCredits = form.lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const balanced     = Math.abs(totalDebits - totalCredits) < 0.01;

  const cancelForm = () => {
    setShowForm(false);
    setForm({ date: todayStr(), description: '', lines: [{ ...BLANK_JOURNAL_LINE }, { ...BLANK_JOURNAL_LINE }] });
    setError('');
  };

  const save = async () => {
    if (!form.description.trim()) { setError('Description required'); return; }
    const lines = form.lines.filter(l => l.accountId && (parseFloat(l.debit) > 0 || parseFloat(l.credit) > 0));
    if (lines.length < 2) { setError('At least two lines with an account and amount required'); return; }
    if (!balanced) { setError(`Entry is not balanced — debits ${fmt(totalDebits)}, credits ${fmt(totalCredits)}`); return; }
    setSaving(true); setError('');
    try {
      await api.post('/api/finance/journal', {
        date: form.date,
        description: form.description,
        lines: lines.map(l => ({ accountId: parseInt(l.accountId), debit: parseFloat(l.debit) || 0, credit: parseFloat(l.credit) || 0 })),
      });
      addToast('Journal entry recorded');
      loadEntries();
      cancelForm();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const delEntry = (entry) => {
    if (entry.type !== 'manual') return;
    setConfirmModal({
      message: `Delete journal entry "${entry.description}"?`,
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await api.delete(`/api/finance/journal/${entry.id}`);
          setEntries(prev => prev.filter(e => e.id !== entry.id));
          addToast('Entry deleted');
        } catch (e) { addToast(e.message, 'error'); }
      },
    });
  };

  if (loading) return <div className="p-6 text-sm" style={{ color: 'var(--color-muted)' }}>Loading...</div>;

  return (
    <div data-tour="finance-journal" className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold" style={{ color: 'var(--color-text)' }}>Journal</h2>
        <Btn onClick={showForm ? cancelForm : () => setShowForm(true)}>{showForm ? 'Cancel' : '+ Manual Entry'}</Btn>
      </div>

      {showForm && (
        <div className="mb-6 p-4 rounded-xl border" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <Field label="Date"><Input type="date" value={form.date} onChange={v => setForm(p => ({...p, date: v}))} /></Field>
            <div className="col-span-2">
              <Field label="Description"><Input value={form.description} onChange={v => setForm(p => ({...p, description: v}))} placeholder="e.g. Loan repayment — owner loan settlement" /></Field>
            </div>
          </div>

          <div className="mb-2">
            <div className="grid text-xs font-semibold mb-1 gap-2" style={{ gridTemplateColumns: '1fr 100px 100px 24px', color: 'var(--color-muted)' }}>
              <span>Account</span><span className="text-right">Debit</span><span className="text-right">Credit</span><span />
            </div>
            <div className="flex flex-col gap-1.5">
              {form.lines.map((line, idx) => (
                <div key={idx} className="grid gap-2 items-center" style={{ gridTemplateColumns: '1fr 100px 100px 24px' }}>
                  <select
                    value={line.accountId}
                    onChange={e => setLine(idx, 'accountId', e.target.value)}
                    className="text-sm px-2 py-1.5 rounded-lg border w-full"
                    style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  >
                    <option value="">— select account —</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                  </select>
                  <input
                    type="number" min="0" step="0.01" placeholder="0.00"
                    value={line.debit}
                    onChange={e => setLine(idx, 'debit', e.target.value)}
                    className="text-sm px-2 py-1.5 rounded-lg border text-right w-full"
                    style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }}
                  />
                  <input
                    type="number" min="0" step="0.01" placeholder="0.00"
                    value={line.credit}
                    onChange={e => setLine(idx, 'credit', e.target.value)}
                    className="text-sm px-2 py-1.5 rounded-lg border text-right w-full"
                    style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }}
                  />
                  <button onClick={() => removeLine(idx)} className="text-xs hover:opacity-60 text-center" style={{ color: '#ef4444' }}>✕</button>
                </div>
              ))}
            </div>
            <button onClick={addLine} className="mt-2 text-xs hover:opacity-70" style={{ color: 'var(--color-primary)' }}>+ Add line</button>
          </div>

          <div className="flex justify-end gap-6 text-xs mb-3 font-mono" style={{ color: balanced ? '#065f46' : '#ef4444' }}>
            <span>Debits: {fmt(totalDebits)}</span>
            <span>Credits: {fmt(totalCredits)}</span>
            <span>{balanced ? '✓ Balanced' : '✗ Not balanced'}</span>
          </div>

          <ErrMsg msg={error} />
          <div className="flex gap-2 mt-2">
            <Btn onClick={save} disabled={saving || !balanced}>{saving ? 'Saving…' : 'Post Entry'}</Btn>
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          No journal entries yet. Entries are auto-generated when invoices, expenses, and wages are recorded.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {entries.filter(entry => {
            const d = String(entry.date).slice(0, 10);
            if (from && d < from) return false;
            if (to   && d > to)   return false;
            return true;
          }).map(entry => (
            <div key={entry.id} className="p-3 rounded-xl border" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
              <div className="flex items-start justify-between mb-2 gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{entry.description}</span>
                  {entry.reference && (
                    <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}>{entry.reference}</span>
                  )}
                </div>
                <div className="flex gap-2 items-center flex-shrink-0">
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>{entry.type}</span>
                  <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{fmtDate(entry.date)}</span>
                  {entry.type === 'manual' && (
                    <button onClick={() => delEntry(entry)} className="text-xs hover:opacity-60" style={{ color: '#ef4444' }}>Delete</button>
                  )}
                </div>
              </div>
              <table className="w-full text-xs" style={{ tableLayout: 'fixed' }}>
                <colgroup>
                  <col />
                  <col style={{ width: 90 }} />
                  <col style={{ width: 90 }} />
                </colgroup>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <th className="text-left py-1 font-medium" style={{ color: 'var(--color-muted)' }}>Account</th>
                    <th className="text-right py-1 font-medium" style={{ color: 'var(--color-muted)' }}>Debit</th>
                    <th className="text-right py-1 font-medium" style={{ color: 'var(--color-muted)' }}>Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {(entry.lines || []).map((line, i) => (
                    <tr key={i}>
                      <td className="py-0.5" style={{ color: 'var(--color-text)' }}>{line.code} — {line.accountName}</td>
                      <td className="text-right py-0.5" style={{ color: 'var(--color-text)' }}>
                        {parseFloat(line.debit) > 0 ? <span style={{ fontFamily: 'ui-monospace, monospace' }}>{fmt(line.debit)}</span> : ''}
                      </td>
                      <td className="text-right py-0.5" style={{ color: 'var(--color-text)' }}>
                        {parseFloat(line.credit) > 0 ? <span style={{ fontFamily: 'ui-monospace, monospace' }}>{fmt(line.credit)}</span> : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {confirmModal && (
        <ConfirmModal title="Confirm" message={confirmModal.message} confirmLabel="Delete" danger
          onConfirm={confirmModal.onConfirm} onCancel={() => setConfirmModal(null)} />
      )}
    </div>
  );
}

// ── BAS ───────────────────────────────────────────────────────────────────────

const BAS_STEPS = ['open', 'reconciled', 'lodged', 'paid'];
const BAS_STEP_LABELS = { open: 'Open', reconciled: 'Reconciled', lodged: 'Lodged', paid: 'Paid' };

function BASStatusBar({ status }) {
  const current = BAS_STEPS.indexOf(status);
  return (
    <div className="flex items-center gap-0 mb-5">
      {BAS_STEPS.map((step, i) => {
        const done   = i < current;
        const active = i === current;
        return (
          <React.Fragment key={step}>
            <div className="flex flex-col items-center gap-1">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors"
                style={{
                  background: done ? '#065f46' : active ? 'var(--color-primary)' : 'var(--color-surface)',
                  color:      done || active ? '#fff' : 'var(--color-muted)',
                  border:     done || active ? 'none' : '2px solid var(--color-border)',
                }}
              >{done ? '✓' : i + 1}</div>
              <span className="text-xs whitespace-nowrap" style={{ color: active ? 'var(--color-primary)' : done ? '#065f46' : 'var(--color-muted)', fontWeight: active ? 600 : 400 }}>
                {BAS_STEP_LABELS[step]}
              </span>
            </div>
            {i < BAS_STEPS.length - 1 && (
              <div className="flex-1 h-0.5 mx-1 mb-5" style={{ background: i < current ? '#065f46' : 'var(--color-border)' }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function WarningsModal({ warnings, unpaidInvoices, onProceed, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-12 px-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="relative w-full max-w-lg rounded-xl shadow-xl overflow-y-auto" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', maxHeight: '85vh' }}>
        <div className="flex items-center gap-2 px-5 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <span style={{ color: '#f59e0b' }}>⚠</span>
          <span className="font-semibold text-sm" style={{ color: '#f59e0b' }}>Reconciliation Warnings</span>
        </div>
        <div className="p-5 flex flex-col gap-4">
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            The following issues were found for this quarter. You can proceed anyway or go back to investigate.
          </p>
          {warnings.length > 0 && (
            <div className="flex flex-col gap-2">
              {warnings.map((w, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <span className="flex-shrink-0" style={{ color: '#f59e0b' }}>⚠</span>
                  <span className="text-sm" style={{ color: 'var(--color-text)' }}>{w}</span>
                </div>
              ))}
            </div>
          )}
          {unpaidInvoices.length > 0 && (
            <div>
              <p className="text-sm mb-2 font-medium" style={{ color: 'var(--color-text)' }}>
                The following invoices were raised this quarter but have not been paid:
              </p>
              <table className="w-full text-xs border-collapse mb-2">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    {['Invoice', 'Client', 'Amount', 'Status'].map(h => (
                      <th key={h} className="py-1.5 text-left font-semibold" style={{ color: 'var(--color-muted)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {unpaidInvoices.map(inv => (
                    <tr key={inv.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td className="py-1.5 pr-3">{inv.number}</td>
                      <td className="py-1.5 pr-3">{inv.clientName || '—'}</td>
                      <td className="py-1.5 pr-3">{fmt(inv.total)}</td>
                      <td className="py-1.5 capitalize">{inv.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                These will not appear in your BAS figures until marked paid.
              </p>
            </div>
          )}
          <div className="flex gap-2 justify-end pt-1">
            <Btn variant="secondary" onClick={onCancel}>Go Back</Btn>
            <button
              onClick={onProceed}
              className="px-3 py-1.5 text-sm rounded-lg font-medium transition-opacity hover:opacity-80"
              style={{ background: '#f59e0b', color: '#fff' }}
            >Proceed Anyway</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AnnualBASPanel({ fy, setFy, onSelectQuarter }) {
  const [annual, setAnnual]   = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    setAnnual(null);
    api.get(`/api/finance/bas/annual?year=${fy}`)
      .then(r => r.json())
      .then(d => setAnnual(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [fy]);

  const statusStyle = (s) => {
    if (!s) return {};
    const map = {
      open:       { background: 'var(--color-surface)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' },
      reconciled: { background: '#fef3c7', color: '#92400e' },
      lodged:     { background: '#ffedd5', color: '#9a3412' },
      paid:       { background: '#d1fae5', color: '#065f46' },
    };
    return map[s] || map.open;
  };

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-5">
        <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Annual Summary</span>
        <div className="flex items-center gap-2">
          <button onClick={() => setFy(f => f - 1)} className="w-6 h-6 flex items-center justify-center rounded hover:opacity-60" style={{ color: 'var(--color-muted)' }}>←</button>
          <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>FY {fy - 1}–{fy}</span>
          <button onClick={() => setFy(f => f + 1)} className="w-6 h-6 flex items-center justify-center rounded hover:opacity-60" style={{ color: 'var(--color-muted)' }}>→</button>
        </div>
      </div>

      {loading && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading...</p>}

      {annual && (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '2px solid var(--color-border)', background: 'var(--color-surface)' }}>
                {['Quarter', 'G1 Sales', '1A GST', '1B Credits', 'Net GST', 'Status'].map(h => (
                  <th key={h} className="text-left py-2 px-3 text-xs font-semibold" style={{ color: 'var(--color-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {annual.quarters.map((q) => {
                const hasData = q.status !== null || q.g1 > 0 || q.gstOnSales > 0;
                return (
                  <tr
                    key={q.quarter}
                    className={`border-b ${hasData ? 'cursor-pointer hover:opacity-75' : ''}`}
                    style={{ borderColor: 'var(--color-border)' }}
                    onClick={() => {
                      if (!hasData) return;
                      // Match the quarter label to qIdx in the parent's quarters array
                      const prev = fy - 1;
                      const labels = [
                        `Q1 Jul–Sep ${prev}`, `Q2 Oct–Dec ${prev}`,
                        `Q3 Jan–Mar ${fy}`,   `Q4 Apr–Jun ${fy}`,
                      ];
                      const idx = labels.indexOf(q.label);
                      if (idx >= 0) onSelectQuarter(idx);
                    }}
                  >
                    <td className="py-2 px-3 text-xs font-medium" style={{ color: 'var(--color-text)' }}>{q.label}</td>
                    <td className="py-2 px-3" style={{ color: 'var(--color-text)' }}>{fmt(q.g1)}</td>
                    <td className="py-2 px-3" style={{ color: 'var(--color-text)' }}>{fmt(q.gstOnSales)}</td>
                    <td className="py-2 px-3" style={{ color: 'var(--color-text)' }}>{fmt(q.gstCredits)}</td>
                    <td className="py-2 px-3" style={{ color: 'var(--color-text)' }}>{fmt(q.netGst)}</td>
                    <td className="py-2 px-3">
                      {q.status ? (
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium capitalize" style={statusStyle(q.status)}>{q.status}</span>
                      ) : (
                        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              <tr style={{ borderTop: '2px solid var(--color-border)', background: 'var(--color-surface)' }}>
                <td className="py-2 px-3 text-xs font-bold" style={{ color: 'var(--color-text)' }}>FY Total</td>
                <td className="py-2 px-3 font-bold text-xs" style={{ color: 'var(--color-text)' }}>{fmt(annual.totals.g1)}</td>
                <td className="py-2 px-3 font-bold text-xs" style={{ color: 'var(--color-text)' }}>{fmt(annual.totals.gstOnSales)}</td>
                <td className="py-2 px-3 font-bold text-xs" style={{ color: 'var(--color-text)' }}>{fmt(annual.totals.gstCredits)}</td>
                <td className="py-2 px-3 font-bold text-xs" style={{ color: 'var(--color-text)' }}>{fmt(annual.totals.netGst)}</td>
                <td className="py-2 px-3" />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function buildBasWarnings(d) {
  const warns = [];
  const incTotal = parseFloat(d.income || 0) + parseFloat(d.gstCollected || 0);
  const expTotal = parseFloat(d.expenses || 0) + parseFloat(d.gstPaid || 0);
  if (incTotal === 0) warns.push('No paid invoices recorded for this quarter. G1 is $0.00.');
  if (expTotal === 0) warns.push('No expenses recorded for this quarter. G11 is $0.00.');
  if ((d.netGst || 0) < 0) warns.push('GST credits (1B) exceed GST on sales (1A). Net GST payable is negative — this is unusual. Verify your expenses.');
  if (incTotal > 0 && Math.abs(parseFloat((incTotal / 11).toFixed(2)) - (d.gstCollected || 0)) > 0.02)
    warns.push('GST on Sales (1A) does not equal G1 ÷ 11. Possible calculation anomaly — verify your figures.');
  return warns;
}

function BASTab() {
  const now        = new Date();
  const defaultFY  = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();

  const [fy, setFy]   = useState(defaultFY);
  const prev           = fy - 1;

  const quarters = [
    { label: `Q1 Jul–Sep ${prev}`, from: `${prev}-07-01`, to: `${prev}-09-30` },
    { label: `Q2 Oct–Dec ${prev}`, from: `${prev}-10-01`, to: `${prev}-12-31` },
    { label: `Q3 Jan–Mar ${fy}`,   from: `${fy}-01-01`,   to: `${fy}-03-31`   },
    { label: `Q4 Apr–Jun ${fy}`,   from: `${fy}-04-01`,   to: `${fy}-06-30`   },
  ];

  const [qIdx, setQIdx]           = useState(() => { const m = now.getMonth(); return m<=2?2:m<=5?3:m<=8?0:1; });
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(false);
  const [stepping, setStepping]   = useState(false);
  const [stepError, setStepError] = useState('');
  const [warningsModal, setWarningsModal]       = useState(null);
  const [confirmReconcile, setConfirmReconcile] = useState(false);
  const [confirmLodge, setConfirmLodge]         = useState(false);
  const [confirmPay, setConfirmPay]             = useState(false);
  const addToast = useToastStore(s => s.addToast);

  const calc = useCallback(async () => {
    setLoading(true);
    setData(null);
    setStepError('');
    const q = quarters[qIdx];
    try {
      const result = await api.get(`/api/finance/bas?from=${q.from}&to=${q.to}`).then(r => r.json());
      setData(result);
    } catch {} finally { setLoading(false); }
  }, [qIdx, fy]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { calc(); }, [calc]);

  const executeStep = async () => {
    setStepping(true);
    setStepError('');
    try {
      const id = data.quarterId;
      if (data.status === 'open')            await api.post(`/api/finance/bas/${id}/reconcile`, {});
      else if (data.status === 'reconciled') await api.post(`/api/finance/bas/${id}/lodge`, {});
      else if (data.status === 'lodged')     await api.post(`/api/finance/bas/${id}/paid`, {});
      const labels = { open: 'Marked reconciled', reconciled: 'Lodged with ATO', lodged: 'BAS payment recorded' };
      addToast(labels[data.status] || 'Updated');
      await calc();
    } catch (e) {
      setStepError(e.message);
    } finally {
      setStepping(false);
    }
  };

  const doStep = async () => {
    if (!data?.quarterId) return;
    if (data.status === 'open') {
      setStepping(true);
      try {
        const warns   = buildBasWarnings(data);
        const r       = await api.get(`/api/finance/bas/${data.quarterId}/warnings`).then(r => r.json());
        const unpaid  = r.unpaidInvoices || [];
        if (warns.length > 0 || unpaid.length > 0) {
          setWarningsModal({ warnings: warns, unpaidInvoices: unpaid });
        } else {
          setConfirmReconcile(true);
        }
      } catch { setConfirmReconcile(true); }
      finally { setStepping(false); }
    } else if (data.status === 'reconciled') {
      setConfirmLodge(true);
    } else if (data.status === 'lodged') {
      setConfirmPay(true);
    }
  };

  const incTotal = data ? parseFloat(data.income || 0) + parseFloat(data.gstCollected || 0) : 0;
  const expTotal = data ? parseFloat(data.expenses || 0) + parseFloat(data.gstPaid || 0) : 0;

  const rows = data ? [
    { label: 'G1 — Total Sales (inc GST)',             value: fmt(incTotal) },
    { label: 'G11 — Non-capital Purchases (inc GST)',  value: fmt(expTotal) },
    null,
    { label: '1A — GST on Sales',                      value: fmt(data.gstCollected), bold: true },
    { label: '1B — GST Credits',                       value: fmt(data.gstPaid) },
    { label: 'Net GST Payable (1A − 1B)',               value: fmt(data.netGst), bold: true, warn: data.netGst > 0 },
    null,
    { label: 'W1 — Total Wages',                       value: fmt(data.wages) },
    { label: 'W2 — Tax Withheld (PAYG)',                value: fmt(data.withholdingTax), bold: true },
  ] : [];

  const actionLabels = { open: 'Mark Reconciled', reconciled: 'Lodge with ATO', lodged: 'Record Payment' };
  const timestamps   = data ? [
    data.reconciledAt && `Reconciled ${new Date(data.reconciledAt).toLocaleString('en-AU')}`,
    data.lodgedAt     && `Lodged ${new Date(data.lodgedAt).toLocaleString('en-AU')}`,
    data.paidAt       && `Paid ${new Date(data.paidAt).toLocaleString('en-AU')}`,
  ].filter(Boolean) : [];

  const lodgeMessage = data ? (
    <div>
      <p className="mb-3">Confirm you have submitted this BAS to the ATO for <strong>{quarters[qIdx]?.label}</strong>.</p>
      <div className="rounded-lg p-3 mb-3 text-xs font-mono flex flex-col gap-1" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
        <div className="flex justify-between"><span>G1  Total Sales (inc GST)</span><span>{fmt(incTotal)}</span></div>
        <div className="flex justify-between"><span>1A  GST on Sales</span><span>{fmt(data.gstCollected)}</span></div>
        <div className="flex justify-between"><span>1B  GST Credits</span><span>{fmt(data.gstPaid)}</span></div>
        <div className="flex justify-between font-bold" style={{ borderTop: '1px solid var(--color-border)', paddingTop: 4, marginTop: 2 }}><span>Net GST Payable</span><span>{fmt(data.netGst)}</span></div>
      </div>
      <p>This action cannot be undone.</p>
    </div>
  ) : '';

  return (
    <div data-tour="finance-bas" className="p-6">
      <h2 className="font-semibold mb-4" style={{ color: 'var(--color-text)' }}>Business Activity Statement</h2>

      <div className="flex flex-col xl:flex-row gap-8">
        {/* Left: quarterly detail */}
        <div className="flex-1 min-w-0 max-w-xl">
          <div className="mb-5">
            <Field label="Quarter">
              <Sel value={qIdx} onChange={v => setQIdx(Number(v))}>
                {quarters.map((q, i) => <option key={i} value={i}>{q.label}</option>)}
              </Sel>
            </Field>
          </div>

          {loading && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Calculating...</p>}

          {data && (
            <>
              <BASStatusBar status={data.status} />

              <div className="rounded-xl border overflow-hidden mb-4" style={{ borderColor: 'var(--color-border)' }}>
                {rows.map((row, i) =>
                  row === null ? (
                    <div key={i} className="border-t" style={{ borderColor: 'var(--color-border)' }} />
                  ) : (
                    <div
                      key={i}
                      className="flex items-center justify-between px-4 py-2.5 border-b last:border-0"
                      style={{ borderColor: 'var(--color-border)', background: row.bold ? 'var(--color-surface)' : 'transparent' }}
                    >
                      <span className="text-sm" style={{ color: 'var(--color-text)', fontWeight: row.bold ? 600 : 400 }}>{row.label}</span>
                      <span className="text-sm font-medium" style={{ color: row.warn ? '#f59e0b' : 'var(--color-text)' }}>{row.value}</span>
                    </div>
                  )
                )}
              </div>

              {timestamps.length > 0 && (
                <div className="mb-3 flex flex-col gap-0.5">
                  {timestamps.map(t => <p key={t} className="text-xs" style={{ color: 'var(--color-muted)' }}>{t}</p>)}
                </div>
              )}

              {data.status === 'paid' ? (
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm" style={{ background: '#d1fae5', color: '#065f46', border: '1px solid #a7f3d0' }}>
                  <span>✓</span>
                  <span>This BAS quarter is locked — payment has been recorded and journal entries created.</span>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {stepError && <p className="text-xs" style={{ color: '#ef4444' }}>{stepError}</p>}
                  <Btn onClick={doStep} disabled={stepping}>
                    {stepping ? 'Checking…' : actionLabels[data.status]}
                  </Btn>
                </div>
              )}
            </>
          )}
        </div>

        {/* Right: annual summary */}
        <AnnualBASPanel
          fy={fy}
          setFy={setFy}
          onSelectQuarter={idx => setQIdx(idx)}
        />
      </div>

      {warningsModal && (
        <WarningsModal
          warnings={warningsModal.warnings}
          unpaidInvoices={warningsModal.unpaidInvoices}
          onProceed={() => { setWarningsModal(null); setConfirmReconcile(true); }}
          onCancel={() => setWarningsModal(null)}
        />
      )}

      {confirmReconcile && (
        <ConfirmModal
          title="Mark as Reconciled"
          message="Confirm this quarter's figures have been reviewed and reconciled. You can still lodge and pay after this step."
          confirmLabel="Mark Reconciled"
          onConfirm={() => { setConfirmReconcile(false); executeStep(); }}
          onCancel={() => setConfirmReconcile(false)}
        />
      )}

      {confirmLodge && (
        <ConfirmModal
          title="Lodge with ATO"
          message={lodgeMessage}
          confirmLabel="Confirm Lodge"
          onConfirm={() => { setConfirmLodge(false); executeStep(); }}
          onCancel={() => setConfirmLodge(false)}
        />
      )}

      {confirmPay && (
        <ConfirmModal
          title="Record BAS Payment"
          message={`This will create a journal entry for the GST settlement (${fmt(data?.netGst)}) and lock this quarter. Continue?`}
          confirmLabel="Record Payment"
          onConfirm={() => { setConfirmPay(false); executeStep(); }}
          onCancel={() => setConfirmPay(false)}
        />
      )}
    </div>
  );
}

// ── Settings ──────────────────────────────────────────────────────────────────

function SettingsTab() {
  const [form, setForm] = useState({
    fin_biz_name: '', fin_abn: '', fin_address: '',
    fin_bank_name: '', fin_account_name: '', fin_bsb: '', fin_account_number: '',
    fin_gst_registered: 'true', fin_payment_terms: '14',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);

  useEffect(() => {
    api.get('/api/finance/settings')
      .then(r => r.json())
      .then(data => setForm(p => ({ ...p, ...data })))
      .catch(() => {});
  }, []);

  const set = (key) => (v) => setForm(p => ({ ...p, [key]: v }));
  const f   = (key) => form[key] || '';

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/api/finance/settings', form);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
    finally { setSaving(false); }
  };

  return (
    <div className="p-6 max-w-lg">
      <h2 className="font-semibold mb-4" style={{ color: 'var(--color-text)' }}>Finance Settings</h2>
      <div className="flex flex-col gap-3">
        <Field label="Business Name"><Input value={f('fin_biz_name')} onChange={set('fin_biz_name')} placeholder="Your Business Name Pty Ltd" /></Field>
        <Field label="ABN"><Input value={f('fin_abn')} onChange={set('fin_abn')} placeholder="12 345 678 901" /></Field>
        <Field label="Business Address"><Input value={f('fin_address')} onChange={set('fin_address')} placeholder="Street, City, State, Postcode" /></Field>

        <div className="border-t pt-3 mt-1" style={{ borderColor: 'var(--color-border)' }}>
          <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>Bank Details</p>
          <div className="flex flex-col gap-3">
            <Field label="Bank Name"><Input value={f('fin_bank_name')} onChange={set('fin_bank_name')} placeholder="e.g. Commonwealth Bank" /></Field>
            <Field label="Account Name"><Input value={f('fin_account_name')} onChange={set('fin_account_name')} placeholder="Your Business Name Pty Ltd" /></Field>
            <Field label="BSB"><Input value={f('fin_bsb')} onChange={set('fin_bsb')} placeholder="000-000" /></Field>
            <Field label="Account Number"><Input value={f('fin_account_number')} onChange={set('fin_account_number')} placeholder="123456789" /></Field>
          </div>
        </div>

        <div className="border-t pt-3 mt-1" style={{ borderColor: 'var(--color-border)' }}>
          <Field label="Default Payment Terms">
            <Sel value={f('fin_payment_terms')} onChange={set('fin_payment_terms')}>
              {['7','14','30','60'].map(v => <option key={v} value={v}>{v} days</option>)}
            </Sel>
          </Field>
          <div className="flex items-center gap-2 mt-3">
            <input
              type="checkbox"
              id="gst-reg"
              checked={f('fin_gst_registered') !== 'false'}
              onChange={e => set('fin_gst_registered')(e.target.checked ? 'true' : 'false')}
            />
            <label htmlFor="gst-reg" className="text-sm" style={{ color: 'var(--color-text)' }}>Registered for GST</label>
          </div>
        </div>

        <div className="pt-2">
          <Btn onClick={save} disabled={saving}>{saved ? 'Saved!' : saving ? 'Saving…' : 'Save Settings'}</Btn>
        </div>
      </div>
    </div>
  );
}

// ── Suppliers ─────────────────────────────────────────────────────────────────

const BLANK_SUPPLIER = { name: '', email: '', phone: '', abn: '', website: '', notes: '' };

function SuppliersTab() {
  const [suppliers, setSuppliers] = useState([]);
  const [showForm, setShowForm]   = useState(false);
  const [editing, setEditing]     = useState(null);
  const [form, setForm]           = useState({ ...BLANK_SUPPLIER });
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');
  const [confirmModal, setConfirmModal] = useState(null);
  const addToast = useToastStore(s => s.addToast);

  const load = useCallback(() => {
    api.get('/api/finance/suppliers').then(r => r.json()).then(d => setSuppliers(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const openNew = () => { setEditing(null); setForm({ ...BLANK_SUPPLIER }); setError(''); setShowForm(true); };
  const openEdit = (s) => { setEditing(s); setForm({ name: s.name, email: s.email||'', phone: s.phone||'', abn: s.abn||'', website: s.website||'', notes: s.notes||'' }); setError(''); setShowForm(true); };
  const cancelForm = () => { setShowForm(false); setEditing(null); setError(''); };

  const save = async () => {
    if (!form.name.trim()) { setError('Name required'); return; }
    setSaving(true); setError('');
    try {
      if (editing) {
        await api.put(`/api/finance/suppliers/${editing.id}`, form);
        addToast('Supplier updated');
      } else {
        await api.post('/api/finance/suppliers', form);
        addToast('Supplier added');
      }
      load(); cancelForm();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const toggleActive = async (s) => {
    await api.patch(`/api/finance/suppliers/${s.id}`);
    load();
  };

  const del = (s) => {
    setConfirmModal({
      message: `Delete supplier "${s.name}"?`,
      onConfirm: async () => {
        setConfirmModal(null);
        await api.delete(`/api/finance/suppliers/${s.id}`);
        setSuppliers(prev => prev.filter(x => x.id !== s.id));
        addToast('Supplier deleted');
      },
    });
  };

  const sf = k => v => setForm(p => ({ ...p, [k]: v }));

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold" style={{ color: 'var(--color-text)' }}>Suppliers</h2>
        <Btn onClick={showForm ? cancelForm : openNew}>{showForm ? 'Cancel' : '+ Add Supplier'}</Btn>
      </div>

      {showForm && (
        <div className="mb-5 p-4 rounded-xl border" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="col-span-2">
              <Field label="Supplier Name *"><Input value={form.name} onChange={sf('name')} placeholder="Acme Corp" /></Field>
            </div>
            <Field label="Email"><Input type="email" value={form.email} onChange={sf('email')} placeholder="accounts@supplier.com" /></Field>
            <Field label="Phone"><Input value={form.phone} onChange={sf('phone')} placeholder="+61 2 1234 5678" /></Field>
            <Field label="ABN"><Input value={form.abn} onChange={sf('abn')} placeholder="12 345 678 901" /></Field>
            <Field label="Website"><Input value={form.website} onChange={sf('website')} placeholder="https://supplier.com" /></Field>
            <div className="col-span-2">
              <Field label="Notes"><Textarea value={form.notes} onChange={sf('notes')} rows={2} placeholder="Internal notes…" /></Field>
            </div>
          </div>
          <ErrMsg msg={error} />
          <div className="flex gap-2 mt-2">
            <Btn onClick={save} disabled={saving}>{saving ? 'Saving…' : editing ? 'Update' : 'Add Supplier'}</Btn>
          </div>
        </div>
      )}

      {suppliers.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No suppliers yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
                {['Name', 'Email', 'Phone', 'ABN', 'Status', ''].map(h => (
                  <th key={h} className="text-left py-2 px-2 text-xs font-semibold" style={{ color: 'var(--color-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {suppliers.map(s => (
                <tr key={s.id} className="border-b hover:opacity-80" style={{ borderColor: 'var(--color-border)', opacity: s.isActive ? 1 : 0.5 }}>
                  <td className="py-2 px-2 font-medium" style={{ color: 'var(--color-text)' }}>{s.name}</td>
                  <td className="py-2 px-2 text-xs" style={{ color: 'var(--color-muted)' }}>{s.email || '—'}</td>
                  <td className="py-2 px-2 text-xs" style={{ color: 'var(--color-muted)' }}>{s.phone || '—'}</td>
                  <td className="py-2 px-2 text-xs" style={{ color: 'var(--color-muted)' }}>{s.abn || '—'}</td>
                  <td className="py-2 px-2">
                    <button
                      onClick={() => toggleActive(s)}
                      className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{ background: s.isActive ? '#d1fae5' : 'var(--color-surface)', color: s.isActive ? '#065f46' : 'var(--color-muted)', border: '1px solid var(--color-border)' }}
                    >{s.isActive ? 'Active' : 'Inactive'}</button>
                  </td>
                  <td className="py-2 px-2">
                    <div className="flex gap-2">
                      <button onClick={() => openEdit(s)} className="text-xs hover:opacity-60" style={{ color: 'var(--color-primary)' }}>Edit</button>
                      <button onClick={() => del(s)} className="text-xs hover:opacity-60" style={{ color: '#ef4444' }}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirmModal && (
        <ConfirmModal
          title="Confirm" message={confirmModal.message} confirmLabel="Delete" danger
          onConfirm={confirmModal.onConfirm} onCancel={() => setConfirmModal(null)}
        />
      )}
    </div>
  );
}

// ── Transaction Codes ──────────────────────────────────────────────────────────

const BLANK_TX_CODE = { code: '', name: '', type: 'expense', description: '' };

function CodesTab() {
  const [codes, setCodes]       = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing]   = useState(null);
  const [form, setForm]         = useState({ ...BLANK_TX_CODE });
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [filter, setFilter]     = useState('all');
  const [confirmModal, setConfirmModal] = useState(null);
  const addToast = useToastStore(s => s.addToast);

  const load = useCallback(() => {
    api.get('/api/finance/tx-codes').then(r => r.json()).then(d => setCodes(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const openNew = () => { setEditing(null); setForm({ ...BLANK_TX_CODE }); setError(''); setShowForm(true); };
  const openEdit = (c) => {
    if (c.isSystem) return;
    setEditing(c);
    setForm({ code: c.code, name: c.name, type: c.type, description: c.description || '' });
    setError(''); setShowForm(true);
  };
  const cancelForm = () => { setShowForm(false); setEditing(null); setError(''); };

  const save = async () => {
    if (!form.code.trim() || !form.name.trim()) { setError('Code and name required'); return; }
    setSaving(true); setError('');
    try {
      if (editing) {
        await api.put(`/api/finance/tx-codes/${editing.id}`, form);
        addToast('Code updated');
      } else {
        await api.post('/api/finance/tx-codes', form);
        addToast('Code added');
      }
      load(); cancelForm();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const toggleActive = async (c) => {
    await api.patch(`/api/finance/tx-codes/${c.id}`);
    load();
  };

  const del = (c) => {
    if (c.isSystem) return;
    setConfirmModal({
      message: `Delete code "${c.code} — ${c.name}"?`,
      onConfirm: async () => {
        setConfirmModal(null);
        await api.delete(`/api/finance/tx-codes/${c.id}`);
        setCodes(prev => prev.filter(x => x.id !== c.id));
        addToast('Code deleted');
      },
    });
  };

  const cf = k => v => setForm(p => ({ ...p, [k]: v }));

  const visible = codes.filter(c => filter === 'all' || c.type === filter);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold" style={{ color: 'var(--color-text)' }}>Income & Expense Codes</h2>
        <Btn onClick={showForm ? cancelForm : openNew}>{showForm ? 'Cancel' : '+ Add Code'}</Btn>
      </div>

      <div className="flex gap-1 mb-4">
        {[['all','All'],['income','Income'],['expense','Expense']].map(([k,l]) => (
          <button key={k} onClick={() => setFilter(k)}
            className="text-xs px-3 py-1 rounded-full font-medium transition-colors"
            style={{ background: filter === k ? 'var(--color-primary)' : 'transparent', color: filter === k ? '#fff' : 'var(--color-muted)', border: '1px solid var(--color-border)' }}
          >{l}</button>
        ))}
      </div>

      {showForm && (
        <div className="mb-5 p-4 rounded-xl border" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <Field label="Code *"><Input value={form.code} onChange={cf('code')} placeholder="EXP-200" /></Field>
            <Field label="Type">
              <Sel value={form.type} onChange={cf('type')}>
                <option value="income">Income</option>
                <option value="expense">Expense</option>
              </Sel>
            </Field>
            <div className="col-span-2">
              <Field label="Name *"><Input value={form.name} onChange={cf('name')} placeholder="e.g. Software & Subscriptions" /></Field>
            </div>
            <div className="col-span-2">
              <Field label="Description"><Textarea value={form.description} onChange={cf('description')} rows={2} placeholder="Optional description…" /></Field>
            </div>
          </div>
          <ErrMsg msg={error} />
          <div className="flex gap-2 mt-2">
            <Btn onClick={save} disabled={saving}>{saving ? 'Saving…' : editing ? 'Update' : 'Add Code'}</Btn>
          </div>
        </div>
      )}

      {visible.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No codes found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
                {['Code', 'Name', 'Type', 'Status', ''].map(h => (
                  <th key={h} className="text-left py-2 px-2 text-xs font-semibold" style={{ color: 'var(--color-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map(c => (
                <tr key={c.id} className="border-b hover:opacity-80" style={{ borderColor: 'var(--color-border)', opacity: c.isActive ? 1 : 0.5 }}>
                  <td className="py-2 px-2 font-mono text-xs font-medium" style={{ color: 'var(--color-text)' }}>{c.code}</td>
                  <td className="py-2 px-2" style={{ color: 'var(--color-text)' }}>
                    {c.name}
                    {c.isSystem && <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>system</span>}
                    {c.description && <span className="block text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{c.description}</span>}
                  </td>
                  <td className="py-2 px-2">
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium capitalize"
                      style={{ background: c.type === 'income' ? '#dbeafe' : '#fef3c7', color: c.type === 'income' ? '#1e40af' : '#92400e' }}>
                      {c.type}
                    </span>
                  </td>
                  <td className="py-2 px-2">
                    <button
                      onClick={() => toggleActive(c)}
                      className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{ background: c.isActive ? '#d1fae5' : 'var(--color-surface)', color: c.isActive ? '#065f46' : 'var(--color-muted)', border: '1px solid var(--color-border)' }}
                    >{c.isActive ? 'Active' : 'Inactive'}</button>
                  </td>
                  <td className="py-2 px-2">
                    {!c.isSystem && (
                      <div className="flex gap-2">
                        <button onClick={() => openEdit(c)} className="text-xs hover:opacity-60" style={{ color: 'var(--color-primary)' }}>Edit</button>
                        <button onClick={() => del(c)} className="text-xs hover:opacity-60" style={{ color: '#ef4444' }}>Delete</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirmModal && (
        <ConfirmModal
          title="Confirm" message={confirmModal.message} confirmLabel="Delete" danger
          onConfirm={confirmModal.onConfirm} onCancel={() => setConfirmModal(null)}
        />
      )}
    </div>
  );
}

// ── Trial Balance ─────────────────────────────────────────────────────────────

const TYPE_ORDER = ['asset', 'liability', 'equity', 'income', 'expense'];
const TYPE_LABELS = { asset: 'Assets', liability: 'Liabilities', equity: 'Equity', income: 'Income', expense: 'Expenses' };

function normalBalance(row) {
  const dr = parseFloat(row.totalDebit)  || 0;
  const cr = parseFloat(row.totalCredit) || 0;
  if (row.type === 'asset' || row.type === 'expense') return dr - cr;
  return cr - dr;
}

function BalancesTab() {
  const [rows, setRows]     = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/finance/trial-balance')
      .then(r => r.json())
      .then(d => setRows(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6 text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</div>;

  const grouped = TYPE_ORDER.reduce((acc, t) => {
    acc[t] = rows.filter(r => r.type === t);
    return acc;
  }, {});

  const totalDr = rows.reduce((s, r) => s + (parseFloat(r.totalDebit)  || 0), 0);
  const totalCr = rows.reduce((s, r) => s + (parseFloat(r.totalCredit) || 0), 0);
  const balanced = Math.abs(totalDr - totalCr) < 0.01;

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Trial Balance</h2>
        <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{
          background: balanced ? '#d1fae5' : '#fee2e2',
          color:      balanced ? '#065f46' : '#991b1b',
        }}>
          {balanced ? '✓ Balanced' : '✗ Out of balance'}
        </span>
      </div>

      <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--color-border)' }}>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr style={{ background: 'var(--color-surface)' }}>
              <th className="text-left px-4 py-2 font-medium text-xs" style={{ color: 'var(--color-muted)' }}>Code</th>
              <th className="text-left px-4 py-2 font-medium text-xs" style={{ color: 'var(--color-muted)' }}>Account</th>
              <th className="text-right px-4 py-2 font-medium text-xs" style={{ color: 'var(--color-muted)' }}>Debit</th>
              <th className="text-right px-4 py-2 font-medium text-xs" style={{ color: 'var(--color-muted)' }}>Credit</th>
              <th className="text-right px-4 py-2 font-medium text-xs" style={{ color: 'var(--color-muted)' }}>Balance</th>
            </tr>
          </thead>
          <tbody>
            {TYPE_ORDER.map(type => {
              const group = grouped[type];
              if (!group.length) return null;
              const groupBalance = group.reduce((s, r) => s + normalBalance(r), 0);
              return (
                <React.Fragment key={type}>
                  <tr style={{ background: 'var(--color-surface)', borderTop: '1px solid var(--color-border)' }}>
                    <td colSpan={5} className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
                      {TYPE_LABELS[type]}
                    </td>
                  </tr>
                  {group.map(row => {
                    const bal  = normalBalance(row);
                    const isBank = row.code === '1000';
                    return (
                      <tr
                        key={row.id}
                        style={{
                          borderTop:  '1px solid var(--color-border)',
                          background: isBank ? 'rgba(var(--color-primary-rgb, 204,120,92), 0.06)' : 'var(--color-bg)',
                        }}
                      >
                        <td className="px-4 py-2 font-mono text-xs" style={{ color: 'var(--color-muted)' }}>{row.code}</td>
                        <td className="px-4 py-2" style={{ color: 'var(--color-text)', fontWeight: isBank ? 600 : 400 }}>
                          {row.name}
                          {isBank && <span className="ml-2 text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface)', color: 'var(--color-muted)' }}>Bank</span>}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs" style={{ color: 'var(--color-text)' }}>
                          {parseFloat(row.totalDebit) > 0 ? fmt(row.totalDebit) : '—'}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs" style={{ color: 'var(--color-text)' }}>
                          {parseFloat(row.totalCredit) > 0 ? fmt(row.totalCredit) : '—'}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs font-semibold" style={{
                          color: bal >= 0 ? 'var(--color-text)' : '#ef4444',
                        }}>
                          {fmt(Math.abs(bal))}{bal < 0 ? ' CR' : ''}
                        </td>
                      </tr>
                    );
                  })}
                  <tr style={{ background: 'var(--color-surface)', borderTop: '1px solid var(--color-border)' }}>
                    <td colSpan={4} className="px-4 py-1.5 text-xs text-right font-semibold" style={{ color: 'var(--color-muted)' }}>
                      {TYPE_LABELS[type]} total
                    </td>
                    <td className="px-4 py-1.5 text-right font-mono text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
                      {fmt(Math.abs(groupBalance))}
                    </td>
                  </tr>
                </React.Fragment>
              );
            })}
            <tr style={{ borderTop: '2px solid var(--color-border)', background: 'var(--color-surface)' }}>
              <td colSpan={2} className="px-4 py-2 text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Totals</td>
              <td className="px-4 py-2 text-right font-mono text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{fmt(totalDr)}</td>
              <td className="px-4 py-2 text-right font-mono text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{fmt(totalCr)}</td>
              <td className="px-4 py-2 text-right font-mono text-xs font-semibold" style={{ color: balanced ? '#065f46' : '#ef4444' }}>
                {balanced ? '✓' : fmt(Math.abs(totalDr - totalCr))}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>
        Balances are all-time cumulative from all journal entries. Assets and expenses show debit (normal) balance; liabilities, equity, and income show credit (normal) balance.
      </p>
    </div>
  );
}

// ── Financial Position ────────────────────────────────────────────────────────

function signedLabel(value, positiveLabel, negativeLabel) {
  if (Math.abs(value) < 0.01) return 'Clear';
  return value > 0 ? positiveLabel : negativeLabel;
}

function PositionCard({ label, value, sub, tone = 'neutral' }) {
  const color = tone === 'good'
    ? '#047857'
    : tone === 'warn'
      ? '#b45309'
      : tone === 'bad'
        ? '#b91c1c'
        : 'var(--color-text)';

  return (
    <div className="rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
      <p className="text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>{label}</p>
      <p className="text-2xl font-semibold" style={{ color }}>{fmt(value)}</p>
      {sub && <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>{sub}</p>}
    </div>
  );
}

function PositionTab() {
  const [rows, setRows] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/api/finance/trial-balance').then(r => r.json()),
      api.get('/api/finance/invoices').then(r => r.json()),
    ])
      .then(([balanceRows, invoiceRows]) => {
        setRows(Array.isArray(balanceRows) ? balanceRows : []);
        setInvoices(Array.isArray(invoiceRows) ? invoiceRows : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6 text-sm" style={{ color: 'var(--color-muted)' }}>Loading...</div>;

  const rowByCode = (code) => rows.find(r => r.code === code);
  const balance = (code) => normalBalance(rowByCode(code) || {});
  const cash = balance('1000');
  const receivables = invoices
    .filter(inv => inv.status === 'sent')
    .reduce((sum, inv) => sum + (parseFloat(inv.total) || 0), 0);
  const gstPaid = balance('1200');
  const gstCollected = balance('2200');
  const gstNetPayable = gstCollected - gstPaid;
  const creditCardRows = rows.filter(r => r.type === 'liability' && (String(r.code).startsWith('21') || /credit card/i.test(r.name || '')));
  const creditCardOwed = creditCardRows.reduce((sum, row) => sum + Math.max(normalBalance(row), 0), 0);
  const creditCardCredit = creditCardRows.reduce((sum, row) => sum + Math.max(-normalBalance(row), 0), 0);
  const nearTermPosition = cash + receivables + creditCardCredit - creditCardOwed - gstNetPayable;

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-5">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Financial Position</h2>
        <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
          A business-facing view of the ledger: cash, money owed to you, card debt, and GST position. Reconcile cash against your real bank balance.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <PositionCard
          label="Current cash position"
          value={cash}
          tone={cash >= 0 ? 'good' : 'bad'}
          sub="Bank / Cash account balance"
        />
        <PositionCard
          label="Money owed to you"
          value={receivables}
          tone={receivables > 0 ? 'warn' : 'neutral'}
          sub="Sent invoices not marked paid"
        />
        <PositionCard
          label="Credit cards owed"
          value={creditCardOwed}
          tone={creditCardOwed > 0 ? 'bad' : 'good'}
          sub={creditCardCredit > 0 ? `${fmt(creditCardCredit)} card credit/overpayment` : 'Liability balance'}
        />
        <PositionCard
          label="Net GST position"
          value={Math.abs(gstNetPayable)}
          tone={gstNetPayable > 0 ? 'warn' : 'good'}
          sub={signedLabel(gstNetPayable, 'Estimated payable', 'Estimated refund/credit')}
        />
      </div>

      <div className="rounded-xl border p-4 mb-5" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        <p className="text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Near-term position</p>
        <p className="text-3xl font-semibold" style={{ color: nearTermPosition >= 0 ? '#047857' : '#b91c1c' }}>
          {fmt(nearTermPosition)}
        </p>
        <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>
          Cash + unpaid sent invoices + card credits - card debt - net GST payable. This is a practical snapshot, not a formal financial statement.
        </p>
      </div>

      {creditCardRows.length > 0 && (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)', background: 'var(--color-surface)' }}>
            Credit card accounts
          </div>
          {creditCardRows.map(row => {
            const bal = normalBalance(row);
            return (
              <div key={row.id} className="flex justify-between gap-4 px-4 py-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
                <span className="text-sm" style={{ color: 'var(--color-text)' }}>{row.name}</span>
                <span className="text-sm font-mono" style={{ color: bal > 0 ? '#b91c1c' : bal < 0 ? '#047857' : 'var(--color-text)' }}>
                  {fmt(Math.abs(bal))} {bal > 0 ? 'owed' : bal < 0 ? 'credit' : ''}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

const TABS = ['Dashboard', 'Invoices', 'Quotes', 'Clients', 'Suppliers', 'Expenses', 'Wages', 'Interest', 'Journal', 'Accounts', 'Codes', 'BAS', 'Position', 'Balances', 'Settings'];
const NO_DATE_FILTER_TABS = new Set(['Clients', 'Suppliers', 'Accounts', 'Codes', 'BAS', 'Position', 'Balances', 'Settings']);

export default function FinancePage() {
  const [tab, setTab] = useState('Dashboard');
  const [dateRange, setDateRange] = useState(() => ({ preset: 'month', ...getPresetRange('month') }));
  const [exporting, setExporting] = useState(null);
  const addToast = useToastStore(s => s.addToast);

  const showDatePicker = !NO_DATE_FILTER_TABS.has(tab);
  const { from, to } = dateRange;

  const doExport = async (type) => {
    setExporting(type);
    try {
      const params = new URLSearchParams({ from, to });
      const endpoint = type === 'myob' ? 'myob' : 'excel';
      const res = await api.get(`/api/finance/export/${endpoint}?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Export failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const fromStr = from.replace(/-/g, '');
      const toStr   = to.replace(/-/g, '');
      a.href = url;
      a.download = type === 'myob'
        ? `myob-journal-${fromStr}-${toStr}.csv`
        : `finance-export-${fromStr}-${toStr}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      addToast(e.message || 'Export failed', 'error');
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header + tabs */}
      <div className="flex-shrink-0 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <div className="px-6 pt-4 pb-0">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <span style={{ fontSize: 20 }}>💰</span>
              <h1 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>Curam Finance</h1>
            </div>
            <div className="flex items-center gap-2">
              <Btn variant="secondary" onClick={() => doExport('myob')} disabled={exporting === 'myob'}>
                {exporting === 'myob' ? 'Exporting…' : 'Export MYOB'}
              </Btn>
              <Btn variant="secondary" onClick={() => doExport('excel')} disabled={exporting === 'excel'}>
                {exporting === 'excel' ? 'Exporting…' : 'Export Excel'}
              </Btn>
            </div>
          </div>
          <div data-tour="finance-tabs" className="flex gap-0 overflow-x-auto">
            {TABS.map(t => (
              <button
                key={t}
                data-finance-tab={t}
                onClick={() => setTab(t)}
                className="flex-shrink-0 text-sm px-4 py-2 border-b-2 transition-colors"
                style={{
                  background:        'transparent',
                  color:             tab === t ? 'var(--color-primary)' : 'var(--color-muted)',
                  borderBottomColor: tab === t ? 'var(--color-primary)' : 'transparent',
                  fontWeight:        tab === t ? 600 : 400,
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Date range picker — hidden for Clients, BAS, Settings */}
      {showDatePicker && (
        <DateRangePicker value={dateRange} onChange={setDateRange} />
      )}

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {tab === 'Dashboard' && <DashboardTab from={from} to={to} />}
        {tab === 'Invoices'  && <InvoicesTab  from={from} to={to} docType="invoice" />}
        {tab === 'Quotes'    && <InvoicesTab  from={from} to={to} docType="quote" />}
        {tab === 'Clients'   && <ClientsTab />}
        {tab === 'Suppliers' && <SuppliersTab />}
        {tab === 'Expenses'  && <ExpensesTab  from={from} to={to} />}
        {tab === 'Wages'     && <WagesTab     from={from} to={to} />}
        {tab === 'Interest'  && <InterestTab from={from} to={to} />}
        {tab === 'Journal'   && <JournalTab   from={from} to={to} />}
        {tab === 'Accounts'  && <AccountsTab />}
        {tab === 'Codes'     && <CodesTab />}
        {tab === 'BAS'       && <BASTab />}
        {tab === 'Position'  && <PositionTab />}
        {tab === 'Balances'  && <BalancesTab />}
        {tab === 'Settings'  && <SettingsTab />}
      </div>
    </div>
  );
}
