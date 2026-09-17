import React, { useState, useEffect, useCallback } from 'react';
import api from '../utils/apiClient';
import useToastStore from '../store/toastStore';
import useProcessingStore from '../store/processingStore';
import { useIcon } from '../providers/IconProvider';

const TABS = [
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'duplicate', label: 'Duplicate' },
];

function StatusBadge({ status }) {
  const map = {
    pending:   { bg: 'var(--color-surface)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' },
    approved:  { bg: '#d1fae5', color: '#065f46' },
    rejected:  { bg: '#fee2e2', color: '#991b1b' },
    duplicate: { bg: '#fee2e2', color: '#991b1b' },
  };
  const s = map[status] || map.pending;
  return <span className="text-xs px-2 py-0.5 rounded-full font-medium capitalize" style={s}>{status}</span>;
}

function CreatedPaidBadges({ row }) {
  return (
    <div className="flex gap-1">
      {row.expenseCreated && (
        <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: '#d1fae5', color: '#065f46' }}>Created</span>
      )}
      {row.paid && (
        <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: '#dbeafe', color: '#1e40af' }}>Paid</span>
      )}
    </div>
  );
}

function EditableCell({ value, onChange, type = 'text' }) {
  return (
    <input
      type={type}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className="text-xs px-1.5 py-1 rounded w-full"
      style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
    />
  );
}

export default function ExpenseReviewPage() {
  const getIcon = useIcon();
  const addToast = useToastStore((s) => s.addToast);
  const { startProcessing, stopProcessing } = useProcessingStore();

  const [tab, setTab] = useState('pending');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [edits, setEdits] = useState({}); // id -> { vendor, amount, invoiceDate, category }

  const load = useCallback(async (status) => {
    setLoading(true);
    try {
      const res = await api.get(`/api/expense-review?reviewStatus=${status}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load review queue');
      setRows(data || []);
      setSelected(new Set());
    } catch (err) {
      addToast(err.message || 'Failed to load review queue', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { load(tab); }, [tab, load]);

  const editField = (id, field, value) => {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  };

  const getVal = (row, field) => edits[row.id]?.[field] ?? row[field] ?? '';

  // No dedicated column for this — it comes from the extraction's own judgement
  // (rawExtraction.gstIncluded, set by the model reading the invoice), editable here before
  // Create Expense since the model can get it wrong (e.g. a supplier that omits a clear GST line).
  const getGst = (row) => edits[row.id]?.gstIncluded ?? row.rawExtraction?.gstIncluded ?? false;

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))));
  };

  const buildItems = () => Array.from(selected).map((id) => {
    const e = edits[id] || {};
    return { id, ...e };
  });

  const openAttachment = async (id) => {
    try {
      const res = await api.get(`/api/expense-review/${id}/attachment`);
      if (!res.ok) throw new Error('Failed to fetch attachment');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      addToast('Failed to open attachment: ' + err.message, 'error');
    }
  };

  const handleReject = async (id) => {
    try {
      const res = await api.post(`/api/expense-review/${id}/reject`, {});
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed to reject'); }
      addToast('Rejected', 'success');
      load(tab);
    } catch (err) {
      addToast(err.message || 'Failed to reject', 'error');
    }
  };

  const handleBulkCreate = async () => {
    if (!selected.size) return;
    startProcessing('Creating expense(s)…', `Posting ${selected.size} invoice(s) to Finance.`);
    try {
      const res = await api.post('/api/expense-review/bulk-create-expenses', { items: buildItems() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create expenses');
      const failed = (data.results || []).filter((r) => !r.ok);
      if (failed.length) { addToast(`${failed.length} failed to create — see console`, 'error'); console.error('bulk-create-expenses failures:', failed); }
      else addToast('Expense(s) created', 'success');
      load(tab);
    } catch (err) {
      addToast(err.message || 'Failed to create expenses', 'error');
    } finally {
      stopProcessing();
    }
  };

  const handleBulkMarkPaid = async () => {
    if (!selected.size) return;
    startProcessing('Marking as paid…', `Updating ${selected.size} row(s).`);
    try {
      const res = await api.post('/api/expense-review/bulk-mark-paid', { items: Array.from(selected) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to mark paid');
      const failed = (data.results || []).filter((r) => !r.ok);
      if (failed.length) { addToast(`${failed.length} failed — see console`, 'error'); console.error('bulk-mark-paid failures:', failed); }
      else addToast('Marked as paid', 'success');
      load(tab);
    } catch (err) {
      addToast(err.message || 'Failed to mark paid', 'error');
    } finally {
      stopProcessing();
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Invoice Review</h1>
      </div>

      <div className="flex gap-2 mb-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="text-xs px-2.5 py-1 rounded-full font-medium transition-colors"
            style={tab === t.id
              ? { background: 'var(--color-primary)', color: '#fff' }
              : { background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-2 mb-3 p-2 rounded" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{selected.size} selected</span>
          <button onClick={handleBulkCreate} className="text-xs px-2.5 py-1 rounded-full font-medium hover:opacity-70 transition-colors" style={{ background: 'var(--color-primary)', color: '#fff' }}>
            Create Expense(s)
          </button>
          <button onClick={handleBulkMarkPaid} className="text-xs px-2.5 py-1 rounded-full font-medium hover:opacity-70 transition-colors" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
            Mark as Paid
          </button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
              <th className="text-left py-2 px-2">
                <input type="checkbox" checked={rows.length > 0 && selected.size === rows.length} onChange={toggleSelectAll} />
              </th>
              <th className="text-left py-2 px-2">Vendor</th>
              <th className="text-left py-2 px-2">Amount</th>
              <th className="text-left py-2 px-2">Invoice date</th>
              <th className="text-left py-2 px-2">Category</th>
              <th className="text-left py-2 px-2">GST</th>
              <th className="text-left py-2 px-2">Source</th>
              <th className="text-left py-2 px-2">Status</th>
              <th className="text-left py-2 px-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={9} className="py-4 px-2 text-xs" style={{ color: 'var(--color-muted)' }}>Loading…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={9} className="py-4 px-2 text-xs" style={{ color: 'var(--color-muted)' }}>No {tab} invoices.</td></tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td className="py-2 px-2">
                  <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggleSelect(row.id)} />
                </td>
                <td className="py-2 px-2 w-40">
                  <EditableCell value={getVal(row, 'vendor')} onChange={(v) => editField(row.id, 'vendor', v)} />
                </td>
                <td className="py-2 px-2 w-24">
                  <EditableCell type="number" value={getVal(row, 'amount')} onChange={(v) => editField(row.id, 'amount', v)} />
                </td>
                <td className="py-2 px-2 w-32">
                  <EditableCell type="date" value={getVal(row, 'invoiceDate') ? String(getVal(row, 'invoiceDate')).slice(0, 10) : ''} onChange={(v) => editField(row.id, 'invoiceDate', v)} />
                </td>
                <td className="py-2 px-2 w-32">
                  <EditableCell value={getVal(row, 'category')} onChange={(v) => editField(row.id, 'category', v)} />
                </td>
                <td className="py-2 px-2 text-center">
                  <input
                    type="checkbox"
                    checked={getGst(row)}
                    onChange={(e) => editField(row.id, 'gstIncluded', e.target.checked)}
                    title="Amount includes 10% GST"
                  />
                </td>
                <td className="py-2 px-2">
                  <button onClick={() => openAttachment(row.id)} className="hover:opacity-70 transition-colors inline-flex items-center gap-1 text-xs" style={{ color: 'var(--color-primary)' }}>
                    {getIcon('file', { size: 12 })} PDF
                  </button>
                </td>
                <td className="py-2 px-2">
                  <div className="flex flex-col gap-1">
                    <StatusBadge status={row.reviewStatus} />
                    <CreatedPaidBadges row={row} />
                  </div>
                </td>
                <td className="py-2 px-2">
                  {row.reviewStatus === 'pending' && (
                    <button onClick={() => handleReject(row.id)} className="text-xs hover:opacity-70 transition-colors" style={{ color: '#991b1b' }}>
                      Reject
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
