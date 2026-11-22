import React from 'react';
import { CARD, FOCUS_RING, CONTRACT_STATUS_BADGE, contractTypeLabel, Badge } from './shared';
import { useContractReview } from './context';

// Your contracts: every contract (or only those linked to one CRM contact), open one, select and delete.
export default function ContractsView() {
  const { getIcon, contracts, selectedContractIds, pendingDeleteId, setPendingDeleteId, pendingBulkDelete, setPendingBulkDelete, contract, review, toggleContractSelected, toggleSelectAllContracts, deleteContractFromList, deleteSelectedContracts, openContract } = useContractReview();

  return (
    <div data-tour="contract-review-contracts">
  <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
    <h2 className="text-base font-semibold">Your contracts</h2>
    {contracts.length > 0 && (
      <div className="flex items-center gap-2 flex-wrap">
        <label className="flex items-center gap-1 text-xs hover:opacity-70 cursor-pointer" style={{ transition: 'opacity 200ms', color: 'var(--color-muted)' }}>
          <input type="checkbox" checked={selectedContractIds.size === contracts.length} onChange={toggleSelectAllContracts} />
          Select all
        </label>
        {selectedContractIds.size > 0 && (
          pendingBulkDelete ? (
            <span className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-muted)' }}>
              Delete {selectedContractIds.size} contract{selectedContractIds.size === 1 ? '' : 's'}?
              <button onClick={deleteSelectedContracts} className="hover:opacity-70" style={{ transition: 'opacity 200ms', color: '#991b1b' }}>Yes</button>
              <button onClick={() => setPendingBulkDelete(false)} className="hover:opacity-70" style={{ transition: 'opacity 200ms' }}>No</button>
            </span>
          ) : (
            <button onClick={() => setPendingBulkDelete(true)} className="rounded border px-2 py-1 text-xs hover:opacity-70" style={{ transition: 'opacity 200ms', borderColor: '#991b1b', color: '#991b1b' }}>
              Delete selected ({selectedContractIds.size})
            </button>
          )
        )}
      </div>
    )}
  </div>
  <div className="space-y-2">
    {contracts.map((c) => (
      <div
        key={c.id}
        className="w-full rounded-lg border p-3 flex items-center gap-2 hover:opacity-70"
        style={{ ...CARD, transition: 'opacity 200ms' }}
      >
        <input
          type="checkbox" checked={selectedContractIds.has(c.id)}
          onChange={() => toggleContractSelected(c.id)}
          onClick={(e) => e.stopPropagation()}
        />
        <button onClick={() => openContract(c.id)} className={`flex-1 text-left flex items-center justify-between gap-2 rounded ${FOCUS_RING}`}>
          <div>
            <div className="text-sm font-medium">{c.title}</div>
            <div className="text-xs flex items-center gap-1.5 mt-0.5" style={{ color: 'var(--color-muted)' }}>
              <span className="capitalize">{contractTypeLabel(c)}</span>
              <span>·</span>
              <Badge bg={(CONTRACT_STATUS_BADGE[c.status] || {}).bg} color={(CONTRACT_STATUS_BADGE[c.status] || {}).color}>
                {(CONTRACT_STATUS_BADGE[c.status] || {}).text || c.status}
              </Badge>
            </div>
          </div>
          {getIcon('chevron-right', { size: 16 })}
        </button>
        {pendingDeleteId === c.id ? (
          <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-muted)' }}>
            Delete?
            <button onClick={() => deleteContractFromList(c.id)} className="hover:opacity-70" style={{ transition: 'opacity 200ms', color: '#991b1b' }}>Yes</button>
            <button onClick={() => setPendingDeleteId(null)} className="hover:opacity-70" style={{ transition: 'opacity 200ms' }}>No</button>
          </span>
        ) : (
          <button onClick={() => setPendingDeleteId(c.id)} className="text-xs hover:opacity-70" style={{ transition: 'opacity 200ms', color: '#991b1b' }}>Del</button>
        )}
      </div>
    ))}
    {!contracts.length && <div className="text-sm" style={{ color: 'var(--color-muted)' }}>No contracts yet.</div>}
  </div>
    </div>
  );
}
