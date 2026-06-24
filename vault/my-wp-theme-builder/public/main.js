const SESSION_KEY = 'wpThemeBuilderSessionId';

const els = {
  wizard: document.getElementById('intake-wizard'),
  designPanel: document.getElementById('design-panel'),
  wpWizard: document.getElementById('wp-wizard'),
  convertPanel: document.getElementById('convert-panel'),
  sessionId: document.getElementById('session-id'),
  preview: document.getElementById('preview'),
  openTab: document.getElementById('btn-open-tab'),
  iteratePanel: document.getElementById('iterate-panel'),
  iterateTargetRow: document.getElementById('iterate-target-row'),
  iterateBtn: document.getElementById('btn-iterate'),
  undoBtn: document.getElementById('btn-undo'),
  cancelPick: document.getElementById('btn-cancel-pick'),
  pickBanner: document.getElementById('iterate-pick-banner'),
  iterateInput: document.getElementById('iterate-input'),
  iterateError: document.getElementById('iterate-error'),
  iterateSend: document.getElementById('btn-iterate-send'),
  pickElement: document.getElementById('btn-pick-element'),
  iterateTarget: document.getElementById('iterate-target'),
  iterateTargetRef: document.getElementById('iterate-target-ref'),
  iterateTargetLabel: document.getElementById('iterate-target-label'),
  copyTargetRef: document.getElementById('btn-copy-target-ref'),
  iterateCopyToast: document.getElementById('iterate-copy-toast'),
  clearTarget: document.getElementById('btn-clear-target'),
  allProjects: document.getElementById('btn-all-projects'),
  clearIterationLog: document.getElementById('btn-clear-iteration-log'),
  approve: document.getElementById('btn-approve'),
  designHome: document.getElementById('btn-design-home'),
  phaseBadge: document.getElementById('design-phase-badge'),
  convertStatus: document.getElementById('convert-status'),
  fileTree: document.getElementById('file-tree'),
  log: document.getElementById('log'),
  download: document.getElementById('btn-download'),
  formError: document.getElementById('form-error'),
  startOver: document.getElementById('btn-start-over'),
  downloadsPanel: document.getElementById('downloads-panel'),
  sitePagesPanel: document.getElementById('site-pages-panel'),
  sitePagesList: document.getElementById('site-pages-list'),
  dlSource: document.getElementById('dl-source'),
  dlStatic: document.getElementById('dl-static'),
  dlWordpress: document.getElementById('dl-wordpress'),
  dlSourceComplete: document.getElementById('dl-source-complete'),
  dlStaticComplete: document.getElementById('dl-static-complete'),
};

let currentHtml = '';
let currentPhase = 'wireframe';
let sessionMetaStage = null;
let sessionHomepageStatus = null;
let previewShown = false;
let selectedIterateTarget = null;
let lastIterateRef = '';
let copyToastTimer = null;

function iterateRefFromTarget(target) {
  if (!target?.id) return '';
  return `#${target.id}`;
}

function isTbPickId(id) {
  return /^tb-pick-/i.test(String(id || '').trim());
}

function normalizeTargetId(id) {
  return String(id || '').trim().toLowerCase();
}

function isIterateTargetSaved(targetId) {
  if (!targetId) return true;
  if (!isTbPickId(targetId)) return true;
  const normalized = normalizeTargetId(targetId);
  if (selectedIterateTarget?.id && normalizeTargetId(selectedIterateTarget.id) === normalized) {
    return true;
  }
  return findElementBoundsInHtml(currentHtml, targetId);
}

function syncSelectedTargetFromRef() {
  const refId = regionIdFromRef(lastIterateRef || els.iterateTargetRef?.value);
  if (!refId) return;
  if (selectedIterateTarget?.id && normalizeTargetId(selectedIterateTarget.id) === normalizeTargetId(refId)) {
    return;
  }
  if (!isTbPickId(refId) || findElementBoundsInHtml(currentHtml, refId)) {
    selectedIterateTarget = {
      id: refId,
      label: refId,
      focusPath: `#${refId}`,
    };
    if (els.iterateTargetLabel) {
      els.iterateTargetLabel.textContent = `#${refId}`;
    }
    syncIterateTargetPanel();
  }
}

async function stampPickTarget(target) {
  if (!target?.id) return target;

  const isPick = isTbPickId(target.id);
  if (isPick && findElementBoundsInHtml(currentHtml, target.id)) {
    return { ...target, needsStamp: false };
  }

  const needsStamp = Boolean(target?.needsStamp && target?.anchorId && (target?.locator?.length || target?.childPath?.length));

  if (!needsStamp && !isPick) {
    return target;
  }

  if (isPick && !target?.anchorId) {
    throw new Error('Could not save picked element — pick again with Pick element.');
  }

  const sessionId = getSessionId();
  if (!sessionId) return target;

  const data = await api(`/api/generate/session/${sessionId}/stamp-target`, {
    method: 'POST',
    body: JSON.stringify({
      anchorId: target.anchorId,
      childPath: target.childPath,
      locator: target.locator,
      newId: target.id,
    }),
  });

  if (!data?.html || !findElementBoundsInHtml(data.html, target.id)) {
    throw new Error('Picked element was not saved to the design. Try picking again.');
  }

  currentHtml = data.html;
  loadPreview(sessionId, currentHtml, currentPhase);
  return { ...target, needsStamp: false };
}

function findElementBoundsInHtml(html, id) {
  if (!html || !id) return false;
  const escaped = String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\sid=["']${escaped}["']`, 'i').test(html);
}

async function copyToClipboard(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    return true;
  } catch {
    return false;
  }
}

function showIterateCopyToast(message = 'Copied to clipboard') {
  if (!els.iterateCopyToast) return;
  els.iterateCopyToast.textContent = message;
  els.iterateCopyToast.hidden = false;
  clearTimeout(copyToastTimer);
  copyToastTimer = setTimeout(() => {
    if (els.iterateCopyToast) els.iterateCopyToast.hidden = true;
  }, 2200);
}

function syncIterateTargetPanel() {
  if (!els.iterateTarget) return;
  const hasRef = Boolean(lastIterateRef);
  const hasPick = Boolean(selectedIterateTarget?.id);
  els.iterateTarget.hidden = !hasRef && !hasPick;
  const pickedRow = els.iterateTarget.querySelector('.iterate-target__picked');
  if (pickedRow) pickedRow.hidden = !hasPick;
}

function setIterateRef(ref) {
  lastIterateRef = ref || '';
  if (els.iterateTargetRef) {
    els.iterateTargetRef.value = lastIterateRef;
  }
  syncIterateTargetPanel();
}

function setIterateTarget(target) {
  selectedIterateTarget = target?.id ? target : null;
  if (selectedIterateTarget) {
    const ref = iterateRefFromTarget(selectedIterateTarget);
    setIterateRef(ref);
    if (els.iterateTargetLabel) {
      els.iterateTargetLabel.textContent = `#${selectedIterateTarget.id} (${selectedIterateTarget.label || selectedIterateTarget.tag || selectedIterateTarget.id})`;
    }
  } else {
    setIterateRef('');
    syncIterateTargetPanel();
    try {
      els.preview?.contentWindow?.postMessage({ type: 'tb-picker-clear' }, '*');
    } catch {
      // ignore
    }
  }
}

async function copyIterateRefFromUi(ref) {
  const text = ref || els.iterateTargetRef?.value || lastIterateRef;
  if (!text) return;
  const ok = await copyToClipboard(text);
  showIterateCopyToast(ok ? `Copied: ${text}` : 'Could not copy — select the reference field');
  if (!ok && els.iterateTargetRef) {
    els.iterateTargetRef.focus();
    els.iterateTargetRef.select();
  }
}
let pickElementMode = false;
let showRegionLabels = false;
let approvedHtml = '';
let lastIntakeData = null;
let lastWpData = null;
let canUndo = false;

window.themeBuilderApi = api;

function log(message, data) {
  els.log.hidden = false;
  const line = data ? `${message}\n${JSON.stringify(data, null, 2)}` : message;
  els.log.textContent = `${els.log.textContent}\n${line}`.trim();
}

function getSessionId() {
  return localStorage.getItem(SESSION_KEY);
}

function setSessionId(id) {
  localStorage.setItem(SESSION_KEY, id);
  if (els.sessionId) els.sessionId.textContent = `Session: ${id}`;
  applyDesignPhaseUI();
}

function startOver() {
  if (window.generationUI?.isActive?.() && !window.generationUI.confirmLeave()) return;
  if (window.ui?.isGenerationActive?.() && !window.ui?.confirmLeaveGeneration?.()) return;
  localStorage.removeItem(SESSION_KEY);
  window.ui?.clearAppState();
  window.projects?.load?.().catch(() => {});
  showProjectsPanel();
}

function downloadHref(sessionId, variant, { approved = false } = {}) {
  const params = new URLSearchParams({ variant });
  if (approved) params.set('approved', '1');
  const path = `/download/${sessionId}?${params}`;
  return window.tbPath ? window.tbPath(path) : path;
}

function pageStatusLabel(status) {
  const map = {
    pending: 'Pending',
    wireframe: 'Wireframe',
    designed: 'Designed',
    approved: 'Approved',
  };
  return map[status] || status || 'Pending';
}

function updateDownloadLinks(sessionId, { locked = false, hasTheme = false } = {}) {
  if (!sessionId) return;

  const sourceUrl = downloadHref(sessionId, 'source', { approved: locked });
  const staticUrl = downloadHref(sessionId, 'static', { approved: true });
  const wpUrl = downloadHref(sessionId, 'wordpress');

  if (els.dlSource) {
    els.dlSource.href = sourceUrl;
    els.dlSource.hidden = !locked;
  }
  if (els.dlStatic) {
    els.dlStatic.href = staticUrl;
    els.dlStatic.hidden = !locked;
  }
  if (els.dlWordpress) {
    els.dlWordpress.href = wpUrl;
    els.dlWordpress.hidden = !hasTheme;
    els.dlWordpress.title = hasTheme ? '' : 'Available after WordPress theme generation';
  }
  if (els.dlSourceComplete) {
    els.dlSourceComplete.href = sourceUrl;
    els.dlSourceComplete.hidden = !locked;
  }
  if (els.dlStaticComplete) {
    els.dlStaticComplete.href = staticUrl;
    els.dlStaticComplete.hidden = !locked;
  }
  if (els.downloadsPanel) {
    els.downloadsPanel.hidden = !locked;
  }
}

function renderSitePages(pages, stage) {
  if (!els.sitePagesPanel || !els.sitePagesList || !pages) {
    if (els.sitePagesPanel) els.sitePagesPanel.hidden = true;
    return;
  }

  const homepageEstablished = ['designed', 'approved'].includes(pages.homepage);
  const hasItems = (pages.items || []).length > 0;
  const showPanel = hasItems && (homepageEstablished || stage === 'design' || stage === 'design-approved');
  els.sitePagesPanel.hidden = !showPanel;
  if (!showPanel) return;

  const homepageApproved = pages.homepage === 'approved';
  const rows = [
    `<li class="site-pages-list__item site-pages-list__item--homepage">
      <span class="site-pages-list__label">Homepage</span>
      <span class="site-pages-list__status">${pageStatusLabel(pages.homepage)}</span>
    </li>`,
  ];

  for (const item of pages.items || []) {
    const disabled = !homepageApproved;
    rows.push(`<li class="site-pages-list__item${disabled ? ' is-disabled' : ''}">
      <span class="site-pages-list__label">${escapeHtml(item.label || item.slug)}</span>
      <span class="site-pages-list__status">${pageStatusLabel(item.status)}</span>
      ${disabled
        ? '<span class="site-pages-list__hint">Available after homepage is approved</span>'
        : '<button type="button" class="btn-secondary btn-small" disabled title="Multi-page design — coming soon">Design page</button>'}
    </li>`);
  }

  els.sitePagesList.innerHTML = rows.join('');
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function applyLockedState(locked) {
  if (locked) {
    els.iterateBtn?.setAttribute('hidden', '');
    toggleIteratePanel(false);
    els.designPanel?.classList.add('is-locked');
  } else {
    els.iterateBtn?.removeAttribute('hidden');
    els.designPanel?.classList.remove('is-locked');
  }
}

async function refreshProjectUI(session) {
  const sessionId = session?.sessionId || getSessionId();
  const meta = session?.meta || {};
  sessionMetaStage = meta.stage ?? sessionMetaStage;
  sessionHomepageStatus = meta.pages?.homepage ?? sessionHomepageStatus;
  const locked = Boolean(meta.locked || meta.stage === 'design-approved' || meta.stage === 'conversion-complete');
  const hasTheme = Boolean(session?.resume?.hasThemeZip || meta.stage === 'conversion-complete');

  applyDesignPhaseUI();
  applyLockedState(locked);
  renderSitePages(meta.pages, meta.stage);
  updateDownloadLinks(sessionId, { locked, hasTheme });

  if (els.sessionId) {
    const name = meta.displayName || 'Project';
    const shortId = sessionId ? `${sessionId.slice(0, 8)}…` : '';
    els.sessionId.textContent = shortId ? `${name} · ${shortId}` : name;
  }
}

async function ensureSession() {
  let sessionId = getSessionId();
  if (!sessionId) {
    const data = await api('/api/intake/projects', {
      method: 'POST',
      body: JSON.stringify({ displayName: 'Untitled project' }),
    });
    sessionId = data.sessionId;
    setSessionId(sessionId);
  }
  return sessionId;
}

async function api(path, options = {}) {
  const url = typeof window.tbPath === 'function' ? window.tbPath(path) : path;
  const { signal, ...fetchOptions } = options;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(fetchOptions.headers || {}) },
    ...fetchOptions,
    signal: signal || window.generationUI?.getAbortSignal?.() || undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || res.statusText);
    err.canRetryLocal = Boolean(data.canRetryLocal);
    err.status = res.status;
    err.cancelled = res.status === 499 || data.cancelled;
    throw err;
  }
  return data;
}

function previewUrl(sessionId, cacheBust = false, version = null) {
  const base = window.tbPath ? window.tbPath(`/preview/${sessionId}`) : `/preview/${sessionId}`;
  const params = new URLSearchParams();
  if (cacheBust) params.set('t', String(Date.now()));
  if (version) params.set('v', String(version));
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

function isDesignPhaseActive() {
  return currentPhase === 'design'
    || sessionMetaStage === 'design'
    || ['designed', 'approved'].includes(sessionHomepageStatus);
}

function applyDesignPhaseUI() {
  const isDesign = isDesignPhaseActive();
  if (isDesign) currentPhase = 'design';

  if (els.phaseBadge) {
    els.phaseBadge.hidden = false;
    els.phaseBadge.textContent = isDesign ? 'Designed homepage' : 'Wireframe';
    els.phaseBadge.className = `design-phase-badge design-phase-badge--${isDesign ? 'design' : 'wireframe'}`;
  }

  if (els.designHome) {
    els.designHome.hidden = isDesign;
    if (!isDesign) {
      els.designHome.textContent = 'Approve wireframe & build homepage';
      els.designHome.disabled = false;
    }
  }

  if (els.approve) {
    els.approve.hidden = !isDesign;
  }

  if (els.allProjects) {
    els.allProjects.textContent = 'Back To Projects';
  }

  if (els.startOver) {
    els.startOver.hidden = !getSessionId();
  }
}

function setDesignPhase(phase) {
  if (phase) currentPhase = phase === 'design' ? 'design' : 'wireframe';
  applyDesignPhaseUI();
}

function loadPreview(sessionId, html, phase, cssVersion = null) {
  if (html) currentHtml = html;
  if (phase) setDesignPhase(phase);

  els.preview.src = previewUrl(sessionId, true, cssVersion);
  els.preview.onload = () => {
    if (showRegionLabels) setShowRegionLabels(true);
    if (pickElementMode) setPickElementMode(true);
  };
  if (els.openTab) {
    els.openTab.dataset.previewUrl = previewUrl(sessionId);
    els.openTab.hidden = false;
  }

  if (!previewShown) {
    previewShown = true;
    setDesignPhase(currentPhase);
  }
}

function hideAllPanels() {
  els.wizard.hidden = true;
  els.designPanel.hidden = true;
  els.wpWizard.hidden = true;
  els.convertPanel.hidden = true;
  window.projects?.hide?.();
  document.getElementById('resume-banner')?.setAttribute('hidden', '');
}

function showProjectsPanel() {
  hideAllPanels();
  window.projects?.show?.();
  if (els.startOver) els.startOver.hidden = true;
  window.projects?.load?.().catch((err) => log('Could not load projects', { error: err.message }));
}

function showIntakeWizard() {
  hideAllPanels();
  els.wizard.hidden = false;
  window.ui?.setAppStage('brief');
  if (els.startOver) els.startOver.hidden = false;
}

function showDesignStage(sessionId, phase = currentPhase, sessionMeta = null) {
  hideAllPanels();
  els.designPanel.hidden = false;
  window.ui?.setAppStage('preview');
  if (sessionMeta) {
    sessionMetaStage = sessionMeta.stage ?? sessionMetaStage;
    sessionHomepageStatus = sessionMeta.pages?.homepage ?? sessionHomepageStatus;
  }
  if (phase) currentPhase = phase === 'design' ? 'design' : 'wireframe';
  loadPreview(sessionId, currentHtml, phase);
  window.inspector?.loadSessionTrace?.(sessionId);
  if (sessionMeta) refreshProjectUI({ sessionId, meta: sessionMeta });
  refreshUndoState(sessionId);
}

function showStage2(sessionId, intakeData, suggestions, sessionMeta = null) {
  hideAllPanels();
  els.wpWizard.hidden = false;
  window.ui?.setAppStage('wp-brief');
  if (els.startOver) els.startOver.hidden = false;
  if (sessionMeta) refreshProjectUI({ sessionId, meta: sessionMeta });
  window.startWpDataWizard({
    sessionId,
    intakeData,
    approvedHtml: approvedHtml || currentHtml,
    suggestions,
  });
}

function toggleIteratePanel(show) {
  els.iteratePanel.hidden = !show;
  els.iteratePanel.classList.toggle('is-open', show);
  if (els.iterateTargetRow) els.iterateTargetRow.hidden = !show;
  if (show) {
    els.iterateInput.focus();
  } else {
    els.iterateError.hidden = true;
    setPickElementMode(false);
  }
}

function setShowRegionLabels(enabled) {
  showRegionLabels = enabled;
  try {
    els.preview?.contentWindow?.postMessage({ type: 'tb-labels', enabled }, '*');
  } catch {
    // iframe not ready
  }
}

function setPickElementMode(enabled) {
  pickElementMode = enabled;
  els.pickElement?.classList.toggle('is-active', enabled);
  els.pickElement?.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  if (els.cancelPick) els.cancelPick.hidden = !enabled;
  if (els.pickBanner) els.pickBanner.hidden = !enabled;
  if (els.pickElement) {
    els.pickElement.textContent = enabled ? 'Picking…' : 'Pick element';
  }
  try {
    els.preview?.contentWindow?.postMessage({ type: 'tb-picker', enabled }, '*');
  } catch {
    // iframe not ready
  }
}

function cancelPickElementMode() {
  if (!pickElementMode) return;
  setPickElementMode(false);
  try {
    els.preview?.contentWindow?.postMessage({ type: 'tb-picker-clear' }, '*');
  } catch {
    // ignore
  }
}

async function refreshUndoState(sessionId) {
  if (!sessionId || !els.undoBtn) return;
  try {
    const session = await api(`/api/intake/session/${sessionId}`);
    if (session.meta?.locked || session.resume?.locked) {
      canUndo = false;
      els.undoBtn.hidden = true;
      return;
    }
    canUndo = Boolean(session.resume?.canUndo);
    els.undoBtn.hidden = !canUndo;
  } catch {
    canUndo = false;
    els.undoBtn.hidden = true;
  }
}

async function runUndo() {
  const sessionId = getSessionId();
  if (!sessionId || !canUndo) return;

  els.undoBtn.disabled = true;
  try {
    const data = await api(`/api/generate/session/${sessionId}/undo`, { method: 'POST' });
    currentHtml = data.html || currentHtml;
    if (data.phase) currentPhase = data.phase;
    loadPreview(sessionId, currentHtml, currentPhase);
    await refreshUndoState(sessionId);
    window.inspector?.loadSession?.(sessionId);
    log('Undid last change', { sessionId, version: data.version });
  } catch (err) {
    window.ui?.showStepError?.({
      step: 'Undo',
      message: err.message,
    });
  } finally {
    els.undoBtn.disabled = false;
  }
}

function regionIdFromRef(ref) {
  const trimmed = String(ref || '').trim();
  if (!trimmed) return '';
  const hash = trimmed.match(/#([a-zA-Z][\w-]+)/);
  return hash ? hash[1] : trimmed.replace(/^#/, '');
}

function resolveIterateTargetId(changeRequest) {
  if (selectedIterateTarget?.id) return selectedIterateTarget.id;

  const refId = regionIdFromRef(lastIterateRef || els.iterateTargetRef?.value);
  if (refId) return refId;

  const trimmed = changeRequest.trim();
  const patterns = [
    /^#?([a-zA-Z][\w-]+)\s*\.\s*/,
    /^#?([a-zA-Z][\w-]+)\s+[-—:]\s+/,
    /^#?([a-zA-Z][\w-]+)\s*[-—:]\s+/,
    /^#?([a-zA-Z][\w-]+)\s+-\s+/,
    /^#?([a-zA-Z][\w-]+)\s*$/,
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) return match[1];
  }
  const hash = trimmed.match(/#([a-zA-Z][\w-]+)/);
  if (hash) return hash[1];
  return '';
}

function renderFileTree(node) {
  if (!els.fileTree || !node) return;

  function renderNode(item) {
    if (item.type === 'file') {
      return `<li class="file-tree__file">${item.name}</li>`;
    }
    const children = (item.children || []).map(renderNode).join('');
    return `<li class="file-tree__folder"><span class="file-tree__folder-name">${item.name}/</span><ul>${children}</ul></li>`;
  }

  els.fileTree.innerHTML = renderNode(node);
}

function showConversionComplete(data, themeName, sessionMeta = null) {
  hideAllPanels();
  els.convertPanel.hidden = false;
  window.ui?.setAppStage('complete');
  if (els.startOver) els.startOver.hidden = false;
  els.convertStatus.textContent = `Theme "${themeName}" generated — ${data.files?.length || 0} files packaged.`;
  renderFileTree(data.fileTree);
  const sessionId = data.sessionId || getSessionId();
  els.download.href = data.downloadUrl || downloadHref(sessionId, 'wordpress');
  els.download.download = data.downloadFilename || `${themeName}.zip`;
  els.download.textContent = 'WordPress theme ZIP';
  els.download.hidden = false;

  const locked = true;
  updateDownloadLinks(sessionId, { locked, hasTheme: true });
  if (sessionMeta) refreshProjectUI({ sessionId, meta: sessionMeta, resume: { hasThemeZip: true } });

  window.ui?.saveAppState({
    conversionData: {
      themeName,
      fileTree: data.fileTree,
      downloadUrl: data.downloadUrl,
      downloadFilename: data.downloadFilename,
      filesCount: data.files?.length || 0,
    },
  });
}

const STAGE1_WIREFRAME_STEPS = [
  { id: 'save-brief', label: 'Saving your brief', status: 'pending' },
  { id: 'research', label: 'Reviewing inspiration sites', status: 'pending' },
  { id: 'analyse', label: 'Analysing your brief', status: 'pending' },
  { id: 'generate', label: 'Building homepage wireframe', status: 'pending' },
  { id: 'parse', label: 'Validating wireframe', status: 'pending' },
  { id: 'save', label: 'Saving wireframe preview', status: 'pending' },
];

const STAGE1_ITERATE_STEPS = [
  { id: 'read', label: 'Reading your current design', status: 'pending' },
  { id: 'generate', label: 'Generating updated content', status: 'pending' },
  { id: 'validate', label: 'Validating the new layout', status: 'pending' },
  { id: 'save', label: 'Saving preview', status: 'pending' },
];

const STAGE1_HOME_DESIGN_STEPS = [
  { id: 'analyse', label: 'Reading wireframe & brief', status: 'pending' },
  { id: 'generate', label: 'Designing homepage', status: 'pending' },
  { id: 'responsive', label: 'Building responsive.css', status: 'pending' },
  { id: 'parse', label: 'Validating HTML & CSS', status: 'pending' },
  { id: 'save', label: 'Saving design preview', status: 'pending' },
];

const STAGE2_JOB_STEPS = [
  { id: 'prepare', label: 'Preparing theme data', status: 'pending' },
  { id: 'analyse', label: 'Analysing HTML structure', status: 'pending' },
  { id: 'style', label: 'Generating style.css', status: 'pending' },
  { id: 'functions', label: 'Generating functions.php', status: 'pending' },
  { id: 'shell', label: 'Generating header & footer', status: 'pending' },
  { id: 'templates', label: 'Generating templates', status: 'pending' },
  { id: 'acf', label: 'Generating ACF JSON', status: 'pending' },
  { id: 'blocks', label: 'Generating block files', status: 'pending' },
  { id: 'readme', label: 'Generating README', status: 'pending' },
  { id: 'package', label: 'Packaging theme ZIP', status: 'pending' },
];

async function loadSessionMeta(sessionId) {
  try {
    const session = await api(`/api/intake/session/${sessionId}`);
    await refreshProjectUI(session);
    return session;
  } catch {
    return null;
  }
}

async function offerLocalModelRetry(err, retryFn) {
  if (!err?.canRetryLocal) return false;
  const useLocal = window.confirm(
    `${err.message}\n\nTry again with your local model (Ollama) instead of Claude?`
  );
  if (!useLocal) return false;
  await retryFn(true);
  return true;
}

async function runStage1Generation(intakeData, jobId, useLocalModel = false) {
  window.ui?.clearStepError();

  try {
    const sessionId = await ensureSession();
    const data = await api('/generate/html', {
      method: 'POST',
      body: JSON.stringify({ sessionId, intakeData, jobId, useLocalModel }),
    });

    setSessionId(data.sessionId);
    currentHtml = data.html || '';
    currentPhase = data.phase || 'wireframe';
    sessionMetaStage = 'wireframe';
    sessionHomepageStatus = 'wireframe';
    lastIntakeData = intakeData;
    window.ui?.saveAppState({ intakeData });
    showDesignStage(data.sessionId, currentPhase);
    await loadSessionMeta(data.sessionId);
    log('Wireframe generated from intake', { sessionId: data.sessionId, version: data.version, model: data.model });
    window.inspector?.loadSession?.(data.sessionId);
  } catch (err) {
    log('Wireframe generation failed', { error: err.message });
    const retried = await offerLocalModelRetry(err, (local) => runStage1Generation(intakeData, jobId, local));
    if (retried) return;
    window.ui?.showStepError({
      step: 'Wireframe generation',
      message: err.message,
      retryFn: () => runStage1Generation(intakeData, jobId, useLocalModel),
    });
    throw err;
  } finally {
    window.generationUI?.close();
    window.ui?.endGenerationModal?.();
    window.ui?.hideLoading?.();
  }
}

async function runDesignHome(useLocalModel = false) {
  const sessionId = getSessionId();
  if (!sessionId) return;

  if (!window.generationUI) {
    alert('Please hard-refresh the page (Cmd+Shift+R) — generation UI did not load.');
    return;
  }

  window.ui?.clearStepError();
  const jobId = window.generationUI.createJobId();

  window.generationUI.open({
    title: 'Designing homepage',
    jobId,
    type: 'stage1-home',
    steps: STAGE1_HOME_DESIGN_STEPS,
  });

  if (els.designHome) {
    els.designHome.disabled = true;
    els.designHome.textContent = 'Building homepage…';
  }

  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  try {
    const data = await api('/generate/design-home', {
      method: 'POST',
      body: JSON.stringify({ sessionId, intakeData: lastIntakeData, jobId, useLocalModel }),
    });

    currentHtml = data.html || currentHtml;
    currentPhase = data.phase || 'design';
    sessionMetaStage = 'design';
    sessionHomepageStatus = 'designed';
    showDesignStage(data.sessionId, currentPhase);
    await loadSessionMeta(data.sessionId);
    log('Homepage design generated', { sessionId: data.sessionId, version: data.version, model: data.model });
    window.inspector?.loadSession?.(data.sessionId);
  } catch (err) {
    log('Homepage design failed', { error: err.message });
    const retried = await offerLocalModelRetry(err, runDesignHome);
    if (retried) return;
    window.ui?.showStepError({
      step: 'Homepage design',
      message: err.message,
      retryFn: () => runDesignHome(useLocalModel),
    });
  } finally {
    window.generationUI?.close();
    window.ui?.endGenerationModal?.();
    window.ui?.hideLoading?.();
    if (els.designHome) {
      els.designHome.disabled = false;
      els.designHome.textContent = 'Approve wireframe & build homepage';
    }
  }
}

window.submitIntake = async function submitIntake() {
  const submitBtn = document.getElementById('btn-submit');
  const intakeData = window.getIntakeData ? window.getIntakeData() : {};

  if (!window.generationUI) {
    alert('Please hard-refresh the page (Cmd+Shift+R) — generation UI did not load.');
    return;
  }

  const jobId = window.generationUI.createJobId();

  window.generationUI.open({
    title: 'Generating wireframe',
    jobId,
    type: 'stage1',
    steps: STAGE1_WIREFRAME_STEPS,
  });

  submitBtn.disabled = true;
  submitBtn.textContent = 'Generating…';
  els.formError.hidden = true;
  els.log.hidden = false;
  els.log.textContent = 'Generation started — please wait…';

  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  try {
    await runStage1Generation(intakeData, jobId);
  } catch {
    els.formError.textContent = 'Wireframe generation failed. Use Retry above or try again.';
    els.formError.hidden = false;
  } finally {
    window.generationUI?.close();
    window.ui?.endGenerationModal?.();
    window.ui?.hideLoading?.();
    submitBtn.disabled = false;
    submitBtn.textContent = 'Generate wireframe';
  }
};

async function runStage2Generation(wpData, jobId) {
  const ctx = window.getWpContext();
  window.ui?.clearStepError('wp-form-error');
  window.ui?.clearStepError();

  try {
    const data = await api('/convert/theme', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: ctx.sessionId,
        intakeData: ctx.intakeData,
        wpData,
        approvedHtml: ctx.approvedHtml || approvedHtml || currentHtml,
        jobId,
      }),
    });

    lastWpData = wpData;
    showConversionComplete(data, wpData.setup.themeName);
    log('WordPress theme generated', {
      sessionId: data.sessionId,
      themeSlug: data.themeSlug,
      files: data.files,
      download: data.downloadFilename,
    });
  } catch (err) {
    window.ui?.showStepError({
      step: 'Theme generation',
      message: err.message,
      retryFn: () => runStage2Generation(wpData, jobId),
      targetId: 'wp-form-error',
    });
    throw err;
  } finally {
    window.ui?.endGenerationModal?.();
    window.ui?.hideLoading?.();
  }
}

window.submitWpData = async function submitWpData(wpData) {
  const submitBtn = document.getElementById('wp-btn-submit');
  const jobId = window.generationUI?.createJobId() || `job-${Date.now()}`;

  window.generationUI.open({
    title: 'Generating your WordPress theme',
    jobId,
    type: 'stage2',
    steps: STAGE2_JOB_STEPS,
  });

  submitBtn.disabled = true;
  submitBtn.textContent = 'Generating theme…';
  els.log.hidden = false;

  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  try {
    await runStage2Generation(wpData, jobId);
  } catch {
    const errorEl = document.getElementById('wp-form-error');
    if (!errorEl.innerHTML.includes('btn-retry')) {
      errorEl.textContent = 'Theme generation failed.';
      errorEl.hidden = false;
    }
  } finally {
    window.generationUI.close();
    window.ui?.endGenerationModal?.();
    window.ui?.hideLoading?.();
    submitBtn.disabled = false;
    submitBtn.textContent = 'Generate theme';
  }
};

async function runApprove() {
  const sessionId = getSessionId();
  if (!sessionId) return;

  window.ui?.clearStepError();
  els.approve.disabled = true;
  els.approve.textContent = 'Approving…';

  try {
    await api(`/api/generate/session/${sessionId}/approve`, { method: 'POST' });

    const session = await api(`/api/intake/session/${sessionId}`);
    approvedHtml = currentHtml;

    window.ui?.showLoading(['Preparing WordPress setup…', 'Analysing your design…']);

    const suggestions = await api('/convert/suggest-fields', {
      method: 'POST',
      body: JSON.stringify({ sessionId, approvedHtml }),
    });

    window.ui?.saveAppState({
      approvedHtml,
      fieldSuggestions: suggestions.suggestions,
    });

    els.approve.textContent = 'Approved';
    applyLockedState(true);
    updateDownloadLinks(sessionId, { locked: true, hasTheme: false });
    showStage2(sessionId, session.intakeData, suggestions.suggestions, session.meta);
    log('Design approved — Stage 2 started', { sessionId });
  } catch (err) {
    window.ui?.showStepError({
      step: 'Approve design',
      message: err.message,
      retryFn: runApprove,
    });
    els.approve.textContent = 'Approve design';
  } finally {
    window.ui?.hideLoading();
    els.approve.disabled = false;
  }
}

async function runIterate() {
  const sessionId = getSessionId();
  let changeRequest = els.iterateInput.value.trim();

  if (!sessionId) return log('No session');
  if (!changeRequest) {
    els.iterateError.textContent = 'Describe the change you want.';
    els.iterateError.hidden = false;
    return;
  }

  syncSelectedTargetFromRef();

  const targetIdFromRequest = resolveIterateTargetId(changeRequest);
  if (!isIterateTargetSaved(targetIdFromRequest)) {
    els.iterateError.textContent = 'That element is not saved yet — use Pick element and wait for Selected, or describe a general change without a #tb-pick id.';
    els.iterateError.hidden = false;
    return;
  }

  if (selectedIterateTarget?.focus) {
    changeRequest = `${changeRequest}\n\nFocus on this element inside #${selectedIterateTarget.id}: ${selectedIterateTarget.focus}`;
  } else if (selectedIterateTarget?.focusPath && selectedIterateTarget.focusPath !== `#${selectedIterateTarget.id}`) {
    changeRequest = `${changeRequest}\n\nElement path: ${selectedIterateTarget.focusPath}`;
  }

  if (!window.generationUI) {
    alert('Please hard-refresh the page (Cmd+Shift+R) — generation UI did not load.');
    return;
  }

  const jobId = window.generationUI.createJobId();

  setShowRegionLabels(false);

  window.inspector?.prependPendingIteration?.({ request: changeRequest, phase: currentPhase });

  window.generationUI.open({
    title: 'Generating your iteration',
    jobId,
    type: 'stage1-iterate',
    steps: STAGE1_ITERATE_STEPS,
    emphasizeGenerating: true,
    cancellable: true,
    onCancel: () => {
      window.inspector?.loadSession?.(sessionId);
    },
  });

  els.iterateSend.disabled = true;
  els.iterateSend.textContent = 'Updating…';
  els.iterateError.hidden = true;
  window.ui?.clearStepError();

  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  try {
    const targetId = resolveIterateTargetId(changeRequest);
    const data = await api('/generate/iterate', {
      method: 'POST',
      body: JSON.stringify({
        sessionId,
        currentHtml,
        changeRequest,
        phase: currentPhase,
        targetId: targetId || undefined,
        jobId,
      }),
    });

    currentHtml = data.html || currentHtml;
    if (data.phase) currentPhase = data.phase;
    loadPreview(sessionId, currentHtml, currentPhase, data.version);
    els.iterateInput.value = '';
    toggleIteratePanel(false);
    await refreshUndoState(sessionId);
    log('Design iterated', { sessionId: data.sessionId, version: data.version });
    window.inspector?.loadSession?.(sessionId);
  } catch (err) {
    if (err.name === 'AbortError' || err.cancelled || err.status === 499) {
      log('Iteration cancelled');
      window.inspector?.loadSession?.(sessionId);
      return;
    }
    window.inspector?.loadSession?.(sessionId);
    window.ui?.showStepError({
      step: 'Design iteration',
      message: err.message,
      retryFn: runIterate,
    });
  } finally {
    window.generationUI?.close();
    window.ui?.endGenerationModal?.();
    window.ui?.hideLoading?.();
    els.iterateSend.disabled = false;
    els.iterateSend.textContent = 'Send';
  }
}

async function restoreSession(sessionId) {
  try {
    const session = await api(`/api/intake/session/${sessionId}`);
    setSessionId(sessionId);
    await refreshProjectUI(session);
    window.ui?.setAppStage(window.ui.appStageFromMeta(session.meta?.stage || 'intake'));

    const saved = window.ui?.getAppState() || {};

    if (session.resume?.hasThemeZip || session.meta?.stage === 'conversion-complete') {
      const conversion = saved.conversionData || {};
      showConversionComplete(
        {
          sessionId,
          files: Array(conversion.filesCount || 0),
          fileTree: conversion.fileTree,
          downloadUrl: conversion.downloadUrl || downloadHref(sessionId, 'wordpress'),
          downloadFilename: conversion.downloadFilename,
        },
        conversion.themeName || session.wpData?.setup?.themeName || 'Theme',
        session.meta
      );
      return;
    }

    if (session.meta?.stage === 'design-approved' || session.resume?.hasApproved) {
      approvedHtml = saved.approvedHtml || '';
      showStage2(sessionId, session.intakeData, saved.fieldSuggestions, session.meta);
      return;
    }

    if (session.resume?.hasDesign) {
      sessionMetaStage = session.meta?.stage ?? null;
      sessionHomepageStatus = session.meta?.pages?.homepage ?? null;
      const phase = isDesignPhaseActive() ? 'design' : 'wireframe';
      currentPhase = phase;
      showDesignStage(sessionId, phase, session.meta);
      window.inspector?.loadSession?.(sessionId);
      return;
    }

    if (session.intakeData || session.meta?.stage === 'intake-complete') {
      showIntakeWizard();
      return;
    }

    showIntakeWizard();
  } catch (err) {
    log('Could not restore session', { error: err.message });
    showIntakeWizard();
  }
}

window.openWebsite = async function openWebsite(sessionId) {
  if (window.generationUI?.isActive?.() && !window.generationUI.confirmLeave()) return;
  if (window.ui?.isGenerationActive?.() && !window.ui?.confirmLeaveGeneration?.()) return;
  localStorage.setItem(SESSION_KEY, sessionId);
  window.projects?.hide?.();
  await restoreSession(sessionId);
};

window.openProject = window.openWebsite;

document.getElementById('btn-iterate')?.addEventListener('click', () => {
  const opening = els.iteratePanel.hidden;
  if (opening) setShowRegionLabels(false);
  toggleIteratePanel(opening);
});

els.cancelPick?.addEventListener('click', cancelPickElementMode);
els.undoBtn?.addEventListener('click', runUndo);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && pickElementMode) {
    event.preventDefault();
    cancelPickElementMode();
  }
});

els.pickElement?.addEventListener('click', () => {
  setPickElementMode(!pickElementMode);
});

els.clearTarget?.addEventListener('click', () => {
  setIterateTarget(null);
});

els.copyTargetRef?.addEventListener('click', () => {
  copyIterateRefFromUi();
});

els.iterateTargetRef?.addEventListener('focus', (event) => {
  event.target.select();
});

els.iterateTargetRef?.addEventListener('click', (event) => {
  event.target.select();
});

els.clearIterationLog?.addEventListener('click', async () => {
  const sessionId = getSessionId();
  if (!sessionId) return;
  if (!window.confirm('Clear iteration history for this session?')) return;
  await window.inspector?.clearIterationLog?.(sessionId);
});

window.addEventListener('message', (event) => {
  if (event.data?.type === 'tb-picker-cancelled') {
    setPickElementMode(false);
    return;
  }
  if (event.data?.type === 'tb-target-copied') {
    const copyRef = event.data.copyRef || (event.data.regionId ? `#${event.data.regionId}` : event.data.ref);
    const pickId = copyRef.replace(/^#/, '');
    if (/^tb-pick-/i.test(pickId)) {
      showIterateCopyToast(`Copied: ${copyRef} — use Pick element to save it`);
      return;
    }
    setIterateRef(copyRef);
    showIterateCopyToast(`Copied: ${copyRef}`);
    if (!els.iterateInput?.value.trim() && copyRef) {
      els.iterateInput.value = `${copyRef} — `;
      els.iterateInput.focus();
    }
    return;
  }
  if (event.data?.type === 'tb-target-selected' && event.data.target) {
    (async () => {
      const sessionId = getSessionId();
      try {
        const target = await stampPickTarget(event.data.target);
        setIterateTarget(target);
        setPickElementMode(false);
        const regionRef = iterateRefFromTarget(target);
        showIterateCopyToast(`Selected: ${regionRef}`);
        els.iterateInput.value = `${regionRef} — `;
        els.iterateInput.focus();
      } catch (err) {
        if (sessionId) loadPreview(sessionId, currentHtml, currentPhase);
        setIterateTarget(null);
        window.ui?.showStepError?.({
          step: 'Pick element',
          message: err.message || 'Could not save picked element',
        });
        setPickElementMode(false);
      }
    })();
  }
});

document.getElementById('btn-iterate-send')?.addEventListener('click', runIterate);

els.iterateInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    runIterate();
  }
});

els.approve?.addEventListener('click', runApprove);
els.designHome?.addEventListener('click', () => runDesignHome());
els.openTab?.addEventListener('click', () => {
  const sessionId = getSessionId();
  const url = els.openTab?.dataset.previewUrl || (sessionId ? previewUrl(sessionId) : '');
  if (url) window.open(url, '_blank', 'noopener');
});

document.querySelectorAll('.preview-viewport-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const mobile = btn.dataset.viewport === 'mobile';
    els.preview?.classList.toggle('preview--mobile', mobile);
    document.querySelectorAll('.preview-viewport-btn').forEach((b) => {
      const active = b === btn;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  });
});

els.allProjects?.addEventListener('click', startOver);
els.startOver?.addEventListener('click', startOver);

async function boot() {
  try {
    await window.projects?.load?.();
  } catch (err) {
    log('Could not load projects', { error: err.message });
  }
  showProjectsPanel();
}

boot();
