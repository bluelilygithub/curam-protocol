import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import Tooltip from '../components/Tooltip';
import ToolSidebar from '../components/ToolSidebar';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import { VoiceInputProvider } from '../components/voiceInput/VoiceInput';
import RestyleTutorChat from './restyle/RestyleTutorChat';
import { RESTYLE_TOOLS, GROUPS, GROUP_TIPS, TOOL_TIPS, TOOL_BLURBS, HOW_IT_WORKS, GUIDE_TOOLS } from './restyle/restyleTools.mjs';
import {
  PLAIN, MEDIA_OPTIONS, DEVICES, setProps, clearSelector, removeProp, generateCss, changeRows, changeReport, tokenRef, uniqueTokenName, toHex,
} from './restyle/editModel.mjs';
import { uniqueSelector, labelFor, scopeOptionsFor } from './restyle/selectors.mjs';
import { checkTextContrast, scanDocument } from './restyle/a11y.mjs';
import { DEMO_HTML, DEMO_CSS, OUTLINE_CSS, matchFontOption, normalizeWeight, parseLineHeight, scanCssAssets, TEXT_ALIGN_OPTIONS } from './restyle/pageHelpers.mjs';
import {
  PagePanel, StylesPanel, BrandPanel, ChangesPanel, ChecksPanel, ExportPanel, SavedPanel, HistoryPanel, SharePanel,
} from './restyle/RestylePanels';
import { AskPanel, ScopePanel, TextPanel, EnhancePanel, AnimationPanel, BoxPanel } from './restyle/PropertyPanels';

// CSS tool (displayed as "CSS"; the internal feature key, route and files still say "restyle"). The job: restyle a page you already have,
// without writing code, then take the CSS away and paste it into the real site. See docs/restyle.md.
//
// Changes are NOT written into the page's elements. Each change is a rule in `edits` (restyle/editModel.mjs); the preview, the export
// and the shared preview are all made from that one list, so what you see is exactly the CSS you can copy out.
//
// No CSS jargon anywhere in this file's UI copy: "the space around it", not "padding"; "the rounded corners", not "border-radius".

const EMPTY_ASSETS = { fonts: [], colors: [], sizes: [], paddings: [], radii: [] };
const DEFAULT_CTRL = {
  fontFamily: '', fontSize: 16, fontWeight: '400', color: '#000000', lineHeight: 1.2, backgroundColor: '#ffffff', borderRadius: 0, padding: 0,
  boxShadow: 'none', textTransform: 'none', letterSpacing: 0, textAlign: 'left', animation: 'none',
};
const MAX_UNDO = 100;
const OUTLINE = { borderColor: 'var(--color-border)', color: 'var(--color-text)' };

const mediaQueryOf = (id) => MEDIA_OPTIONS.find((m) => m.id === id)?.query || '';

/** What a property was before the change, read from the preview, for the "was" in the change list. */
function wasValue(cs, prop) {
  if (prop === 'padding') return cs.paddingTop;
  if (prop === 'animation') return cs.animationName === 'none' ? 'none' : cs.animationName;
  return cs[prop] || '';
}

export default function RestylePage() {
  const getIcon = useIcon();
  const { user } = useAuthStore();
  const isAdmin = user?.isAdmin;
  const addToast = useToastStore((s) => s.addToast);
  const info = useToolInfoModal('vault_css_info_seen');

  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const canUse = isAdmin || featureAccess.restyle !== false;
  const [renderAvailable, setRenderAvailable] = useState(false);
  useEffect(() => {
    api.get('/api/settings/feature-access').then((r) => r.json()).then((d) => { if (d?.flags) setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...d.flags }); }).catch(() => {});
    api.get('/api/restyle/capabilities').then((r) => r.json()).then((d) => setRenderAvailable(!!d?.render)).catch(() => {});
  }, []);

  const [tool, setTool] = useState('page');

  // ---------- The page ----------
  const sanitizedRef = useRef({ head: '', body: '' });
  const [htmlLoaded, setHtmlLoaded] = useState(false);
  const [htmlStatus, setHtmlStatus] = useState({ text: '', kind: '' });
  const [loadingAddress, setLoadingAddress] = useState(false);
  const [sourceUrl, setSourceUrl] = useState('');
  const [cssEntries, setCssEntries] = useState([]); // { id, filename, css, source }
  const cssIdRef = useRef(0);
  const mergedCssRef = useRef('');
  const [cssStatus, setCssStatus] = useState({ text: '', kind: '' });
  const [flags, setFlags] = useState([]);
  const [detectedAssets, setDetectedAssets] = useState(EMPTY_ASSETS);

  // ---------- The preview and what is selected in it ----------
  const iframeRef = useRef(null);
  const [previewBuilt, setPreviewBuilt] = useState(false);
  const [selectionLabel, setSelectionLabel] = useState('Click anything in your page below to start editing it.');
  const selectedElRef = useRef(null);
  const [hasSelection, setHasSelection] = useState(false);
  const suppressControlEvents = useRef(false);
  const [device, setDevice] = useState('desktop');
  const [ctrl, setCtrl] = useState(DEFAULT_CTRL);
  const [contrast, setContrast] = useState(null);

  // Who a change applies to (just the clicked element, or every element sharing a class), on which screen sizes, for which look.
  const [scopeOptions, setScopeOptions] = useState([]);
  const [scope, setScopeState] = useState({ selector: '', label: '' });
  const scopeRef = useRef(scope);
  const [editMedia, setEditMediaState] = useState('');
  const editMediaRef = useRef('');
  const [editState, setEditStateState] = useState('');
  const editStateRef = useRef('');
  const setScope = (selector, label) => { const v = { selector, label }; scopeRef.current = v; setScopeState(v); };
  const setEditMedia = (v) => { editMediaRef.current = v; setEditMediaState(v); };
  const setEditState = (v) => { editStateRef.current = v; setEditStateState(v); };

  // ---------- The changes (the one list the preview, export and share are made from) ----------
  const [edits, setEdits] = useState([]);
  const editsRef = useRef([]);
  const [tokens, setTokens] = useState([]);
  const tokensRef = useRef([]);
  const tokenIdRef = useRef(0);
  const [important, setImportantState] = useState(true);
  const importantRef = useRef(true);
  const [showOriginal, setShowOriginalState] = useState(false);
  const showOriginalRef = useRef(false);
  const undoStackRef = useRef([]);
  const [canUndo, setCanUndo] = useState(false);
  const setImportant = (v) => { importantRef.current = v; setImportantState(v); syncEditStyle(); };
  const setShowOriginal = (v) => { showOriginalRef.current = v; setShowOriginalState(v); syncEditStyle(); };

  // ---------- Plain-English request ----------
  const [aiRequest, setAiRequest] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiStatus, setAiStatus] = useState({ text: '', kind: '' });

  // ---------- Checks ----------
  const [checks, setChecks] = useState(null);

  // ---------- Saved pages ----------
  const [savedProjects, setSavedProjects] = useState([]);
  const [active, setActive] = useState(null); // the saved page open in the editor: { id, name, shared, token }
  const [saveNameInput, setSaveNameInput] = useState('');
  const [savingProject, setSavingProject] = useState(false);
  const [loadingProjectId, setLoadingProjectId] = useState(null);
  const [versions, setVersions] = useState([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [openingVersionId, setOpeningVersionId] = useState(null);
  const [sharing, setSharing] = useState(false);

  // ---------- Writing the changes into the preview ----------
  const syncEditStyle = useCallback(() => {
    const idoc = iframeRef.current?.contentDocument;
    if (!idoc || !idoc.head) return;
    let tag = idoc.getElementById('restyle-edits');
    if (!tag) { tag = idoc.createElement('style'); tag.id = 'restyle-edits'; idoc.head.appendChild(tag); }
    tag.textContent = showOriginalRef.current ? '' : generateCss(editsRef.current, tokensRef.current, { important: importantRef.current, comments: false, preview: true });
  }, []);

  /** Replaces the list of changes (and, when given, the brand colours and fonts) and redraws the preview from it. */
  const commit = useCallback((nextEdits, nextTokens) => {
    editsRef.current = nextEdits;
    setEdits(nextEdits);
    if (nextTokens) { tokensRef.current = nextTokens; setTokens(nextTokens); }
    syncEditStyle();
  }, [syncEditStyle]);

  const pushUndo = useCallback(({ withTokens = false } = {}) => {
    undoStackRef.current.push({ edits: editsRef.current, ...(withTokens ? { tokens: tokensRef.current } : {}) });
    if (undoStackRef.current.length > MAX_UNDO) undoStackRef.current.shift();
    setCanUndo(true);
  }, []);

  const resetChanges = useCallback(() => {
    undoStackRef.current = [];
    setCanUndo(false);
    commit([]);
  }, [commit]);

  // ---------- Selection ----------
  const refreshContrast = useCallback((el) => {
    setContrast(el && el.ownerDocument.defaultView ? checkTextContrast(el, el.ownerDocument.defaultView) : null);
  }, []);

  const populateControlsFromComputed = useCallback((target) => {
    const cs = target.ownerDocument.defaultView.getComputedStyle(target);
    suppressControlEvents.current = true;
    setCtrl({
      fontFamily: matchFontOption(cs.fontFamily, detectedAssets.fonts),
      fontSize: parseFloat(cs.fontSize) || 16,
      fontWeight: normalizeWeight(cs.fontWeight),
      color: toHex(cs.color) || '#000000',
      lineHeight: parseLineHeight(cs.lineHeight, cs.fontSize),
      backgroundColor: toHex(cs.backgroundColor) || '#ffffff',
      borderRadius: parseFloat(cs.borderRadius) || 0,
      padding: parseFloat(cs.paddingTop) || 0,
      boxShadow: cs.boxShadow && cs.boxShadow !== 'none' ? cs.boxShadow : 'none',
      textTransform: cs.textTransform && cs.textTransform !== 'none' ? cs.textTransform : 'none',
      letterSpacing: cs.letterSpacing && cs.letterSpacing !== 'normal' ? parseFloat(cs.letterSpacing) || 0 : 0,
      textAlign: TEXT_ALIGN_OPTIONS.some((o) => o.value === cs.textAlign) ? cs.textAlign : 'left',
      animation: cs.animationName && cs.animationName !== 'none'
        ? (Object.values(editsRef.current).flatMap((e) => (e.props.animation ? [e.props.animation.value] : [])).find((v) => v.startsWith(cs.animationName)) || 'none')
        : 'none',
    });
    refreshContrast(target);
    setTimeout(() => { suppressControlEvents.current = false; }, 0);
  }, [detectedAssets.fonts, refreshContrast]);

  const resetSelection = useCallback(() => {
    selectedElRef.current = null;
    setHasSelection(false);
    setSelectionLabel('Click anything in your page below to start editing it.');
    setScopeOptions([]);
    setScope('', '');
    setEditState('');
    setContrast(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectElement = useCallback((target, idoc) => {
    if (selectedElRef.current) selectedElRef.current.removeAttribute('data-restyle-selected');
    if (target === idoc.body || target === idoc.documentElement) { resetSelection(); return; }
    target.setAttribute('data-restyle-selected', '');
    selectedElRef.current = target;
    setHasSelection(true);
    setSelectionLabel(`Editing: ${labelFor(target)}`);
    setScopeOptions(scopeOptionsFor(target));
    // A fresh selection always starts scoped to just that element, and the normal look: reaching further is chosen each time.
    setScope('', '');
    setEditState('');
    populateControlsFromComputed(target);
  }, [populateControlsFromComputed, resetSelection]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Every element a change reaches, given the scope: just the selected one, or everything matching the chosen selector. */
  const getScopeTargets = useCallback(() => {
    const target = selectedElRef.current;
    if (!target) return [];
    const sel = scopeRef.current.selector;
    if (!sel) return [target];
    try {
      const matches = Array.from(target.ownerDocument.querySelectorAll(sel));
      return matches.length ? matches : [target];
    } catch { return [target]; }
  }, []);

  // The amber outline on everything the current scope would change, and the forced mouse-over / focus look while editing that look.
  const scopePreviewElsRef = useRef([]);
  useEffect(() => {
    const idoc = iframeRef.current?.contentDocument;
    scopePreviewElsRef.current.forEach((el) => el.removeAttribute('data-restyle-scope-preview'));
    scopePreviewElsRef.current = [];
    if (idoc) idoc.querySelectorAll('[data-restyle-force-hover],[data-restyle-force-focus]').forEach((n) => { n.removeAttribute('data-restyle-force-hover'); n.removeAttribute('data-restyle-force-focus'); });
    if (!idoc || !selectedElRef.current) return;
    const targets = getScopeTargets();
    if (scope.selector) { targets.forEach((el) => el.setAttribute('data-restyle-scope-preview', '')); scopePreviewElsRef.current = targets; }
    if (editState) targets.forEach((el) => el.setAttribute(`data-restyle-force-${editState}`, ''));
  }, [scope, editState, hasSelection, getScopeTargets]);

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
    idoc.body.addEventListener('mouseout', (e) => { if (e.target) e.target.removeAttribute('data-restyle-hover'); });
    idoc.body.addEventListener('click', (e) => { e.preventDefault(); selectElement(e.target, idoc); });
  }, [selectElement]);

  // ---------- Building the preview ----------
  const renderIframe = useCallback(() => {
    resetSelection();
    setChecks(null);
    const frame = iframeRef.current;
    if (!frame) return;
    const editCss = showOriginalRef.current ? '' : generateCss(editsRef.current, tokensRef.current, { important: importantRef.current, comments: false, preview: true });
    const doc = `<!DOCTYPE html><html><head>${sanitizedRef.current.head}<style id="restyle-merged-css">${mergedCssRef.current}</style><style id="restyle-edits">${editCss}</style></head><body>${sanitizedRef.current.body}</body></html>`;
    frame.onload = () => {
      const idoc = frame.contentDocument;
      if (idoc) { attachIframeInteractivity(idoc); syncEditStyle(); }
    };
    frame.srcdoc = doc;
    setPreviewBuilt(true);
  }, [attachIframeInteractivity, resetSelection, syncEditStyle]);

  // Accepts an explicit entries list so a loader can build a preview straight away, without waiting for a re-render.
  const runBuildPreview = useCallback(async (entries) => {
    // Checked via the ref (always current the instant a loader sets it), not the htmlLoaded state flag, which can be a render behind.
    if (!sanitizedRef.current.body && !sanitizedRef.current.head) { setCssStatus({ text: 'Add your page first.', kind: 'error' }); return; }
    if (!entries.length) {
      mergedCssRef.current = '';
      setCssStatus({ text: 'Your preview is ready.', kind: 'ok' });
      setDetectedAssets(scanCssAssets('', `${sanitizedRef.current.head}\n${sanitizedRef.current.body}`));
      renderIframe();
      return;
    }
    setCssStatus({ text: 'Checking your styles…', kind: '' });
    try {
      const fd = new FormData();
      const pasted = [];
      entries.forEach((entry) => {
        if (entry.source === 'file') fd.append('files', new Blob([entry.css], { type: 'text/css' }), entry.filename);
        else pasted.push({ filename: entry.filename, css: entry.css });
      });
      fd.append('pasted', JSON.stringify(pasted));
      fd.append('order', JSON.stringify(entries.map((e) => e.filename)));
      const res = await api.postForm('/api/restyle/process-css', fd);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong checking your styles.');
      mergedCssRef.current = data.css;
      if (data.flags?.length) setFlags((prev) => [...prev, ...data.flags]);
      setCssStatus({ text: 'Your preview is ready.', kind: 'ok' });
      setDetectedAssets(scanCssAssets(data.css, `${sanitizedRef.current.head}\n${sanitizedRef.current.body}`));
      renderIframe();
    } catch (err) {
      setCssStatus({ text: err.message, kind: 'error' });
    }
  }, [renderIframe]);

  // Once the preview is built, or something in it is clicked, move on from the set-up tools to the editing ones.
  useEffect(() => { if (previewBuilt) setTool((t) => (t === 'page' || t === 'styles' ? 'ask' : t)); }, [previewBuilt]);
  useEffect(() => { if (hasSelection) setTool((t) => (t === 'page' || t === 'styles' ? 'ask' : t)); }, [hasSelection]);

  // ---------- Bringing a page in ----------
  /** Takes what the server returns for a page (upload, paste, live address) and makes it the page being worked on. */
  const applyLoadedPage = useCallback((data, { replaceCss, url = '' }) => {
    sanitizedRef.current = { head: data.headInnerHTML, body: data.bodyInnerHTML };
    setHtmlLoaded(true);
    setSourceUrl(url);
    setFlags(data.flags?.length ? data.flags : []);
    const files = (data.cssFiles || []).map((f) => ({ id: ++cssIdRef.current, filename: f.filename, css: f.css, source: 'paste' }));
    const nextEntries = replaceCss ? files : null;
    if (replaceCss) setCssEntries(files); else if (files.length) setCssEntries((prev) => [...prev, ...files]);
    // A different page means the changes made to the last one no longer apply, and it is not the saved page that was open.
    resetChanges();
    setActive(null);
    setVersions([]);
    return nextEntries;
  }, [resetChanges]);

  const submitHtml = async (opts) => {
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
      applyLoadedPage(data, { replaceCss: false });
      setHtmlStatus({ text: 'Your page is ready. Add style files if you have any, then build the preview.', kind: 'ok' });
      setTool('styles');
    } catch (err) {
      setHtmlStatus({ text: err.message, kind: 'error' });
    }
  };

  const loadAddress = async (url, render) => {
    setLoadingAddress(true);
    setHtmlStatus({ text: render ? 'Opening the page in a browser… this can take half a minute.' : 'Loading the page…', kind: '' });
    try {
      const res = await api.post('/api/restyle/fetch-url', { url, render: !!render });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'We couldn\'t load that page.');
      const entries = applyLoadedPage(data, { replaceCss: true, url: data.sourceUrl || url });
      setHtmlStatus({ text: `Loaded ${data.sourceUrl || url}${data.cssFiles?.length ? ` with ${data.cssFiles.length} style file${data.cssFiles.length === 1 ? '' : 's'}` : ''}.`, kind: 'ok' });
      await runBuildPreview(entries);
    } catch (err) {
      setHtmlStatus({ text: err.message, kind: 'error' });
    } finally {
      setLoadingAddress(false);
    }
  };

  const loadDemo = async () => {
    setHtmlStatus({ text: '', kind: '' });
    try {
      const res = await api.post('/api/restyle/upload-html', { html: DEMO_HTML });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load the demo.');
      applyLoadedPage({ ...data, cssFiles: [], flags: [] }, { replaceCss: true });
      cssIdRef.current += 1;
      const demoEntries = [{ id: cssIdRef.current, filename: 'demo-styles.css', css: DEMO_CSS, source: 'paste' }];
      setCssEntries(demoEntries);
      await runBuildPreview(demoEntries);
      addToast('Demo page loaded — click the header, paragraph, card, button or image to try editing it.');
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

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
  const addCssPaste = (name, text) => {
    if (!text.trim()) { setCssStatus({ text: 'Paste some styles first.', kind: 'error' }); return; }
    cssIdRef.current += 1;
    setCssEntries((prev) => [...prev, { id: cssIdRef.current, filename: name.trim() || `Pasted styles ${prev.length + 1}`, css: text, source: 'paste' }]);
  };
  const removeCssEntry = (id) => setCssEntries((prev) => prev.filter((e) => e.id !== id));
  const moveCssEntry = (index, dir) => setCssEntries((prev) => {
    const arr = [...prev];
    const j = index + dir;
    if (j < 0 || j >= arr.length) return arr;
    [arr[index], arr[j]] = [arr[j], arr[index]];
    return arr;
  });

  // ---------- Making a change ----------
  /** Records changes to the clicked item (or everything in scope), for the chosen screen size and look. One undo step for the lot. */
  const applyChanges = useCallback((list) => {
    const el = selectedElRef.current;
    if (!el || !list.length) return;
    const cs = el.ownerDocument.defaultView.getComputedStyle(el);
    const sc = scopeRef.current;
    const target = {
      selector: sc.selector || uniqueSelector(el),
      label: sc.selector ? sc.label : labelFor(el),
      state: editStateRef.current,
      media: mediaQueryOf(editMediaRef.current),
    };
    const changes = list.map((c) => ({ prop: c.property, value: c.value, was: wasValue(cs, c.property) }));
    pushUndo();
    if (showOriginalRef.current) { showOriginalRef.current = false; setShowOriginalState(false); }
    commit(setProps(editsRef.current, target, changes));
    setTimeout(() => refreshContrast(el), 0);
  }, [commit, pushUndo, refreshContrast]);

  const handleCtrlChange = (property, rawValue, unit) => {
    if (suppressControlEvents.current) return;
    setCtrl((prev) => ({ ...prev, [property]: rawValue }));
    applyChanges([{ property, value: unit ? `${rawValue}${unit}` : rawValue }]);
  };
  // The quick picks hand over the exact value (e.g. "1.2rem", "rgba(0,0,0,0.5)") rather than a slider number and a unit.
  const applyQuickPick = (property, value, explanation, ctrlUpdates) => {
    setCtrl((prev) => ({ ...prev, ...ctrlUpdates }));
    applyChanges([{ property, value }]);
  };
  const applyBrandColour = (property, token) => {
    setCtrl((prev) => ({ ...prev, [property]: token.value }));
    applyChanges([{ property, value: tokenRef(token) }]);
  };
  // An animation does not replay just because its rule changed: clear it on the element, force a repaint, and let the rule start it again.
  const handleAnimationChange = (value) => {
    if (suppressControlEvents.current) return;
    setCtrl((prev) => ({ ...prev, animation: value }));
    applyChanges([{ property: 'animation', value }]);
    getScopeTargets().forEach((el) => { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; }); // eslint-disable-line no-unused-expressions
  };

  const handleResetSelection = () => {
    const el = selectedElRef.current;
    if (!el) return;
    const selector = scopeRef.current.selector || uniqueSelector(el);
    if (!editsRef.current.some((e) => e.selector === selector)) { addToast('Nothing to reset: no changes have been made to this yet.'); return; }
    pushUndo();
    commit(clearSelector(editsRef.current, selector));
    populateControlsFromComputed(el);
  };

  const handleUndo = () => {
    const entry = undoStackRef.current.pop();
    if (!entry) return;
    commit(entry.edits, entry.tokens);
    if (selectedElRef.current) populateControlsFromComputed(selectedElRef.current);
    setCanUndo(undoStackRef.current.length > 0);
  };

  const removeChange = (row) => {
    pushUndo();
    commit(removeProp(editsRef.current, row.target, row.prop));
    if (selectedElRef.current) populateControlsFromComputed(selectedElRef.current);
  };
  const clearAllChanges = () => { pushUndo(); commit([]); if (selectedElRef.current) populateControlsFromComputed(selectedElRef.current); };

  const handleAiRequest = async () => {
    const target = selectedElRef.current;
    if (!target) { setAiStatus({ text: 'Click something in your page first.', kind: 'error' }); return; }
    const text = aiRequest.trim();
    if (!text) { setAiStatus({ text: "Type what you'd like to change first.", kind: 'error' }); return; }
    setAiStatus({ text: 'Asking the AI editor…', kind: '' });
    setAiBusy(true);
    try {
      const cs = target.ownerDocument.defaultView.getComputedStyle(target);
      const computedStyles = {
        fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, color: cs.color, lineHeight: cs.lineHeight,
        backgroundColor: cs.backgroundColor, borderRadius: cs.borderRadius, padding: cs.paddingTop, boxShadow: cs.boxShadow,
        textTransform: cs.textTransform, letterSpacing: cs.letterSpacing, textAlign: cs.textAlign, animation: ctrl.animation,
      };
      const res = await api.post('/api/restyle/ai-edit', {
        element: { tag: target.tagName.toLowerCase(), classList: Array.from(target.classList), inlineStyles: {}, computedStyles },
        request: text,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "The AI editor couldn't make that change.");
      applyChanges(data.changes.map((c) => ({ property: c.property, value: c.value })));
      setTimeout(() => populateControlsFromComputed(target), 0);
      setAiStatus({ text: `Done: ${data.changes.map((c) => PLAIN[c.property] || c.property).join(', ')}.`, kind: 'ok' });
      setAiRequest('');
    } catch (err) {
      setAiStatus({ text: err.message, kind: 'error' });
    } finally {
      setAiBusy(false);
    }
  };

  // ---------- Brand colours and fonts ----------
  const addToken = (kind) => {
    tokenIdRef.current += 1;
    const t = { id: tokenIdRef.current, kind, name: uniqueTokenName(tokensRef.current, kind === 'color' ? 'Colour' : 'Font'), value: kind === 'color' ? '#cc785c' : "'Inter', sans-serif" };
    pushUndo({ withTokens: true });
    commit(editsRef.current, [...tokensRef.current, t]);
  };
  const updateToken = (id, patch) => {
    const next = tokensRef.current.map((t) => (t.id === id ? { ...t, ...patch, ...(patch.name !== undefined ? { name: uniqueTokenName(tokensRef.current, patch.name, id) } : {}) } : t));
    commit(editsRef.current, next);
  };
  const removeToken = (id) => {
    const token = tokensRef.current.find((t) => t.id === id);
    if (!token) return;
    const ref = tokenRef(token);
    pushUndo({ withTokens: true });
    // A change that used this brand colour or font has nothing left to point at, so it goes with it.
    const cleaned = editsRef.current
      .map((e) => ({ ...e, props: Object.fromEntries(Object.entries(e.props).filter(([, v]) => v.value !== ref)) }))
      .filter((e) => Object.keys(e.props).length > 0);
    commit(cleaned, tokensRef.current.filter((t) => t.id !== id));
  };
  const detectBrandColours = () => {
    const have = new Set(tokensRef.current.filter((t) => t.kind === 'color').map((t) => t.value.toLowerCase()));
    const found = [];
    detectedAssets.colors.forEach((c) => { const hex = toHex(c); if (hex && !have.has(hex) && !found.includes(hex)) found.push(hex); });
    if (!found.length) { addToast('No new colours found in the page.'); return; }
    let list = tokensRef.current;
    found.slice(0, 6).forEach((hex) => { tokenIdRef.current += 1; list = [...list, { id: tokenIdRef.current, kind: 'color', name: uniqueTokenName(list, `Colour ${list.filter((t) => t.kind === 'color').length + 1}`), value: hex }]; });
    pushUndo({ withTokens: true });
    commit(editsRef.current, list);
  };
  const applyBrandEverywhere = (token, target) => {
    pushUndo();
    commit(setProps(editsRef.current, { selector: target.selector, label: target.label, state: '', media: '' }, [{ prop: target.prop, value: tokenRef(token), was: '' }]));
    addToast(`${target.label}: now uses “${token.name}”.`);
  };

  // ---------- Checks ----------
  const runChecks = () => {
    const idoc = iframeRef.current?.contentDocument;
    if (!idoc) return;
    setChecks(scanDocument(idoc));
  };
  const pickIssue = (issue) => {
    const idoc = iframeRef.current?.contentDocument;
    if (!idoc || !issue.el.isConnected) return;
    selectElement(issue.el, idoc);
    issue.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (issue.kind === 'contrast' || issue.kind === 'small') setTool('text');
  };

  // ---------- Export ----------
  const exportCss = useMemo(() => generateCss(edits, tokens, { important, comments: true, preview: false }), [edits, tokens, important]);
  const pageName = active?.name || (sourceUrl ? (() => { try { return new URL(sourceUrl).hostname; } catch { return 'page'; } })() : 'page');
  const fileSlug = pageName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'page';
  const saveFile = (text, filename, type) => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };
  const copyText = async (text, done) => {
    try { await navigator.clipboard.writeText(text); addToast(done); } catch { addToast('Could not copy', 'error'); }
  };
  const downloadPage = () => {
    const idoc = iframeRef.current?.contentDocument;
    if (!idoc) return;
    const clone = idoc.cloneNode(true);
    clone.querySelectorAll('[data-restyle-hover],[data-restyle-selected],[data-restyle-scope-preview],[data-restyle-force-hover],[data-restyle-force-focus]').forEach((n) => {
      ['data-restyle-hover', 'data-restyle-selected', 'data-restyle-scope-preview', 'data-restyle-force-hover', 'data-restyle-force-focus'].forEach((a) => n.removeAttribute(a));
    });
    clone.getElementById('restyle-outline-css')?.remove();
    const editTag = clone.getElementById('restyle-edits');
    if (editTag) editTag.textContent = exportCss;
    saveFile(`<!DOCTYPE html>\n${clone.documentElement.outerHTML}`, `${fileSlug}-restyled.html`, 'text/html');
  };
  const downloadReport = () => saveFile(changeReport(edits, tokens, { title: pageName, sourceUrl, important }), `${fileSlug}-changes.md`, 'text/markdown');

  // ---------- Saved pages, history and sharing ----------
  const loadSavedList = useCallback(() => {
    api.get('/api/restyle/projects').then((r) => r.json()).then((d) => { if (Array.isArray(d?.projects)) setSavedProjects(d.projects); }).catch(() => {});
  }, []);
  useEffect(() => { loadSavedList(); }, [loadSavedList]);

  const buildPayload = () => ({
    head: sanitizedRef.current.head,
    body: sanitizedRef.current.body,
    edits: editsRef.current,
    tokens: tokensRef.current,
    important: importantRef.current,
    sourceUrl,
    // For the public preview link, which is built on the server from what is saved here.
    pageCss: mergedCssRef.current,
    editsCss: generateCss(editsRef.current, tokensRef.current, { important: importantRef.current, comments: false, preview: false }),
  });

  const saveProject = async (mode) => {
    if (!previewBuilt) { addToast('Build a preview first, then save.', 'error'); return; }
    const name = (mode === 'update' ? (saveNameInput.trim() || active?.name) : saveNameInput.trim());
    if (!name) { addToast('Give this page a name first.', 'error'); return; }
    setSavingProject(true);
    try {
      const body = { name, html: buildPayload(), cssEntries };
      const res = mode === 'update' && active ? await api.put(`/api/restyle/projects/${active.id}`, body) : await api.post('/api/restyle/projects', body);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save this page.');
      setActive((a) => (mode === 'update' && a ? { ...a, name: data.project.name } : { id: data.project.id, name: data.project.name, shared: false, token: null }));
      setSaveNameInput(data.project.name);
      addToast(mode === 'update' ? `Updated “${name}”. The old version is in Page history.` : `Saved “${name}”.`);
      loadSavedList();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setSavingProject(false);
    }
  };

  /** Puts a saved page (or an earlier version of one) into the editor, with its changes, brand colours and style files. */
  const loadProjectData = async (project) => {
    const saved = project.html || {};
    sanitizedRef.current = { head: saved.head || '', body: saved.body || '' };
    setHtmlLoaded(true);
    setSourceUrl(saved.sourceUrl || '');
    setHtmlStatus({ text: 'Loaded from your saved pages.', kind: 'ok' });
    const entries = Array.isArray(project.cssEntries) ? project.cssEntries : [];
    cssIdRef.current = Math.max(cssIdRef.current, ...entries.map((e) => e.id || 0)) + 1;
    setCssEntries(entries);
    setFlags([]);
    undoStackRef.current = [];
    setCanUndo(false);
    tokenIdRef.current = Math.max(tokenIdRef.current, ...(saved.tokens || []).map((t) => t.id || 0));
    importantRef.current = saved.important !== false;
    setImportantState(importantRef.current);
    showOriginalRef.current = false;
    setShowOriginalState(false);
    commit(Array.isArray(saved.edits) ? saved.edits : [], Array.isArray(saved.tokens) ? saved.tokens : []);
    await runBuildPreview(entries);
  };

  const openProject = async (id) => {
    setLoadingProjectId(id);
    try {
      const res = await api.get(`/api/restyle/projects/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load this page.');
      await loadProjectData(data.project);
      setActive({ id: data.project.id, name: data.project.name, shared: !!data.project.shareToken, token: data.project.shareToken || null });
      setSaveNameInput(data.project.name);
      setVersions([]);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setLoadingProjectId(null);
    }
  };

  const deleteProject = async (p) => {
    try {
      await api.delete(`/api/restyle/projects/${p.id}`);
      addToast(`Deleted “${p.name}”.`);
      if (active?.id === p.id) { setActive(null); setVersions([]); }
      loadSavedList();
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  useEffect(() => {
    if (tool !== 'history' || !active) return undefined;
    let cancelled = false;
    setVersionsLoading(true);
    api.get(`/api/restyle/projects/${active.id}/versions`).then((r) => r.json())
      .then((d) => { if (!cancelled) setVersions(d.versions || []); })
      .catch(() => { if (!cancelled) setVersions([]); })
      .finally(() => { if (!cancelled) setVersionsLoading(false); });
    return () => { cancelled = true; };
  }, [tool, active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const openVersion = async (version) => {
    setOpeningVersionId(version.id);
    try {
      const res = await api.get(`/api/restyle/projects/${active.id}/versions/${version.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not open that version.');
      await loadProjectData(data.project);
      addToast('Opened that version in the editor. Press Update in My saved pages to make it the saved page.');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setOpeningVersionId(null);
    }
  };

  const shareLink = active?.token ? `${window.location.origin}/api/shared/restyle/${active.token}` : '';
  const shareProject = async () => {
    setSharing(true);
    try {
      const res = await api.post(`/api/restyle/projects/${active.id}/share`, {});
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not make the link.');
      setActive((a) => ({ ...a, shared: true, token: data.token }));
      loadSavedList();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setSharing(false);
    }
  };
  const unshareProject = async () => {
    setSharing(true);
    try {
      const res = await api.delete(`/api/restyle/projects/${active.id}/share`);
      if (!res.ok) throw new Error('Could not stop sharing.');
      setActive((a) => ({ ...a, shared: false, token: null }));
      loadSavedList();
      addToast('Sharing is off. The old link no longer works.');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setSharing(false);
    }
  };

  // ---------- The menu and the open tool ----------
  const needsHint = (t) => {
    if (t.needs === 'selection' && !hasSelection) return previewBuilt ? 'Click something first' : 'Build the preview first';
    if (t.needs === 'preview' && !previewBuilt) return 'Build the preview first';
    if (t.needs === 'saved' && !active) return 'Save the page first';
    return undefined;
  };
  const menu = GROUPS.map((label) => ({
    label,
    tip: GROUP_TIPS[label],
    tools: RESTYLE_TOOLS.filter((t) => t.group === label).map((t) => ({ ...t, tip: TOOL_TIPS[t.id], hint: needsHint(t) })),
  }));
  const currentTool = RESTYLE_TOOLS.find((t) => t.id === tool);

  // The guide's "Open" buttons: switch to the tool, exactly as clicking it in the list would.
  const openToolById = (id) => {
    const target = GUIDE_TOOLS.find((t) => t.id === id);
    if (target) setTool(target.tool);
  };

  const deviceWidth = DEVICES.find((d) => d.id === device)?.width || null;
  const changeCount = changeRows(edits).length;

  const renderPanel = () => {
    if (currentTool?.needs === 'selection' && !hasSelection) {
      return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{previewBuilt ? 'Click something in the preview first. It gets an outline, and this tool changes it.' : 'Build the preview first (Your page, then Style files), then click something in it.'}</p>;
    }
    switch (tool) {
      case 'page':
        return <PagePanel onFile={(file) => submitHtml({ file })} onPaste={(html) => submitHtml({ html })} onAddress={loadAddress} status={htmlStatus} busy={loadingAddress} renderAvailable={renderAvailable} sourceUrl={sourceUrl} />;
      case 'styles':
        return <StylesPanel entries={cssEntries} onAddFiles={addCssFiles} onAddPaste={addCssPaste} onMove={moveCssEntry} onRemove={removeCssEntry} htmlLoaded={htmlLoaded} onBuild={() => runBuildPreview(cssEntries)} status={cssStatus} flags={flags} />;
      case 'ask':
        return <AskPanel value={aiRequest} onChange={setAiRequest} onAsk={handleAiRequest} busy={aiBusy} status={aiStatus} />;
      case 'scope':
        return <ScopePanel scopeOptions={scopeOptions} scope={scope} onScope={setScope} media={editMedia} onMedia={setEditMedia} state={editState} onState={setEditState} onReset={handleResetSelection} />;
      case 'text':
        return <TextPanel ctrl={ctrl} onCtrl={handleCtrlChange} onQuick={applyQuickPick} onBrand={applyBrandColour} detected={detectedAssets} tokens={tokens} contrast={contrast} />;
      case 'enhance':
        return <EnhancePanel ctrl={ctrl} onCtrl={handleCtrlChange} />;
      case 'animation':
        return <AnimationPanel ctrl={ctrl} onAnimation={handleAnimationChange} />;
      case 'box':
        return <BoxPanel ctrl={ctrl} onCtrl={handleCtrlChange} onQuick={applyQuickPick} onBrand={applyBrandColour} detected={detectedAssets} tokens={tokens} contrast={contrast} />;
      case 'brand':
        return <BrandPanel tokens={tokens} detectedFonts={detectedAssets.fonts} onAdd={addToken} onUpdate={updateToken} onRemove={removeToken} onDetect={detectBrandColours} onApply={applyBrandEverywhere} previewBuilt={previewBuilt} />;
      case 'changes':
        return <ChangesPanel rows={changeRows(edits)} tokens={tokens} onRemove={removeChange} onClear={clearAllChanges} onUndo={handleUndo} canUndo={canUndo} />;
      case 'checks':
        return previewBuilt ? <ChecksPanel result={checks} onRun={runChecks} onPick={pickIssue} showingOriginal={showOriginal} /> : <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Build the preview first, then check it.</p>;
      case 'export':
        return previewBuilt
          ? <ExportPanel css={exportCss} important={important} onImportant={setImportant} changeCount={changeCount} onCopyCss={() => copyText(exportCss, 'Copied the CSS')} onDownloadCss={() => saveFile(exportCss, `${fileSlug}-changes.css`, 'text/css')} onDownloadPage={downloadPage} onDownloadReport={downloadReport} />
          : <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Build the preview first, then export.</p>;
      case 'saved':
        return <SavedPanel projects={savedProjects} active={active} nameInput={saveNameInput} onName={setSaveNameInput} saving={savingProject} previewBuilt={previewBuilt} onSaveNew={() => saveProject('new')} onUpdate={() => saveProject('update')} onOpen={openProject} onDelete={deleteProject} loadingId={loadingProjectId} />;
      case 'history':
        return <HistoryPanel active={active} versions={versions} loading={versionsLoading} onOpen={openVersion} openingId={openingVersionId} />;
      case 'share':
        return <SharePanel active={active} link={shareLink} busy={sharing} onShare={shareProject} onUnshare={unshareProject} onCopy={() => copyText(shareLink, 'Copied the link')} />;
      default:
        return null;
    }
  };

  if (!canUse) {
    return (
      <div className="p-6" style={{ color: 'var(--color-muted)' }}>
        CSS isn't available for your account. Ask a workspace admin to turn it on in Settings → Feature Access.
      </div>
    );
  }

  const segment = (activeNow) => ({
    padding: '5px 12px', fontSize: '0.8rem', cursor: 'pointer', border: '1px solid var(--color-border)',
    background: activeNow ? 'var(--color-primary)' : 'var(--color-bg)', color: activeNow ? '#fff' : 'var(--color-text)',
  });
  const editingFor = [editState ? 'mouse-over look' : '', editMedia ? MEDIA_OPTIONS.find((m) => m.id === editMedia).label.toLowerCase() : ''].filter(Boolean).join(', ');

  return (
    <VoiceInputProvider lang="en-AU">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Roboto:wght@400;700&family=Merriweather:wght@400;700&family=Poppins:wght@400;600;700&display=swap" rel="stylesheet" />

      <div className="flex flex-col sm:flex-row min-h-[calc(100dvh-3rem)]">
        <ToolSidebar title="CSS" icon="palette" groups={menu} current={tool} onSelect={setTool} onInfo={info.open} infoTip="How this tool works, and what it cannot do." />

        <div className="flex-1 min-w-0 p-4 sm:p-5 flex flex-col gap-3" style={{ background: 'var(--color-bg)' }}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{currentTool?.label}</h2>
              <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>{TOOL_BLURBS[tool]}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Tooltip text="Load a small practice page and build its preview, so you can try clicking and changing things.">
                <button className="px-3 py-1.5 rounded-lg text-sm border transition-all duration-200 hover:opacity-70" style={OUTLINE} onClick={loadDemo}>Load a demo</button>
              </Tooltip>
              <Tooltip text="Take back your last change. A change to many items at once is one undo.">
                <button className="px-3 py-1.5 rounded-lg text-sm border transition-all duration-200 hover:opacity-70 disabled:opacity-50" style={OUTLINE} disabled={!canUndo} onClick={handleUndo}>Undo last change</button>
              </Tooltip>
              <Tooltip text="Get the CSS to paste into your real site, or the page as a file.">
                <button className="px-3 py-1.5 rounded-lg text-sm font-medium transition-opacity duration-200 hover:opacity-80 disabled:opacity-45" style={{ background: 'var(--color-primary)', color: '#fff' }} disabled={!previewBuilt} onClick={() => setTool('export')}>
                  Export the CSS{changeCount ? ` (${changeCount})` : ''}
                </button>
              </Tooltip>
            </div>
          </div>

          <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
            <div className="lg:w-80 shrink-0 rounded-xl border p-4 overflow-y-auto" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', maxHeight: 'calc(100dvh - 11rem)' }}>
              {renderPanel()}
            </div>

            <section className="flex-1 min-w-0 flex flex-col gap-2" style={{ minHeight: 'calc(100dvh - 14rem)' }}>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex" role="group" aria-label="Preview size">
                  {DEVICES.map((d, i) => (
                    <Tooltip key={d.id} text={d.tip}>
                      <button type="button" onClick={() => setDevice(d.id)} aria-pressed={device === d.id} className="transition-opacity duration-200 hover:opacity-70" style={{ ...segment(device === d.id), borderRadius: i === 0 ? '8px 0 0 8px' : i === DEVICES.length - 1 ? '0 8px 8px 0' : 0 }}>{d.label}</button>
                    </Tooltip>
                  ))}
                </div>
                <div className="flex" role="group" aria-label="Show the original or your version">
                  <Tooltip text="The page with your changes.">
                    <button type="button" onClick={() => setShowOriginal(false)} aria-pressed={!showOriginal} className="transition-opacity duration-200 hover:opacity-70" style={{ ...segment(!showOriginal), borderRadius: '8px 0 0 8px' }}>With changes</button>
                  </Tooltip>
                  <Tooltip text="The page as it was before any of your changes, to compare.">
                    <button type="button" onClick={() => setShowOriginal(true)} aria-pressed={showOriginal} className="transition-opacity duration-200 hover:opacity-70" style={{ ...segment(showOriginal), borderRadius: '0 8px 8px 0' }}>Original</button>
                  </Tooltip>
                </div>
                <div className="flex-1 min-w-0 rounded-lg border px-3 py-1.5 text-sm truncate" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
                  {selectionLabel}{hasSelection && editingFor ? ` · for ${editingFor}` : ''}
                </div>
              </div>
              <div className="relative flex-1 rounded-xl border overflow-auto" style={{ background: '#e8e8e2', borderColor: 'var(--color-border)' }}>
                <div style={{ width: deviceWidth || '100%', maxWidth: '100%', height: '100%', minHeight: 'calc(100dvh - 18rem)', margin: '0 auto', background: '#fff', transition: 'width 200ms' }}>
                  <iframe ref={iframeRef} title="Live preview" sandbox="allow-same-origin" style={{ width: '100%', height: '100%', minHeight: 'inherit', border: 'none', display: previewBuilt ? 'block' : 'none' }} />
                </div>
                {!previewBuilt && (
                  <div className="absolute inset-0 flex items-center justify-center text-center p-5" style={{ color: 'var(--color-muted)', background: 'var(--color-surface)' }}>
                    <p>Load a page by its address (Your page), or upload one, then the preview appears here. Or load a demo above.</p>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>

      {info.show && (
        <ToolInfoModal title="How CSS Works" onClose={info.close}>
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>
            Restyle a page you already have, without writing code, and take the CSS away to paste into the real site. Work down the list on the left. Hover any tool for a plain explanation. Not sure what to do? Press the round button at the bottom right and tell the guide what you want.
          </p>
          <div className="rounded-lg p-3 text-sm space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            {HOW_IT_WORKS.map(([heading, text]) => (
              <p key={heading} style={{ color: 'var(--color-text)' }}><strong>{heading}</strong> — {text}</p>
            ))}
          </div>
        </ToolInfoModal>
      )}

      <RestyleTutorChat currentTool={tool} onOpenTool={openToolById} />
    </VoiceInputProvider>
  );
}
