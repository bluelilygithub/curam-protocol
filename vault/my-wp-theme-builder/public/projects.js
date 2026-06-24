/**
 * Projects browser — grouped by project, chat-history style.
 */
(function initProjects() {
  const els = {
    panel: document.getElementById('projects-panel'),
    listCard: document.getElementById('projects-list-card'),
    count: document.getElementById('projects-count'),
    search: document.getElementById('projects-search'),
    newProject: document.getElementById('btn-new-project'),
    tabs: document.querySelectorAll('.projects-tab'),
  };

  let cache = { active: [], completed: [] };
  let currentTab = 'active';
  let confirmDelete = null;

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtDate(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return '';
    }
  }

  function downloadHref(sessionId, variant, { approved = false } = {}) {
    const params = new URLSearchParams({ variant });
    if (approved) params.set('approved', '1');
    const path = `/download/${sessionId}?${params}`;
    return window.tbPath ? window.tbPath(path) : path;
  }

  function renderDownloadMenu(website) {
    if (!website.canDownload && !website.resume?.hasThemeZip) {
      return '<span class="history-row__hint">No exports yet</span>';
    }
    const sid = website.sessionId;
    const locked = website.locked || website.resume?.hasApproved;
    const hasTheme = website.resume?.hasThemeZip;
    const parts = [];
    if (locked) {
      parts.push(`<a class="history-action" href="${downloadHref(sid, 'source', { approved: true })}" download>Source</a>`);
      parts.push(`<a class="history-action" href="${downloadHref(sid, 'static', { approved: true })}" download>Static</a>`);
    }
    if (hasTheme) {
      parts.push(`<a class="history-action" href="${downloadHref(sid, 'wordpress')}" download>WordPress</a>`);
    }
    return parts.length
      ? `<div class="history-downloads">${parts.join('')}</div>`
      : '<span class="history-row__hint">Approve design to export</span>';
  }

  function renderWebsiteRow(website, project, rowIndex) {
    const bg = rowIndex % 2 === 0 ? 'var(--surface)' : 'var(--bg)';
    const confirmKey = `website:${website.sessionId}`;
    const isConfirm = confirmDelete === confirmKey;

    if (isConfirm) {
      return `<div class="history-row history-row--confirm" style="background:${bg}">
        <span class="history-row__confirm-text">Delete website “${escapeHtml(website.websiteLabel)}”?</span>
        <button type="button" class="btn-secondary btn-small history-row__confirm-yes" data-delete-website="${website.sessionId}">Delete</button>
        <button type="button" class="btn-secondary btn-small" data-cancel-delete>Cancel</button>
      </div>`;
    }

    return `<div class="history-row history-row--website" style="background:${bg}" data-open-website="${website.sessionId}">
      <div class="history-row__col history-row__col--meta">
        <div class="history-row__project">${escapeHtml(project.displayName)}</div>
        <div class="history-row__date">${escapeHtml(fmtDate(website.updatedAt))}</div>
      </div>
      <div class="history-row__col history-row__col--main">
        <div class="history-row__title">${escapeHtml(website.websiteLabel || website.sessionId.slice(0, 8))}</div>
        <div class="history-row__subtitle">${escapeHtml(website.stageLabel || 'New')}${website.locked ? ' · locked' : ''}</div>
      </div>
      <div class="history-row__col history-row__col--actions" data-no-open>
        ${renderDownloadMenu(website)}
        <button type="button" class="history-action" data-rename-website="${website.sessionId}" data-current-name="${escapeHtml(website.websiteLabel)}">Rename</button>
        <button type="button" class="history-action history-action--danger" data-confirm-website="${website.sessionId}">Delete</button>
        <span class="history-row__chevron" aria-hidden="true">›</span>
      </div>
    </div>`;
  }

  function renderProjectGroup(project, startIndex) {
    const confirmKey = `project:${project.projectId}`;
    const isConfirm = confirmDelete === confirmKey;
    let rowIndex = startIndex;

    const header = isConfirm
      ? `<div class="history-group__head history-group__head--confirm">
          <span>Delete project “${escapeHtml(project.displayName)}” and all ${project.websiteCount} website(s)?</span>
          <button type="button" class="btn-secondary btn-small" data-delete-project="${project.projectId}">Delete all</button>
          <button type="button" class="btn-secondary btn-small" data-cancel-delete>Cancel</button>
        </div>`
      : `<div class="history-group__head">
          <div class="history-group__title-wrap">
            <h3 class="history-group__title">${escapeHtml(project.displayName)}</h3>
            <span class="history-group__count">${project.websiteCount} website${project.websiteCount === 1 ? '' : 's'}</span>
          </div>
          <div class="history-group__actions">
            <button type="button" class="history-action" data-add-website="${project.projectId}">Add website</button>
            <button type="button" class="history-action" data-rename-project="${project.projectId}" data-current-name="${escapeHtml(project.displayName)}">Rename</button>
            ${project.status === 'completed'
              ? `<button type="button" class="history-action" data-reopen-project="${project.projectId}">Reopen</button>`
              : `<button type="button" class="history-action" data-complete-project="${project.projectId}">Complete</button>`}
            <button type="button" class="history-action history-action--danger" data-confirm-project="${project.projectId}">Delete</button>
          </div>
        </div>`;

    const websites = (project.websites || []).map((w) => {
      const html = renderWebsiteRow(w, project, rowIndex);
      rowIndex += 1;
      return html;
    }).join('');

    return `<section class="history-group" data-project-id="${project.projectId}">
      ${header}
      <div class="history-group__websites">${websites || '<p class="history-group__empty">No websites — add one to start.</p>'}</div>
    </section>`;
  }

  function filterProjects(projects, query) {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((project) => {
      if (project.displayName.toLowerCase().includes(q)) return true;
      return (project.websites || []).some((w) =>
        (w.websiteLabel || '').toLowerCase().includes(q)
        || (w.stageLabel || '').toLowerCase().includes(q)
      );
    });
  }

  function render() {
    if (!els.listCard) return;
    const query = els.search?.value || '';
    const source = currentTab === 'completed' ? cache.completed : cache.active;
    const filtered = filterProjects(source, query);

    if (!filtered.length) {
      const emptyLabel = currentTab === 'completed'
        ? 'No completed projects.'
        : (query ? `No matches for “${escapeHtml(query)}”.` : 'No active projects — create one to start.');
      els.listCard.innerHTML = `<div class="history-empty">${emptyLabel}</div>`;
    } else {
      let rowIndex = 0;
      els.listCard.innerHTML = filtered.map((p) => {
        const html = renderProjectGroup(p, rowIndex);
        rowIndex += (p.websites || []).length;
        return html;
      }).join('');
    }

    if (els.count) {
      if (filtered.length) {
        els.count.hidden = false;
        els.count.textContent = `${filtered.length} project${filtered.length === 1 ? '' : 's'}${query ? ` matching “${query}”` : ''}`;
      } else {
        els.count.hidden = true;
      }
    }
  }

  function setTab(tab) {
    currentTab = tab;
    confirmDelete = null;
    els.tabs?.forEach((btn) => {
      const active = btn.dataset.tab === tab;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    render();
  }

  async function load() {
    const res = await window.tbFetch('/api/intake/projects');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load projects');
    cache = { active: data.active || [], completed: data.completed || [] };
    render();
    return cache;
  }

  async function createProject(displayName, websiteLabel) {
    const res = await window.tbFetch('/api/intake/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName, websiteLabel }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not create project');
    return data;
  }

  async function patchProject(projectId, patch) {
    const res = await window.tbFetch(`/api/intake/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not update project');
    return data;
  }

  async function addWebsite(projectId, websiteLabel) {
    const res = await window.tbFetch(`/api/intake/projects/${projectId}/websites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ websiteLabel }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not add website');
    return data;
  }

  async function patchWebsite(sessionId, patch) {
    const res = await window.tbFetch(`/api/intake/session/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not update website');
    return data;
  }

  async function removeProject(projectId) {
    const res = await window.tbFetch(`/api/intake/projects/${projectId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not delete project');
    return data;
  }

  async function removeWebsite(sessionId) {
    const res = await window.tbFetch(`/api/intake/session/${sessionId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not delete website');
    return data;
  }

  function show() {
    if (els.panel) els.panel.hidden = false;
  }

  function hide() {
    if (els.panel) els.panel.hidden = true;
  }

  els.newProject?.addEventListener('click', async () => {
    const name = await window.tbModal?.prompt?.({
      title: 'New project',
      label: 'Project name',
      hint: 'You can add multiple websites to a project later.',
      defaultValue: '',
      confirmLabel: 'Create',
    });
    if (name === null) return;
    try {
      const result = await createProject(name.trim());
      localStorage.setItem('wpThemeBuilderSessionId', result.sessionId);
      await load();
      await window.openWebsite?.(result.sessionId);
    } catch (err) {
      alert(err.message);
    }
  });

  els.search?.addEventListener('input', () => render());

  els.tabs?.forEach((btn) => {
    btn.addEventListener('click', () => setTab(btn.dataset.tab || 'active'));
  });

  document.addEventListener('click', async (event) => {
    const target = event.target;

    if (target.closest('[data-no-open]')) {
      if (!target.closest('[data-open-website]')) event.stopPropagation();
    }

    const openRow = target.closest('[data-open-website]');
    if (openRow?.dataset.openWebsite && !target.closest('[data-no-open]')) {
      await window.openWebsite?.(openRow.dataset.openWebsite);
      return;
    }

    if (target.closest('[data-cancel-delete]')) {
      confirmDelete = null;
      render();
      return;
    }

    const confirmWebsite = target.closest('[data-confirm-website]');
    if (confirmWebsite?.dataset.confirmWebsite) {
      confirmDelete = `website:${confirmWebsite.dataset.confirmWebsite}`;
      render();
      return;
    }

    const confirmProject = target.closest('[data-confirm-project]');
    if (confirmProject?.dataset.confirmProject) {
      confirmDelete = `project:${confirmProject.dataset.confirmProject}`;
      render();
      return;
    }

    const deleteWebsiteBtn = target.closest('[data-delete-website]');
    if (deleteWebsiteBtn?.dataset.deleteWebsite) {
      const sid = deleteWebsiteBtn.dataset.deleteWebsite;
      try {
        await removeWebsite(sid);
        if (localStorage.getItem('wpThemeBuilderSessionId') === sid) {
          localStorage.removeItem('wpThemeBuilderSessionId');
        }
        confirmDelete = null;
        await load();
      } catch (err) {
        alert(err.message);
      }
      return;
    }

    const deleteProjectBtn = target.closest('[data-delete-project]');
    if (deleteProjectBtn?.dataset.deleteProject) {
      try {
        await removeProject(deleteProjectBtn.dataset.deleteProject);
        confirmDelete = null;
        await load();
      } catch (err) {
        alert(err.message);
      }
      return;
    }

    const renameWebsite = target.closest('[data-rename-website]');
    if (renameWebsite?.dataset.renameWebsite) {
      const sid = renameWebsite.dataset.renameWebsite;
      const current = renameWebsite.dataset.currentName || '';
      const next = await window.tbModal?.prompt?.({
        title: 'Rename website',
        label: 'Website name',
        defaultValue: current,
      });
      if (next === null || next.trim() === current) return;
      try {
        await patchWebsite(sid, { websiteLabel: next.trim() });
        await load();
      } catch (err) {
        alert(err.message);
      }
      return;
    }

    const renameProject = target.closest('[data-rename-project]');
    if (renameProject?.dataset.renameProject) {
      const pid = renameProject.dataset.renameProject;
      const current = renameProject.dataset.currentName || '';
      const next = await window.tbModal?.prompt?.({
        title: 'Rename project',
        label: 'Project name',
        defaultValue: current,
      });
      if (next === null || next.trim() === current) return;
      try {
        await patchProject(pid, { displayName: next.trim() });
        await load();
      } catch (err) {
        alert(err.message);
      }
      return;
    }

    const addWebsiteBtn = target.closest('[data-add-website]');
    if (addWebsiteBtn?.dataset.addWebsite) {
      const label = await window.tbModal?.prompt?.({
        title: 'Add website',
        label: 'Website name',
        defaultValue: 'New website',
        confirmLabel: 'Add',
      });
      if (label === null) return;
      try {
        const result = await addWebsite(addWebsiteBtn.dataset.addWebsite, label.trim());
        localStorage.setItem('wpThemeBuilderSessionId', result.sessionId);
        await load();
        await window.openWebsite?.(result.sessionId);
      } catch (err) {
        alert(err.message);
      }
      return;
    }

    const completeBtn = target.closest('[data-complete-project]');
    if (completeBtn?.dataset.completeProject) {
      try {
        await patchProject(completeBtn.dataset.completeProject, { status: 'completed' });
        await load();
      } catch (err) {
        alert(err.message);
      }
      return;
    }

    const reopenBtn = target.closest('[data-reopen-project]');
    if (reopenBtn?.dataset.reopenProject) {
      try {
        await patchProject(reopenBtn.dataset.reopenProject, { status: 'active' });
        setTab('active');
        await load();
      } catch (err) {
        alert(err.message);
      }
    }
  });

  window.projects = { load, show, hide, createProject, getCache: () => cache };
})();
