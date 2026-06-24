/**
 * In-preview element picker — selects the exact clicked element for iteration.
 * Elements without an id get a stable tb-pick-* id stamped into saved HTML.
 */
(function initPreviewPicker() {
  const STYLE_ID = 'tb-picker-styles';
  const SKIP_SELECTOR = '#tb-baseline, #tb-ensured, #tb-nav-styles, #tb-components, #tb-region-tooltip, style, script';

  function isPreviewChromeId(id) {
    return /^tb-(?:baseline|ensured|nav-styles|components|wireframe-chrome|iterate-overrides)$/i.test(id);
  }

  function hasPickId(el) {
    const id = el?.id?.trim();
    return Boolean(id && !isPreviewChromeId(id));
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .tb-picker-active * { cursor: crosshair !important; }
      .tb-labels-active * { cursor: help !important; }
      .tb-picker-highlight { outline: 2px solid #2563eb !important; outline-offset: 2px !important; }
      .tb-picker-selected { outline: 2px solid #16a34a !important; outline-offset: 2px !important; }
      .tb-label-hover { outline: 2px solid #2563eb !important; outline-offset: 1px !important; background: rgba(37, 99, 235, 0.06) !important; }
      #tb-region-tooltip {
        position: absolute;
        z-index: 99999;
        max-width: min(92vw, 28rem);
        padding: 0.45rem 0.6rem;
        font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
        color: #fff;
        background: rgba(15, 23, 42, 0.94);
        border-radius: 6px;
        pointer-events: none;
        box-shadow: 0 4px 16px rgba(0,0,0,0.3);
        white-space: normal;
      }
      #tb-region-tooltip.tb-tip-copyable {
        pointer-events: auto;
        cursor: copy;
      }
      #tb-region-tooltip .tb-tip-path { color: #93c5fd; display: block; margin-bottom: 0.2rem; }
      #tb-region-tooltip .tb-tip-target { color: #86efac; font-size: 10px; display: block; }
      #tb-region-tooltip .tb-tip-copy { color: #cbd5e1; font-size: 10px; margin-top: 0.25rem; display: block; }
      #tb-region-tooltip[hidden] { display: none !important; }
    `;
    document.head.appendChild(style);
  }

  function isInspectable(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    const tag = el.tagName;
    if (tag === 'HTML' || tag === 'HEAD' || tag === 'STYLE' || tag === 'SCRIPT') return false;
    if (el.closest(SKIP_SELECTOR)) return false;
    return true;
  }

  function pickExact(rawEl) {
    let el = rawEl;
    while (el && !isInspectable(el)) {
      el = el.parentElement;
    }
    return el || null;
  }

  function formatSelector(el) {
    if (!el) return '';
    const tag = el.tagName.toLowerCase();
    const classes = [...el.classList]
      .filter((c) => !c.startsWith('tb-label') && !c.startsWith('tb-picker'))
      .slice(0, 3)
      .map((c) => `.${c}`)
      .join('');
    return `${tag}${classes}` || tag;
  }

  function formatNodeDisplay(el) {
    if (!el) return '';
    if (hasPickId(el)) return `#${el.id.trim()}`;
    const selector = formatSelector(el);
    const onlyText = el.children.length === 0 && (el.textContent || '').trim();
    if (onlyText) {
      const text = el.textContent.trim().replace(/\s+/g, ' ').slice(0, 36);
      return `${selector} “${text}”`;
    }
    return selector;
  }

  function findAnchorElement(el) {
    let node = el.parentElement;
    while (node && node !== document.body) {
      if (hasPickId(node)) return node;
      node = node.parentElement;
    }
    return null;
  }

  function makePickId() {
    return `tb-pick-${Math.random().toString(36).slice(2, 8)}`;
  }

  function isPickId(id) {
    return /^tb-pick-[a-z0-9]{4,12}$/i.test(String(id || '').trim());
  }

  function buildLocator(el, anchor) {
    const steps = [];
    let node = el;
    while (node && node !== anchor) {
      const parent = node.parentElement;
      if (!parent) return null;
      steps.unshift({
        tag: node.tagName.toLowerCase(),
        classList: [...node.classList].filter((c) => !c.startsWith('tb-')).sort(),
        childIndex: [...parent.children].indexOf(node),
      });
      node = parent;
    }
    return node === anchor ? steps : null;
  }

  function buildPickMeta(el) {
    if (!el) return null;

    if (hasPickId(el) && !isPickId(el.id)) {
      const id = el.id.trim();
      return {
        el,
        id,
        label: el.getAttribute('aria-label') || id,
        tag: el.tagName.toLowerCase(),
        display: `#${id}`,
        needsStamp: false,
      };
    }

    const anchor = isPickId(el.id) ? findAnchorElement(el) : (findAnchorElement(el) || (hasPickId(el) ? null : null));
    if (!anchor) return null;

    const locator = buildLocator(el, anchor);
    if (!locator?.length) return null;

    const id = isPickId(el.id) ? el.id.trim() : null;

    return {
      el,
      id,
      label: id ? (el.getAttribute('aria-label') || id) : formatNodeDisplay(el),
      tag: el.tagName.toLowerCase(),
      display: id ? `#${id}` : formatNodeDisplay(el),
      needsStamp: true,
      anchorId: anchor.id.trim(),
      locator,
      childPath: locator.map((step) => step.childIndex),
    };
  }

  function inspectAt(rawEl) {
    return buildPickMeta(pickExact(rawEl));
  }

  function confirmPickTarget(rawEl) {
    const info = buildPickMeta(pickExact(rawEl));
    if (!info) return null;

    if (!info.id) {
      const id = makePickId();
      info.el.id = id;
      info.id = id;
      info.display = `#${id}`;
    }

    info.needsStamp = true;
    return info;
  }

  let pickEnabled = false;
  let labelsEnabled = false;
  let highlightEl = null;
  let labelEl = null;
  let selectedEl = null;
  let tooltip = null;
  let lastHoverInfo = null;

  function targetPayload(info) {
    return {
      id: info.id,
      label: info.label,
      tag: info.tag,
      focus: null,
      focusPath: info.display,
      needsStamp: Boolean(info.needsStamp),
      anchorId: info.anchorId || null,
      locator: info.locator || null,
      childPath: info.childPath || (info.locator ? info.locator.map((step) => step.childIndex) : null),
    };
  }

  function iterateRef(info) {
    return info?.id ? `#${info.id}` : '';
  }

  function copyText(text) {
    if (!text) return Promise.reject(new Error('empty'));
    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy') ? resolve() : reject(new Error('copy failed'));
      } catch (err) {
        reject(err);
      } finally {
        document.body.removeChild(ta);
      }
    });
  }

  function postIterateRefCopied(info) {
    const ref = iterateRef(info);
    window.parent.postMessage({
      type: 'tb-target-copied',
      ref,
      copyRef: ref,
      regionId: info.id,
      target: targetPayload(info),
    }, '*');
  }

  function copyIterateRef(info) {
    const copyRef = iterateRef(info);
    return copyText(copyRef).then(() => {
      postIterateRefCopied(info);
      return copyRef;
    });
  }

  function ensureTooltip() {
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = 'tb-region-tooltip';
      tooltip.hidden = true;
      tooltip.addEventListener('click', (event) => {
        if (!labelsEnabled || !lastHoverInfo) return;
        event.preventDefault();
        event.stopPropagation();
        if (needsPersistPick(lastHoverInfo) || pickEnabled) {
          const info = confirmPickTarget(lastHoverInfo.el);
          if (info) postTargetSelected(info);
          return;
        }
        copyIterateRef(lastHoverInfo);
      });
      document.body.appendChild(tooltip);
    }
    return tooltip;
  }

  function clearHighlight() {
    if (highlightEl) {
      highlightEl.classList.remove('tb-picker-highlight');
      highlightEl = null;
    }
  }

  function clearLabelHover() {
    if (labelEl) {
      labelEl.classList.remove('tb-label-hover');
      labelEl = null;
    }
  }

  function hideTooltip() {
    if (tooltip) tooltip.hidden = true;
  }

  function showTooltip(info) {
    const tip = ensureTooltip();
    const path = info.display || formatNodeDisplay(info.el);
    const targetLine = info.id
      ? `Target: #${info.id}`
      : 'Click to select this element';
    const copyLine = labelsEnabled
      ? (needsPersistPick(info) ? 'Click to select this element' : 'Click to copy target id')
      : '';
    tip.innerHTML = `<span class="tb-tip-path">${path}</span><span class="tb-tip-target">${targetLine}</span>${copyLine ? `<span class="tb-tip-copy">${copyLine}</span>` : ''}`;
    tip.classList.toggle('tb-tip-copyable', labelsEnabled);
    tip.hidden = false;
    const rect = info.el.getBoundingClientRect();
    let top = rect.top + window.scrollY - tip.offsetHeight - 8;
    let left = rect.left + window.scrollX;
    if (top < window.scrollY + 8) top = rect.bottom + window.scrollY + 8;
    if (left + tip.offsetWidth > window.scrollX + window.innerWidth - 8) {
      left = window.scrollX + window.innerWidth - tip.offsetWidth - 8;
    }
    tip.style.top = `${Math.max(8, top)}px`;
    tip.style.left = `${Math.max(8, left)}px`;
  }

  function setSelected(el) {
    if (selectedEl) selectedEl.classList.remove('tb-picker-selected');
    selectedEl = el;
    if (selectedEl) selectedEl.classList.add('tb-picker-selected');
  }

  function onMouseMove(event) {
    if (!pickEnabled && !labelsEnabled) return;

    const info = inspectAt(event.target);
    clearLabelHover();
    hideTooltip();

    if (!info) {
      if (pickEnabled) clearHighlight();
      return;
    }

    if (labelsEnabled) {
      lastHoverInfo = info;
      labelEl = info.el;
      labelEl.classList.add('tb-label-hover');
      showTooltip(info);
    }

    if (pickEnabled) {
      clearHighlight();
      highlightEl = info.el;
      highlightEl.classList.add('tb-picker-highlight');
    }
  }

  function onMouseLeave() {
    clearLabelHover();
    hideTooltip();
    lastHoverInfo = null;
    if (!pickEnabled) return;
    clearHighlight();
  }

  function needsPersistPick(info) {
    if (!info) return false;
    if (info.needsStamp) return true;
    return /^tb-pick-/i.test(info.id || '');
  }

  function postTargetSelected(info) {
    window.parent.postMessage({
      type: 'tb-target-selected',
      target: targetPayload(info),
    }, '*');
  }

  function onClick(event) {
    if (!labelsEnabled && !pickEnabled) return;

    const info = confirmPickTarget(event.target);
    if (!info) return;

    event.preventDefault();
    event.stopPropagation();

    if (pickEnabled) {
      setSelected(info.el);
    }

    if (pickEnabled || needsPersistPick(info)) {
      postTargetSelected(info);
      return;
    }

    copyIterateRef(info);
  }

  function syncBodyClasses() {
    document.body.classList.toggle('tb-picker-active', pickEnabled);
    document.body.classList.toggle('tb-labels-active', labelsEnabled);
    if (!pickEnabled && !labelsEnabled) {
      clearHighlight();
      clearLabelHover();
      hideTooltip();
    }
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && pickEnabled) {
      pickEnabled = false;
      syncBodyClasses();
      if (selectedEl) selectedEl.classList.remove('tb-picker-selected');
      selectedEl = null;
      clearHighlight();
      window.parent.postMessage({ type: 'tb-picker-cancelled' }, '*');
    }
  });

  window.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.type === 'tb-picker') {
      pickEnabled = Boolean(data.enabled);
      syncBodyClasses();
      if (!pickEnabled && selectedEl) {
        selectedEl.classList.remove('tb-picker-selected');
        selectedEl = null;
        clearHighlight();
      }
    }
    if (data.type === 'tb-labels') {
      labelsEnabled = Boolean(data.enabled);
      syncBodyClasses();
    }
    if (data.type === 'tb-picker-clear') {
      if (selectedEl) selectedEl.classList.remove('tb-picker-selected');
      selectedEl = null;
      clearHighlight();
    }
    if (data.type === 'tb-picker-select' && data.id) {
      const el = document.getElementById(data.id);
      if (el) {
        const info = confirmPickTarget(el);
        if (!info) return;
        setSelected(info.el);
        window.parent.postMessage({
          type: 'tb-target-selected',
          target: targetPayload(info),
        }, '*');
      }
    }
  });

  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('mouseleave', onMouseLeave, true);
  document.addEventListener('click', onClick, true);
  injectStyles();
})();
