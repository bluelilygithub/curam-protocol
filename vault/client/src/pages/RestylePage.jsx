import React, { useEffect, useRef, useState, useCallback } from 'react';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';

// Restyle — non-technical-friendly CSS editor. See docs/restyle.md.
//
// No CSS jargon anywhere in this file's UI copy or change-log text — "the space around it",
// not "padding"; "the rounded corners", not "border-radius". Every automatic action (fix, AI
// edit, undo) logs a one-sentence plain-English explanation.

// Plain-English label for each supported style property — used in change-log text.
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

const FONT_OPTIONS = [
  { value: '', label: 'System default' },
  { value: "'Inter', sans-serif", label: 'Inter' },
  { value: "'Roboto', sans-serif", label: 'Roboto' },
  { value: "'Merriweather', serif", label: 'Merriweather' },
  { value: "'Poppins', sans-serif", label: 'Poppins' },
];

const SHADOW_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: '0 1px 3px rgba(0,0,0,0.12)', label: 'Subtle' },
  { value: '0 4px 12px rgba(0,0,0,0.15)', label: 'Soft' },
  { value: '0 8px 24px rgba(0,0,0,0.2)', label: 'Strong' },
  { value: '0 0 0 3px rgba(59,130,246,0.5)', label: 'Outline glow' },
];

// Outline styles for hover/selected states — injected as a SEPARATE <style> tag inside the
// iframe, never merged into the user's own CSS, so nothing about their actual design is
// touched just to show selection state.
const OUTLINE_CSS = `
  [data-restyle-hover] { outline: 2px dashed #3b82f6 !important; outline-offset: 1px; cursor: pointer; }
  [data-restyle-selected] { outline: 2px solid #cc785c !important; outline-offset: 1px; }
`;

function matchFontOption(fontFamily) {
  const known = ['Inter', 'Roboto', 'Merriweather', 'Poppins'];
  const found = known.find(f => fontFamily.includes(f));
  if (!found) return '';
  return FONT_OPTIONS.find(o => o.value.includes(found))?.value || '';
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
  if (String(lineHeight).endsWith('px')) return Math.round((lh / fs) * 10) / 10;
  return Math.round(lh * 10) / 10 || 1.2;
}
function toHex(colorStr) {
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(colorStr || '');
  if (!m) return null;
  return '#' + [m[1], m[2], m[3]].map(v => (+v).toString(16).padStart(2, '0')).join('');
}

const FIELD = {
  background: 'var(--color-bg)',
  borderColor: 'var(--color-border)',
  color: 'var(--color-text)',
};

export default function RestylePage() {
  const getIcon = useIcon();
  const { user } = useAuthStore();
  const isAdmin = user?.isAdmin;
  const addToast = useToastStore((s) => s.addToast);

  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const canUse = isAdmin || featureAccess.restyle !== false;

  useEffect(() => {
    api.get('/api/settings/feature-access')
      .then((r) => r.json())
      .then((d) => { if (d?.flags) setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...d.flags }); })
      .catch(() => {});
  }, []);

  // ---------- HTML input ----------
  const [htmlTab, setHtmlTab] = useState('file');
  const [htmlPaste, setHtmlPaste] = useState('');
  const [htmlStatus, setHtmlStatus] = useState({ text: '', kind: '' });
  const [htmlLoaded, setHtmlLoaded] = useState(false);
  const sanitizedRef = useRef({ head: '', body: '' });
  const htmlFileInputRef = useRef(null);
  const [htmlDragOver, setHtmlDragOver] = useState(false);

  // ---------- CSS input ----------
  const [cssTab, setCssTab] = useState('file');
  const [cssPasteName, setCssPasteName] = useState('');
  const [cssPasteText, setCssPasteText] = useState('');
  const [cssEntries, setCssEntries] = useState([]); // { id, filename, css, source }
  const [cssStatus, setCssStatus] = useState({ text: '', kind: '' });
  const [cssDragOver, setCssDragOver] = useState(false);
  const cssFileInputRef = useRef(null);
  const cssIdRef = useRef(0);
  const mergedCssRef = useRef('');

  // ---------- Change log / flags ----------
  const [changeLog, setChangeLog] = useState([]);
  const [flags, setFlags] = useState([]);

  // ---------- Preview / selection ----------
  const iframeRef = useRef(null);
  const [previewBuilt, setPreviewBuilt] = useState(false);
  const [selectionLabel, setSelectionLabel] = useState('Click anything in your page below to start editing it.');
  const selectedElRef = useRef(null);
  const [hasSelection, setHasSelection] = useState(false);
  const undoStackRef = useRef([]); // { target, property, previousValue }
  const [canUndo, setCanUndo] = useState(false);
  const suppressControlEvents = useRef(false);

  // ---------- Property panel control values ----------
  const [ctrl, setCtrl] = useState({
    fontFamily: '', fontSize: 16, fontWeight: '400', color: '#000000',
    lineHeight: 1.2, backgroundColor: '#ffffff', borderRadius: 0, padding: 0, boxShadow: 'none',
  });

  // ---------- AI request ----------
  const [aiRequest, setAiRequest] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiStatus, setAiStatus] = useState({ text: '', kind: '' });

  const addLogEntry = useCallback((text) => {
    setChangeLog((prev) => [text, ...prev]);
  }, []);

  // ---------- HTML handlers ----------
  const submitHtml = useCallback(async (opts) => {
    setHtmlStatus({ text: 'Reading your page…', kind: '' });
    try {
      let res;
      if (opts.file) {
        const fd = new FormData();
        fd.append('file', opts.file);
        res = await api.postForm('/api/restyle/upload-html', fd);
      } else {
        res = await api.post('/api/restyle/upload-html', { html: opts.html });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong reading your HTML.');
      sanitizedRef.current = { head: data.headInnerHTML, body: data.bodyInnerHTML };
      setHtmlLoaded(true);
      (data.changeLog || []).forEach(addLogEntry);
      setHtmlStatus({ text: 'Your page is ready.', kind: 'ok' });
    } catch (err) {
      setHtmlStatus({ text: err.message, kind: 'error' });
    }
  }, [addLogEntry]);

  const handleHtmlFile = (file) => {
    if (!file) return;
    submitHtml({ file });
  };

  // ---------- CSS handlers ----------
  const addCssFiles = (files) => {
    [...files].forEach((file) => {
      if (!file.name.toLowerCase().endsWith('.css')) return;
      const reader = new FileReader();
      reader.onload = () => {
        cssIdRef.current += 1;
        setCssEntries((prev) => [...prev, { id: cssIdRef.current, filename: file.name, css: reader.result, source: 'file' }]);
      };
      reader.readAsText(file);
    });
  };

  const addCssPaste = () => {
    if (!cssPasteText.trim()) { setCssStatus({ text: 'Paste some styles first.', kind: 'error' }); return; }
    cssIdRef.current += 1;
    const name = cssPasteName.trim() || `Pasted styles ${cssEntries.length + 1}`;
    setCssEntries((prev) => [...prev, { id: cssIdRef.current, filename: name, css: cssPasteText, source: 'paste' }]);
    setCssPasteText('');
    setCssPasteName('');
  };

  const removeCssEntry = (id) => setCssEntries((prev) => prev.filter((e) => e.id !== id));
  const moveCssEntry = (index, dir) => {
    setCssEntries((prev) => {
      const arr = [...prev];
      const j = index + dir;
      if (j < 0 || j >= arr.length) return arr;
      [arr[index], arr[j]] = [arr[j], arr[index]];
      return arr;
    });
  };

  // ---------- Build preview ----------
  const resetSelection = useCallback(() => {
    selectedElRef.current = null;
    undoStackRef.current = [];
    setCanUndo(false);
    setHasSelection(false);
    setSelectionLabel('Click anything in your page below to start editing it.');
  }, []);

  const attachIframeInteractivity = useCallback((idoc) => {
    const outlineStyle = idoc.createElement('style');
    outlineStyle.id = 'restyle-outline-css';
    outlineStyle.textContent = OUTLINE_CSS;
    idoc.head.appendChild(outlineStyle);

    let hovered = null;
    idoc.body.addEventListener('mouseover', (e) => {
      if (hovered) hovered.removeAttribute('data-restyle-hover');
      hovered = e.target;
      if (hovered && hovered !== idoc.body) hovered.setAttribute('data-restyle-hover', '');
    });
    idoc.body.addEventListener('mouseout', (e) => {
      if (e.target) e.target.removeAttribute('data-restyle-hover');
    });
    idoc.body.addEventListener('click', (e) => {
      e.preventDefault();
      selectElement(e.target, idoc);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const populateControlsFromComputed = useCallback((target) => {
    const cs = target.ownerDocument.defaultView.getComputedStyle(target);
    suppressControlEvents.current = true;
    setCtrl({
      fontFamily: matchFontOption(cs.fontFamily),
      fontSize: parseFloat(cs.fontSize) || 16,
      fontWeight: normalizeWeight(cs.fontWeight),
      color: toHex(cs.color) || '#000000',
      lineHeight: parseLineHeight(cs.lineHeight, cs.fontSize),
      backgroundColor: toHex(cs.backgroundColor) || '#ffffff',
      borderRadius: parseFloat(cs.borderRadius) || 0,
      padding: parseFloat(cs.paddingTop) || 0,
      boxShadow: cs.boxShadow && cs.boxShadow !== 'none' ? cs.boxShadow : 'none',
    });
    setTimeout(() => { suppressControlEvents.current = false; }, 0);
  }, []);

  const selectElement = useCallback((target, idoc) => {
    if (selectedElRef.current) selectedElRef.current.removeAttribute('data-restyle-selected');
    if (target === idoc.body) {
      resetSelection();
      return;
    }
    target.setAttribute('data-restyle-selected', '');
    selectedElRef.current = target;
    setHasSelection(true);
    const classes = [...target.classList].filter((c) => !c.startsWith('data-restyle'));
    const label = target.tagName.toLowerCase() + (classes.length ? '.' + classes.join('.') : '');
    setSelectionLabel(`Editing: ${label}`);
    populateControlsFromComputed(target);
  }, [populateControlsFromComputed, resetSelection]);

  const renderIframe = useCallback(() => {
    resetSelection();
    const frame = iframeRef.current;
    if (!frame) return;
    const doc = `<!DOCTYPE html><html><head>${sanitizedRef.current.head}<style id="restyle-merged-css">${mergedCssRef.current}</style></head><body>${sanitizedRef.current.body}</body></html>`;
    frame.onload = () => {
      const idoc = frame.contentDocument;
      if (idoc) attachIframeInteractivity(idoc);
    };
    frame.srcdoc = doc;
    setPreviewBuilt(true);
  }, [attachIframeInteractivity, resetSelection]);

  const buildPreview = async () => {
    if (!htmlLoaded) { setCssStatus({ text: 'Add your HTML first.', kind: 'error' }); return; }
    if (!cssEntries.length) { setCssStatus({ text: 'Add at least one style file first.', kind: 'error' }); return; }
    setCssStatus({ text: 'Checking your styles…', kind: '' });
    try {
      const fd = new FormData();
      const pasted = [];
      cssEntries.forEach((entry) => {
        if (entry.source === 'file') {
          fd.append('files', new Blob([entry.css], { type: 'text/css' }), entry.filename);
        } else {
          pasted.push({ filename: entry.filename, css: entry.css });
        }
      });
      fd.append('pasted', JSON.stringify(pasted));
      fd.append('order', JSON.stringify(cssEntries.map((e) => e.filename)));

      const res = await api.postForm('/api/restyle/process-css', fd);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong checking your styles.');

      mergedCssRef.current = data.css;
      (data.changeLog || []).forEach(addLogEntry);
      if (data.flags?.length) setFlags((prev) => [...prev, ...data.flags]);
      setCssStatus({ text: 'Your preview is ready below.', kind: 'ok' });
      renderIframe();
    } catch (err) {
      setCssStatus({ text: err.message, kind: 'error' });
    }
  };

  // ---------- Applying changes ----------
  const applyChange = useCallback((property, value, explanation) => {
    const target = selectedElRef.current;
    if (!target) return;
    const previousValue = target.style[property] || '';
    if (previousValue === value) return;
    target.style[property] = value;
    undoStackRef.current.push({ target, property, previousValue });
    setCanUndo(true);
    const classes = [...target.classList].filter((c) => !c.startsWith('data-restyle'));
    const label = target.tagName.toLowerCase() + (classes.length ? '.' + classes.join('.') : '');
    addLogEntry(explanation || `Changed ${PLAIN[property] || property} of ${label}.`);
  }, [addLogEntry]);

  const handleCtrlChange = (property, rawValue, unit, explanation) => {
    if (suppressControlEvents.current) return;
    const value = unit ? `${rawValue}${unit}` : rawValue;
    setCtrl((prev) => ({ ...prev, [property]: rawValue }));
    applyChange(property, value, explanation);
  };

  const handleUndo = () => {
    const entry = undoStackRef.current.pop();
    if (!entry) return;
    entry.target.style[entry.property] = entry.previousValue;
    addLogEntry(`Undid the last change (${PLAIN[entry.property] || entry.property}).`);
    if (entry.target === selectedElRef.current) populateControlsFromComputed(selectedElRef.current);
    setCanUndo(undoStackRef.current.length > 0);
  };

  const handleAiRequest = async () => {
    if (!selectedElRef.current) {
      setAiStatus({ text: 'Click something in your page first.', kind: 'error' });
      return;
    }
    const text = aiRequest.trim();
    if (!text) { setAiStatus({ text: "Type what you'd like to change first.", kind: 'error' }); return; }
    setAiStatus({ text: 'Asking the AI editor…', kind: '' });
    setAiBusy(true);
    try {
      const target = selectedElRef.current;
      const cs = target.ownerDocument.defaultView.getComputedStyle(target);
      const inlineStyles = {};
      Object.keys(PLAIN).forEach((prop) => { if (target.style[prop]) inlineStyles[prop] = target.style[prop]; });
      const computedStyles = {
        fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight,
        color: cs.color, lineHeight: cs.lineHeight, backgroundColor: cs.backgroundColor,
        borderRadius: cs.borderRadius, padding: cs.paddingTop, boxShadow: cs.boxShadow,
      };
      const res = await api.post('/api/restyle/ai-edit', {
        element: {
          tag: target.tagName.toLowerCase(),
          classList: [...target.classList].filter((c) => !c.startsWith('data-restyle')),
          inlineStyles, computedStyles,
        },
        request: text,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "The AI editor couldn't make that change.");
      data.changes.forEach((change) => applyChange(change.property, change.value, change.explanation));
      populateControlsFromComputed(target);
      setAiStatus({ text: 'Done.', kind: 'ok' });
      setAiRequest('');
    } catch (err) {
      setAiStatus({ text: err.message, kind: 'error' });
    } finally {
      setAiBusy(false);
    }
  };

  const handleExport = () => {
    const idoc = iframeRef.current?.contentDocument;
    if (!idoc) return;
    const clone = idoc.cloneNode(true);
    clone.querySelectorAll('[data-restyle-hover],[data-restyle-selected]').forEach((n) => {
      n.removeAttribute('data-restyle-hover');
      n.removeAttribute('data-restyle-selected');
    });
    clone.getElementById('restyle-outline-css')?.remove();
    const fullHtml = '<!DOCTYPE html>\n' + clone.documentElement.outerHTML;
    const blob = new Blob([fullHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'restyled-page.html'; a.click();
    URL.revokeObjectURL(url);
    addLogEntry('Downloaded your finished page with all your changes included.');
  };

  if (!canUse) {
    return (
      <div className="p-6" style={{ color: 'var(--color-muted)' }}>
        Restyle isn't available for your account. Ask a workspace admin to turn it on in Settings → Feature Access.
      </div>
    );
  }

  const tabBtn = (active) => ({
    flex: 1, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', fontSize: '0.8rem',
    border: `1px solid var(--color-border)`,
    background: active ? 'var(--color-primary)' : 'var(--color-bg)',
    color: active ? '#fff' : 'var(--color-muted)',
  });

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--color-bg)' }}>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Roboto:wght@400;700&family=Merriweather:wght@400;700&family=Poppins:wght@400;600;700&display=swap" rel="stylesheet" />

      <div className="flex items-baseline gap-3 px-5 py-3 border-b flex-wrap" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        <h1 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Restyle</h1>
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Change how your website looks — no code needed.</p>
        <div className="ml-auto flex gap-2">
          <button className="px-3 py-2 rounded-md text-sm font-semibold border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', opacity: canUndo ? 1 : 0.45 }} disabled={!canUndo} onClick={handleUndo}>Undo last change</button>
          <button className="px-3 py-2 rounded-md text-sm font-semibold" style={{ background: 'var(--color-primary)', color: '#fff', opacity: previewBuilt ? 1 : 0.45 }} disabled={!previewBuilt} onClick={handleExport}>Download my page</button>
        </div>
      </div>

      <div className="grid gap-4 p-4 flex-1" style={{ gridTemplateColumns: '320px 1fr 300px', alignItems: 'start' }}>
        {/* LEFT: source panel */}
        <aside className="rounded-xl border p-3 flex flex-col gap-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', maxHeight: 'calc(100vh - 140px)', overflowY: 'auto' }}>
          <section>
            <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>1. Your page's HTML</h2>
            <div className="flex gap-1 mb-2">
              <button style={tabBtn(htmlTab === 'file')} onClick={() => setHtmlTab('file')}>Upload a file</button>
              <button style={tabBtn(htmlTab === 'paste')} onClick={() => setHtmlTab('paste')}>Paste it in</button>
            </div>
            {htmlTab === 'file' ? (
              <div
                onClick={() => htmlFileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setHtmlDragOver(true); }}
                onDragLeave={() => setHtmlDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setHtmlDragOver(false); handleHtmlFile(e.dataTransfer.files[0]); }}
                className="rounded-lg border-2 border-dashed p-6 text-center text-sm cursor-pointer"
                style={{ borderColor: htmlDragOver ? 'var(--color-primary)' : 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                <p>Drop your .html file here, or click to choose one</p>
                <input ref={htmlFileInputRef} type="file" accept=".html,.htm" hidden onChange={(e) => handleHtmlFile(e.target.files[0])} />
              </div>
            ) : (
              <div>
                <textarea className="w-full text-sm rounded-md border p-2 mb-2" style={{ ...FIELD, minHeight: 90 }} placeholder="Paste your page's HTML here..." value={htmlPaste} onChange={(e) => setHtmlPaste(e.target.value)} />
                <button className="px-3 py-1.5 rounded-md text-xs font-semibold border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }} onClick={() => submitHtml({ html: htmlPaste })}>Use this HTML</button>
              </div>
            )}
            {htmlStatus.text && <p className="text-xs mt-1.5" style={{ color: htmlStatus.kind === 'error' ? '#b3452c' : htmlStatus.kind === 'ok' ? '#2f7a3d' : 'var(--color-muted)' }}>{htmlStatus.text}</p>}
          </section>

          <section>
            <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text)' }}>2. Your style files</h2>
            <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>Add one or more. Reorder with the arrows — styles lower in the list win if two files disagree.</p>
            <div className="flex gap-1 mb-2">
              <button style={tabBtn(cssTab === 'file')} onClick={() => setCssTab('file')}>Upload files</button>
              <button style={tabBtn(cssTab === 'paste')} onClick={() => setCssTab('paste')}>Paste a snippet</button>
            </div>
            {cssTab === 'file' ? (
              <div
                onClick={() => cssFileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setCssDragOver(true); }}
                onDragLeave={() => setCssDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setCssDragOver(false); addCssFiles(e.dataTransfer.files); }}
                className="rounded-lg border-2 border-dashed p-4 text-center text-sm cursor-pointer"
                style={{ borderColor: cssDragOver ? 'var(--color-primary)' : 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                <p>Drop one or more .css files here, or click to choose</p>
                <input ref={cssFileInputRef} type="file" accept=".css" multiple hidden onChange={(e) => addCssFiles(e.target.files)} />
              </div>
            ) : (
              <div>
                <input type="text" className="w-full text-sm rounded-md border p-2 mb-1.5" style={FIELD} placeholder="Give it a name, e.g. 'Homepage styles'" value={cssPasteName} onChange={(e) => setCssPasteName(e.target.value)} />
                <textarea className="w-full text-sm rounded-md border p-2 mb-2" style={{ ...FIELD, minHeight: 90 }} placeholder="Paste a CSS snippet here..." value={cssPasteText} onChange={(e) => setCssPasteText(e.target.value)} />
                <button className="px-3 py-1.5 rounded-md text-xs font-semibold border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }} onClick={addCssPaste}>Add this snippet</button>
              </div>
            )}

            <ul className="flex flex-col gap-1.5 my-2">
              {cssEntries.map((entry, i) => (
                <li key={entry.id} className="flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
                  <span className="flex-1 truncate" style={{ color: 'var(--color-text)' }}>{entry.filename}</span>
                  <button className="hover:opacity-60" title="Move earlier (lower priority)" disabled={i === 0} onClick={() => moveCssEntry(i, -1)} style={{ color: 'var(--color-muted)', opacity: i === 0 ? 0.3 : 1 }}>{getIcon('chevron-up', { size: 14 })}</button>
                  <button className="hover:opacity-60" title="Move later (higher priority)" disabled={i === cssEntries.length - 1} onClick={() => moveCssEntry(i, 1)} style={{ color: 'var(--color-muted)', opacity: i === cssEntries.length - 1 ? 0.3 : 1 }}>{getIcon('chevron-down', { size: 14 })}</button>
                  <button className="hover:opacity-60" title="Remove" onClick={() => removeCssEntry(entry.id)} style={{ color: 'var(--color-muted)' }}>{getIcon('x', { size: 14 })}</button>
                </li>
              ))}
            </ul>

            <button
              className="px-3 py-1.5 rounded-md text-xs font-semibold"
              style={{ background: 'var(--color-primary)', color: '#fff', opacity: cssEntries.length ? 1 : 0.45 }}
              disabled={!cssEntries.length}
              onClick={buildPreview}
            >Build the preview</button>
            {cssStatus.text && <p className="text-xs mt-1.5" style={{ color: cssStatus.kind === 'error' ? '#b3452c' : cssStatus.kind === 'ok' ? '#2f7a3d' : 'var(--color-muted)' }}>{cssStatus.text}</p>}
          </section>

          <section>
            <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>What's happened so far</h2>
            <ul className="flex flex-col gap-1.5 max-h-56 overflow-y-auto">
              {changeLog.map((entry, i) => (
                <li key={i} className="text-xs rounded-md p-1.5 pl-2" style={{ background: 'var(--color-bg)', borderLeft: '3px solid var(--color-primary)', color: 'var(--color-text)' }}>{entry}</li>
              ))}
            </ul>
          </section>

          {flags.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Things worth a look</h2>
              <ul className="flex flex-col gap-1.5 max-h-56 overflow-y-auto">
                {flags.map((flag, i) => (
                  <li key={i} className="text-xs rounded-md p-1.5 pl-2" style={{ background: '#fdf3ea', borderLeft: '3px solid #d99a3f', color: '#5a4322' }}>{flag}</li>
                ))}
              </ul>
            </section>
          )}
        </aside>

        {/* CENTER: preview */}
        <section className="flex flex-col gap-2" style={{ minHeight: 'calc(100vh - 140px)' }}>
          <div className="rounded-lg border px-3 py-2 text-sm" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
            {selectionLabel}
          </div>
          <div className="relative flex-1 rounded-xl border overflow-hidden" style={{ background: '#fff', borderColor: 'var(--color-border)' }}>
            <iframe ref={iframeRef} title="Live preview" sandbox="allow-same-origin" style={{ width: '100%', height: '100%', border: 'none', display: previewBuilt ? 'block' : 'none' }} />
            {!previewBuilt && (
              <div className="absolute inset-0 flex items-center justify-center text-center p-5" style={{ color: 'var(--color-muted)', background: 'var(--color-surface)' }}>
                <p>Add your HTML and at least one style file, then click "Build the preview."</p>
              </div>
            )}
          </div>
        </section>

        {/* RIGHT: property panel */}
        <aside className="rounded-xl border p-3 flex flex-col gap-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', maxHeight: 'calc(100vh - 140px)', overflowY: 'auto' }}>
          <section>
            <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text)' }}>Plain-English request</h2>
            <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>Click something in the preview first, then describe what you want.</p>
            <textarea
              className="w-full text-sm rounded-md border p-2 mb-2"
              style={{ ...FIELD, minHeight: 70 }}
              placeholder="e.g. make this bigger and give it rounded corners"
              disabled={!hasSelection}
              value={aiRequest}
              onChange={(e) => setAiRequest(e.target.value)}
            />
            <button
              className="px-3 py-1.5 rounded-md text-xs font-semibold"
              style={{ background: 'var(--color-primary)', color: '#fff', opacity: hasSelection && !aiBusy ? 1 : 0.45 }}
              disabled={!hasSelection || aiBusy}
              onClick={handleAiRequest}
            >{aiBusy ? 'Asking…' : 'Ask for this change'}</button>
            {aiStatus.text && <p className="text-xs mt-1.5" style={{ color: aiStatus.kind === 'error' ? '#b3452c' : aiStatus.kind === 'ok' ? '#2f7a3d' : 'var(--color-muted)' }}>{aiStatus.text}</p>}
          </section>

          {hasSelection && (
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Text</h2>
              <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                Font
                <select className="rounded-md border p-1.5" style={FIELD} value={ctrl.fontFamily} onChange={(e) => handleCtrlChange('fontFamily', e.target.value, null, e.target.value ? 'Changed the font.' : 'Changed the font back to the default.')}>
                  {FONT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                Size
                <input type="range" min={8} max={96} step={1} value={ctrl.fontSize} onChange={(e) => handleCtrlChange('fontSize', Number(e.target.value), 'px', `Changed the text size to ${e.target.value}px.`)} />
                <span style={{ color: 'var(--color-text)' }}>{ctrl.fontSize}px</span>
              </label>
              <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                Weight
                <select className="rounded-md border p-1.5" style={FIELD} value={ctrl.fontWeight} onChange={(e) => handleCtrlChange('fontWeight', e.target.value, null, 'Changed how bold the text is.')}>
                  <option value="400">Normal</option>
                  <option value="600">Semi-bold</option>
                  <option value="700">Bold</option>
                  <option value="300">Light</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                Text color
                <input type="color" style={{ width: '100%', height: 32, border: '1px solid var(--color-border)', borderRadius: 6 }} value={ctrl.color} onChange={(e) => handleCtrlChange('color', e.target.value, null, 'Changed the text color.')} />
              </label>
              <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                Space between lines
                <input type="range" min={0.8} max={3} step={0.1} value={ctrl.lineHeight} onChange={(e) => handleCtrlChange('lineHeight', Number(e.target.value), null, 'Changed the spacing between lines of text.')} />
                <span style={{ color: 'var(--color-text)' }}>{ctrl.lineHeight}</span>
              </label>

              <h2 className="text-sm font-semibold mt-2" style={{ color: 'var(--color-text)' }}>Box</h2>
              <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                Background color
                <input type="color" style={{ width: '100%', height: 32, border: '1px solid var(--color-border)', borderRadius: 6 }} value={ctrl.backgroundColor} onChange={(e) => handleCtrlChange('backgroundColor', e.target.value, null, 'Changed the background color.')} />
              </label>
              <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                Rounded corners
                <input type="range" min={0} max={60} step={1} value={ctrl.borderRadius} onChange={(e) => handleCtrlChange('borderRadius', Number(e.target.value), 'px', 'Changed the rounded corners.')} />
                <span style={{ color: 'var(--color-text)' }}>{ctrl.borderRadius}px</span>
              </label>
              <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                Space around the content
                <input type="range" min={0} max={80} step={1} value={ctrl.padding} onChange={(e) => handleCtrlChange('padding', Number(e.target.value), 'px', 'Changed the space around the content.')} />
                <span style={{ color: 'var(--color-text)' }}>{ctrl.padding}px</span>
              </label>
              <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                Shadow
                <select className="rounded-md border p-1.5" style={FIELD} value={SHADOW_OPTIONS.some(o => o.value === ctrl.boxShadow) ? ctrl.boxShadow : 'none'} onChange={(e) => handleCtrlChange('boxShadow', e.target.value, null, 'Changed the shadow.')}>
                  {SHADOW_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
