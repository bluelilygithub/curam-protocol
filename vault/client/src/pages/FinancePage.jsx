import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  return new Date().toISOString().slice(0, 10);
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

function StatusBadge({ status }) {
  const map = {
    draft: { bg: 'var(--color-surface)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' },
    sent:  { bg: '#dbeafe', color: '#1e40af' },
    paid:  { bg: '#d1fae5', color: '#065f46' },
    void:  { bg: '#fee2e2', color: '#991b1b' },
  };
  const s = map[status] || map.draft;
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={s}>
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

// ── Dashboard ──────────────────────────────────────────────────────────────────

function DashboardTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/finance/dashboard')
      .then(r => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6 text-sm" style={{ color: 'var(--color-muted)' }}>Loading...</div>;
  if (!data) return null;

  const net = parseFloat((data.yearRevenue - data.yearExpenses - data.yearWages).toFixed(2));

  const cards = [
    { label: 'Revenue YTD',      value: fmt(data.yearRevenue),       sub: `${data.paidInvoices} paid invoices`          },
    { label: 'Outstanding',      value: fmt(data.outstandingAmount), sub: `${data.outstandingCount} unpaid`, warn: data.outstandingCount > 0 },
    { label: 'Expenses YTD',     value: fmt(data.yearExpenses),      sub: 'ex GST'                                       },
    { label: 'Wages YTD',        value: fmt(data.yearWages),         sub: 'gross wages'                                  },
    { label: 'Net Profit (est)', value: fmt(net),                    sub: 'revenue − expenses − wages', neg: net < 0    },
  ];

  return (
    <div className="p-6">
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
  const [form, setForm] = useState({ name: '', email: '', phone: '', address: '', abn: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const addToast = useToastStore(s => s.addToast);

  const load = useCallback(() => {
    api.get('/api/finance/clients').then(r => r.json()).then(d => setClients(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const openNew  = () => { setForm({ name: '', email: '', phone: '', address: '', abn: '' }); setError(''); setModal('new'); };
  const openEdit = (c) => { setForm({ name: c.name, email: c.email||'', phone: c.phone||'', address: c.address||'', abn: c.abn||'' }); setError(''); setModal(c); };

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
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold" style={{ color: 'var(--color-text)' }}>Clients</h2>
        <Btn onClick={openNew}>+ New Client</Btn>
      </div>

      {clients.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No clients yet.</p>
      ) : (
        <div className="flex flex-col gap-2 max-w-2xl">
          {clients.map(c => (
            <div
              key={c.id}
              className="flex items-center justify-between p-3 rounded-lg border"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
            >
              <div>
                <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{c.name}</div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                  {[c.email, c.abn && `ABN ${c.abn}`].filter(Boolean).join(' · ') || 'No contact info'}
                </div>
              </div>
              <div className="flex gap-2">
                <Btn variant="secondary" onClick={() => openEdit(c)}>Edit</Btn>
                <button
                  onClick={() => del(c.id, c.name)}
                  className="text-xs px-2 py-1 rounded border hover:opacity-70 transition-opacity"
                  style={{ color: '#ef4444', borderColor: '#fca5a5' }}
                >Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <Modal title={modal === 'new' ? 'New Client' : 'Edit Client'} onClose={() => setModal(null)}>
          <div className="flex flex-col gap-3">
            <Field label="Name *"><Input value={form.name} onChange={v => setForm(p => ({...p, name: v}))} placeholder="Client name" /></Field>
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

const BLANK_ITEM = { description: '', qty: '1', unitPrice: '', gstApplies: true };

function calcTotals(items) {
  let subtotal = 0, gst = 0;
  for (const item of items) {
    const amt = (parseFloat(item.qty) || 0) * (parseFloat(item.unitPrice) || 0);
    subtotal += amt;
    if (item.gstApplies) gst += amt * 0.1;
  }
  return { subtotal: subtotal.toFixed(2), gst: gst.toFixed(2), total: (subtotal + gst).toFixed(2) };
}

function InvoicesTab() {
  const [invoices, setInvoices] = useState([]);
  const [clients, setClients] = useState([]);
  const [modal, setModal] = useState(null);
  const [viewInvoice, setViewInvoice] = useState(null);
  const [sendModal, setSendModal] = useState(null); // invoice to send
  const [sendTo, setSendTo] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmModal, setConfirmModal] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(null);
  const addToast = useToastStore(s => s.addToast);

  const blankForm = () => ({ clientId: '', issueDate: todayStr(), dueDate: '', notes: '', items: [{ ...BLANK_ITEM }] });
  const [form, setForm] = useState(blankForm);

  const load = useCallback(async () => {
    const [invs, cls] = await Promise.all([
      api.get('/api/finance/invoices').then(r => r.json()),
      api.get('/api/finance/clients').then(r => r.json()),
    ]);
    setInvoices(Array.isArray(invs) ? invs : []);
    setClients(Array.isArray(cls) ? cls : []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openNew = () => { setForm(blankForm()); setError(''); setModal('new'); };

  const openEdit = async (inv) => {
    if (inv.status === 'paid') return; // paid invoices are read-only
    const data = await api.get(`/api/finance/invoices/${inv.id}`).then(r => r.json());
    setForm({
      clientId:  data.clientId ? String(data.clientId) : '',
      issueDate: data.issueDate ? String(data.issueDate).slice(0,10) : todayStr(),
      dueDate:   data.dueDate  ? String(data.dueDate).slice(0,10)  : '',
      notes:     data.notes || '',
      items:     data.items.length
        ? data.items.map(i => ({ description: i.description, qty: String(i.qty), unitPrice: String(i.unitPrice), gstApplies: parseFloat(i.gst) > 0 }))
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
      const payload = { ...form, clientId: form.clientId || null };
      if (modal === 'new') {
        await api.post('/api/finance/invoices', payload);
      } else {
        await api.put(`/api/finance/invoices/${modal.id}`, { ...payload, status: modal.status });
      }
      await load();
      setModal(null);
      addToast(modal === 'new' ? 'Invoice created' : 'Invoice updated');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const markPaid = (inv) => {
    setConfirmModal({
      title: 'Mark as Paid',
      message: `Mark ${inv.number} as paid today?`,
      confirmLabel: 'Mark Paid',
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await api.post(`/api/finance/invoices/${inv.id}/mark-paid`, { paidAt: todayStr() });
          await load();
          if (viewInvoice?.id === inv.id) setViewInvoice(null);
          addToast(`${inv.number} marked paid`);
        } catch (e) {
          addToast(e.message, 'error');
        }
      },
    });
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

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold" style={{ color: 'var(--color-text)' }}>Invoices</h2>
        <Btn onClick={openNew}>+ New Invoice</Btn>
      </div>

      {invoices.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No invoices yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
                {['Number', 'Client', 'Issued', 'Due', 'Total', 'Status', ''].map(h => (
                  <th key={h} className="text-left py-2 px-2 text-xs font-semibold" style={{ color: 'var(--color-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => (
                <tr key={inv.id} className="border-b hover:opacity-80 transition-opacity" style={{ borderColor: 'var(--color-border)' }}>
                  <td className="py-2 px-2">
                    <button onClick={() => viewDetail(inv)} className="font-medium hover:underline" style={{ color: 'var(--color-primary)' }}>
                      {inv.number}
                    </button>
                  </td>
                  <td className="py-2 px-2" style={{ color: 'var(--color-text)' }}>{inv.clientName || '—'}</td>
                  <td className="py-2 px-2 text-xs" style={{ color: 'var(--color-muted)' }}>{fmtDate(inv.issueDate)}</td>
                  <td className="py-2 px-2 text-xs" style={{ color: 'var(--color-muted)' }}>{fmtDate(inv.dueDate)}</td>
                  <td className="py-2 px-2 font-medium" style={{ color: 'var(--color-text)' }}>{fmt(inv.total)}</td>
                  <td className="py-2 px-2"><StatusBadge status={inv.status} /></td>
                  <td className="py-2 px-2">
                    <div className="flex gap-1 flex-wrap">
                      {inv.status === 'draft' && (
                        <button onClick={() => openSend(inv)} className="text-xs px-2 py-0.5 rounded border hover:opacity-70" style={{ color: '#1e40af', borderColor: '#bfdbfe' }}>Send</button>
                      )}
                      {inv.status === 'sent' && (
                        <button onClick={() => openSend(inv)} className="text-xs px-2 py-0.5 rounded border hover:opacity-70" style={{ color: '#1e40af', borderColor: '#bfdbfe' }}>Resend</button>
                      )}
                      {(inv.status === 'draft' || inv.status === 'sent') && (
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
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Invoice builder modal */}
      {modal && (
        <Modal title={modal === 'new' ? 'New Invoice' : `Edit ${modal.number}`} onClose={() => setModal(null)} wide>
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Client">
                <Sel value={form.clientId} onChange={v => setForm(p => ({...p, clientId: v}))}>
                  <option value="">— No client —</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Sel>
              </Field>
              <Field label="Issue Date">
                <Input type="date" value={form.issueDate} onChange={v => setForm(p => ({...p, issueDate: v}))} />
              </Field>
              <Field label="Due Date">
                <Input type="date" value={form.dueDate} onChange={v => setForm(p => ({...p, dueDate: v}))} />
              </Field>
              <Field label="Notes">
                <Input value={form.notes} onChange={v => setForm(p => ({...p, notes: v}))} placeholder="Payment terms, reference…" />
              </Field>
            </div>

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
              <div className="text-xs mb-1 grid gap-1" style={{ gridTemplateColumns: '1fr 60px 90px 60px 24px', color: 'var(--color-muted)' }}>
                <span>Description</span><span>Qty</span><span>Unit Price</span><span className="text-center">GST</span><span />
              </div>
              <div className="flex flex-col gap-2">
                {form.items.map((item, idx) => (
                  <div key={idx} className="grid gap-1 items-center" style={{ gridTemplateColumns: '1fr 60px 90px 60px 24px' }}>
                    <Input value={item.description} onChange={v => setItem(idx, 'description', v)} placeholder="Description" />
                    <Input value={item.qty}         onChange={v => setItem(idx, 'qty', v)}         type="number" />
                    <Input value={item.unitPrice}   onChange={v => setItem(idx, 'unitPrice', v)}   type="number" placeholder="0.00" />
                    <div className="flex items-center justify-center gap-1">
                      <input
                        type="checkbox"
                        id={`gst-${idx}`}
                        checked={item.gstApplies}
                        onChange={e => setItem(idx, 'gstApplies', e.target.checked)}
                      />
                      <label htmlFor={`gst-${idx}`} className="text-xs" style={{ color: 'var(--color-muted)' }}>10%</label>
                    </div>
                    <button onClick={() => removeItem(idx)} className="text-xs rounded hover:opacity-60 text-center" style={{ color: '#ef4444' }}>✕</button>
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
              <Btn onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Invoice'}</Btn>
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
                    <td className="py-1.5">{item.description}</td>
                    <td className="py-1.5 text-right">{item.qty}</td>
                    <td className="py-1.5 text-right">{fmt(item.unitPrice)}</td>
                    <td className="py-1.5 text-right">{fmt(item.gst)}</td>
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

const BLANK_EXPENSE = { date: '', description: '', amount: '', gstIncluded: true, category: '', supplier: '' };

function ExpensesTab() {
  const [expenses, setExpenses]     = useState([]);
  const [showForm, setShowForm]     = useState(false);
  const [editingExpense, setEditing] = useState(null);
  const [form, setForm]             = useState({ ...BLANK_EXPENSE, date: todayStr() });
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');
  const [confirmModal, setConfirmModal] = useState(null);
  const [receiptModal, setReceiptModal] = useState(null);   // { expense } — upload modal
  const [viewReceiptModal, setViewReceiptModal] = useState(null); // { expense, url, isPdf }
  const [receiptUploading, setReceiptUploading] = useState(false);
  const receiptInputRef = useRef(null);
  const addToast = useToastStore(s => s.addToast);

  const autoGst = form.gstIncluded && form.amount
    ? (parseFloat(form.amount) / 11).toFixed(2)
    : '0.00';

  const load = useCallback(() => {
    api.get('/api/finance/expenses').then(r => r.json()).then(d => setExpenses(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

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
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold" style={{ color: 'var(--color-text)' }}>Expenses</h2>
        <Btn onClick={showForm ? cancelForm : openNew}>{showForm ? 'Cancel' : '+ Add Expense'}</Btn>
      </div>

      {showForm && (
        <div className="mb-5 p-4 rounded-xl border" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <Field label="Date"><Input type="date" value={form.date} onChange={v => setForm(p => ({...p, date: v}))} /></Field>
            <Field label="Supplier"><Input value={form.supplier} onChange={v => setForm(p => ({...p, supplier: v}))} placeholder="Supplier name" /></Field>
            <Field label="Description"><Input value={form.description} onChange={v => setForm(p => ({...p, description: v}))} placeholder="What was purchased" /></Field>
            <Field label="Category"><CategoryInput value={form.category} onChange={v => setForm(p => ({...p, category: v}))} /></Field>
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
                {['Date', 'Description', 'Supplier', 'Ex-GST', 'GST', 'Total', 'Category', '', ''].map(h => (
                  <th key={h} className="text-left py-2 px-2 text-xs font-semibold" style={{ color: 'var(--color-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {expenses.map(e => (
                <tr key={e.id} className="border-b hover:opacity-80" style={{ borderColor: 'var(--color-border)' }}>
                  <td className="py-2 px-2 text-xs whitespace-nowrap" style={{ color: 'var(--color-muted)' }}>{fmtDate(e.date)}</td>
                  <td className="py-2 px-2" style={{ color: 'var(--color-text)' }}>{e.description}</td>
                  <td className="py-2 px-2 text-xs" style={{ color: 'var(--color-muted)' }}>{e.supplier || '—'}</td>
                  <td className="py-2 px-2 font-medium" style={{ color: 'var(--color-text)' }}>{fmt(e.amount)}</td>
                  <td className="py-2 px-2" style={{ color: 'var(--color-muted)' }}>{fmt(e.gst)}</td>
                  <td className="py-2 px-2 font-medium" style={{ color: 'var(--color-text)' }}>{fmt(parseFloat(e.amount) + parseFloat(e.gst || 0))}</td>
                  <td className="py-2 px-2 text-xs" style={{ color: 'var(--color-muted)' }}>{e.category || '—'}</td>
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

function WagesTab() {
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
              {wages.map(w => (
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

// ── Journal ───────────────────────────────────────────────────────────────────

function JournalTab() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/finance/journal')
      .then(r => r.json())
      .then(d => setEntries(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6 text-sm" style={{ color: 'var(--color-muted)' }}>Loading...</div>;

  return (
    <div className="p-6">
      <h2 className="font-semibold mb-4" style={{ color: 'var(--color-text)' }}>Journal</h2>

      {entries.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          No journal entries yet. Entries are auto-generated when invoices, expenses, and wages are recorded.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {entries.map(entry => (
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
                </div>
              </div>
              <table className="w-full text-xs">
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
                      <td className="text-right py-0.5 font-mono" style={{ color: 'var(--color-text)' }}>
                        {parseFloat(line.debit) > 0 ? fmt(line.debit) : ''}
                      </td>
                      <td className="text-right py-0.5 font-mono" style={{ color: 'var(--color-text)' }}>
                        {parseFloat(line.credit) > 0 ? fmt(line.credit) : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
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
        const done    = i < current;
        const active  = i === current;
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

function BASTab() {
  const now  = new Date();
  const yr   = now.getMonth() < 6 ? now.getFullYear() : now.getFullYear() + 1;
  const prev = yr - 1;

  const quarters = [
    { label: `Q1 Jul–Sep ${prev}`, from: `${prev}-07-01`, to: `${prev}-09-30` },
    { label: `Q2 Oct–Dec ${prev}`, from: `${prev}-10-01`, to: `${prev}-12-31` },
    { label: `Q3 Jan–Mar ${yr}`,   from: `${yr}-01-01`,   to: `${yr}-03-31`   },
    { label: `Q4 Apr–Jun ${yr}`,   from: `${yr}-04-01`,   to: `${yr}-06-30`   },
  ];

  const [qIdx, setQIdx]     = useState(() => {
    const m = now.getMonth();
    if (m >= 0 && m <= 2) return 2;
    if (m >= 3 && m <= 5) return 3;
    if (m >= 6 && m <= 8) return 0;
    return 1;
  });
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(false);
  const [stepping, setStepping] = useState(false);
  const [stepError, setStepError] = useState('');
  const [confirmPay, setConfirmPay] = useState(false);
  const addToast = useToastStore(s => s.addToast);

  const calc = useCallback(async () => {
    setLoading(true);
    setData(null);
    setStepError('');
    const q = quarters[qIdx];
    try {
      const result = await api.get(`/api/finance/bas?from=${q.from}&to=${q.to}`).then(r => r.json());
      setData(result);
    } catch {}
    finally { setLoading(false); }
  }, [qIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { calc(); }, [calc]);

  const doStep = async (confirmed = false) => {
    if (!data?.quarterId) return;
    if (data.status === 'lodged' && !confirmed) { setConfirmPay(true); return; }
    setStepping(true);
    setStepError('');
    try {
      const id = data.quarterId;
      if (data.status === 'open')       await api.post(`/api/finance/bas/${id}/reconcile`, {});
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
  const timestamps = data ? [
    data.reconciledAt && `Reconciled ${new Date(data.reconciledAt).toLocaleString('en-AU')}`,
    data.lodgedAt     && `Lodged ${new Date(data.lodgedAt).toLocaleString('en-AU')}`,
    data.paidAt       && `Paid ${new Date(data.paidAt).toLocaleString('en-AU')}`,
  ].filter(Boolean) : [];

  return (
    <div className="p-6 max-w-xl">
      <h2 className="font-semibold mb-4" style={{ color: 'var(--color-text)' }}>Business Activity Statement</h2>

      <div className="mb-5">
        <Field label="Quarter">
          <Sel value={qIdx} onChange={v => { setQIdx(Number(v)); }}>
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
              {timestamps.map(t => (
                <p key={t} className="text-xs" style={{ color: 'var(--color-muted)' }}>{t}</p>
              ))}
            </div>
          )}

          {data.status === 'paid' ? (
            <div
              className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm"
              style={{ background: '#d1fae5', color: '#065f46', border: '1px solid #a7f3d0' }}
            >
              <span>✓</span>
              <span>This BAS quarter is locked — payment has been recorded and journal entries created.</span>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {stepError && <p className="text-xs" style={{ color: '#ef4444' }}>{stepError}</p>}
              <Btn onClick={() => doStep()} disabled={stepping}>
                {stepping ? 'Updating…' : actionLabels[data.status]}
              </Btn>
            </div>
          )}
        </>
      )}

      {confirmPay && (
        <ConfirmModal
          title="Record BAS Payment"
          message={`This will create a journal entry for the GST settlement (${fmt(data?.netGst)}) and lock this quarter. Continue?`}
          confirmLabel="Record Payment"
          onConfirm={() => { setConfirmPay(false); doStep(true); }}
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

// ── Main ──────────────────────────────────────────────────────────────────────

const TABS = ['Dashboard', 'Invoices', 'Clients', 'Expenses', 'Wages', 'Journal', 'BAS', 'Settings'];

export default function FinancePage() {
  const [tab, setTab] = useState('Dashboard');

  return (
    <div className="flex flex-col h-full">
      {/* Header + tabs */}
      <div className="flex-shrink-0 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <div className="px-6 pt-4 pb-0">
          <div className="flex items-center gap-2 mb-3">
            <span style={{ fontSize: 20 }}>💰</span>
            <h1 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>Curam Finance</h1>
          </div>
          <div className="flex gap-0 overflow-x-auto">
            {TABS.map(t => (
              <button
                key={t}
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

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {tab === 'Dashboard' && <DashboardTab />}
        {tab === 'Invoices'  && <InvoicesTab />}
        {tab === 'Clients'   && <ClientsTab />}
        {tab === 'Expenses'  && <ExpensesTab />}
        {tab === 'Wages'     && <WagesTab />}
        {tab === 'Journal'   && <JournalTab />}
        {tab === 'BAS'       && <BASTab />}
        {tab === 'Settings'  && <SettingsTab />}
      </div>
    </div>
  );
}
