/**
 * Activity inspector — iteration trace, lessons learnt, activity log, LLM prompts.
 */
(function initInspector() {
  const MAX_LINES = 250;

  function timestamp() {
    return new Date().toLocaleTimeString();
  }

  function append(line) {
    const log = document.getElementById('log');
    if (log) {
      log.hidden = false;
      const combined = `${log.textContent}\n${line}`.trim();
      log.textContent = combined.split('\n').slice(-MAX_LINES).join('\n');
      log.scrollTop = log.scrollHeight;
    }
    console.log(`[WP Theme Builder] ${line}`);
  }

  function log(message, data) {
    const suffix = data !== undefined ? ` ${typeof data === 'string' ? data : JSON.stringify(data)}` : '';
    append(`[${timestamp()}] ${message}${suffix}`);
  }

  function logWizard(event, detail) {
    const suffix = detail !== undefined
      ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`
      : '';
    append(`[${timestamp()}] [wizard] ${event}${suffix}`);
  }

  function formatTraceTime(iso) {
    try {
      return new Date(iso).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso || '';
    }
  }

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderTraceItem(entry) {
    const pending = entry.status === 'pending';
    const ok = entry.status === 'success';
    const phaseLabel = entry.phase === 'design' ? 'Design' : 'Wireframe';
    const statusClass = pending ? 'is-pending' : ok ? 'is-success' : 'is-failed';
    let statusLabel = 'In progress…';
    if (ok) statusLabel = `Saved as version ${entry.version}`;
    else if (entry.status === 'failed') statusLabel = `Failed — ${entry.error || 'error'}`;
    const request = escapeHtml(entry.request);
    const targetLine = entry.targetId
      ? `<p class="iteration-log__target">Target: <code>#${escapeHtml(entry.targetId)}</code></p>`
      : '';

    return `<li class="iteration-log__item ${statusClass}">
      <div class="iteration-log__meta">
        <span class="iteration-log__phase">${phaseLabel}</span>
        <time class="iteration-log__time">${formatTraceTime(entry.at)}</time>
      </div>
      ${targetLine}
      <p class="iteration-log__request">You asked: “${request}”</p>
      <p class="iteration-log__status">${escapeHtml(statusLabel)}</p>
    </li>`;
  }

  function renderIterationTrace(trace = []) {
    const ordered = trace.slice().reverse();
    const html = ordered.length
      ? ordered.map(renderTraceItem).join('')
      : '<li class="iteration-log__empty">No iterations yet — open Iterate, describe a change, and click Send.</li>';

    const list = document.getElementById('iteration-trace');
    if (list) list.innerHTML = html;
  }

  async function clearIterationLog(sessionId) {
    if (!sessionId) return;
    await window.tbFetch(`/api/generate/session/${sessionId}/trace`, { method: 'DELETE' });
    renderIterationTrace([]);
  }

  function prependPendingIteration({ request, phase = 'wireframe' }) {
    const entry = {
      at: new Date().toISOString(),
      phase,
      request,
      status: 'pending',
    };
    const itemHtml = renderTraceItem(entry);
    const list = document.getElementById('iteration-trace');
    if (!list) return;
    const empty = list.querySelector('.iteration-log__empty');
    if (empty) empty.remove();
    list.insertAdjacentHTML('afterbegin', itemHtml);
    document.getElementById('iteration-trace-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    log(`Iteration started — ${request}`);
  }

  function renderLessons(lessons = []) {
    const list = document.getElementById('lessons-learned');
    const wrap = document.getElementById('lessons-learned-wrap');
    if (!list || !wrap) return;

    if (!lessons.length) {
      wrap.hidden = true;
      list.innerHTML = '';
      return;
    }

    wrap.hidden = false;
    list.innerHTML = lessons.map((entry) => {
      const synced = entry.syncedToVault ? ' · synced to Vault Memory' : '';
      const text = escapeHtml(entry.lesson);
      return `<li class="lessons-learned__item">
        <time class="lessons-learned__time">${formatTraceTime(entry.at)}</time>
        <p class="lessons-learned__text">${text}</p>
        <span class="lessons-learned__meta">${escapeHtml(entry.category || 'lesson')}${synced}</span>
      </li>`;
    }).join('');
  }

  async function loadSessionTrace(sessionId) {
    if (!sessionId) return;
    try {
      const res = await window.tbFetch(`/api/generate/session/${sessionId}/trace`);
      if (!res.ok) return;
      const data = await res.json();
      renderIterationTrace(data.trace || []);
    } catch {
      // ignore
    }
  }

  async function loadSessionLessons(sessionId) {
    if (!sessionId) return;
    try {
      const res = await window.tbFetch(`/api/generate/session/${sessionId}/lessons`);
      if (!res.ok) return;
      const data = await res.json();
      renderLessons(data.lessons || []);
    } catch {
      // ignore
    }
  }

  function logPrompt({ model, system, user, recordedAt } = {}) {
    const wrap = document.getElementById('inspector-prompt-wrap');
    const meta = document.getElementById('inspector-prompt-meta');
    const panel = document.getElementById('inspector-prompt');
    const systemLen = (system || '').length;
    const userLen = (user || '').length;

    if (wrap) wrap.hidden = false;
    if (meta) {
      meta.textContent = [
        model ? `Model: ${model}` : null,
        `System: ${systemLen.toLocaleString()} chars`,
        `User: ${userLen.toLocaleString()} chars`,
        recordedAt ? new Date(recordedAt).toLocaleString() : null,
      ].filter(Boolean).join(' · ');
    }
    if (panel) {
      panel.textContent = [
        '══════════════ SYSTEM PROMPT ══════════════',
        system || '(empty)',
        '',
        '══════════════ USER PROMPT ════════════════',
        user || '(empty)',
      ].join('\n');
      panel.scrollTop = 0;
    }

    append(`[${timestamp()}] LLM prompt ready — ${systemLen + userLen} chars total`);
  }

  async function loadSessionPrompt(sessionId) {
    if (!sessionId) return;
    try {
      const res = await window.tbFetch(`/api/generate/session/${sessionId}/prompt`);
      if (!res.ok) return;
      const prompt = await res.json();
      logPrompt(prompt);
    } catch {
      // ignore
    }
  }

  async function loadSession(sessionId) {
    await Promise.all([
      loadSessionTrace(sessionId),
      loadSessionLessons(sessionId),
      loadSessionPrompt(sessionId),
    ]);
  }

  window.inspector = {
    log,
    logWizard,
    append,
    logPrompt,
    loadSessionPrompt,
    loadSessionTrace,
    loadSessionLessons,
    loadSession,
    renderIterationTrace,
    prependPendingIteration,
    clearIterationLog,
  };

  window.inspector.log('Inspector ready');
})();
