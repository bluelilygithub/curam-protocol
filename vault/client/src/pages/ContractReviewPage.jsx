import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import useProcessingStore, { runWithStepLog } from '../store/processingStore';
import useAuthStore from '../store/authStore';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import Tooltip from '../components/Tooltip';
import ToolSidebar from '../components/ToolSidebar';
import { JobStart, JobBar, BackToJobs, stepIndex } from '../components/JobStart';
import { VoiceInputProvider } from '../components/voiceInput/VoiceInput';
import { startContractReviewTour, TOUR_KEY as CR_TOUR_KEY } from '../utils/tours/contractReviewTour';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import { ContractReviewContext } from './contractReview/context';
import { CARD, PrimaryButton, SecondaryButton, Badge, CONTRACT_STATUS_BADGE, contractTypeLabel, NotLegalAdviceBanner, formatEtaRemaining } from './contractReview/shared';
import { CONTRACT_REVIEW_TOOLS, CONTRACT_TOOL_IDS, CONTRACT_REVIEW_GOALS, GROUPS, GROUP_TIPS, TOOL_TIPS, TOOL_BLURBS, HOW_IT_WORKS, GUIDE_TOOLS } from './contractReview/contractReviewTools.mjs';
import ContractReviewTutorChat from './contractReview/ContractReviewTutorChat';
import NewReviewView from './contractReview/NewReviewView';
import ContractsView from './contractReview/ContractsView';
import ReviewView from './contractReview/ReviewView';
import ObligationsView from './contractReview/ObligationsView';
import AskView from './contractReview/AskView';
import DocumentsView from './contractReview/DocumentsView';
import CompareView from './contractReview/CompareView';
import OverviewView from './contractReview/OverviewView';
import ReportView from './contractReview/ReportView';

/**
 * Contract Review, laid out like DocCompare: the tool list on the left (ToolSidebar), the "What do you want to do?" job screen (JobStart),
 * and each tool in the main area. This file owns the state and every API call; each tool is its own screen in ./contractReview/,
 * reading what it needs through ContractReviewContext. The tools and jobs are data in ./contractReview/contractReviewTools.mjs.
 */
const TOOL_IDS = CONTRACT_REVIEW_TOOLS.map((t) => t.id);
const OPEN_ON_LAST_KEY = 'vault:contract-review:openOnLast';
const LAST_TOOL_KEY = 'vault:contract-review:lastTool';
const readLocal = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const writeLocal = (k, v) => { try { localStorage.setItem(k, v); } catch { /* not remembered */ } };
const labelFor = (id) => CONTRACT_REVIEW_TOOLS.find((t) => t.id === id)?.label || id;
// "Review a contract" is the large panel above the jobs; the rest are the job cards
const CHECK_GOAL = CONTRACT_REVIEW_GOALS.find((g) => g.id === 'check');
const OTHER_GOALS = CONTRACT_REVIEW_GOALS.filter((g) => g.id !== 'check');
const VIEWS = {
  new: NewReviewView, contracts: ContractsView, review: ReviewView, obligations: ObligationsView, ask: AskView,
  documents: DocumentsView, compare: CompareView, overview: OverviewView, report: ReportView,
};

export default function ContractReviewPage() {
  const info = useToolInfoModal('vault_contract_review_info_seen');
  const getIcon = useIcon();
  const isAdmin = useAuthStore((s) => s.user?.isAdmin);
  const processing = useProcessingStore();
  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const [searchParams, setSearchParams] = useSearchParams();
  const crmClientIdFilter = searchParams.get('crmClientId') || null;

  // 'start' is the job screen (not a tool); every other value is a tool id from CONTRACT_REVIEW_TOOLS
  const [openOnLast, setOpenOnLast] = useState(() => readLocal(OPEN_ON_LAST_KEY) === '1');
  const [tool, setTool] = useState(() => {
    if (crmClientIdFilter) return 'contracts';
    const last = readLocal(LAST_TOOL_KEY);
    if (readLocal(OPEN_ON_LAST_KEY) !== '1' || !TOOL_IDS.includes(last)) return 'start';
    return CONTRACT_TOOL_IDS.includes(last) ? 'contracts' : last; // no contract is open after a reload
  });
  const [goal, setGoal] = useState(null);
  const goalRef = useRef(goal); goalRef.current = goal;
  const toolRef = useRef(tool); toolRef.current = tool;
  // A contract has just opened: a job that started by picking or uploading it moves on to its next step; without a job the
  // verdict comes first. Refreshing the open contract (after a status change, a revision, ...) stays on the current tool.
  const advanceAfterOpen = () => {
    const from = toolRef.current;
    if (from !== 'contracts' && from !== 'new' && from !== 'start') return;
    const g = goalRef.current;
    const at = stepIndex(g, from);
    setTool(g && at >= 0 && g.steps[at + 1] ? g.steps[at + 1].tool : 'review');
  };
  const [contracts, setContracts] = useState([]);
  const [error, setError] = useState('');
  const [selectedContractIds, setSelectedContractIds] = useState(new Set());
  const [pendingDeleteId, setPendingDeleteId] = useState(null); // single-row inline confirm
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false);

  const [newTitle, setNewTitle] = useState('');
  const [newFile, setNewFile] = useState(null);

  const [contract, setContract] = useState(null);
  const [review, setReview] = useState(null);
  const [obligations, setObligations] = useState([]);
  const [pickedPartyId, setPickedPartyId] = useState(null);
  const [manualPartyName, setManualPartyName] = useState('');
  const [manualPartyRole, setManualPartyRole] = useState('other');
  const [partyNameDrafts, setPartyNameDrafts] = useState({}); // partyId -> in-progress edit text
  const [correctionNote, setCorrectionNote] = useState({}); // clauseId -> note text
  const [clauseFilter, setClauseFilter] = useState('all'); // all | risky | unclear | standard | context
  const [clauseSort, setClauseSort] = useState('order'); // order | severity
  const [question, setQuestion] = useState('');
  const [qaHistory, setQaHistory] = useState([]); // [{question, answer, quote, answeredByContract}]
  const [qaLoading, setQaLoading] = useState(false);
  const [reportEmail, setReportEmail] = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const [crmClients, setCrmClients] = useState([]); // Finance's own client picker endpoint — canonical clients table
  const [titleDraft, setTitleDraft] = useState('');
  const [contractReviews, setContractReviews] = useState([]); // every review across every document under this contract
  const [reviewAsPartyId, setReviewAsPartyId] = useState({}); // documentId -> selected partyId for "Review as another party"
  const [revisionBusy, setRevisionBusy] = useState(null); // documentId currently uploading a revision
  const [compareFor, setCompareFor] = useState(null); // documentId currently showing a "What changed" view
  const [compareResult, setCompareResult] = useState(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null); // { kind: 'delete'|'expired'|'terminated', ... }
  const [obligationOwnerFilter, setObligationOwnerFilter] = useState('');
  const [obligationStatusFilter, setObligationStatusFilter] = useState('all'); // all | overdue | upcoming | recurring_or_relative | unverified | done
  const [obligationDueFrom, setObligationDueFrom] = useState('');
  const [obligationDueTo, setObligationDueTo] = useState('');
  const [switchPerspectiveOpen, setSwitchPerspectiveOpen] = useState(false); // Review tab — deliberate extra step before switching perspective
  const [revisionUploadOpenFor, setRevisionUploadOpenFor] = useState(null); // documentId currently showing its revision dropzone

  // Compare-revisions tab — perspective-first: pick a party, then pick which
  // two of that party's completed reviews to compare (any two versions, not
  // just adjacent ones). Previously this workflow was buried inside
  // "Upload new revision" (always adjacent-only, no perspective choice) and
  // "Review as…" (ran a review, didn't compare anything) — a UX review
  // flagged it as not obvious and poorly constructed.
  const [comparePartyId, setComparePartyId] = useState(null);
  const [compareOldReviewId, setCompareOldReviewId] = useState(null);
  const [compareNewReviewId, setCompareNewReviewId] = useState(null);
  const [compareViewMode, setCompareViewMode] = useState('condensed'); // condensed | sideBySide
  const [compareFullResult, setCompareFullResult] = useState(null);
  const [compareFullLoading, setCompareFullLoading] = useState(false);
  const [compareFullError, setCompareFullError] = useState('');

  // One completed review per document version for the chosen party (latest
  // by createdAt if a party was reviewed more than once against the same
  // version), in version order — the pool the two comparison pickers below
  // choose from.
  const compareVersionsForParty = (contract?.documents || [])
    .slice()
    .sort((a, b) => a.version - b.version)
    .map((d) => {
      const reviewsForDoc = contractReviews.filter((r) => r.documentId === d.id && r.userPartyId === comparePartyId && r.status === 'complete');
      const latest = reviewsForDoc.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
      return { document: d, review: latest };
    });

  // Re-default the two picked reviews whenever the party or the available
  // reviews change — always the two most recent versions that actually have
  // a completed review for this party, so switching perspective doesn't
  // leave a stale, now-meaningless review id selected.
  useEffect(() => {
    const withReview = compareVersionsForParty.filter((v) => v.review);
    setCompareOldReviewId(withReview.length >= 2 ? withReview[withReview.length - 2].review.id : null);
    setCompareNewReviewId(withReview.length >= 1 ? withReview[withReview.length - 1].review.id : null);
    setCompareFullResult(null);
    setCompareFullError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comparePartyId, contractReviews]);

  // Reset the perspective-switch panel whenever a different review is opened
  // — it shouldn't stay expanded (or collapsed-but-stale) across reviews.
  useEffect(() => { setSwitchPerspectiveOpen(false); }, [review?.id]);

  // Same idea for the revision-upload dropzone — without this, opening it
  // for a document then navigating to a different tab or contract (without
  // Cancel or picking a file) leaves it stuck expanded when the user comes
  // back to Documents & Reviews.
  useEffect(() => { setRevisionUploadOpenFor(null); }, [contract?.id, tool]);

  useEffect(() => {
    api.get('/api/settings/feature-access')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data?.flags) setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...data.flags }); })
      .catch(() => {});
  }, []);

  // Optional link to an existing CRM contact/client — the canonical clients
  // listing (server/routes/clients.js), gated by the 'clients' feature flag
  // (not Finance's own picker-only wrapper, which sits behind the unrelated
  // 'finance' flag — a Contract Review user with CRM access but no Finance
  // access should still be able to link a contact).
  useEffect(() => {
    api.get('/api/clients')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setCrmClients(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  useEffect(() => { if (tool !== 'start') writeLocal(LAST_TOOL_KEY, tool); }, [tool]);
  const toggleOpenOnLast = (on) => { setOpenOnLast(on); writeLocal(OPEN_ON_LAST_KEY, on ? '1' : '0'); };
  const startGoal = (g) => { setGoal(g); setTool(g.steps[0].tool); };
  const backToStart = () => { setGoal(null); setTool('start'); };

  const enabled = isAdmin || featureAccess.contractReview !== false;

  const loadContracts = useCallback(async () => {
    const qs = crmClientIdFilter ? `?crmClientId=${crmClientIdFilter}` : '';
    const res = await api.get(`/api/contract-review/contracts${qs}`);
    if (!res.ok) return;
    const data = await res.json();
    setContracts(data.contracts || []);
  }, [crmClientIdFilter]);

  useEffect(() => { loadContracts(); }, [loadContracts]);

  const toggleContractSelected = useCallback((id) => {
    setSelectedContractIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAllContracts = useCallback(() => {
    setSelectedContractIds((prev) => (
      prev.size === contracts.length ? new Set() : new Set(contracts.map((c) => c.id))
    ));
  }, [contracts]);

  const deleteContractFromList = useCallback(async (id) => {
    await api.delete(`/api/contract-review/contracts/${id}`);
    setPendingDeleteId(null);
    setSelectedContractIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    await loadContracts();
  }, [loadContracts]);

  const deleteSelectedContracts = useCallback(async () => {
    await Promise.all([...selectedContractIds].map((id) => api.delete(`/api/contract-review/contracts/${id}`)));
    setPendingBulkDelete(false);
    setSelectedContractIds(new Set());
    await loadContracts();
  }, [selectedContractIds, loadContracts]);

  const loadContractReviews = useCallback(async (id) => {
    const res = await api.get(`/api/contract-review/contracts/${id}/reviews`);
    if (res.ok) setContractReviews((await res.json()).reviews || []);
  }, []);

  const openContract = useCallback(async (id) => {
    setError('');
    const res = await api.get(`/api/contract-review/contracts/${id}`);
    if (!res.ok) { setError('Could not load contract'); return; }
    const data = await res.json();
    setContract(data);
    setTitleDraft(data.title || '');
    advanceAfterOpen();
    setQaHistory([]);
    setCompareFor(null);
    setCompareResult(null);
    setComparePartyId((data.parties || []).find((p) => p.isUser)?.id || (data.parties || [])[0]?.id || null);
    setCompareOldReviewId(null);
    setCompareNewReviewId(null);
    setCompareFullResult(null);
    setCompareFullError('');
    await loadContractReviews(id);
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
  }, [loadContractReviews]);

  // currentReviewIdRef guards against a stale response — e.g. the 4s
  // progress-polling effect below has an in-flight request for review A when
  // the user clicks a different review B in the list; A's response must not
  // overwrite B once it lands late. Updated synchronously so any newer call
  // always wins regardless of which one's fetch resolves last.
  const currentReviewIdRef = useRef(null);
  const openReview = useCallback(async (reviewId) => {
    currentReviewIdRef.current = reviewId;
    const res = await api.get(`/api/contract-review/reviews/${reviewId}`);
    if (res.ok && currentReviewIdRef.current === reviewId) setReview(await res.json());
  }, []);

  // Live progress — a review can now finish its ingest/analysis entirely in
  // the background (server/services/contractReview/contractService.js's
  // startReview/resumeReview are fire-and-forget), so a page reload or a
  // fresh navigation to this contract while a review is still running has no
  // active poll loop of its own. Without this, the Review tab would just
  // show nothing meaningful until the user manually refreshed. Must come
  // AFTER openReview's own declaration above — referencing it in this
  // effect's dependency array before its `const` initializes is a temporal-
  // dead-zone ReferenceError under strict production evaluation (a real bug
  // this exact ordering caused once already).
  useEffect(() => {
    if (!review) return;
    const inProgress = !['awaiting_role_confirmation', 'failed', 'not_supported', 'complete'].includes(review.status);
    if (!inProgress) return;
    const reviewId = review.id;
    const interval = setInterval(() => { openReview(reviewId); }, 4000);
    return () => clearInterval(interval);
  }, [review?.id, review?.status, openReview]);

  const saveTitle = useCallback(async () => {
    const t = titleDraft.trim();
    if (!contract || !t || t === contract.title) return;
    const res = await api.post(`/api/contract-review/contracts/${contract.id}/title`, { title: t });
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || 'Could not save title'); return; }
    setError('');
    setContract((prev) => (prev ? { ...prev, title: t } : prev));
    await loadContracts();
  }, [contract, titleDraft, loadContracts]);

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

  // Every review-starting/resuming call returns almost immediately — the
  // actual analysis runs in the background and can take several minutes
  // (several sequential LLM calls). This polls for the real terminal status
  // instead of awaiting one long-lived request, which previously hit an
  // infrastructure-level timeout before the server's own error response
  // could ever arrive — that's what surfaced as a generic "Failed to resume
  // review" with no real cause. Shared by confirmPartyIdAndResume,
  // reviewAsParty, and uploadRevision — all three start/resume a review and
  // must wait for it to actually finish before refreshing anything, not just
  // fire the request and read back whatever mid-flight stage happens to be
  // there (a real bug: "Review as another party" and "Upload new revision"
  // both originally skipped this and showed a stuck-looking stage name).
  const pollReviewUntilTerminal = useCallback(async (reviewId, label) => {
    const terminal = new Set(['complete', 'failed', 'not_supported']);
    const prefix = label ? `${label} — ` : '';
    for (let attempt = 0; attempt < 200; attempt += 1) { // ~200 * 3s = 10 min ceiling
      await new Promise((r) => setTimeout(r, 3000));
      const pollRes = await api.get(`/api/contract-review/reviews/${reviewId}`);
      if (!pollRes.ok) continue;
      const polled = await pollRes.json();
      const sp = polled.stageProgress || {};
      let detail = `${prefix}Stage: ${String(sp.stage || polled.status).replace(/_/g, ' ')}`;
      if (sp.stage === 'scoring' && sp.total) {
        detail = `${prefix}Scoring clause ${sp.current || 0} of ${sp.total}` + formatEtaRemaining(sp.etaSeconds);
      }
      processing.updateProcessingDetail(detail);
      if (terminal.has(polled.status)) return polled;
    }
    throw new Error(`${prefix}Analysis is taking longer than expected — check back on this contract shortly.`);
  }, [processing]);

  const confirmPartyIdAndResume = useCallback(async (partyId) => {
    if (!partyId || !contract) return;
    const res = await api.post(`/api/contract-review/contracts/${contract.id}/parties/${partyId}/confirm`, {});
    if (!res.ok) { setError('Could not confirm role'); return; }
    setError('');
    const docLabel = (contract.documents || []).find((d) => d.id === review?.documentId)?.filename || null;
    processing.startProcessing(
      docLabel ? `Continuing analysis of ${docLabel}…` : 'Continuing analysis…',
      'Definitions, clause classification, risk scoring, obligations, and summary. This can take a few minutes.'
    );
    try {
      const resumeRes = await api.post(`/api/contract-review/reviews/${review.id}/resume`, {});
      if (!resumeRes.ok) throw new Error((await resumeRes.json().catch(() => ({}))).error || 'Failed to resume review');
      const finalReview = await pollReviewUntilTerminal(review.id, docLabel);
      if (finalReview.status === 'failed') throw new Error(finalReview.errorMessage || 'Analysis failed');
      currentReviewIdRef.current = finalReview.id;
      setReview(finalReview);
      const obRes = await api.get(`/api/contract-review/obligations?contractId=${contract.id}`);
      if (obRes.ok) setObligations((await obRes.json()).obligations || []);
    } catch (e) {
      setError(e.message || 'Failed to continue analysis');
    } finally {
      processing.stopProcessing();
    }
  }, [contract, review, processing, pollReviewUntilTerminal]);

  const confirmRole = useCallback(async () => {
    await confirmPartyIdAndResume(pickedPartyId);
  }, [pickedPartyId, confirmPartyIdAndResume]);

  // Corrections, not a direct edit — the model's own extraction stays in
  // contract_parties untouched; recordCorrection stores the override and
  // the server applies it as the effective name/role everywhere (getContract,
  // and the role the pipeline actually uses once confirmed).
  const savePartyField = useCallback(async (partyId, field, value) => {
    if (!contract || !review) return;
    const res = await api.post(`/api/contract-review/reviews/${review.id}/corrections`, {
      contractId: contract.id, partyId, field, userValue: value, action: 'edit',
    });
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || `Could not save ${field}`); return; }
    setError('');
    setContract((prev) => (prev ? { ...prev, parties: prev.parties.map((p) => (p.id === partyId ? { ...p, [field]: value } : p)) } : prev));
  }, [contract, review]);

  const linkPartyClient = useCallback(async (partyId, clientId) => {
    if (!contract) return;
    await api.post(`/api/contract-review/contracts/${contract.id}/parties/${partyId}/link-client`, { clientId: clientId || null });
    setContract((prev) => (prev ? { ...prev, parties: prev.parties.map((p) => (p.id === partyId ? { ...p, crmClientId: clientId ? Number(clientId) : null } : p)) } : prev));
  }, [contract]);

  // Covers the case where party extraction found nobody at all (a real,
  // observed failure mode — see docs/contract-review-spec.md) — the radio
  // list above has nothing to show and must not leave the user stuck behind
  // a permanently disabled button. Creates a party row for the user's own
  // side of the agreement, confirms it, then continues exactly like picking
  // an existing party would.
  const addManualPartyAndConfirm = useCallback(async () => {
    if (!manualPartyName.trim() || !contract) return;
    setError('');
    const res = await api.post(`/api/contract-review/contracts/${contract.id}/parties`, {
      name: manualPartyName.trim(), role: manualPartyRole, isUser: true,
    });
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || 'Could not add party'); return; }
    const party = await res.json();
    setContract((prev) => (prev ? { ...prev, parties: [...(prev.parties || []), party] } : prev));
    setManualPartyName('');
    await confirmPartyIdAndResume(party.id);
  }, [manualPartyName, manualPartyRole, contract, confirmPartyIdAndResume]);

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

  // Runs a NEW, independent review of this document from an explicitly
  // chosen party's perspective — never reuses or disturbs the contract's
  // own confirmedByUser/isUser party. A document can end up with several
  // reviews this way, each its own userPartyId (see the reviews list).
  const reviewAsParty = useCallback(async (documentId, explicitPartyId = null, { preserveTool = null } = {}) => {
    const partyId = explicitPartyId || reviewAsPartyId[documentId];
    if (!partyId || !contract) return;
    setError('');
    const docLabel = (contract.documents || []).find((d) => d.id === documentId)?.filename || null;
    const partyLabel = (contract.parties || []).find((p) => p.id === partyId)?.name || null;
    const label = [docLabel, partyLabel ? `as ${partyLabel}` : null].filter(Boolean).join(' — ') || null;
    processing.startProcessing(
      label ? `Reviewing ${label}…` : 'Reviewing from that party\'s perspective…',
      'This runs a full, independent analysis of this document for the chosen party — it does not affect any other review. This can take a few minutes.'
    );
    try {
      const res = await api.post(`/api/contract-review/documents/${documentId}/review`, { asPartyId: partyId });
      const started = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(started.error || 'Failed to start review');
      if (started.status !== 'awaiting_role_confirmation' && started.status !== 'not_supported' && started.status !== 'failed') {
        const finalReview = await pollReviewUntilTerminal(started.reviewId, label);
        if (finalReview.status === 'failed') throw new Error(finalReview.errorMessage || 'Analysis failed');
      }
      await openContract(contract.id);
      // openContract always resets to the Overview tab AND the default
      // comparePartyId — fine for the Documents-tab call site, but the
      // Compare tab's own "run this perspective" action would otherwise
      // silently kick the user back to their default perspective/tab
      // instead of the one they were actually working with.
      if (preserveTool) {
        setTool(preserveTool);
        setComparePartyId(partyId);
      }
    } catch (e) {
      setError(e.message || 'Failed to start review');
    } finally {
      processing.stopProcessing();
    }
  }, [contract, reviewAsPartyId, processing, pollReviewUntilTerminal, openContract]);

  const runCompare = useCallback(async (documentId) => {
    setCompareFor(documentId);
    setCompareResult(null);
    setCompareLoading(true);
    setError('');
    try {
      const res = await api.get(`/api/contract-review/documents/${documentId}/compare`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not compare versions');
      setCompareResult(data);
    } catch (e) {
      setError(e.message || 'Could not compare versions');
      setCompareFor(null);
    } finally {
      setCompareLoading(false);
    }
  }, []);

  const runFullCompare = useCallback(async () => {
    if (!contract || !compareOldReviewId || !compareNewReviewId) return;
    setCompareFullLoading(true);
    setCompareFullError('');
    setCompareFullResult(null);
    try {
      const res = await api.post(`/api/contract-review/contracts/${contract.id}/compare-reviews`, {
        oldReviewId: compareOldReviewId, newReviewId: compareNewReviewId,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not compare these reviews');
      setCompareFullResult(data);
    } catch (e) {
      setCompareFullError(e.message || 'Could not compare these reviews');
    } finally {
      setCompareFullLoading(false);
    }
  }, [contract, compareOldReviewId, compareNewReviewId]);

  const uploadRevision = useCallback(async (documentId, file) => {
    if (!file || !contract) return;
    setRevisionBusy(documentId);
    setError('');
    processing.startProcessing(`Uploading and reviewing ${file.name}…`, 'Extraction, segmentation, and the full analysis pipeline run for this revision. This can take a few minutes.');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('parentDocumentId', String(documentId));
      const docRes = await api.postForm(`/api/contract-review/contracts/${contract.id}/documents`, fd);
      if (!docRes.ok) throw new Error((await docRes.json().catch(() => ({}))).error || 'Failed to upload revision');
      const doc = await docRes.json();
      const reviewRes = await api.post(`/api/contract-review/documents/${doc.id}/review`, {});
      const started = await reviewRes.json().catch(() => ({}));
      if (!reviewRes.ok) throw new Error(started.error || 'Failed to start review');
      // A revision reuses the contract's already-confirmed party (see
      // extractPartiesAndKeyTerms's reconciliation), so this normally skips
      // awaiting_role_confirmation entirely — but a genuinely new party
      // situation could still pause it, in which case there's nothing to
      // poll for yet.
      let reviewSucceeded = false;
      if (started.status !== 'awaiting_role_confirmation' && started.status !== 'not_supported' && started.status !== 'failed') {
        const finalReview = await pollReviewUntilTerminal(started.reviewId, file.name);
        if (finalReview.status === 'failed') throw new Error(finalReview.errorMessage || 'Analysis failed');
        reviewSucceeded = finalReview.status === 'complete';
      }
      await openContract(contract.id);
      // The whole point of uploading a revision is "what's different from
      // last time" — surface that automatically instead of making the user
      // find and click "What changed" themselves afterward.
      if (reviewSucceeded) {
        setTool('documents');
        await runCompare(doc.id);
      }
    } catch (e) {
      setError(e.message || 'Failed to upload revision');
    } finally {
      setRevisionBusy(null);
      processing.stopProcessing();
    }
  }, [contract, processing, pollReviewUntilTerminal, openContract, runCompare]);


  // These three previously fired immediately (setStatus via a bare
  // window.confirm, deleteContract with no confirmation at all) — a UX
  // review flagged all three as needing a real confirmation screen that
  // explains the consequence, matching the ConfirmModal convention used
  // elsewhere for high-stakes operations.
  const setStatus = useCallback(async (status) => {
    if (!contract) return;
    await api.post(`/api/contract-review/contracts/${contract.id}/status`, { status });
    setConfirmAction(null);
    await openContract(contract.id);
  }, [contract, openContract]);

  const deleteContract = useCallback(async () => {
    if (!contract) return;
    await api.delete(`/api/contract-review/contracts/${contract.id}`);
    setConfirmAction(null);
    setContract(null);
    setReview(null);
    currentReviewIdRef.current = null;
    setTool('contracts');
    await loadContracts();
  }, [contract, loadContracts]);

  const exportIcs = useCallback(async () => {
    if (!contract) return;
    await api.download(`/api/contract-review/export.ics?contractId=${contract.id}`, `contract-${contract.id}.ics`);
  }, [contract]);

  const askQuestion = useCallback(async () => {
    const q = question.trim();
    if (!q || !contract) return;
    setQaLoading(true);
    setError('');
    try {
      const res = await api.post(`/api/contract-review/contracts/${contract.id}/ask`, { question: q });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not get an answer');
      setQaHistory((prev) => [{ question: q, ...data }, ...prev]);
      setQuestion('');
    } catch (e) {
      setError(e.message || 'Could not get an answer');
    } finally {
      setQaLoading(false);
    }
  }, [question, contract]);

  const downloadReport = useCallback(async () => {
    if (!contract) return;
    setReportBusy(true);
    setError('');
    try {
      const qs = review?.id ? `?reviewId=${review.id}` : '';
      await api.download(`/api/contract-review/contracts/${contract.id}/report/pdf${qs}`, `${contract.title || 'contract'}-review.pdf`);
    } catch (e) {
      setError(e.message || 'Could not generate report');
    } finally {
      setReportBusy(false);
    }
  }, [contract, review]);

  const emailReport = useCallback(async () => {
    if (!contract || !reportEmail.trim()) return;
    setReportBusy(true);
    setError('');
    try {
      const res = await api.post(`/api/contract-review/contracts/${contract.id}/report/email`, { reviewId: review?.id || null, to: reportEmail.trim() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not send report');
      setReportEmail('');
    } catch (e) {
      setError(e.message || 'Could not send report');
    } finally {
      setReportBusy(false);
    }
  }, [contract, review, reportEmail]);

  const setObligationField = useCallback(async (obligation, field, value) => {
    if (!contract || !review) return;
    const res = await api.post(`/api/contract-review/reviews/${review.id}/corrections`, {
      contractId: contract.id, obligationId: obligation.id, field, userValue: value, action: 'edit',
    });
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || `Could not save ${field}`); return; }
    setError('');
    const obRes = await api.get(`/api/contract-review/obligations?contractId=${contract.id}`);
    if (obRes.ok) setObligations((await obRes.json()).obligations || []);
  }, [contract, review]);

  const closeContract = () => {
    setContract(null); setReview(null); currentReviewIdRef.current = null;
    setTool('contracts');
  };
  // the guided tour switches tools the same way the list does ('start' = the job screen)
  const startTour = () => {
    info.close();
    try { localStorage.removeItem(CR_TOUR_KEY); } catch { /* ignore */ }
    startContractReviewTour((id) => { if (id === 'start') backToStart(); else setTool(id); });
  };
  // Settings -> Contract Review Tour (and the floating tour button) open /contract-review?tour=1
  useEffect(() => {
    if (!searchParams.get('tour')) return;
    const next = new URLSearchParams(searchParams); next.delete('tour');
    setSearchParams(next, { replace: true });
    setTimeout(startTour, 400);
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // the guide's Open buttons: the (i) box and the tour are ours; otherwise show the tool and scroll to the part (data-guide="<id>")
  const openGuideTool = (id) => {
    if (id === 'info') { info.open(); return; }
    if (id === 'tour') { startTour(); return; }
    const target = GUIDE_TOOLS.find((g) => g.id === id);
    if (!target) return;
    setTool(target.tool);
    setTimeout(() => document.querySelector(`[data-guide="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
  };

  if (!enabled) {
    return (
      <div className="p-6">
        <NotLegalAdviceBanner />
        <p style={{ color: 'var(--color-muted)' }} className="mt-4">Contract Review is not available for your account.</p>
      </div>
    );
  }

  // the tools under "This contract" stay in the list but say what to do first (same as DocCompare's "Compare two files first")
  const hintFor = (id) => {
    if (!CONTRACT_TOOL_IDS.includes(id)) return undefined;
    if (!contract) return 'Open or start a contract first';
    if (id === 'report' && !review) return 'Needs a review first';
    return undefined;
  };
  const MENU = GROUPS.map((label) => ({
    label,
    tip: GROUP_TIPS[label],
    tools: CONTRACT_REVIEW_TOOLS.filter((t) => t.group === label).map((t) => ({ ...t, tip: TOOL_TIPS[t.id], hint: hintFor(t.id) })),
  }));
  const needsContract = CONTRACT_TOOL_IDS.includes(tool);
  const View = VIEWS[tool];
  const ctx = { getIcon, tool, setTool, currentReviewIdRef, contracts, setContracts, error, setError, selectedContractIds, setSelectedContractIds, pendingDeleteId, setPendingDeleteId, pendingBulkDelete, setPendingBulkDelete, newTitle, setNewTitle, newFile, setNewFile, contract, setContract, review, setReview, obligations, setObligations, pickedPartyId, setPickedPartyId, manualPartyName, setManualPartyName, manualPartyRole, setManualPartyRole, partyNameDrafts, setPartyNameDrafts, correctionNote, setCorrectionNote, clauseFilter, setClauseFilter, clauseSort, setClauseSort, question, setQuestion, qaHistory, setQaHistory, qaLoading, setQaLoading, reportEmail, setReportEmail, reportBusy, setReportBusy, crmClients, setCrmClients, titleDraft, setTitleDraft, contractReviews, setContractReviews, reviewAsPartyId, setReviewAsPartyId, revisionBusy, setRevisionBusy, compareFor, setCompareFor, compareResult, setCompareResult, compareLoading, setCompareLoading, confirmAction, setConfirmAction, obligationOwnerFilter, setObligationOwnerFilter, obligationStatusFilter, setObligationStatusFilter, obligationDueFrom, setObligationDueFrom, obligationDueTo, setObligationDueTo, switchPerspectiveOpen, setSwitchPerspectiveOpen, revisionUploadOpenFor, setRevisionUploadOpenFor, comparePartyId, setComparePartyId, compareOldReviewId, setCompareOldReviewId, compareNewReviewId, setCompareNewReviewId, compareViewMode, setCompareViewMode, compareFullResult, setCompareFullResult, compareFullLoading, setCompareFullLoading, compareFullError, setCompareFullError, crmClientIdFilter, compareVersionsForParty, loadContracts, toggleContractSelected, toggleSelectAllContracts, deleteContractFromList, deleteSelectedContracts, loadContractReviews, openContract, openReview, saveTitle, createContract, pollReviewUntilTerminal, confirmPartyIdAndResume, confirmRole, savePartyField, linkPartyClient, addManualPartyAndConfirm, recordCorrection, addToTask, setObligationState, toggleHold, markExecuted, reviewAsParty, runCompare, runFullCompare, uploadRevision, setStatus, deleteContract, exportIcs, askQuestion, downloadReport, emailReport, setObligationField };

  return (
    <div style={{ background: 'var(--color-bg)', color: 'var(--color-text)', minHeight: '100dvh' }}>
      <NotLegalAdviceBanner />
      <VoiceInputProvider lang="en-AU">
        <ContractReviewContext.Provider value={ctx}>
          <div className="flex flex-col sm:flex-row min-h-[calc(100dvh-5rem)]">
            <ToolSidebar
              title="Contract Review"
              icon="clipboard-list"
              groups={MENU}
              current={tool}
              onSelect={setTool}
              onInfo={info.open}
              infoTip="How Contract Review works: why it asks which party you are, what the badges mean, and what it cannot do."
              onTour={startTour}
              tourTip="Take the guided tour of Contract Review: the jobs, each tool, the verdict and the guide."
            >
              <Tooltip text="Go back to the list of jobs (review a contract before you sign, check a new revision, and so on).">
                <button
                  type="button"
                  onClick={backToStart}
                  className="w-full flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-opacity hover:opacity-70"
                  style={{ borderColor: tool === 'start' ? 'var(--color-primary)' : 'var(--color-border)', color: tool === 'start' ? 'var(--color-primary)' : 'var(--color-text)', background: 'var(--color-bg)' }}
                >
                  {getIcon('layout-grid', { size: 13 })}
                  What do you want to do?
                </button>
              </Tooltip>
              {contract && (
                <div className="rounded-lg border px-2.5 py-2 text-xs" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }} data-tour="contract-review-open">
                  <div style={{ color: 'var(--color-muted)' }}>Open contract</div>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => setTool('review')} title={contract.title} className="font-medium truncate flex-1 text-left hover:opacity-70" style={{ color: 'var(--color-text)' }}>
                      {contract.title}
                    </button>
                    <Tooltip text="Close this contract and go back to Your contracts.">
                      <button type="button" onClick={closeContract} aria-label="Close this contract" className="hover:opacity-60" style={{ color: 'var(--color-muted)' }}>
                        {getIcon('close', { size: 12 })}
                      </button>
                    </Tooltip>
                  </div>
                </div>
              )}
            </ToolSidebar>

            <main className="flex-1 min-w-0 p-4 sm:p-6" style={{ background: 'var(--color-bg)' }} data-tour="contract-review-main">
              <div className="max-w-5xl space-y-4">
                {tool === 'start' && (
                  <div className="space-y-6">
                    <section className="rounded-2xl border p-6 flex flex-col sm:flex-row sm:items-center gap-4" data-tour="contract-review-check" style={{ borderColor: 'var(--color-primary)', background: 'var(--color-surface)' }}>
                      <div className="flex-1">
                        <h2 className="text-xl font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                          <span style={{ color: 'var(--color-primary)' }}>{getIcon('shield-check', { size: 20 })}</span>
                          What am I signing up to?
                        </h2>
                        <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
                          Upload the contract and say which party you are. You get a verdict for your side, every risky or unclear clause with why it matters, and what you would have to do and by when.
                        </p>
                        {contracts.length > 0 && (
                          <Tooltip text="Contracts you reviewed before: open one to see its review, obligations and revisions.">
                            <button type="button" onClick={() => setTool('contracts')} className="text-sm mt-2 underline transition-opacity hover:opacity-60" style={{ color: 'var(--color-primary)' }}>
                              Or open one of your {contracts.length} contract{contracts.length === 1 ? '' : 's'}
                            </button>
                          </Tooltip>
                        )}
                      </div>
                      <Tooltip text="Give the contract a title and drop in the file; then confirm which party you are and read the verdict.">
                        <button type="button" onClick={() => startGoal(CHECK_GOAL)} className="px-6 py-3 rounded-xl text-base font-semibold transition-opacity hover:opacity-80"
                          style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}>
                          Review a contract
                        </button>
                      </Tooltip>
                    </section>
                    <JobStart
                      goals={OTHER_GOALS}
                      intro="Pick a job and Contract Review walks you through it, or choose a tool on the left. Informational only, not legal advice."
                      onPick={startGoal}
                      labelFor={labelFor}
                      openOnLast={openOnLast}
                      onToggleOpenOnLast={toggleOpenOnLast}
                      appName="Contract Review"
                      tourId="contract-review-jobs"
                    />
                  </div>
                )}

                {tool !== 'start' && (
                  <>
                    <div className="space-y-3">
                      <BackToJobs onBack={backToStart} toolLabel={labelFor(tool)} goal={stepIndex(goal, tool) >= 0 ? goal : null} />
                      <JobBar goal={goal} mode={tool} onStep={setTool} labelFor={labelFor} carry="go to" />
                      <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{TOOL_BLURBS[tool]}</p>
                    </div>
                    {crmClientIdFilter && tool === 'contracts' && (
                      <div className="text-xs" style={{ color: 'var(--color-muted)' }}>
                        Showing contracts linked to this CRM contact only. <Link to="/contract-review" style={{ color: 'var(--color-primary)' }}>Show all contracts</Link>
                      </div>
                    )}
                    {error && <div style={{ color: '#991b1b' }} className="text-sm">{error}</div>}
                    {needsContract && !contract && (
                      <div className="rounded-lg border p-6 text-center space-y-3" style={CARD}>
                        <p className="text-sm">{labelFor(tool)} works on one contract. Open one of yours, or start a new review.</p>
                        <div className="flex justify-center gap-2">
                          <PrimaryButton onClick={() => setTool('contracts')}>Your contracts</PrimaryButton>
                          <SecondaryButton onClick={() => setTool('new')}>New review</SecondaryButton>
                        </div>
                      </div>
                    )}
                    {needsContract && contract && (
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <Tooltip text="Click to rename this contract. Saves automatically when you click away.">
                          <input
                            type="text" value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)}
                            onBlur={saveTitle} onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                            aria-label="Contract title"
                            className="text-lg font-semibold rounded border px-2 py-1 bg-transparent"
                            style={{ borderColor: 'transparent', minWidth: 200 }}
                            onFocus={(e) => { e.target.style.borderColor = 'var(--color-border)'; }}
                          />
                        </Tooltip>
                        <div className="flex items-center gap-2">
                          <Badge bg="var(--color-bg)" color="var(--color-muted)"><span className="capitalize">{contractTypeLabel(contract)}</span></Badge>
                          <Badge bg={(CONTRACT_STATUS_BADGE[contract.status] || {}).bg} color={(CONTRACT_STATUS_BADGE[contract.status] || {}).color}>
                            {(CONTRACT_STATUS_BADGE[contract.status] || {}).text || contract.status}
                          </Badge>
                          {contract.legalHold && getIcon('lock', { size: 14, color: '#92400e' })}
                        </div>
                      </div>
                    )}
                    {View && (!needsContract || contract) && <View />}
                  </>
                )}
              </div>
            </main>
          </div>
        </ContractReviewContext.Provider>
        <ContractReviewTutorChat currentTool={tool === 'start' ? 'new' : tool} onOpenTool={openGuideTool} />
      </VoiceInputProvider>

      {info.show && (
        <ToolInfoModal title="How Contract Review Works" onClose={info.close}>
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>
            Upload a contract and get a plain-English review for your side. Pick a job on the start screen or a tool in the list on the left; hover any tool for a plain explanation. Not sure where to start? Press the round button at the bottom right and tell the guide what you want to do.
          </p>
          <div className="rounded-lg p-3 text-sm space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            {HOW_IT_WORKS.map(([heading, text]) => (
              <p key={heading} style={{ color: 'var(--color-text)' }}><strong>{heading}</strong> — {text}</p>
            ))}
          </div>
        </ToolInfoModal>
      )}
    </div>
  );

}
