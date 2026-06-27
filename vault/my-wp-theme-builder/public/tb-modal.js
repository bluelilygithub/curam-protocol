/**
 * Simple modal — replaces window.prompt for Theme Builder forms.
 */
(function initTbModal() {
  let resolvePromise = null;
  let overlay = null;

  function ensure() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'tb-modal-overlay';
    overlay.className = 'tb-modal-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="tb-modal" role="dialog" aria-modal="true" aria-labelledby="tb-modal-title">
        <h2 class="tb-modal__title" id="tb-modal-title"></h2>
        <p class="tb-modal__hint" id="tb-modal-hint" hidden></p>
        <label class="tb-modal__field">
          <span class="tb-modal__label" id="tb-modal-label"></span>
          <input type="text" class="tb-modal__input" id="tb-modal-input" autocomplete="off">
        </label>
        <p class="form-error tb-modal__error" id="tb-modal-error" hidden></p>
        <div class="tb-modal__actions">
          <button type="button" class="btn-secondary" id="tb-modal-cancel">Cancel</button>
          <button type="button" class="btn-primary" id="tb-modal-confirm">Save</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close(null);
    });
    overlay.querySelector('#tb-modal-cancel')?.addEventListener('click', () => close(null));
    overlay.querySelector('#tb-modal-confirm')?.addEventListener('click', submit);
    overlay.querySelector('#tb-modal-input')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        close(null);
      }
    });

    return overlay;
  }

  function close(value) {
    if (!overlay) return;
    overlay.hidden = true;
    document.body.classList.remove('tb-modal-open');
    const fn = resolvePromise;
    resolvePromise = null;
    if (fn) fn(value);
  }

  function submit() {
    const input = overlay?.querySelector('#tb-modal-input');
    const errorEl = overlay?.querySelector('#tb-modal-error');
    const value = input?.value?.trim() ?? '';
    if (!value && overlay?.dataset.required === 'true') {
      if (errorEl) {
        errorEl.textContent = 'Please enter a name.';
        errorEl.hidden = false;
      }
      input?.focus();
      return;
    }
    close(value);
  }

  function prompt(options = {}) {
    const {
      title = 'Enter a name',
      label = 'Name',
      hint = '',
      defaultValue = '',
      confirmLabel = 'Save',
      required = false,
    } = options;

    ensure();
    overlay.dataset.required = required ? 'true' : 'false';

    const titleEl = overlay.querySelector('#tb-modal-title');
    const hintEl = overlay.querySelector('#tb-modal-hint');
    const labelEl = overlay.querySelector('#tb-modal-label');
    const input = overlay.querySelector('#tb-modal-input');
    const confirmBtn = overlay.querySelector('#tb-modal-confirm');
    const errorEl = overlay.querySelector('#tb-modal-error');

    if (titleEl) titleEl.textContent = title;
    if (labelEl) labelEl.textContent = label;
    if (hintEl) {
      hintEl.textContent = hint;
      hintEl.hidden = !hint;
    }
    if (confirmBtn) confirmBtn.textContent = confirmLabel;
    if (errorEl) errorEl.hidden = true;
    if (input) {
      input.value = defaultValue;
    }

    overlay.hidden = false;
    document.body.classList.add('tb-modal-open');
    requestAnimationFrame(() => {
      input?.focus();
      input?.select();
    });

    return new Promise((resolve) => {
      resolvePromise = resolve;
    });
  }

  // ——— Generic multi-field form modal ———
  let formResolve = null;
  let formOverlay = null;

  function ensureForm() {
    if (formOverlay) return formOverlay;
    formOverlay = document.createElement('div');
    formOverlay.className = 'tb-modal-overlay';
    formOverlay.hidden = true;
    formOverlay.innerHTML = `
      <div class="tb-modal tb-modal--form" role="dialog" aria-modal="true" aria-labelledby="tb-form-title">
        <h2 class="tb-modal__title" id="tb-form-title"></h2>
        <p class="tb-modal__hint" id="tb-form-hint" hidden></p>
        <div class="tb-modal__form" id="tb-form-fields"></div>
        <p class="form-error tb-modal__error" id="tb-form-error" hidden></p>
        <div class="tb-modal__actions">
          <button type="button" class="btn-secondary" id="tb-form-cancel">Cancel</button>
          <button type="button" class="btn-primary" id="tb-form-confirm">Create</button>
        </div>
      </div>`;
    document.body.appendChild(formOverlay);
    formOverlay.addEventListener('click', (event) => {
      if (event.target === formOverlay) closeForm(null);
    });
    formOverlay.querySelector('#tb-form-cancel')?.addEventListener('click', () => closeForm(null));
    return formOverlay;
  }

  function closeForm(value) {
    if (!formOverlay) return;
    formOverlay.hidden = true;
    document.body.classList.remove('tb-modal-open');
    const fn = formResolve;
    formResolve = null;
    if (fn) fn(value);
  }

  function esc(text) {
    return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderField(field) {
    const id = `tbf-${field.name}`;
    const hint = field.hint ? `<span class="tb-modal__field-hint">${esc(field.hint)}</span>` : '';
    if (field.type === 'select') {
      const opts = (field.options || []).map((o) =>
        `<option value="${esc(o.value)}"${o.value === field.default ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
      return `<label class="tb-modal__field" data-field="${field.name}" data-type="select"><span class="tb-modal__label">${esc(field.label)}</span><select id="${id}" class="tb-modal__input">${opts}</select>${hint}</label>`;
    }
    if (field.type === 'textarea') {
      return `<label class="tb-modal__field" data-field="${field.name}" data-type="textarea"><span class="tb-modal__label">${esc(field.label)}</span><textarea id="${id}" class="tb-modal__input" rows="2">${esc(field.default || '')}</textarea>${hint}</label>`;
    }
    if (field.type === 'checkbox') {
      return `<label class="tb-modal__field tb-modal__field--inline" data-field="${field.name}" data-type="checkbox"><input type="checkbox" id="${id}"${field.default ? ' checked' : ''}><span class="tb-modal__label">${esc(field.label)}</span>${hint}</label>`;
    }
    if (field.type === 'color') {
      const themeDefault = field.default == null;
      const colorVal = themeDefault ? '#ffffff' : field.default;
      return `<div class="tb-modal__field" data-field="${field.name}" data-type="color"><span class="tb-modal__label">${esc(field.label)}</span>
        <div class="tb-modal__color-row">
          <label class="tb-modal__check-inline"><input type="checkbox" class="tb-color-auto" id="${id}-auto"${themeDefault ? ' checked' : ''}> Use theme default</label>
          <input type="color" id="${id}" class="tb-color-input" value="${esc(colorVal)}"${themeDefault ? ' disabled' : ''}>
        </div>${hint}</div>`;
    }
    if (field.type === 'checklist') {
      const items = (field.options || []).map((o) =>
        `<label class="tb-modal__check-inline"><input type="checkbox" value="${esc(o.value)}"${(field.default || []).includes(o.value) ? ' checked' : ''}> ${esc(o.label)}</label>`).join('');
      return `<div class="tb-modal__field" data-field="${field.name}" data-type="checklist"><span class="tb-modal__label">${esc(field.label)}</span><div class="tb-modal__checklist">${items}</div>${hint}</div>`;
    }
    return `<label class="tb-modal__field" data-field="${field.name}" data-type="text"><span class="tb-modal__label">${esc(field.label)}</span><input type="text" id="${id}" class="tb-modal__input" value="${esc(field.default || '')}" autocomplete="off">${hint}</label>`;
  }

  function collectForm() {
    const out = {};
    formOverlay.querySelectorAll('[data-field]').forEach((node) => {
      const name = node.dataset.field;
      const type = node.dataset.type;
      if (type === 'select') out[name] = node.querySelector('select').value;
      else if (type === 'textarea') out[name] = node.querySelector('textarea').value.trim();
      else if (type === 'checkbox') out[name] = node.querySelector('input').checked;
      else if (type === 'color') {
        const auto = node.querySelector('.tb-color-auto').checked;
        out[name] = auto ? null : node.querySelector('.tb-color-input').value;
      } else if (type === 'checklist') {
        out[name] = Array.from(node.querySelectorAll('input:checked')).map((i) => i.value);
      } else out[name] = node.querySelector('input').value.trim();
    });
    return out;
  }

  function form(options = {}) {
    const { title = 'Options', hint = '', fields = [], confirmLabel = 'Create', requiredField = null } = options;
    ensureForm();

    formOverlay.querySelector('#tb-form-title').textContent = title;
    const hintEl = formOverlay.querySelector('#tb-form-hint');
    hintEl.textContent = hint;
    hintEl.hidden = !hint;
    formOverlay.querySelector('#tb-form-confirm').textContent = confirmLabel;
    const errorEl = formOverlay.querySelector('#tb-form-error');
    errorEl.hidden = true;
    formOverlay.querySelector('#tb-form-fields').innerHTML = fields.map(renderField).join('');

    formOverlay.querySelectorAll('.tb-color-auto').forEach((cb) => {
      cb.addEventListener('change', () => {
        const colorInput = cb.closest('.tb-modal__color-row').querySelector('.tb-color-input');
        colorInput.disabled = cb.checked;
      });
    });

    const confirmBtn = formOverlay.querySelector('#tb-form-confirm');
    confirmBtn.onclick = () => {
      const data = collectForm();
      if (requiredField && !String(data[requiredField] || '').trim()) {
        errorEl.textContent = 'Please complete the required field.';
        errorEl.hidden = false;
        return;
      }
      closeForm(data);
    };

    formOverlay.hidden = false;
    document.body.classList.add('tb-modal-open');

    return new Promise((resolve) => {
      formResolve = resolve;
    });
  }

  window.tbModal = { prompt, form, close };
})();
