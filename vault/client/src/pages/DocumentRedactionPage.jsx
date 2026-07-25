import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import useProcessingStore from '../store/processingStore';
import useAuthStore from '../store/authStore';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import DocumentRedactionCompare from '../components/DocumentRedactionCompare';

const LAST_JOB_KEY = 'vault:documentRedaction:lastJobId';
const FIELD = {
  background: 'var(--color-bg)',
  borderColor: 'var(--color-border)',
  color: 'var(--color-text)',
};

/** Human style picker → apply `target` (mirrors server UI_STYLE_TO_TARGET). */
const STYLE_OPTIONS = [
  {
    id: 'Blackout',
    label: 'Blackout',
    hint: 'Replace with [REDACTED_…] tokens. Fast — no model call.',
    fast: true,
    target: { consumer: 'legal-disclosure', requirement: 'must-be-unambiguously-withheld' },
  },
  {
    id: 'Generalized',
    label: 'Generalized',
    hint: 'Ranges/buckets like $1.1M–$1.2M or “Major Bank”. Fast.',
    fast: true,
    target: { consumer: 'public-summary', requirement: 'must-preserve-aggregate-properties' },
  },
  {
    id: 'Realistic',
    label: 'Realistic',
    hint: 'Plausible fake values. Default uses fast heuristics; optional model call is slower.',
    fast: true,
    target: { consumer: 'human-review', requirement: 'must-remain-readable' },
  },
  {
    id: 'Realistic + arithmetic',
    label: 'Realistic + linked figures',
    hint: 'Keeps income → surplus → capacity ratios. Fast heuristics by default.',
    fast: true,
    target: { consumer: 'frontier-logic-check', requirement: 'must-remain-arithmetically-consistent' },
  },
];

function sourceBadge(c) {
  const label = c.sourceLabel || c.source || 'unknown';
  if (label === 'llm' || c.source === 'local_llm') return { text: 'LLM', bg: '#e0e7ff', color: '#3730a3' };
  if (label === 'pattern-match' || c.source === 'deterministic') return { text: 'Pattern', bg: '#fef3c7', color: '#b45309' };
  if (label === 'user-added-later' || c.source === 'user_added') return { text: 'User', bg: '#d1fae5', color: '#047857' };
  if (label === 'frontier' || c.source === 'frontier_suggested') return { text: 'Frontier', bg: '#fce7f3', color: '#9d174d' };
  return { text: String(label), bg: 'var(--color-bg)', color: 'var(--color-muted)' };
}

function decisionColor(d) {
  if (d === 'approved' || d === 'edited') return '#16a34a';
  if (d === 'rejected') return '#991b1b';
  return 'var(--color-muted)';
}

export default function DocumentRedactionPage() {
  const { jobId: routeJobId } = useParams();
  const navigate = useNavigate();
  const getIcon = useIcon();
  const isAdmin = useAuthStore((s) => s.user?.isAdmin);
  const { startProcessing, stopProcessing } = useProcessingStore();
  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });

  const [jobs, setJobs] = useState([]);
  const [brief, setBrief] = useState('');
  const [file, setFile] = useState(null);
  const [skipLlm, setSkipLlm] = useState(true); // fast default — LLM can take minutes
  const [error, setError] = useState('');
  const [loadingJob, setLoadingJob] = useState(false);
  const [job, setJob] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [document, setDocument] = useState(null);
  const [summary, setSummary] = useState({ approved: 0, rejected: 0, pending: 0, total: 0 });

  const [sortKey, setSortKey] = useState('score');
  const [sortDir, setSortDir] = useState('desc');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [filterDecision, setFilterDecision] = useState('');
  const [minScore, setMinScore] = useState(0);

  const [editingId, setEditingId] = useState(null);
  const [editReplacement, setEditReplacement] = useState('');
  const [editCategory, setEditCategory] = useState('');

  const [selection, setSelection] = useState(null);
  const [addCategory, setAddCategory] = useState('user_added');
  const [addReplacement, setAddReplacement] = useState('');
  const [applyResult, setApplyResult] = useState(null);
  const [viewMode, setViewMode] = useState('review'); // review | compare
  const [compare, setCompare] = useState(null);
  const [coherence, setCoherence] = useState(null);
  const [frontierAnalysis, setFrontierAnalysis] = useState(null);
  const [frontierInstructions, setFrontierInstructions] = useState('');
  const [applyModal, setApplyModal] = useState(null); // { applyPass }
  const [applyStyleId, setApplyStyleId] = useState('Blackout');
  const [applyUseModel, setApplyUseModel] = useState(false);
  const [stylePreview, setStylePreview] = useState(null);
  const [stylePreviewLoading, setStylePreviewLoading] = useState(false);
  const [stylePreviewError, setStylePreviewError] = useState('');
  const applyAbortRef = useRef(null);
  const previewRef = useRef(null);

  useEffect(() => {
    api.get('/api/settings/feature-access')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.flags) setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...data.flags });
      })
      .catch(() => {});
  }, []);

  const enabled = isAdmin || featureAccess.documentRedaction !== false;

  const loadJobList = useCallback(async () => {
    const res = await api.get('/api/document-redaction/jobs');
    if (!res.ok) return;
    const data = await res.json();
    setJobs(data.jobs || []);
  }, []);

  const loadJob = useCallback(async (id) => {
    if (!id) return;
    setError('');
    setLoadingJob(true);
    try {
      const res = await api.get(`/api/document-redaction/jobs/${id}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not load job');
        return;
      }
      setJob(data.job);
      setCandidates(data.candidates || []);
      setDocument(data.document);
      setSummary(data.summary || decisionSummaryLocal(data.candidates || []));
      setApplyResult(null);
      setCompare(null);
      setCoherence(data.job?.coherence || null);
      setFrontierAnalysis(data.job?.frontierAnalysis || null);
      const applied = Boolean(data.job?.redactedLocalDocx)
        || ['pdf_ready', 'docx_ready_pdf_pending', 'ready_for_frontier', 'hitl_frontier', 'ready_for_final', 'completed'].includes(data.job?.status);
      setViewMode(applied ? 'compare' : 'review');
      try { localStorage.setItem(LAST_JOB_KEY, id); } catch { /* ignore */ }
    } finally {
      setLoadingJob(false);
    }
  }, []);

  const loadCompare = useCallback(async (id) => {
    if (!id) return;
    const res = await api.get(`/api/document-redaction/jobs/${id}/compare`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || 'Could not load compare');
      return;
    }
    setCompare(data);
    if (data.job) setJob((prev) => ({ ...prev, ...data.job }));
  }, []);

  useEffect(() => {
    if (viewMode === 'compare' && job?.id) {
      loadCompare(job.id);
    }
  }, [viewMode, job?.id, loadCompare]);

  useEffect(() => {
    if (!enabled) return;
    loadJobList();
  }, [enabled, loadJobList]);

  useEffect(() => {
    if (!enabled) return;
    if (routeJobId) {
      loadJob(routeJobId);
    } else {
      // Landing / "New upload" — clear in-memory job so the form shows
      setJob(null);
      setCandidates([]);
      setDocument(null);
      setViewMode('review');
      setCompare(null);
    }
  }, [enabled, routeJobId, loadJob]);

  const categories = useMemo(() => {
    const set = new Set(candidates.map((c) => c.categoryLabel).filter(Boolean));
    return [...set].sort();
  }, [candidates]);

  const visible = useMemo(() => {
    let list = [...candidates];
    if (filterCategory) list = list.filter((c) => c.categoryLabel === filterCategory);
    if (filterSource) {
      list = list.filter((c) => {
        if (filterSource === 'llm') return c.source === 'local_llm' || c.sourceLabel === 'llm';
        if (filterSource === 'pattern') return c.source === 'deterministic' || c.sourceLabel === 'pattern-match';
        if (filterSource === 'user') return c.source === 'user_added' || c.sourceLabel === 'user-added-later';
        if (filterSource === 'frontier') return c.source === 'frontier_suggested' || c.sourceLabel === 'frontier';
        return true;
      });
    }
    if (filterDecision) {
      list = list.filter((c) => {
        if (filterDecision === 'pending') return !c.decision || c.decision === 'pending';
        if (filterDecision === 'approved') return c.decision === 'approved' || c.decision === 'edited';
        return c.decision === filterDecision;
      });
    }
    list = list.filter((c) => Number(c.score || 0) >= Number(minScore || 0));
    list.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortKey === 'score') return (Number(a.score) - Number(b.score)) * dir;
      if (sortKey === 'occurrences') return ((a.occurrenceCount || 0) - (b.occurrenceCount || 0)) * dir;
      if (sortKey === 'category') return String(a.categoryLabel || '').localeCompare(String(b.categoryLabel || '')) * dir;
      if (sortKey === 'entity') return String(a.entityText || '').localeCompare(String(b.entityText || '')) * dir;
      return 0;
    });
    return list;
  }, [candidates, filterCategory, filterSource, filterDecision, minScore, sortKey, sortDir]);

  async function handlePropose(e) {
    e.preventDefault();
    if (!file || !brief.trim()) {
      setError('Choose a document and enter a redaction brief.');
      return;
    }
    setError('');
    const controller = new AbortController();
    applyAbortRef.current = controller;
    startProcessing(
      'Extracting redaction candidates…',
      skipLlm ? 'Pattern-match only.' : 'Local model + pattern backstop. You can Cancel.',
      {
        onCancel: () => {
          controller.abort();
          setError('Propose cancelled');
        },
      },
    );
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('brief', brief.trim());
      if (skipLlm) fd.append('skipLlm', '1');
      const res = await api.postForm('/api/document-redaction/propose', fd, { signal: controller.signal });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Propose failed');
      await loadJobList();
      navigate(`/document-redaction/${data.job.id}`);
    } catch (err) {
      if (err.name === 'AbortError') setError('Propose cancelled');
      else setError(err.message || 'Propose failed');
    } finally {
      applyAbortRef.current = null;
      stopProcessing();
    }
  }

  async function patch(candidateId, body) {
    setError('');
    const res = await api.patch(`/api/document-redaction/jobs/${job.id}/candidates/${candidateId}`, body);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || 'Update failed');
      return;
    }
    setCandidates(data.candidates || []);
    setSummary(data.summary || decisionSummaryLocal(data.candidates || []));
  }

  function startEdit(c) {
    setEditingId(c.id);
    setEditReplacement(c.userReplacement || c.suggestedReplacement || '');
    setEditCategory(c.categoryLabel || '');
  }

  async function saveEdit(c) {
    await patch(c.id, {
      suggestedReplacement: editReplacement,
      categoryLabel: editCategory,
      decision: 'edited',
    });
    setEditingId(null);
  }

  function onPreviewMouseUp() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !previewRef.current) {
      setSelection(null);
      return;
    }
    if (!previewRef.current.contains(sel.anchorNode)) {
      setSelection(null);
      return;
    }
    const text = String(sel.toString() || '').trim();
    if (!text) {
      setSelection(null);
      return;
    }
    let node = sel.anchorNode;
    if (node?.nodeType === Node.TEXT_NODE) node = node.parentElement;
    const paraEl = node?.closest?.('[data-paragraph-id]');
    const paragraphId = paraEl?.getAttribute('data-paragraph-id') || null;
    let startOffset;
    let endOffset;
    if (paragraphId && paraEl) {
      const full = paraEl.textContent || '';
      const idx = full.indexOf(text);
      if (idx >= 0) {
        startOffset = idx;
        endOffset = idx + text.length;
      }
    }
    setSelection({ entityText: text, paragraphId, startOffset, endOffset });
    setAddReplacement(`REDACTED_${text.slice(0, 16).replace(/\s+/g, '_')}`);
  }

  async function addFromSelection() {
    if (!selection?.entityText || !job) return;
    setError('');
    const res = await api.post(`/api/document-redaction/jobs/${job.id}/candidates`, {
      entityText: selection.entityText,
      paragraphId: selection.paragraphId,
      startOffset: selection.startOffset,
      endOffset: selection.endOffset,
      categoryLabel: addCategory,
      suggestedReplacement: addReplacement,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || 'Could not add candidate');
      return;
    }
    setCandidates(data.candidates || []);
    setSummary(data.summary || decisionSummaryLocal(data.candidates || []));
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }

  async function requestMore() {
    if (!job) return;
    setError('');
    startProcessing('Requesting more suggestions…', 'Re-running the local model with your approve/reject feedback.');
    try {
      const res = await api.post(`/api/document-redaction/jobs/${job.id}/resuggest`, {});
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Resuggest failed');
      setCandidates(data.candidates || []);
      setSummary(data.summary || decisionSummaryLocal(data.candidates || []));
    } catch (err) {
      setError(err.message || 'Resuggest failed');
    } finally {
      stopProcessing();
    }
  }

  async function approveAllPending() {
    if (!job) return;
    const pending = candidates.filter((c) => !c.decision || c.decision === 'pending');
    if (!pending.length) return;
    setError('');
    startProcessing(`Approving ${pending.length} pending…`, 'Saving decisions.', {
      onCancel: () => setError('Bulk approve interrupted — refresh if counts look wrong.'),
    });
    try {
      for (const c of pending) {
        // Sequential to avoid race on candidate file writes
        // eslint-disable-next-line no-await-in-loop
        await patch(c.id, { decision: 'approved' });
      }
    } catch (err) {
      setError(err.message || 'Bulk approve failed');
    } finally {
      stopProcessing();
    }
  }

  async function handleApply(opts = {}) {
    if (!job) return;
    const applyPass = opts.applyPass === 'frontier' ? 'frontier' : 'local';
    const scoped = applyPass === 'frontier'
      ? candidates.filter((c) => c.source === 'frontier_suggested' || c.sourceLabel === 'frontier')
      : candidates.filter((c) => c.source !== 'frontier_suggested' && c.sourceLabel !== 'frontier');
    const pendingHigh = scoped.filter((c) => (!c.decision || c.decision === 'pending') && Number(c.score || 0) >= 0.5);
    const approvedCount = scoped.filter((c) => c.decision === 'approved' || c.decision === 'edited').length;
    if (pendingHigh.length && !opts.skipPendingCheck) {
      setError(`${pendingHigh.length} high-score pending still need Approve/Reject. Use “Approve all pending” or decide each one, then Apply.`);
      return;
    }
    if (approvedCount < 1) {
      setError(applyPass === 'frontier'
        ? 'Approve at least one frontier suggestion before applying.'
        : 'Approve at least one candidate first (or “Approve all pending”), then Apply — you’ll confirm style & preview there.');
      return;
    }

    // Open confirm modal with preview (style already chosen in toolbar)
    if (!opts.skipStyleModal) {
      setApplyModal({ applyPass, approvedCount });
      setStylePreview(null);
      setStylePreviewError('');
      return;
    }

    const style = STYLE_OPTIONS.find((s) => s.id === opts.styleId) || STYLE_OPTIONS[0];
    const skipLlm = !opts.useModel || style.id === 'Blackout' || style.id === 'Generalized';

    setError('');
    setApplyResult(null);
    setApplyModal(null);

    const controller = new AbortController();
    applyAbortRef.current = controller;
    startProcessing(
      applyPass === 'frontier' ? 'Applying frontier suggestions…' : 'Applying redactions…',
      `${style.label} · ${skipLlm ? 'fast heuristics' : 'local model'} · you can Cancel`,
      {
        onCancel: () => {
          controller.abort();
          setError('Apply cancelled');
        },
        steps: ['Building replacements', 'Writing redacted document', 'PDF export (if available)'],
      },
    );
    try {
      const res = await api.post(`/api/document-redaction/jobs/${job.id}/apply`, {
        confirmApply: true,
        applyPass,
        acceptTrackedChanges: Boolean(opts.acceptTrackedChanges),
        target: style.target,
        skipLlm,
      }, { signal: controller.signal });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === 'CANCELLED') {
          setError('Apply cancelled');
          return;
        }
        if (data.code === 'TRACKED_CHANGES') {
          stopProcessing();
          const proceed = window.confirm(
            `${data.error}\n\nAccept all tracked changes and scrub them? This can change visible content.`,
          );
          if (proceed) {
            return handleApply({
              skipStyleModal: true,
              skipConfirm: true,
              acceptTrackedChanges: true,
              applyPass,
              styleId: style.id,
              useModel: opts.useModel,
            });
          }
          setError(data.error || 'Tracked changes blocked apply');
          return;
        }
        const detail = data.blocking?.length
          ? ` Blocking: ${data.blocking.map((b) => b.entityText || b.id).join(', ')}`
          : '';
        throw new Error((data.error || 'Apply failed') + detail);
      }
      setApplyResult(data);
      if (data.job) setJob((prev) => ({ ...prev, ...data.job }));
      setViewMode('compare');
      await loadCompare(job.id);
    } catch (err) {
      if (err.name === 'AbortError') {
        setError('Apply cancelled');
      } else {
        setError(err.message || 'Apply failed');
      }
    } finally {
      applyAbortRef.current = null;
      stopProcessing();
    }
  }

  async function loadStylePreview(styleId) {
    if (!job || !applyModal) return;
    const style = STYLE_OPTIONS.find((s) => s.id === styleId) || STYLE_OPTIONS[0];
    setStylePreviewLoading(true);
    setStylePreviewError('');
    try {
      const res = await api.post(`/api/document-redaction/jobs/${job.id}/preview-substitution`, {
        target: style.target,
        applyPass: applyModal.applyPass,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Preview failed');
      setStylePreview(data);
    } catch (err) {
      setStylePreview(null);
      setStylePreviewError(err.message || 'Preview failed');
    } finally {
      setStylePreviewLoading(false);
    }
  }

  useEffect(() => {
    if (!applyModal) return undefined;
    loadStylePreview(applyStyleId);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyModal, applyStyleId]);

  async function handleApplyFrontier(opts = {}) {
    return handleApply({ ...opts, applyPass: 'frontier' });
  }

  async function handleCoherence() {
    if (!job) return;
    setError('');
    startProcessing('Running coherence check…', 'Local model only — no frontier calls.');
    try {
      const res = await api.post(`/api/document-redaction/jobs/${job.id}/coherence`, {});
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Coherence check failed');
      setCoherence(data.coherence);
    } catch (err) {
      setError(err.message || 'Coherence check failed');
    } finally {
      stopProcessing();
    }
  }

  async function handleRetryPdf() {
    if (!job) return;
    setError('');
    startProcessing('Retrying PDF conversion…', 'LibreOffice convert of redacted.docx only.');
    try {
      const res = await api.post(`/api/document-redaction/jobs/${job.id}/retry-pdf`, {});
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'PDF conversion failed');
      if (data.job) setJob((prev) => ({ ...prev, ...data.job }));
      await loadCompare(job.id);
    } catch (err) {
      setError(err.message || 'PDF conversion failed');
    } finally {
      stopProcessing();
    }
  }

  async function handleFixLeftovers() {
    if (!job) return;
    setError('');
    startProcessing('Fixing leftovers…', 'Patching redacted.docx from the entity map (no frontier calls).');
    try {
      const res = await api.post(`/api/document-redaction/jobs/${job.id}/fix-leftovers`, {});
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Fix leftovers failed');
      if (data.job) setJob((prev) => ({ ...prev, ...data.job }));
      if (data.compare) setCompare(data.compare);
      else await loadCompare(job.id);
    } catch (err) {
      setError(err.message || 'Fix leftovers failed');
    } finally {
      stopProcessing();
    }
  }

  async function handleFrontierAnalyze() {
    if (!job) return;
    setError('');
    startProcessing('Running frontier analysis…', 'Sanitized PDF only — entity map stays local.');
    try {
      const res = await api.post(`/api/document-redaction/jobs/${job.id}/frontier-analyze`, {
        instructions: frontierInstructions,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === 'ENTITY_LEAK_IN_PAYLOAD') {
          throw new Error(data.error || 'Entity leak blocked the frontier call');
        }
        throw new Error(data.error || 'Frontier analysis failed');
      }
      setFrontierAnalysis({
        analysis: data.analysis,
        ranAt: data.frontier?.ranAt,
        modelId: data.frontier?.modelId,
        suggestionCount: data.suggestionCount,
        parseError: data.frontier?.parseError,
      });
      if (data.candidates) setCandidates(data.candidates);
      if (data.job) setJob((prev) => ({ ...prev, ...data.job }));
      setSummary(decisionSummaryLocal(data.candidates || candidates));
    } catch (err) {
      setError(err.message || 'Frontier analysis failed');
    } finally {
      stopProcessing();
    }
  }

  async function handleApproveFrontier() {
    if (!job) return;
    if (!window.confirm('Approve this local redaction pass for frontier analysis? This does not call any external API yet — it only unlocks Milestone 5.')) {
      return;
    }
    setError('');
    try {
      const res = await api.post(`/api/document-redaction/jobs/${job.id}/approve-frontier`, { confirm: true });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === 'UNRESOLVED_LEFTOVERS') {
          throw new Error(data.error || 'Unresolved leftovers block frontier approval');
        }
        throw new Error(data.error || 'Approval failed');
      }
      if (data.job) setJob((prev) => ({ ...prev, ...data.job }));
      await loadCompare(job.id);
    } catch (err) {
      setError(err.message || 'Approval failed');
    }
  }

  async function handleApproveFinal() {
    if (!job) return;
    if (!window.confirm(
      'Approve the final document? This unlocks the finished export package and writes an INTERNAL-ONLY audit trail (may contain original values).',
    )) {
      return;
    }
    setError('');
    startProcessing('Finalizing document…', 'Writing INTERNAL-ONLY audit trail and marking the job complete.');
    try {
      const res = await api.post(`/api/document-redaction/jobs/${job.id}/approve-final`, { confirm: true });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Final approval failed');
      }
      if (data.job) setJob((prev) => ({ ...prev, ...data.job }));
      await loadCompare(job.id);
    } catch (err) {
      setError(err.message || 'Final approval failed');
    } finally {
      stopProcessing();
    }
  }

  function downloadArtifact(name) {
    if (!job?.id || !name) return;
    // apiClient doesn't expose blob download helpers — use token from store
    const token = useAuthStore.getState().token;
    const url = `/api/document-redaction/jobs/${job.id}/download/${name}`;
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Download failed');
        }
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((err) => setError(err.message || 'Download failed'));
  }

  if (!enabled) {
    return (
      <div className="flex-1 p-6">
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Document redaction is disabled for this workspace.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="shrink-0 px-4 sm:px-6 py-3 border-b flex flex-wrap items-center justify-between gap-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Document redaction</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
            Local HITL → compare → frontier suggestions → three-way → final approve.
          </p>
        </div>
        {job && (
          <div className="flex flex-wrap items-center gap-3 text-xs" style={{ color: 'var(--color-muted)' }}>
            <span><strong style={{ color: '#16a34a' }}>{summary.approved}</strong> approved</span>
            <span><strong style={{ color: '#991b1b' }}>{summary.rejected}</strong> rejected</span>
            <span><strong style={{ color: 'var(--color-text)' }}>{summary.pending}</strong> pending</span>
            <span className="font-mono opacity-70">{job.id.slice(0, 8)}…</span>
          </div>
        )}
      </div>

      {error && (
        <div className="mx-4 sm:mx-6 mt-3 px-3 py-2 rounded-xl text-xs" style={{ background: '#fff1f2', color: '#991b1b' }}>
          {error}
        </div>
      )}

      {job?.ingestNote && (
        <div className="mx-4 sm:mx-6 mt-3 px-3 py-2 rounded-xl text-xs" style={{ background: '#FFFBEB', color: '#92400e' }}>
          {job.ingestNote}
        </div>
      )}

      {!routeJobId && (
        <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-6">
          <form onSubmit={handlePropose} className="rounded-2xl border p-6 space-y-4 max-w-2xl" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>New review</h2>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Document</label>
              <input
                type="file"
                accept=".docx,.doc,.odt,.rtf,.pdf,.txt,.md,.csv,.json,.html,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/csv,application/json,text/html"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="block w-full text-sm"
                style={{ color: 'var(--color-text)' }}
              />
              <p className="text-[11px] mt-1.5" style={{ color: 'var(--color-muted)' }}>
                .docx, .doc, .pdf, .txt, .odt, .rtf, .md, .csv, .json, .html — non-Word files are converted to a working .docx for redaction (PDF layout is not preserved).
              </p>
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>What should be redacted?</label>
              <textarea
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                rows={4}
                placeholder='e.g. redact all client names, financial figures, and anything that could identify the hospital'
                className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
                style={FIELD}
              />
            </div>
            <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
              <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Extract speed</p>
              <label className="flex items-start gap-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={skipLlm}
                  onChange={(e) => setSkipLlm(e.target.checked)}
                />
                <span>
                  <strong style={{ color: 'var(--color-text)' }}>Fast extract (pattern-match only)</strong>
                  {' '}— figures, %, emails, phones. Usually seconds.
                  Uncheck to also run the local AI model (can take several minutes on denser docs).
                </span>
              </label>
              <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
                Redaction <em>style</em> (Blackout / Realistic / …) is chosen on the next screen while you review candidates — not during extract.
              </p>
            </div>
            <button
              type="submit"
              className="px-3.5 py-1.5 rounded-lg text-sm font-medium text-white transition-opacity duration-200 hover:opacity-80"
              style={{ background: 'var(--color-primary)' }}
            >
              Extract candidates
            </button>
          </form>

          {jobs.length > 0 && (
            <div className="rounded-2xl border overflow-hidden max-w-2xl" style={{ borderColor: 'var(--color-border)' }}>
              <div className="px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ background: 'var(--color-surface)', color: 'var(--color-muted)' }}>
                Recent jobs
              </div>
              {jobs.map((j) => (
                <Link
                  key={j.id}
                  to={`/document-redaction/${j.id}`}
                  className="block px-4 py-3 border-t transition-opacity duration-200 hover:opacity-70"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
                >
                  <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{j.originalFilename || 'Document'}</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                    {j.brief || '—'} · {j.decisionSummary
                      ? `${j.decisionSummary.approved}✓ ${j.decisionSummary.rejected}✗ ${j.decisionSummary.pending}?`
                      : `${j.candidateCount ?? '—'} candidates`}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {routeJobId && loadingJob && !job && (
        <p className="p-6 text-sm" style={{ color: 'var(--color-muted)' }}>Loading review…</p>
      )}

      {routeJobId && job && viewMode === 'compare' && (
        compare ? (
          <DocumentRedactionCompare
            compare={compare}
            coherence={coherence}
            frontierAnalysis={frontierAnalysis}
            frontierInstructions={frontierInstructions}
            onFrontierInstructionsChange={setFrontierInstructions}
            onRunFrontier={handleFrontierAnalyze}
            onRunCoherence={handleCoherence}
            onRetryPdf={handleRetryPdf}
            onFixLeftovers={handleFixLeftovers}
            onApproveFrontier={handleApproveFrontier}
            onApproveFinal={handleApproveFinal}
            onApplyFrontier={handleApplyFrontier}
            onDownload={downloadArtifact}
            onBackToReview={() => setViewMode('review')}
            onReviewFrontierSuggestions={() => {
              setFilterSource('frontier');
              setViewMode('review');
            }}
          />
        ) : (
          <p className="p-6 text-sm" style={{ color: 'var(--color-muted)' }}>Loading compare…</p>
        )
      )}

      {routeJobId && job && viewMode === 'review' && (
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-0">
          {/* Preview */}
          <div className="flex flex-col min-h-0 border-b lg:border-b-0 lg:border-r" style={{ borderColor: 'var(--color-border)' }}>
            <div className="shrink-0 px-4 py-2 flex items-center justify-between gap-2 border-b" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Document preview</p>
                <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Select text to add a missed candidate</p>
              </div>
              <div className="flex items-center gap-3">
                {jobs.length > 0 && (
                  <select
                    className="text-xs px-2 py-1 rounded-lg border outline-none max-w-[160px]"
                    style={FIELD}
                    value={job?.id || ''}
                    onChange={(e) => {
                      if (e.target.value) navigate(`/document-redaction/${e.target.value}`);
                    }}
                  >
                    <option value="" disabled>Switch job…</option>
                    {jobs.map((j) => (
                      <option key={j.id} value={j.id}>{j.originalFilename || j.id.slice(0, 8)}</option>
                    ))}
                  </select>
                )}
                <Link to="/document-redaction" className="text-xs transition-opacity duration-200 hover:opacity-70" style={{ color: 'var(--color-primary)' }}>
                  New upload
                </Link>
              </div>
            </div>
            {selection && (
              <div className="shrink-0 px-4 py-3 space-y-2 border-b" style={{ borderColor: 'var(--color-border)', background: '#FFFBEB' }}>
                <p className="text-xs" style={{ color: '#92400e' }}>
                  Add: <strong>&ldquo;{selection.entityText}&rdquo;</strong>
                  {selection.paragraphId ? ` in ${selection.paragraphId}` : ''}
                </p>
                <div className="flex flex-wrap gap-2">
                  <input
                    value={addCategory}
                    onChange={(e) => setAddCategory(e.target.value)}
                    placeholder="Category"
                    className="px-2 py-1 rounded-lg border text-xs outline-none"
                    style={FIELD}
                  />
                  <input
                    value={addReplacement}
                    onChange={(e) => setAddReplacement(e.target.value)}
                    placeholder="Replacement"
                    className="px-2 py-1 rounded-lg border text-xs outline-none flex-1 min-w-[140px]"
                    style={FIELD}
                  />
                  <button
                    type="button"
                    onClick={addFromSelection}
                    className="px-2.5 py-1 rounded-lg text-xs font-medium text-white transition-opacity duration-200 hover:opacity-80"
                    style={{ background: 'var(--color-primary)' }}
                  >
                    Add candidate
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelection(null)}
                    className="px-2.5 py-1 rounded-lg text-xs border transition-opacity duration-200 hover:opacity-70"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            <div
              ref={previewRef}
              onMouseUp={onPreviewMouseUp}
              className="flex-1 overflow-auto p-4 space-y-3 text-sm leading-relaxed"
              style={{ color: 'var(--color-text)', background: 'var(--color-bg)' }}
            >
              {(document?.paragraphs || []).map((p) => (
                <p
                  key={p.paragraphId}
                  data-paragraph-id={p.paragraphId}
                  className="rounded-lg px-2 py-1"
                  style={{ background: 'var(--color-surface)' }}
                  title={p.paragraphId}
                >
                  {highlightParagraph(p.text, candidates)}
                </p>
              ))}
              {!document?.paragraphs?.length && (
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No document text loaded.</p>
              )}
            </div>
          </div>

          {/* Candidates */}
          <div className="flex flex-col min-h-0">
            <div className="shrink-0 px-4 py-2 border-b space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  Candidates ({visible.length}/{candidates.length})
                </p>
                <div className="flex flex-wrap gap-2">
                  {(job.redactedLocalDocx || applyResult) && (
                    <button
                      type="button"
                      onClick={() => setViewMode('compare')}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-opacity duration-200 hover:opacity-70"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                    >
                      Open compare
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={requestMore}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-opacity duration-200 hover:opacity-70"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  >
                    {getIcon('refresh-cw', { size: 12 })}
                    Request more suggestions
                  </button>
                  {summary.pending > 0 && (
                    <button
                      type="button"
                      onClick={approveAllPending}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-opacity duration-200 hover:opacity-70"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                    >
                      Approve all pending ({summary.pending})
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleApply}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-white transition-opacity duration-200 hover:opacity-80"
                    style={{ background: 'var(--color-primary)' }}
                  >
                    Apply redactions
                  </button>
                  {(filterSource === 'frontier' || candidates.some((c) => c.source === 'frontier_suggested')) && (
                    <button
                      type="button"
                      onClick={handleApplyFrontier}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-opacity duration-200 hover:opacity-70"
                      style={{ borderColor: '#f9a8d4', color: '#9d174d', background: '#fdf2f8' }}
                    >
                      Apply frontier suggestions
                    </button>
                  )}
                </div>
              </div>

              <div
                className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2"
                style={{ borderColor: 'var(--color-primary)', background: 'var(--color-bg)' }}
              >
                <label className="text-xs font-semibold" style={{ color: 'var(--color-text)' }} htmlFor="redaction-style-toolbar">
                  Redaction style
                </label>
                <select
                  id="redaction-style-toolbar"
                  value={applyStyleId}
                  onChange={(e) => setApplyStyleId(e.target.value)}
                  className="px-2 py-1 rounded-lg border text-xs outline-none"
                  style={FIELD}
                >
                  {STYLE_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                  ))}
                </select>
                <span className="text-[11px] flex-1 min-w-[12rem]" style={{ color: 'var(--color-muted)' }}>
                  {STYLE_OPTIONS.find((s) => s.id === applyStyleId)?.hint}
                </span>
                {(applyStyleId === 'Realistic' || applyStyleId === 'Realistic + arithmetic') && (
                  <label className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--color-muted)' }}>
                    <input type="checkbox" checked={applyUseModel} onChange={(e) => setApplyUseModel(e.target.checked)} />
                    Use local model (slower)
                  </label>
                )}
              </div>
              {(applyResult || job?.redactedLocalDocx) && (
                <div
                  className="flex flex-wrap items-center gap-2 text-xs px-1 py-1 rounded-lg"
                  style={{
                    background: (applyResult?.pdfStatus || job?.pdfStatus) === 'pending' ? '#FFFBEB' : '#ecfdf5',
                    color: (applyResult?.pdfStatus || job?.pdfStatus) === 'pending' ? '#92400e' : '#065f46',
                  }}
                >
                  <span>
                    {(applyResult?.pdfStatus || job?.pdfStatus) === 'ready'
                      ? 'PDF ready'
                      : (applyResult?.pdfStatus || job?.pdfStatus) === 'pending'
                        ? 'DOCX ready — PDF pending'
                        : 'Applied'}
                    {applyResult?.stats ? ` · ${applyResult.stats.replacementsWritten} replacements` : ''}
                  </span>
                  {(applyResult?.artifacts?.redactedDocx || job?.redactedLocalDocx) && (
                    <button type="button" onClick={() => downloadArtifact('redacted.docx')} className="underline transition-opacity duration-200 hover:opacity-70">
                      Download .docx
                    </button>
                  )}
                  {(applyResult?.artifacts?.sanitizedPdf || job?.sanitizedPdf) && (
                    <button type="button" onClick={() => downloadArtifact('sanitized.pdf')} className="underline transition-opacity duration-200 hover:opacity-70">
                      Download .pdf
                    </button>
                  )}
                </div>
              )}
              <div className="flex flex-wrap gap-2 text-xs">
                <select value={sortKey} onChange={(e) => setSortKey(e.target.value)} className="px-2 py-1 rounded-lg border outline-none" style={FIELD}>
                  <option value="score">Sort: score</option>
                  <option value="occurrences">Sort: occurrences</option>
                  <option value="category">Sort: category</option>
                  <option value="entity">Sort: entity</option>
                </select>
                <select value={sortDir} onChange={(e) => setSortDir(e.target.value)} className="px-2 py-1 rounded-lg border outline-none" style={FIELD}>
                  <option value="desc">Desc</option>
                  <option value="asc">Asc</option>
                </select>
                <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="px-2 py-1 rounded-lg border outline-none" style={FIELD}>
                  <option value="">All categories</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={filterSource} onChange={(e) => setFilterSource(e.target.value)} className="px-2 py-1 rounded-lg border outline-none" style={FIELD}>
                  <option value="">All sources</option>
                  <option value="llm">LLM</option>
                  <option value="pattern">Pattern</option>
                  <option value="user">User</option>
                  <option value="frontier">Frontier</option>
                </select>
                <select value={filterDecision} onChange={(e) => setFilterDecision(e.target.value)} className="px-2 py-1 rounded-lg border outline-none" style={FIELD}>
                  <option value="">All decisions</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved / edited</option>
                  <option value="rejected">Rejected</option>
                </select>
                <label className="flex items-center gap-1" style={{ color: 'var(--color-muted)' }}>
                  Min score
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={minScore}
                    onChange={(e) => setMinScore(Number(e.target.value) || 0)}
                    className="w-16 px-2 py-1 rounded-lg border outline-none"
                    style={FIELD}
                  />
                </label>
              </div>
            </div>

            <div className="flex-1 overflow-auto divide-y" style={{ borderColor: 'var(--color-border)' }}>
              {visible.map((c) => {
                const badge = sourceBadge(c);
                const isEditing = editingId === c.id;
                return (
                  <div key={c.id} className="px-4 py-3 space-y-2" style={{ background: 'var(--color-bg)' }}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                          {c.entityText || c.surfaceForms?.[0] || '—'}
                        </p>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface)', color: 'var(--color-muted)' }}>{c.categoryLabel}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: badge.bg, color: badge.color }}>{badge.text}</span>
                          <span className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
                            score {(Number(c.score) || 0).toFixed(2)} · conf {(Number(c.confidence) || 0).toFixed(2)} · ×{c.occurrenceCount || c.locations?.length || 0}
                          </span>
                          <span className="text-[10px] font-medium uppercase" style={{ color: decisionColor(c.decision) }}>
                            {c.decision || 'pending'}
                          </span>
                        </div>
                      </div>
                    </div>
                    {c.rationale && (
                      <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>{c.rationale}</p>
                    )}
                    {isEditing ? (
                      <div className="space-y-2">
                        <input
                          value={editCategory}
                          onChange={(e) => setEditCategory(e.target.value)}
                          className="w-full px-2 py-1.5 rounded-lg border text-xs outline-none"
                          style={FIELD}
                          placeholder="Category"
                        />
                        <input
                          value={editReplacement}
                          onChange={(e) => setEditReplacement(e.target.value)}
                          className="w-full px-2 py-1.5 rounded-lg border text-xs outline-none"
                          style={FIELD}
                          placeholder="Synthetic replacement"
                        />
                        <div className="flex gap-2">
                          <button type="button" onClick={() => saveEdit(c)} className="px-2.5 py-1 rounded-lg text-xs text-white transition-opacity duration-200 hover:opacity-80" style={{ background: 'var(--color-primary)' }}>Save</button>
                          <button type="button" onClick={() => setEditingId(null)} className="px-2.5 py-1 rounded-lg text-xs border transition-opacity duration-200 hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs" style={{ color: 'var(--color-text)' }}>
                        → <span className="font-mono">{c.userReplacement || c.suggestedReplacement}</span>
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => patch(c.id, { decision: 'approved' })} className="px-2 py-1 rounded-lg text-[11px] font-medium transition-opacity duration-200 hover:opacity-70" style={{ background: '#dcfce7', color: '#166534' }}>Approve</button>
                      <button type="button" onClick={() => patch(c.id, { decision: 'rejected' })} className="px-2 py-1 rounded-lg text-[11px] font-medium transition-opacity duration-200 hover:opacity-70" style={{ background: '#fff1f2', color: '#991b1b' }}>Reject</button>
                      <button type="button" onClick={() => startEdit(c)} className="px-2 py-1 rounded-lg text-[11px] border transition-opacity duration-200 hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>Edit</button>
                      {(c.decision === 'approved' || c.decision === 'edited' || c.decision === 'rejected') && (
                        <button type="button" onClick={() => patch(c.id, { decision: 'pending' })} className="px-2 py-1 rounded-lg text-[11px] border transition-opacity duration-200 hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>Reset</button>
                      )}
                    </div>
                  </div>
                );
              })}
              {visible.length === 0 && (
                <p className="px-4 py-8 text-center text-xs" style={{ color: 'var(--color-muted)' }}>No candidates match these filters.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {applyModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-2xl max-h-[90dvh] overflow-auto rounded-2xl border shadow-2xl p-5 space-y-4"
            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
          >
            <div>
              <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
                Confirm apply — {applyStyleId}
              </h2>
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                Style is set in the toolbar above. Preview a sample, then apply {applyModal.approvedCount} approved
                {applyModal.applyPass === 'frontier' ? ' frontier' : ''} redaction(s).
              </p>
            </div>

            <div className="space-y-2">
              {STYLE_OPTIONS.map((opt) => {
                const selected = applyStyleId === opt.id;
                return (
                  <label
                    key={opt.id}
                    className="flex gap-3 p-3 rounded-xl border cursor-pointer transition-opacity duration-200 hover:opacity-80"
                    style={{
                      borderColor: selected ? 'var(--color-primary)' : 'var(--color-border)',
                      background: 'var(--color-surface)',
                    }}
                  >
                    <input
                      type="radio"
                      name="redaction-style"
                      className="mt-1"
                      checked={selected}
                      onChange={() => setApplyStyleId(opt.id)}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium" style={{ color: 'var(--color-text)' }}>{opt.label}</span>
                      <span className="block text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{opt.hint}</span>
                    </span>
                  </label>
                );
              })}
            </div>

            {(applyStyleId === 'Realistic' || applyStyleId === 'Realistic + arithmetic') && (
              <label className="flex items-start gap-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={applyUseModel}
                  onChange={(e) => setApplyUseModel(e.target.checked)}
                />
                <span>
                  Higher-quality names via local model (can take several minutes). Leave unchecked for a fast apply.
                </span>
              </label>
            )}

            <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                  Sample preview
                </p>
                <button
                  type="button"
                  onClick={() => loadStylePreview(applyStyleId)}
                  className="text-xs underline transition-opacity duration-200 hover:opacity-70"
                  style={{ color: 'var(--color-primary)' }}
                >
                  Refresh
                </button>
              </div>
              {stylePreviewLoading && (
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Building preview…</p>
              )}
              {stylePreviewError && (
                <p className="text-xs" style={{ color: '#991b1b' }}>{stylePreviewError}</p>
              )}
              {stylePreview?.preview && !stylePreviewLoading && (
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] uppercase mb-1" style={{ color: 'var(--color-muted)' }}>Before</p>
                    <pre className="text-xs whitespace-pre-wrap break-words rounded-lg border p-2 max-h-48 overflow-auto" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}>
                      {stylePreview.preview.before || '(empty)'}
                    </pre>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase mb-1" style={{ color: 'var(--color-muted)' }}>After ({applyStyleId})</p>
                    <pre className="text-xs whitespace-pre-wrap break-words rounded-lg border p-2 max-h-48 overflow-auto" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}>
                      {stylePreview.preview.after || '(empty)'}
                    </pre>
                  </div>
                </div>
              )}
              {stylePreview?.samplePairs?.length > 0 && !stylePreviewLoading && (
                <ul className="text-[11px] space-y-1 pt-1" style={{ color: 'var(--color-muted)' }}>
                  {stylePreview.samplePairs.slice(0, 6).map((p) => (
                    <li key={p.entityKey}>
                      <span style={{ color: 'var(--color-text)' }}>{p.realValue}</span>
                      {' → '}
                      <span style={{ color: 'var(--color-primary)' }}>{p.syntheticValue}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setApplyModal(null)}
                className="px-3 py-1.5 rounded-lg text-xs border transition-opacity duration-200 hover:opacity-70"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleApply({
                  skipStyleModal: true,
                  applyPass: applyModal.applyPass,
                  styleId: applyStyleId,
                  useModel: applyUseModel,
                })}
                className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-white transition-opacity duration-200 hover:opacity-80"
                style={{ background: 'var(--color-primary)' }}
              >
                Apply with this style
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function decisionSummaryLocal(candidates) {
  const list = candidates || [];
  return {
    total: list.length,
    approved: list.filter((c) => c.decision === 'approved' || c.decision === 'edited').length,
    rejected: list.filter((c) => c.decision === 'rejected').length,
    pending: list.filter((c) => !c.decision || c.decision === 'pending').length,
  };
}

/** Light highlight of known entity strings in a paragraph (escape-safe). */
function highlightParagraph(text, candidates) {
  const forms = [];
  for (const c of candidates || []) {
    for (const f of c.surfaceForms || [c.entityText]) {
      if (f && String(f).trim()) forms.push(String(f));
    }
  }
  forms.sort((a, b) => b.length - a.length);
  if (!forms.length) return text;

  const escaped = forms.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${escaped.join('|')})`, 'g');
  const parts = String(text).split(re);
  return parts.map((part, i) => {
    if (forms.includes(part)) {
      return (
        <mark key={i} style={{ background: '#fef3c7', color: 'inherit', borderRadius: 2, padding: '0 1px' }}>
          {part}
        </mark>
      );
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}
