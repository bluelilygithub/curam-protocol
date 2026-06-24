/**
 * Standalone generation overlay — does not depend on ui.js.
 */
(function initGenerationUI() {
  const LEAVE_MSG = 'Generation is in progress. Leaving now may interrupt your session. Are you sure you want to leave?';

  let active = false;
  let pollTimer = null;
  let beforeUnload = null;
  let lastLoggedDetail = '';
  let lastPromptJobId = null;
  let abortController = null;
  let currentJobId = null;
  let onCancelCallback = null;

  function el(id) {
    return document.getElementById(id);
  }

  function renderSteps(steps) {
    const list = el('loading-steps');
    if (!list) return;
    list.innerHTML = (steps || []).map((step) => {
      const cls = step.status === 'done' ? ' is-done' : step.status === 'active' ? ' is-active' : '';
      return `<li class="loading-overlay__step${cls}"><span class="loading-overlay__step-dot"></span><span>${step.label}</span></li>`;
    }).join('');
  }

  function renderBuildingItems(items) {
    const list = el('loading-building-items');
    if (!list) return;
    if (!items?.length) {
      list.hidden = true;
      list.innerHTML = '';
      return;
    }
    list.hidden = false;
    list.innerHTML = items.map((item) => `<li class="loading-overlay__building-item">${item}</li>`).join('');
  }

  function appendLog(message) {
    const line = message.trim();
    if (!line) return;
    if (window.inspector?.append) {
      window.inspector.append(line);
      return;
    }
    const log = el('log');
    if (!log) return;
    log.hidden = false;
    if (log.textContent.endsWith(line)) return;
    log.textContent = `${log.textContent}\n${line}`.trim();
    log.scrollTop = log.scrollHeight;
  }

  function open({
    title = 'Generating…',
    steps = [],
    jobId = null,
    type = null,
    emphasizeGenerating = false,
    cancellable = false,
    onCancel = null,
  } = {}) {
    active = true;
    currentJobId = jobId;
    onCancelCallback = onCancel || null;
    abortController = new AbortController();

    const overlay = el('loading-overlay');
    const card = overlay?.querySelector('.loading-overlay__card');
    const heading = el('loading-title');
    const emphasis = el('loading-generating-emphasis');
    const durationHint = el('loading-duration-hint');
    const warning = el('loading-warning');
    const stepsEl = el('loading-steps');
    const status = el('loading-status');
    const message = el('loading-message');
    const building = el('loading-building-items');
    const cancelBtn = el('loading-cancel');

    if (heading) heading.textContent = title;
    if (emphasis) emphasis.hidden = !emphasizeGenerating;
    if (durationHint) durationHint.hidden = false;
    if (warning) warning.hidden = false;
    if (stepsEl) stepsEl.hidden = false;
    if (building) building.hidden = emphasizeGenerating ? false : true;
    if (cancelBtn) cancelBtn.hidden = !cancellable;
    if (card) {
      card.classList.toggle('loading-overlay__card--emphasize', Boolean(emphasizeGenerating));
    }
    if (status) {
      status.hidden = false;
      status.textContent = emphasizeGenerating
        ? 'Generating content from your request…'
        : (steps[0]?.label || 'Starting…');
    }
    if (message) message.hidden = true;

    renderSteps(steps);
    renderBuildingItems([]);
    lastLoggedDetail = '';
    lastPromptJobId = null;
    appendLog(`[${new Date().toLocaleTimeString()}] ${title}`);

    if (overlay) {
      overlay.classList.add('is-open');
      overlay.setAttribute('aria-hidden', 'false');
      overlay.style.display = 'flex';
    }

    document.body.classList.add('is-generating');

    if (!beforeUnload) {
      beforeUnload = (e) => {
        if (!active) return;
        e.preventDefault();
        e.returnValue = LEAVE_MSG;
        return LEAVE_MSG;
      };
      window.addEventListener('beforeunload', beforeUnload);
    }

    if (jobId && type) {
      window.tbFetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, type }),
      }).catch(() => {});
      startPoll(jobId);
    }
  }

  async function fetchJob(jobId) {
    try {
      const res = await window.tbFetch(`/api/jobs/${jobId}`);
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  }

  function startPoll(jobId) {
    stopPoll();
    const tick = async () => {
      const job = await fetchJob(jobId);
      if (!job) return;
      if (job.status === 'cancelled') {
        stopPoll();
        return;
      }
      renderSteps(job.steps || []);
      renderBuildingItems(job.buildingItems || []);
      const activeStep = (job.steps || []).find((s) => s.status === 'active');
      const detail = job.message || activeStep?.label || '';
      const status = el('loading-status');
      if (status) status.textContent = detail;
      if (detail && detail !== lastLoggedDetail) {
        lastLoggedDetail = detail;
        appendLog(`  → ${detail}`);
      }
      if (job.prompt && job.jobId !== lastPromptJobId) {
        lastPromptJobId = job.jobId;
        window.inspector?.logPrompt?.(job.prompt);
      }
      if (job.status === 'complete' || job.status === 'error') stopPoll();
    };
    tick();
    pollTimer = setInterval(tick, 700);
  }

  function stopPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function cancel() {
    if (!active) return;
    abortController?.abort();
    if (currentJobId) {
      window.tbFetch(`/api/jobs/${currentJobId}/cancel`, { method: 'POST' }).catch(() => {});
    }
    appendLog('Generation cancelled by user');
    onCancelCallback?.();
    close();
  }

  function close() {
    active = false;
    stopPoll();
    abortController = null;
    currentJobId = null;
    onCancelCallback = null;

    const overlay = el('loading-overlay');
    if (overlay) {
      overlay.classList.remove('is-open');
      overlay.setAttribute('aria-hidden', 'true');
      overlay.style.display = '';
    }

    document.body.classList.remove('is-generating');

    ['loading-warning', 'loading-duration-hint', 'loading-steps', 'loading-status', 'loading-building-items', 'loading-generating-emphasis', 'loading-cancel'].forEach((id) => {
      const node = el(id);
      if (node) node.hidden = true;
    });
    const card = el('loading-overlay')?.querySelector('.loading-overlay__card');
    if (card) card.classList.remove('loading-overlay__card--emphasize');
    const message = el('loading-message');
    if (message) message.hidden = false;
  }

  function isActive() {
    return active;
  }

  function confirmLeave() {
    if (!active) return true;
    return window.confirm(LEAVE_MSG);
  }

  function createJobId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `job-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function getAbortSignal() {
    return abortController?.signal || null;
  }

  el('loading-cancel')?.addEventListener('click', cancel);

  window.generationUI = {
    open,
    close,
    cancel,
    isActive,
    confirmLeave,
    createJobId,
    getAbortSignal,
    appendLog,
  };
})();
