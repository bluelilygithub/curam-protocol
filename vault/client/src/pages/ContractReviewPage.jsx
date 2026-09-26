import React, { useCallback, useEffect, useState } from 'react';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import useProcessingStore, { runWithStepLog } from '../store/processingStore';
import useAuthStore from '../store/authStore';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';

const CARD = { background: 'var(--color-surface)', borderColor: 'var(--color-border)' };
const FIELD = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };

const RISK_BADGE = {
  risky: { text: 'Risky', bg: '#fee2e2', color: '#991b1b' },
  unclear: { text: 'Unclear', bg: '#fef3c7', color: '#92400e' },
  standard: { text: 'Standard', bg: '#dcfce7', color: '#166534' },
};

const VERIFY_BADGE = {
  verified_exact: { text: 'Verified', icon: 'shield-check', bg: '#dcfce7', color: '#166534' },
  verified_normalized: { text: 'Verified (approx.)', icon: 'shield-check', bg: '#e0f2fe', color: '#075985' },
  failed: { text: 'Unverified', icon: 'alert-triangle', bg: '#fef3c7', color: '#92400e' },
};

const COVERAGE_BADGE = {
  found: { text: 'Found', bg: '#dcfce7', color: '#166534' },
  not_found: { text: 'Not found', bg: '#fee2e2', color: '#991b1b' },
  could_not_assess: { text: 'Could not assess', bg: '#fef3c7', color: '#92400e' },
};

function Badge({ bg, color, children }) {
  return (
    <span style={{ background: bg, color, fontSize: 11, padding: '2px 8px', borderRadius: 999, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

function NotLegalAdviceBanner() {
  return (
    <div style={{ background: '#fef3c7', color: '#92400e', padding: '8px 16px', fontSize: 13, fontWeight: 600, textAlign: 'center' }}>
      Informational only — not legal advice. Always confirm important decisions with a qualified lawyer.
    </div>
  );
}

export default function ContractReviewPage() {
  const getIcon = useIcon();
  const isAdmin = useAuthStore((s) => s.user?.isAdmin);
  const processing = useProcessingStore();
  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });

  const [view, setView] = useState('list'); // list | detail
  const [contracts, setContracts] = useState([]);
  const [error, setError] = useState('');

  const [newTitle, setNewTitle] = useState('');
  const [newFile, setNewFile] = useState(null);

  const [contract, setContract] = useState(null);
  const [review, setReview] = useState(null);
  const [obligations, setObligations] = useState([]);
  const [tab, setTab] = useState('overview'); // overview | review | obligations
  const [pickedPartyId, setPickedPartyId] = useState(null);
  const [correctionNote, setCorrectionNote] = useState({}); // clauseId -> note text

  useEffect(() => {
    api.get('/api/settings/feature-access')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data?.flags) setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...data.flags }); })
      .catch(() => {});
  }, []);

  const enabled = isAdmin || featureAccess.contractReview !== false;

  const loadContracts = useCallback(async () => {
    const res = await api.get('/api/contract-review/contracts');
    if (!res.ok) return;
    const data = await res.json();
    setContracts(data.contracts || []);
  }, []);

  useEffect(() => { loadContracts(); }, [loadContracts]);

  const openContract = useCallback(async (id) => {
    setError('');
    const res = await api.get(`/api/contract-review/contracts/${id}`);
    if (!res.ok) { setError('Could not load contract'); return; }
    const data = await res.json();
    setContract(data);
    setView('detail');
    setTab('overview');
    const latestDoc = (data.documents || [])[data.documents.length - 1];
    if (latestDoc) {
      const reviewsRes = await api.get(`/api/contract-review/documents/${latestDoc.id}/reviews`);
      if (reviewsRes.ok) {
        const { reviews } = await reviewsRes.json();
        if (reviews?.[0]) await openReview(reviews[0].id);
      }
    }
    const obRes = await api.get(`/api/contract-review/obligations?contractId=${id}`);
    if (obRes.ok) setObligations((await obRes.json()).obligations || []);
  }, []);

  const openReview = useCallback(async (reviewId) => {
    const res = await api.get(`/api/contract-review/reviews/${reviewId}`);
    if (res.ok) setReview(await res.json());
  }, []);

  const createContract = useCallback(async () => {
    if (!newTitle.trim() || !newFile) { setError('Title and a file are required'); return; }
    setError('');
    try {
      const result = await runWithStepLog(
        processing,
        'Uploading and reviewing contract…',
        'Extraction, segmentation, type detection, and party extraction run first — you may be asked to confirm your role before the rest of the analysis continues.',
        ['Creating contract', 'Uploading document', 'Extracting text', 'Detecting parties'],
        async () => {
          const createRes = await api.post('/api/contract-review/contracts', { title: newTitle.trim() });
          if (!createRes.ok) throw new Error((await createRes.json().catch(() => ({}))).error || 'Failed to create contract');
          const created = await createRes.json();

          const fd = new FormData();
          fd.append('file', newFile);
          const docRes = await api.postForm(`/api/contract-review/contracts/${created.id}/documents`, fd);
          if (!docRes.ok) throw new Error((await docRes.json().catch(() => ({}))).error || 'Failed to upload document');
          const doc = await docRes.json();

          const reviewRes = await api.post(`/api/contract-review/documents/${doc.id}/review`, {});
          if (!reviewRes.ok) throw new Error((await reviewRes.json().catch(() => ({}))).error || 'Failed to start review');
          return { contractId: created.id };
        },
        { stepIntervalMs: 900 }
      );
      setNewTitle(''); setNewFile(null);
      await loadContracts();
      await openContract(result.contractId);
    } catch (e) {
      setError(e.message || 'Failed to create contract review');
    }
  }, [newTitle, newFile, processing, loadContracts, openContract]);

  const confirmRole = useCallback(async () => {
    if (!pickedPartyId || !contract) return;
    const res = await api.post(`/api/contract-review/contracts/${contract.id}/parties/${pickedPartyId}/confirm`, {});
    if (!res.ok) { setError('Could not confirm role'); return; }
    try {
      const result = await runWithStepLog(
        processing,
        'Continuing analysis…',
        'Definitions, clause classification, risk scoring, obligations, and summary.',
        ['Extracting definitions', 'Classifying clauses', 'Scoring risk', 'Extracting obligations', 'Summarizing'],
        async () => {
          const resumeRes = await api.post(`/api/contract-review/reviews/${review.id}/resume`, {});
          if (!resumeRes.ok) throw new Error((await resumeRes.json().catch(() => ({}))).error || 'Failed to resume review');
          return resumeRes.json();
        },
        { stepIntervalMs: 1200 }
      );
      await openReview(result.reviewId || review.id);
      const obRes = await api.get(`/api/contract-review/obligations?contractId=${contract.id}`);
      if (obRes.ok) setObligations((await obRes.json()).obligations || []);
    } catch (e) {
      setError(e.message || 'Failed to continue analysis');
    }
  }, [pickedPartyId, contract, review, processing, openReview]);

  const recordCorrection = useCallback(async (target, action) => {
    if (!contract) return;
    const note = correctionNote[target.clauseId || target.obligationId] || '';
    const res = await api.post(`/api/contract-review/reviews/${review.id}/corrections`, {
      contractId: contract.id, ...target, field: target.field || 'riskLevel', action, note,
    });
    if (res.ok) await openReview(review.id);
  }, [contract, review, correctionNote, openReview]);

  const addToTask = useCallback(async (obligation) => {
    const dueDate = obligation.absoluteDate || null;
    const taskRes = await api.post('/api/tasks', {
      title: `Contract obligation: ${obligation.description}`,
      notes: `From contract review. ${obligation.quotedText ? `Source: "${obligation.quotedText}"` : ''}`,
      dueDate,
      category: 'Contract Review',
    });
    if (!taskRes.ok) return;
    const task = await taskRes.json();
    await api.post(`/api/contract-review/obligations/${obligation.id}/task`, { taskId: task.id });
    const obRes = await api.get(`/api/contract-review/obligations?contractId=${contract.id}`);
    if (obRes.ok) setObligations((await obRes.json()).obligations || []);
  }, [contract]);

  const setObligationState = useCallback(async (obligationId, state) => {
    await api.post(`/api/contract-review/obligations/${obligationId}/state`, { state });
    const obRes = await api.get(`/api/contract-review/obligations?contractId=${contract.id}`);
    if (obRes.ok) setObligations((await obRes.json()).obligations || []);
  }, [contract]);

  const toggleHold = useCallback(async () => {
    if (!contract) return;
    await api.post(`/api/contract-review/contracts/${contract.id}/hold`, { hold: !contract.legalHold });
    await openContract(contract.id);
  }, [contract, openContract]);

  const markExecuted = useCallback(async (documentId) => {
    await api.post(`/api/contract-review/documents/${documentId}/execute`, {});
    await openContract(contract.id);
  }, [contract, openContract]);

  const setStatus = useCallback(async (status) => {
    if (!contract) return;
    if (!window.confirm(`Mark this contract as ${status}?`)) return;
    await api.post(`/api/contract-review/contracts/${contract.id}/status`, { status });
    await openContract(contract.id);
  }, [contract, openContract]);

  const deleteContract = useCallback(async () => {
    if (!contract) return;
    await api.delete(`/api/contract-review/contracts/${contract.id}`);
    setView('list');
    setContract(null);
    await loadContracts();
  }, [contract, loadContracts]);

  const exportIcs = useCallback(async () => {
    if (!contract) return;
    await api.download(`/api/contract-review/export.ics?contractId=${contract.id}`, `contract-${contract.id}.ics`);
  }, [contract]);

  if (!enabled) {
    return (
      <div className="p-6">
        <NotLegalAdviceBanner />
        <p style={{ color: 'var(--color-muted)' }} className="mt-4">Contract Review is not available for your account.</p>
      </div>
    );
  }

  return (
    <div style={{ background: 'var(--color-bg)', color: 'var(--color-text)', minHeight: '100dvh' }}>
      <NotLegalAdviceBanner />
      <div className="p-4 sm:p-6 max-w-5xl mx-auto">
        {view === 'list' && (
          <>
            <h1 className="text-lg font-semibold mb-4">Contract Review</h1>
            {error && <div style={{ color: '#991b1b' }} className="mb-3 text-sm">{error}</div>}

            <div className="rounded-lg border p-4 mb-6" style={CARD}>
              <h2 className="text-sm font-semibold mb-3">New contract review</h2>
              <input
                type="text" placeholder="Contract title" value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="w-full rounded border px-3 py-2 text-sm mb-2" style={FIELD}
              />
              <input
                type="file" accept=".pdf,.docx"
                onChange={(e) => setNewFile(e.target.files?.[0] || null)}
                className="w-full text-sm mb-3"
              />
              <button
                onClick={createContract}
                className="rounded px-4 py-2 text-sm font-medium hover:opacity-70"
                style={{ transition: 'opacity 200ms', background: 'var(--color-primary)', color: '#fff' }}
              >
                Upload &amp; review
              </button>
            </div>

            <h2 className="text-sm font-semibold mb-2">Your contracts</h2>
            <div className="space-y-2">
              {contracts.map((c) => (
                <button
                  key={c.id}
                  onClick={() => openContract(c.id)}
                  className="w-full text-left rounded-lg border p-3 flex items-center justify-between hover:opacity-70"
                  style={{ ...CARD, transition: 'opacity 200ms' }}
                >
                  <div>
                    <div className="text-sm font-medium">{c.title}</div>
                    <div className="text-xs" style={{ color: 'var(--color-muted)' }}>{c.contractType} · {c.status}</div>
                  </div>
                  {getIcon('chevron-right', { size: 16 })}
                </button>
              ))}
              {!contracts.length && <div className="text-sm" style={{ color: 'var(--color-muted)' }}>No contracts yet.</div>}
            </div>
          </>
        )}

        {view === 'detail' && contract && (
          <>
            <button onClick={() => { setView('list'); setContract(null); setReview(null); }} className="text-sm mb-3 hover:opacity-70" style={{ transition: 'opacity 200ms', color: 'var(--color-muted)' }}>
              ← All contracts
            </button>
            <div className="flex items-center justify-between mb-4">
              <h1 className="text-lg font-semibold">{contract.title}</h1>
              <div className="flex items-center gap-2">
                <Badge bg="var(--color-bg)" color="var(--color-muted)">{contract.contractType}</Badge>
                <Badge bg="var(--color-bg)" color="var(--color-muted)">{contract.status}</Badge>
                {contract.legalHold && getIcon('lock', { size: 14, color: '#92400e' })}
              </div>
            </div>
            {error && <div style={{ color: '#991b1b' }} className="mb-3 text-sm">{error}</div>}

            <div className="flex gap-4 mb-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
              {['overview', 'review', 'obligations'].map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className="pb-2 text-sm capitalize hover:opacity-70"
                  style={{ transition: 'opacity 200ms', borderBottom: tab === t ? '2px solid var(--color-primary)' : '2px solid transparent', fontWeight: tab === t ? 600 : 400 }}
                >
                  {t}
                </button>
              ))}
            </div>

            {tab === 'overview' && (
              <div className="space-y-4">
                <div className="rounded-lg border p-4" style={CARD}>
                  <h2 className="text-sm font-semibold mb-2">Parties</h2>
                  {(contract.parties || []).map((p) => (
                    <div key={p.id} className="text-sm flex items-center gap-2 py-1">
                      <span>{p.name}</span>
                      <Badge bg="var(--color-bg)" color="var(--color-muted)">{p.role}</Badge>
                      {p.isUser && <Badge bg="#e0e7ff" color="#3730a3">You</Badge>}
                      {p.confirmedByUser && getIcon('check-circle', { size: 14, color: '#166534' })}
                    </div>
                  ))}
                  {!contract.parties?.length && <div className="text-sm" style={{ color: 'var(--color-muted)' }}>No parties extracted yet.</div>}
                </div>

                <div className="rounded-lg border p-4" style={CARD}>
                  <h2 className="text-sm font-semibold mb-2">Documents</h2>
                  {(contract.documents || []).map((d) => (
                    <div key={d.id} className="text-sm flex items-center justify-between py-1">
                      <span>{d.filename} <Badge bg="var(--color-bg)" color="var(--color-muted)">{d.kind} · v{d.version}</Badge> <Badge bg="var(--color-bg)" color="var(--color-muted)">{d.status}</Badge></span>
                      {d.status === 'draft' && (
                        <button onClick={() => markExecuted(d.id)} className="text-xs hover:opacity-70" style={{ transition: 'opacity 200ms', color: 'var(--color-primary)' }}>Mark as executed</button>
                      )}
                    </div>
                  ))}
                </div>

                <div className="rounded-lg border p-4" style={CARD}>
                  <h2 className="text-sm font-semibold mb-2">Actions</h2>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={toggleHold} className="rounded border px-3 py-1.5 text-xs hover:opacity-70" style={{ ...FIELD, transition: 'opacity 200ms' }}>
                      {contract.legalHold ? 'Release legal hold' : 'Set legal hold'}
                    </button>
                    <button onClick={() => setStatus('expired')} className="rounded border px-3 py-1.5 text-xs hover:opacity-70" style={{ ...FIELD, transition: 'opacity 200ms' }}>Mark expired</button>
                    <button onClick={() => setStatus('terminated')} className="rounded border px-3 py-1.5 text-xs hover:opacity-70" style={{ ...FIELD, transition: 'opacity 200ms' }}>Mark terminated</button>
                    <button onClick={deleteContract} className="rounded border px-3 py-1.5 text-xs hover:opacity-70" style={{ transition: 'opacity 200ms', borderColor: '#991b1b', color: '#991b1b' }}>Delete contract</button>
                  </div>
                  <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>
                    Deletion removes everything under this contract. A contract on legal hold cannot be deleted.
                  </p>
                </div>

                <div className="rounded-lg border p-4" style={CARD}>
                  <h2 className="text-sm font-semibold mb-2">History</h2>
                  {(contract.events || []).map((ev) => (
                    <div key={ev.id} className="text-xs py-1" style={{ color: 'var(--color-muted)' }}>
                      {new Date(ev.occurredAt).toLocaleString()} — {ev.type.replace(/_/g, ' ')}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === 'review' && (
              <div className="space-y-4">
                {!review && <div className="text-sm" style={{ color: 'var(--color-muted)' }}>No review yet.</div>}

                {review?.status === 'awaiting_role_confirmation' && (
                  <div className="rounded-lg border p-4" style={{ ...CARD, borderColor: 'var(--color-primary)' }}>
                    <h2 className="text-sm font-semibold mb-2">Which party are you?</h2>
                    <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>Confirming unblocks risk scoring for your side of the agreement.</p>
                    <div className="space-y-1 mb-3">
                      {(contract.parties || []).map((p) => (
                        <label key={p.id} className="flex items-center gap-2 text-sm">
                          <input type="radio" name="userParty" checked={pickedPartyId === p.id} onChange={() => setPickedPartyId(p.id)} />
                          {p.name} <Badge bg="var(--color-bg)" color="var(--color-muted)">{p.role}</Badge>
                        </label>
                      ))}
                    </div>
                    <button onClick={confirmRole} disabled={!pickedPartyId} className="rounded px-3 py-1.5 text-xs font-medium hover:opacity-70" style={{ transition: 'opacity 200ms', background: 'var(--color-primary)', color: '#fff', opacity: pickedPartyId ? 1 : 0.5 }}>
                      Confirm and continue analysis
                    </button>
                  </div>
                )}

                {review && !['queued', 'extracting', 'segmenting', 'awaiting_role_confirmation'].includes(review.status) && (
                  <>
                    {review.coverageReport?.length > 0 && (
                      <div className="rounded-lg border p-4" style={CARD}>
                        <h2 className="text-sm font-semibold mb-2">Coverage report</h2>
                        {review.coverageReport.map((c) => {
                          const b = COVERAGE_BADGE[c.status] || COVERAGE_BADGE.could_not_assess;
                          return (
                            <div key={c.clauseType} className="text-sm flex items-center gap-2 py-1">
                              <Badge bg={b.bg} color={b.color}>{b.text}</Badge>
                              <span className="capitalize">{c.clauseType.replace(/_/g, ' ')}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {review.summaryPoints?.length > 0 && (
                      <div className="rounded-lg border p-4" style={CARD}>
                        <h2 className="text-sm font-semibold mb-2">Summary</h2>
                        <ul className="space-y-2">
                          {review.summaryPoints.map((p, i) => {
                            const b = VERIFY_BADGE[p.verificationStatus] || VERIFY_BADGE.failed;
                            return (
                              <li key={i} className="text-sm flex items-start gap-2">
                                {getIcon(b.icon, { size: 14, style: { marginTop: 2, color: b.color } })}
                                <span>{p.text}</span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}

                    <div className="rounded-lg border p-4" style={CARD}>
                      <h2 className="text-sm font-semibold mb-2">Clauses</h2>
                      <div className="space-y-3">
                        {(review.clauses || []).map((c) => {
                          const risk = RISK_BADGE[c.riskLevel] || null;
                          const verify = VERIFY_BADGE[c.verificationStatus] || null;
                          return (
                            <div key={c.id} className="rounded border p-3" style={FIELD}>
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                {c.numberLabel && <span className="text-xs font-semibold">{c.numberLabel}</span>}
                                {risk && <Badge bg={risk.bg} color={risk.color}>{risk.text}</Badge>}
                                {verify && <Badge bg={verify.bg} color={verify.color}>{verify.text}</Badge>}
                              </div>
                              <p className="text-sm mb-1">{c.text.slice(0, 500)}{c.text.length > 500 ? '…' : ''}</p>
                              {c.whyItMatters && <p className="text-xs italic" style={{ color: 'var(--color-muted)' }}>{c.whyItMatters}</p>}
                              {c.suggestedRedline && (
                                <div className="text-xs mt-1 rounded p-2" style={{ background: 'var(--color-bg)' }}>
                                  <strong>Suggested redline (advisory, copy-paste only):</strong> {c.suggestedRedline}
                                </div>
                              )}
                              {(c.crossReferences || []).length > 0 && (
                                <div className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                                  References: {c.crossReferences.map((r) => r.label).join(', ')}
                                </div>
                              )}
                              {c.riskLevel === 'risky' && (
                                <div className="flex gap-2 mt-2">
                                  <button onClick={() => recordCorrection({ clauseId: c.id, field: 'riskLevel', userValue: 'standard' }, 'dismiss')} className="text-xs hover:opacity-70" style={{ transition: 'opacity 200ms', color: 'var(--color-muted)' }}>Dismiss</button>
                                  <button onClick={() => recordCorrection({ clauseId: c.id, field: 'riskLevel', userValue: 'standard' }, 'override')} className="text-xs hover:opacity-70" style={{ transition: 'opacity 200ms', color: 'var(--color-muted)' }}>Not risky for me</button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {review.definitions?.length > 0 && (
                      <div className="rounded-lg border p-4" style={CARD}>
                        <h2 className="text-sm font-semibold mb-2">Definitions</h2>
                        {review.definitions.map((d) => {
                          const b = VERIFY_BADGE[d.verificationStatus] || VERIFY_BADGE.failed;
                          return (
                            <div key={d.id} className="text-sm py-1 flex items-start gap-2">
                              {getIcon(b.icon, { size: 14, style: { marginTop: 2, color: b.color } })}
                              <span><strong>{d.term}</strong> — {d.definition}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {tab === 'obligations' && (
              <div className="rounded-lg border p-4" style={CARD}>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold">Obligations</h2>
                  <button onClick={exportIcs} className="rounded border px-3 py-1.5 text-xs hover:opacity-70 flex items-center gap-1" style={{ ...FIELD, transition: 'opacity 200ms' }}>
                    {getIcon('calendar-check', { size: 14 })} Export .ics
                  </button>
                </div>
                <div className="space-y-2">
                  {obligations.map((o) => {
                    const unverified = o.derivedStatus === 'unverified';
                    return (
                      <div key={o.id} className="rounded border p-3 flex items-start justify-between gap-3" style={FIELD}>
                        <div>
                          <div className="text-sm">{o.description}</div>
                          <div className="text-xs mt-1 flex items-center gap-2" style={{ color: 'var(--color-muted)' }}>
                            <Badge bg="var(--color-bg)" color="var(--color-muted)">{o.derivedStatus.replace(/_/g, ' ')}</Badge>
                            {!o.obligorPartyId && <Badge bg="#fef3c7" color="#92400e">Obligor unresolved</Badge>}
                            {unverified && <Badge bg="#fef3c7" color="#92400e">Unverified — not exported/linkable until confirmed</Badge>}
                            {o.userState && <Badge bg="#e0e7ff" color="#3730a3">{o.userState}</Badge>}
                          </div>
                        </div>
                        <div className="flex gap-2 flex-shrink-0">
                          {!o.linkedTaskId && (
                            <button onClick={() => addToTask(o)} className="text-xs hover:opacity-70" style={{ transition: 'opacity 200ms', color: 'var(--color-primary)' }}>+ Add to Task</button>
                          )}
                          {!o.userState && (
                            <button onClick={() => setObligationState(o.id, 'handled')} className="text-xs hover:opacity-70" style={{ transition: 'opacity 200ms', color: 'var(--color-muted)' }}>Mark handled</button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {!obligations.length && <div className="text-sm" style={{ color: 'var(--color-muted)' }}>No obligations extracted for an active (executed) document yet.</div>}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
