/**
 * Shared UI — global progress, loading overlay, generation progress, errors, session state.
 */

const STATE_KEY = 'wpThemeBuilderState';

const APP_STAGES = [
  { id: 'brief', label: 'Brief' },
  { id: 'preview', label: 'Design' },
  { id: 'wp-brief', label: 'WP setup' },
  { id: 'complete', label: 'Theme' },
];

const STAGE1_MESSAGES = [
  'Analysing your brief…',
  'Designing your layout…',
  'Writing your CSS…',
  'Almost done…',
];

const STAGE2_MESSAGES = [
  'Reading your HTML…',
  'Building theme files…',
  'Generating ACF fields…',
  'Creating blocks…',
  'Packaging your theme…',
];

const LEAVE_CONFIRM_MESSAGE = 'Generation is in progress. Leaving now may interrupt your session. Are you sure you want to leave?';

let loadingTimer = null;
let messageIndex = 0;
let pendingRetry = null;
let generationActive = false;
let progressPollTimer = null;
let beforeUnloadHandler = null;

function $(id) {
  return document.getElementById(id);
}

function openOverlay() {
  const overlay = $('loading-overlay');
  if (!overlay) return;
  overlay.classList.add('is-open');
  overlay.setAttribute('aria-hidden', 'false');
}

function closeOverlay() {
  const overlay = $('loading-overlay');
  if (!overlay) return;
  overlay.classList.remove('is-open');
  overlay.setAttribute('aria-hidden', 'true');
}

function setAppStage(stageId) {
  const idx = APP_STAGES.findIndex((s) => s.id === stageId);
  const bar = $('global-progress');
  if (!bar) return;

  bar.querySelectorAll('[data-stage]').forEach((el) => {
    const stepIdx = APP_STAGES.findIndex((s) => s.id === el.dataset.stage);
    el.classList.remove('is-active', 'is-done');
    if (stepIdx < idx) el.classList.add('is-done');
    if (stepIdx === idx) el.classList.add('is-active');
  });

  saveAppState({ appStage: stageId });
}

function saveAppState(patch) {
  const current = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
  localStorage.setItem(STATE_KEY, JSON.stringify({ ...current, ...patch }));
}

function getAppState() {
  try {
    return JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
  } catch {
    return {};
  }
}

function clearAppState() {
  localStorage.removeItem(STATE_KEY);
}

function renderGenerationSteps(steps = []) {
  const list = $('loading-steps');
  if (!list) return;

  list.innerHTML = steps.map((step) => {
    const statusClass = step.status === 'done'
      ? ' is-done'
      : step.status === 'active'
        ? ' is-active'
        : '';
    return `<li class="loading-overlay__step${statusClass}"><span class="loading-overlay__step-dot" aria-hidden="true"></span><span>${step.label}</span></li>`;
  }).join('');
}

function attachLeaveProtection() {
  if (beforeUnloadHandler) return;

  beforeUnloadHandler = (event) => {
    if (!generationActive) return;
    event.preventDefault();
    event.returnValue = LEAVE_CONFIRM_MESSAGE;
    return LEAVE_CONFIRM_MESSAGE;
  };

  window.addEventListener('beforeunload', beforeUnloadHandler);
}

function detachLeaveProtection() {
  if (!beforeUnloadHandler) return;
  window.removeEventListener('beforeunload', beforeUnloadHandler);
  beforeUnloadHandler = null;
}

function beginGenerationModal({ title = 'Generating…', jobId, type, steps = [], emphasizeGenerating = false } = {}) {
  const heading = $('loading-title');
  const warning = $('loading-warning');
  const emphasis = $('loading-generating-emphasis');
  const stepsEl = $('loading-steps');
  const status = $('loading-status');
  const message = $('loading-message');
  const building = $('loading-building-items');
  const card = $('loading-overlay')?.querySelector('.loading-overlay__card');

  generationActive = true;
  attachLeaveProtection();
  clearInterval(loadingTimer);
  loadingTimer = null;

  if (heading) heading.textContent = title;
  if (emphasis) emphasis.hidden = !emphasizeGenerating;
  if (warning) warning.hidden = false;
  if (stepsEl) stepsEl.hidden = false;
  if (building) building.hidden = !emphasizeGenerating;
  if (card) card.classList.toggle('loading-overlay__card--emphasize', Boolean(emphasizeGenerating));
  if (status) {
    status.hidden = false;
    status.textContent = emphasizeGenerating
      ? 'Generating content from your request…'
      : 'Starting…';
  }
  if (message) message.hidden = true;

  renderGenerationSteps(steps);
  openOverlay();
  const overlay = $('loading-overlay');
  if (overlay) overlay.style.display = 'flex';
  document.body.classList.add('is-generating');

  if (jobId && type) {
    registerJob(jobId, type).finally(() => startJobPolling(jobId));
  } else if (jobId) {
    startJobPolling(jobId);
  }
}

async function registerJob(jobId, type) {
  try {
    await window.tbFetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, type }),
    });
  } catch (_) {
    // Server will register when generation starts.
  }
}

async function fetchJob(jobId) {
  const res = await window.tbFetch(`/api/jobs/${jobId}`);
  if (!res.ok) return null;
  return res.json();
}

function startJobPolling(jobId) {
  stopJobPolling();

  const poll = async () => {
    const job = await fetchJob(jobId);
    if (!job) return;

    renderGenerationSteps(job.steps || []);
    const building = $('loading-building-items');
    if (building && job.buildingItems?.length) {
      building.hidden = false;
      building.innerHTML = job.buildingItems.map((item) =>
        `<li class="loading-overlay__building-item">${item}</li>`
      ).join('');
    }
    const status = $('loading-status');
    if (status) {
      const activeStep = (job.steps || []).find((step) => step.status === 'active');
      status.textContent = job.message || activeStep?.label || '';
    }

    if (job.status === 'complete' || job.status === 'error') {
      stopJobPolling();
    }
  };

  poll();
  progressPollTimer = setInterval(poll, 600);
}

function stopJobPolling() {
  if (progressPollTimer) {
    clearInterval(progressPollTimer);
    progressPollTimer = null;
  }
}

function endGenerationModal() {
  stopJobPolling();
  generationActive = false;
  detachLeaveProtection();
  closeOverlay();
  const overlay = $('loading-overlay');
  if (overlay) overlay.style.display = '';
  document.body.classList.remove('is-generating', 'is-loading');

  const warning = $('loading-warning');
  const emphasis = $('loading-generating-emphasis');
  const stepsEl = $('loading-steps');
  const status = $('loading-status');
  const message = $('loading-message');
  const building = $('loading-building-items');
  const card = overlay?.querySelector('.loading-overlay__card');
  if (warning) warning.hidden = true;
  if (emphasis) emphasis.hidden = true;
  if (stepsEl) stepsEl.hidden = true;
  if (building) building.hidden = true;
  if (card) card.classList.remove('loading-overlay__card--emphasize');
  if (status) {
    status.hidden = true;
    status.textContent = '';
  }
  if (message) message.hidden = false;

  clearInterval(loadingTimer);
  loadingTimer = null;
}

function isGenerationActive() {
  return generationActive;
}

function confirmLeaveGeneration() {
  if (!generationActive) return true;
  return window.confirm(LEAVE_CONFIRM_MESSAGE);
}

function createJobId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `job-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function openGenerationModal(opts = {}) {
  beginGenerationModal(opts);
}

function showLoading(messages = STAGE1_MESSAGES) {
  const text = $('loading-message');
  const warning = $('loading-warning');
  const stepsEl = $('loading-steps');
  const status = $('loading-status');

  if (warning) warning.hidden = true;
  if (stepsEl) stepsEl.hidden = true;
  if (status) status.hidden = true;
  if (text) {
    text.hidden = false;
    messageIndex = 0;
    text.textContent = messages[0];
  }

  openOverlay();
  document.body.classList.add('is-loading');

  clearInterval(loadingTimer);
  loadingTimer = setInterval(() => {
    messageIndex = (messageIndex + 1) % messages.length;
    if (text) text.textContent = messages[messageIndex];
  }, 2800);
}

function hideLoading() {
  if (generationActive) return;
  closeOverlay();
  document.body.classList.remove('is-loading');
  clearInterval(loadingTimer);
  loadingTimer = null;
}

function showStepError({ step, message, retryFn, targetId = 'global-error' }) {
  const box = $(targetId);
  if (!box) return;

  pendingRetry = retryFn || null;
  box.hidden = false;
  box.innerHTML = `
    <p class="step-error__title">${step} failed</p>
    <p class="step-error__message">${message}</p>
    ${retryFn ? '<button type="button" class="btn-primary" id="btn-retry">Retry</button>' : ''}
  `;

  $('btn-retry')?.addEventListener('click', () => {
    clearStepError(targetId);
    if (pendingRetry) pendingRetry();
  });
}

function clearStepError(targetId = 'global-error') {
  const box = $(targetId);
  if (box) {
    box.hidden = true;
    box.innerHTML = '';
  }
  pendingRetry = null;
}

function showResumeBanner({ sessionId, stageLabel, onContinue, onStartOver }) {
  const banner = $('resume-banner');
  const text = $('resume-banner-text');
  if (!banner || !text) return;

  text.textContent = `In-progress project (${stageLabel}). Continue where you left off, or start a new brief.`;
  banner.hidden = false;

  const continueBtn = $('resume-continue');
  const startBtn = $('resume-start-over');

  const cleanup = () => {
    banner.hidden = true;
    continueBtn?.removeEventListener('click', handleContinue);
    startBtn?.removeEventListener('click', handleStartOver);
  };

  function handleContinue() {
    cleanup();
    onContinue();
  }

  function handleStartOver() {
    if (!confirmLeaveGeneration()) return;
    cleanup();
    onStartOver();
  }

  continueBtn?.addEventListener('click', handleContinue);
  startBtn?.addEventListener('click', handleStartOver);
}

function stageLabelFromMeta(stage) {
  const map = {
    intake: 'project brief',
    'intake-complete': 'wireframe generation',
    wireframe: 'wireframe preview',
    design: 'design preview',
    'design-approved': 'WordPress setup',
    'conversion-brief': 'theme generation',
    'conversion-complete': 'theme download',
  };
  return map[stage] || 'project';
}

function appStageFromMeta(stage) {
  if (stage === 'conversion-complete') return 'complete';
  if (stage === 'design-approved' || stage === 'conversion-brief') return 'wp-brief';
  if (stage === 'design' || stage === 'wireframe' || stage === 'intake-complete') return 'preview';
  return 'brief';
}

function initGlobalProgress() {
  const bar = $('global-progress');
  if (!bar) return;

  bar.innerHTML = APP_STAGES.map((stage, i) => `
    <li class="global-progress__item" data-stage="${stage.id}">
      <span class="global-progress__dot">${i + 1}</span>
      <span class="global-progress__label">${stage.label}</span>
    </li>
  `).join('');

  setAppStage('brief');
}

document.addEventListener('DOMContentLoaded', initGlobalProgress);

window.ui = {
  STATE_KEY,
  APP_STAGES,
  STAGE1_MESSAGES,
  STAGE2_MESSAGES,
  setAppStage,
  saveAppState,
  getAppState,
  clearAppState,
  createJobId,
  openGenerationModal,
  beginGenerationModal,
  endGenerationModal,
  isGenerationActive,
  confirmLeaveGeneration,
  showLoading,
  hideLoading,
  showStepError,
  clearStepError,
  showResumeBanner,
  stageLabelFromMeta,
  appStageFromMeta,
};
