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

  window.tbModal = { prompt, close };
})();
