import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import useProcessingStore from '../../store/processingStore';

// Statement upload & reconciliation (docs/shares-statement-import.md).
// Full review queue, nothing auto-applied — every extracted line needs an
// explicit approve/edit/reject before it touches share_trades/share_cash_ledger.

const LINE_TYPE_LABEL = {
  trade: 'Trade', dividend: 'Dividend', interest: 'Interest', fee: 'Fee',
  drp: 'DRP (dividend reinvestment)', cash_balance: 'Cash balance', fx: 'FX conversion',
};

const MATCH_STATUS_STYLE = {
  matches_existing: { bg: '#f0fdf4', color: '#16a34a', label: 'Matches existing' },
  new:              { bg: '#eff6ff', color: '#2563eb', label: 'New' },
  conflict:         { bg: '#fef2f2', color: '#dc2626', label: 'Conflict' },
  possible_correction: { bg: '#fffbeb', color: '#d97706', label: 'Possible correction' },
  skipped_duplicate:   { bg: '#f5f5f0', color: '#888', label: 'Already imported' },
  needs_review:     { bg: '#f5f5f0', color: '#888', label: 'Needs review' },
};

function Badge({ bg, color, label }) {
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: bg, color }}>
      {label}
    </span>
  );
}

function fmtMoney(n) {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(n);
}

function LineRow({ line, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState(line.parsedFields);
  const [saving, setSaving] = useState(false);
  const addToast = useToastStore((s) => s.addToast);

  const f = line.parsedFields;
  const statusStyle = MATCH_STATUS_STYLE[line.matchStatus] || MATCH_STATUS_STYLE.needs_review;
  const isPending = line.reviewDecision === 'pending';

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/api/shares/statements/lines/${line.id}`, fields).then((r) => r.json());
      setEditing(false);
      onChanged();
    } catch (e) {
      addToast(e.message || 'Failed to save edit', 'error');
    } finally {
      setSaving(false);
    }
  };

  const approve = async () => {
    setSaving(true);
    try {
      const res = await api.post(`/api/shares/statements/lines/${line.id}/approve`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Approve failed');
      addToast('Applied to your ledger');
      onChanged();
    } catch (e) {
      addToast(e.message || 'Approve failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const reject = async () => {
    setSaving(true);
    try {
      await api.post(`/api/shares/statements/lines/${line.id}/reject`);
      onChanged();
    } catch (e) {
      addToast(e.message || 'Reject failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="py-3 border-b last:border-b-0" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            {LINE_TYPE_LABEL[line.lineType] || line.lineType}
          </span>
          {f.symbol && <span className="text-sm" style={{ color: 'var(--color-muted)' }}>{f.symbol}</span>}
          <span className="text-sm" style={{ color: 'var(--color-muted)' }}>{f.date}</span>
          <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{fmtMoney(f.amount)}</span>
          <Badge {...statusStyle} />
          {!isPending && (
            <Badge
              bg={line.reviewDecision === 'approved' ? '#f0fdf4' : '#f5f5f0'}
              color={line.reviewDecision === 'approved' ? '#16a34a' : '#888'}
              label={line.reviewDecision === 'approved' ? 'Applied' : 'Rejected'}
            />
          )}
        </div>
        {isPending && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={() => setEditing((e) => !e)} className="text-xs hover:opacity-70" style={{ color: 'var(--color-primary)' }}>
              {editing ? 'Cancel edit' : 'Edit'}
            </button>
            <button onClick={reject} disabled={saving} className="text-xs px-2 py-1 rounded border hover:opacity-70 disabled:opacity-40" style={{ color: '#ef4444', borderColor: '#fca5a5' }}>
              Reject
            </button>
            <button onClick={approve} disabled={saving} className="text-xs px-3 py-1 rounded font-medium disabled:opacity-40" style={{ background: 'var(--color-primary)', color: '#fff' }}>
              {saving ? '…' : 'Approve'}
            </button>
          </div>
        )}
      </div>

      {f.description && <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{f.description}</p>}

      {(line.matchStatus === 'possible_correction' || line.matchStatus === 'conflict') && (
        <p className="text-xs mt-1" style={{ color: '#d97706' }}>
          {line.matchStatus === 'possible_correction'
            ? 'A different amount already exists for this date/type — check before approving; approving adds a second entry rather than replacing the old one.'
            : 'A matching trade exists but fees or FX rate differ from this statement — review before approving.'}
        </p>
      )}

      {editing && (
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {['date', 'symbol', 'amount', 'quantity', 'pricePerUnit', 'fxRateToAud', 'feesAud', 'withholdingTaxAud'].map((k) => (
            fields[k] !== undefined || ['amount', 'date', 'symbol'].includes(k) ? (
              <div key={k}>
                <label className="text-[10px] uppercase block mb-0.5" style={{ color: 'var(--color-muted)' }}>{k}</label>
                <input
                  value={fields[k] ?? ''}
                  onChange={(e) => setFields((p) => ({ ...p, [k]: e.target.value }))}
                  className="w-full px-2 py-1 text-xs rounded border"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />
              </div>
            ) : null
          ))}
          <div className="col-span-full">
            <button onClick={save} disabled={saving} className="text-xs px-3 py-1 rounded font-medium disabled:opacity-40" style={{ background: 'var(--color-primary)', color: '#fff' }}>
              {saving ? 'Saving…' : 'Save edit'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ImportDetail({ importId, onClose, onChanged }) {
  const [detail, setDetail] = useState(null);
  const addToast = useToastStore((s) => s.addToast);

  const load = useCallback(() => {
    api.get(`/api/shares/statements/${importId}`).then((r) => r.json()).then(setDetail).catch(() => {});
  }, [importId]);

  useEffect(() => { load(); }, [load]);

  const revert = async () => {
    try {
      await api.post(`/api/shares/statements/${importId}/revert`);
      addToast('Import reverted — applied entries removed from your ledger');
      load();
      onChanged();
    } catch (e) {
      addToast(e.message || 'Revert failed', 'error');
    }
  };

  if (!detail) return <p className="text-sm py-4" style={{ color: 'var(--color-muted)' }}>Loading…</p>;

  const anyApplied = detail.lines.some((l) => l.reviewDecision === 'approved');

  return (
    <div className="mt-3 rounded-xl border p-4" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{detail.import.filename}</p>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            {detail.import.periodStart} → {detail.import.periodEnd} · {detail.lines.length} line(s)
          </p>
        </div>
        <div className="flex items-center gap-2">
          {anyApplied && detail.import.status !== 'reverted' && (
            <button onClick={revert} className="text-xs px-2 py-1 rounded border hover:opacity-70" style={{ color: '#ef4444', borderColor: '#fca5a5' }}>
              Revert import
            </button>
          )}
          <button onClick={onClose} className="text-xs hover:opacity-60" style={{ color: 'var(--color-muted)' }}>✕ Close</button>
        </div>
      </div>
      {detail.lines.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No line items were extracted from this statement.</p>
      )}
      {detail.lines.map((line) => (
        <LineRow key={line.id} line={line} onChanged={load} />
      ))}
    </div>
  );
}

export default function SharesStatementsTab({ onImported }) {
  const [imports, setImports] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const addToast = useToastStore((s) => s.addToast);
  const { startProcessing, stopProcessing } = useProcessingStore();

  const loadImports = useCallback(() => {
    api.get('/api/shares/statements').then((r) => r.json()).then(setImports).catch(() => {});
  }, []);

  useEffect(() => { loadImports(); }, [loadImports]);

  const onFileChosen = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    startProcessing('Reading your statement…', 'Extracting line items — this can take a moment for a long statement.');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.postForm('/api/shares/statements/upload', formData);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      addToast(
        data.overlapWarning
          ? `Extracted ${data.lines.length} line(s). ${data.overlapWarning}`
          : `Extracted ${data.lines.length} line(s) — review below`
      );
      loadImports();
      setExpandedId(data.import.id);
    } catch (err) {
      addToast(err.message || 'Upload failed', 'error');
    } finally {
      setUploading(false);
      stopProcessing();
    }
  };

  return (
    <div>
      <div className="flex items-start justify-between mb-4 gap-4 flex-wrap">
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Statement upload & reconciliation</p>
          <p className="text-xs mt-0.5 max-w-lg" style={{ color: 'var(--color-muted)' }}>
            Upload a broker PDF statement — trades, dividends, interest, and fees are extracted and shown here for
            review. Nothing is added to your trades/cash records until you approve each line.
          </p>
        </div>
        <div>
          <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden" onChange={onFileChosen} />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="text-sm px-4 py-1.5 rounded-md hover:opacity-70 transition-opacity duration-200 disabled:opacity-40 flex-shrink-0"
            style={{ background: 'var(--color-primary)', color: '#fff' }}
          >
            {uploading ? 'Uploading…' : '+ Upload statement (PDF)'}
          </button>
        </div>
      </div>

      {imports.length === 0 && (
        <p className="text-sm text-center py-8" style={{ color: 'var(--color-muted)' }}>
          No statements uploaded yet.
        </p>
      )}

      {imports.map((imp) => (
        <div key={imp.id}>
          <div
            className="flex items-center justify-between py-2.5 border-b cursor-pointer hover:opacity-80"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={() => setExpandedId(expandedId === imp.id ? null : imp.id)}
          >
            <div>
              <span className="text-sm" style={{ color: 'var(--color-text)' }}>{imp.filename}</span>
              <span className="text-xs ml-2" style={{ color: 'var(--color-muted)' }}>
                {imp.periodStart ? `${imp.periodStart} → ${imp.periodEnd}` : ''} · {imp.lineCount} line(s)
                {imp.pendingCount > 0 ? ` · ${imp.pendingCount} pending review` : ''}
              </span>
            </div>
            <Badge
              bg={imp.status === 'reverted' ? '#f5f5f0' : imp.pendingCount > 0 ? '#fffbeb' : '#f0fdf4'}
              color={imp.status === 'reverted' ? '#888' : imp.pendingCount > 0 ? '#d97706' : '#16a34a'}
              label={imp.status === 'reverted' ? 'Reverted' : imp.pendingCount > 0 ? 'Needs review' : 'Reviewed'}
            />
          </div>
          {expandedId === imp.id && (
            <ImportDetail importId={imp.id} onClose={() => setExpandedId(null)} onChanged={() => { loadImports(); onImported?.(); }} />
          )}
        </div>
      ))}
    </div>
  );
}
