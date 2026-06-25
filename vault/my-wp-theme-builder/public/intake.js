/**
 * Multi-step intake wizard — builds intakeData and submits to /generate/html
 */

const DEFAULT_PAGES = ['Home', 'About', 'Services', 'Blog', 'Portfolio', 'Contact'];

const INTAKE_STEPS = [
  { id: 1, label: 'Purpose' },
  { id: 2, label: 'Inspiration' },
  { id: 3, label: 'Brand' },
  { id: 4, label: 'Functionality' },
  { id: 'summary', label: 'Review' },
];

const intakeData = {
  purpose: {
    siteFor: '',
    targetAudience: '',
    primaryAction: '',
  },
  inspiration: {
    urls: [],
    likes: '',
    dislikes: '',
    feelWords: '',
  },
  brand: {
    hasLogo: false,
    primaryColor: '',
    headingColor: '',
    bodyColor: '',
    altSectionColor: '',
    aiChooseColors: false,
    headingFont: '',
    bodyFont: '',
    aiChooseFonts: false,
  },
  structure: {
    pages: [...DEFAULT_PAGES],
    pageSections: {},
  },
  content: {
    copyReady: false,
    imagesReady: false,
    updatedBy: 'Non-technical client',
  },
  functionality: [],
};

const toggleState = {
  hasLogo: false,
};

let currentStep = 1;

function $(selector, root = document) {
  return root.querySelector(selector);
}

function $all(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

function stepIndex(stepId) {
  return INTAKE_STEPS.findIndex((step) => step.id === stepId);
}

function clearFormError() {
  const error = $('#form-error');
  if (error) {
    error.hidden = true;
    error.textContent = '';
  }
}

function showFormError(message) {
  const error = $('#form-error');
  if (!error) return;
  error.textContent = message;
  error.hidden = false;
}

function renderProgress() {
  const list = $('#step-progress');
  if (!list) return;

  const currentIdx = stepIndex(currentStep);

  list.innerHTML = INTAKE_STEPS.map((step, index) => {
    const active = step.id === currentStep ? ' is-active' : '';
    const done = index < currentIdx ? ' is-done' : '';
    return `<li class="step-progress__item is-clickable${active}${done}" data-step="${step.id}" tabindex="0" role="button" aria-current="${step.id === currentStep ? 'step' : 'false'}">${step.label}</li>`;
  }).join('');
}

function showStep(step) {
  currentStep = step;

  $all('.intake-step').forEach((el) => {
    el.classList.toggle('is-step-hidden', el.dataset.step !== String(step));
  });

  $('#btn-back').hidden = step === 1;
  $('#btn-next').hidden = step === 'summary';
  $('#btn-submit').hidden = step !== 'summary';
  clearFormError();
  renderProgress();
  window.ui?.setAppStage('brief');
  window.inspector?.logWizard('step', step);
}

function getIntakeCheckedValues(name) {
  const form = $('#intake-form');
  if (!form) return [];
  return $all(`input[name="${name}"]:checked`, form).map((el) => el.value);
}

function readFunctionalityFromForm() {
  return getIntakeCheckedValues('functionality');
}

const FUNC_STORAGE_KEY = 'wpThemeBuilderFunctionality';

function persistFunctionality() {
  const selected = readFunctionalityFromForm();
  intakeData.functionality = selected;
  try {
    sessionStorage.setItem(FUNC_STORAGE_KEY, JSON.stringify(selected));
  } catch {
    // ignore
  }
  return selected;
}

function restoreFunctionalityFromStorage() {
  try {
    const raw = sessionStorage.getItem(FUNC_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function resolveFunctionalityForSubmit() {
  syncFormToIntakeData();
  let selected = readFunctionalityFromForm();
  if (!selected.length && intakeData.functionality.length) {
    selected = [...intakeData.functionality];
  }
  if (!selected.length) {
    selected = restoreFunctionalityFromStorage();
  }
  intakeData.functionality = selected;
  return selected;
}

function formField(name) {
  return $('#intake-form')?.elements.namedItem(name);
}

function setFontPickersDisabled(disabled) {
  const pickers = $('#font-pickers');
  const heading = $('#heading-font-select');
  const body = $('#body-font-select');

  if (pickers) pickers.classList.toggle('is-disabled', disabled);
  if (heading) heading.disabled = disabled;
  if (body) body.disabled = disabled;
}

function syncFormToIntakeData() {
  const form = $('#intake-form');

  intakeData.purpose = {
    siteFor: form.siteFor.value,
    targetAudience: form.targetAudience.value.trim(),
    primaryAction: form.primaryAction.value.trim(),
  };

  intakeData.inspiration = {
    urls: [form.inspirationUrl1, form.inspirationUrl2, form.inspirationUrl3]
      .map((el) => el.value.trim())
      .filter(Boolean),
    likes: form.inspirationLikes.value.trim(),
    dislikes: form.inspirationDislikes.value.trim(),
    feelWords: form.feelWords.value.trim(),
  };

  const aiChooseColors = form.aiChooseColors?.checked || false;
  intakeData.brand = {
    hasLogo: toggleState.hasLogo,
    primaryColor: form.primaryColor.value,
    headingColor: aiChooseColors ? '' : (form.headingColor?.value || ''),
    bodyColor: aiChooseColors ? '' : (form.bodyColor?.value || ''),
    altSectionColor: aiChooseColors ? '' : (form.altSectionColor?.value || ''),
    aiChooseColors,
    headingFont: form.aiChooseFonts.checked ? '' : form.headingFont.value,
    bodyFont: form.aiChooseFonts.checked ? '' : form.bodyFont.value,
    aiChooseFonts: form.aiChooseFonts.checked,
  };

  intakeData.structure = {
    pages: [...DEFAULT_PAGES],
    pageSections: {},
  };

  intakeData.content = {
    copyReady: false,
    imagesReady: false,
    updatedBy: 'Non-technical client',
  };

  intakeData.functionality = readFunctionalityFromForm();
  if (intakeData.functionality.length) {
    try {
      sessionStorage.setItem(FUNC_STORAGE_KEY, JSON.stringify(intakeData.functionality));
    } catch {
      // ignore
    }
  }
}

function formatBrandFonts(brand) {
  if (brand.aiChooseFonts) return 'AI to choose';
  const parts = [];
  if (brand.headingFont) parts.push(`Heading: ${brand.headingFont}`);
  if (brand.bodyFont) parts.push(`Body: ${brand.bodyFont}`);
  if (!parts.length && brand.fonts) return brand.fonts;
  return parts.length ? parts.join('; ') : '—';
}

function validateStep(step) {
  const form = $('#intake-form');

  if (step === 1) {
    if (!form.siteFor.value || !form.targetAudience.value.trim() || !form.primaryAction.value.trim()) {
      showFormError('Please complete all purpose fields.');
      window.inspector?.logWizard('validation failed', { step, reason: 'purpose incomplete' });
      return false;
    }
  }

  clearFormError();
  return true;
}

function navigateToStep(targetStep) {
  if (targetStep === currentStep) return;

  const currentIdx = stepIndex(currentStep);
  const targetIdx = stepIndex(targetStep);
  if (targetIdx === -1) return;

  if (targetIdx > currentIdx) {
    for (let i = currentIdx; i < targetIdx; i += 1) {
      const stepId = INTAKE_STEPS[i].id;
      if (!validateStep(stepId)) return;
      syncFormToIntakeData();
    }
  } else {
    syncFormToIntakeData();
  }

  if (targetStep === 'summary') {
    renderSummary();
  }

  showStep(targetStep);
}

function formatSummaryValue(value) {
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .map(([key, val]) => `${key}: ${val}`)
      .join('; ');
  }
  return value || '—';
}

function renderSummary() {
  syncFormToIntakeData();
  const dl = $('#intake-summary');

  const rows = [
    ['Site for', intakeData.purpose.siteFor],
    ['Target audience', intakeData.purpose.targetAudience],
    ['Primary visitor action', intakeData.purpose.primaryAction],
    ['Inspiration URLs', intakeData.inspiration.urls.join(', ')],
    ['Likes', intakeData.inspiration.likes],
    ['Dislikes', intakeData.inspiration.dislikes],
    ['Feel (3 words)', intakeData.inspiration.feelWords],
    ['Has logo', intakeData.brand.hasLogo],
    ['Primary color', intakeData.brand.primaryColor],
    ['Colors', intakeData.brand.aiChooseColors
      ? 'AI to choose'
      : [
          intakeData.brand.headingColor && `Heading ${intakeData.brand.headingColor}`,
          intakeData.brand.bodyColor && `Body ${intakeData.brand.bodyColor}`,
          intakeData.brand.altSectionColor && `Alt section ${intakeData.brand.altSectionColor}`,
        ].filter(Boolean).join(', ')],
    ['Fonts', formatBrandFonts(intakeData.brand)],
    ['Pages', `${intakeData.structure.pages.join(', ')} (standard)`],
    ['Content', 'Placeholder copy & images — updated by non-technical client in WordPress'],
    ['Functionality', intakeData.functionality.length
      ? intakeData.functionality.join(', ')
      : 'None selected — tick features on the Functionality step'],
  ];

  dl.innerHTML = rows
    .map(([term, value]) => `<dt>${term}</dt><dd>${formatSummaryValue(value)}</dd>`)
    .join('');
}

function initToggles() {
  $all('.toggle__btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.toggle;
      const value = btn.dataset.value === 'yes';
      toggleState[key] = value;
      $all(`.toggle__btn[data-toggle="${key}"]`).forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
    });
  });

  window.googleFonts?.initGoogleFontPickers();

  $('#ai-choose-fonts').addEventListener('change', (e) => {
    setFontPickersDisabled(e.target.checked);
  });

  $('#functionality-select')?.addEventListener('change', persistFunctionality);
  $('#functionality-select')?.addEventListener('input', persistFunctionality);
}

function initStepProgressNav() {
  const list = $('#step-progress');
  if (!list) return;

  list.addEventListener('click', (event) => {
    const item = event.target.closest('[data-step]');
    if (!item) return;
    const step = item.dataset.step === 'summary' ? 'summary' : Number(item.dataset.step);
    navigateToStep(step);
  });

  list.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const item = event.target.closest('[data-step]');
    if (!item) return;
    event.preventDefault();
    const step = item.dataset.step === 'summary' ? 'summary' : Number(item.dataset.step);
    navigateToStep(step);
  });
}

function normalizeInspirationUrl(input) {
  const trimmed = input.value.trim();
  if (!trimmed) return;
  if (!/^https?:\/\//i.test(trimmed)) {
    input.value = `https://${trimmed}`;
  }
}

function initIntakeWizard() {
  initToggles();
  initStepProgressNav();
  showStep(1);
  window.inspector?.logWizard('initialized', { steps: INTAKE_STEPS.length });

  ['inspirationUrl1', 'inspirationUrl2', 'inspirationUrl3'].forEach((name) => {
    formField(name)?.addEventListener('blur', (e) => normalizeInspirationUrl(e.target));
  });

  $('#btn-back').addEventListener('click', () => {
    if (currentStep === 'summary') {
      navigateToStep(4);
      return;
    }
    if (typeof currentStep === 'number' && currentStep > 1) {
      navigateToStep(currentStep - 1);
    }
  });

  $('#btn-next').addEventListener('click', () => {
    if (!validateStep(currentStep)) return;
    syncFormToIntakeData();

    if (currentStep === 4) {
      renderSummary();
      showStep('summary');
      return;
    }

    showStep(currentStep + 1);
  });

  $('#intake-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const selected = resolveFunctionalityForSubmit();

    window.inspector?.logWizard('submit', {
      pages: intakeData.structure.pages,
      inspirationUrls: intakeData.inspiration.urls,
      functionality: intakeData.functionality,
    });

    if (typeof window.submitIntake === 'function') {
      await window.submitIntake(intakeData);
    } else {
      window.inspector?.log('submitIntake missing — hard refresh required');
    }
  });
}

window.getIntakeData = () => {
  resolveFunctionalityForSubmit();
  return intakeData;
};

window.DEFAULT_PAGES = DEFAULT_PAGES;

document.addEventListener('DOMContentLoaded', initIntakeWizard);
