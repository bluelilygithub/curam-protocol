import React, { useState, useEffect, useCallback } from 'react';
import api from '../../utils/apiClient';
import Tooltip from '../../components/Tooltip';
import useToastStore from '../../store/toastStore';

// Review the lines read from an uploaded bank statement (server/routes/financeStatements.js).
// Each line is approved as Business or Personal; a suggested invoice/expense match can be kept or
// cleared. Nothing here posts to the books and the uploaded file is not changed.
// Modal, Btn and the formatters are passed in from FinancePage (they live there).

export default function StatementReview({ doc, onClose, onChanged, Modal, Btn, fmt, fmtDate }) {
  const addToast = useToastStore(s => s.addToast);
  const [st, setSt] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const read = useCallback(async () => {
    setError('');
    try {
      const res = await api.post(`/api/finance/statements/from-document/${doc.id}`, {});
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not read this statement');
      setSt(body);
      onChanged?.();
    } catch (e) { setError(e.message); }
  }, [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { read(); }, [read]);

  const patch = async (line, body) => {
    setBusy(true);
    try {
      const res = await api.patch(`/api/finance/statements/lines/${line.id}`, body);
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'Could not save');
      setSt(s => ({ ...s, lines: s.lines.map(l => (l.id === line.id ? out : l)) }));
      onChanged?.();
    } catch (e) { addToast(e.message, 'error'); } finally { setBusy(false); }
  };

  const approveAll = async () => {
    setBusy(true);
    try {
      const res = await api.post(`/api/finance/statements/${st.id}/approve-all`, { decision: 'business' });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'Could not save');
      setSt(out);
      onChanged?.();
    } catch (e) { addToast(e.message, 'error'); } finally { setBusy(false); }
  };

  const redact = async () => {
    setBusy(true);
    try {
      const res = await api.post(`/api/finance/statements/${st.id}/redact`, {});
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'Could not make the redacted copy');
      addToast(`Redacted copy saved in Documents: ${out.report.hiddenRows} personal row${out.report.hiddenRows === 1 ? '' : 's'}, balances and totals removed. Business charges ${fmt(out.report.businessTotal)}`);
      setSt(x => ({ ...x, redactedDocumentId: out.document.id }));
      onChanged?.();
    } catch (e) { addToast(e.message, 'error'); } finally { setBusy(false); }
  };

  const pending = st ? st.lines.filter(l => l.decision === 'pending').length : 0;
  const business = st ? st.lines.filter(l => l.decision === 'business').length : 0;
  const personal = st ? st.lines.filter(l => l.decision === 'personal').length : 0;
  // purchases, fees and interest marked business; payments and refunds are credits and are not netted off
  const businessCharges = st ? st.lines.filter(l => l.decision === 'business' && l.amount < 0).reduce((s, l) => s - l.amount, 0) : 0;
  const choice = (line, d, label, tip) => (
    <Tooltip text={tip}>
      <button
        disabled={busy}
        onClick={() => patch(line, { decision: line.decision === d ? 'pending' : d })}
        className="px-2 py-0.5 text-xs rounded transition-opacity hover:opacity-70 disabled:opacity-40"
        style={{
          border: '1px solid var(--color-border)',
          background: line.decision === d ? 'var(--color-primary)' : 'transparent',
          color: line.decision === d ? '#fff' : 'var(--color-text)',
        }}
      >{label}</button>
    </Tooltip>
  );

  return (
    <Modal title={`Statement lines — ${doc.title}`} onClose={onClose} wide>
      {error && (
        <div className="text-sm rounded-lg p-3" style={{ border: '1px solid #ef4444', color: '#ef4444' }}>
          {error}
          <div className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
            Nothing was saved. Only ANZ Plus account and ANZ credit card statements (PDF with a text layer) can be read so far; the file is kept in Documents either way.
          </div>
        </div>
      )}
      {!st && !error && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Reading the statement…</p>}
      {st && (
        <>
          <div className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>
            {st.bank} {st.product} · {st.kind === 'card' ? `Card ${st.accountNumber}` : `BSB ${st.bsb} · Account ${st.accountNumber}`} · {fmtDate(st.periodStart)} – {fmtDate(st.periodEnd)}
            <br />{st.kind === 'card' ? 'Owing at start' : 'Opening'} {fmt(st.openingBalance)} → {st.kind === 'card' ? 'owing at end' : 'closing'} {fmt(st.closingBalance)} (the lines add up to this{st.kind === 'card' ? ', and to the totals on the statement' : ''}).
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
              {business} business · {personal} personal · {pending} still to review{st.kind === 'card' ? ` · business charges ${fmt(businessCharges)}` : ''}
            </span>
            <Tooltip text="Mark every line you haven't decided yet as business. Lines you already marked are left alone.">
              <Btn onClick={approveAll} disabled={busy || !pending}>Approve all remaining as business</Btn>
            </Tooltip>
          </div>
          {st.kind === 'card' && (
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3 rounded-lg p-3" style={{ border: '1px solid var(--color-border)' }}>
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                {st.redactedDocumentId
                  ? 'A redacted copy is saved in Documents, with the business charges total on its last page. Making it again replaces that copy.'
                  : 'For your accountant: a copy with the personal rows, the running balances and the account-summary totals removed from the file itself, and a last page giving the total of the business charges. Your name, address and card number stay.'}
              </span>
              <Tooltip text={pending ? 'Decide every line first, then make the copy.' : 'Saves a second document. Your original statement is kept untouched and is left out of the accountant pack in its place.'}>
                <Btn onClick={redact} disabled={busy || pending > 0}>{st.redactedDocumentId ? 'Make the redacted copy again' : 'Create redacted copy'}</Btn>
              </Tooltip>
            </div>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs" style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
                <th className="py-2 pr-2">Date</th><th className="py-2 pr-2">Description</th>
                <th className="py-2 pr-2 text-right">Amount</th><th className="py-2 pr-2 text-right">{st?.kind === 'card' ? 'Owing' : 'Balance'}</th>
                <th className="py-2 pr-2">Matches</th><th className="py-2 text-right">Decision</th>
              </tr>
            </thead>
            <tbody>
              {st.lines.map(l => {
                const target = l.invoiceNumber ? `Invoice ${l.invoiceNumber}` : l.expenseDescription ? `Expense: ${l.expenseDescription}` : null;
                return (
                  <tr key={l.id} className="border-b last:border-0 align-top" style={{ borderColor: 'var(--color-border)', opacity: l.decision === 'personal' ? 0.6 : 1 }}>
                    <td className="py-2 pr-2 text-xs whitespace-nowrap" style={{ color: 'var(--color-muted)' }}>{fmtDate(l.date)}</td>
                    <td className="py-2 pr-2" style={{ color: 'var(--color-text)' }}>{l.description}</td>
                    <td className="py-2 pr-2 text-right whitespace-nowrap" style={{ color: l.amount < 0 ? '#ef4444' : '#16a34a' }}>{fmt(l.amount)}</td>
                    <td className="py-2 pr-2 text-right whitespace-nowrap text-xs" style={{ color: 'var(--color-muted)' }}>{fmt(l.balance)}</td>
                    <td className="py-2 pr-2 text-xs">
                      {target ? (
                        <span style={{ color: 'var(--color-text)' }}>
                          <Tooltip text={l.matchNote || ''}><span>{target}{l.matchStrength === 'possible' ? ' (possible)' : ''}</span></Tooltip>
                          <button className="ml-2 hover:opacity-60" style={{ color: 'var(--color-muted)' }} disabled={busy}
                            onClick={() => patch(l, { decision: l.decision, matchInvoiceId: null, matchExpenseId: null })}>Not this</button>
                        </span>
                      ) : <span style={{ color: 'var(--color-muted)' }}>—</span>}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {choice(l, 'business', 'Business', 'This line belongs to the business.')}{' '}
                      {choice(l, 'personal', 'Personal', 'This line is personal, not a business transaction. Click again to undo.')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </Modal>
  );
}
