import React, { useEffect, useRef, useState, useCallback } from 'react';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import Tooltip from '../components/Tooltip';
import ToolSidebar from '../components/ToolSidebar';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import { VoiceInput, VoiceInputProvider } from '../components/voiceInput/VoiceInput';
import RestyleTutorChat from './restyle/RestyleTutorChat';
import { RESTYLE_TOOLS, GROUPS, GROUP_TIPS, TOOL_TIPS, TOOL_BLURBS, HOW_IT_WORKS, GUIDE_TOOLS } from './restyle/restyleTools.mjs';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';

// CSS tool (displayed as "CSS"; internal feature key/route/files still say "restyle" — pure
// code-organization continuity, invisible to the user). Non-technical-friendly CSS editor.
// See docs/restyle.md.
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
  textTransform: 'the text capitalization',
  letterSpacing: 'the spacing between letters',
  textAlign: 'the text alignment',
  animation: 'the animation',
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

const TEXT_TRANSFORM_OPTIONS = [
  { value: 'none', label: 'Normal' },
  { value: 'uppercase', label: 'ALL CAPS' },
  { value: 'lowercase', label: 'all lowercase' },
  { value: 'capitalize', label: 'Title Case' },
];

const TEXT_ALIGN_OPTIONS = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
  { value: 'justify', label: 'Justify' },
];

// Animation presets — the dropdown shows a plain-English label; the actual CSS value names one
// of the @keyframes rules injected once into the preview (ANIMATION_DEFS_CSS below). Keep this
// list in sync with ALLOWED_ANIMATION_VALUES in server/services/restyle/aiEdit.js.
const ANIMATION_PRESETS = [
  { value: 'none', label: 'None' },
  { value: 'restyleFadeIn 0.6s ease both', label: 'Fade in' },
  { value: 'restyleSlideUp 0.6s ease both', label: 'Slide up' },
  { value: 'restyleZoomIn 0.5s ease both', label: 'Pop in' },
  { value: 'restylePulse 1s ease-in-out 2', label: 'Pulse' },
  { value: 'restyleBounce 0.8s ease', label: 'Bounce' },
];

// Outline styles for hover/selected states — injected as a SEPARATE <style> tag inside the
// iframe, never merged into the user's own CSS, so nothing about their actual design is
// touched just to show selection state.
const OUTLINE_CSS = `
  [data-restyle-hover] { outline: 2px dashed #3b82f6 !important; outline-offset: 1px; cursor: pointer; }
  [data-restyle-selected] { outline: 2px solid #cc785c !important; outline-offset: 1px; }
  /* box-shadow, not outline, so this coexists visibly with the selected/hover outlines above
     instead of one silently overriding the other — the selected element is normally also one of
     the scope matches, and both indicators should show at once. */
  [data-restyle-scope-preview] { box-shadow: 0 0 0 2px #f59e0b !important; }
`;

// Named keyframes backing the animation presets above — injected once into the preview,
// separate from the user's own merged CSS, same reasoning as OUTLINE_CSS.
const ANIMATION_DEFS_CSS = `
  @keyframes restyleFadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes restyleSlideUp { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes restyleZoomIn { from { opacity: 0; transform: scale(0.85); } to { opacity: 1; transform: scale(1); } }
  @keyframes restylePulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
  @keyframes restyleBounce { 0%, 20%, 50%, 80%, 100% { transform: translateY(0); } 40% { transform: translateY(-12px); } 60% { transform: translateY(-6px); } }
`;

// Demo page — Header, Paragraph, Card, Image — loaded via the same sanitize/auto-fix pipeline
// as a real upload, so "Load a demo" exercises the exact same code path a real page would.
const DEMO_HTML = `<header class="site-header"><h1>Welcome to Acme Co.</h1><p class="tagline">Tools that just work.</p></header>
<main>
  <p class="intro">This is a short paragraph of body text you can click on and restyle. Try changing its color, size, or font using the panel on the right, or just describe what you want in plain English.</p>
  <div class="card">
    <h2>Feature card</h2>
    <p>Cards like this one are a common building block on real websites — click the card itself, its heading, or this paragraph to try editing each one separately.</p>
  </div>
  <img class="demo-image" alt="A simple placeholder graphic" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='220'%3E%3Crect width='400' height='220' fill='%23cc785c'/%3E%3Ctext x='50%25' y='50%25' font-family='sans-serif' font-size='22' fill='white' text-anchor='middle' dominant-baseline='middle'%3EImage placeholder%3C/text%3E%3C/svg%3E" />
</main>`;

const DEMO_CSS = `.site-header { background: #1a1a1a; color: #ffffff; padding: 32px; text-align: center; }
.site-header h1 { margin: 0 0 8px; font-size: 32px; }
.tagline { margin: 0; opacity: 0.8; }
main { max-width: 640px; margin: 0 auto; padding: 24px; font-family: system-ui, sans-serif; }
.intro { font-size: 16px; line-height: 1.6; color: #333333; }
.card { background: #f5f5f0; border: 1px solid #d8d8d0; border-radius: 8px; padding: 20px; margin: 20px 0; }
.card h2 { margin-top: 0; }
.demo-image { display: block; max-width: 100%; border-radius: 8px; margin-top: 20px; }`;

// Checks the curated list first, then any font stacks detected in the uploaded CSS/HTML, so the
// dropdown can reflect an element's real current font even when it's not one of the four
// curated choices.
function matchFontOption(fontFamily, detectedFonts) {
  const known = ['Inter', 'Roboto', 'Merriweather', 'Poppins'];
  const found = known.find(f => fontFamily.includes(f));
  if (found) return FONT_OPTIONS.find(o => o.value.includes(found))?.value || '';
  const primary = fontFamily.split(',')[0].replace(/['"]/g, '').trim().toLowerCase();
  const detected = (detectedFonts || []).find(f => f.label.toLowerCase() === primary || f.value.toLowerCase() === fontFamily.trim().toLowerCase());
  return detected ? detected.value : '';
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
// Normalizes any CSS color (computed rgb()/rgba(), or a raw hex string of any length detected
// in the uploaded CSS) into the exact 6-digit #rrggbb form the native <input type="color">
// requires — it silently rejects anything else, including 3-digit and 8-digit (alpha) hex.
function toHex(colorStr) {
  const s = (colorStr || '').trim();
  const hex3 = /^#([0-9a-fA-F]{3})$/.exec(s);
  if (hex3) return '#' + hex3[1].split('').map((c) => c + c).join('');
  const hex6or8 = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(s);
  if (hex6or8) return '#' + hex6or8[1];
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s);
  if (m) return '#' + [m[1], m[2], m[3]].map(v => (+v).toString(16).padStart(2, '0')).join('');
  return null;
}

const GENERIC_FONT_KEYWORDS = new Set(['inherit', 'initial', 'unset', 'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'system-ui']);

// Pulls every distinct font stack, color, and font-size actually used in the uploaded CSS/HTML
// so they can be offered as quick picks, instead of only the fixed curated lists — "if my CSS
// already names a font/color/size, let me pick it" rather than re-typing what's already there.
function scanCssAssets(cssText, htmlText) {
  const combined = `${cssText || ''}\n${htmlText || ''}`;

  // Real regression, found via user report: these used to break out of the scan loop the
  // moment the display cap was hit (16 colors, 12 fonts). Merged CSS is built with "Embedded
  // styles from your page" FIRST, ahead of separately uploaded/pasted files (see
  // docs/restyle.md) — so if the embedded styles alone had >= 16 distinct colors, the color
  // scan stopped right there and never even reached whatever came later in the merged text,
  // silently hiding every color from a separately uploaded file. Fonts happened to not hit this
  // in practice since there are usually far fewer than 12 distinct font stacks total. Fixed by
  // always scanning the FULL text for distinct values first, and applying the display cap only
  // as a final slice — the cap still limits how many quick-picks are shown, but never which
  // SOURCE they can come from.
  const fonts = [];
  const fontSeen = new Set();
  for (const m of combined.matchAll(/font-family\s*:\s*([^;"'}]+(?:['"][^'"]*['"][^;}]*)?)/gi)) {
    const raw = m[1].replace(/!important/i, '').trim().replace(/;$/, '');
    const primary = raw.split(',')[0].replace(/['"]/g, '').trim().toLowerCase();
    if (!raw || GENERIC_FONT_KEYWORDS.has(primary)) continue;
    const key = raw.toLowerCase();
    if (fontSeen.has(key)) continue;
    fontSeen.add(key);
    const label = raw.split(',')[0].replace(/['"]/g, '').trim();
    fonts.push({ value: raw, label });
  }

  const colors = [];
  const colorSeen = new Set();
  for (const m of combined.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]+\)/g)) {
    const value = m[0];
    const key = value.toLowerCase();
    if (colorSeen.has(key)) continue;
    colorSeen.add(key);
    colors.push(value);
  }

  const extractSizes = (prop) => {
    const out = [];
    const seen = new Set();
    const re = new RegExp(`${prop}\\s*:\\s*([\\d.]+(?:px|rem|em|pt|%))`, 'gi');
    for (const m of combined.matchAll(re)) {
      const value = m[1];
      if (seen.has(value)) continue;
      seen.add(value);
      out.push(value);
    }
    return out.sort((a, b) => parseFloat(a) - parseFloat(b));
  };

  const sizes = extractSizes('font-size').slice(0, 20);
  const paddings = extractSizes('padding(?:-top|-right|-bottom|-left)?').slice(0, 20);
  const radii = extractSizes('border-radius').slice(0, 20);

  // Caps raised well above realistic totals (was 12/16, which is exactly what a real page's
  // embedded styles alone could already exceed) — the display row wraps, so a higher cap costs
  // nothing but guards against a truly pathological page with hundreds of distinct values.
  return { fonts: fonts.slice(0, 40), colors: colors.slice(0, 60), sizes, paddings, radii };
}

const FIELD = {
  background: 'var(--color-bg)',
  borderColor: 'var(--color-border)',
  color: 'var(--color-text)',
};

// A labelled control with a hover tip on its label.
function Field({ label, tip, children }) {
  return (
    <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--color-muted)' }}>
      <Tooltip text={tip}><span className="w-fit">{label}</span></Tooltip>
      {children}
    </label>
  );
}

export default function RestylePage() {
  const getIcon = useIcon();
  const { user } = useAuthStore();
  const isAdmin = user?.isAdmin;
  const addToast = useToastStore((s) => s.addToast);

  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const canUse = isAdmin || featureAccess.restyle !== false;
  const [tool, setTool] = useState('page');
  const info = useToolInfoModal('vault_css_info_seen');

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

  // ---------- Detected fonts/colors/sizes from the uploaded CSS+HTML ----------
  // Offered as extra quick picks alongside the curated lists, so "I used this font/color/size
  // already" doesn't mean re-typing or re-picking it from scratch.
  const [detectedAssets, setDetectedAssets] = useState({ fonts: [], colors: [], sizes: [], paddings: [], radii: [] });

  // ---------- Preview / selection ----------
  const iframeRef = useRef(null);
  const [previewBuilt, setPreviewBuilt] = useState(false);
  const [selectionLabel, setSelectionLabel] = useState('Click anything in your page below to start editing it.');
  const selectedElRef = useRef(null);
  const [hasSelection, setHasSelection] = useState(false);
  const undoStackRef = useRef([]); // { changes: [{ target, property, previousValue }, ...] } — one entry per logical action
  const [canUndo, setCanUndo] = useState(false);
  const suppressControlEvents = useRef(false);

  // Who a change applies to: just the clicked element, or every element sharing one of its
  // classes (e.g. every ".card" on the page) — a real, deliberate choice, not a hidden default,
  // since applying to a whole class is a much bigger action than editing one element.
  // scopeOptions covers two real cases: the selected element's OWN class ("every .card"), and a
  // class on an ANCESTOR combined with this element's tag ("every <a> inside .greenboxsection") —
  // the second one matters because a lot of real CSS styles elements this way (a class on a
  // container, not on the element itself), and an earlier version only ever looked at the
  // element's own classList, which read as flatly wrong to a user who could see the actual CSS
  // rule targeting it via a class further up the tree.
  const [scopeOptions, setScopeOptions] = useState([]); // [{ selector, label }]
  const [editScopeSelector, setEditScopeSelector] = useState(''); // '' = just this element
  const [editScopeLabel, setEditScopeLabel] = useState('');

  // ---------- Property panel control values ----------
  const [ctrl, setCtrl] = useState({
    fontFamily: '', fontSize: 16, fontWeight: '400', color: '#000000',
    lineHeight: 1.2, backgroundColor: '#ffffff', borderRadius: 0, padding: 0, boxShadow: 'none',
    textTransform: 'none', letterSpacing: 0, textAlign: 'left', animation: 'none',
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
      if (data.flags?.length) setFlags((prev) => [...prev, ...data.flags]);
      // A page with styles written directly inside it (a <style> block, most often in <head>)
      // has real CSS the tool didn't know about before — the server pulls it out and hands it
      // back here so it lands in the style list like any uploaded file, instead of the page
      // rendering unstyled and "Build the preview" staying disabled with no CSS in the list.
      if (data.cssFiles?.length) {
        setCssEntries((prev) => [
          ...prev,
          ...data.cssFiles.map((f) => ({ id: ++cssIdRef.current, filename: f.filename, css: f.css, source: 'paste' })),
        ]);
      }
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
  // Once the preview is built, or something in it is clicked, move on from the set-up tools to the editing ones.
  useEffect(() => { if (previewBuilt) setTool((t) => (t === 'page' || t === 'styles' ? 'ask' : t)); }, [previewBuilt]);
  useEffect(() => { if (hasSelection) setTool((t) => (t === 'page' || t === 'styles' || t === 'saved' ? 'ask' : t)); }, [hasSelection]);

  const resetSelection = useCallback(() => {
    selectedElRef.current = null;
    undoStackRef.current = [];
    setCanUndo(false);
    setHasSelection(false);
    setSelectionLabel('Click anything in your page below to start editing it.');
    setScopeOptions([]);
    setEditScopeSelector('');
    setEditScopeLabel('');
  }, []);

  const attachIframeInteractivity = useCallback((idoc) => {
    const outlineStyle = idoc.createElement('style');
    outlineStyle.id = 'restyle-outline-css';
    outlineStyle.textContent = OUTLINE_CSS;
    idoc.head.appendChild(outlineStyle);

    const animationDefs = idoc.createElement('style');
    animationDefs.id = 'restyle-animation-defs';
    animationDefs.textContent = ANIMATION_DEFS_CSS;
    idoc.head.appendChild(animationDefs);

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
      // Animation isn't reliably readable back from getComputedStyle in a form that maps to our
      // presets, so this reflects only an animation WE set inline — a page's own CSS-driven
      // animation (if any) shows as "None" here without being touched or removed.
      animation: ANIMATION_PRESETS.some((o) => o.value === target.style.animation) ? target.style.animation : 'none',
    });
    setTimeout(() => { suppressControlEvents.current = false; }, 0);
  }, [detectedAssets.fonts]);

  const selectElement = useCallback((target, idoc) => {
    if (selectedElRef.current) selectedElRef.current.removeAttribute('data-restyle-selected');
    if (target === idoc.body) {
      resetSelection();
      return;
    }
    target.setAttribute('data-restyle-selected', '');
    selectedElRef.current = target;
    setHasSelection(true);
    const tag = target.tagName.toLowerCase();
    const classes = [...target.classList].filter((c) => !c.startsWith('data-restyle'));
    const label = tag + (classes.length ? '.' + classes.join('.') : '');
    setSelectionLabel(`Editing: ${label}`);

    // Build the list of scope choices: this element's own classes ("every .card"), then classes
    // on ancestors combined with this element's tag ("every <a> inside .greenboxsection") — very
    // common in real CSS (a class on a container, descendant-selector styling on the actual
    // element), and something an earlier version completely missed since it only ever looked at
    // the selected element's own classList. Walk up to (not including) <body>, nearest first,
    // capped so the list can't grow unreasonably long on a deeply nested page.
    const safeClass = (c) => { try { return CSS.escape(c); } catch { return null; } };
    const options = classes
      .map((c) => ({ raw: c, escaped: safeClass(c) }))
      .filter((c) => c.escaped)
      .map(({ raw, escaped }) => ({ selector: `.${escaped}`, label: `Every element with class .${raw}` }));
    let ancestor = target.parentElement;
    const seenAncestorClasses = new Set();
    while (ancestor && ancestor !== idoc.body && options.length < 8) {
      [...ancestor.classList].filter((c) => !c.startsWith('data-restyle')).forEach((c) => {
        if (seenAncestorClasses.has(c)) return;
        seenAncestorClasses.add(c);
        const escaped = safeClass(c);
        if (!escaped) return;
        options.push({ selector: `.${escaped} ${tag}`, label: `Every <${tag}> inside .${c}` });
      });
      ancestor = ancestor.parentElement;
    }
    setScopeOptions(options);
    // A fresh selection always starts scoped to just that element — applying more broadly is
    // something the user opts into each time, never carried over from a previous selection.
    setEditScopeSelector('');
    setEditScopeLabel('');
    populateControlsFromComputed(target);
  }, [populateControlsFromComputed, resetSelection]);

  // Every element a change should apply to, given the current scope choice — just the selected
  // element, or every element in the preview matching the chosen selector (own class, or an
  // ancestor's class + this element's tag).
  const getScopeTargets = useCallback(() => {
    const target = selectedElRef.current;
    if (!target) return [];
    if (!editScopeSelector) return [target];
    try {
      const matches = [...target.ownerDocument.querySelectorAll(editScopeSelector)];
      return matches.length ? matches : [target];
    } catch {
      return [target];
    }
  }, [editScopeSelector]);

  // Live-highlights every element the current scope choice would affect — a distinct amber
  // box-shadow (see OUTLINE_CSS) on each match, cleared and reapplied whenever the scope changes,
  // so picking "every <a> inside .greenboxsection" immediately shows exactly what that means
  // before any change is actually made.
  const scopePreviewElsRef = useRef([]);
  useEffect(() => {
    scopePreviewElsRef.current.forEach((el) => el.removeAttribute('data-restyle-scope-preview'));
    scopePreviewElsRef.current = [];
    if (!editScopeSelector || !selectedElRef.current) return;
    try {
      const matches = [...selectedElRef.current.ownerDocument.querySelectorAll(editScopeSelector)];
      matches.forEach((el) => el.setAttribute('data-restyle-scope-preview', ''));
      scopePreviewElsRef.current = matches;
    } catch { /* invalid selector — nothing to preview */ }
  }, [editScopeSelector, hasSelection]);

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

  // Accepts an explicit entries list so the demo loader can build a preview immediately without
  // waiting on a setCssEntries() re-render; the real "Build the preview" button just passes the
  // current state.
  const runBuildPreview = async (entries) => {
    // Checked via the ref (always current the instant submitHtml() sets it), not the htmlLoaded
    // state flag — loadDemo() calls this synchronously right after submitHtml() resolves, before
    // React necessarily re-renders with the new state, which would otherwise make this a stale
    // closure read of an old "false".
    if (!sanitizedRef.current.body && !sanitizedRef.current.head) { setCssStatus({ text: 'Add your HTML first.', kind: 'error' }); return; }
    // CSS is optional, not required — a page can be previewed and edited with no style file at
    // all (plain HTML, or one whose embedded <style> already got pulled into this list). Repeated
    // user reports of "Build the preview never enables" traced back to this being a hard
    // requirement; it no longer is. Skip the network round trip entirely when there's nothing to
    // process, rather than erroring.
    if (!entries.length) {
      mergedCssRef.current = '';
      setCssStatus({ text: 'Your preview is ready below.', kind: 'ok' });
      setDetectedAssets(scanCssAssets('', `${sanitizedRef.current.head}\n${sanitizedRef.current.body}`));
      renderIframe();
      return;
    }
    setCssStatus({ text: 'Checking your styles…', kind: '' });
    try {
      const fd = new FormData();
      const pasted = [];
      entries.forEach((entry) => {
        if (entry.source === 'file') {
          fd.append('files', new Blob([entry.css], { type: 'text/css' }), entry.filename);
        } else {
          pasted.push({ filename: entry.filename, css: entry.css });
        }
      });
      fd.append('pasted', JSON.stringify(pasted));
      fd.append('order', JSON.stringify(entries.map((e) => e.filename)));

      const res = await api.postForm('/api/restyle/process-css', fd);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong checking your styles.');

      mergedCssRef.current = data.css;
      (data.changeLog || []).forEach(addLogEntry);
      if (data.flags?.length) setFlags((prev) => [...prev, ...data.flags]);
      setCssStatus({ text: 'Your preview is ready below.', kind: 'ok' });
      setDetectedAssets(scanCssAssets(data.css, `${sanitizedRef.current.head}\n${sanitizedRef.current.body}`));
      renderIframe();
    } catch (err) {
      setCssStatus({ text: err.message, kind: 'error' });
    }
  };

  const buildPreview = () => runBuildPreview(cssEntries);

  // ---------- Demo ----------
  const loadDemo = async () => {
    setChangeLog([]);
    setFlags([]);
    await submitHtml({ html: DEMO_HTML });
    cssIdRef.current += 1;
    const demoEntries = [{ id: cssIdRef.current, filename: 'demo-styles.css', css: DEMO_CSS, source: 'paste' }];
    setCssEntries(demoEntries);
    await runBuildPreview(demoEntries);
    addToast('Demo page loaded — click the header, paragraph, card, or image to try editing it.');
  };

  // ---------- Applying changes ----------
  // The undo stack holds one entry per LOGICAL action (one Undo click = one action fully
  // reverted), not one per affected element — a class-wide change to 40 elements is still a
  // single entry with 40 {target,property,previousValue} changes inside it.
  const applyChange = useCallback((property, value, explanation) => {
    const targets = getScopeTargets();
    if (!targets.length) return;
    const changes = [];
    targets.forEach((target) => {
      const previousValue = target.style[property] || '';
      if (previousValue === value) return;
      target.style[property] = value;
      changes.push({ target, property, previousValue });
    });
    if (!changes.length) return;
    undoStackRef.current.push({ changes });
    setCanUndo(true);
    if (editScopeSelector) {
      addLogEntry(`Changed ${PLAIN[property] || property} for ${editScopeLabel.toLowerCase()} (${changes.length} of them).`);
    } else {
      const target = selectedElRef.current;
      const classes = [...target.classList].filter((c) => !c.startsWith('data-restyle'));
      const label = target.tagName.toLowerCase() + (classes.length ? '.' + classes.join('.') : '');
      addLogEntry(explanation || `Changed ${PLAIN[property] || property} of ${label}.`);
    }
  }, [addLogEntry, getScopeTargets, editScopeSelector, editScopeLabel]);

  const handleCtrlChange = (property, rawValue, unit, explanation) => {
    if (suppressControlEvents.current) return;
    const value = unit ? `${rawValue}${unit}` : rawValue;
    setCtrl((prev) => ({ ...prev, [property]: rawValue }));
    applyChange(property, value, explanation);
  };

  // For the detected color-swatch / size-chip quick picks — same as handleCtrlChange but the
  // exact CSS value comes pre-formed (e.g. "1.2rem", "rgba(0,0,0,0.5)") rather than assembled
  // from a slider + unit, so it applies the raw value directly.
  const applyQuickPick = (property, value, explanation, ctrlUpdates) => {
    setCtrl((prev) => ({ ...prev, ...ctrlUpdates }));
    applyChange(property, value, explanation);
  };

  // Animations don't replay just by setting the same CSS value again — the standard trick is to
  // clear it, force the browser to notice (reading offsetWidth), then set the real value on the
  // next tick, so picking "Pulse" a second time still visibly pulses.
  const handleAnimationChange = (value, label) => {
    if (suppressControlEvents.current) return;
    const targets = getScopeTargets();
    if (!targets.length) return;
    setCtrl((prev) => ({ ...prev, animation: value }));
    const changes = [];
    targets.forEach((target) => {
      const previousValue = target.style.animation || '';
      target.style.animation = 'none';
      void target.offsetWidth; // eslint-disable-line no-unused-expressions
      target.style.animation = value === 'none' ? '' : value;
      changes.push({ target, property: 'animation', previousValue });
    });
    undoStackRef.current.push({ changes });
    setCanUndo(true);
    const scopeNote = editScopeSelector ? ` for ${editScopeLabel.toLowerCase()} (${targets.length} of them)` : '';
    addLogEntry(value === 'none' ? `Removed the animation${scopeNote}.` : `Added a "${label}" animation${scopeNote}.`);
  };

  // Reverts the current selection (or every element in the class, if that's the chosen scope)
  // back to how it looked before any editing here — clears just the properties this tool
  // manages, never anything the original page's own CSS/inline style was already doing.
  const handleResetSelection = () => {
    const targets = getScopeTargets();
    if (!targets.length) return;
    const changes = [];
    targets.forEach((target) => {
      Object.keys(PLAIN).forEach((prop) => {
        const previousValue = target.style[prop] || '';
        if (!previousValue) return;
        target.style[prop] = '';
        changes.push({ target, property: prop, previousValue });
      });
    });
    if (!changes.length) { addLogEntry('Nothing to reset — no changes had been made yet.'); return; }
    undoStackRef.current.push({ changes });
    setCanUndo(true);
    if (selectedElRef.current) populateControlsFromComputed(selectedElRef.current);
    addLogEntry(editScopeSelector
      ? `Reset ${editScopeLabel.toLowerCase()} back to how they looked originally.`
      : 'Reset this element back to how it looked originally.');
  };

  const handleUndo = () => {
    const entry = undoStackRef.current.pop();
    if (!entry) return;
    let touchedSelection = false;
    entry.changes.forEach(({ target, property, previousValue }) => {
      target.style[property] = previousValue;
      if (target === selectedElRef.current) touchedSelection = true;
    });
    const properties = [...new Set(entry.changes.map((c) => PLAIN[c.property] || c.property))];
    const scopeNote = entry.changes.length > 1 ? ` (${entry.changes.length} elements affected)` : '';
    addLogEntry(`Undid the last change (${properties.join(', ')})${scopeNote}.`);
    if (touchedSelection) populateControlsFromComputed(selectedElRef.current);
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
        textTransform: cs.textTransform, letterSpacing: cs.letterSpacing, textAlign: cs.textAlign,
        animation: target.style.animation || 'none',
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
    clone.querySelectorAll('[data-restyle-hover],[data-restyle-selected],[data-restyle-scope-preview]').forEach((n) => {
      n.removeAttribute('data-restyle-hover');
      n.removeAttribute('data-restyle-selected');
      n.removeAttribute('data-restyle-scope-preview');
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

  // ---------- Saved pages (revisit later) ----------
  const [savedProjects, setSavedProjects] = useState([]);
  const [savedListOpen, setSavedListOpen] = useState(false);
  const [saveNameInput, setSaveNameInput] = useState('');
  const [savingProject, setSavingProject] = useState(false);
  const [loadingProjectId, setLoadingProjectId] = useState(null);

  const loadSavedProjectsList = useCallback(() => {
    api.get('/api/restyle/projects').then((r) => r.json()).then((d) => {
      if (Array.isArray(d?.projects)) setSavedProjects(d.projects);
    }).catch(() => {});
  }, []);

  useEffect(() => { loadSavedProjectsList(); }, [loadSavedProjectsList]);

  const handleSaveProject = async () => {
    const idoc = iframeRef.current?.contentDocument;
    if (!idoc) { addToast('Build a preview first, then save.', 'error'); return; }
    const name = saveNameInput.trim();
    if (!name) { addToast('Give this page a name first.', 'error'); return; }
    setSavingProject(true);
    try {
      // Save the LIVE edited DOM, not the original sanitizedRef snapshot — every inline-style
      // edit (panel, AI, undo-adjusted) already lives on the elements themselves, so this is
      // what makes "revisit later" actually restore what you left it looking like.
      const clone = idoc.cloneNode(true);
      clone.querySelectorAll('[data-restyle-hover],[data-restyle-selected]').forEach((n) => {
        n.removeAttribute('data-restyle-hover');
        n.removeAttribute('data-restyle-selected');
      });
      clone.getElementById('restyle-outline-css')?.remove();
      clone.getElementById('restyle-animation-defs')?.remove();
      clone.getElementById('restyle-merged-css')?.remove();
      const html = { head: clone.head ? clone.head.innerHTML : '', body: clone.body ? clone.body.innerHTML : '' };

      const res = await api.post('/api/restyle/projects', { name, html, cssEntries });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save this page.');
      addToast(`Saved "${name}".`);
      setSaveNameInput('');
      loadSavedProjectsList();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setSavingProject(false);
    }
  };

  const handleLoadProject = async (id) => {
    setLoadingProjectId(id);
    try {
      const res = await api.get(`/api/restyle/projects/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load this page.');
      const { html, cssEntries: savedEntries } = data.project;
      sanitizedRef.current = { head: html.head || '', body: html.body || '' };
      setHtmlLoaded(true);
      setHtmlStatus({ text: 'Loaded from your saved pages.', kind: 'ok' });
      // Bump past the highest id in the loaded set (not just += length) so a later addCssFiles/
      // addCssPaste can never collide with an id that was already saved under a prior session's
      // higher counter.
      cssIdRef.current = Math.max(cssIdRef.current, ...savedEntries.map((e) => e.id || 0)) + 1;
      setCssEntries(savedEntries);
      setChangeLog([`Loaded your saved page "${data.project.name}".`]);
      setFlags([]);
      await runBuildPreview(savedEntries);
      setSavedListOpen(false);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setLoadingProjectId(null);
    }
  };

  const handleDeleteProject = async (id, name) => {
    try {
      await api.delete(`/api/restyle/projects/${id}`);
      addToast(`Deleted "${name}".`);
      loadSavedProjectsList();
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  if (!canUse) {
    return (
      <div className="p-6" style={{ color: 'var(--color-muted)' }}>
        CSS isn't available for your account. Ask a workspace admin to turn it on in Settings → Feature Access.
      </div>
    );
  }

  const tabBtn = (active) => ({
    flex: 1, padding: '6px 8px', borderRadius: 8, cursor: 'pointer', fontSize: '0.8rem',
    border: `1px solid var(--color-border)`,
    background: active ? 'var(--color-primary)' : 'var(--color-bg)',
    color: active ? '#fff' : 'var(--color-muted)',
  });
  const statusColour = (kind) => (kind === 'error' ? '#b3452c' : kind === 'ok' ? '#2f7a3d' : 'var(--color-muted)');
  const outlineBtn = 'px-3 py-1.5 rounded-lg text-sm border transition-all duration-200 hover:opacity-70 disabled:opacity-50';
  const outlineStyle = { borderColor: 'var(--color-border)', color: 'var(--color-text)' };
  const smallBtn = 'px-3 py-1.5 rounded-lg text-xs font-semibold border transition-opacity duration-200 hover:opacity-70 disabled:opacity-50';
  const primaryStyle = { background: 'var(--color-primary)', color: '#fff' };

  const menu = GROUPS.map((label) => ({
    label,
    tip: GROUP_TIPS[label],
    tools: RESTYLE_TOOLS.filter((t) => t.group === label).map((t) => ({
      ...t,
      tip: TOOL_TIPS[t.id],
      hint: t.needsSelection && !hasSelection ? (previewBuilt ? 'Click something first' : 'Build the preview first') : undefined,
    })),
  }));
  const currentTool = RESTYLE_TOOLS.find((t) => t.id === tool);

  // The guide's "Open" buttons: switch to the tool, exactly as clicking it in the list would.
  const openToolById = (id) => {
    const target = GUIDE_TOOLS.find((t) => t.id === id);
    if (target) setTool(target.tool);
  };

  const colourPicks = (property, explanation) => (detectedAssets.colors.length > 0 && (
    <div className="flex flex-wrap gap-1 mt-1">
      {detectedAssets.colors.map((c) => (
        <Tooltip key={c} text={`Used in your files: ${c}`}>
          <button
            type="button"
            className="w-5 h-5 rounded border"
            aria-label={`Use ${c}`}
            style={{ background: c, borderColor: 'var(--color-border)' }}
            onClick={() => applyQuickPick(property, c, explanation, { [property]: toHex(c) || c })}
          />
        </Tooltip>
      ))}
    </div>
  ));
  const sizePicks = (list, property, explanation) => (list.length > 0 && (
    <div className="flex flex-wrap gap-1 mt-1">
      {list.map((size) => (
        <Tooltip key={size} text={`Used in your files: ${size}`}>
          <button
            type="button"
            className="px-1.5 py-0.5 rounded border text-xs"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-bg)' }}
            onClick={() => applyQuickPick(property, size, explanation, { [property]: parseFloat(size) || ctrl[property] })}
          >{size}</button>
        </Tooltip>
      ))}
    </div>
  ));

  const needBuild = (
    <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
      Build the preview first (Your page, then Style files), then click something in it.
    </p>
  );
  const needClick = (
    <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Click something in the preview on the right first. It gets an outline, and this tool changes it.</p>
  );

  const renderPanel = () => {
    if (currentTool?.needsSelection && !hasSelection) return previewBuilt ? needClick : needBuild;
    switch (tool) {
      case 'page':
        return (
          <section>
            <div className="flex gap-1 mb-2">
              <button style={tabBtn(htmlTab === 'file')} onClick={() => setHtmlTab('file')}>Upload a file</button>
              <button style={tabBtn(htmlTab === 'paste')} onClick={() => setHtmlTab('paste')}>Paste it in</button>
            </div>
            {htmlTab === 'file' && (
              <div
                onClick={() => htmlFileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setHtmlDragOver(true); }}
                onDragLeave={() => setHtmlDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setHtmlDragOver(false); handleHtmlFile(e.dataTransfer.files[0]); }}
                className="rounded-xl border-2 border-dashed p-6 text-center text-sm cursor-pointer transition-all duration-200"
                style={{ borderColor: htmlDragOver ? 'var(--color-primary)' : 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                <p>Drop your .html file here, or click to choose one</p>
                <input ref={htmlFileInputRef} type="file" accept=".html,.htm" hidden onChange={(e) => handleHtmlFile(e.target.files[0])} />
              </div>
            )}
            {htmlTab === 'paste' && (
              <div>
                <textarea className="w-full text-sm rounded-xl border p-2 mb-2" style={{ ...FIELD, minHeight: 110 }} aria-label="Your page's HTML" placeholder="Paste your page's HTML here..." value={htmlPaste} onChange={(e) => setHtmlPaste(e.target.value)} />
                <button className={smallBtn} style={outlineStyle} onClick={() => submitHtml({ html: htmlPaste })}>Use this HTML</button>
              </div>
            )}
            {htmlStatus.text && <p className="text-xs mt-2" style={{ color: statusColour(htmlStatus.kind) }}>{htmlStatus.text}</p>}
            <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>No page handy? Use “Load a demo” above the preview to practise.</p>
          </section>
        );
      case 'styles':
        return (
          <section>
            <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>Add one or more. Reorder with the arrows — styles lower in the list win if two files disagree. They are optional.</p>
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
                className="rounded-xl border-2 border-dashed p-4 text-center text-sm cursor-pointer transition-all duration-200"
                style={{ borderColor: cssDragOver ? 'var(--color-primary)' : 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                <p>Drop one or more .css files here, or click to choose</p>
                <input ref={cssFileInputRef} type="file" accept=".css" multiple hidden onChange={(e) => addCssFiles(e.target.files)} />
              </div>
            ) : (
              <div>
                <div className="mb-1.5">
                  <VoiceInput value={cssPasteName} onChange={setCssPasteName} placeholder="Give it a name, e.g. 'Homepage styles'" label="Name for the pasted styles" />
                </div>
                <textarea className="w-full text-sm rounded-xl border p-2 mb-2" style={{ ...FIELD, minHeight: 110 }} aria-label="Style snippet" placeholder="Paste a style snippet here..." value={cssPasteText} onChange={(e) => setCssPasteText(e.target.value)} />
                <button className={smallBtn} style={outlineStyle} onClick={addCssPaste}>Add this snippet</button>
              </div>
            )}

            <ul className="flex flex-col gap-1.5 my-3">
              {cssEntries.map((entry, i) => (
                <li key={entry.id} className="flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
                  <span className="flex-1 truncate" style={{ color: 'var(--color-text)' }}>{entry.filename}</span>
                  <Tooltip text="Move earlier (lower priority)"><button className="hover:opacity-60" aria-label="Move earlier" disabled={i === 0} onClick={() => moveCssEntry(i, -1)} style={{ color: 'var(--color-muted)', opacity: i === 0 ? 0.3 : 1 }}>{getIcon('chevron-up', { size: 14 })}</button></Tooltip>
                  <Tooltip text="Move later (higher priority)"><button className="hover:opacity-60" aria-label="Move later" disabled={i === cssEntries.length - 1} onClick={() => moveCssEntry(i, 1)} style={{ color: 'var(--color-muted)', opacity: i === cssEntries.length - 1 ? 0.3 : 1 }}>{getIcon('chevron-down', { size: 14 })}</button></Tooltip>
                  <Tooltip text="Remove this file"><button className="hover:opacity-60" aria-label="Remove" onClick={() => removeCssEntry(entry.id)} style={{ color: 'var(--color-muted)' }}>{getIcon('x', { size: 14 })}</button></Tooltip>
                </li>
              ))}
            </ul>

            <Tooltip text={htmlLoaded ? 'Put your page and style files together in a live preview you can click to change.' : 'Add your page first (the Your page tool).'}>
              <button className="px-4 py-2 rounded-xl text-sm font-medium transition-opacity duration-200 hover:opacity-80 disabled:opacity-45" style={primaryStyle} disabled={!htmlLoaded} onClick={buildPreview}>Build the preview</button>
            </Tooltip>
            {!htmlLoaded && <p className="text-xs mt-1.5" style={{ color: 'var(--color-muted)' }}>Add your page first to enable this — style files are optional.</p>}
            {cssStatus.text && <p className="text-xs mt-1.5" style={{ color: statusColour(cssStatus.kind) }}>{cssStatus.text}</p>}

            {flags.length > 0 && (
              <div className="mt-4">
                <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Things worth a look</h3>
                <ul className="flex flex-col gap-1.5 max-h-56 overflow-y-auto">
                  {flags.map((flag, i) => (
                    <li key={i} className="text-xs rounded-md p-1.5 pl-2" style={{ background: '#fdf3ea', borderLeft: '3px solid #d99a3f', color: '#5a4322' }}>{flag}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        );
      case 'saved':
        return (
          <section className="space-y-3">
            <div className="space-y-2">
              <Tooltip text="A name to find this page by later. You can say it with the microphone.">
                <div>
                  <VoiceInput value={saveNameInput} onChange={setSaveNameInput} placeholder="Name this page…" label="Name for this page" onKeyDown={(e) => { if (e.key === 'Enter' && previewBuilt && !savingProject) handleSaveProject(); }} />
                </div>
              </Tooltip>
              <Tooltip text={previewBuilt ? 'Keep the page exactly as it looks now, with all your changes, in your account.' : 'Build the preview first, then save.'}>
                <button className="px-3 py-1.5 rounded-lg text-sm font-semibold transition-opacity duration-200 hover:opacity-80 disabled:opacity-45" style={primaryStyle} disabled={!previewBuilt || savingProject} onClick={handleSaveProject}>{savingProject ? 'Saving…' : 'Save this page'}</button>
              </Tooltip>
            </div>
            {savedProjects.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Nothing saved yet. Build a preview, then save it here.</p>
            ) : (
              <ul className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                {savedProjects.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm border-b last:border-b-0" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                    <Tooltip text="Open this page with all your saved changes.">
                      <button className="flex-1 text-left truncate transition-opacity duration-200 hover:opacity-70" style={{ color: 'var(--color-text)' }} disabled={loadingProjectId === p.id} onClick={() => handleLoadProject(p.id)}>
                        {loadingProjectId === p.id ? 'Loading…' : p.name}
                      </button>
                    </Tooltip>
                    <Tooltip text="Delete this saved page.">
                      <button className="hover:opacity-60" aria-label={`Delete ${p.name}`} style={{ color: 'var(--color-muted)' }} onClick={() => handleDeleteProject(p.id, p.name)}>{getIcon('x', { size: 14 })}</button>
                    </Tooltip>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      case 'ask':
        return (
          <section>
            <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>Describe what you want done to the thing you clicked. Type it, or tap the microphone and say it.</p>
            <VoiceInput
              type="textarea"
              append
              rows={4}
              value={aiRequest}
              onChange={setAiRequest}
              placeholder="e.g. make this bigger and give it rounded corners"
              label="Your request, in plain English"
            />
            <div className="mt-2">
              <Tooltip text="Turn your words into changes to the look of the clicked item. You can undo it.">
                <button
                  className="px-3 py-1.5 rounded-lg text-sm font-semibold transition-opacity duration-200 hover:opacity-80 disabled:opacity-45"
                  style={primaryStyle}
                  disabled={aiBusy || !aiRequest.trim()}
                  onClick={handleAiRequest}
                >{aiBusy ? 'Asking…' : 'Ask for this change'}</button>
              </Tooltip>
            </div>
            {aiStatus.text && <p className="text-xs mt-2" style={{ color: statusColour(aiStatus.kind) }}>{aiStatus.text}</p>}
          </section>
        );
      case 'scope':
        return (
          <section>
            <label className="flex items-center gap-1.5 text-xs mb-1" style={{ color: 'var(--color-text)' }}>
              <input type="radio" name="editScope" checked={!editScopeSelector} onChange={() => { setEditScopeSelector(''); setEditScopeLabel(''); }} />
              Just this element
            </label>
            {scopeOptions.length > 0 ? (
              scopeOptions.map((opt) => (
                <label key={opt.selector} className="flex items-center gap-1.5 text-xs mb-1" style={{ color: 'var(--color-text)' }}>
                  <input type="radio" name="editScope" checked={editScopeSelector === opt.selector} onChange={() => { setEditScopeSelector(opt.selector); setEditScopeLabel(opt.label); }} />
                  {opt.label}
                </label>
              ))
            ) : (
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>This element (and nothing around it) has a class, so it can only be edited on its own.</p>
            )}
            {editScopeSelector && (
              <p className="text-xs mt-1" style={{ color: '#b3452c' }}>Changes will apply to every matching element on the page, not just this one. They are outlined in amber.</p>
            )}
            <Tooltip text="Clear every change made here, back to how it looked when the preview was built.">
              <button type="button" className={`${smallBtn} mt-3`} style={outlineStyle} onClick={handleResetSelection}>
                Reset {editScopeSelector ? editScopeLabel.replace(/^Every/, 'every') : 'this element'}
              </button>
            </Tooltip>
          </section>
        );
      case 'text':
        return (
          <section className="flex flex-col gap-3">
            <Field label="Font" tip="The typeface of the clicked item. Fonts your own files already use are listed too.">
              <select className="rounded-lg border p-1.5" style={FIELD} value={ctrl.fontFamily} onChange={(e) => handleCtrlChange('fontFamily', e.target.value, null, e.target.value ? 'Changed the font.' : 'Changed the font back to the default.')}>
                {FONT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                {detectedAssets.fonts.filter((f) => !FONT_OPTIONS.some((o) => o.value === f.value)).map((f) => (
                  <option key={f.value} value={f.value}>{f.label} (used in your files)</option>
                ))}
              </select>
            </Field>
            <Field label="Size" tip="How big the text is, in pixels.">
              <input type="range" min={8} max={96} step={1} value={ctrl.fontSize} onChange={(e) => handleCtrlChange('fontSize', Number(e.target.value), 'px', `Changed the text size to ${e.target.value}px.`)} />
              <span style={{ color: 'var(--color-text)' }}>{ctrl.fontSize}px</span>
              {sizePicks(detectedAssets.sizes, 'fontSize', 'Changed the text size.')}
            </Field>
            <Field label="Weight" tip="How light or bold the text is.">
              <select className="rounded-lg border p-1.5" style={FIELD} value={ctrl.fontWeight} onChange={(e) => handleCtrlChange('fontWeight', e.target.value, null, 'Changed how bold the text is.')}>
                <option value="400">Normal</option>
                <option value="600">Semi-bold</option>
                <option value="700">Bold</option>
                <option value="300">Light</option>
              </select>
            </Field>
            <Field label="Text color" tip="The colour of the text. Colours your files already use are offered below.">
              <input type="color" style={{ width: '100%', height: 32, border: '1px solid var(--color-border)', borderRadius: 6 }} value={ctrl.color} onChange={(e) => handleCtrlChange('color', e.target.value, null, 'Changed the text color.')} />
              {colourPicks('color', 'Changed the text color.')}
            </Field>
            <Field label="Space between lines" tip="How much room there is between lines of text.">
              <input type="range" min={0.8} max={3} step={0.1} value={ctrl.lineHeight} onChange={(e) => handleCtrlChange('lineHeight', Number(e.target.value), null, 'Changed the spacing between lines of text.')} />
              <span style={{ color: 'var(--color-text)' }}>{ctrl.lineHeight}</span>
            </Field>
          </section>
        );
      case 'enhance':
        return (
          <section className="flex flex-col gap-3">
            <Field label="Capitalization" tip="Show the text as normal, in ALL CAPS, all lowercase or Title Case, without retyping it.">
              <select className="rounded-lg border p-1.5" style={FIELD} value={ctrl.textTransform} onChange={(e) => handleCtrlChange('textTransform', e.target.value, null, e.target.value === 'none' ? 'Changed the text capitalization back to normal.' : 'Changed the text capitalization.')}>
                {TEXT_TRANSFORM_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Space between letters" tip="Pull the letters closer together or spread them apart.">
              <input type="range" min={-2} max={12} step={0.5} value={ctrl.letterSpacing} onChange={(e) => handleCtrlChange('letterSpacing', Number(e.target.value), 'px', 'Changed the spacing between letters.')} />
              <span style={{ color: 'var(--color-text)' }}>{ctrl.letterSpacing}px</span>
            </Field>
            <Field label="Alignment" tip="Line the text up on the left, centre or right, or spread it to fill the width.">
              <select className="rounded-lg border p-1.5" style={FIELD} value={ctrl.textAlign} onChange={(e) => handleCtrlChange('textAlign', e.target.value, null, 'Changed the text alignment.')}>
                {TEXT_ALIGN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
          </section>
        );
      case 'animation':
        return (
          <section className="flex flex-col gap-3">
            <Field label="Effect" tip="A short movement when the item appears: fade in, slide up, pop in, pulse or bounce.">
              <select className="rounded-lg border p-1.5" style={FIELD} value={ctrl.animation} onChange={(e) => handleAnimationChange(e.target.value, e.target.selectedOptions[0]?.text || '')}>
                {ANIMATION_PRESETS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
          </section>
        );
      case 'box':
        return (
          <section className="flex flex-col gap-3">
            <Field label="Background color" tip="The colour behind the item. Colours your files already use are offered below.">
              <input type="color" style={{ width: '100%', height: 32, border: '1px solid var(--color-border)', borderRadius: 6 }} value={ctrl.backgroundColor} onChange={(e) => handleCtrlChange('backgroundColor', e.target.value, null, 'Changed the background color.')} />
              {colourPicks('backgroundColor', 'Changed the background color.')}
            </Field>
            <Field label="Rounded corners" tip="How rounded the corners of the item are, in pixels.">
              <input type="range" min={0} max={60} step={1} value={ctrl.borderRadius} onChange={(e) => handleCtrlChange('borderRadius', Number(e.target.value), 'px', 'Changed the rounded corners.')} />
              <span style={{ color: 'var(--color-text)' }}>{ctrl.borderRadius}px</span>
              {sizePicks(detectedAssets.radii, 'borderRadius', 'Changed the rounded corners.')}
            </Field>
            <Field label="Space around the content" tip="How much room there is between the item's edge and what is inside it, in pixels.">
              <input type="range" min={0} max={80} step={1} value={ctrl.padding} onChange={(e) => handleCtrlChange('padding', Number(e.target.value), 'px', 'Changed the space around the content.')} />
              <span style={{ color: 'var(--color-text)' }}>{ctrl.padding}px</span>
              {sizePicks(detectedAssets.paddings, 'padding', 'Changed the space around the content.')}
            </Field>
            <Field label="Shadow" tip="A shadow or glow around the item, from subtle to strong.">
              <select className="rounded-lg border p-1.5" style={FIELD} value={SHADOW_OPTIONS.some((o) => o.value === ctrl.boxShadow) ? ctrl.boxShadow : 'none'} onChange={(e) => handleCtrlChange('boxShadow', e.target.value, null, 'Changed the shadow.')}>
                {SHADOW_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
          </section>
        );
      default:
        return null;
    }
  };

  return (
    <VoiceInputProvider lang="en-AU">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Roboto:wght@400;700&family=Merriweather:wght@400;700&family=Poppins:wght@400;600;700&display=swap" rel="stylesheet" />

      <div className="flex flex-col sm:flex-row min-h-[calc(100dvh-3rem)]">
        <ToolSidebar
          title="CSS"
          icon="palette"
          groups={menu}
          current={tool}
          onSelect={setTool}
          onInfo={info.open}
          infoTip="How this tool works, and what it cannot do."
        />

        <main className="flex-1 min-w-0 p-4 sm:p-5 flex flex-col gap-3" style={{ background: 'var(--color-bg)' }}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{currentTool?.label}</h2>
              <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>{TOOL_BLURBS[tool]}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Tooltip text="Load a small practice page and build its preview, so you can try clicking and changing things.">
                <button className={outlineBtn} style={outlineStyle} onClick={loadDemo}>Load a demo</button>
              </Tooltip>
              <Tooltip text="Take back your last change. A change to many items at once is one undo.">
                <button className={outlineBtn} style={outlineStyle} disabled={!canUndo} onClick={handleUndo}>Undo last change</button>
              </Tooltip>
              <Tooltip text="Save the finished page, with all your changes built in, as one .html file.">
                <button className="px-3 py-1.5 rounded-lg text-sm font-medium transition-opacity duration-200 hover:opacity-80 disabled:opacity-45" style={primaryStyle} disabled={!previewBuilt} onClick={handleExport}>Download my page</button>
              </Tooltip>
            </div>
          </div>

          <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
            <div className="lg:w-80 shrink-0 rounded-xl border p-4 overflow-y-auto" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', maxHeight: 'calc(100dvh - 11rem)' }}>
              {renderPanel()}
            </div>

            <section className="flex-1 min-w-0 flex flex-col gap-2" style={{ minHeight: 'calc(100dvh - 14rem)' }}>
              <div className="rounded-lg border px-3 py-2 text-sm" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
                {selectionLabel}
              </div>
              <div className="relative flex-1 rounded-xl border overflow-hidden" style={{ background: '#fff', borderColor: 'var(--color-border)' }}>
                <iframe ref={iframeRef} title="Live preview" sandbox="allow-same-origin" style={{ width: '100%', height: '100%', border: 'none', display: previewBuilt ? 'block' : 'none' }} />
                {!previewBuilt && (
                  <div className="absolute inset-0 flex items-center justify-center text-center p-5" style={{ color: 'var(--color-muted)', background: 'var(--color-surface)' }}>
                    <p>Add your page (Your page), then press “Build the preview” (Style files). Or load a demo above.</p>
                  </div>
                )}
              </div>
            </section>
          </div>
        </main>
      </div>

      {info.show && (
        <ToolInfoModal title="How CSS Works" onClose={info.close}>
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>
            Change how your website looks without writing any code. Work down the list on the left: bring in your page, build the preview, then click things in it and change them. Hover any tool for a plain explanation. Not sure what to do? Press the round button at the bottom right and tell the guide what you want.
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
