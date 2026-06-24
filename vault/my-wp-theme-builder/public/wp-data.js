/**
 * Stage 2 WordPress brief wizard — builds wpData and submits to /convert/theme
 */

const WP_STEPS = [
  { id: 1, label: 'Editing' },
  { id: 2, label: 'CPTs' },
  { id: 3, label: 'ACF' },
  { id: 4, label: 'Global' },
  { id: 5, label: 'Theme' },
  { id: 6, label: 'Setup' },
  { id: 'summary', label: 'Review' },
];

const wpData = {
  contentEditing: {
    editor: '',
    clientCanChange: '',
  },
  customPostTypes: {
    types: [],
    typeFields: {},
    customTypeName: '',
  },
  acfFields: {
    pages: {},
  },
  globalOptions: {
    enabled: false,
    fields: [],
  },
  themeType: {
    themeStyle: '',
    useGutenberg: false,
    blockSections: '',
  },
  setup: {
    themeName: '',
    themeVersion: '1.0.0',
    authorName: '',
    includeReadme: true,
  },
};

const wpToggleState = {
  globalOptions: false,
  useGutenberg: false,
  includeReadme: true,
};

let wpCurrentStep = 1;
let wpSessionId = null;
let wpIntakeData = null;
let wpApprovedHtml = '';

function wp$(selector, root = document) {
  return root.querySelector(selector);
}

function wp$all(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

function slugKey(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48) || 'field';
}

function getWpCheckedValues(name) {
  return wp$all(`#wp-form input[name="${name}"]:checked`).map((el) => el.value);
}

function getSelectedCptTypes() {
  const types = getWpCheckedValues('cpt');
  if (types.includes('Custom')) {
    const customName = wp$('#cpt-custom-wrap input')?.value.trim();
    if (customName) {
      return types.filter((t) => t !== 'Custom').concat(customName);
    }
  }
  return types.filter((t) => t !== 'Custom');
}

function renderWpProgress() {
  const list = wp$('#wp-step-progress');
  list.innerHTML = WP_STEPS.map((step) => {
    const active = step.id === wpCurrentStep ? ' is-active' : '';
    const done = typeof step.id === 'number' && step.id < wpCurrentStep ? ' is-done' : '';
    return `<li class="step-progress__item${active}${done}">${step.label}</li>`;
  }).join('');
}

function showWpStep(step) {
  wpCurrentStep = step;
  wp$all('.wp-step').forEach((el) => {
    el.hidden = el.dataset.step !== String(step);
  });
  wp$('#wp-btn-back').hidden = step === 1;
  wp$('#wp-btn-next').hidden = step === 'summary';
  wp$('#wp-btn-submit').hidden = step !== 'summary';
  wp$('#wp-form-error').hidden = true;
  renderWpProgress();
  window.ui?.setAppStage('wp-brief');
}

function renderCptFields() {
  const container = wp$('#cpt-fields');
  const types = getSelectedCptTypes();

  container.innerHTML = types.length
    ? '<p class="field-hint">List the fields each content type needs.</p>'
    : '';

  types.forEach((type) => {
    const existing = wpData.customPostTypes.typeFields[type] || '';
    const block = document.createElement('label');
    block.innerHTML = `${type} fields <input type="text" data-cpt="${type}" value="${existing.replace(/"/g, '&quot;')}" placeholder="e.g. name, role, photo, bio" required>`;
    container.appendChild(block);
  });
}

function readAcfPagesFromDom() {
  const pages = {};
  wp$all('.acf-page').forEach((pageEl) => {
    const pageName = pageEl.querySelector('[data-page-name]')?.value.trim();
    if (!pageName) return;

    const fields = [];
    pageEl.querySelectorAll('[data-field-row]').forEach((row) => {
      const label = row.querySelector('[data-field-label]')?.value.trim();
      const key = row.querySelector('[data-field-key]')?.value.trim() || slugKey(label);
      if (label) fields.push({ key, label });
    });

    pages[pageName] = fields;
  });
  return pages;
}

function createFieldRow(pageName, field = { key: '', label: '' }) {
  const row = document.createElement('div');
  row.className = 'acf-field-row';
  row.dataset.fieldRow = '';
  row.innerHTML = `
    <input type="text" data-field-label placeholder="Label" value="${field.label.replace(/"/g, '&quot;')}">
    <input type="text" data-field-key placeholder="key" value="${field.key.replace(/"/g, '&quot;')}">
    <button type="button" class="btn-icon" data-remove-field aria-label="Remove field">×</button>
  `;

  row.querySelector('[data-field-label]').addEventListener('input', (e) => {
    const keyInput = row.querySelector('[data-field-key]');
    if (!keyInput.dataset.touched) {
      keyInput.value = slugKey(e.target.value);
    }
  });

  row.querySelector('[data-field-key]').addEventListener('input', () => {
    row.querySelector('[data-field-key]').dataset.touched = '1';
  });

  row.querySelector('[data-remove-field]').addEventListener('click', () => row.remove());
  return row;
}

function renderAcfPage(pageName, fields = []) {
  const wrap = document.createElement('div');
  wrap.className = 'acf-page';
  wrap.innerHTML = `
    <div class="acf-page__head">
      <input type="text" data-page-name value="${pageName.replace(/"/g, '&quot;')}" placeholder="Page name">
      <button type="button" class="btn-icon" data-remove-page aria-label="Remove page">×</button>
    </div>
    <div class="acf-page__fields"></div>
    <button type="button" class="btn-secondary btn-small" data-add-field>Add field</button>
  `;

  const fieldsWrap = wrap.querySelector('.acf-page__fields');
  (fields.length ? fields : [{ key: '', label: '' }]).forEach((field) => {
    fieldsWrap.appendChild(createFieldRow(pageName, field));
  });

  wrap.querySelector('[data-add-field]').addEventListener('click', () => {
    fieldsWrap.appendChild(createFieldRow(wrap.querySelector('[data-page-name]').value));
  });

  wrap.querySelector('[data-remove-page]').addEventListener('click', () => wrap.remove());
  return wrap;
}

function renderAcfPages(suggestions) {
  const container = wp$('#acf-pages');
  container.innerHTML = '';

  const pages = suggestions?.pages || wpData.acfFields.pages || {};
  const pageNames = Object.keys(pages);

  if (!pageNames.length) {
    container.appendChild(renderAcfPage('Home', [
      { key: 'hero_title', label: 'Hero Title' },
      { key: 'hero_text', label: 'Hero Text' },
    ]));
    return;
  }

  pageNames.forEach((pageName) => {
    container.appendChild(renderAcfPage(pageName, pages[pageName]));
  });
}

async function loadFieldSuggestions() {
  const loading = wp$('#acf-loading');
  loading.hidden = false;

  try {
    const data = await window.themeBuilderApi('/convert/suggest-fields', {
      method: 'POST',
      body: JSON.stringify({ sessionId: wpSessionId, approvedHtml: wpApprovedHtml }),
    });
    wpData.acfFields.pages = data.suggestions?.pages || {};
    renderAcfPages(data.suggestions);
  } catch {
    renderAcfPages();
  } finally {
    loading.hidden = true;
  }
}

function syncWpFormToData() {
  const form = wp$('#wp-form');

  wpData.contentEditing = {
    editor: form.editor.value,
    clientCanChange: form.clientCanChange.value,
  };

  const types = getSelectedCptTypes();
  const typeFields = {};
  wp$all('#cpt-fields input[data-cpt]').forEach((input) => {
    typeFields[input.dataset.cpt] = input.value.trim();
  });

  wpData.customPostTypes = {
    types,
    typeFields,
    customTypeName: form.customCptName?.value.trim() || '',
  };

  wpData.acfFields.pages = readAcfPagesFromDom();

  wpData.globalOptions = {
    enabled: wpToggleState.globalOptions,
    fields: wpToggleState.globalOptions ? getWpCheckedValues('globalFields') : [],
  };

  wpData.themeType = {
    themeStyle: form.themeStyle.value,
    useGutenberg: wpToggleState.useGutenberg,
    blockSections: wpToggleState.useGutenberg ? form.blockSections.value.trim() : '',
  };

  wpData.setup = {
    themeName: form.themeName.value.trim(),
    themeVersion: form.themeVersion.value.trim() || '1.0.0',
    authorName: form.authorName.value.trim(),
    includeReadme: wpToggleState.includeReadme,
  };
}

function validateWpStep(step) {
  const form = wp$('#wp-form');
  const error = wp$('#wp-form-error');

  if (step === 1) {
    if (!form.editor.value || !form.clientCanChange.value) {
      error.textContent = 'Complete all content editing fields.';
      error.hidden = false;
      return false;
    }
  }

  if (step === 2) {
    if (wp$('#cpt-custom-check').checked && !form.customCptName.value.trim()) {
      error.textContent = 'Enter a name for your custom post type.';
      error.hidden = false;
      return false;
    }
    const types = getSelectedCptTypes();
    if (types.length) {
      const fieldInputs = wp$all('#cpt-fields input[data-cpt]');
      if (fieldInputs.some((input) => !input.value.trim())) {
        error.textContent = 'Describe fields for each selected content type.';
        error.hidden = false;
        return false;
      }
    }
  }

  if (step === 3) {
    const pages = readAcfPagesFromDom();
    const pageNames = Object.keys(pages);
    if (!pageNames.length) {
      error.textContent = 'Add at least one page with ACF fields.';
      error.hidden = false;
      return false;
    }
    if (pageNames.some((name) => !pages[name].length)) {
      error.textContent = 'Each page needs at least one field.';
      error.hidden = false;
      return false;
    }
  }

  if (step === 4) {
    if (wpToggleState.globalOptions && !getWpCheckedValues('globalFields').length) {
      error.textContent = 'Select at least one global field.';
      error.hidden = false;
      return false;
    }
  }

  if (step === 5) {
    if (!form.themeStyle.value) {
      error.textContent = 'Select a theme type.';
      error.hidden = false;
      return false;
    }
    if (wpToggleState.useGutenberg && !form.blockSections.value.trim()) {
      error.textContent = 'Describe which sections are ACF blocks vs static.';
      error.hidden = false;
      return false;
    }
  }

  if (step === 6) {
    if (!form.themeName.value.trim() || !form.authorName.value.trim()) {
      error.textContent = 'Theme name and author are required.';
      error.hidden = false;
      return false;
    }
  }

  error.hidden = true;
  return true;
}

function formatWpValue(value) {
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .map(([key, val]) => `${key}: ${Array.isArray(val) ? val.map((f) => f.label || f).join(', ') : val}`)
      .join('; ');
  }
  return value || '—';
}

function renderWpSummary() {
  syncWpFormToData();
  const dl = wp$('#wp-summary');

  const acfSummary = Object.entries(wpData.acfFields.pages)
    .map(([page, fields]) => `${page} (${fields.map((f) => f.label).join(', ')})`)
    .join('; ');

  const rows = [
    ['Editor', wpData.contentEditing.editor],
    ['Client can change', wpData.contentEditing.clientCanChange],
    ['Custom post types', wpData.customPostTypes.types.join(', ')],
    ['CPT fields', wpData.customPostTypes.typeFields],
    ['ACF page fields', acfSummary],
    ['Global options', wpData.globalOptions.enabled],
    ['Global fields', wpData.globalOptions.fields.join(', ')],
    ['Theme style', wpData.themeType.themeStyle],
    ['Use Gutenberg', wpData.themeType.useGutenberg],
    ['Block sections', wpData.themeType.blockSections],
    ['Theme name', wpData.setup.themeName],
    ['Version', wpData.setup.themeVersion],
    ['Author', wpData.setup.authorName],
    ['Include README', wpData.setup.includeReadme],
  ];

  dl.innerHTML = rows.map(([term, value]) => `<dt>${term}</dt><dd>${formatWpValue(value)}</dd>`).join('');
}

function initWpToggles() {
  wp$all('[data-wp-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.wpToggle;
      const value = btn.dataset.value === 'yes';
      wpToggleState[key] = value;
      wp$all(`[data-wp-toggle="${key}"]`).forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');

      if (key === 'globalOptions') {
        wp$('#global-fields-wrap').hidden = !value;
      }
      if (key === 'useGutenberg') {
        wp$('#block-sections-wrap').hidden = !value;
      }
    });
  });

  wp$('#cpt-custom-check')?.addEventListener('change', (e) => {
    wp$('#cpt-custom-wrap').hidden = !e.target.checked;
    renderCptFields();
  });

  wp$all('#cpt-select input[name="cpt"]').forEach((input) => {
    input.addEventListener('change', renderCptFields);
  });

  wp$('#cpt-custom-wrap input')?.addEventListener('input', renderCptFields);

  wp$('#btn-add-page-fields')?.addEventListener('click', () => {
    wp$('#acf-pages').appendChild(renderAcfPage('New Page', [{ key: '', label: '' }]));
  });
}

function initWpWizard() {
  renderWpProgress();
  initWpToggles();

  wp$('#wp-btn-back').addEventListener('click', () => {
    if (wpCurrentStep === 'summary') {
      showWpStep(6);
      return;
    }
    if (typeof wpCurrentStep === 'number' && wpCurrentStep > 1) {
      showWpStep(wpCurrentStep - 1);
    }
  });

  wp$('#wp-btn-next').addEventListener('click', async () => {
    if (!validateWpStep(wpCurrentStep)) return;
    syncWpFormToData();

    if (wpCurrentStep === 6) {
      renderWpSummary();
      showWpStep('summary');
      return;
    }

    const nextStep = wpCurrentStep + 1;
    if (nextStep === 2) renderCptFields();
    if (nextStep === 3 && !wp$('#acf-pages').children.length) {
      await loadFieldSuggestions();
    }
    showWpStep(nextStep);
  });

  wp$('#wp-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    syncWpFormToData();

    if (typeof window.submitWpData === 'function') {
      await window.submitWpData(wpData);
    }
  });
}

window.startWpDataWizard = async function startWpDataWizard({ sessionId, intakeData, approvedHtml, suggestions }) {
  wpSessionId = sessionId;
  wpIntakeData = intakeData;
  wpApprovedHtml = approvedHtml || '';

  wp$('#wp-wizard').hidden = false;

  if (suggestions) {
    wpData.acfFields.pages = suggestions.pages || {};
    renderAcfPages(suggestions);
    window.ui?.saveAppState({ fieldSuggestions: suggestions });
  }

  showWpStep(1);
};

window.getWpData = () => {
  syncWpFormToData();
  return wpData;
};

window.getWpContext = () => ({
  sessionId: wpSessionId,
  intakeData: wpIntakeData,
  approvedHtml: wpApprovedHtml,
});

document.addEventListener('DOMContentLoaded', initWpWizard);
