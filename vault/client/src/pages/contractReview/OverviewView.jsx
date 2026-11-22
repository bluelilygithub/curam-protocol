import React from 'react';
import Tooltip from '../../components/Tooltip';
import ConfirmModal from '../../components/ConfirmModal';
import { CARD, FIELD, SecondaryButton, DestructiveButton, Badge } from './shared';
import { useContractReview } from './context';

// Overview of the open contract: parties (linked to CRM contacts), actions (legal hold, status, delete) and history.
export default function OverviewView() {
  const { getIcon, contract, review, obligations, crmClients, confirmAction, setConfirmAction, linkPartyClient, toggleHold, setStatus, deleteContract } = useContractReview();

  return (
    <div className="space-y-4">
  <div className="rounded-lg border p-4" style={CARD}>
    <h2 className="text-base font-semibold mb-2">Parties</h2>
    {(contract.parties || []).map((p) => (
      <div key={p.id} className="flex items-center gap-2 py-1 flex-wrap">
        <span className="text-sm">{p.name}</span>
        <Badge bg="var(--color-bg)" color="var(--color-muted)">{p.role}</Badge>
        {p.isUser && <Badge bg="#e0e7ff" color="#3730a3">You</Badge>}
        {p.confirmedByUser && getIcon('check-circle', { size: 14, color: '#166534' })}
        <Tooltip text="Link this party to an existing CRM contact — no effect on the analysis, just cross-references the two.">
          <select
            value={p.crmClientId || ''}
            onChange={(e) => linkPartyClient(p.id, e.target.value)}
            className="rounded border px-2 py-0.5 text-xs ml-auto" style={FIELD}
          >
            <option value="">No linked CRM contact</option>
            {crmClients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Tooltip>
      </div>
    ))}
    {!contract.parties?.length && <div className="text-sm" style={{ color: 'var(--color-muted)' }}>No parties extracted yet.</div>}
  </div>

  <div className="rounded-lg border p-4" style={CARD}>
    <h2 className="text-base font-semibold mb-2">Actions</h2>
    <div className="flex flex-wrap gap-2">
      <SecondaryButton onClick={toggleHold}>
        {contract.legalHold ? 'Release legal hold' : 'Set legal hold'}
      </SecondaryButton>
      <SecondaryButton onClick={() => setConfirmAction({ kind: 'expired' })}>Mark expired</SecondaryButton>
      <SecondaryButton onClick={() => setConfirmAction({ kind: 'terminated' })}>Mark terminated</SecondaryButton>
      <DestructiveButton onClick={() => setConfirmAction({ kind: 'delete' })}>Delete contract</DestructiveButton>
    </div>
    <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>
      Deletion removes everything under this contract. A contract on legal hold cannot be deleted.
    </p>
  </div>

  {confirmAction?.kind === 'delete' && (
    <ConfirmModal
      title="Delete this contract?"
      message="This removes every document, review, clause, obligation, and correction under this contract from view, and unlinks any Tasks created from its obligations. This cannot be undone from the app."
      confirmLabel="Delete contract"
      confirmText={contract.title}
      danger
      onConfirm={deleteContract}
      onCancel={() => setConfirmAction(null)}
    />
  )}
  {confirmAction?.kind === 'expired' && (
    <ConfirmModal
      title="Mark this contract as expired?"
      message="Its term has ended. This is a status change, not a deletion — the contract, its documents, and its history all stay exactly as they are."
      confirmLabel="Mark expired"
      onConfirm={() => setStatus('expired')}
      onCancel={() => setConfirmAction(null)}
    />
  )}
  {confirmAction?.kind === 'terminated' && (
    <ConfirmModal
      title="Mark this contract as terminated?"
      message="The agreement has been ended before its natural term. This is a status change, not a deletion — the contract, its documents, and its history all stay exactly as they are."
      confirmLabel="Mark terminated"
      onConfirm={() => setStatus('terminated')}
      onCancel={() => setConfirmAction(null)}
    />
  )}


  <div className="rounded-lg border p-4" style={CARD}>
    <h2 className="text-base font-semibold mb-2">History</h2>
    {(contract.events || []).map((ev) => (
      <div key={ev.id} className="text-xs py-1" style={{ color: 'var(--color-muted)' }}>
        {new Date(ev.occurredAt).toLocaleString()} — {ev.type.replace(/_/g, ' ')}
      </div>
    ))}
  </div>
    </div>
  );
}
