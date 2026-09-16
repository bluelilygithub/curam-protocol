import React, { useEffect, useRef, useState, useCallback } from 'react';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import { useVoice } from '../hooks/useVoice';
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
    if (fonts.length >= 12) break;
  }

  const colors = [];
  const colorSeen = new Set();
  for (const m of combined.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]+\)/g)) {
    const value = m[0];
    const key = value.toLowerCase();
    if (colorSeen.has(key)) continue;
    colorSeen.add(key);
    colors.push(value);
    if (colors.length >= 16) break;
  }

  const extractSizes = (prop, limit) => {
    const out = [];
    const seen = new Set();
    const re = new RegExp(`${prop}\\s*:\\s*([\\d.]+(?:px|rem|em|pt|%))`, 'gi');
    for (const m of combined.matchAll(re)) {
      const value = m[1];
      if (seen.has(value)) continue;
      seen.add(value);
      out.push(value);
      if (out.length >= limit) break;
    }
    return out.sort((a, b) => parseFloat(a) - parseFloat(b));
  };

  const sizes = extractSizes('font-size', 10);
  const paddings = extractSizes('padding(?:-top|-right|-bottom|-left)?', 10);
  const radii = extractSizes('border-radius', 10);

  return { fonts, colors, sizes, paddings, radii };
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
  const { isSTTAvailable, isLocalSTTAvailable, isListening, isTranscribing, transcript, interimText, voiceError, startListening, stopListening } = useVoice();

  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const canUse = isAdmin || featureAccess.restyle !== false;

  useEffect(() => {
    api.get('/api/settings/feature-access')
      .then((r) => r.json())
      .then((d) => { if (d?.flags) setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...d.flags }); })
      .catch(() => {});
  }, []);

  // Voice input for the plain-English request box — same useVoice() hook as chat elsewhere.
  useEffect(() => {
    if (transcript) {
      setAiRequest((prev) => (prev.trim() ? prev.trim() + ' ' + transcript.trim() : transcript.trim()));
    }
  }, [transcript]);

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
  const undoStackRef = useRef([]); // { target, property, previousValue }
  const [canUndo, setCanUndo] = useState(false);
  const suppressControlEvents = useRef(false);

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

  // Accepts an explicit entries list so the demo loader can build a preview immediately without
  // waiting on a setCssEntries() re-render; the real "Build the preview" button just passes the
  // current state.
  const runBuildPreview = async (entries) => {
    // Checked via the ref (always current the instant submitHtml() sets it), not the htmlLoaded
    // state flag — loadDemo() calls this synchronously right after submitHtml() resolves, before
    // React necessarily re-renders with the new state, which would otherwise make this a stale
    // closure read of an old "false".
    if (!sanitizedRef.current.body && !sanitizedRef.current.head) { setCssStatus({ text: 'Add your HTML first.', kind: 'error' }); return; }
    if (!entries.length) { setCssStatus({ text: 'Add at least one style file first.', kind: 'error' }); return; }
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
    const target = selectedElRef.current;
    if (!target) return;
    setCtrl((prev) => ({ ...prev, animation: value }));
    const previousValue = target.style.animation || '';
    target.style.animation = 'none';
    void target.offsetWidth; // eslint-disable-line no-unused-expressions
    target.style.animation = value === 'none' ? '' : value;
    undoStackRef.current.push({ target, property: 'animation', previousValue });
    setCanUndo(true);
    addLogEntry(value === 'none' ? 'Removed the animation.' : `Added a "${label}" animation.`);
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
        <h1 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>CSS</h1>
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Change how your website looks — no code needed.</p>
        <div className="ml-auto flex items-center gap-2">
          <button className="px-3 py-2 rounded-md text-sm font-semibold border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }} onClick={loadDemo}>Load a demo</button>
          <div className="relative">
            <button className="px-3 py-2 rounded-md text-sm font-semibold border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }} onClick={() => setSavedListOpen((v) => !v)}>My saved pages ({savedProjects.length})</button>
            {savedListOpen && (
              <div className="absolute right-0 mt-1 rounded-lg border shadow-lg z-20" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', width: 260 }}>
                {savedProjects.length === 0 ? (
                  <p className="text-xs p-3" style={{ color: 'var(--color-muted)' }}>Nothing saved yet. Build a preview, then use "Save this page" below.</p>
                ) : (
                  <ul className="max-h-64 overflow-y-auto">
                    {savedProjects.map((p) => (
                      <li key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm border-b last:border-b-0" style={{ borderColor: 'var(--color-border)' }}>
                        <button className="flex-1 text-left truncate hover:opacity-70" style={{ color: 'var(--color-text)' }} disabled={loadingProjectId === p.id} onClick={() => handleLoadProject(p.id)}>
                          {loadingProjectId === p.id ? 'Loading…' : p.name}
                        </button>
                        <button className="hover:opacity-60" title="Delete" style={{ color: 'var(--color-muted)' }} onClick={() => handleDeleteProject(p.id, p.name)}>{getIcon('x', { size: 14 })}</button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex gap-1 p-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
                  <input type="text" className="flex-1 text-xs rounded-md border p-1.5" style={FIELD} placeholder="Name this page…" value={saveNameInput} onChange={(e) => setSaveNameInput(e.target.value)} />
                  <button className="px-2 py-1 rounded-md text-xs font-semibold" style={{ background: 'var(--color-primary)', color: '#fff', opacity: previewBuilt && !savingProject ? 1 : 0.45 }} disabled={!previewBuilt || savingProject} onClick={handleSaveProject}>{savingProject ? 'Saving…' : 'Save this page'}</button>
                </div>
              </div>
            )}
          </div>
          <button className="px-3 py-2 rounded-md text-sm font-semibold border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', opacity: canUndo ? 1 : 0.45 }} disabled={!canUndo} onClick={handleUndo}>Undo last change</button>
          <button className="px-3 py-2 rounded-md text-sm font-semibold" style={{ background: 'var(--color-primary)', color: '#fff', opacity: previewBuilt ? 1 : 0.45 }} disabled={!previewBuilt} onClick={handleExport}>Download my page</button>
        </div>
      </div>

      <div className="grid gap-4 p-4 flex-1" style={{ gridTemplateColumns: '320px 1fr 300px', minHeight: 0 }}>
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
              className="w-full text-sm rounded-md border p-2 mb-1"
              style={{ ...FIELD, minHeight: 70 }}
              placeholder="e.g. make this bigger and give it rounded corners"
              disabled={!hasSelection || isListening || isTranscribing}
              // While listening/transcribing, show the live caption directly in the box (appended
              // to whatever was already typed) so it's obvious speech is actually being captured —
              // previously this only appeared in a separate line below, which read as "nothing is
              // being input." The box is read-only during this (see disabled above); typing resumes
              // once the mic is stopped and the final transcript has been merged into aiRequest.
              value={(isListening || isTranscribing) ? (aiRequest ? `${aiRequest} ${interimText}` : interimText) : aiRequest}
              onChange={(e) => setAiRequest(e.target.value)}
            />
            <div className="flex items-center gap-2 mb-2">
              {(isSTTAvailable || isLocalSTTAvailable) && (
                <button
                  type="button"
                  onClick={isListening ? stopListening : startListening}
                  disabled={!hasSelection || isTranscribing}
                  className="w-7 h-7 flex items-center justify-center rounded-lg relative"
                  style={{ color: isListening || isTranscribing ? '#ef4444' : 'var(--color-muted)', background: 'transparent', opacity: hasSelection ? 1 : 0.4 }}
                  title={isListening ? 'Stop listening and use what was said' : 'Speak your request'}
                >
                  {getIcon('mic', { size: 14 })}
                  {(isListening || isTranscribing) && <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full animate-pulse" style={{ background: '#ef4444' }} />}
                </button>
              )}
              {isListening && (
                <button type="button" onClick={stopListening} className="text-xs font-semibold px-2 py-1 rounded-md" style={{ background: '#fee2e2', color: '#ef4444' }}>Stop &amp; use this</button>
              )}
              {isTranscribing && <span className="text-xs" style={{ color: '#ef4444' }}>Transcribing…</span>}
              {!isListening && voiceError && <span className="text-xs truncate" style={{ color: '#b3452c' }} title={voiceError}>{voiceError}</span>}
            </div>
            <button
              className="px-3 py-1.5 rounded-md text-xs font-semibold"
              style={{ background: 'var(--color-primary)', color: '#fff', opacity: hasSelection && !aiBusy && !isListening && !isTranscribing ? 1 : 0.45 }}
              disabled={!hasSelection || aiBusy || isListening || isTranscribing}
              title={isListening ? 'Stop the mic first to use what was said' : undefined}
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
                  {detectedAssets.fonts.filter((f) => !FONT_OPTIONS.some((o) => o.value === f.value)).map((f) => (
                    <option key={f.value} value={f.value}>{f.label} (used in your files)</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                Size
                <input type="range" min={8} max={96} step={1} value={ctrl.fontSize} onChange={(e) => handleCtrlChange('fontSize', Number(e.target.value), 'px', `Changed the text size to ${e.target.value}px.`)} />
                <span style={{ color: 'var(--color-text)' }}>{ctrl.fontSize}px</span>
                {detectedAssets.sizes.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {detectedAssets.sizes.map((size) => (
                      <button key={size} type="button"
                        className="px-1.5 py-0.5 rounded border text-xs"
                        style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-bg)' }}
                        title={`Used in your files: ${size}`}
                        onClick={() => applyQuickPick('fontSize', size, `Changed the text size to ${size}.`, { fontSize: parseFloat(size) || ctrl.fontSize })}
                      >{size}</button>
                    ))}
                  </div>
                )}
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
                {detectedAssets.colors.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {detectedAssets.colors.map((c) => (
                      <button key={c} type="button" title={`Used in your files: ${c}`}
                        className="w-5 h-5 rounded border"
                        style={{ background: c, borderColor: 'var(--color-border)' }}
                        onClick={() => applyQuickPick('color', c, 'Changed the text color.', { color: toHex(c) || c })}
                      />
                    ))}
                  </div>
                )}
              </label>
              <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                Space between lines
                <input type="range" min={0.8} max={3} step={0.1} value={ctrl.lineHeight} onChange={(e) => handleCtrlChange('lineHeight', Number(e.target.value), null, 'Changed the spacing between lines of text.')} />
                <span style={{ color: 'var(--color-text)' }}>{ctrl.lineHeight}</span>
              </label>

              <h2 className="text-sm font-semibold mt-2" style={{ color: 'var(--color-text)' }}>Text enhancements</h2>
              <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                Capitalization
                <select className="rounded-md border p-1.5" style={FIELD} value={ctrl.textTransform} onChange={(e) => handleCtrlChange('textTransform', e.target.value, null, e.target.value === 'none' ? 'Changed the text capitalization back to normal.' : 'Changed the text capitalization.')}>
                  {TEXT_TRANSFORM_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                Space between letters
                <input type="range" min={-2} max={12} step={0.5} value={ctrl.letterSpacing} onChange={(e) => handleCtrlChange('letterSpacing', Number(e.target.value), 'px', 'Changed the spacing between letters.')} />
                <span style={{ color: 'var(--color-text)' }}>{ctrl.letterSpacing}px</span>
              </label>
              <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                Alignment
                <select className="rounded-md border p-1.5" style={FIELD} value={ctrl.textAlign} onChange={(e) => handleCtrlChange('textAlign', e.target.value, null, 'Changed the text alignment.')}>
                  {TEXT_ALIGN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>

              <h2 className="text-sm font-semibold mt-2" style={{ color: 'var(--color-text)' }}>Animation</h2>
              <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                Effect
                <select className="rounded-md border p-1.5" style={FIELD} value={ctrl.animation} onChange={(e) => handleAnimationChange(e.target.value, e.target.selectedOptions[0]?.text || '')}>
                  {ANIMATION_PRESETS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>

              <h2 className="text-sm font-semibold mt-2" style={{ color: 'var(--color-text)' }}>Box</h2>
              <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                Background color
                <input type="color" style={{ width: '100%', height: 32, border: '1px solid var(--color-border)', borderRadius: 6 }} value={ctrl.backgroundColor} onChange={(e) => handleCtrlChange('backgroundColor', e.target.value, null, 'Changed the background color.')} />
                {detectedAssets.colors.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {detectedAssets.colors.map((c) => (
                      <button key={c} type="button" title={`Used in your files: ${c}`}
                        className="w-5 h-5 rounded border"
                        style={{ background: c, borderColor: 'var(--color-border)' }}
                        onClick={() => applyQuickPick('backgroundColor', c, 'Changed the background color.', { backgroundColor: toHex(c) || c })}
                      />
                    ))}
                  </div>
                )}
              </label>
              <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                Rounded corners
                <input type="range" min={0} max={60} step={1} value={ctrl.borderRadius} onChange={(e) => handleCtrlChange('borderRadius', Number(e.target.value), 'px', 'Changed the rounded corners.')} />
                <span style={{ color: 'var(--color-text)' }}>{ctrl.borderRadius}px</span>
                {detectedAssets.radii.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {detectedAssets.radii.map((size) => (
                      <button key={size} type="button"
                        className="px-1.5 py-0.5 rounded border text-xs"
                        style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-bg)' }}
                        title={`Used in your files: ${size}`}
                        onClick={() => applyQuickPick('borderRadius', size, 'Changed the rounded corners.', { borderRadius: parseFloat(size) || ctrl.borderRadius })}
                      >{size}</button>
                    ))}
                  </div>
                )}
              </label>
              <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                Space around the content
                <input type="range" min={0} max={80} step={1} value={ctrl.padding} onChange={(e) => handleCtrlChange('padding', Number(e.target.value), 'px', 'Changed the space around the content.')} />
                <span style={{ color: 'var(--color-text)' }}>{ctrl.padding}px</span>
                {detectedAssets.paddings.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {detectedAssets.paddings.map((size) => (
                      <button key={size} type="button"
                        className="px-1.5 py-0.5 rounded border text-xs"
                        style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-bg)' }}
                        title={`Used in your files: ${size}`}
                        onClick={() => applyQuickPick('padding', size, 'Changed the space around the content.', { padding: parseFloat(size) || ctrl.padding })}
                      >{size}</button>
                    ))}
                  </div>
                )}
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
