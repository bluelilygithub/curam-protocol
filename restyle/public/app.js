(() => {
  'use strict';

  // ---------- Plain-English copy for every style property ----------
  // No CSS jargon is shown anywhere in the UI — this is the single source of truth mapping
  // a JS style property name to the sentence fragment used in the change log.
  const PLAIN = {
    fontFamily: 'the font',
    fontSize: 'the text size',
    fontWeight: 'how bold the text is',
    color: 'the text color',
    lineHeight: 'the spacing between lines of text',
    backgroundColor: 'the background color',
    borderRadius: 'the rounded corners',
    padding: 'the space around the content',
    boxShadow: 'the shadow',
  };

  // ---------- State ----------
  const state = {
    sanitizedHead: '',
    sanitizedBody: '',
    htmlLoaded: false,
    mergedCss: '',
    cssEntries: [], // { id, filename, css, source: 'file'|'paste' }
    selectedEl: null,
    undoStack: [], // { property, previousValue } — element is closed over via selectedEl ref stored per-entry
    fontsLinked: false,
  };

  // ---------- Small DOM helpers ----------
  const $ = sel => document.querySelector(sel);
  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v);
    });
    children.forEach(c => node.appendChild(c));
    return node;
  };

  function setStatus(elid, message, kind) {
    const node = $(elid);
    node.textContent = message || '';
    node.className = 'status-line' + (kind ? ' ' + kind : '');
  }

  function addLogEntry(text) {
    const li = document.createElement('li');
    li.textContent = text;
    $('#changeLog').prepend(li);
  }

  function addFlags(flags) {
    if (!flags || !flags.length) return;
    const block = $('#flagsBlock');
    const list = $('#flagsList');
    flags.forEach(f => {
      const li = document.createElement('li');
      li.textContent = f;
      list.appendChild(li);
    });
    block.hidden = false;
  }

  // ---------- Tabs ----------
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const group = tab.closest('.block');
      group.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      group.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      group.querySelector(`[data-tab-content="${tab.dataset.tab}"]`).classList.add('active');
    });
  });

  // ---------- HTML input ----------
  let currentRawHtml = null;

  async function submitHtml(payload) {
    setStatus('#htmlStatus', 'Reading your page…');
    try {
      const res = await fetch('/api/upload-html', payload.isFormData
        ? { method: 'POST', body: payload.body }
        : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload.body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong reading your HTML.');
      state.sanitizedHead = data.headInnerHTML;
      state.sanitizedBody = data.bodyInnerHTML;
      state.htmlLoaded = true;
      (data.changeLog || []).forEach(addLogEntry);
      setStatus('#htmlStatus', 'Your page is ready.', 'ok');
      maybeEnableBuild();
    } catch (err) {
      setStatus('#htmlStatus', err.message, 'error');
    }
  }

  const htmlDropzone = $('#htmlDropzone');
  const htmlFileInput = $('#htmlFileInput');
  htmlDropzone.addEventListener('click', () => htmlFileInput.click());
  htmlDropzone.addEventListener('dragover', e => { e.preventDefault(); htmlDropzone.classList.add('dragover'); });
  htmlDropzone.addEventListener('dragleave', () => htmlDropzone.classList.remove('dragover'));
  htmlDropzone.addEventListener('drop', e => {
    e.preventDefault();
    htmlDropzone.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handleHtmlFile(e.dataTransfer.files[0]);
  });
  htmlFileInput.addEventListener('change', () => {
    if (htmlFileInput.files[0]) handleHtmlFile(htmlFileInput.files[0]);
  });
  function handleHtmlFile(file) {
    const fd = new FormData();
    fd.append('file', file);
    submitHtml({ isFormData: true, body: fd });
  }

  $('#useHtmlPasteBtn').addEventListener('click', () => {
    const html = $('#htmlPasteArea').value;
    if (!html.trim()) { setStatus('#htmlStatus', 'Paste some HTML first.', 'error'); return; }
    submitHtml({ isFormData: false, body: { html } });
  });

  // ---------- CSS input ----------
  let cssIdCounter = 0;

  function renderCssList() {
    const list = $('#cssList');
    list.innerHTML = '';
    state.cssEntries.forEach((entry, i) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = entry.filename;
      li.appendChild(name);

      const up = document.createElement('button');
      up.textContent = '↑';
      up.title = 'Move earlier (lower priority)';
      up.disabled = i === 0;
      up.addEventListener('click', () => { swap(i, i - 1); });
      li.appendChild(up);

      const down = document.createElement('button');
      down.textContent = '↓';
      down.title = 'Move later (higher priority)';
      down.disabled = i === state.cssEntries.length - 1;
      down.addEventListener('click', () => { swap(i, i + 1); });
      li.appendChild(down);

      const remove = document.createElement('button');
      remove.textContent = '✕';
      remove.title = 'Remove';
      remove.addEventListener('click', () => {
        state.cssEntries.splice(i, 1);
        renderCssList();
      });
      li.appendChild(remove);

      list.appendChild(li);
    });
    maybeEnableBuild();
  }

  function swap(i, j) {
    const arr = state.cssEntries;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    renderCssList();
  }

  function addCssFiles(files) {
    [...files].forEach(file => {
      if (!file.name.toLowerCase().endsWith('.css')) return;
      const reader = new FileReader();
      reader.onload = () => {
        state.cssEntries.push({ id: ++cssIdCounter, filename: file.name, css: reader.result, source: 'file' });
        renderCssList();
      };
      reader.readAsText(file);
    });
  }

  const cssDropzone = $('#cssDropzone');
  const cssFileInput = $('#cssFileInput');
  cssDropzone.addEventListener('click', () => cssFileInput.click());
  cssDropzone.addEventListener('dragover', e => { e.preventDefault(); cssDropzone.classList.add('dragover'); });
  cssDropzone.addEventListener('dragleave', () => cssDropzone.classList.remove('dragover'));
  cssDropzone.addEventListener('drop', e => {
    e.preventDefault();
    cssDropzone.classList.remove('dragover');
    addCssFiles(e.dataTransfer.files);
  });
  cssFileInput.addEventListener('change', () => addCssFiles(cssFileInput.files));

  $('#useCssPasteBtn').addEventListener('click', () => {
    const css = $('#cssPasteArea').value;
    if (!css.trim()) { setStatus('#cssStatus', 'Paste some styles first.', 'error'); return; }
    const name = $('#cssPasteName').value.trim() || `Pasted styles ${state.cssEntries.length + 1}`;
    state.cssEntries.push({ id: ++cssIdCounter, filename: name, css, source: 'paste' });
    $('#cssPasteArea').value = '';
    $('#cssPasteName').value = '';
    renderCssList();
  });

  function maybeEnableBuild() {
    $('#rebuildBtn').disabled = !(state.htmlLoaded && state.cssEntries.length);
  }

  // ---------- Build / rebuild preview ----------
  $('#rebuildBtn').addEventListener('click', buildPreview);

  async function buildPreview() {
    if (!state.htmlLoaded) {
      setStatus('#cssStatus', 'Add your HTML first.', 'error');
      return;
    }
    if (!state.cssEntries.length) {
      setStatus('#cssStatus', 'Add at least one style file first.', 'error');
      return;
    }
    setStatus('#cssStatus', 'Checking your styles…');
    try {
      const fd = new FormData();
      const pasted = [];
      state.cssEntries.forEach(entry => {
        if (entry.source === 'file') {
          fd.append('files', new Blob([entry.css], { type: 'text/css' }), entry.filename);
        } else {
          pasted.push({ filename: entry.filename, css: entry.css });
        }
      });
      fd.append('pasted', JSON.stringify(pasted));
      fd.append('order', JSON.stringify(state.cssEntries.map(e => e.filename)));

      const res = await fetch('/api/process-css', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong checking your styles.');

      state.mergedCss = data.css;
      (data.changeLog || []).forEach(addLogEntry);
      addFlags(data.flags);
      setStatus('#cssStatus', 'Your preview is ready below.', 'ok');
      renderIframe();
      $('#exportBtn').disabled = false;
    } catch (err) {
      setStatus('#cssStatus', err.message, 'error');
    }
  }

  // Outline styles for hover/selected states are injected as a SEPARATE <style> tag, never
  // merged into the user's own CSS — so nothing about their actual design is touched by them.
  const OUTLINE_CSS = `
    [data-restyle-hover] { outline: 2px dashed #3b82f6 !important; outline-offset: 1px; cursor: pointer; }
    [data-restyle-selected] { outline: 2px solid #cc785c !important; outline-offset: 1px; }
  `;

  function renderIframe() {
    // Rebuilding replaces the iframe's document entirely, so any previously selected element or
    // pending undo entries would point at now-detached nodes — reset both to avoid stale state.
    state.selectedEl = null;
    state.undoStack = [];
    $('#undoBtn').disabled = true;
    $('#propertyPanel').hidden = true;
    $('#aiRequestArea').disabled = true;
    $('#aiRequestBtn').disabled = true;
    $('#selectionLabel').textContent = 'Click anything in your page below to start editing it.';

    const frame = $('#previewFrame');
    const doc = `<!DOCTYPE html><html><head>${state.sanitizedHead}<style id="restyle-merged-css">${state.mergedCss}</style></head><body>${state.sanitizedBody}</body></html>`;
    frame.srcdoc = doc;
    $('#previewEmpty').hidden = true;
    frame.onload = () => attachIframeInteractivity(frame);
  }

  function attachIframeInteractivity(frame) {
    const idoc = frame.contentDocument;
    if (!idoc) return;

    // Own style tag for hover/selection outlines — kept entirely separate from the merged
    // stylesheet above so the user's own CSS is never mutated to show selection state.
    const outlineStyle = idoc.createElement('style');
    outlineStyle.id = 'restyle-outline-css';
    outlineStyle.textContent = OUTLINE_CSS;
    idoc.head.appendChild(outlineStyle);

    let hovered = null;
    idoc.body.addEventListener('mouseover', e => {
      if (hovered) hovered.removeAttribute('data-restyle-hover');
      hovered = e.target;
      if (hovered && hovered !== idoc.body) hovered.setAttribute('data-restyle-hover', '');
    });
    idoc.body.addEventListener('mouseout', e => {
      if (e.target) e.target.removeAttribute('data-restyle-hover');
    });
    idoc.body.addEventListener('click', e => {
      e.preventDefault();
      selectElement(e.target, idoc);
    });
  }

  // ---------- Selection + property panel ----------
  function selectElement(target, idoc) {
    if (state.selectedEl) state.selectedEl.removeAttribute('data-restyle-selected');
    if (target === idoc.body) {
      state.selectedEl = null;
      $('#selectionLabel').textContent = 'Click anything in your page below to start editing it.';
      $('#propertyPanel').hidden = true;
      $('#aiRequestArea').disabled = true;
      $('#aiRequestBtn').disabled = true;
      return;
    }
    target.setAttribute('data-restyle-selected', '');
    state.selectedEl = target;

    const label = target.tagName.toLowerCase() + (target.className ? '.' + [...target.classList].filter(c => !c.startsWith('data-restyle')).join('.') : '');
    $('#selectionLabel').textContent = `Editing: ${label}`;

    $('#propertyPanel').hidden = false;
    $('#aiRequestArea').disabled = false;
    $('#aiRequestBtn').disabled = false;

    populateControlsFromComputed(target);
  }

  function populateControlsFromComputed(target) {
    const cs = target.ownerDocument.defaultView.getComputedStyle(target);
    suppressControlEvents = true;
    $('#ctrlFontFamily').value = matchFontOption(cs.fontFamily);
    $('#ctrlFontSize').value = parseFloat(cs.fontSize) || 16;
    $('#ctrlFontSizeValue').textContent = Math.round(parseFloat(cs.fontSize) || 16) + 'px';
    $('#ctrlFontWeight').value = normalizeWeight(cs.fontWeight);
    $('#ctrlColor').value = toHex(cs.color) || '#000000';
    const lh = parseLineHeight(cs.lineHeight, cs.fontSize);
    $('#ctrlLineHeight').value = lh;
    $('#ctrlLineHeightValue').textContent = lh;
    $('#ctrlBackgroundColor').value = toHex(cs.backgroundColor) || '#ffffff';
    $('#ctrlBorderRadius').value = parseFloat(cs.borderRadius) || 0;
    $('#ctrlBorderRadiusValue').textContent = Math.round(parseFloat(cs.borderRadius) || 0) + 'px';
    $('#ctrlPadding').value = parseFloat(cs.paddingTop) || 0;
    $('#ctrlPaddingValue').textContent = Math.round(parseFloat(cs.paddingTop) || 0) + 'px';
    $('#ctrlBoxShadow').value = cs.boxShadow && cs.boxShadow !== 'none' ? 'custom-existing' : 'none';
    if (![...$('#ctrlBoxShadow').options].some(o => o.value === 'custom-existing')) {
      const opt = document.createElement('option');
      opt.value = 'custom-existing';
      opt.textContent = 'Current shadow';
      opt.hidden = true;
      $('#ctrlBoxShadow').appendChild(opt);
    }
    suppressControlEvents = false;
  }

  function matchFontOption(fontFamily) {
    const known = ['Inter', 'Roboto', 'Merriweather', 'Poppins'];
    const found = known.find(f => fontFamily.includes(f));
    if (!found) return '';
    return [...$('#ctrlFontFamily').options].find(o => o.value.includes(found))?.value || '';
  }
  function normalizeWeight(w) {
    const n = parseInt(w, 10);
    if (isNaN(n)) return '400';
    if (n >= 700) return '700';
    if (n >= 600) return '600';
    if (n <= 300) return '300';
    return '400';
  }
  function parseLineHeight(lineHeight, fontSize) {
    if (lineHeight === 'normal') return 1.2;
    const lh = parseFloat(lineHeight);
    const fs = parseFloat(fontSize) || 16;
    if (lineHeight.endsWith('px')) return Math.round((lh / fs) * 10) / 10;
    return Math.round(lh * 10) / 10 || 1.2;
  }
  function toHex(colorStr) {
    const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(colorStr || '');
    if (!m) return null;
    return '#' + [m[1], m[2], m[3]].map(v => (+v).toString(16).padStart(2, '0')).join('');
  }

  // ---------- Applying control changes ----------
  let suppressControlEvents = false;

  function applyChange(property, value, explanationOverride) {
    if (!state.selectedEl) return;
    const target = state.selectedEl;
    const previousValue = target.style[property] || '';
    if (previousValue === value) return;
    target.style[property] = value;
    state.undoStack.push({ target, property, previousValue });
    $('#undoBtn').disabled = false;
    const label = target.tagName.toLowerCase() + (target.className ? '.' + [...target.classList].filter(c => !c.startsWith('data-restyle')).join('.') : '');
    addLogEntry(explanationOverride || `Changed ${PLAIN[property] || property} of ${label}.`);
  }

  const controlBindings = [
    ['#ctrlFontFamily', 'fontFamily', v => v, v => v ? `Changed the font.` : null],
    ['#ctrlFontSize', 'fontSize', v => v + 'px', v => `Changed the text size to ${v}px.`],
    ['#ctrlFontWeight', 'fontWeight', v => v, () => `Changed how bold the text is.`],
    ['#ctrlColor', 'color', v => v, () => `Changed the text color.`],
    ['#ctrlLineHeight', 'lineHeight', v => v, v => `Changed the spacing between lines of text.`],
    ['#ctrlBackgroundColor', 'backgroundColor', v => v, () => `Changed the background color.`],
    ['#ctrlBorderRadius', 'borderRadius', v => v + 'px', () => `Changed the rounded corners.`],
    ['#ctrlPadding', 'padding', v => v + 'px', () => `Changed the space around the content.`],
    ['#ctrlBoxShadow', 'boxShadow', v => v, () => `Changed the shadow.`],
  ];

  controlBindings.forEach(([selector, property, transform, explain]) => {
    const node = $(selector);
    const evt = node.tagName === 'SELECT' || node.type === 'color' ? 'change' : 'input';
    node.addEventListener(evt, () => {
      if (suppressControlEvents) return;
      const readout = document.getElementById(selector.replace('#', '') + 'Value');
      const value = transform(node.value);
      if (readout) readout.textContent = value;
      applyChange(property, value, explain(node.value));
    });
  });

  // ---------- Undo ----------
  $('#undoBtn').addEventListener('click', () => {
    const entry = state.undoStack.pop();
    if (!entry) return;
    entry.target.style[entry.property] = entry.previousValue;
    addLogEntry(`Undid the last change (${PLAIN[entry.property] || entry.property}).`);
    if (entry.target === state.selectedEl) populateControlsFromComputed(state.selectedEl);
    $('#undoBtn').disabled = state.undoStack.length === 0;
  });

  // ---------- AI plain-English edit ----------
  $('#aiRequestBtn').addEventListener('click', async () => {
    // Frontend check kept deliberately, per spec, to avoid an API call when nothing is selected.
    if (!state.selectedEl) {
      setStatus('#aiStatus', 'Click something in your page first.', 'error');
      return;
    }
    const requestText = $('#aiRequestArea').value.trim();
    if (!requestText) {
      setStatus('#aiStatus', 'Type what you\'d like to change first.', 'error');
      return;
    }
    setStatus('#aiStatus', 'Asking the AI editor…');
    $('#aiRequestBtn').disabled = true;
    try {
      const target = state.selectedEl;
      const cs = target.ownerDocument.defaultView.getComputedStyle(target);
      const inlineStyles = {};
      Object.keys(PLAIN).forEach(prop => {
        if (target.style[prop]) inlineStyles[prop] = target.style[prop];
      });
      const computedStyles = {
        fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight,
        color: cs.color, lineHeight: cs.lineHeight, backgroundColor: cs.backgroundColor,
        borderRadius: cs.borderRadius, padding: cs.paddingTop, boxShadow: cs.boxShadow,
      };
      const res = await fetch('/api/ai-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          element: {
            tag: target.tagName.toLowerCase(),
            classList: [...target.classList].filter(c => !c.startsWith('data-restyle')),
            inlineStyles,
            computedStyles,
          },
          request: requestText,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'The AI editor couldn\'t make that change.');
      data.changes.forEach(change => applyChange(change.property, change.value, change.explanation));
      populateControlsFromComputed(target);
      setStatus('#aiStatus', 'Done.', 'ok');
      $('#aiRequestArea').value = '';
    } catch (err) {
      setStatus('#aiStatus', err.message, 'error');
    } finally {
      $('#aiRequestBtn').disabled = false;
    }
  });

  // ---------- Export ----------
  $('#exportBtn').addEventListener('click', () => {
    const frame = $('#previewFrame');
    const idoc = frame.contentDocument;
    if (!idoc) return;
    const clone = idoc.cloneNode(true);
    clone.querySelectorAll('[data-restyle-hover],[data-restyle-selected]').forEach(n => {
      n.removeAttribute('data-restyle-hover');
      n.removeAttribute('data-restyle-selected');
    });
    const outlineTag = clone.getElementById('restyle-outline-css');
    if (outlineTag) outlineTag.remove();
    const fullHtml = '<!DOCTYPE html>\n' + clone.documentElement.outerHTML;
    const blob = new Blob([fullHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'restyled-page.html';
    a.click();
    URL.revokeObjectURL(url);
    addLogEntry('Downloaded your finished page with all your changes included.');
  });
})();
